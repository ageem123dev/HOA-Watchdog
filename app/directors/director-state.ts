/**
 * What provisioning a director produced (story 5.9).
 *
 * Kept out of the action module because a `'use server'` module may export only
 * async functions — the same reason `sample-state.ts` exists.
 *
 * ## The password is in the state, and only here
 *
 * It is returned to the page so the inviting director can pass it on, and it
 * exists nowhere else: not in the database, which holds only the scrypt hash,
 * and not in any log. A refresh loses it, which is the intended behaviour rather
 * than a limitation — there is no second chance to read it because there is
 * nothing left to read.
 */
export type DirectorState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'added'
      readonly email: string
      /** Shown once. Never stored, never logged, gone on refresh. */
      readonly password: string
    }
  | { readonly status: 'error'; readonly error: string }

export const EMPTY_DIRECTOR_STATE: DirectorState = { status: 'idle' }
