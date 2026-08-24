/**
 * Parsing the provisioning script's arguments (story 5.9).
 *
 * ## Why this is a real test and not a text assertion
 *
 * `add-board-member.mjs` connects to a database on import, so it cannot be
 * imported by a test — `verify-extraction.test.ts` reads its probe as text for
 * exactly that reason. The parsing does not need a database, so it moved into a
 * module that does not, and can be exercised properly.
 *
 * The text assertion this replaces could only check that the *shape* of the
 * parsing had changed. It could not tell whether `--association X <email>`
 * actually works, which is the thing that was broken. Raised by CodeRabbit.
 */

import { describe, expect, it } from 'vitest'

import { parseArguments } from './board-member-arguments'

describe('the flag can appear anywhere', () => {
  it('reads an email with no flag at all', () => {
    expect(parseArguments(['ada@example.com'])).toEqual({
      email: 'ada@example.com',
      displayName: null,
      associationName: null,
      missingAssociationValue: false,
    })
  })

  it('reads a display name made of several words', () => {
    expect(parseArguments(['ada@example.com', 'Ada', 'Lovelace'])).toEqual({
      email: 'ada@example.com',
      displayName: 'Ada Lovelace',
      associationName: null,
      missingAssociationValue: false,
    })
  })

  it('reads the flag after the positional arguments', () => {
    expect(parseArguments(['ada@example.com', 'Ada', '--association', 'Willow Creek'])).toEqual({
      email: 'ada@example.com',
      displayName: 'Ada',
      associationName: 'Willow Creek',
      missingAssociationValue: false,
    })
  })

  it('reads the flag before the positional arguments', () => {
    // The old `argv.slice(0, associationAt)` produced an empty positional list
    // here and failed with a usage error for a well-formed command.
    expect(parseArguments(['--association', 'Willow Creek', 'ada@example.com', 'Ada'])).toEqual({
      email: 'ada@example.com',
      displayName: 'Ada',
      associationName: 'Willow Creek',
      missingAssociationValue: false,
    })
  })

  it('keeps a display name that follows the flag and its value', () => {
    // And this is the case the old slice lost silently: the name was dropped
    // and the account created without one, with no error to notice.
    expect(parseArguments(['ada@example.com', '--association', 'Willow Creek', 'Ada Lovelace'])).toEqual({
      email: 'ada@example.com',
      displayName: 'Ada Lovelace',
      associationName: 'Willow Creek',
      missingAssociationValue: false,
    })
  })
})

describe('what it refuses to guess', () => {
  it('reports a missing email', () => {
    expect(parseArguments([]).email).toBeNull()
  })

  it('reports a flag given without a value', () => {
    // `--association` at the end has nothing after it. Treating that as "no
    // association" would silently fall back to the every-association query.
    expect(parseArguments(['ada@example.com', '--association'])).toMatchObject({
      associationName: null,
      missingAssociationValue: true,
    })
  })

  it('does not treat a following flag as the association name', () => {
    expect(parseArguments(['ada@example.com', '--association', '--other'])).toMatchObject({
      missingAssociationValue: true,
    })
  })
})
