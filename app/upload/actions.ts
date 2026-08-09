'use server'

import { auth } from '@/adapters/auth/auth'
import { createPostgresDocumentRepository } from '@/adapters/db/document-repository-postgres'
import { createPostgresExtractionRepository } from '@/adapters/db/extraction-repository-postgres'
import { readWorkbook } from '@/adapters/extraction/workbook-sheetjs'
import { createPaymentRepository } from '@/adapters/db/payment-repository-postgres'
import { createQuarantine } from '@/adapters/db/quarantine-postgres'
import { createRollRepository } from '@/adapters/db/roll-repository-postgres'
import { createUnitDirectory } from '@/adapters/db/unit-directory-postgres'
import { createVendorDirectory } from '@/adapters/db/vendor-directory-postgres'
import { createS3DocumentStore } from '@/adapters/storage/document-store-s3'
import {
  MAX_FILES_PER_UPLOAD,
  MAX_UPLOAD_BATCH_BYTES,
} from '@/core/ingestion/acceptance'
import { ingest } from '@/core/ingestion/ingest'
import type { UploadState } from './upload-state'

/**
 * The upload action: the composition root for ingestion.
 *
 * This is the only place the adapters and the domain meet. Everything it does
 * with a file is decided in `core/ingestion` — what is accepted, what it hashes
 * to, where it goes, what the treasurer is told. This function's whole job is to
 * establish who is uploading, turn `FormData` into bytes, and hand over.
 */

/**
 * Built once for the process, not once per request.
 *
 * The S3 store reuses one client for its own lifetime, so constructing a store
 * per upload would open a socket pool per upload and the reuse would count for
 * nothing. Module scope is safe here precisely because neither factory reads its
 * environment at construction — that is the property `next build` depends on,
 * and both adapters have a test for it.
 */
const documentStore = createS3DocumentStore()
const documentRepository = createPostgresDocumentRepository()
const extractionRepository = createPostgresExtractionRepository()

/**
 * The vendor spreadsheet parser, behind the port, so `core/` never sees it.
 * `readWorkbook` already returns the rectangle the contract expects.
 */
const workbookDecoder = { decode: readWorkbook }

export async function uploadDocuments(
  _previous: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const session = await auth()
  const uploaderId = session?.user?.id

  // The route is protected deny-by-default, so reaching here without a session
  // should be impossible. It is checked anyway: `uploaded_by` is the audit
  // trail's actor, and a document recorded against nobody is worse than a
  // refused upload.
  //
  // Checked for substance, not merely for `undefined`. A session callback that
  // supplies `null` or an empty string would pass an `!== undefined` test, and
  // the emptiness would then surface as every file in the batch reporting
  // `failed` on a foreign-key violation — an outcome with no explanation in it.
  if (typeof uploaderId !== 'string' || uploaderId.trim() === '') {
    return { outcomes: [], error: 'Your session has expired. Sign in again to upload.' }
  }

  const selected = formData.getAll('documents').filter((entry): entry is File => entry instanceof File)
  const chosen = selected.filter((file) => file.size > 0 || file.name !== '')

  if (chosen.length === 0) {
    return { outcomes: [], error: 'Choose at least one file to upload.' }
  }

  // Both limits are checked against the declared sizes, before a single byte is
  // read. Reading first and refusing afterwards would hold the whole submission
  // in memory to decide it was too big to hold in memory.
  if (chosen.length > MAX_FILES_PER_UPLOAD) {
    return {
      outcomes: [],
      error: `Upload up to ${MAX_FILES_PER_UPLOAD} files at a time. This submission had ${chosen.length}.`,
    }
  }

  const totalBytes = chosen.reduce((running, file) => running + file.size, 0)

  if (totalBytes > MAX_UPLOAD_BATCH_BYTES) {
    return {
      outcomes: [],
      error: `Upload up to ${MAX_UPLOAD_BATCH_BYTES / (1024 * 1024)} MB at a time. Send these in smaller batches.`,
    }
  }

  const files = await Promise.all(
    chosen.map(async (file) => ({
      filename: file.name,
      contentType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    })),
  )

  const outcomes = await ingest(files, uploaderId, {
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
    // The line that makes an assessment roll do anything at all. Without it a
    // roll is read, its extraction rows are stored, and no unit is created — so
    // every deposit uploaded afterwards is held `unknown-unit`.
    rolls: createRollRepository(),
    // The real error goes to the server log, never to the page — its text can
    // name a bucket, a path, or a library. The treasurer gets the per-file
    // outcome instead.
    // The filename is client-supplied, so it is passed as a structured field
    // rather than interpolated into the line. Interpolating it lets a filename
    // containing a newline forge log entries, and puts a name or an address —
    // the very thing the hash-derived storage key keeps out of object storage —
    // into the log store verbatim.
    onError: (error, filename) => {
      console.error('[upload] a file could not be ingested', { filename, error })
    },
  })

  return { outcomes, error: null }
}
