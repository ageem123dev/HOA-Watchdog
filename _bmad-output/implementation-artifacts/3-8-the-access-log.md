---
baseline_commit: 721fd67
---

# Story 3.8: The access log

Status: in-progress

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

### `test:db` could not be run in this environment

`WATCHDOG_WRITER_DATABASE_URL` is unset here, so `adapters/db/query-log-reader-postgres.test.ts`
**skips** — 8 cases, including the one that proves the `select` grant exists. That test is the only
thing that can catch an adapter built on the wrong credential, because a mocked pool answers happily
either way and the real failure is a `42501` in production.

What *did* run is `query-log-reader-connection.test.ts`, which asserts the adapter asks for the
**writer** URL and never touches the reader one. Sensitivity-checked: pointing it at the reader pool
fails both cases. So the credential choice is verified; the grant behind it is asserted but unproven
until this runs somewhere with a database.

Stated rather than buried, because "2213 passing" and "the access log works" are not the same claim.

## Review Findings

_To be filled by the review._

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-12 | Story created after 3.7 merged. Two design decisions were already fixed by earlier stories: a separate read port, and the writer credential. |
