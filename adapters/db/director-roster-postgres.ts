/**
 * Adding a director to a board, in Postgres (story 5.9).
 *
 * `core/ports/director-roster.ts` is the contract. This is the one statement
 * behind it.
 *
 * ## The writer pool, and there is no alternative
 *
 * Migration 003 revokes **all** on `board_member` from `watchdog_reader`,
 * deliberately: "the LLM-driven query path has no business with credentials".
 * There is no reader-pool version of this to write, and a reader-pool version
 * would not answer wrongly — it would throw a permission error the moment a
 * director tried to add a colleague.
 *
 * ## `do nothing`, not `do update`
 *
 * `scripts/add-board-member.mjs` does `on conflict (email) do update set
 * password_hash = excluded.password_hash`, which is a password reset in the
 * shape of an insert. That is defensible in a script somebody runs on purpose.
 * In a form it is how a director "adds" a colleague already on the board and
 * silently invalidates their password — so this refuses instead, and the caller
 * is told nothing was created.
 *
 * The whole difference is one word, which is why it has its own assertion.
 */

import type { DirectorRoster } from '@/core/ports/director-roster'

import { writerPool } from './pool'

export function createDirectorRoster(): DirectorRoster {
  return {
    async add(invitedBy, email, displayName, passwordHash): Promise<boolean> {
      const written = await writerPool().query(
        // The association is read from the inviting director, never passed in.
        // It decides which board the new account can see, so a caller able to
        // name one could enrol somebody into a board they have nothing to do
        // with. A scalar subquery inside VALUES, not `insert ... select`: the
        // select form inserts no row at all when the inviter does not exist,
        // which would make an unknown inviter indistinguishable from a
        // duplicate address three lines down.
        `insert into board_member (email, password_hash, display_name, association_id)
         values ($2, $3, $4, (select association_id from board_member where id = $1))
         on conflict (email) do nothing
         returning id`,
        // Lower-cased here rather than left to the constraint. Migration 001's
        // `board_member_email_is_lowercase` would refuse a mixed-case address,
        // and `authenticate` lower-cases at sign-in — so a row stored any other
        // way could never be matched even if it were insertable.
        [invitedBy, email.trim().toLowerCase(), passwordHash, displayName],
      )

      // No row means the address was already on a board. Not an error: it is the
      // answer to "is this person already a director", and the caller says so.
      return (written.rowCount ?? 0) > 0
    },
  }
}
