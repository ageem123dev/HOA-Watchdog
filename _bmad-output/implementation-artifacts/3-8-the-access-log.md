---
baseline_commit: 721fd67
merge_request: 50
---

# Story 3.8: The access log

Status: done

## Why this story exists

AD-12 has been writing a provenance record on every catalog execution since story 3.1. **Nobody can
read it.** The port that writes it says so in as many words, and names this story as the fix:

> `core/ports/query-log.ts` — "This port can only write, and the absence of a read method is the
> design. […] Story 3.8 is what gives the log a reader, and it will surface it through the gateway to
> a board member — **not to the query path, which is the thing being recorded**. A `find` method here
> would satisfy the same acceptance criteria and hand the audit trail to its own subject."

An audit trail nobody reads is a promise, not a control. This is the story that turns AD-12 from a
database table into something a board member can hold up in a meeting.

> **NFR-5** — Query provenance. Every catalog execution permanently logs user id, timestamp, catalog
> entry id and version, bound parameters, and the exact SQL — written before results return, in an
> append-only store.

> **UX-DR16** — Access log surface: who asked what and when, filterable, exportable, with empty and
> filtered-to-nothing states distinguished.

### The two decisions that are already made

**The reader is a separate port, not a method on `QueryLog`.** Adding `find` to the write port would
hand the audit trail to its own subject — the query path could then read the record of its own
queries. The comment above is explicit, and it is the whole reason this is a story rather than a
one-line addition.

**The adapter uses the writer credential, not the reader one.** Migration 020 grants `select` on
`query_log` to `watchdog_writer` and deliberately nothing to `watchdog_reader`:

> "Nothing is granted to `watchdog_reader`, and the silence is the decision. […] The role the
> LLM-driven query path executes under has no business reading the audit trail of its own queries."

So no migration is needed, and an implementation reaching for the reader pool fails with a `42501` at
runtime rather than at build time. That is worth a test that names the pool.

### The clause that is always skipped

**"Empty and filtered-to-nothing states distinguished."** A surface that renders the same "no
results" for both tells a treasurer who filtered to a date range that the association has never run a
query. Story 1.5d found four defects of exactly this family after 29 mutations found none, one of
which showed "Reading" to a treasurer forever.

## Story

**As** a board member,
**I want** to see who asked what of the records, and when,
**So that** the audit trail is something I can read rather than something I am told exists.

## Acceptance Criteria

**AC1 — Who asked what, and when (NFR-5, UX-DR16).**
Each row shows the actor, the timestamp, the catalog entry and version, and the bound parameters. The
exact SQL is available per row — it is the column that makes the record reproducible a year later.

**AC2 — Newest first, and bounded.**
An audit trail is read from the present backwards. The query takes a limit, because a page that
renders every row a busy association ever produced is a page that stops loading.

**AC3 — Filterable (UX-DR16).**
At minimum by actor and by catalog entry. Filtering happens in the query, not in the browser: a
surface that fetches everything and hides some of it has still put the whole trail on the wire.

**AC4 — Empty and filtered-to-nothing are different states.**
"No queries have been run yet" and "no queries match this filter" are different sentences, and the
second one says what was filtered. This is the criterion most likely to be quietly skipped.

**AC5 — Exportable (UX-DR16).**
The filtered rows download as CSV. Values that begin with `=`, `+`, `-` or `@` are neutralised —
a CSV opened in a spreadsheet executes those as formulas, and this file contains attacker-influenced
text (a question a member typed) going to a board member's desktop.

**AC6 — The reader cannot write, and does not use the query path's credential.**
A separate port with no `record` method, and an adapter on the writer pool. Asserted, because the
alternative fails only at runtime and only in production.

**AC7 — Only a signed-in board member sees it.**
The same guard every other surface carries, asserted the same way: a session with no `id` redirects
rather than rendering.

**AC8 — Tested as a rendered surface, and against a real database.**
Render tests per story 1.6c's harness for the surface; `test:db` for the adapter, because a grant is
not a thing a mock can be wrong about.

## Tasks / Subtasks

- [x] **Task 1 — The read port (AC1, AC6)**
  - [x] `core/ports/query-log-reader.ts`. No `record` method, and a comment saying why.
  - [x] The record shape includes `executedAt` and the id, both of which the writer's entry type
        deliberately omits.

- [x] **Task 2 — The adapter (AC2, AC3, AC6, AC8)**
  - [x] Postgres, on the **writer** pool. A `test:db` test that it can actually select.
  - [x] Newest first, limit, filter by actor and entry id — in SQL.

