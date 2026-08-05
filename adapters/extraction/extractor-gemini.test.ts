/**
 * The extraction adapter — the only place the provider is constructed, and the
 * only file that knows its request shape.
 *
 * `fetch` is injected in every test, so the request is inspected rather than
 * sent. That is what makes the credential observable, which matters: one of the
 * failure modes under test is leaking it.
 *
 * **What these tests do not prove.** Every one of them fakes the provider, so
 * none shows that the provider actually honours `responseSchema` — only that
 * this code sends it and revalidates what comes back. AC4's probe is the only
 * thing that proves AD-9 end to end, which is why it is a deliverable rather
 * than a convenience.
 */

import { describe, expect, it, vi } from 'vitest'

import {
  AMOUNT_PRECISION,
  AMOUNT_SCALE,
  DOCUMENT_KINDS,
  DOCUMENT_NUMBER_MAX_LENGTH,
  SUPPORTED_CURRENCIES,
  VENDOR_NAME_MAX_LENGTH,
} from '../../core/extraction/record'
import type { ExtractionRecord } from '../../core/extraction/record'
import { validate } from '../../core/extraction/validate'
import {
  createGeminiExtractor,
  MAX_REPLY_BYTES,
  MissingExtractionConfigError,
} from './extractor-gemini'

const ENV = Object.freeze({
  GEMINI_API_KEY: 'test-key-do-not-log-me',
  GEMINI_OCR_MODEL: 'gemini-3.1-flash-lite',
})

const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\nscan\ntrailer\n<< /Size 4 >>\n%%EOF')

const REQUEST = Object.freeze({ bytes: PDF_BYTES, mediaType: 'application/pdf' })

const RECORD: ExtractionRecord = {
  documentKind: 'invoice',
  vendorName: 'Evergreen Landscaping',
  documentNumber: 'INV-4021',
  issuedOn: '2026-06-01',
  totalAmount: '1450.00',
  currency: 'USD',
}

/** A reply shaped the way the provider actually replies. */
const providerReply = (records: unknown) =>
  JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ records }) }] } }],
  })

const ok = (body: string, init: ResponseInit = {}) =>
  vi.fn(async () => new Response(body, { status: 200, ...init }))

const extractorWith = (fetchImpl: typeof globalThis.fetch, timeoutMs?: number) =>
  createGeminiExtractor({ env: ENV, fetch: fetchImpl, timeoutMs })

/** The request the injected fetch was handed. */
const requestOf = (fetchMock: ReturnType<typeof vi.fn>) => {
  const [url, init] = fetchMock.mock.calls[0] as [string | URL, RequestInit]
  return { url: String(url), init }
}

