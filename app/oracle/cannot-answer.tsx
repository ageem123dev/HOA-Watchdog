import Link from 'next/link'

import { suggestedQuestion } from '@/catalog/suggested-question'

/**
 * The three ways a turn ends without an answer (story 3.7, UX-DR17 and UX-DR18).
 *
 * On this product these are not edge cases. **AD-5 fixes the query catalog**, so
 * a question outside it is guaranteed rather than hypothetical, and with one
 * entry registered today "I can't answer that" is the most likely thing a board
 * member meets in their first session.
 *
 * ## Three states, and the difference between them is the point
 *
 * | State | What happened | What the reader must not conclude |
 * | --- | --- | --- |
 * | No catalog match | The question is outside the catalog | That the records are missing |
 * | Refused (AD-7) | The model wrote a figure the rows do not support | That the system broke |
 * | Unavailable | The agent or a tool endpoint failed | That the question was unanswerable |
 *
 * Collapsing them into one apology would be a lie in whichever direction the
 * reader guesses. A treasurer told "no data" goes looking for a bookkeeping
 * problem that does not exist; a treasurer told "we're down" waits for a
 * recovery that is not coming, because nothing is broken.
 *
 * ## Never a partial answer
 *
 * None of these renders prose, a figure, or a half-filled evidence table. The UX
 * spec is flat about it — "never present a partial answer" — and an ungrounded
 * sentence is the exact failure the whole epic exists to prevent.
 *
 * ## Props, not fetching
 *
 * The shape `AnswerView` established: everything arrives as a prop so the render
 * tests need no server.
 */

export interface CannotAnswerProps {
  /**
   * The question, kept on screen.
   *
   * UX-DR18 requires it for the unavailable state and UX-DR11 for every Oracle
   * surface. A failure page that loses the question makes the reader doubt what
   * they typed on top of everything else.
   */
  readonly question: string
}

/**
 * A link that asks a question.
 *
 * The "single action" UX-DR17 asks for, and a plain link is the whole mechanism:
 * story 3.6c made the question a search parameter, so asking is a URL. No
 * client JavaScript, correct back button, and the result is linkable.
 */
function AskLink({ question, children }: { question: string; children: string }) {
  return (
    <Link href={`/oracle?q=${encodeURIComponent(question)}`} style={styles.action}>
      {children}
    </Link>
  )
}

function Shell({ question, children }: { question: string; children: React.ReactNode }) {
  return (
    <section style={styles.section}>
      {/* The question first, in every state. */}
      <h1 style={styles.question}>{question}</h1>
      {children}
    </section>
  )
}

/**
 * UX-DR17 — the question is outside the catalog.
 *
 * Says the *question* is unsupported, never that the data is missing. That
 * distinction is the entire criterion: those two sentences send a treasurer to
 * completely different places, and only one of them is real.
 *
 * The offer comes from the catalog rather than from copy. Hand-written copy here
 * is not a stale-sentence risk but a promise that fails when accepted — the UX
 * spec's own example names four capabilities and this catalog holds one.
 */
export function NoCatalogMatch({ question }: CannotAnswerProps) {
  const suggestion = suggestedQuestion()

  return (
    <Shell question={question}>
      <p style={styles.body}>
        I can&rsquo;t answer that one. It isn&rsquo;t a question I can look up &mdash; which is about
        what I can be asked, not about your records. Nothing is missing from them.
      </p>

      {suggestion === null ? (
        // A registry with nothing in it. Offering a question here would be
        // offering one that fails.
        <p style={styles.body}>There are no questions I can answer yet.</p>
      ) : (
        <p style={styles.body}>
          Here is one I can answer:{' '}
          <AskLink question={suggestion.text}>{suggestion.text}</AskLink>
        </p>
      )}
    </Shell>
  )
}

/**
 * AD-7, as amended 2026-08-12 — the answer could not be grounded.
 *
 * "A rejected answer is never shown and never repaired: the surface says plainly
 * that no answer could be grounded, and the board member may ask again."
 *
 * This is the system working, and the copy says so. The model wrote a figure the
 * rows did not support and the validator refused it — which is the guarantee
 * this product is built on, visible for once. It is deliberately not an apology
 * for an outage: nothing is down.
 *
 * The retry is the reader's because an automatic one would re-run the catalog
 * entry and write a second `query_log` row for one question, which is the whole
 * reason AD-7 was amended.
 */
export function AnswerRefused({ question }: CannotAnswerProps) {
  return (
    <Shell question={question}>
      <p style={styles.body}>
        I couldn&rsquo;t show you an answer I can back with the records, so I haven&rsquo;t shown one.
        Everything is working &mdash; the check that compares an answer against the rows it came from
        did its job. You can ask again.
      </p>
      <p style={styles.body}>
        <AskLink question={question}>Ask again</AskLink>
      </p>
    </Shell>
  )
}

/**
 * UX-DR18 — the question was answerable and the system failed.
 *
 * "Distinct from no-catalog-match; question retained on screen, retry offered,
 * no partial answer shown."
 *
 * The retry re-asks *this* question rather than returning to an empty field,
 * which costs nothing to implement because the question is in the URL.
 */
export function ServiceUnavailable({ question }: CannotAnswerProps) {
  return (
    <Shell question={question}>
      <p style={styles.body}>
        I couldn&rsquo;t reach the records just now. That&rsquo;s a fault on my side, not a problem
        with your question &mdash; it&rsquo;s one I can answer.
      </p>
      <p style={styles.body}>
        <AskLink question={question}>Try again</AskLink>
      </p>
    </Shell>
  )
}

/**
 * The inline-token pattern the other surfaces use, per
 * `core/design/no-raw-values.test.ts`.
 *
 * `minHeight`/`minWidth` at 44 on the actions: UX-DR20 sets 24x24 as the floor
 * and 44x44 on the phone surface, and story 3.6b needed a review round to catch
 * a control pinned on one dimension only. `display: inline-block` so those
 * apply at all — they do nothing on an inline element.
 */
const styles = {
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-row)',
    alignItems: 'flex-start',
  },
  question: {
    fontSize: 'var(--type-scale-title)',
    margin: 0,
  },
  body: {
    margin: 0,
    maxWidth: '60ch',
  },
  action: {
    display: 'inline-block',
    color: 'var(--color-ink)',
    minHeight: '44px',
    minWidth: '44px',
    padding: 'var(--space-row)',
    border: 'var(--component-rule-hairline) solid var(--color-rule-strong)',
  },
} as const
