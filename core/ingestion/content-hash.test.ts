/**
 * The content hash is the identity AD-13 turns on, so these tests are written
 * against an independent oracle rather than against the implementation.
 *
 * A hash function that hashes the wrong thing still returns a plausible
 * 64-character hex string. `hash(file.name)` instead of `hash(file.bytes)` gives
 * every document a distinct digest, duplicate detection silently never fires,
 * and nothing anywhere reports an error. Same-input-same-output tests all pass.
 * That failure is only visible against a known-answer vector or a second
 * implementation, so both are used here.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { contentHash } from './content-hash'

const utf8 = (text: string) => new TextEncoder().encode(text)

/**
 * NIST FIPS 180-4 known-answer vectors. These are the independent oracle: they
 * were not produced by this code, so a self-consistent wrong implementation
 * cannot satisfy them.
 */
const KNOWN_ANSWERS: ReadonlyArray<readonly [string, string]> = [
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  [
    'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  ],
]

describe('contentHash', () => {
  describe('what it computes', () => {
    it.each(KNOWN_ANSWERS)(
      'matches the published SHA-256 vector for %j',
      (input, expected) => {
        expect(contentHash(utf8(input))).toBe(expected)
      },
    )

    it('agrees with an independent SHA-256 implementation on realistic bytes', async () => {
      // A second implementation, not a second call to the first one. If the
      // algorithm were wrong-but-consistent, this is what would catch it.
      const bytes = utf8('Operating statement, June 2026\nBalance: 41,207.18\n')
      const reference = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
      const expected = Array.from(reference, (b) => b.toString(16).padStart(2, '0')).join('')

      expect(contentHash(bytes)).toBe(expected)
    })

    it('produces the same digest for the same bytes', () => {
      const bytes = utf8('invoice')

      expect(contentHash(bytes)).toBe(contentHash(utf8('invoice')))
    })

    it('produces a different digest for a one-bit difference', () => {
      const original = new Uint8Array([0b0000_0000])
      const flipped = new Uint8Array([0b0000_0001])

      expect(contentHash(original)).not.toBe(contentHash(flipped))
    })

    it('depends on the bytes alone, so the same file under two names is one document', () => {
      // The signature takes no filename. This test states the property the
      // signature makes unrepresentable, so a later "convenience" parameter
      // that folds the name in has to break a test to get added.
      const bytes = utf8('%PDF-1.7 ledger')

      expect(contentHash(bytes)).toBe(contentHash(bytes.slice()))
    })

    it('does not carry state between calls', () => {
      // A hash object built once at module scope and reused makes digest N
      // depend on documents 1..N-1. Every single-call test still passes.
      const a = utf8('first document')
      const b = utf8('second document')

      const firstA = contentHash(a)
      contentHash(b)
      const secondA = contentHash(a)

      expect(secondA).toBe(firstA)
    })

    it('hashes exactly the bytes of a view, not its backing buffer', () => {
      // Node pools small Buffers, so a `subarray` routinely shares a backing
      // buffer with unrelated bytes. An implementation that reaches for
      // `.buffer` hashes those too, and only ever fails in production.
      const backing = utf8('PADDINGledger contentsPADDING')
      const view = backing.subarray(7, 7 + 'ledger contents'.length)

      expect(contentHash(view)).toBe(contentHash(utf8('ledger contents')))
    })

    it('handles a byte array larger than one internal chunk', () => {
      const large = new Uint8Array(1_000_000).fill(0x41)

      expect(contentHash(large)).toMatch(/^[0-9a-f]{64}$/)
    })
  })

  describe('the shape of what it returns', () => {
    it('returns lower-case hex, because the database accepts one spelling', () => {
      const digest = contentHash(utf8('anything'))

      expect(digest).toBe(digest.toLowerCase())
    })

    it('satisfies the constraint in migration 004, read from the migration itself', () => {
      // Two copies of a rule drift. The pattern is read out of the SQL rather
      // than restated here, so changing one without the other fails the build
      // instead of failing a board member's upload.
      const sql = readFileSync(
        join(process.cwd(), 'migrations', '004_document.sql'),
        'utf8',
      )
      const declared = /document_content_hash_is_sha256 check \(content_hash ~ '([^']+)'\)/.exec(sql)

      expect(declared, 'migration 004 no longer declares the hash-format constraint').not.toBeNull()

      const constraint = new RegExp(declared![1])
      expect(constraint.test(contentHash(utf8('a document')))).toBe(true)
    })
  })

  describe('what it refuses', () => {
    it('refuses a string, which is how a filename gets hashed instead of a file', () => {
      expect(() => contentHash('report.pdf' as unknown as Uint8Array)).toThrow(TypeError)
    })

    // These six pin a contract; they do not prove the guard. Removing the
    // `instanceof` check leaves all six passing, because Node's own `update()`
    // rejects them. The string case above is the one the guard exists for — it
    // is the only input Node accepts silently, and the only one that returns a
    // plausible digest of the wrong thing. Keeping these means a future
    // implementation that swaps the crypto backend still has to refuse them.
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['a bare ArrayBuffer', new ArrayBuffer(8)],
      ['a number', 42],
      ['an object', { bytes: [1, 2, 3] }],
      ['an array of numbers', [1, 2, 3]],
    ])('refuses %s', (_label, value) => {
      expect(() => contentHash(value as unknown as Uint8Array)).toThrow(TypeError)
    })

    it('accepts a Buffer, since that is what the runtime hands us', () => {
      // Buffer extends Uint8Array. A guard written as a constructor-name check
      // rather than an instanceof would refuse the one input we always get.
      expect(contentHash(Buffer.from('abc', 'utf8'))).toBe(KNOWN_ANSWERS[1][1])
    })
  })
})
