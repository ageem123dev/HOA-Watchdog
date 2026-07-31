import { Pool } from 'pg'
import type { DirectoryUser, UserDirectory } from '@/core/ports/user-directory'
import { readAuthConfig } from './env'

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
    pool = new Pool({ connectionString: readAuthConfig().databaseUrl, max: 5 })
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
