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

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// No extension here, and `migrate.mjs` uses `./password-recorder.ts` with one.
// That asymmetry is the existing `board-member-arguments` shape rather than an
// oversight: Node resolving the import needs the real filename, and tsc rejects
// a `.ts` extension unless `allowImportingTsExtensions` is on, which it is not.
import { PasswordUnrecordableError, probeEnvFile, recordingTarget } from './password-recorder'

const ENV_FILE = '/app/.env.local'

describe('recordingTarget', () => {
  it('files the password when .env.local is there and can be recorded into', () => {
    expect(recordingTarget({ exists: true, recordable: true }, ENV_FILE)).toBe('file')
  })

  it('prints it when there is no .env.local at all', () => {
    // The container case. Nothing local is being kept in step, so the console is
    // the whole record and printing is correct rather than a fallback.
    expect(recordingTarget({ exists: false, recordable: false }, ENV_FILE)).toBe('stdout')
  })

  it('refuses when .env.local is there and cannot be written', () => {
    // **Not `stdout`.** The operator has a file they expect to be updated;
    // printing instead would leave them holding one that is quietly stale, which
    // is worse than the refusal because they would still believe it.
    expect(() => recordingTarget({ exists: true, recordable: false }, ENV_FILE)).toThrow(
      PasswordUnrecordableError,
    )
  })

  it('names the file in the refusal, since fixing it means finding it', () => {
    expect(() => recordingTarget({ exists: true, recordable: false }, ENV_FILE)).toThrow(ENV_FILE)
  })

  /**
   * `recordable` is meaningless when the file is absent, and a caller that probes
   * with `accessSync` alone cannot distinguish the two — it throws either way.
   * This pins that absence wins, so a probe that reports `{exists: false,
   * recordable: true}` by accident still prints rather than files a file that is
   * not there.
   */
  it('treats absence as absence whatever recordable says', () => {
    expect(recordingTarget({ exists: false, recordable: true }, ENV_FILE)).toBe('stdout')
  })
})

/**
 * The probe, against a real file system.
 *
 * It is here rather than in `migrate.mjs` because the defect CodeRabbit found on
 * !91 was in the *probe*, not in the decision above: it asked `accessSync(W_OK)`
 * alone, while `setEnvValue` reads the file before writing it. A path that is
 * writable but unreadable therefore passed, and threw on the read — **after**
 * `ALTER ROLE`, which is the single ordering this module exists to prevent. A
 * probe nothing can reach from a test is a predicate nobody checks.
 */
describe('probeEnvFile', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'password-recorder-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('reports an ordinary file as recordable', async () => {
    const path = join(directory, '.env.local')
    await writeFile(path, 'DATABASE_URL=x\n')

    expect(probeEnvFile(path)).toEqual({ exists: true, recordable: true })
  })

  it('reports a missing file as absent, not as unrecordable', async () => {
    // The two are different answers, and collapsing them is what refused to run
    // in a container. Asserted on the whole object so `exists` cannot drift.
    expect(probeEnvFile(join(directory, '.env.local'))).toEqual({
      exists: false,
      recordable: false,
    })
  })

  /**
   * **The regression.** A directory satisfies `existsSync` and `accessSync(W_OK)`
   * on every platform, and fails the read with `EISDIR` — verified by running it
   * before this test was written, rather than inferred. Under the old predicate
   * this returned recordable and the failure landed after the role had changed.
   */
  it('refuses a directory that happens to be named .env.local', async () => {
    const path = join(directory, '.env.local')
    await mkdir(path)

    expect(probeEnvFile(path)).toEqual({ exists: true, recordable: false })
  })

  /**
   * The other half of the same defect has **no test here, deliberately**, and
   * that is worth stating rather than leaving as a gap somebody assumes is
   * covered. A write-only regular file is a POSIX case: Windows maps only the
   * read-only attribute through `chmod`, so the fixture does not reproduce on
   * the machine this suite is usually run on, and a test that quietly passes for
   * the wrong reason is worse than an absent one. The directory case above
   * carries the regression, and the `R_OK` in the probe is what covers this one.
   */
})
