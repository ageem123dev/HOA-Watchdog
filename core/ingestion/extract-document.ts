import {
  StaleExtractionClaimError,
  type DocumentRepository,
  type ExtractionState,
} from '../ports/document-repository'
import type { DocumentStore } from '../ports/document-store'
import type { ExtractionRepository } from '../ports/extraction-repository'
import type { FindingRegister } from '../ports/finding'
import type { DuesReader } from '../ports/dues-reader'
import type { InvoiceReader } from '../ports/invoice-reader'
import type { Extractor } from '../ports/extractor'
import type { PaymentRepository } from '../ports/payment-repository'
import type { Quarantine } from '../ports/quarantine'
import type { UnitDirectory } from '../ports/unit-directory'
import type { VendorDirectory } from '../ports/vendor-directory'
import { holdUnknownVendors, unstorableName } from './hold-unknown-vendors'
import { recordPayments, unstorableUnitReference } from './record-payments'
import { notifyFindings, type NotifyDependencies } from './notify-findings'
import { runDetection } from './run-detection'

/**
 * Read a document that is already held, and store what it says.
 *
 * This is the deferred half of ingestion. Story 1.5c decided the order:
 * uploading stores the bytes and returns, and extraction happens on a later
 * request the surface polls — because a model call is seconds, and a treasurer
 * uploading twenty scans should not hold one request open for minutes.
 *
 * **Only documents no deterministic parser can read come here.** CSV and Excel
 * are parsed in `core/` at upload time and never reach a provider: that is story
 * 1.5's AC2 guarantee, it costs money per document to break, and a test asserts
 * the extractor is not called for those types.
 */

export const EXTRACTION_OUTCOMES = [
  'read',
  'unreadable',
  'provider-unavailable',
  'not-found',
  'no-provider-path',
  'in-progress',
] as const

export type ExtractionOutcomeKind = (typeof EXTRACTION_OUTCOMES)[number]

export type ExtractionOutcome =
  | { readonly outcome: 'read'; readonly documentId: string; readonly records: number }
  /** The provider answered and its answer could not be trusted. A better scan may help. */
  | { readonly outcome: 'unreadable'; readonly documentId: string }
  /**
   * The provider could not answer, or the bytes could not be fetched.
   *
   * **Not `unreadable`.** The document is fine and retrying may work. Story 1.5b
   * collapsed a pair like this into one outcome and had to add a second name
   * later; 1.5c split the port's refusal in two so this distinction could
   * survive to a surface.
   */
  | { readonly outcome: 'provider-unavailable'; readonly documentId: string }
  | { readonly outcome: 'not-found'; readonly documentId: string }
  /** A type the deterministic path owns. Asking to extract it is a caller error. */
  | { readonly outcome: 'no-provider-path'; readonly documentId: string }
  /**
   * Someone else holds the claim.
   *
   * Not a failure and not a queue position — the document is `held` and being
   * read right now. This is the outcome the surface renders as "extracting",
   * which is why that is not a durable state: it is `held` plus a live claim,
   * observed from here.
   */
  | { readonly outcome: 'in-progress'; readonly documentId: string }

export interface ExtractDocumentDependencies {
  readonly repository: DocumentRepository
  /** How long a claim survives without its holder finishing. */
  readonly claimTtlSeconds?: number
  readonly store: DocumentStore
  readonly extractions: ExtractionRepository
  readonly extractor: Extractor
  /** Asked whether a name is a vendor we already know. Never asked to create one. */
  readonly vendors: VendorDirectory
  /** Where a name nobody recognises goes to wait for a human (AD-8). */
  readonly quarantine: Quarantine
  /**
   * Asked which unit a deposit reference names. Never asked to create one.
   *
   * Optional, like `vendors` was before it — and, like it, the absence is a real
   * gap rather than a neutral default: without it a deposit is read and no money
   * is recorded at all. The production call site supplies both, and a test says so.
   */
  readonly units?: UnitDirectory
  /** Where an attributed payment and a held one are written together. */
  readonly payments?: PaymentRepository
  /**
   * Duplicate detection, run once the records are stored (story 4.2).
   *
   * Optional like `units` and `payments` before them, and the absence is the
   * same real gap: without these a document is read, stored, and never checked
   * against what came before, and nothing fails.
   */
  readonly invoices?: InvoiceReader
  readonly dues?: DuesReader
  readonly findings?: FindingRegister