- [x] **Task 3 — The surface (AC1, AC4, AC7)**
  - [x] Props-driven component, the `AnswerView` shape.
  - [x] Two distinct empty states, each asserting the other's copy is absent.

- [x] **Task 4 — Export (AC5)**
  - [x] CSV of the filtered rows, with formula neutralisation and a test that plants `=cmd|`.

- [x] **Task 5 — The gate**
  - [x] `npm run lint`, `npm run build`, `npm test`, `npm run test:db` (this touches an adapter and
        the schema), `npx --no-install tsc --noEmit` against the 8-error baseline.

## Dev Notes

### What exists

- `core/ports/query-log.ts` — the write port, and the comment that scopes this story.
- `adapters/db/query-log-postgres.ts` — `createQueryLog()`, the writer-pool insert. The read adapter
  sits beside it and shares its connection choice.
- `migrations/020_query_log.sql` — the table, the revokes, and the grant decision quoted above.
- `app/quarantine/page.tsx` — the closest existing surface: auth guard, a props-driven list
  component, and a page test that mocks `@/adapters/auth/auth` and `next/navigation`.

### Learnings that apply directly

- **Story 3.6b**: the auth guard must require `session.user.id`, not merely `session.user` — a
  session with no id otherwise surfaces as a generic outage. And make the `redirect` mock **throw**,
  because the real one unwinds the render.
- **Story 3.7**: two states that look alike must each assert the other's copy is *absent*, or one
  lump passes both tests.
- **Story 3.6c**: derive user-facing copy from real data and pin it; a plain link or GET form beats
  client-side navigation, and the URL is the state — which makes filters shareable for free.
- **Story 1.5d**: a surface story's defects are states that never resolve.
- **Anything carrying a backslash** goes through the editing tool, never a shell heredoc — a command
  string loses one level of escaping. `docs/no-control-characters.test.ts` catches the fallout.

### CSV injection is not hypothetical here

The `parameters` column holds values a member influenced, and the surface is read by a treasurer who
will open the export in Excel. A cell beginning `=` is a formula. Prefix such values, and test it with
a planted payload rather than trusting the sanitiser's name.

### If this has to be cut

Export. The surface, its filters and its two empty states are the criterion that matters; a treasurer
can read the trail on screen. Cutting the filters instead would be worse, because an unfiltered trail
is unreadable the moment it is long enough to matter.

### References

- [Source: epics.md] — NFR-5, UX-DR16
- [Source: ARCHITECTURE-SPINE.md] — AD-12, AD-15
- [Source: core/ports/query-log.ts] — the write port and this story's mandate
- [Source: migrations/020_query_log.sql] — the grants, and why the reader role gets nothing

## Dev Agent Record

### `test:db`, and the grant proven rather than asserted

**An earlier version of this section said the database was unreachable and these tests could not
run. That was wrong**, and the mistake is worth recording: `vitest` was invoked directly instead of
through `npm run test:db`, which passes `--env-file-if-exists=.env.local`. Without the env file the
suite saw no `WATCHDOG_WRITER_DATABASE_URL` and skipped itself exactly as designed — a skip that
looks identical to "no database here" from the outside. The user pointed at the env file.

Run properly, the first attempt then failed on a real constraint: `board_member.password_hash` is
`not null` and the seed omitted it. A mocked pool would have accepted that insert without comment,
which is a fair advertisement for this file existing at all.

**The grant is now proven.** Pointing the adapter at the reader pool and running against the real
database produces:

```
error: permission denied for table query_log
code: '42501'
```

That is migration 020's decision executing, not a comment describing it. Two tests catch the
credential choice — `query-log-reader-connection.test.ts` asserts which URL is requested, and this
suite asserts the URL requested actually works — and the failure mode they prevent has no build-time
signal at all.

All 8 cases pass.

## Review Findings

### AC audit, done before the MR — and it caught one

| AC | Status | Pinned by |
| --- | --- | --- |
| AC1 who asked what and when | met | actor, ISO timestamp with `<time>`, `entry@version`, parameters, **and the SQL per row** |
| AC2 newest first, bounded | met | db test asserts order; `MAX_LIMIT` clamped in two places |
| AC3 filterable, in the query | met | page test asserts the filter reaches `recent`; db tests filter by actor and entry |
| AC4 empty vs filtered-to-nothing | met | each state asserts the other's copy is absent |
| AC5 exportable, formula-safe | met | ASCII and full-width leaders, whitespace-hidden payloads, BOM, planted payload through the route |
| AC6 reader cannot write, right credential | met | port has no `record`; connection test names the URL; **db test proves the grant** |
| AC7 only a signed-in board member | met | page and route each refuse twice and assert the reader was never called |
| AC8 rendered surface + real database | met | 44 render/unit cases; 10 db cases |

