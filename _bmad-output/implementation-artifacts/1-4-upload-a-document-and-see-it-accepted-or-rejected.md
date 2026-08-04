---
baseline_commit: f6d718e0bb8418d868888427c454b7ba7098d452
---

# Story 1.4: Upload a document and see it accepted or rejected

Status: done

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

- [x] **Migration `004_document.sql`** (AC: 1, 2, 5)
  - [x] `document` table following the conventions in `001_board_member.sql`: `uuidv7()` primary key, `timestamptz`, named check constraints, `comment on table` / `comment on column` explaining *why*
  - [x] Content hash column with a uniqueness constraint — AD-13's idempotency is a database invariant, not application etiquette
  - [x] Explicit `grant` decision for `watchdog_reader` (see Dev Notes → *The grant you must make on purpose*)
  - [x] Extend role coverage to the new table (added as `migrations/document.test.ts` rather than growing `roles.test.ts`, which is scoped to AD-4 itself)
- [x] **Content hashing** (AC: 1, 2)
  - [x] Hash the bytes before any parse or extraction touches them
  - [x] Same bytes → same hash, different bytes → different hash, regardless of filename
- [x] **Acceptance rules** (AC: 3, 4)
  - [x] Type allowlist and size limit as data, not scattered conditionals
  - [x] Unreadable/encrypted detection at the container level
  - [x] Rejection reasons as a closed set the UI renders, never a raw error string
- [x] **Storage adapter** `adapters/storage/` (AC: 1)
  - [x] Port in `core/ports/`, adapter in `adapters/` — the domain core must not import the AWS SDK
  - [x] Lazy client construction, per the `next build` note in `adapters/auth/env.ts`
