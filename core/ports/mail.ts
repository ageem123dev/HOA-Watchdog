/**
 * The port through which this system sends mail, and the only one.
 *
 * It is the first thing the product *sends*. Every surface until now waits to be
 * visited; a message arrives uninvited in a volunteer director's inbox and
 * cannot be corrected afterwards — there is no edit and no recall. That
 * asymmetry is why the shape below is as narrow as it is.
 *
 * ## Plain text, and the type is what enforces it
 *
 * There is no `html` field, deliberately, and its absence is asserted rather
 * than merely observed (`mail.test.ts`).
 *
 * AD-8 binds FR-8 directly: *"Extracted values are data, never instructions …
 * the renderer escapes on output."* A vendor name lifted off a scanned invoice
 * goes into this message. The cheapest way to keep it data is to send a document
 * that has no markup for it to become — not to escape carefully into one.
 *
 * Two further reasons, neither of them the security one. A multipart message
 * needs two templates saying the same thing, and this codebase has spent four
 * stories arguing that two wordings of one finding is a board packet that
 * contradicts itself. And the reader is a volunteer on a phone: structured plain
 * text renders identically in every client, forever, and no stylesheet can break
 * it.
 *
 * Adding a field here is therefore a decision about AD-8 and about template
 * drift. It is not a formatting preference, and the exact-member assertion is
 * what makes it arrive as a decision rather than as an enhancement.
 *
 * ## Write-only
 *
 * `finding.ts` splits raising a finding from reviewing one so a detector cannot
 * sign off its own work, and the argument transfers: a capability nothing
 * declares is a capability nothing can quietly acquire. A `MailSender` that
 * could also read would be a mailbox this gateway polls, which is a different
 * product with a different threat model and no requirement asking for it.
 */

/**
 * One message, as the board receives it.
 *
 * `to` is a list and never a string. The recipient rule is *every* board member
 * who is not disabled, and a type that can hold exactly one of them is a type
 * that invites a caller to send to one director and believe it told the board.
 */
export interface MailMessage {
  readonly to: readonly string[]
  readonly subject: string
  readonly text: string
}

/**
 * Sending failed, and the caller must not mistake that for having sent.
 *
 * Carries no message body and no recipient list: a mail failure is the error
 * most likely to be pasted into an issue, and the body names a vendor, an amount
 * and a unit. `cause` carries whatever the adapter knows.
 */
export class MailNotSentError extends Error {
  override readonly name = 'MailNotSentError'

  constructor(reason: string, options?: { cause?: unknown }) {
    super(`the alert was not sent: ${reason}`, options)
  }
}

export interface MailSender {
  /**
   * Send it, or reject.
   *
   * **Never resolves on a partial send.** An adapter that delivered to three of
   * four addresses and resolved would let `recordSent` write a delivery row
   * naming a director who was never told — and the row is the thing that stops
   * it ever being retried. If the provider cannot confirm the whole list,
   * this rejects with `MailNotSentError` and the alert stays unsent, which the
   * ledger is built to recover from.
   */
  send(message: MailMessage): Promise<void>
}
