import {
  AMOUNT_PATTERN,
  DOCUMENT_KINDS,
  DOCUMENT_NUMBER_MAX_LENGTH,
  SUPPORTED_CURRENCIES,
  UNIT_REFERENCE_MAX_LENGTH,
  VENDOR_NAME_MAX_LENGTH,
} from '../../core/extraction/record'
import type { ExtractionRecord } from '../../core/extraction/record'
import { validate } from '../../core/extraction/validate'
import type { Extractor, ExtractionRequest, ExtractionResult } from '../../core/ports/extractor'

/**
 * The extraction provider, reached over its REST API.
 *
 * This is the only file that knows the provider's request shape, and the only
 * place it is constructed. Everything above sees `core/ports/extractor.ts` —
 * this project's record vocabulary and a refusal, never a vendor envelope.
 *
 * **No SDK.** `responseMimeType` and `responseSchema` are plain body fields, so
 * an SDK would buy typed construction and retry at the cost of a dependency on
 * the data plane. Timeouts and error mapping are written here instead, as they
 * were for object storage.
 *
 * Three properties are load-bearing and each has a test that fails without it:
 *
 * **The origin is pinned in code.** Not read from the environment, because an
 * environment-configurable origin plus an attached credential is an
 * exfiltration primitive rather than a configuration option. The *model* is
 * configurable; where the request goes is not.
 *
 * **Redirects are refused.** The request carries the credential, and `fetch`
 * follows 3xx by default — straight to whatever host the `Location` names.
 *
 * **The timeout aborts.** Story 1.4 shipped a `requestTimeout` that logged a
 * warning and let the request continue: a bound that announces the breach and
 * then does nothing, which is worse than no bound because it reads like one.
 */

/** Pinned. Deliberately not configurable — see the note above. */
const ORIGIN = 'https://generativelanguage.googleapis.com'

const REQUIRED_VARS = ['GEMINI_API_KEY', 'GEMINI_OCR_MODEL'] as const

/**
 * Generous for a page of figures, and far below what would strain the process.
 * Bounded while reading rather than after: a cap applied to an already-buffered
 * body has paid for the allocation it exists to prevent — the mistake made, and
 * caught in review, on the workbook decoder in story 1.5b.
 */
export const MAX_REPLY_BYTES = 2_000_000

/** A whole request, not a socket idle gap. A scan is seconds, not minutes. */
const DEFAULT_TIMEOUT_MS = 60_000

/** Retrying these can succeed; the document is not at fault. */
const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504])


/**
 * The schema the provider is held to, **derived** from the record vocabulary.
 *
 * AD-9 requires conformance enforced at the extractor's API layer, not only
 * after the reply lands. Both halves are needed and neither substitutes for the
 * other: the schema stops the provider inventing a shape, and the revalidation
 * below survives a provider that ignores it.
 *
 * Every enum and bound here reads from `core/extraction/record.ts`. Writing them
 * out again would make this a third copy of a shape already stated in that file
 * and in migration 006, and drift is silent in both directions — a schema
 * permitting more than the validator makes every document unreadable, one
 * permitting less throws away figures without saying so. Story 1.5 met the same
 * problem between the vocabulary and the SQL and answered it the same way.
 *
 * The format is the provider's OpenAPI subset, which is why it is built here
 * rather than in `core/` — the shape is ours, the notation is theirs.
 */
function responseSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      records: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            documentKind: { type: 'string', enum: [...DOCUMENT_KINDS] },
            vendorName: { type: 'string', maxLength: VENDOR_NAME_MAX_LENGTH, nullable: true },
            documentNumber: {
              type: 'string',
              maxLength: DOCUMENT_NUMBER_MAX_LENGTH,
              nullable: true,
            },
            issuedOn: { type: 'string', format: 'date', nullable: true },
            totalAmount: {
              type: 'string',
              // The canonical pattern, not a restatement of it. Written by hand
              // here it was silently wrong: a template literal swallowed the
              // backslashes, so the provider was sent `^-?d{1,12}(.d{1,2})?$` —
              // which rejects `1450.00` and accepts `d.d`.
              pattern: AMOUNT_PATTERN,
              nullable: true,
            },
            currency: { type: 'string', enum: [...SUPPORTED_CURRENCIES] },
            // The unit a deposit line pays for, and null on everything else.
            //
            // Absent from the schema means absent from the answer: structured
            // output returns the schema it was given, not the one the record
            // type wishes it had. Story 2.4 added this field to the record and
            // the validator without adding it here, so it was null on every
            // document a provider ever read.
            //
            // Not in `required` — most documents name no unit, and `validate`
            // refuses a reference on any kind but `deposit`.
            unitReference: {
              type: 'string',
              maxLength: UNIT_REFERENCE_MAX_LENGTH,
              nullable: true,
            },
          },
          // Exactly the two columns migration 006 declares `not null`.
          required: ['documentKind', 'currency'],
        },
      },
    },
    required: ['records'],
  }
}