- [x] **Ingestion service** `core/ingestion/` (AC: 1–4)
  - [x] Per-file outcome so one rejection cannot fail a batch
  - [x] Order: validate → hash → store → record, so a rejected file leaves nothing behind
  - [x] Document repository port + Postgres adapter through `watchdog_writer` (AC1's "the write happens through the writer role" had no other owning task)
- [x] **Upload surface** (AC: 1–4)
  - [x] Per-file states: accepted, already held, rejected (type/size), unreadable
  - [x] FR-1 copy verbatim for the unreadable case
  - [x] Tokens only — no raw colour or type values (`core/design/no-raw-values.test.ts` enforces this)

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

```text
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

claude-opus-5[1m] (Claude Opus 5, 1M context) — `bmad-dev-tdd`, invoked by `bmad-implement-epic`

### Test Design

Baselines recorded before any code: **407 passing / 17 skipped** (`npm test`), **17 passing**
(`npm run test:db`, database reachable). Any new failure below is this story's.

#### Task 1 — migration `004_document.sql`

Three behaviors carry logic. The table definition is data, but data whose constraints are the
enforcement mechanism for AD-13, so it is tested against a real database rather than eyeballed.

**Behavior A — which document rows are representable**

*If it ran correctly, how would I know?* A row with valid values inserts and reads back; every
invalid shape is refused by the database with a constraint violation rather than stored.

*How will I test it?* Against real Postgres through the existing `migrations/roles.test.ts`
harness — writer and reader connections built from the two env URLs, skipping loudly when absent.
The seam already exists; nothing new to inject.

| # | Failure mode | Class | Test |
| --- | --- | --- | --- |
| A1 | **A row exists with no content hash**, so AD-13's invariant is unenforceable for exactly the row that needed it | GUARD | `not null` proven by an insert omitting it |
| A2 | The hash is stored in a non-canonical form — uppercase, whitespace, truncated — so two spellings of one digest are two rows | GUARD | Format check `^[a-f0-9]{64}$`; uppercase and truncated variants both refused |
| A3 | `byte_size` is zero or negative, recording a document that cannot exist | GUARD | Boundary: `-1`, `0` refused; `1` accepted |
| A4 | `content_type` outside the accepted set is storable, so the database and the acceptance rules can disagree | GUARD | Check constraint; an unsupported type refused |
| A5 | A hostile or absurd filename is stored unbounded | GUARD | Length boundary at 255 and 256 |
| A6 | Timestamps lose their zone (`timestamp` rather than `timestamptz`) | GUARD | Column type asserted through `information_schema` |

*Cross-check (required by `require_inverse_or_crosscheck`):* insert→read round-trip asserts every
column returns the value written, so a column that silently coerces or truncates is caught by the
inverse rather than by inspection.

**Behavior B — content-hash uniqueness is a database invariant**

*If it ran correctly, how would I know?* A second insert carrying an existing hash is refused by
the database, whatever the application believes.

*How will I test it?* Two inserts in one test, second expected to throw a unique violation.

| # | Failure mode | Class | Test |
| --- | --- | --- | --- |
| B1 | **Uniqueness lives only in application code**, so two concurrent uploads both pass the check and both insert — the exact race an application-level guard cannot close | GUARD | Second insert of the same hash refused at the database |
| B2 | Uniqueness is scoped too widely — `(hash, filename)` — so identical bytes under two names become two documents, defeating AD-13 | GUARD | Same hash, *different* filename, still refused |
| B3 | The constraint exists but on the wrong column, passing B1 by accident | GUARD | Two rows with different hashes both insert, proving the constraint is not blanket |

**Behavior C — role grants on the new table**

*If it ran correctly, how would I know?* Writer can INSERT/UPDATE/DELETE; reader's access is
exactly what migration 004 grants and nothing more.

*Could this problem happen anywhere else?* **It already did.** `board_member` was readable by
`watchdog_reader` until migration 003 revoked it — the same defect shape, on the previous table.
That is why 003 also revoked default privileges, and why this behavior is tested rather than
assumed.

| # | Failure mode | Class | Test |
| --- | --- | --- | --- |
| C1 | **The reader gets nothing**, because 003 revoked default SELECT — silent until epic 2's catalog cannot read documents at all | GUARD | Reader can SELECT `document` |
| C2 | The reader gets more than SELECT, re-opening AD-4 | GUARD | Reader INSERT/UPDATE/DELETE on `document` all refused |
| C3 | The writer was never granted, so ingestion fails at runtime with a permission error rather than at migration time | GUARD | Writer INSERT/UPDATE/DELETE all succeed |
| C4 | A later table silently inherits a grant | GUARD | Existing "granted nothing by default on tables added later" test must still pass after 004 |

**Out of scope for this task:** object-storage failure modes (Task 4), acceptance-rule failure
modes (Task 3), and re-ingest replacement of derived rows — no derived tables exist until 1.5,
so the seam is built and left empty per AD-13's "exactly one component owns creation".

---

## Task 2 — content hashing

**Behavior D — `contentHash(bytes)` → the SHA-256 digest AD-13 turns on**

*If it ran correctly, how would I know?* The same bytes always produce the same 64-character
lower-case hex digest, different bytes produce a different one, and the digest matches an
independent implementation of SHA-256 over the same input.

*How am I going to test this?* It is a pure function of a byte array — no seam needed. That is
itself the design decision: hashing takes bytes, not a file handle, a path, or an upload object,
so nothing about *where* the bytes came from can leak into the identity of the document.

*What else can go wrong?* The dangerous failures here are all silent. A hash function that hashes
the wrong thing still returns a plausible 64-character hex string, and every self-consistency test
in the world passes. That is why this behavior needs an independent oracle, not just "same input,
same output".

*Could this problem happen anywhere else?* Yes — the parity problem. The digest's spelling is
constrained in two places now: this function and `document_content_hash_is_sha256` in migration
004. Two copies of a rule drift, so the test reads the regex out of the migration file rather than
restating it.

| # | Failure mode | Class | Test |
| --- | --- | --- | --- |
| D1 | **A string is passed where bytes were meant** — `hash(file.name)` instead of `hash(file.bytes)`. Returns a perfectly valid-looking digest of the filename. Every document then has a distinct hash, AD-13's duplicate detection silently never fires, and the product's headline feature is dead with no error anywhere | GUARD | Rejects `string`, `null`, `undefined`, `ArrayBuffer`, number — `TypeError` |
| D2 | The digest is computed correctly but spelled in a form the database refuses (upper-case hex, base64) — every upload fails at INSERT | GUARD | Output matched against the regex **read out of `004_document.sql`**, not a restated copy |
| D3 | The implementation is self-consistent but not SHA-256 (wrong algorithm, truncated, double-hashed). No same-input/same-output test can detect this | GUARD | Cross-check ×2: NIST known-answer vectors, and `crypto.subtle.digest` as a second independent implementation |
| D4 | A hash object is reused across calls, so digest N depends on documents 1..N-1. Passes any single-call test; corrupts under real batch upload | GUARD | Hash A, then B, then A again — the two A digests must agree |
| D5 | A `Uint8Array` **view** (a `subarray`, or a slice of a pooled `Buffer`) is hashed by reading its whole backing buffer, so the digest covers bytes the caller never passed. Node pools small Buffers, so this appears only in production | GUARD | Digest of a subarray view equals the digest of a standalone copy of exactly those bytes |
| D6 | Filename or metadata folded into the digest, so the same file uploaded twice under different names is two documents — the exact case AD-13 names | GUARD | Two identical byte arrays hash equal; the function takes no filename parameter to fold in |
| D7 | Empty input | OUT-OF-SCOPE | Zero-length is refused by the size rule (Task 3) and by `document_byte_size_positive`, before the hasher is reached. Behavior is still **pinned** to the known SHA-256 empty-string vector rather than left accidental — a policy guard here would put the size rule in two places |
| D8 | Very large input exhausting memory | OUT-OF-SCOPE | Bounded by the size limit in Task 3, which runs first by the ordering in Task 5 (validate → hash → store → record) |

---

## Task 3 — acceptance rules

**Assumption recorded, not asked.** FR-1 says "files exceeding size limits" and never names the
limit; neither do the epics or the ACs. Set to **25 MiB**. A 40-page bank statement scanned at
300 dpi lands around 10–20 MB, so this admits the documents a board actually has while keeping a
single upload inside what a request buffer can hold. It is one exported constant with the reasoning
next to it — cheap to change if the pilot disagrees.

**Behavior E — `assess(candidate)` → accepted, or rejected with a reason from a closed set**

*If it ran correctly, how would I know?* A supported file within the limit is accepted; anything
else comes back with one of exactly four reasons, and never a string from an exception.

*How am I going to test this?* Pure function over bytes and a declared content type. No network, no
credentials, no filesystem — which is the constraint the spine puts on `core/`.

*What else can go wrong?* Every rejection here is a message a volunteer treasurer reads at the
moment their upload failed. A wrong one is not a stack trace in a log; it is a person being told
their valid document is invalid, or being told nothing useful about one that is.

| # | Failure mode | Class | Test |
| --- | --- | --- | --- |
| E1 | Content type compared raw, so `text/csv; charset=utf-8` and `Application/PDF` — both of which browsers send — are rejected as unsupported | GUARD | Parameters stripped, case folded, whitespace trimmed |
| E2 | The allowlist drifts from `document_content_type_supported`. A type accepted here and refused there fails at INSERT, after the bytes are already in object storage | GUARD | Parity test reading the `in (...)` list **out of `004_document.sql`**, both directions |
| E3 | Off-by-one on the limit: a file exactly at the limit rejected, or one byte over accepted | GUARD | limit−1 accepted, limit accepted, limit+1 rejected |
| E4 | The browser's declared type trusted outright, so anything renamed `.pdf` is accepted and handed to extraction as a PDF | GUARD | Declared type must match the container signature; mismatch is `unreadable` |
| E5 | A raw exception message reaches the UI — leaking a path, a library name, or a stack | GUARD | Outcome is a closed union; every rejection reason asserted to be one of the four |
| E6 | Zero bytes passes the size check (`0 <= limit`) and reaches the database, which refuses it with `23514`. The treasurer sees a crash instead of a sentence | GUARD | Empty input rejected as `empty` before hashing or storage |
| E7 | One rejection aborts the batch | OUT-OF-SCOPE | Made unrepresentable rather than guarded: this function assesses one candidate and returns a value. Batch behavior is Task 5 |

**Behavior F — container-level readability**

*Could this problem happen anywhere else?* This is the same shape as E4 — trusting a claim instead
of checking the artifact — and it is the shape AD-1 exists to police at the data plane. Here it is
one file's header.

| # | Failure mode | Class | Test |
| --- | --- | --- | --- |
| F1 | A password-protected PDF is accepted, extraction fails downstream, and AC4's copy never fires | GUARD | `/Encrypt` in the trailer → `unreadable` |
| F2 | A file shorter than the signature being compared reads past its end, or matches vacuously | GUARD | 0-, 1-, and 3-byte inputs — boundary below every signature length |
| F3 | An encrypted `.xlsx` is an **OLE** container, not a ZIP, so a naive extension check accepts it | GUARD | xlsx-declared bytes with OLE magic → `unreadable` |
| F4 | Binary mislabelled `text/csv` — CSV has no magic number, so the signature check has nothing to compare | GUARD | NUL byte in the leading bytes → `unreadable` |
| F5 | **Inverse:** a legitimate PDF whose page content happens to contain the literal text `/Encrypt` is called encrypted, and a valid document is refused | GUARD | Search scoped to the trailer; a PDF with `/Encrypt` in its body is **accepted** |

The `/Encrypt` scan is a heuristic over the trailing bytes, and is documented as one. It answers
"does this container announce itself as encrypted", not "can this be parsed" — the latter needs a
PDF parser, which belongs with extraction in 1.5, not at the gate.

---

## Task 4 — the storage port and its S3 adapter

**Behavior G — `storageKeyFor(contentHash)`**

*If it ran correctly, how would I know?* The same bytes always land on the same object key.

This is a domain rule, not a naming convention, and it is what makes AC2's "no second stored
object" true by construction rather than by a check. It also decides what a crash costs: if the
bytes are stored and the row insert then fails, a retry writes the *same key with the same bytes*.
The orphan is self-healing, so there is no compensating delete — and no delete path with failure
modes of its own.

| # | Failure mode | Class | Test |
| --- | --- | --- | --- |
| G1 | Filename or timestamp folded into the key, so re-upload writes a second object and AC2 is false | GUARD | Key depends on the hash alone; same hash → same key |
| G2 | The hash is interpolated unchecked, so a caller passing `../../secret` or an absolute path escapes the prefix | GUARD | Refuses anything that is not a 64-character lower-case digest |
| G3 | Keys collide across future object kinds (derived exports, thumbnails) because nothing namespaces them | GUARD | Key carries a fixed prefix |

**Behavior H — the S3 adapter**

*How am I going to test this?* By injecting the client. The adapter takes an object with `send`,
so the tests use a fake that records the command it was given — no network, no credentials, no
`@aws-sdk` behavior under test. What is under test is the adapter's own translation, which is where
its bugs are.

*Could this problem happen anywhere else?* **It already did.** `adapters/auth/env.ts` carries a
comment explaining why database config is read at call time: Next.js evaluates modules during
`next build`, so a module-scope read that throws makes the build itself require real credentials.
The same trap is one line away here, so the same discipline applies and is tested.

| # | Failure mode | Class | Test |
| --- | --- | --- | --- |
| H1 | **Client or config built at module scope**, so `next build` needs real R2 credentials and CI cannot build | GUARD | Import and construct with the environment empty — neither throws; only `put` does |
| H2 | Missing configuration surfaces as `undefined is not a function` deep in the SDK | GUARD | Throws a named error listing **every** missing variable, not just the first |
| H3 | Bucket and key transposed, or the content type dropped — the object is stored somewhere wrong or served as the wrong type later | GUARD | Cross-check: assert the exact command fields the fake received |
| H4 | A new client per call, leaking a socket pool under batch upload | GUARD | Two `put` calls share one constructed client |
| H5 | The SDK's error is wrapped in a message that includes the credentials or endpoint | PROPAGATE | The SDK error escapes unchanged; the adapter adds nothing |
| H6 | `core/` reaches for the AWS SDK directly, and the port stops meaning anything | GUARD | Boundary test: nothing under `core/` imports `@aws-sdk`, `pg`, `next`, or `adapters/` |

H6 is the story's Project Structure Note — *"`core/` imports nothing outward"* — which no test
currently enforces. Written here because Task 5 is about to put the ingestion service in `core/`
and this is the moment the rule starts carrying weight.

---

## Task 5 — the ingestion service

**Behavior I — `ingest(files, uploadedBy, deps)` → one outcome per file, in order**

*If it ran correctly, how would I know?* Every file in equals exactly one outcome out, in the same
order, and nothing that was rejected left a trace anywhere.

*How am I going to test this?* Both collaborators are ports, so the tests inject fakes that record
what they were handed. No network, no database, no credentials — the boundary test from Task 4 is
what keeps that true.

*What else can go wrong?* The failure that matters most here is not a wrong answer, it is a lost
afternoon: a treasurer uploads twenty documents, one of them is a `.docx`, and the batch dies. AC3
says the rest must still be processed, and the same has to hold when the reason is a transient
storage error rather than the file's fault.

**Ordering.** Assess → hash → derive key → store → record. Store before record because a row
pointing at bytes that are not there is worse than an object with no row: the object is
self-healing (same key, same bytes on retry, per Task 4), the dangling row is not. Rejection
happens before either, so AC4's "no partial record of that file is stored" is a property of the
order rather than a cleanup path.

| # | Failure mode | Class | Test |
| --- | --- | --- | --- |
| I1 | One rejection aborts the batch | GUARD | Reject in the middle of five; the other four still processed |
| I2 | One **storage error** aborts the batch — same lost afternoon, different cause | GUARD | Store throws for file 3 only; files 1, 2, 4, 5 unaffected |
| I3 | A rejected file is stored or recorded anyway | GUARD | Neither port is called at all for a rejected file |
| I4 | Outcomes come back reordered or short, so the UI attributes a rejection to the wrong row | GUARD | Outcomes align 1:1 with inputs, by index, including a 0-file and a 1-file batch |
| I5 | `byteSize` taken from a declared value rather than the bytes actually held | GUARD | Recorded size equals `bytes.length` |
| I6 | Storage key not derived from the hash — AC2 silently stops holding | GUARD | Cross-check: key equals `storageKeyFor(contentHash(bytes))` computed independently in the test |
| I7 | The **raw declared** content type is recorded, so `text/csv; charset=utf-8` reaches the database and violates `document_content_type_supported` | GUARD | Normalised type recorded, not the declared one |
| I8 | Re-ingest records a second row | GUARD | Repository reports already-held; outcome is `already-held`, not a second record |
| I9 | **AD-13's replace half never fires.** The duplicate is detected and the derived rows are left stale | GUARD | Re-ingest invokes the derived-row replacement seam |
| I10 | Two identical files inside one batch — the case that manufactures a duplicate under concurrency | GUARD | Second is reported already-held; one record |
| I11 | The uploader is dropped, so the audit trail loses its actor | GUARD | Recorded `uploadedBy` matches |
| I12 | An exception's text reaches the UI through the failure outcome | GUARD | A `failed` outcome carries no message, cause, or stack |

**A fifth surface state, flagged rather than smuggled in.** I2 needs a per-file `failed` outcome,
and the story's UX section names four states. A storage error is not the file's fault and has no
FR-1 copy, so Task 6 renders it as its own retryable state rather than dressing it up as a
rejection — telling a treasurer their valid PDF was "rejected" because R2 blinked would be a lie
the system knows is a lie.

---

## Task 6 — the upload surface

**Behavior J — `uploadFeedback(outcome)` → what the treasurer reads**

Modelled on `core/auth/sign-in-feedback.ts`: the words live in `core/`, pure and exhaustively
testable, and the page renders them. A React component is an awkward place to assert that a
sentence matches the PRD; a function is not.

*If it ran correctly, how would I know?* Every outcome the service can produce has copy, the
unreadable case matches FR-1 to the character, and the rejection messages state the accepted
formats and the limit as facts rather than as adjectives.

| # | Failure mode | Class | Test |
| --- | --- | --- | --- |
| J1 | **The FR-1 sentence drifts** — reworded, re-punctuated, or "improved". AC4 says verbatim | GUARD | Cross-check: the expected string is **read out of `docs/prd/prd.md`**, not restated in the test |
| J2 | A new outcome or rejection reason is added later and falls through to a blank row or a crash | GUARD | Exhaustive over `REJECTION_REASONS` and every outcome variant; every one yields non-empty copy |
| J3 | The accepted-format list is retyped in the copy and drifts from the gate — a treasurer told PNG is fine when it is not, or not told about a format that is | GUARD | Message built from `ACCEPTED_FORMAT_LABELS`; test asserts every label appears |
| J4 | The size limit is hardcoded in prose and drifts from `MAX_DOCUMENT_BYTES` | GUARD | Figure derived from the constant; test derives it the same way |
| J5 | **"Already held" is phrased as a failure.** AC2 is explicit — the treasurer is told it was already held, *not* that it failed | GUARD | Copy contains no failure vocabulary, and offers no replacement path |
| J6 | An unreadable file is reported with no way forward, against AC4's "offered a path to replace it" | GUARD | Every rejection and the failure case offer replacement; accepted and already-held do not |
| J7 | Voice drifts from EXPERIENCE.md — apology, or certainty the system lacks | GUARD | No message apologises; none claims to know why beyond what was observed |
| J8 | Raw colour or type values in the new page | GUARD | Already enforced by `core/design/no-raw-values.test.ts`, which scans `app/` |

The page itself (`app/upload/`) is thin by design: auth guard, a form, and a list that renders J's
output. What is worth testing about it is the copy and the tokens, and both are covered above
without mounting a component — no testing-library dependency added for this story.

### Debug Log References

**Task 1 — red.** First run of `migrations/document.test.ts` against the un-migrated database:
19 failed, **10 passed**. The ten that passed were the problem. They were written as bare
`rejects.toThrow()`, and `relation "document" does not exist` is also a throw — so they passed
against a table that did not exist and would have passed against a constraint that was never
written. That is the fifth instance in this branch of a guard that reads as protective and proves
nothing, and it was mine.

Rewritten to assert the specific SQLSTATE — `23502` not-null, `23503` foreign-key, `23505` unique,
`23514` check, `42501` insufficient-privilege — via an `expectRefusal(query, code)` helper. Second
red: **30 failed, 0 passed**, none for the wrong reason.

**Task 1 — green.** `004_document.sql` applied cleanly (`apply 004_document.sql`); the run also
confirmed the earlier migrate fix behaving as intended — `skip WATCHDOG_WRITER_DATABASE_URL
(recorded URL connects)` rather than trusting the file. DB suite 47 passed.

**Task 1 — sensitivity.** Dropped `document_content_hash_unique`, re-ran: exactly 2 failures, both
uniqueness tests, nothing else. Constraint restored, 47 green again. The tests detect the
constraint's absence rather than passing on ambient behaviour.

**Task 2 — red.** A missing module is a collection failure, not a red: it reports "no tests" and
proves nothing about any individual assertion. Stubbed `contentHash` to `throw new Error('not
implemented')` so every test failed on its own assertion — **20 failed, 0 passed**, with the
refusal tests failing because a plain `Error` is not a `TypeError`.

**Task 2 — sensitivity, two checks, and the second one was the interesting one.**

*Algorithm.* Swapped `sha256` → `sha1`: 7 failures — all three NIST vectors, the `crypto.subtle`
cross-check, the subarray-view test, the `Buffer` case, and the migration-regex parity test (a
40-character digest does not satisfy a 64-character constraint). The independent oracle detects a
wrong-but-self-consistent algorithm, which is the whole reason it is there.

*Type guard.* Removing only the `instanceof Uint8Array` check failed **one** test — the string
case. The six `null` / `undefined` / `ArrayBuffer` / number / object / array cases all still
passed, because Node's own `update()` rejects those with a `TypeError` regardless. So the guard is
load-bearing for exactly one input: a string, the only value Node accepts silently and the only
one that returns a plausible digest of the wrong thing.

That makes six for this branch of a check that reads as protective and proves less than it looks
like — but the first one caught before it shipped rather than after. Those six cases are kept (they
pin the contract against a future crypto-backend swap) and are now labelled in the test file as
pinning rather than proof, so the next reader is not misled by a passing green.

**Task 3 — red, and two more of my own vacuous tests.** First run against the stub: **37 failed,
2 passed**. Both passers were vacuous, and both were the "parity" tests meant to be the strongest
in the file:

- `MAX_DOCUMENT_BYTES % (1024 * 1024)` — `0 % anything === 0`, so a limit of zero satisfied it.
- `for (const type of ACCEPTED_CONTENT_TYPES) expect(labels[type]).toBeTruthy()` — a `for` loop
  over an empty array runs its body zero times and passes every assertion inside it.

Fixed by asserting the collection is non-empty *before* iterating it, and that the limit is
positive before checking its shape. Second red: **39 failed, 0 passed**.

**Task 3 — sensitivity, four mutations, all detected:**

| Mutation | Failures | Reading |
| --- | --- | --- |
| Drop `text/csv` from the format table | 11 | Migration parity fires, plus every CSV path |
| `bytes.length > MAX` → `>=` | **1** | Exactly the at-the-limit boundary test, nothing collateral |
| Remove the container-signature check | 7 | The renamed-executable and wrong-container cases |
| Remove the empty check, letting size run first | 2 | Empty falls through and is reported `unreadable` |

**Task 3 — a gate the other gates do not cover.** `npm run lint` and `npm test` both passed while
`npm run build` failed type checking: `declared.split(';')[0]` is `string | undefined` under
`noUncheckedIndexedAccess`. ESLint does not type-check and Vitest does not either — only the build
does. Worth remembering: "tests green, lint green" is not "compiles".

**Task 4 — red.** storage-key 11 failed, adapter 13 failed against stubs. The boundary test passed
immediately — `core/` had no violations — so it was proven by planting one rather than trusted.

**Task 4 — sensitivity:**

| Mutation | Failures | Reading |
| --- | --- | --- |
| Plant a real `@aws-sdk` import in `core/ingestion/storage-key.ts` | **1** | The boundary test fires on the genuine article, not just on its own fixture |
| Read configuration at construction rather than first use | 7 | The `next build` guard is real |
| `client ??=` → `client =`, rebuilding per call | 4 | Client reuse is asserted, not assumed |

**Task 4 — the build caught what lint and tests could not, again.**
`ConstructorParameters<typeof S3Client>[0]` resolves to `S3ClientConfig | undefined`, because the
constructor also accepts zero arguments. Tests and ESLint both passed; `next build` failed. Second
time this story — the pattern is that neither runner type-checks, so `npm run build` is not
optional before calling a task done.

**Task 5 — red.** Service 22 failed against a stub. The repository adapter first reported "no
tests" — the factory is called in the `describe` body, so a throwing stub is a *collection* failure
rather than a red. Stubbed the returned object's methods instead: 10 failed, each on its own
assertion.

**Task 5 — sensitivity on the service, all four detected:**

| Mutation | Failures |
| --- | --- |
| Drop the AD-13 derived-row replacement | **1** — precisely the AD-13 test |
| Record the declared content type instead of the normalised one | **1** |
| Rethrow instead of returning a per-file failure | 4 |
| Record before store | 7 |

**Task 5 — the seventh vacuous guard, and this one needed replacing rather than relabelling.**

The concurrency test was `Promise.all` over four identical `record` calls, asserting one row and
one id. Mutating the adapter to a deliberately broken read-then-write — SELECT, then INSERT —
**left all 57 tests passing.** `Promise.all` dispatches concurrently but forces no interleaving, so
the race simply did not occur in that run. The test asserted the property it cared about and could
not detect its absence.

Replaced with a deterministic one. Another transaction inserts the same hash and holds it
uncommitted; the adapter then records those bytes and its insert blocks on the unique index. The
test polls `pg_stat_activity` for `wait_event_type = 'Lock'` until Postgres reports the backend
genuinely blocked — and **throws** if it never does, so a scenario that failed to set itself up
cannot pass — then commits. Re-running the same mutation now fails with exactly the predicted
`duplicate key value violates unique constraint "document_content_hash_unique"`.

The `Promise.all` test is kept, but its comment now records that it passed against the broken
implementation. It is a smoke test, and it should not be read as more.

**Task 6 — red.** Same collection-failure trap as the repository adapter, from the other
direction: `const feedback = uploadFeedback(…)` at `describe` scope runs at collection, so the
throwing stub reported "no tests" instead of a red. Moved the calls inside the tests. Second red:
16 failed, 1 passed — and the passer is correct. It asserts the *PRD-extraction regex* matched a
real sentence, deliberately without calling the implementation, so that the verbatim comparison
cannot pass by comparing `''` to `''`.

**Task 6 — sensitivity, all three detected:**

| Mutation | Failures | Reading |
| --- | --- | --- |
| Reword FR-1 ("might be" → "may be", added hyphen) | **1** | The PRD comparison is genuinely verbatim |
| Hardcode the accepted-format list in the copy | **1** | The list is derived from the gate, not retyped |
| Plant `color: '#A47E3B'` in `upload-form.tsx` | **1** | The token gate does scan the new page — it named the file and line |

### Completion Notes List

**Task 1 — migration `004_document.sql`.** The `document` table holds metadata only; bytes live in
object storage. Guarded: absent hash, non-canonical hash spelling (upper-case, truncated, non-hex),
zero and negative byte size, unsupported content type, empty and over-length filename, absent and
dangling `uploaded_by`, and zone-less timestamps. AD-13's uniqueness is a database constraint on
the hash alone — scoped to the bytes, so the same file under a different name is the same document.

`grant select on document to watchdog_reader` is explicit, as migration 003 requires: the catalog
must be able to cite a figure's source document, and the row carries no content to leak.

Deliberately out of scope for this task: the replacement half of AD-13 (no derived tables exist
until 1.5, so there is nothing to replace yet), object-storage failures (Task 4), and the
acceptance rules themselves (Task 3).

Carried forward: the content-type list now exists in the database constraint and will exist again
in the ingestion layer. Whichever module owns that list must assert parity with the constraint, or
the two will drift and a file accepted at the edge will be refused by the database.

**Task 2 — `core/ingestion/content-hash.ts`.** A pure function from bytes to a lower-case hex
SHA-256 digest. Two properties are enforced by the signature rather than by a check: it takes no
filename (so nothing about a document's origin can enter its identity, and the same file under two
names is one document — the case AD-13 names), and it holds no state between calls (so digest N
cannot depend on documents 1..N-1, which no single-call test would catch and every batch upload
would hit).

Tested against independent oracles rather than itself: three published NIST FIPS 180-4 vectors and
a second SHA-256 implementation via `crypto.subtle`. Self-consistency tests cannot distinguish a
correct hash from a confidently wrong one.

The format parity test reads the regex out of `004_document.sql` rather than restating it. This is
the technique the migration's own comment asks for, applied first here; Task 3 owes the same
treatment to the content-type list.

Deliberately not handled here: zero-length input (pinned to the published empty-string vector, but
refusal belongs to the size rule in Task 3 and to `document_byte_size_positive` — a policy guard
here would put one rule in three places) and input size limits (bounded by Task 3, which runs
first).

**Task 3 — `core/ingestion/acceptance.ts`.** One pure function, `assess({contentType, bytes})`,
returning either `accepted` or `rejected` with a reason from a closed set of four:
`unsupported-type`, `too-large`, `empty`, `unreadable`. The reason is all it returns — no message,
no cause, no wrapped exception — so nothing an exception knows (a path, a library name, a stack)
can reach a treasurer. The surface owns the words; this owns the decision.

The rules are a table, not a chain of conditionals. `ACCEPTED_CONTENT_TYPES`, the per-format
labels, and `MAX_DOCUMENT_BYTES` are exported from that table so the rejection message can state
the accepted formats and the limit as facts (AC3) without restating the list. A migration-parity
test asserts the table equals `document_content_type_supported`, in both directions — this is the
debt migration 004's comment recorded, now paid.

**The declared content type is treated as a claim.** Browsers send `text/csv; charset=utf-8` and
vary the case, so it is normalised before comparison; then it is checked against the container's
leading bytes. A file renamed to `.pdf` is `unreadable`, not accepted and passed to extraction as a
PDF. Three container facts drove the design: an encrypted `.xlsx` is an OLE compound file rather
than a ZIP (so `.xls` and `.xlsx` cannot share a check), CSV has no signature at all (so a NUL byte
in the leading bytes stands in), and a file shorter than the signature must be length-checked
before it is indexed.

**Ordering is load-bearing**, and each step is tested at its boundary: type (cheapest, most
actionable message, and no unsupported file's bytes get scanned) → empty → size → container. Empty
must precede size because `0 <= MAX` is true — a size-only check passes a zero-byte file through to
`document_byte_size_positive`, and the treasurer gets a database error instead of a sentence.

**The `/Encrypt` scan is a heuristic and is documented as one.** It reads the trailing 2 KiB, not
the whole file, because a false "unreadable" refuses a document the board legitimately holds —
worse than passing an encrypted one to extraction, where it fails loudly. An inverse test pins
this: a PDF whose body contains the literal text `/Encrypt` is accepted. It answers "does this
container announce itself as encrypted", not "can this be parsed"; the latter needs a parser, which
belongs with extraction in 1.5.

Assumption on the record: the 25 MiB limit is mine, not the PRD's — see the Task 3 Test Design
note. One constant, reasoning attached, cheap to change if the pilot disagrees.

**Task 4 — the port, the key, and the adapter.**

`core/ports/document-store.ts` declares one method, `put`. There is no `exists`, no `delete`, and
no `get` — because of what `storageKeyFor` does.

**The object key is the content hash**, namespaced under `documents/`. Three consequences follow
from that one decision rather than from any code written to achieve them. AC2's "no second stored
object is created" is true by construction: the same bytes write the same key. A crash between
storing and recording is self-healing: the retry writes the same key with the same bytes, so the
orphan is overwritten rather than accumulated — which is why there is no compensating delete, and
so no delete path with failure modes of its own. And the filename never reaches the object store,
where a member's name or an association's address in a filename would otherwise sit indefinitely.
`storageKeyFor` refuses anything that is not a 64-character lower-case digest, because the value is
interpolated into a path.

`adapters/storage/document-store-s3.ts` is the only file in the application that imports the AWS
SDK, and `core/ports/boundary.test.ts` now enforces that rather than leaving it to a note in the
architecture document. Configuration is read on first use and the client built once and kept:
module-scope reads would make `next build` require real R2 credentials (the lesson already recorded
in `adapters/auth/env.ts`), and a client per document would open a socket pool per document.

**Task 5 — the pipeline, and the two ports it sits between.**

`ingest(files, uploadedBy, deps)` returns exactly one outcome per file, in order, always. Four
outcomes: `accepted`, `already-held`, `rejected` (carrying a reason from Task 3's closed set), and
`failed`.

`failed` is the addition the story did not name, and it is deliberate. AC3 requires the rest of a
batch to survive one bad file; the same has to hold when the cause is a storage blip rather than
the file. Folding that into `rejected` would tell a treasurer their perfectly good PDF was refused,
which the system knows is false. It is retryable and not their fault, so it is its own state — see
the Task 3/5 Test Design note; Task 6 renders it accordingly.

**Order is the safety property, not a cleanup path.** Assess → hash → key → store → record.
Rejection happens before either port is touched, so AC4's "no partial record of that file is
stored" holds by construction. Store precedes record because a row pointing at bytes that are not
there is worse than an object with no row: the object is self-healing (same key, same bytes on
retry), the dangling row is a permanent lie about what the association holds.

The loop is **sequential on purpose**. Two identical files in one batch must resolve to one record
and one already-held; running them concurrently would have them racing for the same insert to find
that out. A board uploads tens of files, not thousands.

The normalised content type is what gets recorded — `text/csv; charset=utf-8` would violate
`document_content_type_supported` at INSERT, after the bytes were already stored.

**The Postgres repository is one statement**: `insert … on conflict (content_hash) do nothing
returning id`. No returned row means already held, and the existing id is read back so AD-13
replaces the right document's derived rows. The filename is deliberately not updated on a repeat —
the bytes are the document, so a second upload under another name is the same document, and
overwriting would rewrite history for whoever filed it first. The "neither inserted nor found" case
throws rather than reporting a phantom success.

The SDK's errors are deliberately **not** wrapped. Wrapping means building a message out of the
configuration this adapter is holding, which is how a secret key ends up in a log line; a test
asserts the secret appears in nothing thrown. The missing-configuration error, by contrast, lists
every absent variable at once and points at `.env.example` — it is read by whoever is deploying,
and reporting four variables one deploy at a time is a poor use of their afternoon.

**Task 6 — the surface.**

The words live in `core/ingestion/upload-feedback.ts`, following the precedent of
`core/auth/sign-in-feedback.ts`. Three things a board member reads are therefore derived rather
than retyped: FR-1's unreadable sentence (compared character-for-character against
`docs/prd/prd.md`), the accepted-format list (built from the gate's own table), and the size limit
(computed from `MAX_DOCUMENT_BYTES`). Each of those exists in exactly one place, and the test suite
fails if a second copy drifts from it.

"Already on record" is deliberately free of failure vocabulary, and a test enforces that with a
pattern match — AC2 says the treasurer is told it was already held, not that it failed, and nothing
did fail. It is also the one non-success outcome that offers no replacement path, because there is
nothing to replace.

`app/upload/` is thin: `page.tsx` guards and frames, `upload-form.tsx` renders one row per file
through `uploadFeedback`, `actions.ts` is the composition root where the two adapters meet the
domain. `/upload` needed no route registration — `PUBLIC_ROUTES` is an allow-list and the decision
is deny-by-default, so it is protected by not being mentioned. The page carries the same
second-lock session check as the dashboard.

The real error from a failed ingest goes to the server log via the `onError` hook and never to the
page; its text can name a bucket or a path. The treasurer gets "Not saved — try uploading it
again", which is true and actionable.

No component-testing dependency was added. What is worth asserting about this surface is the copy
and the tokens, and both are covered — the copy exhaustively over every outcome, the tokens by
`core/design/no-raw-values.test.ts`, which was verified to actually scan the new page by planting a
raw hex colour in it.

### File List

**Added**

- `migrations/004_document.sql` — the `document` table, its constraints, and the `watchdog_reader` grant
- `migrations/document.test.ts` — 30 tests; requires a database, skips loudly without one
- `core/ingestion/content-hash.ts` — SHA-256 over document bytes
- `core/ingestion/content-hash.test.ts` — 20 tests, oracle-based
- `core/ingestion/acceptance.ts` — the accept/reject gate; formats and limit as data
- `core/ingestion/acceptance.test.ts` — 39 tests, no network or credentials
- `core/ports/document-store.ts` — the storage port
- `core/ports/boundary.test.ts` — enforces "core imports nothing outward" (3 tests)
- `core/ingestion/storage-key.ts` — object key derived from the content hash
- `core/ingestion/storage-key.test.ts` — 11 tests
- `adapters/storage/document-store-s3.ts` — the only AWS SDK importer
- `adapters/storage/document-store-s3.test.ts` — 13 tests, injected client
- `core/ports/document-repository.ts` — the recording port, incl. the AD-13 replace seam
- `core/ingestion/ingest.ts` — the per-file pipeline
- `core/ingestion/ingest.test.ts` — 22 tests, both ports faked
- `adapters/db/document-repository-postgres.ts` — writer-role adapter, `on conflict do nothing`
- `adapters/db/document-repository-postgres.test.ts` — 11 tests, requires a database

- `core/ingestion/upload-feedback.ts` — the copy, derived from the gate and the PRD
- `core/ingestion/upload-feedback.test.ts` — 17 tests
- `app/upload/page.tsx` — the surface, auth-guarded
- `app/upload/upload-form.tsx` — per-file outcome rows
- `app/upload/actions.ts` — the composition root for ingestion

**Modified**

- `package.json` — `test:db` now covers `adapters/db/` as well as `migrations/`

### Local review findings (pre-commit)

Two real defects, both in the composition root, both fixed before the commit. Neither was in the
code that had tests — they were in the wiring between the pieces that did.

**1. A new S3 client per request.** `actions.ts` called `createS3DocumentStore()` inside the
action, so every upload built a fresh store and therefore a fresh client. The adapter reuses its
client for the lifetime of a store, and a test asserts that — but a store per request makes the
guarantee worthless. This is failure mode H4 arriving by a route H4's test could not see: the unit
under test was right and its caller was wrong.

Fixed by constructing both adapters once at module scope. That is safe *because* of H1: neither
factory reads its environment at construction, which is the same property that keeps `next build`
from needing credentials. The two requirements turn out to be the same requirement.

**2. A non-function export from a `'use server'` module.** `actions.ts` exported
`EMPTY_UPLOAD_STATE` and the `UploadState` type; server-action modules may export only async
functions. It compiled, which is the problem — a constraint that happens to be tolerated today is
still a constraint. Moved both to `app/upload/upload-state.ts`.

### Change Log

| Date | Change |
| --- | --- |
| 2026-08-03 | Task 1 — migration `004_document.sql` and 30 database tests |
| 2026-08-03 | Task 2 — `core/ingestion/content-hash.ts`, oracle-based tests |
| 2026-08-03 | Task 3 — `core/ingestion/acceptance.ts`, the accept/reject gate |
| 2026-08-03 | Task 4 — storage port, hash-derived key, S3 adapter, `core/` boundary test |
| 2026-08-03 | Task 5 — ingestion service, repository port, Postgres adapter; `test:db` widened |
| 2026-08-03 | Task 6 — upload copy in `core/`, `/upload` surface |
| 2026-08-03 | All six tasks complete; 532 unit + 58 database tests, lint and build clean |

### Acceptance Criteria coverage

| AC | Where it is proven |
| --- | --- |
| AC1 — stored, recorded, hashed before extraction, via the writer role | `ingest.test.ts` (order, hash-derived key, recorded columns), `document-store-s3.test.ts` (the put), `document-repository-postgres.test.ts` (writer role, every column) |
| AC2 — re-upload replaces, never duplicates; told it was already held | `document.test.ts` (the uniqueness constraint), `document-repository-postgres.test.ts` (the deterministic interleaving test), `ingest.test.ts` (already-held, derived-row replacement, same file twice in one batch), `upload-feedback.test.ts` (not phrased as a failure) |
| AC3 — rejected as a fact, batch continues | `acceptance.test.ts` (type and size, boundaries), `ingest.test.ts` (rejection mid-batch), `upload-feedback.test.ts` (formats and limit stated, derived from the gate) |
| AC4 — unreadable halts for that file, in the PRD's words | `acceptance.test.ts` (encrypted PDF, OLE-encrypted xlsx, mislabelled binary, and the inverse), `ingest.test.ts` (neither port called), `upload-feedback.test.ts` (FR-1 compared against `docs/prd/prd.md`) |
| AC5 — role separation holds for the new table | `document.test.ts` (reader may SELECT and nothing else; writer may INSERT/UPDATE/DELETE) |

### Carried forward to story 1.5

- `replaceDerivedRows` is a called, tested seam with an empty body — 1.5 fills in one function rather than hunting for the call site.
- The `/Encrypt` check answers "does this container announce itself as encrypted", not "can this be parsed". Real parse failures belong with extraction.
- The `failed` outcome is a fifth surface state beyond the four UX-DR12 names; see the Task 5 Test Design note.
- The 25 MiB limit is an assumption of this story, not a PRD figure.