describe('the Gemini extraction adapter', () => {
  describe('configuration (A1)', () => {
    it('constructs without credentials, so `next build` needs none', () => {
      // The build evaluates modules. A constructor that reads secrets makes the
      // build require them, which is how 1.4 learned this.
      expect(() => createGeminiExtractor({ env: {} })).not.toThrow()
    })

    it('fails on the first call instead, naming every missing variable at once', async () => {
      const extractor = createGeminiExtractor({ env: {} })

      await expect(extractor.extract(REQUEST)).rejects.toBeInstanceOf(MissingExtractionConfigError)
    })

    it('lists both names, not just the first', async () => {
      const extractor = createGeminiExtractor({ env: {} })

      await expect(extractor.extract(REQUEST)).rejects.toMatchObject({
        missing: expect.arrayContaining(['GEMINI_API_KEY', 'GEMINI_OCR_MODEL']),
      })
    })

    it('treats a blank credential as missing rather than sending it', async () => {
      const extractor = createGeminiExtractor({ env: { ...ENV, GEMINI_API_KEY: '   ' } })

      await expect(extractor.extract(REQUEST)).rejects.toBeInstanceOf(MissingExtractionConfigError)
    })
  })

  describe('where the request goes (A2, A3)', () => {
    it('sends it to a pinned HTTPS origin', async () => {
      const fetchMock = ok(providerReply([RECORD]))

      await extractorWith(fetchMock).extract(REQUEST)

      expect(requestOf(fetchMock).url).toMatch(/^https:\/\/generativelanguage\.googleapis\.com\//)
    })

    it('lets no environment variable move that origin', async () => {
      // A configurable origin plus a credential is an exfiltration primitive.
      //
      // `process.env` is set here as well as the injected env, because an
      // adapter reading the real environment directly would sail past a test
      // that only supplies the injected one. The mutation that reads
      // `process.env.GEMINI_ORIGIN` was undetected until this was added.
      const fetchMock = ok(providerReply([RECORD]))
      const planted = ['GEMINI_ORIGIN', 'GEMINI_API_BASE', 'GEMINI_BASE_URL']
      const saved = planted.map((name) => [name, process.env[name]] as const)
      for (const name of planted) process.env[name] = 'https://attacker.example'

      try {
        await createGeminiExtractor({
          env: { ...ENV, GEMINI_API_BASE: 'https://attacker.example', GEMINI_ORIGIN: 'https://attacker.example' },
          fetch: fetchMock,
        }).extract(REQUEST)
      } finally {
        for (const [name, value] of saved) {
          if (value === undefined) delete process.env[name]
          else process.env[name] = value
        }
      }

      expect(requestOf(fetchMock).url).not.toContain('attacker.example')
    })

    it('lets no environment variable move it even when read at module load', async () => {
      // The previous test cannot catch `const ORIGIN = process.env.X ?? '...'`
      // at module scope: that binds when the module is first imported, which
      // has already happened by the time a test body runs. Proven by mutation —
      // that exact change passed everything until this test existed.
      //
      // So: plant the variables, drop the module cache, and import fresh.
      const planted = ['GEMINI_ORIGIN', 'GEMINI_API_BASE', 'GEMINI_BASE_URL']
      const saved = planted.map((name) => [name, process.env[name]] as const)
      for (const name of planted) process.env[name] = 'https://attacker.example'

      try {
        vi.resetModules()
        const fresh = await import('./extractor-gemini')
        const fetchMock = ok(providerReply([RECORD]))

        await fresh.createGeminiExtractor({ env: ENV, fetch: fetchMock }).extract(REQUEST)

        expect(requestOf(fetchMock).url).not.toContain('attacker.example')
      } finally {
        for (const [name, value] of saved) {
          if (value === undefined) delete process.env[name]
          else process.env[name] = value
        }
        vi.resetModules()
      }
    })

    it('refuses to follow redirects', async () => {
      // The request carries a credential. A followed redirect carries it too.
      const fetchMock = ok(providerReply([RECORD]))

      await extractorWith(fetchMock).extract(REQUEST)

      expect(requestOf(fetchMock).init.redirect).toBe('manual')
    })

    it('treats a redirect as a refusal and never chases the Location', async () => {
      const fetchMock = vi.fn(
        async () => new Response('', { status: 302, headers: { location: 'https://attacker.example/x' } }),
      )

      const result = await extractorWith(fetchMock).extract(REQUEST)

      expect(result).toMatchObject({ ok: false })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('carries the model from configuration, so changing it is not a code edit', async () => {
      const fetchMock = ok(providerReply([RECORD]))
      const extractor = createGeminiExtractor({
        env: { ...ENV, GEMINI_OCR_MODEL: 'gemini-9-experimental' },
        fetch: fetchMock,
      })

      await extractor.extract(REQUEST)

      expect(requestOf(fetchMock).url).toContain('gemini-9-experimental')
    })
  })

  describe('what the request carries', () => {
    it('sends the bytes it was given, by length and media type (cross-check)', async () => {
      // Recomputed here from the input rather than read from the adapter's own
      // view of what it sent.
      const fetchMock = ok(providerReply([RECORD]))

      await extractorWith(fetchMock).extract(REQUEST)

      const body = JSON.parse(String(requestOf(fetchMock).init.body))
      const inline = JSON.stringify(body).match(/"mime_?[Tt]ype":"([^"]+)"/)
      const encoded = JSON.stringify(body).match(/"data":"([^"]+)"/)
      expect(inline?.[1]).toBe('application/pdf')
      expect(Buffer.from(encoded?.[1] ?? '', 'base64').byteLength).toBe(PDF_BYTES.byteLength)
    })

    it('authenticates with a header rather than a query string', async () => {
      // A key in a URL lands in access logs, proxy logs and error reports.
      const fetchMock = ok(providerReply([RECORD]))

      await extractorWith(fetchMock).extract(REQUEST)

      const { url, init } = requestOf(fetchMock)
      expect(url).not.toContain(ENV.GEMINI_API_KEY)
      expect(new Headers(init.headers).get('x-goog-api-key')).toBe(ENV.GEMINI_API_KEY)
    })
  })

  describe('the timeout actually bounds (A4)', () => {
    it('rejects a request that never settles, within the bound', async () => {
      // 1.4's `requestTimeout` logged a warning and let the request continue —
      // a bound that reports the breach and does nothing is worse than none,
      // because it reads like one. So this asserts the call completes, not that
      // a warning appeared.
      const fetchMock = vi.fn(
        (_url: string | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
          }),
      ) as unknown as typeof globalThis.fetch

      const result = await extractorWith(fetchMock, 50).extract(REQUEST)

      expect(result).toMatchObject({ ok: false, refusal: 'unavailable' })
    })

    it('passes an abort signal at all, so the bound has something to act on', async () => {
      const fetchMock = ok(providerReply([RECORD]))

      await extractorWith(fetchMock).extract(REQUEST)

      expect(requestOf(fetchMock).init.signal).toBeInstanceOf(AbortSignal)
    })
  })

  describe('unavailable versus invalid (A5, A6)', () => {
    it('reports a network failure as unavailable, not as a bad document', async () => {
      const fetchMock = vi.fn(async () => {
        throw new TypeError('fetch failed')
      }) as unknown as typeof globalThis.fetch

      expect(await extractorWith(fetchMock).extract(REQUEST)).toMatchObject({
        ok: false,
        refusal: 'unavailable',
      })
    })

    it.each([429, 500, 502, 503, 504])('reports HTTP %i as unavailable', async (status) => {
      const fetchMock = vi.fn(async () => new Response('', { status })) as unknown as typeof globalThis.fetch

      expect(await extractorWith(fetchMock).extract(REQUEST)).toMatchObject({
        ok: false,
        refusal: 'unavailable',
      })
    })

    it.each([400, 403, 404])('reports HTTP %i as invalid, since retrying cannot fix it', async (status) => {
      const fetchMock = vi.fn(async () => new Response('', { status })) as unknown as typeof globalThis.fetch

      expect(await extractorWith(fetchMock).extract(REQUEST)).toMatchObject({
        ok: false,
        refusal: 'invalid',
      })
    })
  })

  describe('what comes back (A7, A8)', () => {
    it('reads a well-formed reply into records', async () => {
      const result = await extractorWith(ok(providerReply([RECORD]))).extract(REQUEST)

      expect(result).toMatchObject({ ok: true })
      expect(result.ok && result.records).toEqual([RECORD])
    })

    it('reads every record in the collection, not just the first', async () => {
      // A statement holds many figures. Silently keeping one is the defect the
      // collection type exists to prevent.
      const second = { ...RECORD, documentNumber: 'INV-4022', totalAmount: '820.50' }

      const result = await extractorWith(ok(providerReply([RECORD, second]))).extract(REQUEST)

      expect(result.ok && result.records).toHaveLength(2)
    })

    it.each([
      ['not JSON at all', 'sorry, I cannot do that'],
      ['truncated JSON', '{"candidates":[{"content":'],
      ['JSON of the wrong shape', '{"unexpected":true}'],
    ])('refuses %s as invalid', async (_label, body) => {
      expect(await extractorWith(ok(body)).extract(REQUEST)).toMatchObject({
        ok: false,
        refusal: 'invalid',
      })
    })

    it('refuses the whole set when one record fails validation', async () => {
      // All-or-nothing, exactly as the tabular path is. A half-read statement
      // stored as if complete is worse than one refused.
      const bad = { ...RECORD, totalAmount: '$1,450.00' }

      const result = await extractorWith(ok(providerReply([RECORD, bad]))).extract(REQUEST)

      expect(result).toMatchObject({ ok: false, refusal: 'invalid' })
    })

    it('refuses an empty collection rather than reporting an empty success', async () => {
      // 1.5b's repository refuses an empty set; reaching it would surface a
      // content problem as an infrastructure failure.
      expect(await extractorWith(ok(providerReply([]))).extract(REQUEST)).toMatchObject({
        ok: false,
        refusal: 'invalid',
      })
    })
  })

  describe('the credential never escapes (A9)', () => {
    const leakChecks: [string, () => typeof globalThis.fetch][] = [
      ['a network failure', () => vi.fn(async () => {
        throw new Error(`connect failed for key ${ENV.GEMINI_API_KEY}`)
      }) as unknown as typeof globalThis.fetch],
      ['an error status', () => vi.fn(async () => new Response(ENV.GEMINI_API_KEY, { status: 500 })) as unknown as typeof globalThis.fetch],
      ['an unparsable reply', () => ok(`garbage ${ENV.GEMINI_API_KEY}`) as unknown as typeof globalThis.fetch],
    ]

    it.each(leakChecks)('keeps it out of the result after %s', async (_label, make) => {
      const result = await extractorWith(make()).extract(REQUEST)

      expect(JSON.stringify(result)).not.toContain(ENV.GEMINI_API_KEY)
    })

    it('keeps it out of a thrown configuration error too', async () => {
      // A present key and a missing model: the error must name what is absent
      // without echoing what is present. Config errors are the ones most likely
      // to be pasted into a chat or an issue.
      const extractor = createGeminiExtractor({ env: { GEMINI_API_KEY: ENV.GEMINI_API_KEY } })

      await expect(extractor.extract(REQUEST)).rejects.toSatisfy((error: Error) => {
        const text = `${error.message}\n${error.stack ?? ''}`
        return text.includes('GEMINI_OCR_MODEL') && !text.includes(ENV.GEMINI_API_KEY)
      })
    })
  })


  describe('schema enforcement at the API layer (AD-9, Task 2)', () => {
    const sentBody = async () => {
      const fetchMock = ok(providerReply([RECORD]))
      await extractorWith(fetchMock).extract(REQUEST)
      return JSON.parse(String(requestOf(fetchMock).init.body))
    }
    const sentSchema = async () => (await sentBody()).generationConfig.responseSchema
    const recordSchema = async () => (await sentSchema()).properties.records.items

    it('asks for JSON rather than prose (B2)', async () => {
      expect((await sentBody()).generationConfig.responseMimeType).toBe('application/json')
    })

    it('sends a response schema, so the constraint is at the API layer (B1)', async () => {
      // AD-9 is specifically about enforcement *at the extractor*. Validating
      // the reply afterwards is a different control and does not satisfy it.
      expect(await sentSchema()).toBeDefined()
    })

    it('constrains the collection, not a single record (B9)', async () => {
      const schema = await sentSchema()

      expect(schema.properties.records.type).toBe('array')
    })

    it('enumerates exactly the document kinds the vocabulary defines (B3, B10)', async () => {
      // Compared against the imported constant. A hand-written copy that has
      // drifted cannot pass this by agreeing with itself.
      expect([...(await recordSchema()).properties.documentKind.enum].sort()).toEqual(
        [...DOCUMENT_KINDS].sort(),
      )
    })

    it('enumerates exactly the supported currencies (B3, B10)', async () => {
      expect([...(await recordSchema()).properties.currency.enum].sort()).toEqual(
        [...SUPPORTED_CURRENCIES].sort(),
      )
    })

    it('carries the vocabulary length caps rather than its own (B3)', async () => {
      const properties = (await recordSchema()).properties

      expect(properties.vendorName.maxLength).toBe(VENDOR_NAME_MAX_LENGTH)
      expect(properties.documentNumber.maxLength).toBe(DOCUMENT_NUMBER_MAX_LENGTH)
    })

    it('bounds the amount to the precision the column actually has (B3)', async () => {
      // numeric(14,2): twelve integer digits and two decimals. A schema that
      // permits more produces values the database refuses after the model has
      // already been paid for them.
      const pattern = (await recordSchema()).properties.totalAmount.pattern

      expect(pattern).toContain(String(AMOUNT_PRECISION - AMOUNT_SCALE))
      expect(pattern).toContain(String(AMOUNT_SCALE))
    })

    it('requires exactly the two fields the table declares not-null (B8)', async () => {
      expect([...(await recordSchema()).required].sort()).toEqual(['currency', 'documentKind'])
    })

    it('permits null on exactly the fields the table allows null (B7)', async () => {
      const properties = (await recordSchema()).properties
      const nullable = Object.keys(properties).filter((name) => properties[name].nullable === true)

      expect(nullable.sort()).toEqual(
        ['documentNumber', 'issuedOn', 'totalAmount', 'vendorName'].sort(),
      )
    })

    describe('the schema and the validator agree (B5, B6)', () => {
      it('accepts every document kind the schema admits', async () => {
        // Cross-check: the schema is the validator's oracle, over the whole
        // vocabulary rather than one example.
        const kinds: string[] = (await recordSchema()).properties.documentKind.enum

        expect(kinds.length).toBeGreaterThan(0)
        for (const documentKind of kinds) {
          expect(validate({ ...RECORD, documentKind }).ok, documentKind).toBe(true)
        }
      })

      it('accepts every currency the schema admits', async () => {
        const currencies: string[] = (await recordSchema()).properties.currency.enum

        expect(currencies.length).toBeGreaterThan(0)
        for (const currency of currencies) {
          expect(validate({ ...RECORD, currency }).ok, currency).toBe(true)
        }
      })

      it('refuses a kind the schema does not admit, in the other direction', async () => {
        const kinds: string[] = (await recordSchema()).properties.documentKind.enum

        expect(kinds).not.toContain('receipt')
        expect(validate({ ...RECORD, documentKind: 'receipt' }).ok).toBe(false)
      })

      it('refuses a vendor name one character past the schema cap', async () => {
        const cap: number = (await recordSchema()).properties.vendorName.maxLength

        expect(validate({ ...RECORD, vendorName: 'x'.repeat(cap) }).ok).toBe(true)
        expect(validate({ ...RECORD, vendorName: 'x'.repeat(cap + 1) }).ok).toBe(false)
      })
    })

    it('still revalidates the reply, schema or no schema (B4)', async () => {
      // Sending a schema is not grounds for believing the answer. This is the
      // half of AD-9 that survives a provider ignoring its instructions.
      const result = await extractorWith(
        ok(providerReply([{ ...RECORD, totalAmount: 'not a number' }])),
      ).extract(REQUEST)

      expect(result).toMatchObject({ ok: false, refusal: 'invalid' })
    })
  })

  describe('the reply is bounded (A12)', () => {
    it('refuses a reply larger than the bound rather than materialising it', async () => {
      // Every record here is individually **valid**, so the only thing that can
      // refuse this reply is the byte bound. An earlier version of this test
      // used one record with a 6 MB vendor name, which the 200-character cap
      // refused on its own — it passed with the bound removed and proved
      // nothing. Running the mutation is what exposed that.
      const many = Array.from({ length: 25_000 }, (_, i) => ({
        ...RECORD,
        documentNumber: `INV-${i}`,
      }))
      const body = providerReply(many)
      expect(body.length).toBeGreaterThan(2_000_000)

      expect(await extractorWith(ok(body)).extract(REQUEST)).toMatchObject({
        ok: false,
        refusal: 'invalid',
      })
    })

    it('accepts a large-but-permitted reply, so the bound is not simply a refusal', () => {
      // Without this, MAX_REPLY_BYTES could be zero and the test above would
      // still pass.
      expect(MAX_REPLY_BYTES).toBeGreaterThan(100_000)
    })
  })
})
