import type { DocumentKind } from '../extraction/record'
import { toRectangle } from '../extraction/rectangle'
import { readRows } from '../extraction/tabular'
import type { DocumentRepository } from '../ports/document-repository'
import type { DocumentStore } from '../ports/document-store'
import type { ExtractionRepository } from '../ports/extraction-repository'
import type { FindingRegister } from '../ports/finding'
import type { DuesReader } from '../ports/dues-reader'
import type { InvoiceReader } from '../ports/invoice-reader'
import type { WorkbookDecoder } from '../ports/workbook-decoder'
import type { PaymentRepository } from '../ports/payment-repository'
import type { Quarantine } from '../ports/quarantine'
import type { RollRepository } from '../ports/roll-repository'
import type { UnitDirectory } from '../ports/unit-directory'
import type { VendorDirectory } from '../ports/vendor-directory'
import { holdUnknownVendors, unstorableName } from './hold-unknown-vendors'
import { recordPayments, unstorableUnitReference } from './record-payments'
import { notifyFindings, type NotifyDependencies } from './notify-findings'
import { runDetection } from './run-detection'
import { recordRoll } from './record-roll'
import { type RejectionReason, assess } from './acceptance'
import { contentHash } from './content-hash'
import { storageKeyFor } from './storage-key'
import { readHeadings } from '../extraction/headings'
import { applyMapping } from '../mapping/apply'
import { shapeKey } from '../mapping/saved'
import type { MappingStore } from '../ports/mapping-store'

/**
 * Ingestion: the only way ledger data enters this system (AD-1).
 *
 * Two properties shape everything below.
 *
 * **One outcome per file, always.** A treasurer uploading twenty documents,
 * one of which is a `.docx`, must not lose the other nineteen (AC3). The same
 * has to hold when the cause is a transient storage error rather than the file's
 * fault, which is why a per-file `failed` outcome exists alongside the
 * rejections — a storage outage is not something to tell a board member their
 * valid PDF was rejected for.
 *
 * **Order is the safety property, not a cleanup path.** Assess → hash → key →
 * store → record:
 *
 * - Rejection happens before either port is touched, so AC4's "no partial record
 *   of that file is stored" holds by construction rather than by remembering to
 *   undo something.
 * - Store precedes record because a row pointing at bytes that are not there is
 *   worse than an object with no row. The object is self-healing — the key is
 *   the content hash, so a retry writes the same bytes to the same place — while
 *   a dangling row is a permanent lie about what the association holds.
 */

export interface IngestibleFile {
  readonly filename: string
  /** As declared by the client; the acceptance gate treats it as a claim. */
  readonly contentType: string
  readonly bytes: Uint8Array
  /**
   * What this document *is*, declared by the upload rather than read off a row.
   *
   * Story 5.2. It sat in an optional `type` column until then, defaulting to
   * `statement`, and one file could mix kinds row by row — which makes "the
   * mapping for deposits" a phrase with no referent. It is per **file**, not
   * per batch: a roll and a bank feed may be uploaded together, and each is what
   * it is.
   *
   * Not optional, and there is no default. A default would be the per-row rule
   * relocated: the file would still decide, by omission.
   */
  readonly documentKind: DocumentKind
}

export type IngestOutcome =
  /** Stored, and its figures are in the record. */
  | { readonly filename: string; readonly outcome: 'read'; readonly documentId: string }
  /**
   * Stored, but nothing here can read this type yet.
   *
   * Deliberately neither `read` — nothing read it — nor `failed`, because
   * nothing went wrong. The bytes are kept, so the reader story adds them
   * without asking the treasurer to upload anything again.
   */
  | { readonly filename: string; readonly outcome: 'stored-not-read'; readonly documentId: string }
  /**
   * It opened, and could not be read into figures.
   *
   * The bytes and the document row **are** stored — that happens before any
   * reading. What is not written is the extraction: no records are inserted,
   * and on a re-ingest none are deleted either, so a document that already had
   * a good set still has it. Carries the document id for exactly that reason.
   */
  | { readonly filename: string; readonly outcome: 'unreadable'; readonly documentId: string }
  | { readonly filename: string; readonly outcome: 'already-held'; readonly documentId: string }
  | { readonly filename: string; readonly outcome: 'rejected'; readonly reason: RejectionReason }
  /** The file was fine; something underneath was not. Retryable, and not the file's fault. */
  | { readonly filename: string; readonly outcome: 'failed' }
  /**
   * Read, but its figures could not be written. Distinct from `failed` on
   * purpose: the bytes and the document row are durable, so nothing is lost and
   * re-uploading is the wrong instruction — identical bytes come back
   * already-held and the figures are still missing. Carries the document id so
   * the write can be retried against what is already held.
   */
  | { readonly filename: string; readonly outcome: 'figures-not-stored'; readonly documentId: string }