**AC1 was not met when the audit started.** The exact SQL was in the export only, and AC1 says it is
"available per row". It is now behind a `<details>` in each row — collapsed, because it is the widest
value by far and would crowd out the four columns a reader scans, which is the same argument UX-DR6
makes for the Oracle's disclosure. `<details>` rather than a button because this is a server
component: it brings its own state, keyboard operation and announced state with no JavaScript.

That is the second story running where the audit found something four review rounds had not, and both
times it was a clause that was *partly* satisfied — the shape reviewers are worst at seeing, because
the code in front of them looks finished.

### Argus — five rounds

| Finding | Outcome |
| --- | --- |
| Export and page disagreed on repeated parameters: `?actorId=A&actorId=B` showed A, downloaded B | **Fixed** |
| Filter boxes went stale after a soft navigation | **Fixed** — keyed remount |
| Missing UTF-8 BOM, so Excel mangles a non-ASCII name | **Fixed** |
| Form dropped `limit` on submit | **Fixed** — hidden input |
| BOM written as a literal invisible character | **Fixed** — escape |
| `searchParamsOf` contradicted its own docblock | **Fixed** |
| CSV formula check bypassable by a leading space | **Fixed** — trims before testing, never trims the value |
| `limit` above `MAX_LIMIT` mismatched between URL and rows | **Fixed** — bound moved to the port |
| "The newest-first test is flaky, the id is a random UUID" | **Rejected** — migration 020 defaults `id` to `uuidv7()`, which sorts by creation time. Five consecutive runs pass. |
| "The pool has no dispose, so the runner hangs" | **Skipped** — the writer adapter beside it has the same pattern and the suite does not hang. A lifecycle for module-scoped pools is one change across every adapter, not a lopsided fix inside this story. |

### CodeRabbit CLI — 17 of 17 files, six findings, five applied

The major one: the formula filter knew only the ASCII four, and Excel with a Japanese IME converts a
leading full-width `＝` into a formula. **Two separate rounds widened this one defence** — first for
leading whitespace, then for full-width — which is a fair argument for treating "neutralise formulas"
as something to keep attacking rather than a box to tick.

Also fixed: `?limit=0.5` returned **one row** (truncation ran before the `> 0` check, and the adapter
clamped 0 up to 1); `one()` called twice per key; the filter shape restated instead of imported; and
the remount test strengthened to dirty the input first, which is the real back-button scenario.

Skipped with reason: the hidden `limit` input keeps `value` rather than `defaultValue`. React emits no
warning for a hidden input (checked), and `value` is correct — it is derived state that must mirror
the filter, and `defaultValue` would reintroduce the staleness the keyed inputs were fixed for.

### MR !50, round 1 — 2 findings, both on the test file

| Finding | Outcome |
| --- | --- |
| `does not put the SQL in the table` asserted no column is named `sqlText` — never possible, so it could not fail | **Fixed.** The vacuous-guard shape this project has shipped ten times, and I introduced it while rewriting the test around the new disclosure, one commit before opening the MR. It now asserts *containment*: the SQL must sit inside the `<details>`. Moving the `<pre>` outside now fails; the version it replaced passed that mutation. |
| `getAttribute('dateTime') ?? getAttribute('datetime')` — the second branch is unreachable | **Fixed.** `getAttribute` lowercases for HTML elements. An unreachable fallback reads as uncertainty about the DOM and hides which spelling is asserted. |

Round 2: **clean** — `No actionable comments were generated`, range `75cea60 → 56deac6`, both threads
resolved.

### `argus_ingest` could not join this round

The CLI reviewed `b9867ee`; the last Argus run was recorded against the commit before it. Recorded
rather than presented as a comparison that happened — five of the six findings were below the
critical/major threshold and would have been filtered out regardless.

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-12 | Story created after 3.7 merged. Two design decisions were already fixed by earlier stories: a separate read port, and the writer credential. |
| 2026-08-12 | Implemented test-first. Five Argus rounds (8 fixed, 1 rejected, 1 skipped), CodeRabbit CLI 17 of 17 files with 5 of 6 applied. AC audit before the MR found AC1's per-row SQL clause unmet and fixed it. |
| 2026-08-12 | MR !50 round 1: 2 findings on the test file, both fixed; round 2 clean. Gate re-run on the final head. Status → done, meaning ready-to-merge on an unmerged branch. |
