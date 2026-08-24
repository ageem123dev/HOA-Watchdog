/**
 * Adding a director to a board (story 5.9).
 *
 * ## Why the inviting member and not an association
 *
 * The association is derived from the inviting director in SQL, never passed.
 * 5.1's rule, and here it decides which board a new account can read: a caller
 * able to name an association could enrol somebody into a board they have
 * nothing to do with, and that account would then see that board's records.
 *
 * ## Why this is not on `UserDirectory`
 *
 * `UserDirectory` is the sign-in path's read of `board_member` — find by email,
 * update a hash. This creates a member, which is a different privilege on the
 * same table, and `authenticate` has no business being able to do it. Story 5.7
 * put a method on the wrong port once and `tsc` named four fakes that would have
 * had to grow it.
 */
export interface DirectorRoster {
  /**
   * Add a director to the inviting director's association.
   *
   * Returns `false` when the address is already on **any** board — the email
   * column is unique across the table, so "already a director somewhere" and
   * "already on this board" are the same refusal. Never resets the existing
   * password: that is a different act with different consequences, and doing it
   * by accident locks a colleague out.
   *
   * `passwordHash` is what `core/auth/password.ts` produced. This port does not
   * hash, because the value that must never be logged should exist in as few
   * places as possible.
   */
  add(
    invitedBy: string,
    email: string,
    displayName: string | null,
    passwordHash: string,
  ): Promise<boolean>
}
