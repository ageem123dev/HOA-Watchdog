/**
 * Provisions a board member. The pilot has no self-service sign-up, so this is
 * how a director gets an account.
 *
 * Run with:
 *   node --env-file=.env.local scripts/add-board-member.mjs <email> [display name]
 *
 * A password is generated and printed once. It is never stored anywhere but the
 * scrypt hash in the database, so if it is lost the account must be re-created.
 */

import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { hashPassword } from '../core/auth/password.ts'

const [, , rawEmail, ...nameParts] = process.argv

if (!rawEmail) {
  console.error('usage: node --env-file=.env.local scripts/add-board-member.mjs <email> [name]')
  process.exit(1)
}

const email = rawEmail.trim().toLowerCase()
const displayName = nameParts.join(' ') || null

// Four base64url words: long enough that the scrypt cost is not the only thing
// standing between a guess and the association's records.
const password = Array.from({ length: 4 }, () => randomBytes(6).toString('base64url')).join('-')

const client = new pg.Client({ connectionString: process.env.WATCHDOG_WRITER_DATABASE_URL })

try {
  await client.connect()

  const passwordHash = await hashPassword(password)

  const { rows } = await client.query(
    `insert into board_member (email, password_hash, display_name)
          values ($1, $2, $3)
     on conflict (email) do update set password_hash = excluded.password_hash
       returning id, (xmax = 0) as created`,
    [email, passwordHash, displayName],
  )

  const { id, created } = rows[0]
  console.log(`\n${created ? 'Created' : 'Password reset for'} board member`)
  console.log(`  email:    ${email}`)
  console.log(`  password: ${password}`)
  console.log(`  id:       ${id}`)
  console.log('\nThis password is shown once and is not recoverable.\n')
} catch (error) {
  console.error(`Failed: ${error.message}`)
  process.exitCode = 1
} finally {
  await client.end()
}
