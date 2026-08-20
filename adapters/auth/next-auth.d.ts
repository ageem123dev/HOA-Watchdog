/**
 * `associationId` on the Auth.js user, token and session.
 *
 * ## Optional here, `not null` in the database, and that is not a contradiction
 *
 * `DirectoryUser.associationId` is a `string` because a `board_member` row
 * cannot exist without one. These are optional because a **token** can exist
 * without one: `SESSION_MAX_AGE_SECONDS` is eight hours, so every director
 * already signed in when this shipped holds a JWT minted before the claim
 * existed. Typing it `string` here would be TypeScript promising something the
 * cookie in the browser does not honour.
 *
 * ## What this claim is for, and what it is not
 *
 * It is for server-rendered pages that need to know which association they are
 * showing — the onboarding surfaces of stories 5.3 onward.
 *
 * **It is not an authorization input, and must not become one.** Two reasons,
 * either sufficient. A JWT is not revocable with the Credentials provider (see
 * `auth.ts`), so a claim stays true for up to eight hours after it stops being
 * true. And `/tools/v1/*` — the path that actually reads association-scoped
 * records — never sees a session at all; it derives the association from the
 * board member named in the request, which is the single source of truth.
 */

export {}

declare module 'next-auth' {
  interface User {
    associationId?: string
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    associationId?: string
  }
}
