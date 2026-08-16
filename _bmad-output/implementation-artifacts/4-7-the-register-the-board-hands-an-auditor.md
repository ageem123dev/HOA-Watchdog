---
baseline_commit: 69fe6c7
merge_request: 61
---

# Story 4.7: The register the board hands an auditor

Status: done

## Why this story exists

Story 4.6 built the one action in the pilot: a board member marks a finding reviewed and it leaves
the dashboard. **It leaves for somewhere that does not exist yet.** EXPERIENCE.md is explicit about
where:

> *"Reviewed moves, it does not close. Marking a finding reviewed relocates it from the dashboard
> into the register, where it remains searchable and exportable forever."*

Right now it relocates into nothing. A reviewed finding is a row nobody can reach — the dashboard
filters it out by design, and there is no other surface that reads it. **The product currently
loses the record at the exact moment it claims to have preserved it**, which is the reverse of what
the register is for.

And the register is not a listing screen. It is *the* fiduciary artifact:

> *"The register is the fiduciary artifact. It answers 'what did the board know, and when.' Export
> from here feeds the board packet."*

That sentence is why this story carries an export and a print treatment rather than deferring them:
a record an auditor cannot be handed is not the thing being described.

### The decision that shapes the export (taken 2026-08-16)

**EXPERIENCE.md's example copy and this codebase's only precedent disagreed, and the user resolved
it.**

The export control's specimen wording is *"Export 17 reviewed findings as PDF"* (Component
Patterns). The only export the product has — the access log, story 3.8 — is **CSV**, and generating
a PDF server-side means a new heavyweight dependency with no precedent here.

The accessibility review is what breaks the tie, because it ties the two requirements together
directly: it raises the missing print stylesheet *because* "the register's whole purpose is
producing a board-packet export".

**Resolution: the print treatment is the PDF path, and the export control produces CSV.** A director
who wants paper or a PDF prints the register — UX-DR22's treatment is what makes that legible — and
the download is CSV, matching `app/access-log/export/route.ts` byte for byte in its conventions. No
new dependency, and both UX-DR8 and UX-DR22 are satisfied by the thing each was actually written
about.

## Story

As a board member,
I want a permanent, searchable register of every reviewed finding that I can print or download,
so that when an auditor asks what the board knew and when, I can hand them the answer.

## Acceptance Criteria

**AC1 — The register lists reviewed findings, and only reviewed ones.**
The mirror of the dashboard's queue, and the two must partition the register between them: a
finding is on exactly one of the two surfaces, never both and never neither. Newest review first,
with a tie-break so two renders of an unchanged register agree — the rule
`adapters/db/finding-reader-postgres.ts` already carries for the queue.

**AC2 — Each row says who reviewed it and when, not merely that it was reviewed.**
The register answers *which human* and *when*. `finding_review_is_attributed` guarantees both are
present on a reviewed row, so the surface may rely on it — but `board_member.display_name` is
nullable, and a reviewer who never had a name still reviewed it. Say what is known; never invent a
name and never print `null`.

**AC3 — Search narrows the register, and says what it narrowed to.**
UX-DR14's search. A search that matches nothing says so as an ordinary outcome — never an error,
and never the empty state of AC7, which means something different. The count shown must be the
count of what is displayed, and where the register is longer than the page, the surface says so
rather than letting a reader believe they have seen all of it (the rule story 4.5 established for
the dashboard).

**AC4 — The export states what it will produce before producing it, with a count.**
UX-DR8: *"Export 17 reviewed findings as CSV"*, never a bare "Export". **The count is the count of
what will actually be in the file**, so it agrees with the search that is applied — an export that
silently ignored the filter would hand a reader a different document from the one on screen, which
is the defect `app/access-log/export/route.ts` records having fixed.

**AC5 — The download is CSV, and it is safe to open in a spreadsheet.**
`core/provenance/access-log-csv.ts` already solved this and its reasoning transfers exactly: a cell
beginning `=`, `+`, `-`, `@` or their full-width forms is a **formula** to Excel, and this file is
built from vendor names and unit numbers lifted off documents the association received. Reuse that
module's neutralisation rather than writing a second one. The UTF-8 BOM is written for the same
reason it is there.

**AC6 — The export route authenticates before it reads, and a missing session is a 404.**
A route handler is not covered by a page's guard. This one returns the association's entire
reviewed history — the single most attractive request in the product to an unauthenticated caller.
404 rather than 401: this endpoint's existence is not something an anonymous caller needs confirmed.
Asserted by the reader never being called, not only by the status code.

**AC7 — The empty register explains itself rather than reporting a fault.**
EXPERIENCE.md names the copy: *"Nothing has been reviewed yet."* — and requires it explain that
findings arrive here **after review**, rather than presenting it as an error. Distinct from AC3's
no-search-results state, which a reader reaches a different way and must be told about differently.

**AC8 — The export-in-progress state is named, counted, and the control is disabled during it.**
EXPERIENCE.md, State Patterns: *"Named progress, count stated, control disabled during."* The
control that is disabled must be the one that would start a second export.

**AC9 — Print treatment for the register *and* the finding detail, in one stylesheet.**
UX-DR22, and story 4.6's AC10 deferred it here precisely so the two would share one treatment
rather than grow two. What must not survive onto paper: navigation, controls, and the export button
itself. What must: the figures, who reviewed what and when, and the evidence tables.

**AC10 — Evidence tables reflow below 48rem; they do not scroll sideways.**
EXPERIENCE.md is unambiguous: *"evidence tables reflow to stacked label/value groups, one record per
group, figures still tabular. **They do not scroll horizontally** — a table that scrolls sideways in
a meeting is a table nobody reads."* **Story 4.6 shipped `overflow-x: auto` on the finding detail's
evidence table**, which is that rule broken. This story owns the responsive treatment for both
surfaces, so it is fixed here rather than recorded as someone else's problem.

