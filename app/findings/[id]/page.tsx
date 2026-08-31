import { notFound, redirect } from 'next/navigation'

import { auth } from '@/adapters/auth/auth'
import { createFindingReader } from '@/adapters/db/finding-reader-postgres'
import { SIGN_IN_ROUTE } from '@/core/auth/route-policy'
import { toFindingDetail } from '@/core/findings/detail-view'
import { markFindingReviewed } from '../actions'
import { FindingDetailPanel } from './detail-panel'

export const metadata = { title: 'Finding — HOA Watchdog' }

/**
 * One finding, and the only action in the pilot (AC1, AC2, AC6, AC8, AC9).
 *
 * `/findings/[id]` is protected without being listed anywhere: `PUBLIC_ROUTES`
 * is an allow-list and the decision is deny-by-default, so a route nobody
 * thought about is closed rather than open. The check below is the second lock,
 * matching the dashboard, the upload page and quarantine.
 *
 * **The guard runs before the finding is read** (AC9), not after. Redirecting
 * afterwards would still have put a query for a vendor's name and an amount on
 * the wire, and nothing visible from a browser would say so.
 *
 * **An id that resolves to nothing is a 404** (AC8), never a detail page with
 * empty fields — a page shaped like a finding is a claim that there is one. The
 * reader answers `null` for both an unknown id and a malformed one, which is the
 * honest answer to "is there a finding here" in either case.
 */
export default async function FindingPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()

  if (session?.user === undefined || session.user === null) redirect(SIGN_IN_ROUTE)

  const { id } = await params
  const finding = await createFindingReader().byId(id)

  if (finding === null) notFound()

  return <FindingDetailPanel view={toFindingDetail(finding)} markReviewed={markFindingReviewed} />
}
