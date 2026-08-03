import { describe, expect, it } from 'vitest'

import { STORAGE_KEY_PREFIX, storageKeyFor } from './storage-key'

const hashA = 'a'.repeat(64)
const hashB = `${'b'.repeat(63)}c`

describe('storageKeyFor', () => {
  it('derives the key from the content hash alone', () => {
    expect(storageKeyFor(hashA)).toBe(storageKeyFor(hashA))
  })

  it('gives different documents different keys', () => {
    expect(storageKeyFor(hashA)).not.toBe(storageKeyFor(hashB))
  })

  it('namespaces the key, so future object kinds cannot collide with documents', () => {
    expect(storageKeyFor(hashA).startsWith(STORAGE_KEY_PREFIX)).toBe(true)
    expect(STORAGE_KEY_PREFIX.length).toBeGreaterThan(0)
  })

  it('stays inside the length the database column accepts', () => {
    // document_storage_key_length allows 1..1024.
    expect(storageKeyFor(hashA).length).toBeLessThanOrEqual(1024)
  })

  it.each([
    ['a traversal attempt', '../../../etc/passwd'],
    ['an absolute path', '/etc/passwd'],
    ['an upper-case digest', 'A'.repeat(64)],
    ['a truncated digest', 'abc123'],
    ['a digest with a slash', `${'a'.repeat(63)}/`],
    ['an empty string', ''],
    ['a digest one character too long', 'a'.repeat(65)],
  ])('refuses %s rather than building a key from it', (_label, value) => {
    // The key is interpolated into an object path. A caller that passes
    // anything but a digest must fail here, not produce a key that escapes the
    // prefix.
    expect(() => storageKeyFor(value)).toThrow(TypeError)
  })
})