  /**
   * Telling the board about what detection just found (story 4.8).
   *
   * Optional for the same reason and with the same gap: absent, a finding is
   * raised and nobody is told, and nothing fails. `alert-wiring.test.ts` is
   * what keeps that honest.
   *
   * **`findingReader`, not `findings`.** The two are different capabilities and
   * `core/ports/finding.ts` argues why they must stay apart: `findings` raises,
   * this one reads, and one object holding both is a detector that could sign
   * off its own work. Naming them alike here would invite exactly that merge.
   */
  readonly findingReader?: NotifyDependencies['findings']
  readonly alerts?: NotifyDependencies['alerts']
  readonly recipients?: NotifyDependencies['recipients']
  readonly mail?: NotifyDependencies['mail']
  readonly baseUrl?: string

  readonly onError?: (error: unknown, documentId: string) => void
}

/**
 * The outcome for a document that has already finished.
 *
 * Built rather than cast. An earlier version wrote
 * `{ outcome: settled, documentId } as ExtractionOutcome`, which produced a
 * `read` result with **no `records` field** — something the type says cannot
 * exist. The `as` silenced the compiler instead of answering it, and a consumer
 * reading `.records` would have got `undefined`. Raised in review.
 *
 * The count is read back, because only the database knows it: this path did not
 * do the extraction and has nothing to count.
 */
async function settledOutcome(
  documentId: string,
  state: ExtractionState,
  deps: ExtractDocumentDependencies,
): Promise<ExtractionOutcome | null> {
  switch (state) {
    case 'held':
      // Still claimable, so a null claim really does mean someone else has it.
      return null
    case 'read': {
      const records = await deps.extractions.findByDocument(documentId)
      return { outcome: 'read', documentId, records: records.length }
    }
    case 'unreadable':
      return { outcome: 'unreadable', documentId }
    case 'provider_unavailable':
      return { outcome: 'provider-unavailable', documentId }
  }
}

/**
 * Long enough for a slow provider, short enough that a crashed run frees the
 * document while the treasurer is still watching.
 */
const DEFAULT_CLAIM_TTL_SECONDS = 300

/**
 * Types a deterministic parser owns. These never reach a provider.
 *
 * Held as the complement of the provider-backed set rather than as a second
 * hand-written list: a test asserts the two together are exactly
 * `ACCEPTED_CONTENT_TYPES`, so a type that can be uploaded can never fall
 * through both — which would be a document accepted and then never readable.
 */