export class MissingExtractionConfigError extends Error {
  override readonly name = 'MissingExtractionConfigError'

  constructor(readonly missing: readonly string[]) {
    // Names only. A configuration error is the one most likely to be pasted
    // into an issue, so it must never echo a value.
    super(
      `Document extraction is not configured: ${missing.join(', ')} ${
        missing.length === 1 ? 'is' : 'are'
      } missing. Copy .env.example to .env.local and fill in the values.`,
    )
  }
}

export interface GeminiExtractorOptions {
  /** Defaults to `process.env`, read at call time — never at construction. */
  readonly env?: Readonly<Record<string, string | undefined>>
  /** Injected by tests; production uses the platform `fetch`. */
  readonly fetch?: typeof globalThis.fetch
  readonly timeoutMs?: number
}

interface ExtractionConfig {
  readonly apiKey: string
  readonly model: string
}

function readConfig(env: Readonly<Record<string, string | undefined>>): ExtractionConfig {
  // Every missing name at once. Configuring two variables one failed deploy at
  // a time is a slow way to learn the second one.
  const missing = REQUIRED_VARS.filter((name) => !env[name]?.trim())

  if (missing.length > 0) throw new MissingExtractionConfigError(missing)

  return { apiKey: env.GEMINI_API_KEY!.trim(), model: env.GEMINI_OCR_MODEL!.trim() }
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

class ExtractionAborted extends Error {
  override readonly name = 'ExtractionAborted'
}

/**
 * Race a promise against the deadline, **removing the listener either way**.
 *
 * The obvious version of this attaches a fresh `abort` listener per call and
 * leaves it attached when the other branch wins. `MAX_REPLY_BYTES` bounds bytes,
 * not chunks, so a perfectly ordinary reply arriving in small chunks would
 * retain one listener and one pending promise per chunk — a leak proportional to
 * how the provider happened to frame its response. Found in review of the fix
 * that introduced it.
 */
export function raceAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new ExtractionAborted())

  let onAbort: (() => void) | undefined

  const deadline = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new ExtractionAborted())
    signal.addEventListener('abort', onAbort, { once: true })
  })

  return Promise.race([work, deadline]).finally(() => {
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort)
  })
}

/**
 * Read at most `MAX_REPLY_BYTES`, and refuse rather than truncate.
 *
 * Truncating would hand the parser a prefix of valid JSON, which fails as
 * "invalid" and blames the document for a limit this code chose.
 */
async function readBounded(response: Response, signal: AbortSignal): Promise<string | null> {
  const body = response.body

  if (body === null) return await raceAbort(response.text(), signal)

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  try {
    for (;;) {
      // Raced rather than awaited. A provider can answer with headers promptly
      // and then drip the body, and an injected `fetch` may hand back a stream
      // that is not wired to the abort signal at all — so the deadline is
      // observed here explicitly instead of being assumed.
      const { done, value } = await raceAbort(reader.read(), signal)
      if (done) break
      if (value === undefined) continue

      total += value.byteLength
      if (total > MAX_REPLY_BYTES) {
        await reader.cancel().catch(() => undefined)
        return null
      }

      chunks.push(value)
    }
  } catch (error) {
    // Cancel, then release. Releasing the lock alone leaves a stream that
    // ignores the fetch signal still producing into a reader nobody reads —
    // the deadline would have stopped waiting without stopping the work.
    await reader.cancel().catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }

  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }

  return new TextDecoder().decode(joined)
}

