/**
 * The document repository against a real database.
 *
 * The one thing that cannot be tested with a fake is the thing this adapter
 * exists to get right: whether "have we already got these bytes" is decided by
 * the database or by a read-then-write that two concurrent uploads can both win.
 * A fake repository answers that question however the fake was written.
 *
 * **Requires a database and skips without one**, matching `migrations/`: the
 * suite stays runnable without credentials and the skip is loud.
 */

import { Client, Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { contentHash } from '../../core/ingestion/content-hash'
import { storageKeyFor } from '../../core/ingestion/storage-key'
import { createPostgresDocumentRepository } from './document-repository-postgres'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const configured = Boolean(writerUrl)

const describeWithDatabase = configured
  ? describe
  : (describe.skip.bind(null) as unknown as typeof describe)

if (!configured) {
  console.warn(
    '\n  document-repository tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL is not set.\n' +
      '  Run `npm run migrate`, then `npm run test:db`.\n',
  )
}

const bytesFor = (label: string) => new TextEncoder().encode(`%PDF-1.7 ${label}`)

/**
 * Block until Postgres reports a backend genuinely waiting on a lock to insert
 * into `document`.
 *
 * A timer would leave the interleaving to chance, and a test that silently fails
 * to interleave passes for the wrong reason. This throws instead — if the second
 * insert never blocked, the scenario did not happen and the result means
 * nothing.
 */
const BLOCK_POLL_INTERVAL_MS = 25
const BLOCK_POLL_ATTEMPTS = 60

async function waitUntilBlockedOnInsert(client: Client): Promise<void> {
  for (let attempt = 0; attempt < BLOCK_POLL_ATTEMPTS; attempt += 1) {
    const { rows } = await client.query<{ blocked: number }>(
      // Scoped to this database: a backend on another database of the same
      // instance can be blocked on its own `document` table, and counting it
      // would let the test proceed before the interleaving it needs exists.
      `select count(*)::int as blocked
         from pg_stat_activity
        where datname = current_database()
          and wait_event_type = 'Lock'
          and query ilike 'insert into document%'`,
    )

    if ((rows[0]?.blocked ?? 0) > 0) return

    await new Promise((resolve) => setTimeout(resolve, BLOCK_POLL_INTERVAL_MS))
  }

  throw new Error(
    'the adapter’s insert never blocked, so the interleaving this test needs did not happen',
  )
}

const newDocument = (label: string, uploadedBy: string) => {
  const hash = contentHash(bytesFor(label))

  return {
    contentHash: hash,
    storageKey: storageKeyFor(hash),
    filename: `${label}.pdf`,
    contentType: 'application/pdf',
    byteSize: bytesFor(label).length,
    uploadedBy,
  }
}

describeWithDatabase('createPostgresDocumentRepository', () => {
  let pool: Pool
  let admin: Client
  let boardMemberId: string
  const repository = createPostgresDocumentRepository({
    get pool() {
      return pool
    },
  })

  beforeAll(async () => {
    pool = new Pool({ connectionString: writerUrl, max: 4 })
    admin = new Client({ connectionString: writerUrl })
    await admin.connect()

    const { rows } = await admin.query<{ id: string }>(
      `insert into board_member (email, password_hash, association_id) values ($1, 'scrypt$256$8$1$c2FsdA$aGFzaA', '00000000-0000-7000-8000-000000000001')
       returning id`,
      [`repo-test-${Date.now()}@example.test`],
    )
    boardMemberId = rows[0]!.id
  })

  afterAll(async () => {
    await admin.query('delete from document where uploaded_by = $1', [boardMemberId])
    await admin.query('delete from board_member where id = $1', [boardMemberId])
    await admin.end()
    await pool.end()
  })

  it('records a document and reports it as new', async () => {
    const result = await repository.record(newDocument(`fresh-${Date.now()}`, boardMemberId))

    expect(result.alreadyHeld).toBe(false)
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('writes every column through, so nothing is silently dropped', async () => {
    const document = newDocument(`columns-${Date.now()}`, boardMemberId)

    const { id } = await repository.record(document)
    const { rows } = await admin.query('select * from document where id = $1', [id])

    expect(rows[0]).toMatchObject({
      content_hash: document.contentHash,
      storage_key: document.storageKey,
      filename: document.filename,
      content_type: document.contentType,
      uploaded_by: boardMemberId,
    })
    expect(Number(rows[0].byte_size)).toBe(document.byteSize)
  })

  it('reports the second sighting of the same bytes as already held', async () => {
    const document = newDocument(`repeat-${Date.now()}`, boardMemberId)

    const first = await repository.record(document)
    const second = await repository.record(document)

    expect(first.alreadyHeld).toBe(false)
    expect(second.alreadyHeld).toBe(true)
  })

  it('returns the existing document id, not a new one', async () => {
    // The caller uses this id to replace derived rows. A different id there
    // means AD-13 replaces the wrong document's data.
    const document = newDocument(`same-id-${Date.now()}`, boardMemberId)

    const first = await repository.record(document)
    const second = await repository.record({ ...document, filename: 'renamed.pdf' })

    expect(second.id).toBe(first.id)
  })

  it('keeps the first filename, because the bytes are the document', async () => {
    const document = newDocument(`first-name-${Date.now()}`, boardMemberId)

    const { id } = await repository.record(document)
    await repository.record({ ...document, filename: 'later-name.pdf' })
    const { rows } = await admin.query('select filename from document where id = $1', [id])

    expect(rows[0].filename).toBe(document.filename)
  })

  it('leaves exactly one row after a repeat', async () => {
    const document = newDocument(`one-row-${Date.now()}`, boardMemberId)

    await repository.record(document)
    await repository.record(document)
    const { rows } = await admin.query('select id from document where content_hash = $1', [
      document.contentHash,
    ])

    expect(rows).toHaveLength(1)
  })

  it('resolves four simultaneous records of the same bytes to one row and one id', async () => {
    // Worth keeping, but read it for what it is: `Promise.all` does not force an
    // interleaving, so this passes whether or not the race is actually closed.
    // It was verified against a deliberately broken read-then-write
    // implementation and still passed. The test below is the one that
    // discriminates.
    const document = newDocument(`race-${Date.now()}`, boardMemberId)

    const results = await Promise.all([
      repository.record(document),
      repository.record(document),
      repository.record(document),
      repository.record(document),
    ])

    const { rows } = await admin.query('select id from document where content_hash = $1', [
      document.contentHash,
    ])

    expect(rows).toHaveLength(1)
    expect(new Set(results.map((result) => result.id)).size).toBe(1)
    expect(results.filter((result) => !result.alreadyHeld)).toHaveLength(1)
  })

  it('waits for an in-flight insert of the same bytes instead of racing it', async () => {
    // The deterministic version, and the one that earns the claim.
    //
    // Another transaction inserts the same hash and holds it uncommitted. The
    // adapter then records those bytes, and its insert blocks on the unique
    // index. We wait until Postgres reports it genuinely blocked — rather than
    // guessing with a timer — and only then commit.
    //
    // A read-then-write implementation fails here: its SELECT runs before the
    // commit and finds nothing, so it inserts, blocks, and is then handed a
    // unique violation the moment the other transaction lands.
    const document = newDocument(`interleave-${Date.now()}`, boardMemberId)
    const holder = new Client({ connectionString: writerUrl })
    await holder.connect()
    let pending: Promise<unknown> | undefined

    try {
      await holder.query('begin')
      const { rows } = await holder.query<{ id: string }>(
        `insert into document (content_hash, storage_key, filename, content_type, byte_size, uploaded_by, association_id) values ($1, $2, $3, $4, $5, $6, '00000000-0000-7000-8000-000000000001')
         returning id`,
        [
          document.contentHash,
          document.storageKey,
          'held-by-the-other-transaction.pdf',
          document.contentType,
          document.byteSize,
          document.uploadedBy,
        ],
      )
      const firstId = rows[0]!.id

      pending = repository.record(document)
      await waitUntilBlockedOnInsert(admin)
      await holder.query('commit')

      expect(await pending).toEqual({ id: firstId, alreadyHeld: true })
    } finally {
      await holder.query('rollback').catch(() => undefined)
      // Settle `pending` here as well as above. If the wait throws or the
      // assertion fails, the rollback releases the lock, the blocked insert
      // completes after the test has ended, and an unhandled rejection lands on
      // whichever unrelated test happens to be running.
      await pending?.catch(() => undefined)
      await holder.end()
    }
  }, BLOCK_POLL_INTERVAL_MS * BLOCK_POLL_ATTEMPTS + 15_000)

  it('lets a constraint violation escape rather than reporting a phantom success', async () => {
    // An unsupported content type must not come back as "recorded".
    const document = { ...newDocument(`bad-type-${Date.now()}`, boardMemberId), contentType: 'application/zip' }

    await expect(repository.record(document)).rejects.toMatchObject({ code: '23514' })
  })

  it('lets an unknown uploader escape as a foreign-key violation', async () => {
    const document = {
      ...newDocument(`bad-user-${Date.now()}`, '00000000-0000-7000-8000-000000000000'),
    }

    await expect(repository.record(document)).rejects.toMatchObject({ code: '23503' })
  })


  describe('claiming a document for extraction (story 1.5d)', () => {
    let counter = 0
    /** A fresh held document, returning its id. */
    const heldDocument = async (): Promise<string> => {
      counter += 1
      const { id } = await repository.record(
        newDocument(`claim-${Date.now()}-${counter}`, boardMemberId),
      )
      return id
    }

    const claimStateOf = async (id: string) => {
      const { rows } = await admin.query<{
        extraction_claim_token: string | null
        expired: boolean | null
      }>(
        `select extraction_claim_token,
                extraction_claim_expires_at <= now() as expired
           from document where id = $1`,
        [id],
      )
      return rows[0]!
    }

    it('gives the claim to exactly one of two callers racing it (C1, C2)', async () => {
      // The property a fake cannot demonstrate. Acquisition must be atomic
      // across *instances*, so this races two repositories on two pools.
      const documentId = await heldDocument()
      const poolA = new Pool({ connectionString: writerUrl, max: 1 })
      const poolB = new Pool({ connectionString: writerUrl, max: 1 })

      try {
        const a = createPostgresDocumentRepository({ pool: poolA })
        const b = createPostgresDocumentRepository({ pool: poolB })

        const results = await Promise.all([
          a.claimForExtraction(documentId, 60),
          b.claimForExtraction(documentId, 60),
        ])

        const winners = results.filter((claim) => claim !== null)

        expect(winners).toHaveLength(1)
        expect(winners[0]!.documentId).toBe(documentId)
      } finally {
        await Promise.all([poolA.end(), poolB.end()])
      }
    }, 30_000)

    it('refuses a second claim while the first is live', async () => {
      const documentId = await heldDocument()

      const held = await repository.claimForExtraction(documentId, 60)
      const second = await repository.claimForExtraction(documentId, 60)

      expect(held).not.toBeNull()
      expect(second).toBeNull()
    })

    it('hands an expired claim to the next caller (C3)', async () => {
      // A process that dies mid-extraction must not hold a document forever.
      const documentId = await heldDocument()

      const first = await repository.claimForExtraction(documentId, 0)
      const second = await repository.claimForExtraction(documentId, 60)

      expect(first).not.toBeNull()
      expect(second).not.toBeNull()
      expect(second!.token).not.toBe(first!.token)
    })

    it('gives each attempt its own token', async () => {
      const one = await heldDocument()
      const other = await heldDocument()

      const a = await repository.claimForExtraction(one, 60)
      const b = await repository.claimForExtraction(other, 60)

      expect(a!.token).not.toBe(b!.token)
    })

    it.each(['read', 'unreadable'] as const)(
      'does not claim a document that is %s (C8)',
      async (state) => {
        // Done, or needing a better scan. Re-running either spends money to
        // reach the same answer.
        const documentId = await heldDocument()
        await admin.query('update document set extraction_state = $2 where id = $1', [
          documentId,
          state,
        ])

        expect(await repository.claimForExtraction(documentId, 60)).toBeNull()
      },
    )

    it('does claim a document that is provider_unavailable, because that is retryable', async () => {
      // The transition the story requires: provider unavailable -> held on
      // retry. Without this the state would be terminal, and a document could
      // be permanently lost to one bad afternoon at the provider.
      const documentId = await heldDocument()
      await admin.query(
        "update document set extraction_state = 'provider_unavailable' where id = $1",
        [documentId],
      )

      expect(await repository.claimForExtraction(documentId, 60)).not.toBeNull()
    })

    it('returns a retried document to held, so there is one running state', async () => {
      const documentId = await heldDocument()
      await admin.query(
        "update document set extraction_state = 'provider_unavailable' where id = $1",
        [documentId],
      )

      await repository.claimForExtraction(documentId, 60)

      const { rows } = await admin.query<{ extraction_state: string }>(
        'select extraction_state from document where id = $1',
        [documentId],
      )
      expect(rows[0]?.extraction_state).toBe('held')
    })

    it('sets an expiry alongside the token, never a token alone', async () => {
      // The check constraint forbids one without the other. This asserts the
      // adapter satisfies it rather than leaving the constraint to catch a bug
      // in production.
      const documentId = await heldDocument()

      await repository.claimForExtraction(documentId, 60)
      const claim = await claimStateOf(documentId)

      expect(claim.extraction_claim_token).not.toBeNull()
      expect(claim.expired).toBe(false)
    })

    describe('marking a state, fenced (raised in review)', () => {
      it('records the state and clears the claim when the token is live', async () => {
        const documentId = await heldDocument()
        const claim = await repository.claimForExtraction(documentId, 60)

        await repository.markExtractionState(documentId, 'unreadable', { token: claim!.token })

        const { rows } = await admin.query<{ extraction_state: string; token: string | null }>(
          'select extraction_state, extraction_claim_token as token from document where id = $1',
          [documentId],
        )
        expect(rows[0]?.extraction_state).toBe('unreadable')
        expect(rows[0]?.token).toBeNull()
      })

      it('refuses a superseded token and changes nothing', async () => {
        // The reverse of the record-write fence: a holder whose claim lapsed
        // could otherwise mark a document unreadable after a fresher run had
        // already succeeded — overwriting a success with a stale failure.
        const documentId = await heldDocument()
        const first = await repository.claimForExtraction(documentId, 0)
        const second = await repository.claimForExtraction(documentId, 60)

        expect(second!.token).not.toBe(first!.token)

        await expect(
          repository.markExtractionState(documentId, 'unreadable', { token: first!.token }),
        ).rejects.toMatchObject({ name: 'StaleExtractionClaimError' })

        const { rows } = await admin.query<{ extraction_state: string; token: string }>(
          'select extraction_state, extraction_claim_token as token from document where id = $1',
          [documentId],
        )
        expect(rows[0]?.extraction_state).toBe('held')
        expect(rows[0]?.token).toBe(second!.token)
      })

      it('works without a fence, for callers that hold no claim', async () => {
        const documentId = await heldDocument()

        await repository.markExtractionState(documentId, 'unreadable')

        const { rows } = await admin.query<{ extraction_state: string }>(
          'select extraction_state from document where id = $1',
          [documentId],
        )
        expect(rows[0]?.extraction_state).toBe('unreadable')
      })
    })

    describe('a document rests after the provider could not be reached', () => {
      it('is not immediately claimable again', async () => {
        // `provider_unavailable` stays claimable on purpose, but nothing capped
        // how often. An authenticated caller could POST repeatedly and buy a
        // fresh provider call each time, because the poller stopping is a
        // client-side courtesy rather than a server-side limit. Raised in
        // review.
        const documentId = await heldDocument()
        const claim = await repository.claimForExtraction(documentId, 60)

        await repository.markExtractionState(documentId, 'provider_unavailable', {
          token: claim!.token,
        })

        expect(await repository.claimForExtraction(documentId, 60)).toBeNull()
      })

      it('cools for the configured window, not merely "some expiry"', async () => {
        // Asserting only that an expiry exists would pass for a one-second
        // cooldown, which caps nothing. Raised in review.
        const documentId = await heldDocument()
        const claim = await repository.claimForExtraction(documentId, 60)

        await repository.markExtractionState(documentId, 'provider_unavailable', {
          token: claim!.token,
        })

        const { rows } = await admin.query<{ seconds: string }>(
          `select extract(epoch from (extraction_claim_expires_at - now()))::text as seconds
             from document where id = $1`,
          [documentId],
        )
        const seconds = Number(rows[0]!.seconds)

        expect(seconds).toBeGreaterThan(45)
        expect(seconds).toBeLessThanOrEqual(60)
      })

      it('does not leave an expiry without a token when nobody holds a claim', async () => {
        // The unfenced path kept whatever token was there -- NULL, for an
        // unclaimed document -- while still setting an expiry, which violates
        // document_extraction_claim_complete. The two SQL strings were near
        // identical, which is exactly where it hid. Raised in review.
        const documentId = await heldDocument()

        await expect(
          repository.markExtractionState(documentId, 'provider_unavailable'),
        ).resolves.toBeUndefined()

        const { rows } = await admin.query<{ token: string | null; expires: string | null }>(
          `select extraction_claim_token as token,
                  extraction_claim_expires_at::text as expires
             from document where id = $1`,
          [documentId],
        )
        expect(rows[0]?.token).toBeNull()
        expect(rows[0]?.expires).toBeNull()
      })

      it('is claimable again once the cooldown has passed', async () => {
        // The other direction. Without this the cooldown could be permanent and
        // the test above would still pass — the retry path would be dead.
        const documentId = await heldDocument()
        const claim = await repository.claimForExtraction(documentId, 60)

        await repository.markExtractionState(documentId, 'provider_unavailable', {
          token: claim!.token,
        })
        await admin.query(
          "update document set extraction_claim_expires_at = now() - interval '1 second' where id = $1",
          [documentId],
        )

        expect(await repository.claimForExtraction(documentId, 60)).not.toBeNull()
      })

      it('keeps the state as provider_unavailable while it cools', async () => {
        const documentId = await heldDocument()
        const claim = await repository.claimForExtraction(documentId, 60)

        await repository.markExtractionState(documentId, 'provider_unavailable', {
          token: claim!.token,
        })

        const { rows } = await admin.query<{ extraction_state: string }>(
          'select extraction_state from document where id = $1',
          [documentId],
        )
        expect(rows[0]?.extraction_state).toBe('provider_unavailable')
      })

      it('does not hold a claim for the terminal states', async () => {
        // Only the retryable one cools. `unreadable` is finished, and leaving a
        // claim on it would be a lock nothing ever releases.
        const documentId = await heldDocument()
        const claim = await repository.claimForExtraction(documentId, 60)

        await repository.markExtractionState(documentId, 'unreadable', { token: claim!.token })

        const { rows } = await admin.query<{ token: string | null }>(
          'select extraction_claim_token as token from document where id = $1',
          [documentId],
        )
        expect(rows[0]?.token).toBeNull()
      })
    })

    describe('releasing it', () => {
      it('frees the document for the next caller', async () => {
        const documentId = await heldDocument()
        const claim = await repository.claimForExtraction(documentId, 60)

        await repository.releaseExtractionClaim(claim!)

        expect(await repository.claimForExtraction(documentId, 60)).not.toBeNull()
      })

      it('clears both columns, not just the token', async () => {
        const documentId = await heldDocument()
        const claim = await repository.claimForExtraction(documentId, 60)

        await repository.releaseExtractionClaim(claim!)

        expect((await claimStateOf(documentId)).extraction_claim_token).toBeNull()
      })

      it('ignores a release from the wrong holder (C5)', async () => {
        // A stale claimant returning late must not hand a live document to the
        // next caller mid-extraction.
        const documentId = await heldDocument()
        const claim = await repository.claimForExtraction(documentId, 60)

        await repository.releaseExtractionClaim({
          documentId,
          token: '00000000-0000-4000-8000-000000000000',
        })

        expect((await claimStateOf(documentId)).extraction_claim_token).toBe(claim!.token)
        expect(await repository.claimForExtraction(documentId, 60)).toBeNull()
      })
    })
  })

})