**AC11 — The dashboard reaches the register.**
UX-DR10 lists the register link as part of the dashboard surface. A surface with no way in is one
nobody learns, and its absence is indistinguishable from having forgotten where it was — the
argument `app/dashboard/page.tsx` already makes for the quarantine link.

## Tasks / Subtasks

- [x] **Task 1 — Read the register** (AC: 1, 2, 3)
  - [x] Extend `FindingReader` with a reviewed read taking a filter — search text and a required
        `limit`, the shape `QueryLogFilter` uses and for the same reason: a register grows without
        bound and the caller that forgets a limit is the one that renders a page which never
        finishes loading. Return the rows **and the total**, as `UnreviewedQueue` does, so a caller
        cannot hold the rows without the count.
  - [x] The port test asserts an exact member list. Update it deliberately, and keep the negative
        that forbids a write member — the property check story 4.6 hardened is now the thing that
        judges the new member's return type, so read what it demands before adding one.
  - [x] `adapters/db/finding-reader-postgres.ts` + db tests. **Dates through
        `to_char(… at time zone 'UTC', 'YYYY-MM-DD')`** — the rule every reader here carries.
  - [x] Decide what search searches, and write the reasoning down. It cannot be "everything": the
        evidence is `jsonb` of varying shape. Prefer the fields a board member would name.

- [x] **Task 2 — The register view** (AC: 1, 2, 3, 7)
  - [x] `core/findings/` gains the register's copy, reusing `toFindingRow` for the row and
        `reviewMessage` for the attribution sentence — 4.6 made both the single source, and a third
        wording of "already reviewed by X on Y" is exactly the drift they exist to prevent.
  - [x] The three states are one decision in `core/`, as `toDashboardView` is: empty, no-matches,
        and rows. A surface deciding emptiness for itself gets the reassuring copy on the day the
        association signs up.

- [x] **Task 3 — The surface** (AC: 1, 2, 3, 4, 7, 8, 11)
  - [x] `app/findings/register/page.tsx`, guarded **before** the read, matching
        `app/findings/[id]/page.tsx`.
  - [x] Search as a GET form, so the URL is shareable and the back button works —
        `app/access-log/` is the precedent, including `filter.ts` living in its own module so the
        suite can test it without pulling `next-auth` in.
  - [x] The export control states the count it will produce. The in-progress state disables it.
  - [x] The dashboard gains the link (AC11).

- [x] **Task 4 — The download** (AC: 4, 5, 6)
  - [x] `app/findings/register/export/route.ts`, following `app/access-log/export/route.ts`:
        auth before read, 404 for no session, BOM, `Content-Disposition`.
  - [x] The CSV producer lives in `core/`, reusing `access-log-csv.ts`'s `cell` neutralisation.
        **Do not write a second formula-injection guard** — extract or import the first.
  - [x] The route honours the same filter the page did, and a test proves the exported set matches
        the on-screen set.

- [x] **Task 5 — Print and reflow** (AC: 9, 10)
  - [x] One stylesheet serving the register and the finding detail. Decide where it lives so both
        import it rather than each carrying a copy.
  - [x] Assert what is *absent* from print — controls, navigation, the export button — as well as
        what survives. An assertion that only checks presence passes against a stylesheet that
        hides nothing.
  - [x] **Fix story 4.6's `overflow-x: auto`** on the finding detail's evidence table and give both
        tables the stacked reflow below 48rem.

## Dev Notes

### What already exists and must not be rebuilt

| Thing | Where | Note |
| --- | --- | --- |
| `FindingReader`, `FindingDetail`, `Reviewed` | `core/ports/finding-reader.ts` | `Reviewed { by: string \| null; on: string }` is already the shape this story lists. |
| Row copy, severity, `formatAmount`, `toFindingRow` | `core/findings/finding-view.ts` | Reuse. Three surfaces describe one finding; this is the fourth. |
| `reviewMessage({ outcome: 'already-reviewed', by, on })` | `core/findings/review.ts` | **The attribution sentence already exists.** 4.6 made the page and the refusal share it; the register is the third caller. |
| `toFindingDetail`, the evidence tables | `core/findings/detail-view.ts` | The detail page's layout, and what the print treatment must carry. |
| CSV cell neutralisation, the BOM, the export route shape | `core/provenance/access-log-csv.ts`, `app/access-log/export/route.ts` | **The whole export problem is solved once already.** Read both before writing anything. |
| Filter-from-URL, tested as a pure function | `app/access-log/filter.ts` | Including *why* it is a separate module. |
| Deny-by-default routing, `findingRoute(id)` | `core/auth/route-policy.ts` | `PUBLIC_ROUTES` is an allow-list; a register route is closed without being listed. |

### Use `writerPool()` for this read, and do not "correct" it

Every finding reader here uses `writerPool()`, and on a story about a **read-only permanent record**
that looks exactly like an oversight worth tidying — AD-4 says the reader role is SELECT-only, so
surely a register belongs on `readerPool()`.

**It does not, and migration 021 says why in as many words:**

> *"Nothing is granted to watchdog_reader, and the silence is the decision — migration 003 revoked
> its blanket SELECT so that read access became explicit per table. Findings are read by the gateway
> on behalf of a board member, and the LLM-driven query path has no business reading them: a catalog
> entry that returned findings would let a question about dues surface an unreviewed accusation
> about a member."*

