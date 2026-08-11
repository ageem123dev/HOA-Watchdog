/**
 * The two things every `/tools/*` endpoint does the same way.
 *
 * AD-15 makes these endpoints "the sole data path in the system", and a sole
 * path with two implementations of its own front door is not one path. Story 3.2
 * wrote both of these inside `app/tools/v1/catalog/execute/route.ts`, which was
 * right when there was one endpoint; story 3.4 adds a second, and a copy is how
 * the two drift.
 *
 * The drift that matters is not cosmetic. If one endpoint distinguishes "no
 * Authorization header" from "wrong token" and the other does not, the pair
 * together tells a stranger which of the two they got wrong — a fact neither
 * endpoint discloses on its own.
 *
 * Nothing here reads the environment or touches the network. `Request` and
 * `Response` are Web globals rather than framework imports, which is what lets
 * this live in `core/` without breaking `core/ports/boundary.test.ts`.
 */

/** `{code, message, detail?}`, the architecture's one error envelope. */
export function failure(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status })
}

/**
 * The presented bearer value, or `null`.
 *
 * Strict about the scheme: a header that is missing, malformed, or uses any
 * scheme other than `Bearer` collapses to the same `null` as a wrong token,
 * because telling those apart tells a stranger how to try again.
 */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (header === null) return null

  const [scheme, ...rest] = header.trim().split(/\s+/)
  if (scheme?.toLowerCase() !== 'bearer') return null

  // Exactly one credential field. `rest.join(' ')` accepted `Bearer a b` and
  // handed `"a b"` on as a token — no bearer credential contains whitespace, so
  // that is malformed input being repaired rather than refused, and repairing
  // malformed auth input is how a parser and a validator come to disagree about
  // what was presented. Raised by CodeRabbit.
  if (rest.length !== 1) return null

  const value = rest[0] ?? ''
  return value === '' ? null : value
}
