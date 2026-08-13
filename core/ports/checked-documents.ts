/**
 * What the association has actually had read, as a count and a date.
 *
 * ## Why this is a port of its own
 *
 * UX-DR24 forbids reassurance without a count of what was checked, so an empty
 * findings list has to state a number — and the number is about *documents*, not
 * about findings. Hung off the finding reader it would be a value nobody owns,
 * of the kind that drifts from its name without anything noticing.
 *
 * It is also not `DocumentRepository`. That port records uploads, claims
 * extraction, and marks state; a dashboard holding it could do all three. This
 * one can answer a question and nothing else, which is the whole of what the
 * surface needs.
 */

/**
 * The denominator, and the date behind it.
 *
 * `count` is documents whose extraction reached `read` — the ones that were
 * genuinely examined. Counting every uploaded row would include the held, the
 * unreadable and the ones the provider never answered for, and would tell a
 * board member the system had checked things it had failed to open. On a
 * surface whose only job is to say what was looked at, that is the one number
 * that must not be generous.
 *
 * `latestUploadOn` is `null` before the first document arrives, which AC7 makes
 * a distinct empty state: nothing uploaded is not the same as nothing found. A
 * shape unable to express it would force a date to be invented, and the figure
 * block would carry an "as of" that no document supports.
 */
export interface DocumentsChecked {
  readonly count: number
  readonly latestUploadOn: string | null
}

export interface CheckedDocuments {
  /** How many documents have been read, and the day the most recent arrived. */
  checked(): Promise<DocumentsChecked>
}
