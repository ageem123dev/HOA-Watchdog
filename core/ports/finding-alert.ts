/**
 * Owning the send, and recording what happened to it.
 *
 * Migration 023 is the authority on the rules; this is the shape a caller
 * reaches them through. Read that file's header before changing anything here —
 * the two are one design, and the interesting decisions are argued there.
 *
 * ## Why a claim exists at all
 *
 * Sending is not transactional. An email cannot be rolled back and a database
 * write cannot be un-sent, so the two can only be ordered, and either order
 * loses something: send-then-record re-sends forever after a crash between them;
 * record-then-send says a warning went out that never did.
 *
 * So the row carries both moments. `claim` takes ownership, the send happens,
 * and `recordSent` stamps the success. A claim with no send is the recoverable
 * state — the only state a retry looks at.
 *
 * The guarantee is **at-least-once, not exactly-once.** A send that succeeds and
 * then fails to record its success will be sent again. That is the right way
 * round for a fiduciary warning: a duplicate email is a nuisance, and a missed
 * one is the thing this product exists to prevent.
 *
 * ## There is no `unsend`, and no `delete`
 *
 * Migration 023 revokes DELETE and TRUNCATE and its trigger refuses to move a
 * delivered row at all, so a method declared here would be one the database
 * answers with an exception on its first call. The type and the grant agree, and
 * that duplication is the point: a second statement of a shape is safe when
 * something fails on disagreement.
 *
 * ## Choosing what to alert on is not here
 *
 * That is a read of the register and it lives on `FindingReader` with the other
 * three. One object able to both choose the work and claim it is one refactor
 * from a mailer that decides what the board hears about — the same split
 * `finding.ts` makes between raising a finding and reviewing it.
 */

export interface FindingAlertLedger {
  /**
   * Take ownership of sending this finding's alert.
   *
   * `true` means this caller owns it and must go on to `recordSent` or
   * `recordFailure`. `false` means it does not: either the alert has already
   * been delivered, or another run holds a claim that has not yet gone stale.
   * **A caller that cannot tell those apart will send anyway**, which is the
   * duplicate AD-13 forbids arriving through a return type — so this returns an
   * answer rather than nothing.
   *
   * One statement, never a read followed by a write. Two runs arriving together
   * would both read "unclaimed" and both believe they had it; the unique
   * constraint is what arbitrates, and only an upsert lets it.
   *
   * `staleBefore` is the boundary a claim must predate to be taken over — handed
   * in rather than read from a clock here, so the retry window is a value a test
   * can set instead of a date a test has to wait for.
   */
  claim(findingId: string, staleBefore: Date): Promise<boolean>

  /**
   * The alert went, to these addresses.
   *
   * Addresses and not member ids: what matters afterwards is where the mail
   * actually went, and an id resolves to whatever the row says *today*. A
   * director whose address was corrected last month would otherwise make the
   * record silently claim the new one had been used.
   *
   * The list must be the one that was actually sent to. Migration 023 refuses an
   * empty list, a list with a hole in it, and a list containing a blank string,
   * so a caller that lost its recipients between sending and recording fails
   * loudly rather than writing a delivery nobody can be found in.
   */
  recordSent(findingId: string, recipients: readonly string[]): Promise<void>

  /**
   * It did not go, and this is what is known about why.
   *
   * Leaves the alert unsent on purpose. The claim stays, goes stale, and a later
   * run takes it over — which is the whole of the recovery story, and the reason
   * this is not simply a swallowed error.
   *
   * **What `failure` may contain**, stated here because `recordSent` states the
   * equivalent for its recipients and the asymmetry was a real gap:
   *
   * - **No recipient address, credential or URL.** This column is read by
   *   whoever is working out why a board was never warned, and a provider's
   *   rejection routinely echoes the request back — which is where every
   *   director's address is. `MailNotSentError` is built to carry none of them;
   *   anything else reaching here is the caller's to keep clean.
   * - **Non-blank, and at most 2000 characters.** Migration 023's
   *   `finding_alert_failure_is_useful` enforces both, and refuses the row
   *   otherwise — so an adapter that passes a longer or emptier reason straight
   *   through would fail on *recording that the send failed*, losing the only
   *   record that it did. The Postgres adapter normalises rather than relying on
   *   the caller.
   */
  recordFailure(findingId: string, failure: string): Promise<void>
}
