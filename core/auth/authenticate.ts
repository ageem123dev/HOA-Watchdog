import type { DirectoryUser, UserDirectory } from '../ports/user-directory'
import { hashPassword, needsRehash, verifyPassword } from './password'

/**
 * Deciding whether a sign-in attempt succeeds.
 *
 * The decision lives here, behind a port, rather than inside the Auth.js
 * configuration — so it can be tested against a fake directory with no database,
 * no framework and no network, and so swapping the auth library again would not
 * put it at risk.
 */

/**
 * A rejection carries nothing but its kind — no id, no address, and no
 * association. Which association an address belongs to is not an anonymous
 * caller's to learn, and a result type with an optional user is one somebody
 * eventually reads on the wrong branch.
 */
export type AuthenticationResult =
  | {
      readonly kind: 'authenticated'
      readonly user: { id: string; email: string; associationId: string }
    }
  | { readonly kind: 'rejected' }

/** Emails are compared case-insensitively; nobody has two accounts differing by capitals. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * A hash to verify against when no user exists, so a missing account costs the
 * same time as a wrong password. Without it, sign-in answers "does this address
 * belong to a director?" in a few milliseconds to anyone who asks — and an HOA
 * board roster is not an unauthenticated visitor's to enumerate.
 */
const ABSENT_USER_HASH =
  'scrypt$131072$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

export async function authenticate(
  directory: UserDirectory,
  credentials: { email: unknown; password: unknown },
): Promise<AuthenticationResult> {
  const { email, password } = credentials

  if (typeof email !== 'string' || typeof password !== 'string') return { kind: 'rejected' }
  if (email.trim() === '' || password === '') return { kind: 'rejected' }

  const user = await directory.findByEmail(normaliseEmail(email))

  // The dummy verification runs on the absent-user path so the timing of "no
  // such account" matches the timing of "wrong password".
  if (user === null) {
    await verifyPassword(password, ABSENT_USER_HASH)
    return { kind: 'rejected' }
  }

  const matches = await verifyPassword(password, user.passwordHash)
  if (!matches) return { kind: 'rejected' }

  // Checked after the password, so a disabled account is indistinguishable from
  // a wrong password to someone who does not already know the password.
  if (user.disabledAt !== null) return { kind: 'rejected' }

  await upgradeHashIfStale(directory, user, password)

  return {
    kind: 'authenticated',
    user: { id: user.id, email: user.email, associationId: user.associationId },
  }
}

/**
 * Raising the cost factor should not lock anyone out, so a correct password
 * hashed under weaker parameters is silently re-hashed on the way through. A
 * failure here must not fail the sign-in — the member typed the right password.
 */
async function upgradeHashIfStale(
  directory: UserDirectory,
  user: DirectoryUser,
  password: string,
): Promise<void> {
  if (!needsRehash(user.passwordHash)) return

  try {
    await directory.updatePasswordHash(user.id, await hashPassword(password))
  } catch {
    // Intentionally swallowed: the upgrade is opportunistic.
  }
}
