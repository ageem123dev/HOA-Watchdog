import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { authenticate } from '@/core/auth/authenticate'
import { readAuthConfig } from './env'
import { createPostgresUserDirectory } from './user-directory-postgres'

/**
 * Auth.js wiring. It holds no policy of its own: whether a sign-in succeeds is
 * decided by `core/auth/authenticate`, which is tested against a fake directory
 * with no database, no framework and no network.
 *
 * **Session strategy is JWT, and that is forced rather than chosen.** Auth.js
 * does not support database sessions with the Credentials provider — the two are
 * mutually exclusive by design. The consequence is real and worth stating: a
 * session cannot be revoked server-side before it expires, so disabling a
 * departed director stops them signing in *again* but does not immediately kill
 * a session they already hold. `maxAge` is deliberately short to bound that
 * window. Genuine server-side revocation would mean moving off the Credentials
 * provider, which needs an email sender this project does not yet have.
 */

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8

export const { handlers, signIn, signOut, auth } = NextAuth(() => {
  // Inside the factory so configuration is read per request rather than at
  // module load, keeping `next build` runnable without credentials.
  const { authSecret } = readAuthConfig()

  return {
    secret: authSecret,
    session: { strategy: 'jwt', maxAge: SESSION_MAX_AGE_SECONDS },
    pages: { signIn: '/sign-in' },
    providers: [
      Credentials({
        credentials: { email: {}, password: {} },
        authorize: async (credentials) => {
          const result = await authenticate(createPostgresUserDirectory(), {
            email: credentials?.email,
            password: credentials?.password,
          })

          // Returning null is how Auth.js signals a failed attempt. It carries no
          // reason, which matches the one-shape-for-every-failure rule in
          // core/auth/authenticate.
          return result.kind === 'authenticated'
            ? { id: result.user.id, email: result.user.email }
            : null
        },
      }),
    ],
    callbacks: {
      jwt: ({ token, user }) => {
        if (user?.id !== undefined) token.sub = user.id
        return token
      },
      session: ({ session, token }) => {
        if (token.sub !== undefined) session.user.id = token.sub
        return session
      },
    },
  }
})