export interface IngestDependencies {
  /**
   * Absent means no upload finds a saved mapping - exactly the behaviour of
   * every release before story 5.7. Optional so an unconfigured deploy ingests
   * rather than fails, and so the many callers that have no mapping to offer
   * need not know this exists.
   */
  readonly mappings?: MappingStore

  readonly store: DocumentStore
  readonly repository: DocumentRepository
  readonly extractions: ExtractionRepository
  /** Absent means spreadsheets are held unread rather than failing. */
  readonly workbooks?: WorkbookDecoder
  /**
   * Asked whether a vendor name is one we already know.
   *
   * Optional so the many existing callers that predate story 1.6b keep working,
   * but its absence is a real gap rather than a neutral default: without it a
   * spreadsheet's unknown vendors are stored with nobody asked about them. The
   * upload route supplies both.
   */
  readonly vendors?: VendorDirectory
  /** Where a name nobody recognises waits for a human (AD-8). */
  readonly quarantine?: Quarantine

  /**
   * Duplicate detection, run once the records are stored (story 4.2).
   *
   * Optional for the same reason as everything above it, and absent it is the
   * same real gap: an uploaded invoice is stored and never compared against what
   * came before.
   */
  readonly invoices?: InvoiceReader
  readonly dues?: DuesReader
  readonly findings?: FindingRegister

  /**
   * Telling the board about what detection just found (story 4.8).
   *
   * Optional with the same gap the three above carry: absent, a finding is
   * raised and nobody is told, and nothing fails.
   *
   * **`findingReader`, not `findings`.** They are different capabilities and
   * `core/ports/finding.ts` argues for keeping them apart -- `findings` raises,
   * this one reads, and one object holding both is a detector that could sign
   * off its own work.
   */
  readonly findingReader?: NotifyDependencies['findings']
  readonly alerts?: NotifyDependencies['alerts']
  readonly recipients?: NotifyDependencies['recipients']
  readonly mail?: NotifyDependencies['mail']
  readonly baseUrl?: string
  /**
   * Asked which unit a deposit reference names. Never asked to create one.
   *
   * Optional for the same reason as `vendors`, and with the same caveat: absent,
   * a deposit CSV is read and no money is recorded against anybody.
   */
  readonly units?: UnitDirectory
  /** Where an attributed payment and a held one are written together. */
  readonly payments?: PaymentRepository
  /**
   * Where an uploaded assessment roll becomes units, holders and assessments.
   *
   * Optional for the same reason as `units`, and with the same caveat, one step
   * earlier in the chain: absent, a roll is read and no unit is created — so
   * every deposit uploaded afterwards is held `unknown-unit` and the system
   * looks broken while behaving correctly.
   */
  readonly rolls?: RollRepository
  /**
   * Where the real error goes. It is deliberately absent from the outcome — an
   * exception's text can name a path, a bucket, or a library — but discarding it
   * entirely would make a storage outage look like bad luck to whoever is on
   * call.
   */
  readonly onError?: (error: unknown, filename: string) => void
}

