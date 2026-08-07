/**
 * The instrument every migration test depends on, tested on its own.
 *
 * These assertions are the control that each migration test file used to carry
 * inline, and could only carry for the one case it happened to think of. The
 * cases below are the ones the previous per-file version got wrong.
 */

import { describe, expect, it } from 'vitest'

import { executable } from './executable-sql'

describe('the executable part of a migration', () => {
  it('removes a whole-line comment', () => {
    expect(executable('-- create table decoy (\ncreate table unit (')).not.toMatch(/decoy/i)
    expect(executable('-- create table decoy (\ncreate table unit (')).toMatch(/create table unit/i)
  })

  it('removes a comment trailing a statement, and keeps the statement', () => {
    // The case the per-file version missed: it only dropped lines *starting*
    // with `--`, so a forbidden token in a trailing comment stayed in the text
    // the negative assertions matched against.
    const stripped = executable("grant select on unit to watchdog_reader; -- not insert, never insert")

    expect(stripped).toContain('grant select on unit to watchdog_reader;')
    expect(stripped).not.toMatch(/insert/i)
  })

  it('removes block comments, including nested ones', () => {
    // Postgres block comments nest, so matching to the first `*/` would leave
    // the tail of the outer comment behind.
    const stripped = executable('create table unit (\n/* outer /* inner insert */ still outer */\n  id uuid\n)')

    expect(stripped).toMatch(/create table unit/i)
    expect(stripped).toMatch(/id uuid/i)
    expect(stripped).not.toMatch(/insert/i)
    expect(stripped).not.toMatch(/outer/i)
  })

  it('keeps a double dash that is inside a string literal', () => {
    // `comment on` statements in these migrations carry prose. Treating a `--`
    // in one as a comment would silently delete the rest of the statement — the
    // stripper corrupting exactly what it exists to preserve.
    const sql = "comment on table unit is 'the durable identity -- dues attach to it';\ncreate index x on unit (id);"
    const stripped = executable(sql)

    expect(stripped).toContain("'the durable identity -- dues attach to it'")
    expect(stripped).toContain('create index x on unit (id);')
  })

  it('treats a doubled quote inside a literal as text, not as the end of it', () => {
    const sql = "comment on table unit is 'a treasurer''s roll -- as typed';\nselect 1;"

    expect(executable(sql)).toContain("'a treasurer''s roll -- as typed'")
    expect(executable(sql)).toContain('select 1;')
  })

  it('keeps a double dash that is inside a quoted identifier', () => {
    // A `--` inside `"…"` is part of the identifier, not a comment. Treating it
    // as one would delete the rest of the statement.
    const sql = 'create index "unit--key" on unit (id);\nselect 1;'

    expect(executable(sql)).toContain('"unit--key"')
    expect(executable(sql)).toContain('select 1;')
  })

  it('does not end an escape string early at a backslash-escaped quote', () => {
    // `E'…'` treats a backslash as an escape; a plain literal does not, because
    // standard_conforming_strings is on. Ending the string at the `\\'` would
    // leave `-- not a comment` being scanned as SQL, and the `select` after it
    // would vanish.
    const sql = "select E'a\\'b -- not a comment';\nselect 2;"

    expect(executable(sql)).toContain('select 2;')
    expect(executable(sql)).toContain('-- not a comment')
  })

  it('still treats a backslash in a plain literal as ordinary text', () => {
    // The beside-case: the escape handling must not leak into normal literals,
    // where a backslash means nothing special because standard_conforming_strings
    // is on.
    //
    // The `--` after the literal is what makes this assertion mean anything. The
    // first version asserted only that `select 3;` survived — and the escape
    // branch copies every character it scans, so `select 3;` appeared in the
    // output under *either* behaviour and the test could not fail. Raised by
    // review; the fourth guard in this story that proved nothing.
    //
    // With the literal closing at the quote, what follows is a real comment and
    // is stripped. If the backslash had escaped that quote, the literal would
    // still be open and would swallow the comment as text, so it would survive.
    const sql = "select 'a\\'; -- swallowed only if the backslash escaped the quote\nselect 3;"

    expect(executable(sql)).toContain('select 3;')
    expect(executable(sql)).not.toMatch(/swallowed/i)
  })

  it('does not read the e at the end of a keyword as an escape-string prefix', () => {
    // `else'b'` is a keyword followed by a literal, and valid SQL. Treated as an
    // escape string, the backslash consumes the closing quote, the scanner runs
    // past the literal's real end, and everything after it — including a real
    // comment — is read as string content and survives.
    const sql = "select case when x then 'a' else'b\\' end; -- a real comment\nselect 4;"

    expect(executable(sql)).toContain('select 4;')
    expect(executable(sql)).not.toMatch(/a real comment/i)
  })

  it('treats a non-ASCII identifier as a word too', () => {
    // Beside the keyword case: Postgres identifiers may contain non-ASCII
    // letters, and `\w` does not match them — so an identifier ending `ñe`
    // followed by a literal would still be read as an escape string. Raised by
    // Argus after the keyword fix landed.
    const sql = "select añe'b\\' end; -- a real comment\nselect 5;"

    expect(executable(sql)).toContain('select 5;')
    expect(executable(sql)).not.toMatch(/a real comment/i)
  })

  it('treats an astral identifier character as a word too', () => {
    // Beside the non-ASCII case, and a step further: `𐐀` is a surrogate *pair* in
    // JavaScript, so reading the preceding code unit yields a lone low surrogate
    // — which matches no Unicode letter property, though the character it came
    // from does. The boundary check would then read `e'` as an escape string.
    const sql = "select \u{10400}e'b\\' end; -- a real comment\nselect 6;"

    expect(executable(sql)).toContain('select 6;')
    expect(executable(sql)).not.toMatch(/a real comment/i)
  })

  it('does not mistake a letter before a lone low surrogate for that character', () => {
    // Cannot arrive from a file — Node turns invalid UTF-8 into U+FFFD — but a
    // caller can hand one in.
    //
    // The **letter** before the lone surrogate is what makes this falsifiable.
    // Slicing two units blindly returns `a` + the surrogate, and the unanchored
    // property test then matches the `a` — so the scanner concludes `e'` is part
    // of a word and reads a plain literal, closing it at the escaped quote and
    // stripping the comment. Correctly, the preceding character is the lone
    // surrogate, which is no letter, so `e'` is an escape string, the backslash
    // keeps the literal open, and the comment is swallowed as text.
    //
    // The first version of this test put a *space* there, and passed either way.
    const sql = "select a\udc00e'b\\' -- swallowed, because the literal is still open\nselect 7;"

    expect(executable(sql)).toMatch(/swallowed/i)
  })

  it('keeps a tagged dollar-quoted body whole, including a non-ASCII tag', () => {
    // A dollar tag is an identifier, and Postgres identifiers are not ASCII-only.
    const sql = ['create function f() returns text language sql as $café$', '  select 1 -- kept', '$café$;'].join('\n')

    expect(executable(sql)).toContain('select 1 -- kept')
  })

  it('keeps a dollar-quoted function body whole', () => {
    // Migration 011's normalisation lives in one of these, and it is precisely
    // what the tests need to look at.
    const sql = ['create function f() returns text language sql as $$', '  select lower(x)', '$$;'].join('\n')

    expect(executable(sql)).toContain('select lower(x)')
  })

  it('preserves line structure so anything reading line by line still lines up', () => {
    const sql = 'a\n/* two\nlines */\nb'

    expect(executable(sql).split('\n')).toHaveLength(4)
  })

  it('leaves a statement with no comments untouched', () => {
    // The positive control. A stripper that returned '' would satisfy every
    // negative assertion above and nothing would notice.
    const sql = 'create unique index unit_normalised_number_key on unit (normalised_number);'

    expect(executable(sql)).toBe(sql)
  })
})
