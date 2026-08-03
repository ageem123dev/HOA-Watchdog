'use server'

import { auth } from '@/adapters/auth/auth'
import { createPostgresDocumentRepository } from '@/adapters/db/document-repository-postgres'
import { createS3DocumentStore } from '@/adapters/storage/document-store-s3'
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
  if (uploaderId === undefined) {
    return { outcomes: [], error: 'Your session has expired. Sign in again to upload.' }
  }

  const selected = formData.getAll('documents').filter((entry): entry is File => entry instanceof File)
  const chosen = selected.filter((file) => file.size > 0 || file.name !== '')

  if (chosen.length === 0) {
    return { outcomes: [], error: 'Choose at least one file to upload.' }
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
    // The real error goes to the server log, never to the page — its text can
    // name a bucket, a path, or a library. The treasurer gets the per-file
    // outcome instead.
    onError: (error, filename) => {
      console.error(`[upload] ${filename} could not be ingested`, error)
    },
  })

  return { outcomes, error: null }
}
