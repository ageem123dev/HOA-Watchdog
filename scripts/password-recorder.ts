/**
 * Where `migrate.mjs` records a role password it has just generated.
 *
 * The invariant is not "write to `.env.local`". It is **a generated password is
 * never set on a role without being recorded somewhere the operator can read
 * it** — because `ALTER ROLE` succeeding while the record is lost leaves a
 * credential that exists only in the database, and the role becomes unusable
 * with nothing pointing at why.
 *
 * `migrate.mjs` enforced that by refusing to run at all unless `.env.local` was
 * writable, which reads as the same rule and is narrower: it also refuses in the
 * one place where writing a file is *meaningless*. In a deploy container there
 * is no `.env.local` and never will be, so the check failed on an environment
 * where the honest answer is "print it, there is nowhere to put it". The
 * migrations had already applied by then, so the failure landed halfway: schema
 * present, roles created by `002_roles.sql` with no password, nothing recorded.
 *
 * Extracted rather than inlined because `migrate.mjs` calls `main()` at import,
 * so nothing in it can be reached from a test. `board-member-arguments.ts` is
 * the precedent — the decision lives here, the file system lives there.
 */

import { accessSync, constants, existsSync, statSync } from 'node:fs'

/** What was observed about `.env.local`, kept separate so the decision stays pure. */
export interface EnvFileState {
  readonly exists: boolean

  /**
   * Whether the recording write will actually succeed — **not** merely whether
   * the path is writable.
   *
   * It was `writable`, checked with `accessSync(W_OK)` alone, and that was the
   * wrong predicate: `setEnvValue` reads the file before it writes it, so a path
   * that is writable but unreadable passes the probe and throws on the read —
   * *after* `ALTER ROLE`, which is the one ordering this module exists to
   * prevent. A directory named `.env.local` does it on every platform (`W_OK`
   * passes, the read fails `EISDIR`); a write-only file does it on POSIX.
   * Raised by CodeRabbit on !91 and reproduced before being believed.
   *
   * Only meaningful when `exists`; a missing file is not "unrecordable" here,
   * it is a different answer entirely.
   */
  readonly recordable: boolean
}

/**
 * Observe `.env.local`. The only impure thing here, and it lives beside the
 * decision rather than in `migrate.mjs` because the defect above was in the
 * *probe*, not in the decision — a probe nothing can reach from a test is a
 * probe whose predicate goes unchecked.
 */
export function probeEnvFile(path: string): EnvFileState {
  if (!existsSync(path)) return { exists: false, recordable: false }

  try {
    // A regular file, first. `accessSync` is perfectly happy with a directory,
    // and a directory is the reproducible case.
    if (!statSync(path).isFile()) return { exists: true, recordable: false }

    // Both modes. Read because `setEnvValue` reads before it writes; write
    // because it then writes.
    accessSync(path, constants.R_OK | constants.W_OK)
    return { exists: true, recordable: true }
  } catch {
    return { exists: true, recordable: false }
  }
}

export class PasswordUnrecordableError extends Error {
  override readonly name = 'PasswordUnrecordableError'

  /**
   * Declared and assigned rather than written as a `constructor(readonly path)`
   * parameter property.
   *
   * `migrate.mjs` is run by **Node directly**, whose type stripping is strip-only
   * — it erases annotations and refuses any TypeScript that would need code
   * emitted, and a parameter property is exactly that. The elsewhere-idiomatic
   * short form compiles fine under Vitest and throws
   * `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` the moment the script is run, so the
   * suite would have stayed green over a `migrate` that could not start. Files
   * under `scripts/` that an `.mjs` entry point imports carry this constraint;
   * `adapters/` and `core/` do not, because a bundler reads those.
   */
  readonly path: string

  constructor(path: string) {
    super(
      `${path} exists but is not a readable, writable file, so a new role password ` +
        'could not be recorded; refusing to change one that would then exist only in the database',
    )
    this.path = path
  }
}

/**
 * `'file'` on a workstation, `'stdout'` in a container, and a throw in between.
 *
 * **Absence and unrecordability are deliberately not the same answer.** An absent
 * file says "this is not a workstation" — there is no local configuration to
 * keep in step, so printing is the whole of the record and is correct. A file
 * that exists and cannot be recorded into says something is wrong with *this*
 * checkout: the operator is expecting `.env.local` to be updated, and quietly
 * printing instead would leave them with a stale file they still believe in.
 * That case keeps the original refusal.
 *
 * Call it **before** the first `ALTER ROLE`. Resolving it afterwards would move
 * the failure to the far side of the change it exists to prevent.
 */
export function recordingTarget(state: EnvFileState, path: string): 'file' | 'stdout' {
  if (!state.exists) return 'stdout'
  if (!state.recordable) throw new PasswordUnrecordableError(path)
  return 'file'
}
