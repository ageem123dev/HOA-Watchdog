import { Pool } from 'pg'

import type {
  DocumentRepository,
  ExtractionClaim,
  ExtractionState,
  HeldDocument,
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

    async findById(id: string): Promise<HeldDocument | null> {
      // Only what deferred extraction needs: where the bytes are and how to
      // read them. The filename and uploader are the surface's business, and a
      // narrower row is one fewer thing to accidentally hand to a model.
      const { rows } = await pool().query<{
        id: string
        storage_key: string
        content_type: string
        extraction_state: ExtractionState
      }>(
        'select id, storage_key, content_type, extraction_state from document where id = $1',
        [id],
      )

      const row = rows[0]
      if (row === undefined) return null

      return {
        id: row.id,
        storageKey: row.storage_key,
        contentType: row.content_type,
        extractionState: row.extraction_state,
      }
    },

    async claimForExtraction(id: string, ttlSeconds: number): Promise<ExtractionClaim | null> {
      // One statement, so acquisition is atomic across instances without a
      // transaction to hold open across the provider call. Postgres evaluates
      // the predicate and the write together, so two callers racing this cannot
      // both match.
      //
      // `now()` is the database's clock deliberately. Comparing against a
      // timestamp the application supplies would give every instance its own,
      // and clock skew would decide who owns a document.
      const { rows } = await pool().query<{ extraction_claim_token: string }>(
        `update document
            set extraction_claim_token = gen_random_uuid(),
                extraction_claim_expires_at = now() + make_interval(secs => $2)
          where id = $1
            and extraction_state = 'held'
            and (extraction_claim_token is null or extraction_claim_expires_at <= now())
        returning extraction_claim_token`,
        [id, ttlSeconds],
      )

      const row = rows[0]

      // No row means someone else holds a live claim, or the document is not
      // `held` and therefore has nothing left to extract. Both are "not yours",
      // and the caller must not call the provider either way.
      if (row === undefined) return null

      return { documentId: id, token: row.extraction_claim_token }
    },

    async releaseExtractionClaim(claim: ExtractionClaim): Promise<void> {
      // Matching token required. Without it, a stale claimant returning late
      // would hand a live document to the next caller mid-extraction.
      await pool().query(
        `update document
            set extraction_claim_token = null, extraction_claim_expires_at = null
          where id = $1 and extraction_claim_token = $2`,
        [claim.documentId, claim.token],
      )
    },

    async markExtractionState(
      id: string,
      state: Exclude<ExtractionState, 'read'>,
    ): Promise<void> {
      // Parameterised, so the closed vocabulary is enforced by
      // `document_extraction_state_known` rather than by string building here.
      // If a value ever escapes the type, the database refuses it with 23514
      // instead of storing a state nothing can render.
      await pool().query('update document set extraction_state = $2 where id = $1', [id, state])
    },
  }
}
