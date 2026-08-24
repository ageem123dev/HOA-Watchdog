/**
 * Provisions the **first** director of an association, and resets a password
 * when somebody is locked out.
 *
 * Run with:
 *   node --env-file=.env.local scripts/add-board-member.mjs <email> [display name]
 *   node --env-file=.env.local scripts/add-board-member.mjs <email> [name] --association "<name>"
 *
 * ## Every director after the first is added in the product
 *
 * Sign in and go to `/directors`. That surface derives the association from the
 * director doing the adding, which is what makes it safe — and is exactly why it
 * cannot serve the case below.
 *
 * ## Why the first director cannot be added there
 *
 * Nobody is signed in yet. There is no session to derive an association from, so
 * the product has nothing to scope the new account to. That is not a gap to
 * design around; it is the same rule that stops one board enrolling somebody
 * into another. So this script remains, for that one case.
 *
 * ## And for a locked-out director
 *
 * `/directors` refuses an address already on a board rather than resetting its
 * password, deliberately: a director who "adds" a colleague who is already there
 * would otherwise invalidate that colleague's password without meaning to. The
 * consequence is that the product cannot recover a locked-out account, and this
 * script's upsert is the only thing that can. That is why it is still an upsert.
 *
 * A password is generated and printed once. It is never stored anywhere but the
 * scrypt hash in the database, so if it is lost the account must be reset again.
 */

import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { hashPassword } from '../core/auth/password.ts'

import { parseArguments } from './board-member-arguments.ts'

const { email: rawEmail, displayName, associationName, missingAssociationValue } = parseArguments(
  process.argv.slice(2),
)

if (!rawEmail) {
  console.error(
    'usage: node --env-file=.env.local scripts/add-board-member.mjs <email> [name] [--association "<name>"]',
  )
  process.exit(1)
}

if (missingAssociationValue) {
  console.error('--association needs a name: --association "Willow Creek"')
  process.exit(1)
}

const email = rawEmail.trim().toLowerCase()

// Four base64url words: long enough that the scrypt cost is not the only thing
// standing between a guess and the association's records.
const password = Array.from({ length: 4 }, () => randomBytes(6).toString('base64url')).join('-')

const client = new pg.Client({ connectionString: process.env.WATCHDOG_WRITER_DATABASE_URL })

try {
  await client.connect()

  // Resolved first, and separately, so the failure is a sentence rather than a
  // constraint violation.
  //
  // This used to be `(select id from association)` inline — correct while one
  // association existed, and raising "more than one row returned by a subquery
  // used as an expression" the moment a second did. Story 5.1 made that
  // representable, so the script could no longer create the first director of
  // association number two: the one case it is still here for.
  //
  // Named, never guessed. The inline subquery refused to choose between two
  // associations, and that property is kept rather than traded for convenience —
  // a name matching none, or more than one, stops here. Enrolling somebody into
  // the wrong board silently is the outcome worth failing loudly to avoid.
  const associations = await client.query(
    associationName === null
      ? 'select id, name from association'
      : 'select id, name from association where name = $1',
    associationName === null ? [] : [associationName],
  )

  if (associations.rows.length !== 1) {
    // Listed from a fresh query when the filter matched nothing. Printing
    // `associations.rows` there lists the empty result of the search that just
    // failed — an error that offers help and then delivers none.
    const all =
      associations.rows.length === 0
        ? await client.query('select name from association order by name')
        : associations

    const names = all.rows.map((row) => `  ${row.name}`).join('\n')
    console.error(
      associationName === null
        ? `There are ${associations.rows.length} associations. Name one with --association:\n${names}`
        : `No association is named exactly "${associationName}". There are:\n${names}`,
    )
    process.exit(1)
  }

  const association = associations.rows[0]

  /**
   * The address must not already belong to a *different* association.
   *
   * `email` is unique across the whole table, so the upsert below fires for an
   * address held by any association. Run with `--association B` for an address
   * already in association A and it would reset A's password, leave the account
   * in A, and print "association: B" — a confident report of something it did
   * not do.
   *
   * The upsert predates this story; what this story added was an association
   * argument the upsert ignores, which turned a silent reset into a mislabelled
   * one. Checked separately so the refusal is a sentence rather than a
   * constraint violation, and refused rather than moved: shifting an account
   * between boards is not something a provisioning script should decide.
   */
  const existing = await client.query(
    'select association_id from board_member where email = $1',
    [email],
  )

  const heldElsewhere = existing.rows[0]
  if (heldElsewhere !== undefined && heldElsewhere.association_id !== association.id) {
    console.error(
      `${email} is already a director of another association. ` +
        'Resetting their password here would leave them on that board and report this one.',
    )
    process.exit(1)
  }

  const passwordHash = await hashPassword(password)

  const { rows } = await client.query(
    // `on conflict do update` is a password reset, and it is deliberate here.
    // `/directors` refuses a duplicate address instead, so this is the only way
    // to recover a director who is locked out.
    `insert into board_member (email, password_hash, display_name, association_id)
          values ($1, $2, $3, $4)
     on conflict (email) do update set password_hash = excluded.password_hash
       returning id, (xmax = 0) as created`,
    [email, passwordHash, displayName, association.id],
  )

  const { id, created } = rows[0]
  console.log(`\n${created ? 'Created' : 'Password reset for'} board member`)
  console.log(`  email:       ${email}`)
  console.log(`  association: ${association.name}`)
  console.log(`  password:    ${password}`)
  console.log(`  id:          ${id}`)
  console.log('\nThis password is shown once and is not recoverable.\n')
} catch (error) {
  console.error(`Failed: ${error.message}`)
  process.exitCode = 1
} finally {
  await client.end()
}