`readerPool()` is the role the catalog executes as. Pointing the register at it fails with a
permission error — and the dangerous repair is the obvious one: granting `watchdog_reader` SELECT on
`finding`, which silently hands every finding to the Oracle's query path. **That grant is the thing
migration 021 exists to withhold.** If this genuinely needs revisiting it is an architecture decision
for the user, not a story fix.

### The one query worth thinking about before writing it

The dashboard reads `state = 'unreviewed'`; this reads `state = 'reviewed'`. **Those two must
partition the table** — AC1 — and the cheapest way to get that wrong is to write a second query
whose predicate drifts from the first. Migration 021 constrains `state`, so check what values it
actually admits before assuming there are two.

Ordering is `reviewed_at desc`, and it needs the same tie-break argument the queue's `raised_at
desc, id desc` records: one review run can stamp several rows on the same `now()`.

### What 4.6 learned, and this story inherits

- **The AC audit has found something on eight consecutive stories.** On 4.6 it found `period` read
  by the adapter, carried by the port and the view, and rendered by nothing. Run it, and run it
  against this story's ACs rather than against the code you just wrote.
- **A fix is the highest-risk diff.** 4.6's held-write took three review rounds because each round
  found a defect in the previous round's fix.
- **Ask of every refusal test: what would this look like if the refusal did not happen?** AC6 is a
  refusal test.
- **The test-value pass finds what mutation cannot** — on 4.6 it found a guard covered by nothing
  (all 115 tests passed with it removed) and a test passing for the wrong reason.
- **`Date.UTC` rolls an impossible date forward rather than refusing it.** If this story does date
  arithmetic, round-trip the result and compare.
- **A stray backspace has now reached source three times, most recently in 4.6.**
  `docs/no-control-characters.test.ts` reads **markdown only**, so it did not see the `.ts` one.
  **Anything carrying a backslash goes through the editing tool, never a shell heredoc** — and
  widening that guard is an open action item this story may pick up if it touches the area.
- **Never truncate a gate's output past its verdict.** `npm test | tail -3` hides the pass count,
  and a red suite was pushed on 4.6 because of it.
- **A clean CodeRabbit verdict arrives as an *edit* to the summary comment**, not a new note.
- **The close-out rides in every review round's commit**, not the last one.

### Where this story is unlike its predecessors

It is the first surface that is **an artifact rather than a workflow**. The dashboard is a queue you
work through; the register is a document you hand to somebody. That is why print and export are
acceptance criteria rather than polish, and why the copy has to survive being read aloud in a
dispute by someone who does not use the product.

### References

- [Source: epics.md] — Epic 4 spine, row 4.7; UX-DR8, UX-DR14, UX-DR22
- [Source: EXPERIENCE.md] — Alert Lifecycle (the register as fiduciary artifact); Component
  Patterns (export control); State Patterns (register empty, export in progress); Accessibility
  Floor (print is a supported output); Responsive & Platform (tables do not scroll horizontally)
- [Source: app/access-log/] — the export, filter and CSV precedent, in full
- [Source: 4-6-one-finding-and-what-to-do-about-it.md] — the review record these learnings come from

## Dev Agent Record

### Agent Model Used

claude-opus-5[1m]

### Test Design

#### Task 1 — read the register

**Behaviour: `reviewed(filter)` on `FindingReader`, and its Postgres adapter.**

*If it ran correctly, how would I know?* It returns **only** reviewed findings, newest review first,
each carrying who reviewed it and when — and a `total` that counts every match, not the page. The
strong check is the **partition**: `unreviewed()` and `reviewed()` over the same table must be
disjoint and, together, complete. That is a property assertable against the database rather than a
restatement of the query.

*How am I going to test it?* Port shape by source assertion (`declaredMembers`, as story 4.6
hardened it); behaviour by db tests against real rows, prefixed per run as every db test here is.

*Could this happen anywhere else?* The queue read is the sibling and its defects are documented:
an unbounded read, a total that disagrees with the rows, a missing tie-break that reshuffles
between refreshes, and dates rendered in the session timezone.

**What search searches — decided, and verified against the database.** The naive
`evidence::text ILIKE '%q%'` matches **key names**: a board member searching "vendor" would get
every spike finding because the key is spelled `vendorName`, and uuid fragments would match too.
Postgres here is **18.4**, so jsonpath is available and `strict $.**.vendorName` reaches values at
any depth — including inside the `pairs` and `spikes` arrays — without ever touching a key.

So a search matches, case-insensitively: the **finding type**, the **reviewer's display name**, and
the values of **`vendorName`, `unitNumber`, `holderName`** anywhere in the evidence. Those are the
three things a board member would actually type. Ids, keys and internal slugs are deliberately not
searchable.

| # | Failure mode | Class | Forced by |
| --- | --- | --- | --- |
| 1 | an unreviewed finding appears in the register | GUARD | seeded unreviewed row absent; and the partition property |
| 2 | a reviewed finding is missing from it | GUARD | the partition property — the two reads together cover the table |
| 3 | `limit` absent, zero, negative, fractional, or huge | GUARD | `RangeError`, never clamped — the contract `unreviewed` already states |
| 4 | `total` counts the page rather than every match | GUARD | seed more than the limit; total exceeds `findings.length` |
| 5 | `total` ignores the search while the rows honour it | GUARD | a search matching a strict subset; both must narrow together |
| 6 | two reviews stamped on the same `now()` reshuffle between reads | GUARD | tie-break on `id`, asserted by reading twice |
| 7 | dates rendered in the session timezone | GUARD | `to_char(… at time zone 'UTC')`; two zones in opposite directions, since `TZ` is ignored on this host |
| 8 | search matches a **key** name, not a value | GUARD | evidence containing `vendorName`; searching `vendorname` returns nothing |
| 9 | search matches a uuid or internal slug | GUARD | searching a fragment of `subject_id` returns nothing |
| 10 | search misses a vendor nested inside `pairs`/`spikes` | GUARD | the arrays are where every vendor name actually lives |
| 11 | search is case-sensitive | GUARD | `coastal` finds `Coastal Landscaping` |
| 12 | `%` or `_` in the search term act as wildcards | GUARD | a literal `%` matches nothing rather than everything |
| 13 | a reviewer with no display name breaks the row | GUARD | `by: null`, and the row still renders |
| 14 | search term is blank or whitespace | GUARD | treated as no filter, not as a filter matching nothing (`app/access-log/filter.ts`'s rule) |
| 15 | the read is pointed at `readerPool()` | GUARD-by-note | it would fail on grants; see the Dev Notes — the dangerous repair is granting SELECT |

**Cross-check.** #1 and #2 are one property tested from both sides, and it is the strong one: the
register and the queue are asserted to **partition** the table rather than each being asserted
against a literal expectation of its own.

#### Task 2 — the register view

**Behaviour: `toRegisterView(register, filter)` — the register's copy and which of its states applies.**

*If it ran correctly, how would I know?* Each row carries the same title, severity and sentence the
dashboard gives the same finding, plus the attribution sentence the detail page gives it — and the
**three states are told apart**: an empty register, a search that matched nothing, and rows.

*How am I going to test it?* Pure function over a literal `ReviewedRegister`. Same as
`toDashboardView`, which is the precedent this mirrors.

**AC3 and AC7 are two different empty screens, and conflating them is the defect.** `rows.length
=== 0` is true for both, so a surface branching on it tells a board member who searched for a vendor
that *nothing has been reviewed yet* — reassurance about the whole record, in answer to a question
about one vendor. `toDashboardView` was built against exactly this shape of mistake.

| # | Failure mode | Class | Forced by |
| --- | --- | --- | --- |
| 1 | empty register and no-matches told apart by `rows.length` | GUARD | zero rows **with** a search is a different state from zero rows without one |
| 2 | the reassuring copy shown to someone who searched | GUARD | the no-matches state names the search back |
| 3 | a fourth wording of "already reviewed by X on Y" | GUARD | cross-check: equals `reviewMessage`'s text for the same review |
| 4 | a second wording of the row's title or sentence | GUARD | cross-check against `toFindingRow` for the same finding |
| 5 | a reviewed row arrives with `reviewed: null` | GUARD | the port permits it; the view must not print "null" or crash |
| 6 | the export count is taken from the page, not the total | GUARD | `total` exceeding rows must reach the surface as the export's count |
| 7 | the surface cannot say it is showing a window | GUARD | rows fewer than total is a distinct, nameable fact |
| 8 | search text echoed into copy unescaped | PROPAGATE | carried verbatim; React escapes it, and escaping here would double it |
| 9 | a search of only whitespace treated as a search | GUARD | the state is "empty register", not "no matches for '   '" |
| 10 | total disagrees with rows when rows is empty | GUARD | zero rows and a non-zero total is a contradiction the view must not present as either state |

**Cross-check.** #3 and #4 are the strong ones and they are the same technique task 1 used: compare
against the *existing* implementations of that copy rather than against literals chosen here, so the
test fails when the surfaces drift rather than when someone reworded a fixture.

#### Task 3 — the surface

Three pieces, and the middle one is where the design decision is.

**`filter.ts` — the URL, narrowed.** A pure module for the reason `app/access-log/filter.ts` states:
importing the page pulls in `auth` and therefore `next-auth`, and the suite cannot load the file.
It inherits two defects that file already paid for — a repeated parameter arriving as an array, and
a `limit` that must be truncated *before* it is range-checked, since the other order turns
`?limit=0.5` into a limit the adapter then clamps up to 1.

**`export-control.tsx` — and AC8 is why it is a client component.** The access log's export is a
plain `<a href>`, which cannot have an in-progress state at all: the browser navigates and the page
never learns what happened. EXPERIENCE.md requires *"named progress, count stated, control disabled
during"*, so the register fetches the CSV, names what it is doing while it does it, and turns the
result into a download.

**The fetch is a prop**, for the reason story 4.6 made its write a prop: it is the only way to
assert the disabled state *while the request is in flight*, and "the control is disabled during"
is the whole of AC8.

| # | Failure mode | Class | Forced by |
| --- | --- | --- | --- |
| 1 | a repeated `?search=` arrives as an array | GUARD | first value taken, page renders |
| 2 | `?limit=0.5` becomes 1 after the adapter clamps | GUARD | truncate before the range check |
| 3 | a bad `limit` errors the page | GUARD | falls back to the default; this is a URL people edit |
| 4 | a blank search box filters to nothing | GUARD | `''` is absent, not a filter |
| 5 | the export ignores the search | GUARD | the link carries the same filter the page read |
| 6 | the export control does not say what it will produce | GUARD | UX-DR8: the count, and the format, before producing it |
| 7 | the count comes from the page rather than the total | GUARD | the file holds every match, so the control names `total` |
| 8 | the control stays live during the export | GUARD | **disabled while in flight** — asserted mid-request, not after |
| 9 | a second export can be started | GUARD | the same assertion from the other side |
| 10 | a failed export reports success, or nothing | GUARD | says it failed, and re-enables |
| 11 | the control is smaller than 24×24 CSS px | GUARD | UX-DR8's minimum target |
| 12 | the search box loses its value on a soft navigation | GUARD | uncontrolled input keyed on the value — Argus's finding on the access log |
| 13 | the limit is dropped when the search form submits | GUARD | a GET form submits only what it contains — the same Argus finding |

### Completion Notes

**Baseline (a4d584c):** 2770 tests, 813 db tests, 8 pre-existing `tsc` errors — **and one
unidentified intermittent failure**. The first baseline run failed a single test; the next ten
passed. The branch adds only a markdown file, so it is pre-existing on `main` at roughly 1-in-11.
It could not be named within bounded effort because the failing run scrolled past uncaptured. Every
gate run in this story now writes full output to a file so the next occurrence is identified. With
CI removed this suite *is* the gate, and an unnamed flake is one that gets re-run away.

#### Task 1 — read the register

`register(filter)`, not `reviewed(filter)`, **and the port's own guard is why**. The test forbidding
`mark|review|raise|…` on this interface fired on the first name — it exists so a *write* capability
cannot arrive quietly. Widening it to admit a read would have spent a real protection on a naming
preference. `register` is EXPERIENCE.md's own word for this artifact and collides with nothing.

**Then the guard fired again on the *return type*** — `ReviewedRegister` splits to `Reviewed
Register`. A capability is something the port can be asked to do, and it is *named*, so the guard now
matches the member **name** rather than the whole declaration. Six mutations confirm nothing was
lost: `markReviewed(id)`, `readonly dismiss: (id) => void`, `resolve?(id)`, `autoResolve`,
`auto_clear` and `byIDRemove` are all still caught. A guard that rejects a correct design is as
broken as one that admits a wrong one.

**What search matches, decided and verified against the database.** Postgres here is **18.4**, so
`strict $.**.vendorName` reaches values at any depth — including inside the `pairs` and `spikes`
arrays. So a search matches the finding type, the reviewer's display name, and the values of
`vendorName`, `unitNumber` and `holderName`. **Never keys**: the naive `evidence::text ilike`
answers "vendor" with every spike finding, because the key is spelled `vendorName`. Asserted as a
non-match.

**Totals here are exact, not bracketed.** 4.6's queue tests had to bracket counts between control
reads and recorded the residual that a concurrent insert *and* delete can straddle the bracket.
Scoping every search to this run's prefix makes the total exactly what the file seeded. A test that
can be exact should not be approximate.

*Two defects the tests caught before review:*

- **`_` was an unescaped wildcard**, so `_oastal` matched `Coastal` — a search that appears to work
  while answering a different question.
- **The fix for it silently did nothing.** `escape '\'` inside a JS *template literal* renders at
  runtime as `escape ''` — the backslash escapes the quote, leaving no escape character. Nine tests
  named it. The escaping now lives in `likePattern`, built once in TypeScript rather than as five
  copies of a `replace` chain in SQL, **and has its own unit test** — `npm test` skips the db suite,
  so the load-bearing logic was otherwise guarded only by tests most runs never execute.