async function ingestOne(
  file: IngestibleFile,
  uploadedBy: string,
  deps: IngestDependencies,
): Promise<IngestOutcome> {
  const { filename, bytes, documentKind } = file
  const assessment = assess({ contentType: file.contentType, bytes })

  if (assessment.outcome === 'rejected') {
    return { filename, outcome: 'rejected', reason: assessment.reason }
  }

  try {
    // Hashed before anything parses or extracts (AC1). The digest is the
    // document's identity, so it is computed from the bytes as uploaded and
    // nothing downstream can influence it.
    const hash = contentHash(bytes)
    const storageKey = storageKeyFor(hash)

    await deps.store.put({ key: storageKey, bytes, contentType: assessment.contentType })

    const recorded = await deps.repository.record({
      contentHash: hash,
      storageKey,
      filename,
      // The normalised type, not the declared one: browsers send
      // `text/csv; charset=utf-8`, which document_content_type_supported refuses.
      contentType: assessment.contentType,
      byteSize: bytes.length,
      uploadedBy,
    })

    // Everything above is durable now. Reading happens after, so a document
    // that cannot be read is still held and a corrected export needs no
    // re-upload — and a failed read cannot cost what was already stored.
    const reading = await read(
      assessment.contentType,
      bytes,
      documentKind,
      uploadedBy,
      deps,
    )

    if (reading === 'no-reader') {
      // Already-held wins here. The treasurer uploaded this file before, and
      // 1.4's contract is that they are told so rather than told something that
      // is also true but less useful.
      if (recorded.alreadyHeld) {
        return { filename, outcome: 'already-held', documentId: recorded.id }
      }
      return { filename, outcome: 'stored-not-read', documentId: recorded.id }
    }

    if (!reading.ok) {
      // Nothing is written and nothing is deleted. On a re-ingest the previous
      // set is still there, because replacement has not been reached.
      return { filename, outcome: 'unreadable', documentId: recorded.id }
    }

    // Replacement only now, with a complete validated set in hand. This is the
    // whole of AD-13's other half, and the reason it is not called earlier.
    //
    // Caught separately from everything above, because by this point the upload
    // has already survived: reporting a storage-layer `failed` here would tell
    // the treasurer their file was not saved when it was.
    // The same rule the deferred path applies, at the other place extraction
    // finishes. A spreadsheet's vendors are as unknown as a scan's, and epic
    // story 1.6's AC1 is about extraction completing, not about which parser
    // did it. Without this, uploading invoices as CSV was a way to put vendors
    // into the system with nobody asked about them. Raised in review.
    // Reachable, contrary to my first reading of it. `acceptance.ts` scans only
    // `bytes.subarray(0, 8192)` for a NUL, so one further into a large
    // spreadsheet arrives here untouched -- and a decoded workbook cell can
    // carry one with no NUL in the file bytes at all. Unguarded it reaches
    // `resolve`, Postgres refuses the parameter, and the upload reports
    // `figures-not-stored`: the treasurer is told their figures were not saved
    // rather than that the document could not be read.
    // A unit reference is subject to the same rule, and for the same reason: a
    // NUL raises 22021 as a parameter, which aborts the transaction and takes
    // every payment in the document with it. Raised by review, which noticed
    // that `unitIdsFor` refused to send one while nothing stopped it being
    // stored — the read-path guard is exactly what made this look covered.
    if (unstorableName(reading.records) || unstorableUnitReference(reading.records)) {
      return { filename, outcome: 'unreadable', documentId: recorded.id }
    }

    try {
      // Held before the records are stored, for the reason the deferred path
      // holds first: a hold that fails leaves nothing stored and the upload can
      // be retried, where records stored without a hold is silent.
      await holdUnknownVendors(recorded.id, reading.records, deps)

      // The half a story about `extract-document.ts` would have missed. A CSV
      // never reaches the provider path at all — it is refused there with
      // `no-provider-path` — and a bank feed is the format the pilot actually
      // uploads, so wiring only the deferred path would have recorded payments
      // for scanned slips and none for the documents that really arrive.
      // Before the payments, because a roll is what makes a payment
      // attributable. Within one document the two are exclusive — a row is a
      // deposit line or a roll row, never both — but a treasurer selecting the
      // roll and the deposits in one submission gets them in the order they
      // chose, and `ingest` processes a batch sequentially. Roll first here
      // costs nothing and is the order that works when both arrive together.
      await recordRoll(recorded.id, reading.rollRows, deps)

      await recordPayments(recorded.id, reading.records, deps)

      await deps.extractions.replace(recorded.id, reading.records)

      // After the write, because detection reads the records back to compare
      // them against earlier documents. It cannot throw: the document really was
      // ingested. See `run-detection.ts`.
      //
      // `onError` is rewrapped rather than passed through. This path's version
      // takes a **filename** as its second argument and `extract-document.ts`'s
      // takes a document id; both are strings, so handing `deps` over wholesale
      // type-checks and logs a uuid under the label `filename`. Raised by Argus,
      // and worth the four lines: the label is the only thing that makes an
      // upload error legible to whoever reads it.
      await runDetection(recorded.id, {
        invoices: deps.invoices,
        dues: deps.dues,
        findings: deps.findings,
        onError: deps.onError === undefined ? undefined : (error) => deps.onError?.(error, filename),
      })

      // After detection, because a finding cannot be mailed before it is
      // raised, and inside the same guard for the same reason: the document
      // really was ingested, and an unsent warning must not report that as a
      // failure. `notify-findings.ts` records what the failure costs instead.
      //
      // Named one by one rather than spread. `deps.findings` is a
      // `FindingRegister` and this wants a `FindingReader` under the same key --
      // spreading would hand the writer to the reader slot, and both are
      // objects so nothing would complain until runtime.
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
          findings: deps.findingReader,
          alerts: deps.alerts,
          recipients: deps.recipients,
          mail: deps.mail,
          baseUrl: deps.baseUrl,
          // Rewrapped, as the detection callback above is and for the reason it
          // records: this path's `onError` takes a **filename** and
          // `notifyFindings` hands its callback a **finding id**. Both are
          // strings, so passing it through wholesale type-checks and logs one
          // under the other's label.
          onError:
            deps.onError === undefined
              ? undefined
              : (error, findingId) =>
                  deps.onError?.(
                    new Error(`alerting finding ${findingId} failed`, { cause: error }),
                    filename,
                  ),
        })
      } catch {
        // Nowhere left to report it: reporting is what the step already does,
        // through its own `onError`. Swallowed so a success stays a success.
      }
    } catch (error) {
      deps.onError?.(error, filename)

      return { filename, outcome: 'figures-not-stored', documentId: recorded.id }
    }

    if (recorded.alreadyHeld) {
      return { filename, outcome: 'already-held', documentId: recorded.id }
    }

    return { filename, outcome: 'read', documentId: recorded.id }
  } catch (error) {
    deps.onError?.(error, filename)

    return { filename, outcome: 'failed' }
  }
}

