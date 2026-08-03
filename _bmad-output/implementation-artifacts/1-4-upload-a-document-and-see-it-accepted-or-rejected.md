---
baseline_commit: f6d718e0bb8418d868888427c454b7ba7098d452
---

# Story 1.4: Upload a document and see it accepted or rejected

Status: ready-for-dev

## Story

As a treasurer,
I want to upload the association's invoices, statements, and rolls,
so that the system has the records it needs, and I know immediately if a file could not be used.

## Acceptance Criteria

**AC1 — A supported file is stored and recorded, hashed before anything reads it**

**Given** a supported file (PDF, PNG, JPG, CSV, or Excel) within the size limit
**When** the treasurer uploads it
**Then** the bytes are stored in object storage
**And** a `document` row is created carrying a content hash computed **before** any extraction
**And** the write happens through the `watchdog_writer` role

**AC2 — Re-uploading the same bytes replaces, never duplicates**

**Given** a file whose content hash matches an already-ingested document
**When** it is uploaded again
**Then** the existing document's derived rows are replaced rather than appended
**And** no second `document` row and no second stored object is created
**And** the treasurer is told it was already held, not that it failed

**AC3 — An unsupported or oversized file is rejected as a fact, and the batch continues**

**Given** an unsupported file type or a file exceeding the size limit
**When** it is uploaded
**Then** it is rejected with a message stating the accepted formats and the limit as facts
**And** every other file in the same batch is still processed

**AC4 — An unreadable file halts for that file, in the PRD's words**

**Given** a password-protected, encrypted, or otherwise unreadable file
**When** it is uploaded
**Then** ingestion halts for that file and displays **verbatim**:
`This file cannot be read. It might be password protected or corrupted. Please upload an unlocked or clearer version.`
**And** the treasurer is offered a path to replace it
**And** no partial record of that file is stored

**AC5 — Role separation holds for the new table**

**Given** the `document` table added by this story
**When** the role tests run
**Then** `watchdog_writer` can INSERT/UPDATE/DELETE it
**And** `watchdog_reader`'s access to it is whatever migration 004 grants **explicitly**, with the grant (or its deliberate absence) asserted by a test

## Tasks / Subtasks

- [ ] **Migration `004_document.sql`** (AC: 1, 2, 5)
  - [ ] `document` table following the conventions in `001_board_member.sql`: `uuidv7()` primary key, `timestamptz`, named check constraints, `comment on table` / `comment on column` explaining *why*
  - [ ] Content hash column with a uniqueness constraint — AD-13's idempotency is a database invariant, not application etiquette
  - [ ] Explicit `grant` decision for `watchdog_reader` (see Dev Notes → *The grant you must make on purpose*)
  - [ ] Extend `migrations/roles.test.ts` to cover the new table
- [ ] **Content hashing** (AC: 1, 2)
  - [ ] Hash the bytes before any parse or extraction touches them
  - [ ] Same bytes → same hash, different bytes → different hash, regardless of filename
- [ ] **Acceptance rules** (AC: 3, 4)
  - [ ] Type allowlist and size limit as data, not scattered conditionals
  - [ ] Unreadable/encrypted detection at the container level
  - [ ] Rejection reasons as a closed set the UI renders, never a raw error string
- [ ] **Storage adapter** `adapters/storage/` (AC: 1)
  - [ ] Port in `core/ports/`, adapter in `adapters/` — the domain core must not import the AWS SDK
  - [ ] Lazy client construction, per the `next build` note in `adapters/auth/env.ts`
- [ ] **Ingestion service** `core/ingestion/` (AC: 1–4)
  - [ ] Per-file outcome so one rejection cannot fail a batch
  - [ ] Order: validate → hash → store → record, so a rejected file leaves nothing behind
- [ ] **Upload surface** (AC: 1–4)
  - [ ] Per-file states: accepted, already held, rejected (type/size), unreadable
  - [ ] FR-1 copy verbatim for the unreadable case
  - [ ] Tokens only — no raw colour or type values (`core/design/no-raw-values.test.ts` enforces this)

