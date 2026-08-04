import { Pool } from 'pg'

import type {
  DocumentRepository,
  NewDocument,
  RecordedDocument,
} from '../../core/ports/document-repository'
import { readWriterDatabaseUrl } from '../auth/env'

/**
 * The `DocumentRepository` port backed by Postgres.
 *
 * Reached through the **writer** role (AD-4, AC1). The SELECT-only
 * `watchdog_reader` exists for the LLM-driven query path and cannot write here
 * even if it were handed this code — `migrations/document.test.ts` asserts that.
 *
 * The interesting decision in this file is one statement long: `on conflict do
 * nothing`. Asking "do we already hold these bytes?" with a SELECT and then
 * inserting means two uploads arriving together both read before either writes,
 * both conclude the hash is new, and both insert. In a product whose headline
 * feature is duplicate-invoice detection, an ingestion path that manufactures
 * duplicates under concurrency is the defect it exists to find. Only the
 * database can settle it, which is why `document_content_hash_unique` exists and
 * why this adapter defers to it rather than reimplementing it.
 */

let sharedPool: Pool | null = null

/** One pool per process, built on first use — see the `next build` note in `../auth/env.ts`. */
function getPool(): Pool {
  if (sharedPool === null) {
    sharedPool = new Pool({
      connectionString: readWriterDatabaseUrl(),
      max: 5,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 10_000,
    })

    // `pg` emits `error` on the pool when an *idle* client fails. That event has
    // no request to reject, so with no listener Node treats it as unhandled and
    // terminates the process — an upload should not take the gateway down
    // because the database recycled a connection nobody was using.
    sharedPool.on('error', (error) => {
      console.error('[document-repository] idle client error; the pool will discard it', error)
    })
  }

  return sharedPool
}

export interface PostgresDocumentRepositoryOptions {
  /** Injected by tests; production uses the shared pool. */
  readonly pool?: Pool
}

export function createPostgresDocumentRepository(
  options: PostgresDocumentRepositoryOptions = {},
): DocumentRepository {
  const pool = () => options.pool ?? getPool()

  return {
    async record(document: NewDocument): Promise<RecordedDocument> {
      // One statement, so there is no window between deciding and inserting.
      // `do nothing` returns no row when the hash is already present, which is
      // how "already held" is learned — from the constraint, not from a guess.
      const inserted = await pool().query<{ id: string }>(
        `insert into document
           (content_hash, storage_key, filename, content_type, byte_size, uploaded_by)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (content_hash) do nothing
         returning id`,
        [
          document.contentHash,
          document.storageKey,
          document.filename,
          document.contentType,
          document.byteSize,
          document.uploadedBy,
        ],
      )

      const created = inserted.rows[0]
      if (created !== undefined) return { id: created.id, alreadyHeld: false }

      // Already held. Read back the existing id so the caller can replace that
      // document's derived rows — handing back a new id would replace the wrong
      // document's data.
      //
      // Note what is *not* updated: the filename stays as first recorded. The
      // bytes are the document (AD-13), so a second upload under another name is
      // the same document, and overwriting the name would rewrite history for
      // whoever filed it first.
      const existing = await pool().query<{ id: string }>(
        'select id from document where content_hash = $1',
        [document.contentHash],
      )

      const row = existing.rows[0]
      if (row === undefined) {
        // Neither inserted nor found: the row was deleted between the two
        // statements. Rare, but reporting a phantom success here would tell the
        // treasurer their document is held when nothing holds it.
        throw new Error(
          `document ${document.contentHash} was neither inserted nor found; it may have been deleted concurrently`,
        )
      }

      return { id: row.id, alreadyHeld: true }
    },
  }
}
