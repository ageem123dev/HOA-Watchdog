---
baseline_commit: a9802c3
merge_request: 42
---

# Story 3.5: The numeric validator

Status: review

## Why this story exists

This is the story the product's headline claim rests on.

> **AD-7** — "Every numeric token in a rendered answer must match a value present in the tool result
> set for that turn. A pre-render validator rejects any unreferenced numeral and forces a retry. The
> validator carries an explicit normalization rule for formatting (`1240` ≡ `$1,240.00`) and rejects
> rounding that is not itself a returned value. **This supersedes NFR-3's system-prompt mechanism;
> prompt directives may remain as defence in depth but carry no enforcement weight.**"

Story 3.4 gave the model a way to fetch real rows. Nothing yet stops it putting a *different* number
in the sentence it writes about them. A board member reading "unit 4B owes $1,240.00" has no way to
tell that figure from one the model invented, and SM-1 claims 100%.

**The epic fixes this story's position and says why:**

> **AD-7**: every numeric token in a rendered answer must match a value in that turn's tool result.
> The validator must exist **before** the first answer is rendered, or the first surface story ships
> precisely the failure the product exists to prevent.

Story 3.6 is that surface story. This one has to land first.

### Why a prompt cannot do this job

NFR-3 originally asked the system prompt to forbid arithmetic. AD-7 replaced that outright, and the
reason is worth carrying into the code: a prompt is a request. It fails silently, it fails more often
under unusual input, and nothing downstream can tell a compliant answer from a lucky one. A validator
is a property of the code — it holds on the turn where the model is confused, which is the only turn
that matters.

### What this story is not

- **Not the renderer.** No page, no component, no answer prose. Story 3.6 builds that *behind* this.
- **Not the "cannot answer" states.** Story 3.7 owns the honest failure surfaces. This story defines
  the failure; 3.7 shows it to somebody.
- **Not arithmetic.** The validator never computes a value to compare against — AD-6 already requires
  catalog entries to return every derived number. If an answer needs a figure the rows do not carry,
  the correct outcome is rejection and a new catalog entry, not a calculation here.

## Story

**As** a board member,
**I want** every number in an answer to come from the records rather than from the model,
**So that** I can act on a figure without checking it myself.

## Acceptance Criteria

**AC1 — Every numeral in an answer must appear in that turn's rows.**
Given a candidate answer and the tool result set it was produced from, the validator accepts only if
every numeric token in the answer matches a value present in those rows. A numeral that appears
nowhere in the result set is a rejection.

**AC2 — Formatting is normalized, and the rule is explicit.**
`1240`, `1,240`, `$1,240.00` and `1240.00` are the same value as a returned `"1240.00"`. The
normalization rule is stated in one place, tested at its edges, and is the *only* statement of it in
the system — story 3.6's renderer consumes it rather than restating it.

**AC3 — Rounding that is not itself a returned value is rejected.**
If the rows carry `1240.55`, an answer saying `1,241` or `1240.5` is rejected. Rounding is a
computation, and AD-6 says a number the answer needs is a number the entry must return.

**AC4 — Rejection forces a retry, and the retry is bounded.**
A rejected answer causes another attempt rather than being shown. Attempts are bounded; exhausting
them raises a distinct, named failure rather than returning the last rejected answer, an empty
answer, or a partially-scrubbed one.

**AC5 — The retry is invisible.**
Nothing about a rejected attempt reaches the caller on success. A caller receives either an accepted
answer or a failure — never an accepted answer carrying evidence that earlier ones were rejected.

**AC6 — Non-numeric digits are not numerals.**
Unit `4B`, catalog reference `dues_status@1`, and an ISO date `2026-07-01` must not be torn into
digits and rejected. The rule for what counts as a numeric token is explicit and tested against each
of these, because an over-strict validator rejects true answers and gets switched off.

**AC7 — It reuses the money parser this project already has.**
`core/assessment/minor-units.ts` owns decimal-string handling. The validator does not write a second
parser. A second statement of that shape with nothing failing on disagreement is the standing mistake
migration 007's comment records.

**AC8 — The guard is proven able to fail.**
Tests plant hallucinated figures — an invented total, a rounded total, a transposed figure, a number
from a *different* row set — and assert each is rejected. A validator tested only against good
answers passes by checking nothing.

## Tasks / Subtasks

- [x] **Task 1 — What counts as a numeric token (AC1, AC6)**
  - [x] A tokenizer with an explicit, documented rule. Decide and test: currency, plain integers,
        decimals, percentages, thousands separators.
  - [x] Test that `4B`, `dues_status@1`, `2026-07-01` and `v1` are not treated as numerals — each is
        a real shape this system already produces.
  - [x] State in the header what is deliberately *not* validated, and why.

