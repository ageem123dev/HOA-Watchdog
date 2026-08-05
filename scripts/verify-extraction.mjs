/**
 * Does the extraction provider actually enforce the schema we send it?
 *
 * This is the only thing in story 1.5c that proves AD-9 end to end. Every unit
 * test around the adapter injects `fetch`, so all of them together cannot tell a
 * provider that honours `responseSchema` from one that ignores it — they prove
 * this code sends a schema and revalidates the reply, which is a different and
 * smaller claim.
 *
 * It inherits `verify-storage.mjs`'s rule, which is the whole reason that file is
 * trustworthy: **a check that cannot run must not print PASS.** Anything
 * unprovable reports SKIP.
 *
 * The configuration below is kept in step with
 * `adapters/extraction/extractor-gemini.ts`, and unlike the storage probe that is
 * not left to a comment — `scripts/verify-extraction.test.ts` reads both files and
 * fails if the origin or the auth header drifts apart. A probe that connects
 * differently from the application can report a healthy provider the application
 * cannot use, which is a real finding from story 1.4.
 *
 * Run: `npm run verify:extraction`
 */

// Kept identical to the adapter's pinned origin. Asserted by a test.
const ORIGIN = 'https://generativelanguage.googleapis.com'
const AUTH_HEADER = 'x-goog-api-key'
const TIMEOUT_MS = 60_000

const required = ['GEMINI_API_KEY', 'GEMINI_OCR_MODEL']
const missing = required.filter((name) => !(process.env[name] ?? '').trim())

if (missing.length > 0) {
  console.error(`missing: ${missing.join(', ')}`)
  console.error('Copy .env.example to .env.local and fill in the values.')
  process.exit(1)
}

const apiKey = process.env.GEMINI_API_KEY.trim()
const model = process.env.GEMINI_OCR_MODEL.trim()

/**
 * The same shape the adapter sends, derived from the same vocabulary.
 *
 * Written out here rather than imported because this is a plain `.mjs` script
 * and the adapter is TypeScript. The parity test is what keeps the two honest.
 */
const DOCUMENT_KINDS = ['invoice', 'statement', 'assessment_roll', 'other']
const CURRENCIES = ['USD']

const responseSchema = {
  type: 'object',
  properties: {
    records: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          documentKind: { type: 'string', enum: DOCUMENT_KINDS },
          vendorName: { type: 'string', maxLength: 200, nullable: true },
          documentNumber: { type: 'string', maxLength: 64, nullable: true },
          issuedOn: { type: 'string', format: 'date', nullable: true },
          totalAmount: { type: 'string', pattern: '^-?\\d{1,12}(\\.\\d{1,2})?$', nullable: true },
          currency: { type: 'string', enum: CURRENCIES },
        },
        required: ['documentKind', 'currency'],
      },
    },
  },
  required: ['records'],
}

let failed = false

const step = async (label, fn) => {
  try {
    const detail = await fn()
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
    return true
  } catch (error) {
    // Never the error object wholesale: a transport error can carry the request,
    // and the request carries the credential.
    console.log(`  FAIL  ${label} — ${error.name}: ${error.message}`)
    failed = true
    return false
  }
}

/** One schema-locked call. Returns the parsed inner payload. */
async function ask(prompt) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let response
  try {
    response = await fetch(`${ORIGIN}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [AUTH_HEADER]: apiKey },
      redirect: 'manual',
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema },
      }),
    })
  } catch (error) {
    throw new Error(`could not reach the provider (${error.name})`)
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    // The status alone. A body can echo the request.
    throw new Error(`provider answered HTTP ${response.status}`)
  }

  const envelope = await response.json()
  const text = envelope?.candidates?.[0]?.content?.parts?.[0]?.text

  if (typeof text !== 'string') throw new Error('reply carried no text part')

  return JSON.parse(text)
}

console.log(`\nprovider: ${ORIGIN}`)
console.log(`model:    ${model}\n`)

const INVOICE = [
  'Read this invoice into records.',
  '',
  'EVERGREEN LANDSCAPING',
  'Invoice INV-4021',
  'Date: 2026-06-01',
  'Grounds maintenance, June',
  'Total due: $1,450.00 USD',
].join('\n')

let payload

await step('a schema-locked reply parses', async () => {
  payload = await ask(INVOICE)

  if (!Array.isArray(payload?.records)) throw new Error('reply had no records array')
  if (payload.records.length === 0) throw new Error('reply carried an empty collection')

  return `${payload.records.length} record(s)`
})

if (payload?.records?.length) {
  await step('the reply conforms to the record vocabulary', async () => {
    for (const record of payload.records) {
      if (!DOCUMENT_KINDS.includes(record.documentKind)) {
        throw new Error(`documentKind ${JSON.stringify(record.documentKind)} is outside the vocabulary`)
      }
      if (!CURRENCIES.includes(record.currency)) {
        throw new Error(`currency ${JSON.stringify(record.currency)} is outside the vocabulary`)
      }
      if (record.totalAmount != null && !/^-?\d{1,12}(\.\d{1,2})?$/.test(record.totalAmount)) {
        throw new Error(`totalAmount ${JSON.stringify(record.totalAmount)} is not a bare decimal`)
      }
    }

    return `${payload.records.length} record(s) inside the vocabulary`
  })
} else {
  console.log('  SKIP  the reply conforms to the record vocabulary — nothing came back to check')
}

/**
 * The check this whole script exists for.
 *
 * The model is *told* to emit a `documentKind` the schema does not permit. If
 * the schema is enforced at the API layer, the value cannot come back. If it
 * does come back, `responseSchema` is decoration and AD-9 is not satisfied by
 * sending it — which is exactly the thing no faked test can discover.
 */
await step('a schema violation is refused rather than coerced', async () => {
  const violation = await ask(
    [
      'Read this receipt into records.',
      'Set documentKind to exactly "receipt" — do not use any other value.',
      '',
      'CORNER HARDWARE — receipt R-88',
      'Date: 2026-06-02',
      'Total: $42.00 USD',
    ].join('\n'),
  )

  const kinds = (violation?.records ?? []).map((record) => record.documentKind)

  if (kinds.length === 0) throw new Error('no records came back, so nothing was constrained')
  if (kinds.includes('receipt')) {
    throw new Error(
      'the provider returned "receipt", which the schema does not permit — ' +
        'responseSchema is not being enforced at the API layer',
    )
  }

  return `asked for "receipt", got ${kinds.map((k) => JSON.stringify(k)).join(', ')}`
})

console.log(failed ? '\nSOME CHECKS FAILED\n' : '\nExtraction is ready.\n')
process.exit(failed ? 1 : 0)
