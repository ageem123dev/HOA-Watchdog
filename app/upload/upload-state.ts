import type { IngestOutcome } from '@/core/ingestion/ingest'

/**
 * The shape the upload form holds between submissions.
 *
 * Kept out of `actions.ts` deliberately: a `'use server'` module may export only
 * async functions, so a shared constant and a type have to live beside it rather
 * than in it.
 */
export interface UploadState {
  readonly outcomes: readonly IngestOutcome[]
  /** Set only when the request itself could not proceed, not when a file was refused. */
  readonly error: string | null
}

export const EMPTY_UPLOAD_STATE: UploadState = { outcomes: [], error: null }
