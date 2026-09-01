/**
 * Where a generated role password is recorded, and when the run must refuse.
 *
 * The rule under test is not "write to `.env.local`" but "never set a password
 * that will not be recorded", and the three cases are genuinely different
 * answers rather than three spellings of one. Each is asserted on its own,
 * because collapsing absence and unwritability is exactly the defect this pair
 * was written to fix — `migrate.mjs` refused to run in a deploy container, where
 * a missing `.env.local` is not a problem to solve but the ordinary state.
 */

import { describe, expect, it } from 'vitest'

// No extension here, and `migrate.mjs` uses `./password-recorder.ts` with one.
// That asymmetry is the existing `board-member-arguments` shape rather than an
// oversight: Node resolving the import needs the real filename, and tsc rejects
// a `.ts` extension unless `allowImportingTsExtensions` is on, which it is not.
import { PasswordUnrecordableError, recordingTarget } from './password-recorder'

const ENV_FILE = '/app/.env.local'

describe('recordingTarget', () => {
  it('files the password when .env.local is there and writable', () => {
    expect(recordingTarget({ exists: true, writable: true }, ENV_FILE)).toBe('file')
  })

  it('prints it when there is no .env.local at all', () => {
    // The container case. Nothing local is being kept in step, so the console is
    // the whole record and printing is correct rather than a fallback.
    expect(recordingTarget({ exists: false, writable: false }, ENV_FILE)).toBe('stdout')
  })

  it('refuses when .env.local is there and cannot be written', () => {
    // **Not `stdout`.** The operator has a file they expect to be updated;
    // printing instead would leave them holding one that is quietly stale, which
    // is worse than the refusal because they would still believe it.
    expect(() => recordingTarget({ exists: true, writable: false }, ENV_FILE)).toThrow(
      PasswordUnrecordableError,
    )
  })

  it('names the file in the refusal, since fixing it means finding it', () => {
    expect(() => recordingTarget({ exists: true, writable: false }, ENV_FILE)).toThrow(ENV_FILE)
  })

  /**
   * `writable` is meaningless when the file is absent, and a caller that probes
   * with `accessSync` alone cannot distinguish the two — it throws either way.
   * This pins that absence wins, so a probe that reports `{exists: false,
   * writable: true}` by accident still prints rather than files a file that is
   * not there.
   */
  it('treats absence as absence whatever writable says', () => {
    expect(recordingTarget({ exists: false, writable: true }, ENV_FILE)).toBe('stdout')
  })
})
