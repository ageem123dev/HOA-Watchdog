---
Status: ready-for-dev
baseline_commit: 4310b9f
merge_request:
---

# Story 5.7 — the mapping is remembered

## Story

**As** a treasurer who has already told the importer what my columns mean,
**I want** the next export of the same shape to import without asking me again,
**so that** the mapping is something I set up once —
**and when** I change it, I want to be told what that changes and to have it recorded.

## What every earlier story in this epic deferred to here

5.4 built the draft, 5.5 the preview, 5.6 the suggestion, 5.6b the model behind it. **Every one of
them says, in its own words, that nothing is stored** — `actions.ts` has no repository in its
imports and a test reads the file to prove it; `prefill.ts`'s doc comment says *"story 5.7 is where a
mapping is remembered"*; 5.6's AC3 says *"nothing is stored — 5.7 is where a mapping is
remembered"*.

So this story is the first one that writes anything, and the structural tests those stories left
behind will fail the moment it does — **correctly**. Task 1 has to move those claims rather than
delete them: `actions.ts` may now reach a mapping store, and its import scan must say *that* instead
of "nothing".

## The decision epics.md deferred, taken

> *"A mapping change makes old bytes mean something new, and AD-13 does not cover it. Content-hash
> idempotency says re-ingesting the same bytes replaces that document's derived rows. It says nothing
> about the same bytes parsed under a **different mapping**… decide whether changing a mapping
> re-imports what it affects, or applies only to what arrives next — and say so where a treasurer can
> read it."*

**Chosen by the author: re-import what it affects.** Changing a saved mapping re-parses every
document imported under the old one and replaces their derived rows. AD-13's replace semantics extend
from *the same bytes re-ingested* to *the same bytes reinterpreted*.

Two consequences the story carries, and neither is optional:

- **No alert already raised may be re-sent.** AD-13: *"never emits a second alert for a finding
  already raised. Alerts are keyed on `(finding_type, subject_id, period)` so re-processing is a
  no-op."* A re-import that mailed a board a second copy of every duplicate-invoice alert would be a
  worse failure than the mapping being wrong.
- **A mapping edit now rewrites financial history**, so it must be a deliberate act with a record —
  what changed, when, by whom, and over which documents.

## The constraint most likely to be got wrong

> **AD-13:** *"Exactly one component owns creation of each derived entity; **a second write path for
> the same entity is a violation**."*

A re-import is the textbook temptation to write a second one. It must not.

**`ingest` already does this.** Re-ingesting the same bytes re-reads them and calls
`deps.extractions.replace(recorded.id, reading.records)` — that is AD-13's other half, already built
and already tested. `alreadyHeld` short-circuits **only** in the `no-reader` branch, so the ordinary
re-ingest path already re-parses and replaces.

So the re-import is not a new writer. It is *the existing read-and-replace, triggered by a different
event*, with the bytes fetched back from object storage — which AD-16 makes possible, since the
document row holds the storage key and `adapters/storage` is the one adapter that may construct a
storage client.

**If the implementation finds itself writing derived rows anywhere other than the component that
already owns them, stop.** That is the violation, not a shortcut.

## Acceptance Criteria

1. **A mapping is remembered against the shape it was made for.** Saved per association and document
   kind, keyed on the heading row it was built from, so a later upload of the same shape is matched
   without asking. Tenancy is 5.1's, not a new scheme.

2. **A later upload of the same shape imports with no mapping step.** The treasurer uploads and the
   file is read — no wizard, no confirmation. A file whose shape does not match a saved mapping still
   goes to the wizard, and the difference is visible to the treasurer rather than silent.

3. **Saving a mapping is explicit.** Nothing is written by looking at a preview or by leaving the
   page. The treasurer confirms, and what is stored is what they confirmed — 5.6's AC8 continues to
   hold once the mapping is durable.

4. **Changing a mapping re-imports the documents it affects, through the path that already owns
   them.** Their derived rows are replaced, not appended, and not written by any new component.
   Asserted structurally as well as behaviourally: the re-import reaches `extractions.replace` and
   nothing else writes derived rows.

5. **No alert already raised is re-sent.** A re-import over documents that previously raised findings
   emits no second alert, per AD-13's `(finding_type, subject_id, period)` key. Asserted with a mail
   sender that fails the test if called for a finding already raised.

6. **A re-import is a deliberate act with a record.** The treasurer is told, before it runs, how many
   documents it will re-read; and afterwards there is a durable record of the change — the old
   mapping, the new one, who changed it, when, and which documents were re-imported.

7. **A re-import leaves no document half-changed.** Each document is either fully re-imported or
   untouched; a failure partway through does not leave one document's rows replaced and another's
   half-written. The outcome per document is reported, not summarised into a single "done".

8. **Nothing that reads a mapping can write one, and nothing on the suggestion path can reach the
   store at all.** Story 5.6b's boundary test covers six modules and must stay green — the suggester
   gains no store, no repository, no catalog.

## Tasks / Subtasks

- [x] **Task 1 — Move the "nothing is stored" claims rather than delete them.** The structural tests
      from 5.3/5.4/5.6 say `actions.ts` reaches no repository. That stops being true here, and the
      tests must say what *is* true instead — a mapping store, and still no document store, no object
      storage, no `ingest`. (AC8)
- [x] **Task 2 — Remember a mapping.** The port, the shape key, and the adapter. Per association and
      kind, with 5.1's tenancy. (AC1, AC3)
- [x] **Task 3 — A matching upload skips the wizard.** Look up by shape at upload time; fall through
      to the wizard when nothing matches, visibly. (AC2)
