---
Status: ready-for-dev
baseline_commit:
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

- [ ] **Task 1 — Move the "nothing is stored" claims rather than delete them.** The structural tests
      from 5.3/5.4/5.6 say `actions.ts` reaches no repository. That stops being true here, and the
      tests must say what *is* true instead — a mapping store, and still no document store, no object
      storage, no `ingest`. (AC8)
- [ ] **Task 2 — Remember a mapping.** The port, the shape key, and the adapter. Per association and
      kind, with 5.1's tenancy. (AC1, AC3)
- [ ] **Task 3 — A matching upload skips the wizard.** Look up by shape at upload time; fall through
      to the wizard when nothing matches, visibly. (AC2)
- [ ] **Task 4 — Re-import what a change affects.** Through `ingest`'s existing read-and-replace,
      with bytes from object storage. Per-document outcomes, no partial documents. (AC4, AC7)
- [ ] **Task 5 — Raise no alert twice.** Prove the suppression over a re-import, not only over a
      re-upload. (AC5)
- [ ] **Task 6 — The record, and the warning before it.** What will change, then what did. (AC6)

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

### Review Findings

### Completion Notes List

### File List

## Change Log
