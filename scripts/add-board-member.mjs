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
    // `association_id` is not null since story 5.1 and has no default, so this
    // insert has to state one. `(select id from association)` rather than the
    // pilot's literal id: a bare scalar subquery is exactly right while one
    // association exists, and raises `more than one row returned by a subquery
    // used as an expression` the moment a second does. That is the correct
    // failure — this script writes `board_member` directly with the writer
    // credential, and story 5.9 replaces it with a provisioning flow that knows
    // which association a director belongs to. Failing loudly is better than
    // silently enrolling somebody into the wrong board.
    `insert into board_member (email, password_hash, display_name, association_id)
          values ($1, $2, $3, (select id from association))
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