- [x] **Task 4 — Re-import what a change affects.** Through `ingest`'s existing read-and-replace,
      with bytes from object storage. Per-document outcomes, no partial documents. (AC4, AC7)
- [x] **Task 5 — Raise no alert twice.** Prove the suppression over a re-import, not only over a
      re-upload. (AC5)
- [x] **Task 6 — The record, and the warning before it.** What will change, then what did. (AC6)

## Dev Notes

### What exists — read before writing anything

| File | Why it matters |
| --- | --- |
| `core/ingestion/ingest.ts` | The write path. `extractions.replace` at ~line 275 is AD-13's other half; `alreadyHeld` short-circuits only under `no-reader` |
| `core/ingestion/notify-findings.ts` | The alerting path, and `no-model-in-alerts.test.ts` guards it. AC5 lives here |
| `core/mapping/draft.ts`, `apply.ts` | `DraftMapping`, `assign`, `applyMapping` — what a stored mapping is made of |
| `app/onboarding/mapping/actions.ts` | Its import scan is the test Task 1 has to move |
| `core/security/suggestion-path-boundary.test.ts` | Six modules that must stay clean (AC8) |
| `adapters/db/*-postgres.ts` | The adapter shape and migration pattern to copy |
| `core/extraction/headings.ts` | `normaliseHeading` — the shape key must fold headings the way the importer already does, not a second folding |

### Two concrete things, so they are not rediscovered

**The test Task 1 must move, exactly.** `app/onboarding/mapping/actions.test.ts` filters its imports
against this pattern:

```
/repository|-postgres|document-store|storage\/|\/ingest$/
```

An adapter named `mapping-store-postgres.ts` therefore fails it *by name*. That is the test doing its
job — the claim it encodes ("a sample is not a document the association is keeping") is still true,
and it is `/ingest$`, `document-store` and `storage/` that must stay forbidden. Narrow the pattern
deliberately and say why; do not delete the test.

**The migration.** `migrations/` is numbered SQL, currently to `025_association_scoped_identity.sql`,
so this story adds `026_`. Follow the association-scoping that migration establishes rather than
inventing a tenancy column.

### The shape key

A saved mapping is found again by the heading row. Use `normaliseHeading`, **imported**, for the same
reason story 5.3 gave and story 5.6 re-proved: a second folding agrees on the day it is written and
drifts afterwards. Two files that the importer considers the same columns must resolve to the same
key, or a treasurer maps the same export twice and wonders why.

### What this story does not do

- It does not change what a mapping *means* — `applyMapping` is 5.5's and stays.
- It does not add a model anywhere. 5.6b's suggester is untouched and its boundary test must stay green.
- It does not widen AD-13. It extends the *trigger* for replacement; the rule about one write path is
  unchanged and is the thing most at risk.

### The traps this project keeps setting

- **A guard that proves nothing.** AC5's mail fake must *fail* when called, not merely record.
- **A second implementation of a rule that already has an owner.** Four instances so far. The re-import
  is the fifth opportunity.
- **Scanning prose for code.** Three occurrences in 5.6 alone; every structural check reads
  `neutralise(...).commentsBlanked`.
- **Planted fixtures read as real.** Four occurrences across three tools. Credential and path fixtures
  use example names.
- **A bare `toThrow()`**, a fixture where two different numbers coincide, and a `?? ''` fallback that
  lets an assertion pass against nothing — all found on 5.6b.
- **Mutations must be proven to apply.** CRLF on disk; an anchor that does not match reports SURVIVED
  without running.

### References

- epics.md — the 5.7 row, and *"A mapping change makes old bytes mean something new"* (~line 318)
- ARCHITECTURE-SPINE.md — **AD-13** (idempotency, one write path, alert keys), **AD-16** (bytes in
  object storage), **AD-4** (reader role), 5.1's tenancy
- `_bmad-output/implementation-artifacts/5-6b-the-model-earns-the-residue.md` — the boundary test, and
  the open `replySchema` casing question

## Dev Agent Record

### Test Design

**Task order note.** Task 1 is written first in the list because it is the warning, but it has nothing
to move until a store exists - `actions.ts` reaches no repository today, so its scan is *true*. Task 2
comes first in execution, and Task 1's change lands with Task 3, when `actions.ts` actually gains the
import. Recorded so the order looks deliberate rather than skipped.

#### Task 2 - `savedMapping`: what is remembered, and how it is found again

**If it ran correctly, how would I know?** A mapping saved for an association, a kind and a heading
row comes back for the *same* heading row and does not come back for a different one, nor for another
association.

**How am I going to test it?** The shape key is pure and gets its own tests. The port gets a fake; the
Postgres adapter is a separate task's concern. **Nothing here writes derived rows**, so AD-13's
one-write-path rule is not yet in play - Task 4 is where that bites.

**Could this happen elsewhere?** The key is the fifth thing in this epic that must fold headings the
way the importer folds them. `normaliseHeading` is imported, never re-derived - story 5.3's finding,
re-proved by story 5.6 Task 1 and again by 5.6b's residue.