*Sensitivity:* four mutations. Two caught immediately (register returning unreviewed rows; the date
without its UTC cast). **Two were not, and both were worth the run:**

- **The tie-break test asserted stability, not order.** Dropping `id desc` left the suite green,
  because Postgres given no tie-break is *free* to reshuffle and mostly does not bother. Re-specified
  to assert the exact expected order — `id desc` on time-ordered uuidv7 puts the later insert first
  — and the mutation now fails.
- **An inner join changed nothing, because my comment was false.** I wrote that the reviewer "may
  have been removed"; `reviewed_by` declares no `ON DELETE` action, so a referenced member cannot be
  deleted, and `finding_review_is_attributed` guarantees the column is set. The left join is
  *equivalent here today*. No test was invented for an unreachable state — the comment was corrected
  to say what is true, and why the join is kept anyway (both ways it stops being equivalent end with
  rows missing from a permanent record). **This is the third comment in this file to assert
  something untrue about the database**, after story 4.3's migration comment and 4.6's own left-join
  comment, which Argus corrected for the same query.

*And the backslash bit a fourth time.* The corrected comment used backticks around
`finding_review_is_attributed` — inside a template literal, which ended the SQL string mid-query.
The warning against exactly that sits **three lines below** where I wrote it, and the suite reported
it as "no tests" rather than as a syntax error.

