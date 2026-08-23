/**
 * A re-import raises no alert twice (story 5.7, Task 5 — AC5).
 *
 * ## Why this needed its own file when the suppression already exists
 *
 * AD-13 already says alerts are keyed on `(finding_type, subject_id, period)`
 * "so re-processing is a no-op", and that is already proven over a **re-upload**
 * — the same treasurer sending the same file twice. Story 5.7 introduces a
 * second way for the same document to be processed again, and AC5 asks for the
 * suppression to be proven over *that*, because it is a different trigger
 * reaching the same code by a different route.
 *
 * The failure this exists to prevent is concrete and unusually bad: a treasurer
 * fixes a column mapping, and the board receives a second copy of every
 * duplicate-invoice warning they already read and acted on. The story says it
 * outright — that would be a worse failure than the mapping being wrong.
 *
 * ## The fakes model the rule; they do not replace the proof of it
 *
 * Suppression lives in two places. `awaitingAlert` excludes findings that
 * already have a successful delivery — that exclusion is SQL, and
 * `finding-reader-postgres.test.ts` is what proves the SQL implements it. And
 * `claim` refuses a finding another run owns.
 *
 * The ledger here is the source of truth and the reader consults it, which is
 * the same shape as the real query. What this file proves is that a re-import
 * **routes through** that mechanism rather than around it — the thing that could
 * plausibly break, because a re-import is new. It does not re-prove the SQL.
 *
 * **Which of the two actually holds here, measured rather than assumed.** This
 * comment first claimed the reader's exclusion was doing the work, and that "a
 * fake reader that ignored the ledger would prove nothing at all". Mutating the
 * fake reader to always offer the finding disproved it: every test still passed,
 * because `claim` refuses a finding already delivered and the send never
 * happens. So suppression here is proven at the **claim**, and the last test
 * below pins that deliberately — the two mechanisms are independent, and a
 * re-import must not get past either. Stated because a test file that describes
 * the wrong mechanism is how the right one gets removed later as redundant.
 *
 * ## The mail sender is the assertion
 *
 * AC5 asks for "a mail sender that fails the test if called for a finding
 * already raised", so it throws rather than counting. A counter compared at the
 * end says *how many* went; a sender that refuses says *which one should not
 * have*, at the moment it is asked, with the finding named.
 */

import { describe, expect, it, vi } from 'vitest'

import { ingest, type IngestDependencies } from '../ingestion/ingest'
import type { FindingDetail } from '../ports/finding-reader'
import { POSSIBLE_DUPLICATE_INVOICE } from '../findings/finding-view'
import type { MappingStore } from '../ports/mapping-store'
import type { Reimportable } from '../ports/reimport-candidates'
import { readHeadings } from '../extraction/headings'
import { shapeKey, type SavedMapping } from './saved'
import { reimport } from './reimport'

const TREASURER = 'director-1'
const CSV = 'Txn Date,Descr,Amt\r\n2026-03-01,Willow Creek Landscaping,1240.00\r\n'

const shapeOf = (text: string) => {
  const rows = text.trim().split(/\r?\n/).map((line) => line.split(','))
  const headings = readHeadings(rows)

  expect(headings.ok, 'fixture must have readable headings').toBe(true)
  return shapeKey('deposit', headings.ok ? headings.headings : [])
}

const MAPPING: SavedMapping = {
  savedBy: TREASURER,
  kind: 'deposit',
  shape: shapeOf(CSV),
  mapping: {
    kind: 'deposit',
    columns: 3,
    pairings: [
      { target: 'date', position: 1 },
      { target: 'description', position: 2 },
      { target: 'amount', position: 3 },
    ],
  },
}

/**
 * Shaped as `notify-findings.test.ts` shapes it, because `toAlertEmail` reads
 * the evidence to build the message - a stub with three string fields produced
 * no email and therefore no send, and the control test below is what caught it.
 */
const FINDING: FindingDetail = {
  id: 'finding-1',
  findingType: POSSIBLE_DUPLICATE_INVOICE,
  subjectId: '0199a0f0-0000-7000-8000-0000000000ff',
  period: { from: '2026-03-01', until: '2026-04-01' },
  evidence: {
    invoicesChecked: 12,
    pairs: [{ vendorName: 'Willow Creek Landscaping', amount: '1240.00', matchReason: 'exact' }],
  },
  raisedOn: '2026-03-11',
  reviewed: null,
}

const DOCUMENT: Reimportable = {
  id: 'doc-1',
  storageKey: 'key/doc-1',
  filename: 'march.csv',
  contentType: 'text/csv',
}

/**
 * One world shared by the import and the re-import, because the whole claim is
 * about what the second run remembers of the first.
 */