| # | Failure mode | Class |
| --- | --- | --- |
| 2a | The key computed with a second folding, so two files the importer calls identical get two mappings and the treasurer maps the same export twice | GUARD - `normaliseHeading` imported; observed parity **plus** a structural check, since 5.6 proved a fork passes every behavioural assertion |
| 2b | The key sensitive to column **order** when the importer is not, or insensitive when it is - a reordered export is a different shape and must not silently reuse a mapping whose positions no longer point at the same columns | GUARD - order is part of the key, asserted both ways |
| 2c | A mapping found across associations, which is 5.1's tenancy leaking - and worse here than elsewhere, because it would import one board's file under another board's column meanings | GUARD - association is part of the key and of the query; asserted with two associations |
| 2d | A mapping found across **kinds**, so a deposit export imports under a roll's mapping | GUARD - kind is part of the key |
| 2e | The stored `columns` count disagreeing with the heading row it was saved for, so `assign`'s bounds check refuses every pairing on reuse | GUARD - stored together, asserted against `applyMapping` |
| 2f | A blank or duplicate heading changing the key between two uploads of the same export - story 5.3 reports both rather than refusing, so both reach here | GUARD - asserted with the fixtures story 5.3 uses |
| 2g | Saving silently overwriting a different mapping that happens to share a key, losing the treasurer's earlier work without a record | GUARD - AC6's record is the answer; a save that replaces must say what it replaced |

**Cross-check:** a mapping saved from a draft and read back must be accepted by `applyMapping` against
the same rectangle, producing the same records - the round trip, not the fields.

#### Task 3 - the saved mapping reaches the reading, or the file fails as it did

**Where it goes.** `read()` in `ingest.ts` turns bytes into a rectangle and hands it to `readRows`. A
saved mapping slots exactly between: `applyMapping` emits a rectangle carrying the importer's *own*
header row, which is precisely what `readRows` expects. Nothing downstream changes.

**If it ran correctly, how would I know?** A CSV headed `Txn Date,Descr,Amt` - which `readRows`
refuses today - imports when a mapping for that shape is saved, and still refuses when one is not.

**How am I going to test it?** Through `ingest` with a fake store, because the claim is about what the
*ingestion path* does. A test that called `applyMapping` directly would prove the transform works and
say nothing about whether anything calls it - the shape story 5.2 shipped, where an action required a
field the form never sent and every gate stayed green.

**Could this happen elsewhere?** `read` is on the hot path for every upload. The risk is not the happy
case; it is what happens when the store is absent, slow, or wrong.

| # | Failure mode | Class |
| --- | --- | --- |
| 3a | A mapping applied to a file it was not made for - the disaster case, because a mapping is *positions* and every value would still be plausible in the wrong field | GUARD - exact shape match including order; asserted with a reordered file |
| 3b | The store absent (an unconfigured deploy, or a caller that does not pass it) failing the upload instead of behaving as today | GUARD - optional dependency; a file whose headings are already the importer's still imports |
| 3c | The store **throwing** and taking the upload down with it | GUARD - caught; the file then reads as it would with no mapping, which for a non-standard header is a refusal, not a wrong import |
| 3d | The lookup anchored on something other than the uploader, so one board's mapping is applied to another board's file | GUARD - `find(uploadedBy, ...)`; the adapter derives the association in SQL |
| 3e | A mapping applied to a document kind it was not made for | GUARD - kind is in the key |
| 3f | The mapping applied but `already-held` short-circuiting first, so a re-upload silently keeps the old parse | NOTE - `alreadyHeld` only short-circuits under `no-reader`; the ordinary path re-reads and replaces, which is what Task 4 depends on |
| 3g | A non-tabular document (a scanned PDF) paying for a lookup it can never use | GUARD - only the rectangle path looks anything up |

**Cross-check:** the same bytes, the same kind and the same saved mapping produce the same records
through `ingest` as `applyMapping` + `readRows` produce directly - the integration agreeing with the
units it is built from.

#### Task 3 - the sensitivity check, and the one mutation that lived

Five decisions in `mapped()`, each mutated on its own, `mapping-wiring.test.ts` run against each,
every mutation verified as applied by anchor count before the run (a `\n` pattern against a CRLF file
silently no-ops, and a no-op mutation is indistinguishable from a caught one):

| Mutation | Result |
| --- | --- |
| `catch` replaced by `finally`, so a store failure escapes | KILLED |
| the mapping never applied (`saved ? rows : rows`) | KILLED |
| the lookup keyed on another member instead of the uploader | KILLED |
| the lookup keyed on a constant instead of the shape | KILLED |
| the absent-store guard disabled (`if (false)`) | **SURVIVED** |

**Why the last one lived, and why the guard stays anyway.** With `if (!deps.mappings) return rows`
disabled, `deps.mappings.find` throws a `TypeError` - *inside the try* - and the catch returns the
rows unchanged. The absent-store path and the store-outage path are the same path, so no test can
separate them, and the guard is behaviourally redundant to the catch.

I am recording that rather than deleting the guard or writing a test that only appears to demand it.
Deleting it would make an unconfigured deploy depend on throwing and catching a `TypeError` per
upload, and would leave the next person to narrow that catch - which is the correct thing to do to it
one day - silently breaking the no-store path. The guard is defence in depth and says what the
optional dependency means; what it is *not* is proven by a test, and claiming otherwise is the
vacuous-guard defect this story has already tripped over once.

**Where it tripped over it once.** The first draft of `mapping-wiring.test.ts` asserted
`not.toBe('recorded')` for the three refusal cases. `recorded` is not one of `ingest`'s outcomes at
all, so those assertions passed for every outcome including success - three guards proving nothing,
in the file whose whole purpose is proving something. Caught by running them: one *other* assertion
failed with `expected 'read' to be 'recorded'`, which named the vocabulary error. Now asserted as
`toBe('unreadable')` and `toBe('read')`.

#### Task 2 - the adapter, and three things mutation found that review would not have

Five mutations of `mapping-store-postgres.ts`, each run against its own test file. The first pass
killed two of five; the two that lived and the one that never applied were all real.