*Review gate — `argus_review` on the task diff:* `complex` · confidence 1.0 · 7/7 files · **no
findings**.

*Gate:* `npm test` 2779 · `npm run test:db` 846 · lint 0 errors · `tsc` 8 (baseline) · build compiled.

#### Task 2 — the register view

`toRegisterView` returns a **three-way union**, mirroring `toDashboardView`: `nothing-reviewed`,
`no-matches`, `entries`. The first two are both zero rows and owe opposite sentences — a surface
branching on `rows.length` answers somebody who searched for one vendor with reassurance about the
entire record.

**Nothing here is a fourth wording.** The row copy is `toFindingRow`'s and the attribution is
`reviewMessage`'s, both called rather than restated, and both asserted by **cross-check against
those functions** rather than against literals — so the tests fail when the surfaces drift rather
than when a fixture is reworded.

**A register that cannot state its own size is refused, in both directions.** Zero rows against a
non-zero total has no honest sentence; more rows than the total is the same contradiction mirrored,
and the export control states that total as the number of rows the file will hold. Both are
unreachable through the adapter, which is why they are refusals rather than repairs — preferring the
larger number would invent a count to cover a port that had already gone wrong.

*Sensitivity:* six mutations, all caught — collapse the two empty states (5), reword the row (1),
reword the attribution (2), drop the contradiction guard (1), always claim to show everything (1),
treat a blank search as a search (2).

