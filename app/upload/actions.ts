'use server'

import { auth } from '@/adapters/auth/auth'
import {
  MAX_FILES_PER_UPLOAD,
  MAX_UPLOAD_BATCH_BYTES,
} from '@/core/ingestion/acceptance'
import { isDocumentKind } from '@/core/extraction/record'
import { createUnitCensus } from '@/adapters/db/unit-census-postgres'
import { ingest } from '@/core/ingestion/ingest'
import { ingestionDependencies } from '../ingestion-dependencies'
import type { UploadState } from './upload-state'

/**
 * The upload action.
 *
 * Everything it does with a file is decided in `core/ingestion` — what is
 * accepted, what it hashes to, where it goes, what the treasurer is told. This
 * function's whole job is to establish who is uploading, turn `FormData` into
 * bytes, and hand over.
 *
 * **The composition root moved** in story 5.7, to
 * `app/ingestion-dependencies.ts`. It stopped being "the only place the adapters
 * and the domain meet" the moment a mapping change also re-imported through
 * `ingest`: two hand-built dependency objects would drift, and every collaborator
 * missing from one of them is a step that silently does not happen.
 */

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

  // **What these documents are, declared by the person uploading them.**
  //
  // Story 5.2. It used to be an optional `type` column read per row, defaulting
  // to `statement`, which meant a file decided what it was — and a mapping
  // cannot be "for deposits" if the file decides row by row.
  //
  // Checked before a single byte is read, like the two limits below, and
  // refused rather than defaulted. A default would be the per-row rule
  // relocated: the submission would still decide, by omission.
  const declaredKind = formData.get('documentKind')

  if (!isDocumentKind(declaredKind)) {
    return {
      outcomes: [],
      error: 'Choose what kind of document this is before uploading.',
    }
  }

  /**
   * **Deposits need units, and only an assessment roll makes them.**
   *
   * `docs/upload-contract.md` carried this as advice for two epics: upload the
   * roll first, or every deposit line is held `unknown-unit`. That is the system
   * working correctly and looking broken - no error, no red text, just a screen
   * of held payments on somebody's first use of the product.
   *
   * Checked here, with the other guards, before a byte is read: a submission
   * about to be refused must not first be held in memory.
   *
   * **Only deposits.** Refusing every kind would refuse the roll too, and the
   * roll is the only thing that creates units - the trap would become permanent
   * rather than removed.
   *
   * **A failure refuses.** Not knowing whether units exist is not a reason to
   * let deposits through, and an unhandled rejection here is a generic 500 with
   * the treasurer's file selection gone.
   */
  if (declaredKind === 'deposit') {
    let ready: boolean
    try {
      ready = await createUnitCensus().hasUnits(uploaderId)
    } catch (error) {
      // The real error can name a table or a connection; it goes to the log.
      console.error('[upload] could not check whether the association holds units', error)

      return {
        outcomes: [],
        error: 'That could not be checked just now. Try again in a moment.',
      }
    }

    if (!ready) {
      return {
        outcomes: [],
        error:
          'Upload the assessment roll first. It creates the units that deposits are matched against, ' +
          'and without them every line would be held for review.',
      }
    }
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
      documentKind: declaredKind,
    })),
  )

  const outcomes = await ingest(files, uploaderId, ingestionDependencies('upload'))

  return { outcomes, error: null }
}