| Mutation | First pass | Now |
| --- | --- | --- |
| `find` drops its association clause | **SURVIVED** | KILLED |
| the previous-row CTE drops its association clause | not applied | KILLED |
| the insert takes an association parameter instead of deriving it | **SURVIVED** | KILLED |
| the previous-row CTE renamed away | not applied | KILLED |
| a `delete from` creeps in | KILLED | KILLED |

**1. A guard satisfied by a different query than the one it names.** The scoping assertion was
`expect(code).toMatch(/where[\s\S]{0,200}association_id\s*=/)`, run over the whole file. Deleting the
association clause from `find` did not fail it: the regex found `save`'s CTE instead, several hundred
characters further down. It is now asserted per read - the source is split on `from column_mapping`
and every resulting chunk must carry the clause - so a third read added later is checked rather than
silently exempt.

**2. The write path was not covered at all.** `never names an association id as a bound parameter`
looked like it covered this and does not: in SQL the parameter is `$5`, and the identifier
`associationId` need never appear. Replacing the `values` subquery with a bound parameter passed
every assertion in the file. Now asserted directly. This is the worse direction of the two - a read
scoped to the wrong association discloses a mapping, but a write under a caller-supplied association
plants one *inside another board's data*, where it is then applied to their imports.

**3. `tsc` caught what the whole suite could not.** The adapter imported `pool` from `./pool`, which
exports `writerPool`. Every test passed: the text half never executes the module's queries and the
database half is `describe.skip` here. An adapter whose import does not resolve went green across
4263 tests. Named because it is the shape of the gap, not the typo: on this machine the adapter's
*runtime* is exercised by nothing.

**Unverified, and not claimed as verified.** `save` returns the mapping it replaced by capturing it
in a CTE and reading it back through `returning (select shape from previous)`. I believe PostgreSQL
resolves a WITH-bound CTE inside an INSERT's RETURNING list, but no database was configured on this
machine, so all six of the adapter's database assertions skipped and **that construct has never been
executed**. It needs one run of this file against a real server before the adapter is trusted; the
tests to prove it are already written and will run the moment `DATABASE_URL` and
`WATCHDOG_WRITER_DATABASE_URL` are set. Recorded rather than guessed, as the `replySchema` casing
question was on 5.6b.

**Corroborated, still not executed.** The Argus round on this commit found no defects and addressed
the construct directly: CTEs bound in a `WITH` are visible to scalar subqueries in an enclosing
INSERT's `RETURNING` list from PostgreSQL 9.1, `previous` evaluates against the pre-insert snapshot,
and a first insert yields SQL NULL through those subqueries - which is the `row.shape === null` the
adapter reads as "nothing was replaced". That is a second model's reading of the manual, from a
different family, and it moves the odds. It is not a run. The label stays *unverified* until this
file's database half executes, because "two of us read it the same way" is how a shared wrong
assumption survives.

#### Task 4 - the re-import, which must not become a second writer

**How the affected documents are identified.** Not by a recorded shape column. The bytes have to be
fetched to re-import anyway, so computing each candidate's shape from those same bytes costs one
extra parse and nothing else - and it covers documents imported *before* this story, which a column
written at ingest time could not. A shape column would miss exactly the documents most likely to need
re-importing, and would need a backfill that does this anyway.

Candidates are `document` joined to `extraction` for the kind: `document_kind` lives on `extraction`
(migration 006), not on `document`. One document has many extraction rows, so the join must not
return it many times.

**If it ran correctly, how would I know?** A document imported under the old mapping has different
derived records afterwards, and a document of another shape - or another association - has the same
ones it had before.

**How am I going to test it?** By calling `ingest` for real with fakes beneath it, so the assertion
that derived rows are replaced is made against the component that actually owns them. Asserting that
`reimport` called some collaborator would prove only that I wired my own function to itself.

| # | Failure mode | Class |
| --- | --- | --- |
| 4a | A second write path for derived rows - the AD-13 violation the story names as the likeliest mistake | GUARD - `reimport` writes nothing; it calls `ingest`, and a structural test asserts it imports no repository that writes derived rows |
| 4b | Re-importing another association's documents | GUARD - candidates derived from the member in SQL, as the mapping store is |
| 4c | Re-importing documents of a *different shape* that merely share the kind | GUARD - shape recomputed per document from its own bytes and compared |
| 4d | One document's failure aborting the rest, or worse, leaving the batch half-applied | GUARD - AC7; per-document outcome, each document's replace already atomic inside `ingest` |
| 4e | Bytes missing from object storage (lifecycle rule, failed upload, wrong key) taking the whole re-import down | GUARD - reported for that document, the rest continue |
| 4f | A document whose bytes no longer parse at all | GUARD - same treatment; it is not re-imported and says so |
| 4g | The re-import silently reporting success for a document it skipped | GUARD - the outcome vocabulary distinguishes re-imported, unchanged, and failed; "skipped" is never "done" |
| 4h | A duplicate row per document from the extraction join | GUARD - distinct; asserted on a document with two extraction rows |
| 4i | Alerts re-sent for findings already raised | OUT-OF-SCOPE here, and Task 5's whole subject - AD-13 keys them, and Task 5 proves it over a re-import rather than only over a re-upload |

**Cross-check:** the records after a re-import equal the records a fresh upload of the same bytes
under the new mapping produces. The re-import agrees with the path it claims to be reusing.

#### Task 4 - what the implementation cost, and the one thing I had backwards

**The port moved.** `importedUnder` went on `DocumentRepository` first. `tsc` immediately named four
places that would have had to grow a method none of them calls - `ingest.test.ts`, `reading.test.ts`,
`extract-document.test.ts` and the Postgres adapter - because `ingest` has no business listing
documents. Moved to its own narrow port, which is what this project already does elsewhere
(`document-store.ts`, `mapping-store.ts`, `finding-alert.ts`). Nothing else broke after that.

