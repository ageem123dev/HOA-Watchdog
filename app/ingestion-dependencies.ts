import { createPostgresDocumentRepository } from '@/adapters/db/document-repository-postgres'
import { createPostgresExtractionRepository } from '@/adapters/db/extraction-repository-postgres'
import { createDuesReader } from '@/adapters/db/dues-reader-postgres'
import { createFindingAlertLedger, createBoardRecipients } from '@/adapters/db/finding-alert-postgres'
import { createFindingRegister } from '@/adapters/db/finding-postgres'
import { createFindingReader } from '@/adapters/db/finding-reader-postgres'
import { createInvoiceReader } from '@/adapters/db/invoice-reader-postgres'
import { createMappingStore } from '@/adapters/db/mapping-store-postgres'
import { createPaymentRepository } from '@/adapters/db/payment-repository-postgres'
import { createQuarantine } from '@/adapters/db/quarantine-postgres'
import { createRollRepository } from '@/adapters/db/roll-repository-postgres'
import { createUnitDirectory } from '@/adapters/db/unit-directory-postgres'
import { createVendorDirectory } from '@/adapters/db/vendor-directory-postgres'
import { createAlerting } from '@/adapters/mail/mail-sender-http'
import { readWorkbook } from '@/adapters/extraction/workbook-sheetjs'
import { createS3DocumentStore } from '@/adapters/storage/document-store-s3'
import type { IngestDependencies } from '@/core/ingestion/ingest'

/**
 * Everything `ingest` needs, composed once (story 5.7).
 *
 * ## Why this is shared rather than written per call site
 *
 * Story 5.7 gave `ingest` a second caller: a mapping change re-imports the
 * documents it affects. Composing that caller's dependencies separately would
 * have been the easy thing and a silent data defect — every collaborator omitted
 * is a step the re-import *skips*, and each one fails quietly:
 *
 * - no `payments` and a re-imported deposit produces extraction rows and no
 *   payments, so the money disappears from the ledger it was already in
 * - no `rolls` and a re-imported assessment roll creates no units, so every
 *   deposit afterwards is held `unknown-unit`
 * - no `findings` and a re-import erases the findings the old parse raised
 *   without raising the new ones
 * - no `alerts`/`recipients` and a genuine new finding is raised and nobody told
 *
 * None of those throws. The upload path accumulated these one story at a time —
 * 2.5, 4.2, 4.8, the roll repository — and a second call site starting from
 * `{store, repository, extractions}` would look complete and be four stories
 * behind. `ingestion-dependencies.test.ts` asserts the two callers pass the same
 * set, so a dependency added for one is added for both.
 *
 * ## The singletons are module-level on purpose
 *
 * Each `create*` opens or reuses pooled resources. Building them per request
 * would multiply connections across concurrent uploads, which is the reason
 * `notify-findings.ts` reads its recipients once per run rather than per finding.
 */

const documentStore = createS3DocumentStore()
const documentRepository = createPostgresDocumentRepository()
const extractionRepository = createPostgresExtractionRepository()
const workbookDecoder = { decode: readWorkbook }

/**
 * @param label names the caller in log lines, so an alerting misconfiguration
 * says which path hit it. It is the only thing that differs between callers.
 */
export function ingestionDependencies(label: string): IngestDependencies {
  // Resolved per call. Empty when mail is not configured, which `notifyFindings`
  // treats as "do nothing" — so an unconfigured deploy sends nothing and,
  // importantly, claims nothing either. The named error goes to the log rather
  // than being swallowed: a mailer that is silently absent is indistinguishable
  // from one that had nothing to send.
  const alerting = createAlerting((error) => {
    console.error(`[${label}] alerting is not configured`, error)
  })

  return {
    store: documentStore,
    repository: documentRepository,
    extractions: extractionRepository,
    workbooks: workbookDecoder,
    vendors: createVendorDirectory(),
    quarantine: createQuarantine(),
    // The line that makes story 2.5 real for the format the pilot uses. A CSV
    // never reaches the provider path, so this call site — not the deferred
    // one — is where a deposit bank feed becomes payments.
    units: createUnitDirectory(),
    payments: createPaymentRepository(),
    // Story 4.2, and the same shape of gap: absent, an uploaded invoice is
    // stored and never compared against what came before.
    invoices: createInvoiceReader(),
    dues: createDuesReader(),
    findings: createFindingRegister(),
    // Story 4.8. Absent, a finding is raised and nobody is told — and nothing
    // fails.
    findingReader: createFindingReader(),
    alerts: createFindingAlertLedger(),
    recipients: createBoardRecipients(),
    ...alerting,
    // The line that makes an assessment roll do anything at all. Without it a
    // roll is read, its extraction rows are stored, and no unit is created — so
    // every deposit uploaded afterwards is held `unknown-unit`.
    rolls: createRollRepository(),
    // Story 5.7. Absent, a saved mapping is never found and every non-standard
    // export goes back to the wizard the treasurer already completed.
    mappings: createMappingStore(),
    // The real error goes to the server log, never to the page — its text can
    // name a bucket, a path, or a library. The caller gets the per-file outcome
    // instead. The filename is client-supplied, so it is passed as a structured
    // field rather than interpolated: interpolating it lets a filename
    // containing a newline forge log entries, and puts a name or an address —
    // the very thing the hash-derived storage key keeps out of object storage —
    // into the log store verbatim.
    onError: (error, filename) => {
      console.error(`[${label}] a file could not be ingested`, { filename, error })
    },
  }
}