const TABULAR_TYPES: ReadonlySet<string> = new Set([
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

export async function extractDocument(
  documentId: string,
  deps: ExtractDocumentDependencies,
): Promise<ExtractionOutcome> {
  try {
    const document = await deps.repository.findById(documentId)
    if (document === null) return { outcome: 'not-found', documentId }

    // Checked before the bytes are fetched, so a caller asking to extract a
    // spreadsheet costs nothing and, more importantly, cannot reach the model.
    if (TABULAR_TYPES.has(document.contentType)) {
      return { outcome: 'no-provider-path', documentId }
    }

    // Claimed before a byte is fetched or a token is spent. A lock taken around
    // the write would serialise the cheap part and let the expensive part run
    // twice -- story 1.5b shipped that shape and it was caught in review.
    const claim = await deps.repository.claimForExtraction(
      documentId,
      deps.claimTtlSeconds ?? DEFAULT_CLAIM_TTL_SECONDS,
    )

    if (claim === null) {
      // Two situations, one null. If the document has finished, say so — a
      // document that was read must not keep reporting `in-progress` to every
      // later poll. Only a `held` document that could not be claimed is
      // genuinely someone else's work in flight.
      // Re-read rather than reusing the state fetched above: another worker can
      // settle or delete the document in the window between that read and this
      // claim returning null, and reporting the stale value would resurrect the
      // very "Reading forever" bug this branch exists to fix. Raised in review.
      const current = await deps.repository.findById(documentId)
      if (current === null) return { outcome: 'not-found', documentId }

      const settled = await settledOutcome(documentId, current.extractionState, deps)

      return settled ?? { outcome: 'in-progress', documentId }
    }

    const settle = async (
      state: 'unreadable' | 'provider_unavailable',
      outcome: 'unreadable' | 'provider-unavailable',
    ): Promise<ExtractionOutcome> => {
      // Fenced, and *not* separately released.
      //
      // `markExtractionState` owns the claim from here: it clears both columns
      // for a terminal state and retains them for `provider_unavailable`, where
      // the remaining expiry is the retry cooldown. Releasing afterwards
      // cleared what it had just written, so the cooldown capped nothing —
      // found by reviewing the fix diff, which nothing had been doing.
      //
      // The fence still matters: a holder whose claim lapsed could otherwise
      // mark a document unreadable after a fresher run had already succeeded.
      await deps.repository.markExtractionState(documentId, state, { token: claim.token })

      return { outcome, documentId }
    }

    try {
      const bytes = await deps.store.get(document.storageKey)

      // A missing object is not a transient outage. Retrying cannot conjure the
      // bytes back, so telling the treasurer to wait would be a lie.
      //
      // The state stays `held`, which is the honest description of the row: we
      // have it and we have not read it. It is also imperfect — a later poll
      // will re-claim and re-fetch a document whose bytes are gone for good.
      // None of AC3's four states says "the bytes have vanished", and inventing
      // one here would put a fifth state in by the back door. Raised in review
      // and recorded as a decision rather than patched around.
      if (bytes === null) {
        await deps.repository.releaseExtractionClaim(claim)
        return { outcome: 'not-found', documentId }
      }

      const result = await deps.extractor.extract({ bytes, mediaType: document.contentType })

      if (!result.ok) {
        // The distinction story 1.5c split the port's refusal in two to preserve.
        return result.refusal === 'unavailable'
          ? await settle('provider_unavailable', 'provider-unavailable')
          : await settle('unreadable', 'unreadable')
      }

      // An empty collection is a content problem, not an infrastructure one.
      // `replace` refuses `[]`, and reaching it would report this as an outage.
      if (result.records.length === 0) return await settle('unreadable', 'unreadable')

      // The quarantine rule, shared with the upload-time path in `ingest.ts`.
      // Extraction finishes in two places and the rule is about extraction
      // finishing, so it lives in one module rather than two copies.
      // Same rule for the unit reference: a NUL raises 22021 as a parameter and
      // aborts the transaction, losing every payment in the document. Raised by
      // review -- `unitIdsFor` refused to send one, and nothing stopped it being
      // stored, which is what made the gap look closed.
      if (unstorableName(result.records) || unstorableUnitReference(result.records)) {
        return await settle('unreadable', 'unreadable')
      }

      // Held *before* the records are stored, and the order is load-bearing.
      //
      // `replace` moves the document to `read`, which settles it: no later poll
      // looks at it again. So records stored with the hold still missing is
      // silent and permanent, and nobody finds out. The other way round leaves
      // the document `held`, so the next poll re-extracts, holds again -- a
      // no-op, the database enforces that -- and stores. It heals itself.
      await holdUnknownVendors(documentId, result.records, deps)

      // Before the records are stored, for the same reason the hold is. A
      // deposit whose payments are missing after `replace` has settled the
      // document is silent and permanent; one whose payments are missing while
      // the document is still `held` is re-read by the next poll and healed.
      // `PaymentRepository.replace` is set-replacement (AD-13), so that retry
      // writes the same set rather than a second copy of it.
      await recordPayments(documentId, result.records, deps, { token: claim.token })

      // The fence goes with the write. `replace` clears the claim in the same
      // transaction as the state change, which is why nothing releases it here:
      // a second release could free a document a *later* claimant already holds.
      await deps.extractions.replace(documentId, result.records, { token: claim.token })

      // **After** the write, unlike the hold and the payments, because detection
      // reads the records back to compare them against earlier documents and
      // before `replace` they are not there to read. It therefore does not get
      // the self-healing the two above rely on, and it must not throw: the
      // document really was read, and failing the upload for a bookkeeping step
      // would report a success as a failure. `run-detection.ts` says what that
      // costs.
      await runDetection(documentId, deps)

      // **After detection, and it cannot be anywhere else:** a finding cannot be
      // mailed before it is raised. Same guarantee as the line above -- it
      // resolves rather than throwing, because the document really was read and
      // an unsent warning must not report a success as a failure.
      //
      // The cost is different from detection's, though, and `notify-findings.ts`
      // says so: a missed detection is recovered by the next upload, and a
      // missed alert is recovered by nothing. That is why a failure there is
      // recorded against the finding rather than only logged.
      // **Guarded again here, and not because `notifyFindings` throws.** It is
      // written not to, and its tests hold it to that. But this `try` reports
      // `figures-not-stored` -- and it sits *after* `replace` has committed, so
      // a rejection escaping the alerting step would tell a treasurer their
      // figures were not saved when they were, and their retry would find the
      // document already settled. The cost of the guarantee living in one file
      // is that the caller cannot see it; two lines here mean the caller does
      // not have to. Raised by CodeRabbit.
      try {
        await notifyFindings({
          // Named one by one rather than spread. `deps.findings` is a
          // `FindingRegister` and `notifyFindings` wants a `FindingReader` under
          // the same key -- spreading would hand the writer to the reader slot,
          // and both are objects so nothing would complain until runtime.
          findings: deps.findingReader,
          alerts: deps.alerts,
          recipients: deps.recipients,
          mail: deps.mail,
          baseUrl: deps.baseUrl,
          // `deps.onError` here takes a document id; `notifyFindings` hands its
          // callback a *finding* id. Both are strings, so passing it through
          // wholesale type-checks and logs one under the label of the other --
          // the defect Argus caught in `ingest.ts`. Rewrapped so the line stays
          // legible, naming both.
          onError:
            deps.onError === undefined
              ? undefined
              : (error, findingId) =>
                  deps.onError?.(
                    new Error(`alerting finding ${findingId} failed`, { cause: error }),
                    documentId,
                  ),
        })
      } catch {
        // Nowhere left to report it: reporting is what the step already does,
        // through its own `onError`. Swallowed so a success stays a success.
      }

      return { outcome: 'read', documentId, records: result.records.length }
    } catch (error) {
      // A refused write is not an outage. Expiry creates a second claimant by
      // design, so being refused means someone fresher took over — and they may
      // well have succeeded. Reporting `provider-unavailable` would tell the
      // treasurer their document is waiting when it has just been read.
      //
      // Re-read rather than guess: the winner decides the outcome, and only the
      // database knows what they decided.
      if (error instanceof StaleExtractionClaimError) {
        const current = await deps.repository.findById(documentId)

        // The document vanished between claiming it and being refused. That is
        // not "in progress" — there is nothing left to be in progress with.
        if (current === null) return { outcome: 'not-found', documentId }

        const settled = await settledOutcome(documentId, current.extractionState, deps)

        return settled ?? { outcome: 'in-progress', documentId }
      }

      deps.onError?.(error, documentId)

      // Recorded, not merely released. A release leaves `extraction_state` at
      // `held`, which `claimForExtraction` treats as immediately claimable, so
      // the next poll would re-claim at once and spend another provider call.
      // The cooldown applied to `settle`'s paths and this one skipped it —
      // which is worst exactly here, where the throw can come from `replace`,
      // *after* the provider has already been paid. Raised in review round 4.
      //
      // Swallowed deliberately, and the outer catch is not the reason. The
      // error being handled is frequently a database error, so this write can
      // fail too; letting it escape would reach the outer catch, which reports
      // through `onError` a second time — the bookkeeping failure burying the
      // original cause in the log. The claim's TTL expires on its own and frees
      // the document without needing any write to succeed.
      await deps.repository
        .markExtractionState(documentId, 'provider_unavailable', { token: claim.token })
        .catch(() => undefined)

      return { outcome: 'provider-unavailable', documentId }
    }
  } catch (error) {
    // Everything that throws here is infrastructure: the object store, the
    // database, the transport. None of it is the document's fault, so none of
    // it may render as "your scan is bad".
    //
    // `provider-unavailable` is broader than its name — it also covers a failed
    // write — and that is a deliberate consequence of AC3 fixing exactly four
    // durable states. What the treasurer needs to know is the same in each
    // case: nothing is lost, this is retryable, and it is not their document.
    deps.onError?.(error, documentId)

    return { outcome: 'provider-unavailable', documentId }
  }
}
