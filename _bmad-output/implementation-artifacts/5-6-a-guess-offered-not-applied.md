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

- [x] **Task 1 — Normalise a heading the way a person would.** Case, space, punctuation, and the
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

#### Task 1 - `targetForHeading`: matching a heading the way a person would

**If it ran correctly, how would I know?** A table of real-shaped headings maps to the targets a
treasurer would say they mean: `Txn Date` to `date`, `Descr` to `description`, `Amt` to `amount`,
`Unit #` to `unit`. And a heading that means nothing to the importer maps to nothing.

**How am I going to test it?** Pure function over a string; no seam needed. The care goes into the
fixture: headings taken from the shapes epics.md names, not invented ones that happen to suit the
implementation.

**Could this happen elsewhere?** Yes, and it already has. `normaliseHeading` is shared between the
wizard and `readRows` precisely so the two cannot classify a heading differently - story 5.3 spent a
review round on a duplicated `trim().toLowerCase()`. Matching must *build on* that folding, never
fork it.

| # | Failure mode | Class |
| --- | --- | --- |
| 1a | A second folding written here, drifting from `normaliseHeading` - the exact defect 5.3 fixed, reintroduced one module over. The symptom is a wizard that matches a heading the importer will not | GUARD - built on the shared folding, and a test asserts the two agree on a case/space fixture |
| 1b | Punctuation stripped so aggressively that two distinct headings collide - `Unit #` and `Unit Price` both landing on `unit` | GUARD - asserted that a heading meaning something else does *not* match |
| 1c | An alias resolving to a target the kind does not publish (`cycle` on a deposit), which `assign` then refuses - so the suggestion silently vanishes and the treasurer sees nothing | GUARD - Task 2 filters by `targetsForKind`; here, the table is asserted to contain only real `TargetField` values |
| 1d | A blank or whitespace-only heading matching something. Story 5.3 exists because real files have them | GUARD - matches nothing, asserted |
| 1e | Case, surrounding space or punctuation defeating a match a person would make instantly - `  AMOUNT  `, `Amount:`, `amount.` | GUARD - each asserted |
| 1f | The alias table carrying two entries for one key, so which target wins depends on object literal order | GUARD - a structural test that no key is defined twice |
| 1g | The retired `type` column, or any string that is not a `TargetField`, reachable through the table | GUARD - every value asserted to be a published target |

**Cross-check:** for every `TargetField`, matching its own canonical name returns that target. A
table that drifted from the importer's vocabulary fails it without anyone maintaining a second list.

#### Task 2 - `suggestColumns`: an answer for every required target

**If it ran correctly, how would I know?** Given a sample's headings and a kind, every required
target comes back either naming a column or explicitly saying it has none - and every pairing it
names is one `assign` would accept.

**How am I going to test it?** Pure over headings and a kind, so no seam is needed for the
deterministic half. AC4 and AC6 are the ones that cannot be behavioural: **no behavioural test can
prove the absence of a credential the code never reaches for.** Those are structural, reading the
module's own imports - the shape story 5.3 used for the shared folding and 5.5 used for "nothing is
stored".

**Could this happen elsewhere?** The bound is the same class as story 5.5's `PREVIEW_MAX_BYTES`,
which was got wrong twice: the row bound did not bound the payload, then the byte bound counted
UTF-16 code units. Caps here are counted in the unit they claim, and asserted at and past the edge.

