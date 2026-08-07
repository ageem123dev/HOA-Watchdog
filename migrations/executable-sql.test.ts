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
