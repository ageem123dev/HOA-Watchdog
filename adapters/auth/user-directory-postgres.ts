import { Pool } from 'pg'
import type { DirectoryUser, UserDirectory } from '@/core/ports/user-directory'
import { readWriterDatabaseUrl } from './env'

/**
 * The `UserDirectory` port backed by Postgres.
 *
 * Reached through the **writer** role: sign-in updates a password hash when the
 * cost factor has been raised, so this path legitimately writes. The SELECT-only
 * `watchdog_reader` role exists for the LLM-driven query path (AD-4) and is not
 * used here.
 */

let pool: Pool | null = null

/**
 * One pool per process, created on first use rather than at module load — see
 * the note in `env.ts` about `next build` evaluating modules.
 */
function getPool(): Pool {
  if (pool === null) {
    pool = new Pool({
      connectionString: readWriterDatabaseUrl(),
      max: 5,
      /**
       * Bounds on the sign-in path, which is unauthenticated and therefore the
       * one an attacker can reach for free.
       *
       * Without `connectionTimeoutMillis` a request waits indefinitely for a free
       * client, so a stalled database turns every sign-in attempt into a held
       * connection and the pool never recovers. `statement_timeout` is the
       * server-side counterpart: it bounds the query itself rather than the wait
       * for a client, and it is enforced by Postgres, so it survives a request
       * this process has stopped tracking.
       */
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 10_000,
    })

    /**
     * `pg` emits `error` on the pool when an *idle* client fails — a database
     * restart, an idle-session timeout, a dropped network path. That event has no
     * request to reject, so with no listener attached Node treats it as an
     * unhandled `error` and terminates the process. A board member's sign-in
     * should not take the gateway down because the database recycled a connection
     * nobody was using.
     *
     * The pool discards the client and carries on; this listener exists to keep
     * the failure observable rather than fatal.
     */
    pool.on('error', (error) => {
      console.error('[user-directory] idle client error; the pool will discard it', error)
    })
  }
  return pool
}

interface UserRow {
  id: string
  email: string
  password_hash: string
  disabled_at: Date | null
}

export function createPostgresUserDirectory(): UserDirectory {
  return {
    async findByEmail(email: string): Promise<DirectoryUser | null> {
      const { rows } = await getPool().query<UserRow>(
        'SELECT id, email, password_hash, disabled_at FROM board_member WHERE email = $1',
        [email],
      )

      const row = rows[0]
      if (row === undefined) return null

      return {
        id: row.id,
        email: row.email,
        passwordHash: row.password_hash,
        disabledAt: row.disabled_at,
      }
    },

    async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
      await getPool().query('UPDATE board_member SET password_hash = $1 WHERE id = $2', [
        passwordHash,
        userId,
      ])
    },
  }
}