*Review gate — `argus_review` on the task diff:* `moderate` · confidence 0.95 · 4/4 files. **Three
findings, all confirmed and taken** — every one about a value crossing into `core/` from outside the
type system:

- **[high] `search` can be an array at runtime.** `?search=a&search=b` hands Next.js a `string[]`,
  and `.trim()` on it throws and takes the page down. Treated as absent rather than refused: a
  read-only surface reached by a shared URL should answer a repeated parameter with the register,
  not an error page — the call `app/access-log/filter.ts` makes for a malformed limit.
  `core/auth/route-policy.ts` already guards its own typed parameters for the same reason.
- **[high] `finding.reviewed === null` misses `undefined`.** A port omitting the field satisfies
  neither the type nor a strict check, and the strict check then reads `.by` off nothing — making a
  register row the place a disagreement between layers first appears, as a crash.
- **[medium] more rows than the reported total** was passed through unexamined. Now refused, matching
  the opposite contradiction.

*Gate:* `npm test` 2805 · lint 0 errors · `tsc` 8 (baseline) · build compiled.

#### Task 3 — the surface

`MOST_REGISTER_ROWS` moved onto the port, because the adapter refuses past it and the surface parses
`?limit=` against it — two callers that have to agree, which is what
`core/ports/query-log-reader.ts` records fixing after a URL asking for 10,000 rows kept that number
in the page while the database returned 500.

**The export control is a client component, and AC8 is why.** The access log exports with a plain
anchor, which cannot have an in-progress state at all: the browser navigates and the page never
learns what happened. EXPERIENCE.md wants named progress, the count stated, and the control disabled
during — so this one runs the request and turns the result into a download.

**A bound function cannot cross the server boundary**, so the page hands over a URL and the
component knows how to ask for it; the request stays injectable because "disabled *during*" can only
be asserted while one is in flight. The default path — the one production runs — is tested too,
including that a **non-OK response is a failure rather than a file**: a 500's HTML body is a
perfectly good blob, and `reviewed-findings.csv` containing an error page is worse than no download,
because it looks like one that worked.

*Sensitivity:* five mutations, four caught. The fifth found a **guard with no test behind it** — the
re-entrancy ref was redundant under `fireEvent`, which flushes a re-render between clicks so
`disabled` already stops the second. The case it actually covers is three clicks batched *before*
any re-render, which needed an `act()` block to force. Written; the mutation now fails.

*Review gate — `argus_review` on the task diff:* `moderate` · confidence 0.9 · 12/12 files. Two
findings:

- **[medium] `URL.revokeObjectURL` immediately after `click()` — confirmed and fixed.** Revoking
  synchronously aborts the download in browsers that process the click asynchronously (Firefox,
  Safari), and the failure is silent: the control reports success and either no file arrives or an
  empty one does. Deferred past the handover. Asserted as *not yet revoked* when the click returns
  and revoked once timers run — "it revokes eventually" holds for the broken version too.
- **[medium] the dashboard's guard checks the user, not the user id — not reproduced as described.**
  The claim was that the page crashes when adapters query with a missing id; the dashboard's reads
  (`unreviewed`, `checked`) take no user id at all, so it does not. The inconsistency with the
  register page and the access log is real, but that guard is pre-existing and outside this story's
  ACs — recorded rather than changed, since editing an unrelated guard at this point risks a
  regression for no acceptance criterion.

*Gate:* `npm test` 2871 · lint 0 errors · `tsc` 8 (baseline) · build compiled, `/findings/register`
registered.

#### Task 4 — the download

The escaping moved to **`core/csv/cell.ts`**, imported by both exports. A findings module reaching
into `core/provenance/access-log-csv` for its quoting would have been a dependency that reads as an
accident, and the story forbids a second copy outright.

`registerCsv` builds every value from `toRegisterView` — the same function the surface renders from
— so the file cannot describe a finding differently from the screen it was downloaded from. An
auditor comparing the board packet against the register is the whole scenario this story exists for.

*Two tests that were wrong in useful ways:*

- **The formula-injection test targeted a vendor name and found it correctly unescaped.** A vendor
  sits *mid-title*, where a spreadsheet reads nothing. Which cell can actually begin with hostile
  text? Not the title, which opens with a fixed phrase and whose fallback is constrained by
  `finding_type_is_verb_noun`; not the evidence line, which opens with a count. **The reviewer's
  display name** is the one column whose first character is a person's to choose, and it is now the
  one asserted.
- **The BOM assertion could never have failed.** `Response.text()` UTF-8 decodes, which *strips* a
  leading BOM — so the test could not see one that was there. `app/access-log/export/route.test.ts`
  records the same trap and reads `arrayBuffer()`; this now does too, and dropping the BOM fails it.

*Sensitivity:* four mutations on the route, all caught — read before the guard (1), 401 instead of
404 (4), ignore the filter (2), drop the attachment disposition (1). Plus one on the escaping.

*Review gate — `argus_review` on the task diff:* the first call failed in the provider; the second
completed. `moderate` · confidence 0.9 · 9/9 files. Four findings — **three taken, one declined:**

- **[high] the formula check trimmed whitespace and nothing else — confirmed, and it is the
  significant one.** A control character is not Unicode whitespace, so a value beginning with one
  survived `trimStart()` with an ordinary-looking first character and walked past the check, while a
  spreadsheet skips the byte and evaluates. This guards **both** exports and had already been
  hardened twice — the same mistake each time: covering the characters someone thought of rather
  than the ones a spreadsheet ignores. Now a closed class, via a **code-point scan** rather than a
  regex, following `core/auth/route-policy.ts`'s own reasoning. Vertical tab and form feed turned
  out to be whitespace to `trimStart` already, which is why only part of the range was reachable.
  Postgres cannot store a NUL, so that payload cannot arrive from the database; the rest of the
  range can, in a display name.
