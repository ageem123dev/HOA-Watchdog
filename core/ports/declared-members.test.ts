/**
 * The member reader the port tests depend on, tested against the ways it has
 * actually been wrong.
 *
 * Every case below is a defect that existed rather than one imagined: two in the
 * five copies this file replaces, and two found by review on the day it was
 * extracted. A helper that port tests trust to prove an absence has to be held
 * to the same standard as the ports.
 */

import { describe, expect, it } from 'vitest'

import { InterfaceNotFoundError, declaredMembers } from './declared-members'

describe('reading an interface body', () => {
  it('returns each member as a line, whatever syntax it uses', () => {
    const source = [
      'export interface Example {',
      '  read(id: string): Promise<string>',
      '  readonly write: (id: string) => Promise<void>',
      '}',
    ].join('\n')

    expect(declaredMembers(source, 'Example')).toEqual([
      'read(id: string): Promise<string>',
      'readonly write: (id: string) => Promise<void>',
    ])
  })

  it('returns nothing for an interface that genuinely declares nothing', () => {
    expect(declaredMembers('export interface Empty {\n}\n', 'Empty')).toEqual([])
  })

  /**
   * The bug that made this file's own extraction fail on its first run: `indexOf`
   * does not know where an identifier ends, so `QueryLog` matched
   * `QueryLogEntry` and the port test read a neighbouring interface's body.
   */
  it('does not match an interface whose name merely starts with the one asked for', () => {
    const source = [
      'export interface ThingEntry {',
      '  readonly a: string',
      '}',
      'export interface Thing {',
      '  only(): void',
      '}',
    ].join('\n')

    expect(declaredMembers(source, 'Thing')).toEqual(['only(): void'])
  })

  /**
   * Comments are removed by the same pass that counts braces. Stripping `//`
   * with a global regex first eats the closing quote of any string literal
   * containing one, and the brace matcher then reads the rest of the file as one
   * long string — returning nothing, from an interface that declares something.
   */
  it('keeps a string literal that contains a comment marker', () => {
    const source = [
      'export interface Example {',
      "  endpoint(url: 'https://example.com/x'): void",
      '  second(): void',
      '}',
    ].join('\n')

    expect(declaredMembers(source, 'Example')).toEqual([
      "endpoint(url: 'https://example.com/x'): void",
      'second(): void',
    ])
  })

  it('removes line and block comments, including a member commented out', () => {
    const source = [
      'export interface Example {',
      '  /** A doc comment. */',
      '  kept(): void // trailing',
      '  // removed(): void',
      '}',
    ].join('\n')

    expect(declaredMembers(source, 'Example')).toEqual(['kept(): void'])
  })

  /**
   * The brace matcher's own control. An unmatched brace inside a string literal
   * type desyncs a naive depth counter and truncates the member list — which
   * shipped in story 2.1's version of this and was found by review.
   */
  it('is not desynced by an unmatched brace inside a string literal', () => {
    const source = [
      'export interface Example {',
      "  closing(sep: '}'): void",
      '  second(): void',
      '}',
    ].join('\n')

    expect(declaredMembers(source, 'Example')).toEqual(["closing(sep: '}'): void", 'second(): void'])
  })

  it('reads nested object types as the lines they are, without stopping early', () => {
    const source = [
      'export interface Example {',
      '  nested: { a: string; b: string }',
      '  after(): void',
      '}',
    ].join('\n')

    expect(declaredMembers(source, 'Example')).toEqual([
      'nested: { a: string; b: string }',
      'after(): void',
    ])
  })

  /**
   * The declaration lookup reads the masked copy, not the raw text. Searching
   * the raw text finds a commented-out or quoted `interface Foo {` first, and
   * the body scan then runs from there — so a port test would inspect a fake
   * body and keep passing after the real contract regressed. This survived the
   * fix that made the *body* scan comment-aware, because the lookup positioning
   * it was left naive.
   */
  describe('declarations that are not declarations', () => {
    it('skips a commented-out declaration and finds the real one', () => {
      const source = [
        '// export interface Example {',
        '//   forged(): void',
        '// }',
        'export interface Example {',
        '  real(): void',
        '}',
      ].join('\n')

      expect(declaredMembers(source, 'Example')).toEqual(['real(): void'])
    })

    it('skips a declaration inside a block comment', () => {
      const source = [
        '/**',
        ' * export interface Example {',
        ' *   forged(): void',
        ' * }',
        ' */',
        'export interface Example {',
        '  real(): void',
        '}',
      ].join('\n')

      expect(declaredMembers(source, 'Example')).toEqual(['real(): void'])
    })

    it('skips a declaration quoted inside a string literal', () => {
      const source = [
        'const sample = "export interface Example { forged(): void }"',
        'export interface Example {',
        '  real(): void',
        '}',
      ].join('\n')

      expect(declaredMembers(source, 'Example')).toEqual(['real(): void'])
    })

    /**
     * The case that actually discriminates, and the three above do not.
     *
     * With the declaration searched in the **raw** text, `start` lands on the
     * fake — but the following `indexOf('{')` reads the *masked* copy, where the
     * fake's brace is blanked, so it skips forward and recovers the real body by
     * accident. Every commented-out case still passes. Put an unrelated brace
     * between the fake and the real declaration and the recovery stops: the scan
     * locks onto `{ a: string }` and reports its contents as the port's members.
     *
     * Found by mutating `masked.search` to `text.search` and watching the other
     * three cases stay green — a test that cannot fail for the reason it exists
     * is the thing this file is otherwise built to catch.
     */
    it('is not fooled by a fake declaration with an unrelated brace after it', () => {
      const source = [
        '// export interface Example {',
        'type Other = { a: string }',
        'export interface Example {',
        '  real(): void',
        '}',
      ].join('\n')

      expect(declaredMembers(source, 'Example')).toEqual(['real(): void'])
    })

    it('throws when the only declaration is a fake one', () => {
      const source = ['// export interface Example {', '//   forged(): void', '// }'].join('\n')

      expect(() => declaredMembers(source, 'Example')).toThrow(InterfaceNotFoundError)
    })
  })

  /**
   * A missing interface used to return `[]`, which is also what an empty one
   * returns — so `toEqual([])`, the assertion these tests exist to make, passed
   * for a typo.
   */
  describe('failing loudly rather than returning nothing', () => {
    it('throws when the interface is not declared at all', () => {
      expect(() => declaredMembers('nothing here', 'Example')).toThrow(InterfaceNotFoundError)
      expect(() => declaredMembers('nothing here', 'Example')).toThrow(/Example/)
    })

    it('throws when the body is never closed', () => {
      expect(() => declaredMembers('export interface Example {\n  a(): void\n', 'Example')).toThrow(
        /closing brace/,
      )
    })
  })
})
