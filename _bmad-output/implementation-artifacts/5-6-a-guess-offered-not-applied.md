---
Status: ready-for-dev
baseline_commit: f78759e
merge_request:
---

# Story 5.6: A guess, offered not applied

## Story

As **a treasurer setting up an import**,
I want **the columns to arrive already matched where the match is obvious**,
so that **I am confirming a mapping rather than building one from nothing — and I can still change every one of them**.

## The scoping decision, taken before any code

FR-10 has two halves: **deterministic matching first**, and **a model asked only about the residue**.
This story is the first half, plus the whole of the structural boundary the second half will need.
The model adapter is story **5.6b**.

**Why split, rather than build both.** epics.md says it in as many words — *"Try the boring version
first. Most real headers differ by case, punctuation and abbreviation — `Txn Date`, `Descr`, `Amt`,
`Unit #`. A deterministic normaliser plus a small alias table will match the large majority at no
cost, with no prompt, no credential and no failure mode. The model earns its place on the residue,
not on the whole job."* The epic-5 action item says the same: *"Build 5.6's deterministic matcher
before the model call."*

And FR-10's last consequence makes the split safe rather than merely convenient: *"A suggestion that
cannot be produced — the model is unreachable, returns nothing usable, or **is switched off
entirely** — leaves the wizard fully usable by hand and says so."* A story that ships the
deterministic matcher with **no** model configured is that state, permanently, and AC7 asserts it.

**What 5.6b will add and what it must not have to change.** An adapter behind the port this story
defines. If 5.6b finds itself widening the port, loosening the bound, or threading a credential
through, the seam was drawn wrong here — that is the thing to notice.

## Human confirmation is not the injection control, and the PRD says so

This is the sentence to read twice before writing any of it. From FR-10's decision block:

> Passing column headers to a reasoning model is the first place extracted text reaches a prompt,
> which AD-8 otherwise forbids. Human confirmation is **not** the control for that — it governs what
> is stored, while prompt injection is about what the runtime *does* on the way there, and the agent
> service holds `/tools/v1/*` access.

So there are **two separate rules** and this story must not conflate them:

- **"A guess, offered not applied"** — the story's title — governs what is *stored*. It is AD-8's
  human-confirm rule, the same one that sends unknown vendors to quarantine rather than creating
  them.
- **The injection controls are structural**: deterministic matching first, no tool access and no data
  credential on the suggestion path, bounded input, schema-validated output, nothing retained, and a
  manual path that works when the model does not.

A story that only implemented the first would satisfy its own title and leave the actual risk
untouched. AC4, AC5 and AC6 are the second rule, and they are built **now**, while the path carries
no model at all — because a boundary is far easier to draw before something needs to cross it.

**Where the line sits relative to epic 4.** `core/security/no-model-in-alerts.test.ts` proves no model
sits in the alerting path, and that guard is about FR-6/7/8. It does not forbid a model in intake,
and the two are easy to confuse — so say in the code where the line is, rather than leaving a reader
to infer that the deterministic claim has quietly weakened. Detection and alert copy stay
deterministic; a setup-time suggestion a human approves is a different thing.

## Acceptance Criteria

1. **Deterministic matching, and it earns most of the job.** A header matches a target through
   normalisation a person would recognise: case, surrounding space, punctuation, and a small alias
   table for the abbreviations real exports use — `Txn Date`, `Descr`, `Amt`, `Unit #`, `Memo`.
   Asserted against a table of real-shaped headings, not invented ones.

2. **Every required target gets an answer, and "none" is one of them.** For each required target the
   suggester either names a column or says plainly that it has no suggestion. A target silently
   missing from the result is indistinguishable from one it had no opinion about, and the treasurer
   cannot tell which.

3. **A suggestion pre-fills; it does not decide.** The draft arrives with the suggested pairings
   already made, every one of them changeable by the means story 5.4 built, and **nothing is
   stored** — 5.7 is where a mapping is remembered. Overriding a suggestion is no harder than
   accepting it.

4. **The suggestion path holds no tool access and no data credential.** Structural, and asserted by
   reading the module's imports rather than by intention: no catalog client, no repository, no store,
   no database. The control is what the runtime is *able* to do, not what it is asked to do.

5. **Input is bounded before it leaves.** Headers are length-capped and count-capped at the
   suggester's boundary, with the caps named constants. The bound exists now, while nothing crosses
   it, because 5.6b must not have to add one.