## Dev Notes

### Already built — do not rebuild

| Thing | Where | Note |
| --- | --- | --- |
| `@aws-sdk/client-s3` | `package.json` → `^3.1100.0` | **Already a production dependency.** Do not add it. |
| `pg` | `^8.22.0` | Pool pattern established in `adapters/auth/user-directory-postgres.ts` — copy its error listener and timeouts |
| Working S3 client config | `scripts/verify-storage.mjs` | Endpoint shape, `region: 'auto'`, credential wiring. It is a **script, not an adapter** — the adapter does not exist yet |
| Both DB roles | `migrations/002_roles.sql`, `003_reader_hardening.sql` | Provisioned and proven |
| AD-4 proof | `migrations/roles.test.ts` | 13+ assertions incl. cannot INSERT/UPDATE/DELETE/TRUNCATE |
| Lazy env reads | `adapters/auth/env.ts` | `next build` evaluates modules; env is read on first use, not at import |
| Design tokens | `core/design/tokens.ts` | The only source of colour and type values |

**AC5 is largely satisfied already.** `roles.test.ts` proves the reader cannot write. What this story adds is coverage of the *new* table. Do not re-derive the role separation.

### The grant you must make on purpose

`003_reader_hardening.sql` ran:

```sql
alter default privileges in schema public revoke select on tables from watchdog_reader;
```

So **`watchdog_reader` gets nothing on `document` automatically**, and `roles.test.ts` already asserts *"is granted nothing by default on tables added later"*. Migration 004 must therefore make an explicit choice and state it in a comment.

**Recommendation: grant SELECT on `document` to `watchdog_reader`.** Epic 2's catalog needs to attribute a figure to the document it came from, and this table holds metadata only — filename, size, hash, timestamps. The raw bytes live in object storage, which the reader has no route to at all. Grant SELECT on the table; do **not** add any column holding extracted text or bytes to it (that is story 1.5's concern, and AD-8/AD-10 keep it away from the reasoning path).

If you conclude otherwise, say so in the migration comment and assert the absence.

### AD-13 is a database invariant, not a convention

> *"Every uploaded document carries a content hash computed before extraction. Re-ingesting a document with an existing hash **replaces** that document's derived rows rather than appending."*

Two consequences the ACs depend on:

1. **Hash before anything else reads the bytes.** Not after a parse, not after a virus scan, not after extraction. If a later step mutates or normalises the bytes, the hash must still describe what arrived.
2. **Uniqueness belongs in the schema.** A unique constraint on the hash makes a duplicate row unrepresentable. Enforcing it only in application code leaves the two-concurrent-uploads race open, and this branch has already produced four guards that read as protective and proved nothing — do not add a fifth.

The "replaces derived rows" half has nothing to replace yet: no derived tables exist until 1.5 and 1.6. Build the replacement **seam** now (a single owner for re-ingest) and leave it empty rather than scattering the responsibility later. AD-13 says *"exactly one component owns creation of each derived entity."*

### Scope boundary against story 1.5

| This story | Story 1.5 |
| --- | --- |
| Accept/reject, hash, store bytes, create the `document` row | Extract structured records from those bytes |
| Unreadable **at the container level** — encrypted PDF, unopenable archive | Schema-invalid **extraction output** (AD-9) |
| FR-1's verbatim copy | "We couldn't read this reliably enough to use." |

Both are "unreadable" to a user and they are different failures. AC4 is the first. Do not reach for the extraction provider in this story — no Gemini call belongs here.

### Non-negotiables

- **The FR-1 string is verbatim.** `This file cannot be read. It might be password protected or corrupted. Please upload an unlocked or clearer version.` Assert it character-for-character; a reworded version fails the AC.
- **Never store a partial record.** A rejected file leaves no `document` row and no stored object. Validate → hash → store → record, in that order, so failure has nothing to unwind.
- **One file's failure never fails the batch** (AC3). Per-file results, not a throw that abandons the loop.
- **Ingestion writes as `watchdog_writer`** (NFR-1). Never the reader, never a superuser URL.
- **Rejection reasons are a closed set.** The UI renders from an enum, not from an exception message — a raw error reaching a board member is both a poor experience and an information leak.

