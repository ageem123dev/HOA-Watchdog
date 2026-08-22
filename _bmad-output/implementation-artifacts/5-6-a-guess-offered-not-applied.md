---
Status: review
baseline_commit: f78759e
merge_request: 83
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
- [x] **Task 2 — Suggest a column for every required target, or say none.** The port and its
      deterministic implementation, bounded and credential-free. (AC1, AC2, AC4, AC5, AC6)
- [x] **Task 3 — Pre-fill the draft from a suggestion.** Through `assign`, so a suggested pairing is
      the same kind of thing as a hand-made one and every 5.4 rule still applies. (AC3, AC8)
- [x] **Task 4 — Say what was suggested and what was not.** On the pairing surface, including the
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

#### Task 3 - `draftFromSuggestion`: pre-filled, not decided

**If it ran correctly, how would I know?** A draft comes back with the suggested pairings already
made, and every one of them can be changed by the means story 5.4 built - `assign` to move it,
`unassign` to clear it. The suggestion has no privileged status afterwards, and nothing is stored.

**How am I going to test it?** Pure. `emptyDraft` in, a draft out. AC8 is the interesting one and it
is behavioural: take a pre-filled draft, override every pairing, and assert the result is exactly the
draft the treasurer would have built by hand. Any bookkeeping that made a suggested pairing *special*
would show up as a difference.

**Could this happen elsewhere?** Yes, and it is the whole reason this goes through `assign`. Story
5.4's rules - refuse a column already paired, replace rather than duplicate on re-pairing, reject a
target the kind does not publish - exist once. A pre-fill that wrote `pairings` directly would be a
second way to build a draft, and the two would agree until the day 5.4's rules changed.

| # | Failure mode | Class |
| --- | --- | --- |
| 3a | Pairings written straight into `DraftMapping` rather than through `assign`, so 5.4's rules apply to hand-made pairings and not to suggested ones | GUARD - built by folding `assign`, asserted structurally *and* by a rule 5.4 owns |
| 3b | A suggestion `assign` refuses aborting the whole pre-fill, so one odd column costs the treasurer every other suggestion | GUARD - a refused pairing is skipped, the rest are kept |
| 3c | A refusal swallowed so quietly that a suggester which proposes nothing usable looks identical to one that was never asked | GUARD - the count of applied pairings is observable |
| 3d | `position: null` - "no suggestion" - passed to `assign` as a column number, which is `no-such-column` at best and column 0 at worst | GUARD - nulls filtered, asserted |
| 3e | The draft's `columns` taken from the suggestion rather than from the sample, so a file whose columns nobody recognised gets a zero-column draft nothing can be paired into | GUARD - `columns` comes from the headings |
| 3f | A suggested pairing that cannot be overridden, or that reappears after being cleared - the difference between pre-filling and deciding | GUARD - AC8: override every pairing, compare against the hand-built draft |
| 3g | Anything written anywhere. **5.7 is where a mapping is remembered**, and a pre-fill that persisted would make 5.7's idempotency question moot by answering it wrongly first | GUARD - structural, and the function has no seam to write through |

**Cross-check:** a draft pre-filled from a suggestion, then fully overridden, must equal the draft
built by hand from the same choices. That is AC8 stated as an equality rather than as a feeling.

#### Task 4 - the pairing surface says what was suggested, and what was not

**If it ran correctly, how would I know?** A treasurer opening the mapping sees the suggested
pairings already made *and can tell which ones were suggested*. Every required target with no
suggestion says so. With no suggester at all the screen is exactly story 5.4's, plus a sentence
saying nothing was suggested.

**How am I going to test it?** Render tests, jsdom, `@testing-library/react`, per story 1.6c. The
assertions read **accessible names**, not styles - a marker carried by tint alone is invisible to the
treasurer this project keeps in mind, and story 5.4 already made that call for selection state.

**Could this happen elsewhere?** The reset-on-new-sample path is the trap. Story 5.4 added it because
a mapping outliving its file is "wrong in the worst direction, because the mapping still looks
finished" - and it resets to `emptyDraft`. A pre-fill added only to the `useState` initialiser is
silently absent on the second sample, which is exactly the shape story 5.2 shipped: correct on the
path anyone demonstrates, missing on the one they do not.