/** The provider wraps its JSON answer in a candidate envelope. */
function unwrap(text: string): unknown {
  const envelope: unknown = JSON.parse(text)

  if (typeof envelope !== 'object' || envelope === null) return undefined

  const candidates = (envelope as { candidates?: unknown }).candidates
  if (!Array.isArray(candidates) || candidates.length === 0) return undefined

  const parts = (candidates[0] as { content?: { parts?: unknown } })?.content?.parts
  if (!Array.isArray(parts) || parts.length === 0) return undefined

  const inner = (parts[0] as { text?: unknown })?.text
  if (typeof inner !== 'string') return undefined

  return JSON.parse(inner)
}

/**
 * All-or-nothing across the set, exactly as the tabular path is.
 *
 * A statement read half-correctly and stored as if complete is worse than one
 * refused: the treasurer has no way to see which half.
 */
function validateAll(payload: unknown): readonly ExtractionRecord[] | null {
  if (typeof payload !== 'object' || payload === null) return null

  const records = (payload as { records?: unknown }).records
  if (!Array.isArray(records)) return null

  // An empty collection is not an empty success. 1.5b's repository refuses an
  // empty set, and reaching it would report a content problem as an outage.
  if (records.length === 0) return null

  const validated: ExtractionRecord[] = []

  for (const candidate of records) {
    const result = validate(candidate)
    if (!result.ok) return null
    validated.push(result.record)
  }

  return validated
}

export function createGeminiExtractor(options: GeminiExtractorOptions = {}): Extractor {
  const doFetch = options.fetch ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return {
    async extract(request: ExtractionRequest): Promise<ExtractionResult> {
      // Read at call time, so constructing this adapter needs no secrets and
      // `next build` can evaluate the module.
      const config = readConfig(options.env ?? process.env)

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)

      let response: Response

      try {
        response = await doFetch(
          `${ORIGIN}/v1beta/models/${encodeURIComponent(config.model)}:generateContent`,
          {
            method: 'POST',
            // In a header, never the query string: a key in a URL lands in
            // access logs, proxy logs and error reports.
            headers: {
              'content-type': 'application/json',
              'x-goog-api-key': config.apiKey,
            },
            redirect: 'manual',
            signal: controller.signal,
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    {
                      inline_data: {
                        mime_type: request.mediaType,
                        data: toBase64(request.bytes),
                      },
                    },
                  ],
                },
              ],
              generationConfig: {
                responseMimeType: 'application/json',
                responseSchema: responseSchema(),
              },
            }),
          },
        )
      } catch {
        // Deliberately not inspecting the error. A transport error can carry the
        // request — headers included — and this is the path where the credential
        // would escape into a result or a log.
        clearTimeout(timer)
        return { ok: false, refusal: 'unavailable' }
      }

      // The timer deliberately stays armed past this point. Clearing it as soon
      // as `fetch` resolved left the body read below with no bound at all, so a
      // provider that answered with headers and then dripped the body hung for
      // as long as the socket did. The deadline covers the whole exchange.
      try {
        // `redirect: 'manual'` surfaces 3xx as a response rather than following
        // it. Treating it as a refusal is the point: the alternative is handing
        // the credential to whatever host the Location names.
        if (response.status >= 300 && response.status < 400) {
          return { ok: false, refusal: 'invalid' }
        }

        if (!response.ok) {
          return {
            ok: false,
            refusal: RETRYABLE_STATUSES.has(response.status) ? 'unavailable' : 'invalid',
          }
        }

        let text: string | null
        try {
          text = await readBounded(response, controller.signal)
        } catch (error) {
          // A deadline is the provider failing to answer, which is retryable and
          // not the document's fault. Anything else read as a malformed body.
          return {
            ok: false,
            refusal: error instanceof ExtractionAborted ? 'unavailable' : 'invalid',
          }
        }

        if (text === null) return { ok: false, refusal: 'invalid' }

        let payload: unknown
        try {
          payload = unwrap(text)
        } catch {
          // Malformed or truncated JSON. Never rethrown: the body can contain the
          // request that produced it.
          return { ok: false, refusal: 'invalid' }
        }

        const records = validateAll(payload)
        if (records === null) return { ok: false, refusal: 'invalid' }

        return { ok: true, records }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
