import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth, signOut as authSignOut } from '@/adapters/auth/auth'
import { createCheckedDocuments, createFindingReader } from '@/adapters/db/finding-reader-postgres'
import { QUARANTINE_ROUTE, REGISTER_ROUTE, SIGN_IN_ROUTE } from '@/core/auth/route-policy'
import { toDashboardView } from '@/core/findings/dashboard-view'
import { BrandMark } from '@/app/brand-mark'
import { AskField } from './ask-field'
import { FigureBlock } from './figure-block'
import { FindingsList } from './findings-list'

/**
 * How much of the register the dashboard reads.
 *
 * A queue, not the archive — EXPERIENCE.md: "a queue of what nobody has looked
 * at, not a list of everything ever found". The register is permanent and
 * append-only, so an unbounded read gets slower every year the association
 * runs; the list says plainly when it is showing a window, and story 4.7's
 * register is where all of it lives.
 */
const MOST_RECENT_FINDINGS = 20

/**
 * Today, in UTC, as `YYYY-MM-DD`.
 *
 * **Derived once here and passed down; nothing below this line reads a clock.**
 * That is what keeps the "as of" rule testable without mocking time inside a
 * component, and it keeps one page render from straddling midnight.
 *
 * UTC rather than the server's zone, matching every date the readers project.
 * The consequence is worth stating: a board west of Greenwich sees the month
 * roll over before their local midnight. It moves a label, never a figure.
 */
function todayInUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

export const metadata = { title: 'Dashboard — HOA Watchdog' }

async function signOut() {
  'use server'

  // Auth.js clears its own session cookie and performs the navigation. A failure
  // here propagates rather than being swallowed: a member who is told they signed
  // out on a shared computer must actually have done so.
  await authSignOut({ redirectTo: SIGN_IN_ROUTE })
}

/**
 * A placeholder that proves one thing and claims nothing else: the signed-in
 * member's identity is available server-side on an ordinary request. The real
 * dashboard — figure blocks, the ask field, the findings list — is Epic 3 and
 * later stories.
 */
export default async function DashboardPage() {
  const session = await auth()
  const user = session?.user ?? null

  // The proxy already redirects unauthenticated visitors. This is the second
  // lock: a page that reads member data must never render because a matcher
  // pattern was edited carelessly.
  if (user === null) redirect(SIGN_IN_ROUTE)

  // **After the guard, never before it.** A page that queries the register and
  // then redirects has already done the work an unauthenticated visitor asked
  // for. `app/quarantine/page.tsx` makes the same ordering explicit.
  const [queue, checked] = await Promise.all([
    createFindingReader().unreviewed(MOST_RECENT_FINDINGS),
    createCheckedDocuments().checked(),
  ])
  const view = toDashboardView(queue, checked, todayInUtc())

  return (
    <main style={styles.main}>
      {/*
        The mark, where the text eyebrow naming the product used to be. Its
        `alt` is the product name, so the heading order a screen reader walks —
        the mark, then "Dashboard" — reads the same as it did before.
      */}
      <BrandMark width={192} />
      <h1 style={styles.heading}>Dashboard</h1>
      <p style={styles.body}>
        Signed in as <strong>{user.email}</strong>.
      </p>
      {/*
        **Before the links, deliberately.** EXPERIENCE.md requires the ask field
        to be "reachable by keyboard from the top of the dashboard without
        traversing every finding", and tab order follows DOM order — so where
        this sits in the markup *is* the accessibility requirement, not a
        layout preference. UX-DR10's figure blocks and findings list land after
        it for the same reason.
      */}
      <AskField />

      {/*
        **After the ask field, and that is the accessibility requirement.**
        EXPERIENCE.md wants the field "reachable by keyboard from the top of the
        dashboard without traversing every finding", and tab order follows DOM
        order — so this position is the rule, not a layout preference.
      */}
      {view.kind === 'nothing-checked' ? null : (
        <div style={styles.figures}>
          {/*
            Narrowed rather than defaulted: `total` exists only on the findings
            variant, and `nothing-to-review` reads zero because there are none.
          */}
          <FigureBlock
            label="Unreviewed findings"
            figure={view.kind === 'findings' ? String(view.total) : '0'}
            asOf={view.asOf}
          />
          <FigureBlock
            label="Documents checked"
            figure={String(view.documentsChecked)}
            asOf={view.asOf}
          />
        </div>
      )}

      <FindingsList view={view} />

      {/*
        Shown whether or not anything is waiting. EXPERIENCE.md lists this
        surface as entered from the dashboard "when non-empty", and the queue's
        own empty state is what makes the unconditional link the better reading:
        a link that appears only when there is something behind it cannot be
        learned, and its absence is indistinguishable from having forgotten where
        the page was. The dashboard also has no other reason to query held vendor
        names, and adding one to decide whether to draw a link is a read nobody
        asked for.
      */}
      {/*
        `next/link`, not a bare anchor. This is the first internal link in the
        product, so it sets the precedent: an anchor triggers a full document
        load and discards the client router's state, where Link navigates
        client-side and prefetches. Raised in review — the accompanying claim
        that it fails `@next/next/no-html-link-for-pages` did not reproduce, but
        the navigation difference is real on its own.
      */}
      <Link href={QUARANTINE_ROUTE} style={styles.link}>
        Waiting on you
      </Link>
      {/*
        **UX-DR10 lists the register as part of this surface**, and story 4.7
        built it. Shown unconditionally, for the reason the quarantine link
        above is: a link that appears only when there is something behind it
        cannot be learned, and its absence is indistinguishable from having
        forgotten where the page was.
      */}
      <Link href={REGISTER_ROUTE} style={styles.link}>
        Reviewed register
      </Link>
      <form action={signOut}>
        <button type="submit" style={styles.control}>
          Sign out
        </button>
      </form>
    </main>
  )
}

const styles = {
  main: {
    minHeight: '100dvh',
    padding: 'var(--space-section)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-block)',
    alignItems: 'flex-start',
  },
  heading: {
    fontFamily: 'var(--type-serif)',
    fontSize: 'var(--type-scale-figure)',
    fontWeight: 600,
    margin: 0,
  },
  body: { margin: 0 },
  figures: {
    display: 'flex',
    gap: 'var(--space-section)',
    flexWrap: 'wrap',
  },
  link: { color: 'var(--color-ink)' },
  // Records action, not a call to action — never a filled button.
  control: {
    font: 'inherit',
    color: 'var(--color-ink)',
    background: 'transparent',
    border: 'var(--component-rule-hairline) solid var(--color-rule-strong)',
    borderRadius: 'var(--radius-none)',
    padding: 'var(--space-row)',
    minHeight: '44px',
    cursor: 'pointer',
  },
} as const