function world() {
  /** Findings with a successful delivery. The real exclusion is on this. */
  const delivered = new Set<string>()
  const sentTo: string[] = []
  const refusals: string[] = []

  const mail = {
    send: vi.fn(async (message: { readonly subject: string }) => {
      // AC5's "fails the test if called for a finding already raised". It
      // records *and* throws: the recording is what lets the assertion name the
      // finding, and the throw is what stops a silent second delivery.
      if (delivered.has(FINDING.id)) {
        refusals.push(FINDING.id)
        throw new Error(`a second alert was sent for ${FINDING.id}: ${message.subject}`)
      }
      sentTo.push(FINDING.id)
    }),
  }

  const deps = {
    mappings: {
      find: vi.fn(async (_who: string, _kind: string, shape: string) =>
        shape === MAPPING.shape ? MAPPING : null,
      ),
      save: vi.fn(async () => null),
    } satisfies MappingStore,
    store: {
      get: vi.fn(async () => new TextEncoder().encode(CSV)),
      put: vi.fn(async () => undefined),
    },
    repository: {
      findById: vi.fn(async () => null),
      record: vi.fn(async () => ({ id: 'doc-1', alreadyHeld: true })),
      markExtractionState: vi.fn(async () => undefined),
      claimForExtraction: vi.fn(async () => undefined),
      releaseExtractionClaim: vi.fn(async () => undefined),
    },
    extractions: {
      replace: vi.fn(async () => undefined),
      findByDocument: vi.fn(async () => []),
    },
    // The exclusion the SQL performs, modelled: a finding already delivered is
    // not awaiting an alert. Consulting `delivered` is the point — a reader that
    // always returned the finding would make this file prove nothing.
    findingReader: {
      awaitingAlert: vi.fn(async () => (delivered.has(FINDING.id) ? [] : [FINDING])),
      unreviewed: vi.fn(async () => ({ findings: [], total: 0 })),
    },
    alerts: {
      claim: vi.fn(async (findingId: string) => !delivered.has(findingId)),
      recordSent: vi.fn(async (findingId: string) => {
        delivered.add(findingId)
      }),
      recordFailure: vi.fn(async () => undefined),
    },
    // `active()`, not a per-finding read: the board cannot change inside a run.
    recipients: { active: vi.fn(async () => ['board@example.com']) },
    mail,
    baseUrl: 'https://example.test',
  } as unknown as IngestDependencies

  return { deps, delivered, sentTo, refusals, mail }
}

const upload = (deps: IngestDependencies) =>
  ingest(
    [
      {
        filename: DOCUMENT.filename,
        contentType: DOCUMENT.contentType,
        bytes: new TextEncoder().encode(CSV),
        documentKind: 'deposit',
      },
    ],
    TREASURER,
    deps,
  )

const reRun = (deps: IngestDependencies) =>
  reimport(TREASURER, 'deposit', MAPPING.shape, {
    ...deps,
    ingest,
    candidates: { importedUnder: vi.fn(async () => [DOCUMENT]) },
  })

describe('a re-import over documents that already raised findings', () => {
  it('sends the alert once, on the import that raised it', async () => {
    // The control. Without it every assertion below is satisfied by an
    // alerting path that never sends anything at all — which is exactly how a
    // suppression test passes against a broken mailer.
    const w = world()

    await upload(w.deps)

    expect(w.sentTo).toEqual([FINDING.id])
    expect(w.delivered.has(FINDING.id)).toBe(true)
  })

  it('sends no second alert when the mapping change re-imports it', async () => {
    const w = world()

    await upload(w.deps)
    const outcomes = await reRun(w.deps)

    // The document really was re-imported — otherwise "no second alert" is only
    // "nothing happened", which would pass against a re-import that did nothing.
    expect(outcomes).toEqual([
      { documentId: 'doc-1', filename: 'march.csv', outcome: 're-imported' },
    ])
    expect(w.sentTo).toEqual([FINDING.id])
    expect(w.refusals).toEqual([])
  })

  it('does not even ask the mailer, rather than asking and being refused', async () => {
    /**
     * The distinction is the whole design. Suppression at the *mailer* would
     * mean every re-import walks the backlog and builds messages it then throws
     * away — and one missed check sends them. Suppression at `awaitingAlert`
     * means the finding is never a candidate. `refusals` staying empty while
     * `send` is called exactly once is what tells the two apart.
     */
    const w = world()

    await upload(w.deps)
    const before = w.mail.send.mock.calls.length

    await reRun(w.deps)

    expect(w.mail.send.mock.calls.length).toBe(before)
    expect(before).toBe(1)
  })

  it('is suppressed by the ledger even when the reader offers the finding again', async () => {
    /**
     * Defence in depth, made explicit. `awaitingAlert` excluding delivered
     * findings is the first mechanism; `claim` refusing them is the second. A
     * reader that grew permissive - a query changed, a cache, an index dropped -
     * must not become a board receiving every old warning again.
     *
     * This is the mutation that survived when the reader was made permissive,
     * turned into the property it was silently relying on.
     */
    const w = world()
    await upload(w.deps)

    // The reader now offers the delivered finding on every read.
    const permissive = w.deps as unknown as {
      findingReader: { awaitingAlert: (limit: number) => Promise<readonly FindingDetail[]> }
    }
    permissive.findingReader.awaitingAlert = vi.fn(async () => [FINDING])

    await reRun(w.deps)

    expect(w.sentTo).toEqual([FINDING.id])
    expect(w.refusals).toEqual([])
  })

  it('still alerts a finding raised for the first time by the re-import', async () => {
    /**
     * The other direction, and it matters as much. A re-import that suppressed
     * *everything* would also pass the three assertions above — and a mapping
     * corrected from wrong columns is precisely when a real finding first
     * becomes visible. Suppression must be keyed on what was already delivered,
     * not on "this is a re-import".
     */
    const w = world()

    const outcomes = await reRun(w.deps)

    expect(outcomes[0]?.outcome).toBe('re-imported')
    expect(w.sentTo).toEqual([FINDING.id])
  })
})