type Reading = ReturnType<typeof readRows> | 'no-reader'

/**
 * Decode, then apply the contract.
 *
 * **The decoding is `toRectangle`'s, not this function's**, and that is story
 * 5.3's doing: the mapping wizard needs the same bytes-to-rows step for a
 * *sample*, without any of what ingestion does around it. Two copies of the
 * content-type dispatch would drift, and the drift would be silent — a format
 * ingestible but unsampleable, with nothing saying why.
 *
 * `no-reader` stays distinct from `unreadable-file` here as it always has: a
 * type nothing reads yet is *held* for a human, which is the outcome above.
 */
/**
 * Bytes to records, through the treasurer's saved column mapping if they have
 * one (story 5.7, AC2).
 *
 * The mapping goes here and nowhere else. `toRectangle` has just produced rows
 * whose first is the export's own heading row, and `applyMapping` turns exactly
 * that into a rectangle headed by the *importer's* vocabulary - which is what
 * `readRows` already expects. Everything downstream is unchanged and does not
 * know a mapping was involved.
 *
 * Async because the lookup is. That cost is one `await` at the single call site,
 * against putting the lookup where the shape is not yet known.
 */
async function read(
  contentType: string,
  bytes: Uint8Array,
  documentKind: DocumentKind,
  uploadedBy: string,
  deps: IngestDependencies,
): Promise<Reading> {
  const rectangle = toRectangle(contentType, bytes, deps.workbooks)

  if (!rectangle.ok) {
    // `empty-file` and `unreadable-file` are one outcome *here* — a document
    // with nothing in it is as unstorable as one that would not parse, and the
    // upload has always said so. The distinction exists for the sample path,
    // where the treasurer is being shown columns rather than storing anything.
    return rectangle.reason === 'no-reader'
      ? 'no-reader'
      : { ok: false, problems: [{ reason: 'unreadable-file' }] }
  }

  return readRows(await mapped(rectangle.rows, documentKind, uploadedBy, deps), documentKind)
}

/**
 * The saved mapping applied, or the rows exactly as they arrived.
 *
 * Three ways this declines to act, and each is a decision rather than an
 * oversight:
 *
 * - **No store configured.** An unconfigured deploy must ingest exactly as it
 *   did before this story, so an absent `mappings` is not an error.
 * - **No mapping for this shape.** `null` means nobody has mapped this export,
 *   which is what sends the treasurer to the wizard. Not an error either.
 * - **The store failed.** Caught, because a mapping lookup must not be able to
 *   fail an upload. The file then reads as it would with no mapping - which for
 *   a non-standard heading row is a refusal the treasurer is shown, not a wrong
 *   import they are not. Failing *open* here would mean a database blip silently
 *   turning a mapped export into an unreadable one, which is the safe direction.
 *
 * The shape key is computed from the rectangle's own headings, so a mapping can
 * only be found for the exact heading row - in the exact order - it was built
 * against. That is the whole defence against the disaster case: a mapping is a
 * list of *positions*, so one applied to a file whose columns moved reads every
 * value into the wrong field, and every value is still plausible there.
 */
async function mapped(
  rows: readonly (readonly string[])[],
  documentKind: DocumentKind,
  uploadedBy: string,
  deps: IngestDependencies,
): Promise<readonly (readonly string[])[]> {
  if (!deps.mappings) return rows

  const headings = readHeadings(rows)
  if (!headings.ok) return rows

  try {
    const saved = await deps.mappings.find(
      uploadedBy,
      documentKind,
      shapeKey(documentKind, headings.headings),
    )

    return saved ? applyMapping(rows, saved.mapping) : rows
  } catch {
    return rows
  }
}

export async function ingest(
  files: readonly IngestibleFile[],
  uploadedBy: string,
  deps: IngestDependencies,
): Promise<IngestOutcome[]> {
  const outcomes: IngestOutcome[] = []

  // Sequential on purpose. Two identical files in one batch must resolve to one
  // record and one already-held, and the database's uniqueness constraint is
  // what decides that — running them concurrently would have both racing for the
  // same insert to find out. A board uploads tens of files, not thousands.
  for (const file of files) {
    outcomes.push(await ingestOne(file, uploadedBy, deps))
  }

  return outcomes
}