**`already-held` is the success case, and I had it backwards.** `reimport` first accepted only
`read` as a successful re-ingest, so every successful re-import reported `unreadable`. `ingest` calls
`extractions.replace` at ingest.ts:293 and returns `already-held` at ingest.ts:361 - the replace
happens first. The word is addressed to somebody uploading a file they already uploaded; for a
re-import, whose bytes are by definition already held, it means the rows *were* re-read and replaced.
Six tests failed on it, which is the only reason I read those two line numbers instead of trusting
the summary in the story's own Dev Notes.

**Ten mutations, ten killed.** Seven against `reimport.ts` and its boundary, three against the
candidate query.

| Mutation | Result |
| --- | --- |
| a derived-row writer is imported | KILLED |
| bytes re-uploaded through `store.put` | KILLED |
| the shape comparison always matches | KILLED |
| missing bytes treated as present | KILLED |
| a failing document aborts the batch | KILLED |
| `already-held` stops counting as a re-import | KILLED |
| the `catch` removed | KILLED |
| `distinct` dropped from the candidate query | KILLED |
| the association becomes a bound parameter | KILLED |
| the kind filter dropped | KILLED |

**The boundary test exists because the behavioural one structurally cannot do this.**
`reimport.test.ts` proves records reach `extractions.replace`; it cannot prove nothing *else* writes
derived rows, because a `reimport` that called `ingest` and also inserted its own rows would pass
every assertion in it. AD-13 is stated as a prohibition, so it needs a test shaped like one -
`reimport-boundary.test.ts`, whose own last case asserts the file is non-empty, since every other
assertion in it is an absence and would pass against nothing at all.

**Still to prove under a database.** The candidate query has never executed, for the same reason the
mapping store's has not. `distinct` and the join to `extraction` are asserted as text only.

#### Task 5 - the suppression holds, but not by the mechanism I claimed

The tests drive the real chain: `reimport` to `ingest` to `notifyFindings`. Two fixture errors were
caught by the **control test** rather than by reading - `recipients.active()` is the method, not
`forFinding`, and `toAlertEmail` reads a finding's evidence to build the message, so a three-string
stub produced no email and therefore no send. Without a control asserting the first alert *does* go,
all four tests would have passed against an alerting path that never sent anything.

**The interesting result.** The file's own header explained that suppression came from
`awaitingAlert` excluding delivered findings, and asserted that "a fake reader that ignored the ledger
would prove nothing at all". Mutating the fake reader to always offer the finding **passed all four
tests** - because `claim` refuses a finding already delivered, so the send never happens. The prose
named the wrong mechanism.

Corrected, and turned into a property rather than a footnote: a fifth test now asserts suppression
survives a *permissive reader*, which is defence in depth made explicit. Removing the `claim` check
from `notify-findings.ts` kills a test, so that mechanism is now proven load-bearing. The harness
mutation still survives - correctly, because one test now sets up exactly that scenario deliberately.

| Mutation | Result |
| --- | --- |
| `ingest` stops passing the alert ledger | KILLED (all four) |
| `reimport` stops calling `ingest` | KILLED |
| the `claim` check removed from `notify-findings.ts` | KILLED |
| the fake reader made permanently permissive | SURVIVED - now an asserted property |

**What this does not prove.** `awaitingAlert`'s exclusion is SQL, and
`finding-reader-postgres.test.ts` is what proves the SQL implements it. This file proves a re-import
routes *through* the ledger rather than around it, which is the part that is new.

#### Task 6 - the warning, and the record

**The warning shares its rule with the run rather than restating it.**
`previewReimport` and `reimport` both go through one `classify`, extracted for
the purpose. Two copies of "does this change affect this document" would drift
into a preview promising a number the run did not honour - and the number is the
thing the treasurer consented to, which makes this the worst possible place in
the story for the duplicated-rule defect. A test asserts the promise and the run
agree, and that the promise was not the trivial one (something affected,
something not).

The preview counts unreachable documents separately rather than passing over
them. A treasurer told only "1 will be re-read" would never learn a second is
unreachable, and this is the moment they are deciding, so it is the moment the
fact is worth something.

**The record is its own table, and un-editable, which the mapping is not.**
Migration 027. A mapping row is replaced in place, so anything recorded *on* it
about a change is destroyed by the next change - a history table is the only
shape that answers "what did this look like in March", the question a board asks
when a figure is disputed. 026 deliberately keeps UPDATE because replacing a
mapping is the story's second half; 027 revokes it, because a record of what
happened must not be rewritable. Two adjacent tables with opposite answers, and a
migration written by copying the other would carry the wrong one silently - which
is what that assertion exists to catch.

**Eleven mutations, eleven killed** - four on the preview, four on the migration,
three on the adapter. The adapter's three are worth naming because none of them
is visible to the type checker:

- the association becoming a bound parameter
- `JSON.stringify(null)` producing the *string* `'null'` - a jsonb value meaning
  "no mapping", where a SQL NULL means "nothing was replaced". 027 leaves the
  column nullable for exactly that distinction, and stringifying unconditionally
  erases it
- the outcomes handed to `node-postgres` as a JavaScript array, which it maps to
  a Postgres *array* against a `jsonb` column

**The README guard caught the new migration** and was updated from 26 to 27. Left
here as a note that it works: a migration added without it would have failed the
suite rather than shipped quietly.

**No database half for the change-log adapter**, deliberately. Every assertion
worth making about it is the shape of one insert, and `migrations/mapping-change.test.ts`
already carries the database half for this table. A second skipping block
re-inserting the same row would be a file that never runs, proving nothing twice.