| # | Failure mode | Class |
| --- | --- | --- |
| 4a | The pre-fill runs only in the `useState` initialiser, so a treasurer reading a **second** sample gets an empty draft with no explanation | GUARD - the reset path re-runs the pre-fill, asserted by re-rendering with new headings |
| 4b | The "suggested" marker survives the treasurer overriding it, so the screen credits the machine with what the human chose - directly against AC8 | GUARD - the marker is derived from the *current* pairing, asserted after an override |
| 4c | No suggester at all crashes, or renders an empty screen, or says nothing | GUARD - AC7, asserted with the prop absent |
| 4d | The suggestion applied with nothing on screen to say so, so a treasurer submits a machine-made mapping believing they made it. **This is the difference between "offered" and "applied"** | GUARD - a summary line naming how many were filled in |
| 4e | The marker carried by colour or weight alone | GUARD - asserted through the accessible name, never a style |
| 4f | A required target with no suggestion showing the same blank as one nobody considered - AC2 at the surface | GUARD - "no suggestion" is said in words |
| 4g | The suggestion recomputed on every render, resetting the draft in a loop the moment a `headings` array is rebuilt | GUARD - keyed off the same `sample` string story 5.4 already computes |
| 4h | A second live region for the suggestion summary, so announcements are read twice or not at all | GUARD - static text, not a live region; story 5.4's is the only one |

**Cross-check:** with a suggester supplying nothing, the surface must be indistinguishable from the
no-suggester case in behaviour and distinguishable in wording - one had nothing to say, the other was
never asked.

### Review Findings

#### Local round, before the merge request

Three reviewers, cheapest first, each once. They did not overlap, which is the argument for running
all three.

| Reviewer | Found |
| --- | --- |
| **Argus** (per commit, free) | The prototype-chain defect in the alias lookup - a column headed `constructor` returning the `Object` function where the signature promises `TargetField | null`. Also the unsound cast in the canonical lookup, now a `Map`. Clean on tasks 2, 3 and 4. |
| **`ocr`** (once, whole branch) | 23 comments; **12 confirmed, 3 refuted**, the rest declined as style. The high one was real: the shared import scanner used one character class for all three quote styles, so `import "it's-module"` captured `it` - and a truncated specifier fails **open** against `sole-data-path`'s `endsWith`. Also a latent reset bug that story 5.6b would have made reachable, and a test of mine that would have gone red the day someone fixed `neutralise`. |
| **CodeRabbit CLI** (once, last) | The five document kinds written out by hand in **three** places, one of them a file whose own comment warns about that exact defect shape. Two Argus rounds and an `ocr` round had read it without raising it. |

`ocr` manifest verified rather than assumed: `terminal_state` `complete`, 14 selected / 14 completed,
zero failed, zero waived, and the selection reconciled against `git diff --name-only`. CodeRabbit
accepted only on `status: "review_completed"` with all 16 diff paths in `reviewedFiles`.

#### Integration pass (`bmad-code-review`, full mode)

Review engine: **argus (MCP)**. Scope `f78759e..HEAD`, excluding `_bmad-output/**` - the story
document is the spec, and reviewing it as a diff reviews the prose against itself. One call over the
whole 14-file, 2223-line diff.

> Argus: clean - complexity `moderate` - confidence `1` - context 16/16 files - 1 agy call,
> 160,184 tokens. `audit_chain_ok` true, `reflection_converged` true.

Target verified before reading the judgement: the verdict names `suggest.ts`, `heading-match.ts`,
`prefill.ts`, `column-pairing.tsx` and `module-specifiers.ts`, all genuinely in the diff.

**No findings from the engine.** One gap found by looking for what per-task reviews structurally
cannot see - an interaction between tasks:

- **Story 5.3's duplicate-heading report had never been exercised alongside a suggestion.** A file
  with two `Amount` columns is *told* to "map whichever you mean" while the guess has already picked
  one. That is coherent only if the screen says both things at once; if it said only the first, the
  treasurer would go looking for a decision already made for them. Two tests added: the suggestion
  takes the first duplicate and 5.3's report survives beside it, and the treasurer can still take the
  other one. Both pass, and "first in file order" is separately mutation-proven in `suggest.test.ts`.


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

### AC audit

Each criterion, the test that fails if the behaviour is removed, and the evidence that it does. **A
name alone is not evidence** - a vacuous test satisfies "I named one" while staying green when the
behaviour is deleted, which is the defect this project keeps finding.

