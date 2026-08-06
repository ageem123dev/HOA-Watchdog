/**
 * The reader URL is read the same way the writer's is, and for the same reason
 * `env.ts`'s header gives: at call time, not module scope, so `next build` does
 * not come to require real credentials.
 *
 * Only `readReaderDatabaseUrl` is specified here. `readWriterDatabaseUrl` has no
 * tests of its own and predates this story — noted as a follow-up rather than
 * quietly adopted, since widening a task's scope is how a story stops being
 * reviewable.
 */

import { describe, expect, it, vi } from 'vitest'

import {
  MissingAuthConfigError,
  READER_DATABASE_URL_VAR,
  readReaderDatabaseUrl,
} from './env'

const URL = 'postgres://watchdog_reader:secret@localhost:5432/watchdog'

describe('reading the reader database URL', () => {
  it('returns the configured URL', () => {
    expect(readReaderDatabaseUrl({ [READER_DATABASE_URL_VAR]: URL })).toBe(URL)
  })

  it('trims surrounding whitespace', () => {
    // A URL pasted into a .env file arrives with a trailing newline more often
    // than not, and `pg` does not forgive one.
    expect(readReaderDatabaseUrl({ [READER_DATABASE_URL_VAR]: `  ${URL}\n` })).toBe(URL)
  })

  it('throws when the variable is absent', () => {
    expect(() => readReaderDatabaseUrl({})).toThrow(MissingAuthConfigError)
  })

  it('names the reader variable, not the writer one', () => {
    // The implementation is a copy of its sibling, and the failure mode of a
    // copy is that it reports the name it was copied from — sending whoever
    // reads the error to fix a variable that was never the problem.
    try {
      readReaderDatabaseUrl({})
      expect.unreachable('expected a MissingAuthConfigError')
    } catch (error) {
      expect(error).toBeInstanceOf(MissingAuthConfigError)
      expect((error as MissingAuthConfigError).missing).toEqual(['WATCHDOG_READER_DATABASE_URL'])
    }
  })

  it('treats a blank value as absent', () => {
    // Present-but-empty and absent are different facts about the environment and
    // the same fact about whether we can connect. Returning '' hands `pg` a
    // string it will fail on later, further from the cause.
    expect(() => readReaderDatabaseUrl({ [READER_DATABASE_URL_VAR]: '   ' })).toThrow(
      MissingAuthConfigError,
    )
  })

  it('reads nothing at module scope', async () => {
    // The defect `env.ts` exists to prevent: a module-scope read makes `next
    // build` require real credentials, so the build gate can only be run by
    // someone with a populated environment.
    //
    // Asserted by re-importing with the variable deleted. The first attempt used
    // a cache-busting query string on the specifier, which TypeScript correctly
    // rejected as a module that does not exist — `vi.resetModules()` is the
    // supported way to force a fresh evaluation.
    const previous = process.env.WATCHDOG_READER_DATABASE_URL
    delete process.env.WATCHDOG_READER_DATABASE_URL
    vi.resetModules()

    try {
      await expect(import('./env')).resolves.toBeDefined()
    } finally {
      if (previous !== undefined) process.env.WATCHDOG_READER_DATABASE_URL = previous
    }
  })
})