- [x] **Task 2 — Normalization (AC2, AC7)**
  - [x] One function, built on `toMinorUnits`/`fromMinorUnits`. Do not re-parse decimals.
  - [x] Edge tests: `0` vs `0.00`, trailing zeros, a leading `$`, embedded commas, negatives.
  - [x] Export it as the single statement of the rule, so 3.6's renderer consumes rather than
        restates it.

- [x] **Task 3 — The values a turn makes available (AC1, AC3)**
  - [x] Walk the tool result rows and collect every value a numeral could legitimately match,
        including integers such as counts and years.
  - [x] Nested values count if the rows carry them; a value the rows do not carry does not.
  - [x] Test that a number from a *different* turn's rows is rejected — the set is per-turn.

- [x] **Task 4 — The validator (AC1, AC3, AC8)**
  - [x] `validate(answer, rows)` → accepted, or a rejection naming the offending token.
  - [x] The rejection reason must not quote the whole answer into a log; name the token.
  - [x] Plant the four hallucination shapes from AC8 and assert each is caught.
  - [x] Sensitivity check: break the comparison, confirm the planted cases fail.

- [x] **Task 5 — The bounded retry (AC4, AC5)**
  - [x] A wrapper that re-attempts on rejection, with an explicit attempt cap.
  - [x] Exhaustion raises a named error. Never the last rejected answer, never an empty one.
  - [x] Test that a success on attempt 2 returns exactly the accepted answer and nothing else.
  - [x] Test the cap is honoured — a producer that always fails is called exactly N times, not
        forever.

- [x] **Task 6 — The gate**
  - [x] `npm run lint`, `npm run build`, `npm test`, `npx --no-install tsc --noEmit` against the
        8-error baseline. `test:db` only if this touches `app/tools/`; `test:py` only if it touches
        `agent/`.

## Dev Notes

### Where this lives, and it is a real decision

The validator is pure: an answer, some rows, a verdict. It belongs in `core/` — no I/O, no model, no
framework. `core/ports/boundary.test.ts` will enforce that `core/` imports nothing outward.

**Whether the retry wrapper lives here or in the agent is the open question.** The model call is in
Python (`agent/watchdog_agent/`), and the validator is TypeScript. Two plausible shapes:

1. **Validate in the gateway, on the way out.** The agent returns a candidate answer; Node validates
   before rendering. Keeps the rule in one language, next to the rows.
2. **Validate in the agent, before returning.** Needs the rule restated in Python — which AC7 exists
   to prevent.

Shape 1 is strongly preferred and is what the ACs assume. **If implementation shows the retry cannot
work without the agent seeing the rejection, that is a HALT** — it changes the wire contract AD-15
governs, and that belongs to the project lead.

### `4B` is why the tokenizer is a task of its own

This system already produces strings where digits are not quantities: unit numbers (`4B`), catalog
references (`dues_status@1`), ISO dates (`2026-07-01`), version tags. An over-strict validator
rejects true answers, and a validator that rejects true answers is one somebody switches off — which
is the failure `forbidden-credentials.ts` warns about in its own header, in a different guard.

Under-strict is the other cliff and the worse one. State the rule, test both directions.

### Rejection must not become a leak

A rejection message is written where somebody will read it — a log, a retry prompt, an error. The
answer being rejected may contain a member's balance. Name the *token* and the reason, never the
sentence. Story 3.3's credential scanner shipped the opposite of this and CodeRabbit caught it: it
copied 60 characters of the matching line into output the assertion prints.

### Learnings that apply directly

From **3.4**, which is one story old:

- **The only defect capable of a wrong financial answer lived in prose**, not code — a catalog
  entry's description contradicted its own SQL. Here the equivalent risk is the *normalization rule*
  being described one way and implemented another. Test the rule, do not document it.
- **A fix diff carried the next defect three times.** Expect it. Re-run the gate on every fix.
- **`os.walk`-style pruning and suite runtime**: if the suite time jumps, read it rather than note it.

From **3.1**, on AD-6: catalog entries already return derived values *because of this story*. If a
number the answer needs is not in the rows, the fix is a new catalog entry, not arithmetic here.

### Testing standards

Vitest. Test-first per `bmad-dev-tdd`: a failing test that fails for the right reason before the code
exists. The gate is the only evidence — there is no CI.

**The sensitivity check is not optional here.** This validator is exactly the shape of guard this
project has shipped broken ten times: one that passes whether or not the thing it guards against is
present. Break the comparison and confirm the planted hallucinations fail.

### If this has to be cut

