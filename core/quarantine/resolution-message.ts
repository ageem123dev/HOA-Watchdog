/**
 * What the queue says after a resolution, in words.
 *
 * A pure function so the sentences can be tested without rendering anything,
 * and so there is exactly one place that decides what each outcome means. The
 * value arrives from a query string, which is to say from a URL anybody can
 * type: an unrecognised one says nothing rather than rendering whatever was
 * passed in.
 */
export function resolutionMessage(outcome: string | undefined): string | null {
  switch (outcome) {
    case 'created':
      return 'Recorded as a new vendor. It has left the queue.'
    case 'matched':
      return 'Matched to the vendor you chose. It has left the queue.'
    case 'already-resolved':
      // The distinction AC5 asks for: nothing went wrong, and it was not you.
      return 'Somebody had already answered that one, so nothing changed.'
    case 'refused':
      return 'That could not be recorded. Sign in and try again.'
    default:
      // Includes an absent parameter and anything hand-typed. Echoing an
      // unrecognised value back would put an attacker's text on the page.
      return null
  }
}