- **[high] `period === undefined` misses `null`** — taken, along with a guard against an unparseable
  date, so a bad range empties one cell rather than writing "Invalid Date" into a board packet.
- **[high] O(N-squared) lookups** — taken as a `Map`, but **the severity is wrong**: the port's
  ceiling is 200 rows, so three `find` calls per row is 120,000 comparisons and microseconds, not
  the denial of service reported. Fixed because it is needless work, not because it was dangerous.
- **[medium] stream the CSV rather than building it in memory — declined.** The same 200-row ceiling
  bounds the file to tens of kilobytes, and `app/access-log/export/route.ts` builds its export the
  same way. A `ReadableStream` here is complexity bought against a load the port already forbids.

*And the backslash bit twice more* — five times now in this story lineage. Writing the
control-character test cases through a shell heredoc collapsed the escapes; writing the fix's regex
through the editing tool put **literal control bytes into a character class**, which is story 3.5's
exact defect. The resolution was already in the codebase and is now followed: `route-policy.ts`
refuses to use a character class for this, precisely so no control character need appear in source.

*Gate:* `npm test` 2930 · lint 0 errors · `tsc` 8 (baseline) · build compiled,
`/findings/register/export` registered.

### Review Findings

**Ten `argus_review` calls, one local CodeRabbit round, and the acceptance-criteria audit.
Thirty-one mutations run across the story; every one caught, after the tests that missed them were
rewritten.**

#### The integration pass — `main...HEAD` at the head the merge request points at

`complex` · confidence 1.0 · 26/33 files · **no findings.** This is the pass that sees the
composition of all five tasks, and it is where the parameter-parsing defect below was found on the
run before this one.

#### The four findings worth reading the commits for

1. **The acceptance-criteria audit found a defect, on the ninth consecutive story.** AC4 requires the
   export control to name "the count of what will actually be in the file". It named the register's
   *total* — but the route reads with the same filter, `limit` included, so a register of 200 shown
   50 at a time promised 200 and delivered 50.

2. **The CSV formula-injection defence was still bypassable, and it guards both exports.** It
   trimmed whitespace before checking for a formula leader; a control character is not whitespace,
   so a value beginning with one survived the trim looking ordinary while a spreadsheet skips the
   byte and evaluates. Hardened twice before, the same mistake each time — covering the characters
   someone thought of rather than the ones a spreadsheet ignores. Now a closed class, via a
   code-point scan.

3. **The page and its export read a repeated query parameter differently.** Next.js hands a page
   every value as an array and `filterFrom` takes the first; `Object.fromEntries` keeps the last. So
   `?search=a&search=b` showed findings matching "a" and offered a download of findings matching
   "b". Neither task's tests could see it: the page was right about arrays and the route was right
   about strings, and only reading them together showed they were right about different things.

4. **The print treatment did not reach the page.** Every surface styles inline with
   `var(--color-ink)`, and an inline style beats any rule in the sheet — so colours on `body` alone
   left the printed page using the screen palette. The tokens are redefined inside `@media print`,
   where they resolve.

#### Findings verified and refused, with reasons rather than silence

| Finding | Verdict |
| --- | --- |
| stream the CSV instead of building it in memory | **declined, twice** — the port caps the read at 200 rows, so the file is tens of kilobytes, and `app/access-log/export/route.ts` builds its export the same way |
| a GIN index for the jsonpath search | **declined** — performance work on that same capped read, and a migration besides |
| widen `search` to `unknown` | **declined** — it would remove the compile-time signal the runtime guard exists to backstop |
| `ReturnType<typeof vi.spyOn>` is a compile error | **not reproduced** — `tsc` reports 8, the baseline, none in that file; Argus read its own verifier's `rc=-1` as a diagnostic, as it did on story 4.6 |
| `searchParamsOf` returns arrays where Next returns strings | **not reproduced** — `filterFrom` normalises with `Array.isArray(value) ? value[0] : value`, which is the mechanism of the fix |
| the dashboard guard checks the user, not the user id | **not reproduced as described** — the dashboard's reads take no user id, so it cannot crash; the inconsistency is real, pre-existing, and outside this story |
| O(N²) lookups are a denial of service | **severity corrected** — 200 rows makes it 120,000 comparisons and microseconds; fixed as needless work, not as a hazard |
| an inner join would drop the nameless reviewer | **not reproduced** — `reviewed_by` declares no `ON DELETE`, so a referenced member cannot be deleted; **the comment claiming otherwise was mine, and was corrected** |

#### What the sensitivity checks caught that the tests did not

Three times a mutation passed and exposed a test that proved nothing: the tie-break test asserted
*stability* rather than order, so dropping `id desc` left the suite green; the export control's
re-entrancy guard was redundant under `fireEvent`, which flushes a render between clicks; and
`text()`'s blank guard in story 4.6's shared helper was covered by nothing at all. Each was rewritten
until the mutation failed.

Two of my own tests were wrong in useful ways: the formula-injection test targeted a **vendor name**
and found it correctly unescaped, because a vendor sits mid-title where a spreadsheet reads nothing
— the reviewer's display name is the only cell whose first character a person chooses. And the BOM
assertion could never have failed, because `Response.text()` strips a leading BOM.

#### The merge-request round — CodeRabbit's 7 findings on MR !61

**5 taken, 1 declined with a probe behind it, 1 taken further than it was raised.** Argus on the
fix diff then found a third defect, and reading for it found a fourth.