#### Task 1 and AC3 - the claim narrowed, and the boundary decided a design question

**The structural guard fired on its own, before I touched it.** Adding
`createMappingStore` to `actions.ts` failed `imports no repository, no store and
no ingestion` immediately, because the existing pattern matches `-postgres`. That
is the guard working, and it is worth recording that it was not a nuisance: it is
what forced the narrowing to be deliberate.

**Narrowed by one exact specifier, not by loosening the pattern.** Widening the
regex to let `mapping-store-postgres` through would have let *every* adapter
through with it and the test would still have passed - the failure mode of every
narrowing. So the allowance is a named constant, plus two things that make it
falsifiable: an assertion that the mapping store really is imported (so the
exception is describing this module rather than sitting unused), and a **positive
control** feeding the rule five specifiers it must still refuse - including the
re-import's own dependencies, which makes "the re-import lives elsewhere" a
tested claim rather than an intention. Four mutations, four killed, including
removing the mapping-store import so the exception goes stale.

**The boundary settled a design question I was about to get wrong.** `saveMapping`
was written to return the affected-document count with `replaced`, so the
treasurer sees AC6's number. `tsc` refused: counting means reading every
candidate's bytes from object storage, which this module may not reach. That
prohibition is not an obstacle to route around - it is the reason the sample path
cannot touch the permanent record. So `SaveState.replaced` carries no number, and
the count is `previewReimport`, asked for by the module that owns the re-import.
The story's Task 1 wording had said exactly this ("still no document store, no
object storage, no `ingest`"); the type checker is what made me notice I was
contradicting it.

**Written out of order, and saying so.** `saveMapping` was implemented before its
behavioural tests - the structural update came first because that is what broke.
The tests exist now and seven mutations kill them (session check removed, an
invalid pairing dropped rather than refusing, the shape taken from the form,
`savedBy` made constant, `replaced` collapsed into `saved`, unparseable pairings
becoming an empty mapping). But they were written after the code, so they were
never observed failing against an absent implementation, which is weaker evidence
than the rest of this story carries.

**The one input that must not be assertable.** The stored shape decides which
mapping a later upload matches, so the form's `headerRow` is re-read through
`readHeadings` and `shapeKey` - the same two functions an upload goes through -
and a `shape` field sent by the client is ignored. A test sends one to prove it.

#### Task 6, completed - and the defect I nearly shipped composing it

Task 6 was **not** done when the preview and the change-log table existed. Nothing
called the log, so AC6's record was a table nobody wrote to. The composition
module - `reimport-actions.ts`, with `previewMappingChange` and `changeMapping` -
is what closes it, and building it surfaced the worst near-miss of this story.

**A re-import needs the same fifteen collaborators an upload needs.** My first
instinct was to compose them for the new call site, starting from
`{store, repository, extractions}` - which looks complete. It is four stories
behind, and **not one of the omissions throws**:

- no `payments`: a re-imported deposit produces extraction rows and no payments,
  so money vanishes from a ledger it was already in
- no `rolls`: a re-imported roll creates no units, so every deposit afterwards is
  held `unknown-unit`
- no `findings`: the re-import erases the old parse's findings and raises none of
  the new ones
- no `alerts`/`recipients`: a genuine new finding is raised and nobody is told

The upload path accumulated these one story at a time - 2.5, 4.2, 4.8, the roll
repository - and `alert-wiring.test.ts` exists because exactly this omission
happened once already.

So the composition was **extracted into `app/ingestion-dependencies.ts` and
shared**, and `app/upload/actions.ts` rewired onto it. A behavioural test cannot
catch this: comparing two paths that share an omission sees nothing. So
`ingestion-dependencies.test.ts` asserts it structurally - every silent-if-absent
collaborator is present, both callers reach `ingest` only through the shared
function, and neither imports the adapters a hand-rolled set is made of.

**The extraction broke sixteen tests, which is the system working.** Four wiring
guards read `app/upload/actions.ts` by path and brace-match the dependency object
from `ingest(`. They were repointed at the composition's new home and re-anchored
on `return {` - and then re-proven: six mutations of the shared module (`rolls`,
`payments`, `alerts`, `findings` removed; `rolls`, `units` set to `undefined`)
all still fail them. A guard that follows a refactor without being re-proven is a
guard that has quietly stopped looking.

**Why saving and re-importing are one action.** `save` returns the mapping it
replaced and that value exists nowhere else afterwards - the row is overwritten.
AC6's record names both the old and the new mapping, so the only place it can be
written is the call still holding both. The alternative - handing the previous
mapping to the browser and accepting it back - makes an audit record's content
something the client asserts, which is worse than having none.

**Why two actions and not one.** AC6 says the treasurer is told *before* it runs.
`previewMappingChange` writes nothing; `changeMapping` acts. One call that
re-imported and then reported the number would be showing somebody the bill after
taking the money.

#### Argus on the change actions - one high, and it was a real hole

Four findings, all verified against the files, all mine.

**HIGH - a mapping storable under another kind's shape.** `changeMapping` took a
whole `DraftMapping` from the form and checked its *shape*, not its agreement
with anything. So a form could declare `documentKind: deposit` - deriving a
deposit shape key - and send a mapping whose own `kind` was `invoice`. Stored
under the deposit shape, it would then be applied to every later deposit export,
pairing that file's columns to an invoice's fields. Nothing throws, and every
value is still plausible where it lands.

`saveMapping` never had this: it builds the draft from `emptyDraft(kind, ...)`
and folds through `assign`. The two paths validated differently, which is the
duplicated-rule defect inverted - one copy correct, one not.

