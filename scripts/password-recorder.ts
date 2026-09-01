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

/** What `migrate.mjs` observed about `.env.local`, so this stays pure. */
export interface EnvFileState {
  readonly exists: boolean
  /** Only meaningful when `exists`; a missing file is not "unwritable" here. */
  readonly writable: boolean
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
      `${path} exists but is not writable, so a new role password could not be recorded; ` +
        'refusing to change one that would then exist only in the database',
    )
    this.path = path
  }
}

/**
 * `'file'` on a workstation, `'stdout'` in a container, and a throw in between.
 *
 * **Absence and unwritability are deliberately not the same answer.** An absent
 * file says "this is not a workstation" — there is no local configuration to
 * keep in step, so printing is the whole of the record and is correct. A file
 * that exists and cannot be written says something is wrong with *this*
 * checkout: the operator is expecting `.env.local` to be updated, and quietly
 * printing instead would leave them with a stale file they still believe in.
 * That case keeps the original refusal.
 *
 * Call it **before** the first `ALTER ROLE`. Resolving it afterwards would move
 * the failure to the far side of the change it exists to prevent.
 */
export function recordingTarget(state: EnvFileState, path: string): 'file' | 'stdout' {
  if (!state.exists) return 'stdout'
  if (!state.writable) throw new PasswordUnrecordableError(path)
  return 'file'
}
