/**
 * The port through which sign-in learns who a board member is.
 *
 * Pure interface: `core/` declares what it needs and `adapters/` supplies it.
 * This is what made the Supabase-to-Auth.js swap a four-file change rather than
 * a rewrite — the shape of "look up a member by email" does not depend on who
 * stores them.
 */

export interface DirectoryUser {
  readonly id: string
  readonly email: string
  /** In the stored format produced by `core/auth/password.ts`. */
  readonly passwordHash: string
  /** A member who has left the board keeps their audit trail but loses access. */
  readonly disabledAt: Date | null
}

export interface UserDirectory {
  findByEmail(email: string): Promise<DirectoryUser | null>
  /** Used to transparently upgrade a hash whose parameters have fallen behind. */
  updatePasswordHash(userId: string, passwordHash: string): Promise<void>
}