6. **Headers are not logged or retained.** They are the association's own column names from its own
   file. Nothing writes them anywhere, and a test reads the module to say so.

7. **With no suggester at all, the wizard is fully usable and says so.** Not a crash, not an empty
   screen, and not silence: the mapping surface works exactly as story 5.4 built it, and the
   treasurer is told that nothing was suggested rather than left to wonder.

8. **A confirmed mapping is the treasurer's, whether or not it matches the suggestion.** What they
   end with is what 5.7 will store — the suggestion has no privileged status once they have touched
   it.

## Tasks / Subtasks

- [ ] **Task 1 — Normalise a heading the way a person would.** Case, space, punctuation, and the
      alias table. Pure, and the alias table is data. (AC1)
- [ ] **Task 2 — Suggest a column for every required target, or say none.** The port and its
      deterministic implementation, bounded and credential-free. (AC1, AC2, AC4, AC5, AC6)
- [ ] **Task 3 — Pre-fill the draft from a suggestion.** Through `assign`, so a suggested pairing is
      the same kind of thing as a hand-made one and every 5.4 rule still applies. (AC3, AC8)
- [ ] **Task 4 — Say what was suggested and what was not.** On the pairing surface, including the
      no-suggester case. (AC2, AC7)

## Dev Notes

### What exists

- `core/mapping/targets.ts` — `targetsForKind(kind) -> { required, optional }`.
- `core/mapping/draft.ts` — `emptyDraft`, `assign` (refuses a claimed column, a target the kind does
  not have, a position the file lacks), `unassign`, `completeness`.
- `core/extraction/headings.ts` — `Heading` is `{ position (1-based), text, normalised }`, and
  **`normaliseHeading` already exists**: `trim().toLowerCase()`, shared with `readRows` so the wizard
  and the importer cannot classify a heading differently. Task 1 extends *matching*, and must not
  quietly fork that folding — story 5.3 spent a round on exactly that.
- `core/mapping/apply.ts`, `core/mapping/preview.ts` — story 5.5.
- `app/onboarding/mapping/column-pairing.tsx` — the pairing surface; `target-labels.ts` holds the one
  copy of the field labels.

### The seam to draw carefully

A suggester takes headings and a kind, and returns suggested pairings. That is all it may take. If it
needs anything else — a store, a client, an association id — the seam is wrong, and AC4's import scan
is what will say so.

Suggested pairings go through `assign`, never straight into `draft.pairings`. Everything story 5.4
proved — one column per target, a position the file has, a target the kind publishes — has to hold
for a suggestion exactly as for a hand-made pairing. A suggester that could produce an impossible
draft would be a second set of rules.

### What this story does not do

No model, no persistence (5.7), no ordering rule (5.8). **If a prompt, an API key or a network call
appears in this diff, the scope has been crossed** — and the structural guards are there to make that
loud rather than subtle.

### The traps this project keeps setting

- **A test that names a behaviour and proves nothing.** Story 5.5 shipped a block named
  `nothing is stored` whose only assertion was a row count. For every assertion here, ask what would
  have to break for it to go red.
- **Fixture-vacuity.** Break the *input*, not just the code. On 5.5 a roll fixture used `2026` for
  both the tenure date and the assessment year, so an assertion passed with the year column deleted.
- **Two lists that agree today.** `TARGET_LABELS` existed twice on 5.5, `trim().toLowerCase()` twice
  on 5.3. If the alias table needs a second reader, it gets one home.
- **Scripted edits that do not apply.** CRLF defeats a `\n` anchor, and a heredoc eats one level of
  backslash. Read back every scripted edit: old text gone, new present, count as expected.

### References

- `docs/prd/prd.md` — FR-10 and its decision block, which is the authority here
- `_bmad-output/planning-artifacts/architecture/.../ARCHITECTURE-SPINE.md` — AD-8
- `_bmad-output/planning-artifacts/epics.md` — *"The suggestion is the epic's one real architectural
  risk"*, and *"Try the boring version first"*
- `_bmad-output/implementation-artifacts/5-4-mapping-one-column-to-another.md` — the draft this
  pre-fills

## Dev Agent Record

### Test Design

### Completion Notes List

### Review Findings

### File List

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-22 | Created from FR-10. Scoped to the deterministic half plus the whole structural boundary; the model adapter is 5.6b |