Cut **Task 5's retry wrapper** last, not first — a validator with no retry still blocks a bad answer,
and 3.6 can call it directly. What must not be cut is AC8: a validator nobody proved can fail is a
validator nobody should trust.

### References

- [Source: ARCHITECTURE-SPINE.md#AD-7] — provenance-bound numbers; the normalization rule; supersedes
  NFR-3's prompt mechanism
- [Source: ARCHITECTURE-SPINE.md#AD-6] — entries return every derived value, so the validator never
  computes
- [Source: docs/prd/prd.md#NFR-3] — enforced structurally, not by instruction
- [Source: epics.md#Epic-3] — the validator must exist before the first answer renders
- [Source: core/assessment/minor-units.ts] — `toMinorUnits` / `fromMinorUnits`, the existing decimal
  contract
- [Source: core/assessment/schedule.ts] — how money arithmetic is already done here: minor units,
  formatted once
- [Source: 3-4-the-model-picks-an-entry.md] — the prose-vs-code finding, and the fix-diff pattern

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (1M context), via `bmad-dev-tdd` inside `bmad-ship-story`.

### Test Design

**The tokenizer** — GUARD: digits inside identifiers (`4B`, `dues_status@1`, `v1`, `unit_2_summary`),
dates and timestamps, uuids. GUARD: multiple numerals in one sentence; an identifier and a real
figure together. OUT-OF-SCOPE: words spelled as numbers ("two hundred"), which no catalog entry
returns and which AD-6 would make a derived value anyway.

**Normalization** — GUARD: every spelling of one amount collapsing to one value; exactness without a
float; more precision than `numeric(14,2)` can hold. PROPAGATE: `toMinorUnits`'s own errors, unchanged.

**The available values** — GUARD: a non-amount string contributing nothing; a value the rows did not
carry; a value from another turn; nested values; the empty-rows case being empty rather than
permissive.

**The validator** — GUARD: four planted hallucination shapes (invented, rounded, transposed,
borrowed from another turn); an unparsable numeral; a rejection carrying a name or the sentence.

**The retry** — GUARD: the cap being honoured; a cap below one; exhaustion raising rather than
returning the last rejected or an empty answer; a success carrying no trace of the rejected attempt.

### Debug Log References

**The colon.** The tokenizer excluded an ISO timestamp's date half via its hyphens, and `09:30:00`
walked straight through as `30` and `00`. A separator is a hyphen *or a colon* with digits on the far
side. Caught by the over-strict/under-strict test pair, which is why both directions exist.

**tsc caught a design question, not a typo.** The compiler could not prove a rejection existed at the
throw below the loop. The available outs were an `as` assertion or an unreachable branch — a claim
nothing checks, or a guard no test can reach. Restructured so the throw sits inside the loop and the
non-null is provable. `npm run build` does not read this file; the baseline `tsc` check is what
surfaced it, for the fourth story running.

**Sensitivity check, which is the point of this story.** Defanging the comparison fails 7 tests
including all four planted hallucinations; treating an unparsable numeral as absent fails the
precision test.

### Completion Notes List

- **The validator never computes.** AD-6 puts derived values in the entry, so a number the rows lack
  is a new catalog entry, not arithmetic here — a deriving validator would accept exactly the figures
  a model is likeliest to get wrong.
- **Normalization has one home.** `valueOf` is the single statement of how an amount is spelled;
  story 3.6's renderer consumes it rather than restating it.
- **Retry or fail, never repair.** A scrubbed answer is a sentence nobody wrote about a member's
  money; an answer admitting it was corrected invites the manual re-checking this product removes.
- **The retry wrapper stayed in `core/`** and the HALT the story recorded in advance was not needed —
  nothing about the retry required the agent to see the rejection, so the AD-15 wire contract is
  untouched. Story 3.6 wires `groundedAnswer` to a producer.
- Nothing user-visible ships here. Story 3.6 renders behind this; 3.7 owns what a board member sees
  when `AnswerNotGrounded` is raised.

### File List

**New** — `core/answer/numerals.ts`, `core/answer/numerals.test.ts`,
`core/answer/validate-answer.ts`, `core/answer/validate-answer.test.ts`,
`core/answer/grounded-answer.ts`, `core/answer/grounded-answer.test.ts`

**Updated** — none. This story adds a module and changes nothing existing, which is why the
integration risk sits in story 3.6 rather than here.

## Review Findings

_To be filled by the review._

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-11 | Story created. Baselined on `a9802c3`, the merge of story 3.4. |
| 2026-08-11 | Implemented test-first across six tasks; 64 new tests. The recorded HALT was not triggered — the retry needed no change to the AD-15 wire contract. Status → review. |
