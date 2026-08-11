import { redirect } from 'next/navigation'

import { NoCatalogMatchError } from '@/adapters/agent/chat-client'
import { auth } from '@/adapters/auth/auth'
import { entryFor } from '@/catalog/registry'
import { SIGN_IN_ROUTE } from '@/core/auth/route-policy'
import { AnswerNotGrounded } from '@/core/answer/grounded-answer'
import { AnswerView } from './answer-view'
import { askOracle } from './ask'
import { questionFrom } from './question'

export const metadata = { title: 'Ask — Fiduciary Watchdog' }

/**
 * The Oracle (epic story 3.6b, UX-DR6 and UX-DR11).
 *
 * The first surface in this product where a board member sees an answer, and the
 * last point at which AD-7 can stop one being shown. Everything Epic 3 built
 * arrives here: the catalog runs, the provenance row is written, the model
 * chooses and narrates, and the validator decides whether the sentence may
 * appear.
 *
 * ## The question arrives already asked
 *
 * UX-DR7: submitting from the dashboard "navigates to the Oracle with the
 * question already sent — no intermediate empty state, no second submit". So the
 * question is a search parameter and the turn runs during render. Story 3.6c
 * builds the field that puts it there; until then this is reachable by URL,
 * which is enough to prove the three layers.
 *
 * ## Where the SQL comes from
 *
 * `entryFor` — the catalog, not the provenance log. AD-14 is what makes those
 * the same text: a published version's SQL is frozen and `published-versions.json`
 * fails the build if it moves, so `dues_status@1` here is `dues_status@1` as it
 * ran. The log records *when*; the catalog records *what*.
 *
 * **This file is a deliberate third reader of the registry.**
 * `core/tools/sole-data-path.test.ts` names them one by one for exactly this
 * reason — reaching the *executor* is the ability to run a query and still has
 * one door, while reaching the *registry* is knowing what an entry is. Reading
 * SQL to show a board member is knowing.
 */
export default async function OraclePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>
}) {
  const session = await auth()
  if (!session?.user) redirect(SIGN_IN_ROUTE)

  const { q } = await searchParams
  const question = questionFrom(q)

  if (question === '') {
    // Not an error, and not an empty answer either. Story 3.6c gives this a
    // field to type in; today it is the honest state of a page reached without
    // a question.
    return (
      <main>
        <h1>Ask</h1>
        <p>Ask a question about the association&rsquo;s records to see an answer here.</p>
      </main>
    )
  }

  const actorId = session.user.id ?? ''

  // The turn is awaited inside the `try`; **the JSX is built outside it**.
  // React does not render a component when its element is constructed, so a
  // `return <AnswerView />` inside a `try` catches nothing that happens during
  // rendering — the block would promise a safety it does not have. Raised by
  // eslint, and correct.
  let turn: Awaited<ReturnType<typeof askOracle>> | null = null
  let sql = ''
  let failure: unknown = null

  try {
    turn = await askOracle({ question, actorId })
    // **Inside the `try`, deliberately.** `entryFor` throws
    // `UnknownCatalogEntryError` for an id this gateway does not hold, which is
    // exactly what a version skew between the two runtimes looks like — the
    // agent answering from a catalog this deploy has not caught up with. Outside
    // the block it crashed the page instead of rendering the honest failure the
    // rest of this function exists to produce. Raised by Argus.
    sql = entryFor(turn.entryId, turn.version).sql
  } catch (error) {
    turn = null
    failure = error
  }

  if (turn === null) {
    // **Story 3.7 owns these surfaces**, and the epic keeps them apart on
    // purpose: "no-catalog-match and service-unavailable as distinct, honest
    // states". What matters here is that they are already distinct in the code,
    // so 3.7 has two things to render rather than one lump — and that the
    // question stays on screen in every one of them, per UX-DR11.
    return (
      <main>
        <h1>{question}</h1>
        <p>{explain(failure)}</p>
      </main>
    )
  }

  return (
    <main>
      <AnswerView
        question={turn.question}
        answer={turn.answer}
        rows={turn.rows}
        entryId={turn.entryId}
        version={turn.version}
        sql={sql}
      />
    </main>
  )
}

/**
 * The honest sentence for each failure, pending story 3.7's real surfaces.
 *
 * Deliberately never a partial answer. UX: "Never present a partial answer",
 * and an ungrounded one is the failure this entire epic exists to prevent —
 * shipping it on the first day anybody can see the page would be the worst
 * possible time.
 */
function explain(error: unknown): string {
  if (error instanceof NoCatalogMatchError) {
    // The most likely daily failure, per the UX spec, and the one where the
    // wrong words do real harm: never imply the records are missing when it is
    // the question that is not supported.
    return "I can't answer that one from the records I can query."
  }

  if (error instanceof AnswerNotGrounded) {
    // AD-7 refused the answer. A board member is told nothing was shown rather
    // than shown something unverified.
    return 'I could not produce an answer I can show the records for, so I have not shown one.'
  }

  return 'The records could not be reached just now.'
}