**The fix is not a kind check.** Both actions now go through
`draftFromPairings(kind, columns, pairings)`, and the form sends *only* pairings:
the kind and the column count are derived from the request's own context. There
is nothing left to assert, so the attack is unrepresentable rather than detected.
That also answers the medium finding (`NaN`, negative and fractional column
counts, non-object pairings) without a single extra check, because `assign`
already refuses all of them and is now on both paths.

**And a control test that had stopped controlling.** `payment-wiring.test.ts`
guards its own brace-matcher against running away to the end of the file. I
repointed the call sites and left the control reading `app/upload/actions.ts`,
where it brace-matched `return { outcomes, error: null }` - a two-key object that
satisfies "shorter than the file" trivially. It passed while controlling nothing.
Repointed with the thing it controls.

Plus orphaned JSDoc: my extraction deleted the singletons and left their comments
annotating the next function, and the module header still called `upload/actions.ts`
"the composition root for ingestion", which it had stopped being.

**Five mutations on the fix, and one survived first.** The regression test is
written against the payload that used to work. But `expect(Array.isArray(written.documents))`
passed against a mutation that recorded `[]` without waiting for the re-import -
`[]` is an array. Strengthened to one entry per candidate, which the record can
only carry after the re-import produced it. All five killed now.

### The AC audit

For each criterion, the test that fails if the behaviour is removed, and where its
sensitivity was proven.

| AC | Test | Sensitivity |
| --- | --- | --- |
| 1 | `saved.test.ts::treats the same headings under a different kind as a different shape`; `mapping-store-postgres.test.ts::derives it from the member in SQL` | mutations: association as parameter on read *and* write, both KILLED |
| 2 | `mapping-wiring.test.ts::imports when a mapping for its shape has been remembered`, with `::does not import when nothing has been mapped` as the control | mutation: "applying the mapping at all" KILLED |
| 3 | `actions.test.ts::stores the shape it derives, never one the form sends`; `reimport-actions.test.ts::writes nothing even when a mapping does exist` | mutations: shape taken from the form, preview writing as a side effect, both KILLED |
| 4 | `reimport.test.ts::replaces the derived rows through the component that already owns them` (behavioural) and `reimport-boundary.test.ts` (structural) | 10 mutations, all KILLED |
| 5 | `reimport-alerts.test.ts`, all five | mutations: ledger dropped, `claim` removed, both KILLED |
| 6 | `reimport.test.ts::promises exactly what the re-import then does`; `reimport-actions.test.ts::records only after the re-import` | 11 + 5 mutations, all KILLED |
| 7 | `reimport.test.ts::never reports a document it skipped as one it re-imported` | mutation: "a failing document aborts the batch" KILLED |
| 8 | **See below** | — |

#### What the audit found, on the tenth consecutive story

**AC8's first clause was not implemented.** It has two: *"Nothing that reads a
mapping can write one, and nothing on the suggestion path can reach the store at
all."* The second was covered - 5.6b's six-module boundary test stayed green
throughout. The first was covered by nothing.

`ingest` was handed the whole `MappingStore`, `save` included. It only ever called
`find` - but *"it does not"* and *"it cannot"* are different statements, and the
gap between them is one edit wide. No test named the difference.

What it would cost is specific: an upload that wrote a mapping would turn a
file's own heading row into a stored mapping nobody confirmed, applied from then
on to every later export of that shape - and AC3 says saving is explicit.

