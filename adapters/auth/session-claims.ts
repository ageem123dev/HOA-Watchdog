/**
 * What a signed-in board member's token and session carry, as plain functions.
 *
 * Extracted from `auth.ts` because the callbacks there are inline properties of
 * the `NextAuth(...)` argument: reaching them from a test means booting Auth.js,
 * which reads `AUTH_SECRET` and builds a database pool. These are pure — they
 * take what they are given and mutate it — so the rules about *which* claims
 * survive a refresh can be asserted directly.
 *
 * Typed structurally rather than against `next-auth`'s `Session` and `JWT`. The
 * shapes those types describe are the two fields below and nothing else this
 * module needs, and a structural type is one a test can construct in a line.
 */

interface TokenClaims {
  sub?: string
  associationId?: string
}

interface SignedInUser {
  readonly id?: string
  readonly associationId?: string
}

interface SessionUser {
  id?: string
  associationId?: string
}

/**
 * Copies the claims off the user Auth.js has just authenticated.
 *
 * **`user` is present only on the sign-in call.** Auth.js runs the `jwt`
 * callback on every request that resolves a session, and passes `user` on none
 * of them but the first. Reading it unguarded would not merely fail to update a
 * claim — it would overwrite one that is already correct with `undefined`, so a
 * member would silently lose it on their first page load after signing in.
 */
export function applyClaimsToToken(token: TokenClaims, user: SignedInUser | undefined): void {
  if (user?.id === undefined) return

  token.sub = user.id
  if (user.associationId !== undefined) token.associationId = user.associationId
}

/**
 * Copies the claims off the token onto the session the caller will read.
 *
 * Each claim is copied only when it is present. A token minted before a claim
 * existed does not carry it, and writing `undefined` over a field the type says
 * is a string would hand every reader a value TypeScript promised could not
 * arrive.
 */
export function applyClaimsToSession(session: { user: SessionUser }, token: TokenClaims): void {
  if (token.sub !== undefined) session.user.id = token.sub
  if (token.associationId !== undefined) session.user.associationId = token.associationId
}
