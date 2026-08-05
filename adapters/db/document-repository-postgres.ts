import { Pool } from 'pg'

import type {
  DocumentRepository,
  ExtractionClaim,
  ExtractionState,
  HeldDocument,
  NewDocument,
  RecordedDocument,
} from '../../core/ports/document-repository'
import { StaleExtractionClaimError } from '../../core/ports/document-repository'
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

/**
 * How long a document rests after the provider could not be reached.
 *
 * Not a punishment and not a queue — just a floor on how often one document can
 * cost a provider call. Short enough that a treasurer reloading the page a
 * minute later gets a real retry.
 */
const RETRY_COOLDOWN_SECONDS = 60

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
                extraction_claim_expires_at = now() + make_interval(secs => $2),
                -- Claiming a retryable document returns it to the running
                -- state, which means "we have it and have not read it" -- true
                -- again the moment a retry starts. One state for in-flight
                -- rather than two.
                extraction_state = 'held'
          where id = $1
            and extraction_state in ('held', 'provider_unavailable')
            and (extraction_claim_token is null or extraction_claim_expires_at <= now())
        returning extraction_claim_token`,
        [id, ttlSeconds],
      )

      const row = rows[0]

      // No row means someone else holds a live claim, or the document has
      // finished with an outcome retrying cannot change. Both are "not yours",
      // and the caller must not call the provider either way.
      //
      // `provider_unavailable` is claimable on purpose: it means the document is
      // fine and the infrastructure was not, so a retry is the whole point. It
      // is the only failure state that is — `read` is done and `unreadable`
      // needs a better scan, and re-running either would just spend money to
      // reach the same answer.
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
      fence?: { readonly token: string },
    ): Promise<void> {
      // Parameterised, so the closed vocabulary is enforced by
      // `document_extraction_state_known` rather than by string building here.
      // If a value ever escapes the type, the database refuses it with 23514
      // instead of storing a state nothing can render.
      //
      // The claim is cleared alongside the state: a document that has finished
      // must not still look claimed, or the surface renders it as extracting
      // forever.
      // `provider_unavailable` keeps its claim for a cooldown rather than
      // clearing it.
      //
      // That state stays claimable on purpose — it is the retryable one — but
      // nothing capped how often. An authenticated caller could POST the
      // endpoint repeatedly and buy a fresh provider call every time, because
      // the poller stopping is a client-side courtesy and not a server-side
      // limit. Holding the claim until the cooldown expires makes the existing
      // machinery do the capping: the document is simply not claimable yet.
      // Raised in review.
      //
      // It does not render as "extracting" while it cools: the surface derives
      // that from `held` plus a live claim, and this row is no longer `held`.
      const cooling = state === 'provider_unavailable'

      // One statement with the fence appended, rather than two near-identical
      // strings. The duplication is how the bug below hid: only one copy would
      // have been fixed.
      //
      // The expiry follows the token. Keeping the existing token while setting
      // an expiry leaves a NULL token with a non-NULL expiry on an unclaimed
      // document, which `document_extraction_claim_complete` refuses — so an
      // unfenced `provider_unavailable` write failed with 23514. Raised in
      // review.
      const sql = `update document
              set extraction_state = $2,
                  extraction_claim_token = case
                    when $3 and extraction_claim_token is not null then extraction_claim_token
                    else null
                  end,
                  extraction_claim_expires_at = case
                    when $3 and extraction_claim_token is not null
                      then now() + make_interval(secs => $4)
                    else null
                  end
            where id = $1`

      const { rowCount } = await pool().query(
        fence === undefined ? sql : `${sql} and extraction_claim_token = $5`,
        fence === undefined
          ? [id, state, cooling, RETRY_COOLDOWN_SECONDS]
          : [id, state, cooling, RETRY_COOLDOWN_SECONDS, fence.token],
      )

      if (fence !== undefined && rowCount === 0) {
        throw new StaleExtractionClaimError(id)
      }
    },
  }
}