Fixed by making it unrepresentable rather than merely tested: the dependency is
now `Pick<MappingStore, 'find'>`. Three assertions back it up, because a type is
erased at runtime and one `as MappingStore` would restore the hole silently - two
behavioural (no `save` on the path that finds a mapping, none on the path that
finds nothing, which is where the tempting bug lives: *"no mapping for this
shape, so remember this one"*) and one structural, because behaviour cannot prove
a prohibition. Both mutations - writing on the not-found path, and widening the
type back - are KILLED.

This is the tenth consecutive story on which the audit found something, and the
second time it has found an AC that nothing implemented at all.

### The `ocr` round - 59 findings, 9 confirmed, and a partial run

**The run did not complete, and exit 0 said nothing about that.** `terminal_state`
was `partial`: 34 of 36 items completed and **2 failed - both of my new
migrations**. `summary.files_reviewed` said 36, which is the lie this project has
recorded before (59 reported against 17 actually reviewed).

The cause is worth keeping. Both migration headers say *"Migration 002's default
privileges..."*. `ocr` turned that description into a filename and tried
`git show HEAD:migrations/002_default_privileges.sql`; the real file is
`002_roles.sql`, the read failed, and it abandoned both items. My prose is
accurate - 002 does contain `alter default privileges` - so this is a reviewer
failure mode, not a defect: **a descriptive cross-reference in a comment can make
`ocr` fabricate a path and drop the file entirely.** Those two migrations were
reviewed by Argus and carry text-assertion tests with mutations, so they are not
unreviewed; they are un-`ocr`-reviewed, and that is stated rather than glossed.

**Nine confirmed.** Three of them are conventions this project had already
written down and my new tables did not follow - the kind of thing no amount of
care finds, because you have to know the convention exists:

| # | Finding | Why it is real |
| --- | --- | --- |
| 57 | no composite foreign key on `mapping_change` | Migration 024 gives every association-scoped table one "so a child cannot belong to a different association than its parent". Applied to 026 as well, by symmetry, since nothing raised it there |
| 59 | `saved_by`/`changed_by` unindexed | Migration 005 exists for exactly this and says so on its own index: "Referencing columns get no index automatically" |
| 47 | `importedUnder(uploadedBy, ...)` misnamed | It is the member *asking for* the re-import, and the scope is their whole association. Named `uploadedBy`, the obvious future "fix" is `and d.uploaded_by = $1` - which would silently skip every document another director uploaded |
| 15 | `saveMapping` did not guard its store call | An unhandled rejection in a server action is a generic 500: the wizard is gone with nothing said about whether it saved |
| 19 | `changeMapping` has no transaction across save/re-import/record | Real and unfixable as a transaction. Named instead: `changed-unrecorded` |
| 2, 48, 52 | three database test files created associations and members and cleaned up none of it | Accumulates per run, and `find`'s association scoping is exactly the assertion a database full of other runs' rows starts to hide |
| 3 | a hand-rolled comment-stripping regex in three adapter tests | Story 5.6 consolidated four private copies of this scanner after they drifted. I wrote a fifth. Now `neutralise` |

**The composite-FK statements needed guarding.** `add constraint` has no
`if not exists`, and every other statement in both files is idempotent - a
migration that fails on its second run is one nobody can re-apply. Wrapped in
024's own `do $$ ... end $$` pattern.

**`changed-unrecorded` is not an error state, deliberately.** By the time
`record` runs, the mapping is replaced and the documents are re-parsed. Reporting
failure would be a lie inviting the treasurer to run it again; reporting
`changed` would claim a durable record that AC6 requires and does not exist. Both
mutations - rethrowing, and reporting plain success - are KILLED.

**Refuted, and why.** #11 (log injection through a filename) is the design
already in place, passed as a structured field rather than interpolated, and the
finding acknowledges the mitigation. #38 said `reimport.test.ts` does not verify
AC5 - `reimport-alerts.test.ts` does, and `ocr` reviews per file so it could not
see it. #42 wanted `SavedMapping` coverage that lives in the adapter and
migration tests. #54 wanted explicit grants where this project deliberately
relies on 002's defaults and revokes what it does not want. #16's `NaN` case is
refused by `assign` already - the code needed no change, though it now has a test.

**Argus found none of these nine.** Ingested at `a10f059` with recall 0, which is
the measurement that justifies running both rather than an opinion about it.

### The CodeRabbit CLI round - 11 findings, 11 confirmed

`review_completed`, 39 reviewedFiles reconciling exactly against the diff. Every
finding verified against the real file first; **all eleven were real**, which is
the highest confirmed rate any reviewer has had on this project.

**The ingest join failed the first time and had to be repaired.** `argus_ingest`
skipped the review: *"no Argus run recorded for 22f18da"*. I had run Argus on the
previous commit and started CodeRabbit without running it on the `ocr`-fix commit,
so there was nothing to join to. Ran `argus_review` on 22f18da and re-ingested -
6 compared, recall 0, 4 lessons. Argus found none of CodeRabbit's, as it found
none of `ocr`'s.

#### The three majors

**A save could report "first save" for a replacement.** `save` read the previous
row through a CTE and returned `SavedMapping | null`, with null meaning nothing
was replaced. The CTE reads the statement's snapshot - so a row another
transaction inserts and commits *after* that snapshot is invisible to it while
the conflict still fires, making the statement an update that reports a first
save. The treasurer is not warned, and the documents under the old mapping are
never re-imported. That is precisely the concurrency migration 026's unique index
exists for.

CodeRabbit named the fix and the precedent: `finding-postgres.ts` already does
`returning id, (xmax = 0) as inserted`, with a comment calling it *"the one way
to learn which branch ran without a second round trip"*. So `save` now returns
`{ replaced, previous }` - the fact and the detail, separated, because they come
apart exactly here. This is the construct I had flagged as unverified and Argus
had corroborated as correct; **it was correct about what it does and wrong about
what it concludes.**

**`previewReimport` did not catch per document** where `reimport` does. One
unreachable object took down the count for every other document, so the treasurer
got an error where they were owed a number. The asymmetry survives review because
both functions read correctly on their own.

**A boundary assertion that matched nothing.** `reimport-boundary.test.ts` had
`expect(code).not.toMatch(/\bextraction\b\s*\(/i)` - and no code here would ever
write that: the writer is reached as `deps.extractions.replace(...)`. The
assertion passed against every possible file, including one writing derived rows
on every line. A guard that guards nothing, inside the file whose entire job is
guarding, in the test I wrote *specifically* because AD-13 is a prohibition. The
twelfth of this shape on this project. Corrected, and a mutation now confirms it
catches a writer.

#### The minors, all of them mine and all of them vacuity

- **`storeHolding` ignored the requested shape**, answering its mapping for any
  key. The shape-mismatch test passed `null` and got `null`, so a wrong lookup
  key in `ingest` - the whole point of that test - would have gone unnoticed. The
  re-import tests' fake had it right; this one did not.
- **My pairing test sent `position: null`**, which the transport check refuses,
  so it never reached `assign` - while its comment claimed `Number.isInteger` was
  doing the work. A test passing for a different reason than the one it names.
  Now `1.5`.
- **The `replace` mock kept counts, not records**, so the cross-check compared
  lengths rather than contents.

#### The trivials

A doc comment claiming per-request construction "would multiply connections"
when the adapters share `writerPool()` - describing neither what the code does
nor why. An unreachable `configured` check inside a `describe.skip` block. A
stale comment left behind by the `classify` extraction. A missing blank-header
test - which matters, because a blank header row that got through would key every
such export to one mapping.

And one behavioural gap: the swallowed store failure in `mapped()` now reports
through `onError`. Failing open is right, but a store that is down looked exactly
like a store with no mapping, with nothing in any log saying which.

### Review Findings

### Completion Notes List

### File List

## Change Log