| # | Failure mode | Class |
| --- | --- | --- |
| 2a | A required target with **no** match omitted from the result rather than present saying "none" - indistinguishable from a target nobody asked about, and AC2 exists for exactly that distinction | GUARD - every required target present, asserted per kind |
| 2b | Two columns matching one target (`Amt` and `Amount` in one file) - two pairings, and `assign` refuses the second silently from the treasurer's side | GUARD - at most one column per target, first in file order |
| 2c | One column claimed by two targets, same shape, same silent refusal | GUARD - a column is claimed once |
| 2d | A suggestion for a target the kind does not publish - `cycle` on a deposit - which `assign` refuses and the treasurer sees as nothing happening | GUARD - filtered through `targetsForKind`, asserted on a deposit |
| 2e | Unbounded input crossing the boundary: ten thousand headings, or one heading a megabyte long. The cap must exist **now**, while nothing crosses it, or 5.6b has to add one to a live path | GUARD - `MAX_SUGGESTIBLE_HEADINGS` and `MAX_HEADING_LENGTH`, both named, both asserted at and past the edge |
| 2f | A heading logged or retained - they are the association's own column names out of its own file | GUARD - structural: nothing in the module writes anywhere |
| 2g | A store, repository, client or credential reachable from this module. **This is the AD-8 control**: what the runtime is *able* to do, not what it is asked to do | GUARD - structural import scan |
| 2h | A position that is not 1-based, or one the file does not have, so `assign` refuses it | GUARD - positions taken from `Heading.position`, asserted against the fixture |
| 2i | Duplicate positions in the input (`readHeadings` reports duplicates rather than refusing them), producing two suggestions on one column | GUARD - claimed-set is keyed by position |

**Cross-check:** every suggestion the suggester produces is fed to `assign` and must be accepted. A
suggester that could name a pairing the draft refuses would be a second set of rules - and that is
the defect this project has already found twice (`targetsForKind` versus a hand-written list, and
`TARGET_LABELS` defined twice).

### Review Findings

### Completion Notes List

#### Task 1 - matching a heading the way a person would

**Built on `normaliseHeading`, not beside it.** `matchKey` calls the shared folding and then strips
what a person ignores. The canonical set is derived from `targetsForKind`, so a target added to the
importer is matched by its own name with nobody touching the alias table.

**Two mutations survived the first pass, and both were real.**

- *A forked folding* (`heading.toLowerCase()` instead of the shared one) passed **every** behavioural
  assertion, because stripping non-alphanumerics subsumes `trim()` - the fork is identical *today*.
  My parity test compared `matchKey(h)` to `matchKey(normaliseHeading(h))`, which is true of any
  implementation and proved nothing. Replaced with story 5.3's pair: observed parity where the two
  genuinely overlap, **plus** a structural check that the body calls the shared function and contains
  no second folding. Neither alone suffices, which is 5.3's own finding.
- *The blank-heading guard was unreachable.* `''` matches no alias and is not canonical, so it
  already returned `null`. A guard with no test behind it is one the Prime Directive forbids;
  deleted, and the blank cases still pass through the ordinary path.

**The structural check needed narrowing twice**, which is worth recording because it is the same
shape both times: a file-wide scan for `toLowerCase` matched the doc comment *explaining* the shared
folding, and then the function body's own comment saying "not a second toLowerCase". Scanning prose
for code is how the design-token guard flagged the word "green" earlier in this project. It now reads
the body only, and the comment no longer names the method.

**Fixture mutations, done properly the second time.** Removing a case from a `.each` list proves
nothing - it just tests less. The check is to substitute an input for which the stated expectation is
*wrong*: `Unit #` moved into the never-matches list (1 red), `Balance` into the always-amount list
(1 red), and `Amt` given `date` as its expected target (1 red).

**Argus found a defect neither pass could.** `HEADING_ALIASES[key]` on a plain object literal reaches
`Object.prototype`, so a column headed `constructor` returned the `Object` **function** where the
signature promises `TargetField | null`. Header text is user-supplied from a user-supplied file -
exactly the input class AD-8 is about. Fixed with `Object.hasOwn`; reverting to a bare lookup turns
1 red. On the re-review it also pointed out that `CANONICAL` as a `Set` plus `key as TargetField`
would return a stripped string if a target were ever named with punctuation; now a `Map`, so there is
no cast to be wrong.

**Scope held:** no prompt, no key, no network. The only match for "prompt" in the diff is the doc
comment quoting the epic.

### File List

- `core/mapping/heading-match.ts` *(new)* - `matchKey`, `HEADING_ALIASES`, `targetForHeading`
- `core/mapping/heading-match.test.ts` *(new)* - 49 cases, including the cross-check that every
  published target names itself

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-22 | Task 1: deterministic heading matching, built on the shared folding |
| 2026-08-22 | Created from FR-10. Scoped to the deterministic half plus the whole structural boundary; the model adapter is 5.6b |