**The print treatment made the masthead unreadable.** `.on-ink` takes `--color-ink` for its ground
and `--color-on-ink` for its text, and the print block set *both* to black. Neither declaration
looked wrong alone. The token does not mean "another ink" — it means "the colour that sits against
ink", and it is used as a **ground** as well, so blackening it also turned the sign-in field into a
black box holding black text. Fixed in both places: the token stays light, and `.on-ink` inverts in
print so a masthead is not a band of solid toner. The regression test resolves the cascade the way
a browser does rather than matching strings, because the defect was invisible in the source.

**The stale-premise class had four members, not one.** CodeRabbit found the export control's
docblock still arguing for the count the AC audit had already fixed. Grepping the premise rather
than the file found three more — `register-view.ts`'s field doc, its rows-exceed-total comment, and
that comment's copy in the test. A fix that corrects the caller and leaves four comments teaching
the defect is a fix with a shelf life.

**The export could wait forever.** `fetch` with no deadline leaves the control disabled and reading
"Exporting…" for as long as the page is open — no file, no failure, no second attempt. Waiting was
the one state this control could not leave on its own; every other failure already reached the
`catch`. Implemented with a controller rather than `AbortSignal.timeout`, which reads better and
cannot be cancelled: its timer runs the full 30 seconds out even when the file arrived in one, and
the suite's fake timers do not drive it — measured, not assumed.

**Argus, on the fix diff: a non-finite total slips past both contradiction guards.** `NaN > 0` is
false and `rows > NaN` is false, so a total that is not a number satisfies every check in
`toRegisterView` and arrives at the page as the figure beside a board member's findings. Unreachable
through the adapter, and refused anyway — the module already refuses two other unreachable
contradictions, and this is the surface handed to an auditor.

##### The finding that was declined, with the probe rather than an opinion

CodeRabbit called `strict $.**.vendorName` a stability defect: a member accessor applied to a scalar
descendant aborts the query, so one oddly-shaped evidence blob would make the register unreachable
for everybody. Plausible, and it is a real property of strict mode — a direct `strict $.n.vendorName`
does raise. **It is not a property of `.**`**, which suppresses exactly those structural errors. Six
evidence shapes were measured, and `lax` proved to be the regression: it auto-unwraps arrays and
returns the same match twice. Declined, and pinned with a test seeding the shapes it named.

| Finding | Verdict |
| --- | --- |
| `.on-ink` prints black on black | **taken**, and widened to the token, which is used as a ground elsewhere |
| the export control's docblock contradicts its caller | **taken**, and three further copies found by grepping the premise |
| `fetch` is unbounded | **taken**, with the timer cleared on settle rather than left to run out |
| `toBeLessThanOrEqual(200)` proves nothing | **taken** — it passed for clamping, for falling back, and for clamping to 1; pinned to the port's own ceiling, plus the boundary below it |
| no test proves the anchor is attached when clicked | **taken** — the removal makes the end state identical either way, so it is asserted at the click |
| the `JSON.stringify` assertion cannot fail | **taken** — `"reviewed":null` matches neither alternative; replaced with the rendered copy, and proved to fire |
| `strict $.**` aborts on scalar descendants | **declined** — measured on this database; `.**` suppresses structural errors and `lax` duplicates matches |

Three Argus findings were declined: `save()` after unmount (the download was explicitly asked for,
and delivering it is the intent), and optional chaining on `register.findings` (it would remove the
compile-time signal the guard exists to backstop — the same reasoning that declined widening
`search` to `unknown`).

##### What the sensitivity checks caught in this round

Fourteen mutations, and two of them mattered beyond their own test. The `clearTimeout` survived
its mutation, which meant the docblock claimed a release nothing could falsify — so it was made
assertable rather than left as a comment. And the first timer test asserted a **count**, which
failed against correct code: jsdom schedules a timer of its own when a download anchor is clicked.
Matching the deadline by id rather than counting removed that accident from the assertion.

**A mutation harness silently did nothing, twice.** Two `perl` substitutions reported success while
matching nothing, because the files are CRLF and the patterns were not — and a mutation that does
not apply looks exactly like a test that caught it. Both were re-run against a harness that asserts
the mutation landed before trusting the result.

#### Gates on the final head, locally — there is no CI, so this is the whole of the evidence

`npm test` 2951 passed · `npm run test:db` 846 passed · `npm run lint` 0 errors (1 pre-existing
warning) · `npx tsc --noEmit` 8 errors, matching baseline · `npm run build` compiled, with
`/findings/register` and `/findings/register/export` registered.

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-16 | Merge-request round on !61: 7 CodeRabbit findings, 5 taken, 1 declined with a database probe, 1 widened. The print treatment printed `.on-ink` black on black. The stale premise CodeRabbit found in one docblock had three more copies. Argus on the fix diff found a non-finite total slipping past both contradiction guards. 14 mutations; the `clearTimeout` claim had no test until one was written for it. |
| 2026-08-16 | Tasks 1-5 implemented test-first. Ten Argus rounds, one local CodeRabbit round (15 of 17 taken), 31 mutations. The AC audit found the export control naming the register total rather than the rows the file would hold — the ninth consecutive story it has found something. The whole-story pass found the page and its export reading a repeated query parameter differently. Merge request !61 opened; status `done`, meaning ready-to-merge. |
| 2026-08-16 | Story created. The export-format conflict — EXPERIENCE.md's "as PDF" against the CSV precedent — was put to the user, who chose the print treatment as the PDF path and CSV for the download. Reading the spec against the code also found story 4.6's `overflow-x: auto` breaking EXPERIENCE.md's no-horizontal-scroll rule; fixed here as AC10. |