### Testing standards

Vitest, `**/*.test.ts`, colocated. Suite is currently **407 passing**; do not regress it.

`bmad-dev-tdd` applies: failure-mode analysis per behaviour, then red-green-refactor. Story 1.3's Dev Agent Record shows the expected Test Design shape — failure modes classified GUARD / PROPAGATE / OUT-OF-SCOPE, with a cross-check where a self-consistent but wrong implementation could otherwise pass.

**Failure modes worth pre-naming**, given this branch's history:

| Risk | Why it matters here |
| --- | --- |
| The type/size check passes everything | A validator with an unreachable branch reports every file acceptable. Assert rejections positively, per type and per limit boundary |
| The hash is computed post-parse | Silently breaks AD-13's "before extraction". Assert ordering, not just presence |
| Idempotency tested only through the app | Misses the concurrent-upload race a unique constraint closes. Assert at the database |
| The batch aborts on first rejection | AC3 inverted. Assert a mixed batch: good, oversized, unreadable, good |
| The FR-1 copy drifts | Assert the exact string |

Database-touching tests follow `migrations/roles.test.ts` and run under `npm run test:db`, gated in CI on both `WATCHDOG_*_DATABASE_URL` variables being present.

### Schema conventions (from `001_board_member.sql`)

- `id uuid primary key default uuidv7()` — rows sort by creation time
- `timestamptz`, never bare `timestamp`
- Named check constraints, `<table>_<column>_<rule>`
- Make invalid states unrepresentable rather than merely unlikely
- `comment on table` and `comment on column` carrying the *why*, including the AD reference

### UX requirements

`UX-DR12` — the upload surface carries five states. Two belong to 1.5 (extraction progress, quarantine); **three are this story's**: added, unsupported/oversized rejection, unreadable rejection. Plus AC2's "already held".

From `EXPERIENCE.md` → State Patterns:

- *Error — unsupported or oversized file*: "State the limit and the accepted formats as facts, before retry."
- *Error — unreadable document*: "The PRD's FR-1 copy verbatim; offer the unlocked-copy path."
- Voice: plain language inside formal structure. Never imply certainty the system lacks; errors say what to do next, without apology.
- `mockups/key-screens.html` → *Upload* shows the intended per-file row treatment.

### Project Structure Notes

Hexagonal, per the spine's paradigm:

```
core/ports/document-store.ts       # NEW — the port
core/ingestion/                    # NEW — accept/reject rules, hashing (pure)
adapters/storage/                  # NEW — S3/R2 adapter, the only AWS SDK importer
adapters/db/                       # NEW — document repository (writer role)
migrations/004_document.sql        # NEW
app/upload/                        # NEW — the surface
```

`core/` imports nothing outward. The AWS SDK appears in `adapters/storage/` and nowhere else — `core/ingestion` must be testable without network or credentials.

Note the spine's tree names `adapters/db/`; the auth adapter currently sits at `adapters/auth/user-directory-postgres.ts`. Follow the existing repository-per-port shape rather than restructuring.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.4]
- [Source: docs/prd/prd.md#FR-1: Document Upload] — verbatim copy
- [Source: ARCHITECTURE-SPINE.md#AD-13] — idempotency on content hash
- [Source: ARCHITECTURE-SPINE.md#AD-4] + `migrations/003_reader_hardening.sql` — the explicit grant
- [Source: ARCHITECTURE-SPINE.md#AD-1] — uploads-only; no external source in this story
- [Source: EXPERIENCE.md#State Patterns] and #Voice and Tone
- [Source: epics.md#UX-DR12]

## Dev Agent Record

### Agent Model Used

### Test Design

### Debug Log References

### Completion Notes List

### File List