| AC | Test | Sensitivity shown by |
| --- | --- | --- |
| 1 Deterministic matching, real-shaped headings | `heading-match.test.ts::the abbreviations real exports use`, `::case, space and punctuation do not defeat a match` | Task 1 round: `Unit #` moved to the never-matches list, `Balance` to the always-amount list, `Amt` given `date` - **3 reds**. Plus the forked-folding mutation, caught only after the parity test was rewritten |
| 2 Every required target answered, "none" included | `suggest.test.ts::names every required target of a %s, matched or not`; at the surface, `suggestion-surface.test.tsx::says plainly when a required field got no suggestion` | Dropping unmatched targets from the result - **12 red**. Removing the "no suggestion" marker - **1 red** |
| 3 Pre-fills, does not decide; nothing stored | `prefill.test.ts::the mapping is the treasurer's (AC8)` (all three), `::nothing is stored, and nothing can be`; `suggestion-surface.test.tsx::lets a suggested column be unpaired by the means story 5.4 built` | Writing `pairings` directly instead of folding `assign` - **4 red**. Import scan is structural and asserted non-empty first |
| 4 No tool access, no data credential | `suggest.test.ts::imports nothing but the domain vocabulary it matches against`, `::reaches no store, client, credential or network` | Allow-list, not deny-list, over `specifiersIn`. Guarded against vacuity by `::reads its imports at all` and by asserting the comment-stripper did not eat the code |
| 5 Bounded, caps named | `suggest.test.ts::caps how many headings it will consider`, `::considers the last heading within the cap`, `::ignores a heading longer than the cap`, `::considers a heading exactly at the cap` | Removing either cap - **1 red each**. Off-by-one on either - **1 red each**. Both sides of both edges are asserted, so a cap of zero cannot pass |
| 6 Headers not logged or retained | `suggest.test.ts::does not log or retain the headings it is given`, `::keeps nothing between calls` | Structural plus behavioural. The behavioural half would fail on module-level state |
| 7 No suggester: usable, and says so | `suggestion-surface.test.tsx::with no suggester at all (AC7)` (five cases) | Ignoring the prop and always suggesting - **17 red**. Collapsing "never asked" into "found nothing" - **2 red** |
| 8 The confirmed mapping is the treasurer's | `prefill.test.ts::ends identical to the draft built by hand from the same choices`; `suggestion-surface.test.tsx::stops calling a pairing suggested once it has been changed` | The fixture is asserted to be a real override before comparing; shortening it to a no-op - **1 red**. Deriving the marker from history rather than the current pairing - **1 red** |

**The audit found nothing this time**, which is worth recording because it has found something on
nine consecutive stories. The likeliest reason is that the mutation rounds ran per task rather than
at the end, so the vacuous fixtures (three-column samples where two different counts coincide, a
distinctness assertion over inputs that cannot collide) were caught before this point rather than by it.

### File List

- `core/mapping/heading-match.ts` *(new)* - `matchKey`, `HEADING_ALIASES`, `targetForHeading`
- `core/mapping/heading-match.test.ts` *(new)* - 49 cases, including the cross-check that every
  published target names itself
- `core/mapping/suggest.ts` *(new)* - `ColumnSuggester` (the port 5.6b implements), `suggestColumns`,
  `deterministicSuggester`, `MAX_SUGGESTIBLE_HEADINGS`, `MAX_HEADING_LENGTH`
- `core/mapping/suggest.test.ts` *(new)* - 32 cases, including the structural AD-8 import scan and
  the cross-check that every suggestion is one `assign` accepts
- `core/mapping/prefill.ts` *(new)* - `draftFromSuggestion`, folding `assign`
- `core/mapping/prefill.test.ts` *(new)* - 15 cases, including AC8 stated as an equality
- `core/ports/module-specifiers.ts` *(new)* - `MODULE_SPECIFIER`, `specifiersIn`; the one import
  scanner, extracted from three drifted copies
- `core/ports/module-specifiers.test.ts` *(new)* - 19 cases, including the self-scan regression
- `core/ports/boundary.test.ts` *(updated)* - migrated onto the shared scanner; gains comment blanking
- `core/ports/finding.test.ts` *(updated)* - migrated onto the shared scanner
- `core/tools/sole-data-path.test.ts` *(updated)* - migrated onto the shared scanner
- `app/onboarding/mapping/column-pairing.tsx` *(updated)* - optional `suggester`, the pre-fill on both
  the initialiser and the reset, the marker, and the summary line
- `app/onboarding/mapping/mapping-wizard.tsx` *(updated)* - names `deterministicSuggester`
- `app/onboarding/mapping/suggestion-surface.test.tsx` *(new)* - 17 render cases

**Action item, not this story's work.** `neutralise` has no concept of a regex literal, so a quote
inside one desynchronises its string tracking and the comments after it stop being blanked. Any
production file containing a regex like `/['"]/` is read that way. It **fails closed** - prose is
reported as an import, so the guards go red rather than letting a violation through - which is why it
is recorded rather than fixed here. `module-specifiers.ts` sidesteps it by building its pattern from
escapes, and `module-specifiers.test.ts` asserts the limitation so the day it is fixed, it says so.

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-22 | Task 1: deterministic heading matching, built on the shared folding |
| 2026-08-22 | Created from FR-10. Scoped to the deterministic half plus the whole structural boundary; the model adapter is 5.6b |
