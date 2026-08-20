import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { authenticate } from '@/core/auth/authenticate'
import { applyClaimsToSession, applyClaimsToToken } from './session-claims'
import { createPostgresUserDirectory } from './user-directory-postgres'

/**
 * Auth.js wiring. It holds no policy of its own: whether a sign-in succeeds is
 * decided by `core/auth/authenticate`, which is tested against a fake directory
 * with no database, no framework and no network.
 *
 * **Object config, not a factory — this is load-bearing.** An earlier version
 * passed `NextAuth(() => config)` so that configuration could be read per
 * request. With a factory, `next-auth` makes the returned `auth` *async*, so
 * `auth(handler)` in `proxy.ts` evaluates to a `Promise<Function>` rather than a
 * function. Next.js rejects the proxy export and serves **HTTP 500 on every
 * route**, including sign-in. The whole application was down and every gate was
 * green. Do not reintroduce the factory form.
 *
 * The build still runs without credentials because nothing here reads the
 * environment at module load: Auth.js resolves `AUTH_SECRET` itself at request
 * time, and the database URL is read inside `authorize`.
 *
 * **Session strategy is JWT, and that is forced rather than chosen.** Auth.js
 * does not support database sessions with the Credentials provider. The
 * consequence is real: a session cannot be revoked server-side before it
 * expires, so disabling a departed director stops them signing in *again* but
 * does not kill a session they already hold.
 */

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8

export const { handlers, signIn, signOut, auth } = NextAuth({
  /**
   * Auth.js trusts the Host header automatically only on Vercel. This project
   * deploys to Railway, so without this every `/api/auth/*` request fails with
   * `UntrustedHost` and nobody can sign in.
   *
   * The risk it accepts is real and worth naming: a forged Host header can steer
   * a callback URL, which is an open-redirect shape. It is acceptable here
   * because the gateway sits behind Railway's proxy, which sets Host from the
   * request's actual target rather than passing an attacker's value through.
   * Behind a proxy that does not, this would need `AUTH_URL` pinned instead.
   */
  trustHost: true,
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
          ? {
              id: result.user.id,
              email: result.user.email,
              associationId: result.user.associationId,
            }
          : null
      },
    }),
  ],
  callbacks: {
    // The rules live in `session-claims.ts`, where a test can call them without
    // booting Auth.js. These two stay thin on purpose: mutate, then return the
    // object Auth.js expects back.
    jwt: ({ token, user }) => {
      applyClaimsToToken(token, user)
      return token
    },
    session: ({ session, token }) => {
      applyClaimsToSession(session, token)
      return session
    },
  },
})
