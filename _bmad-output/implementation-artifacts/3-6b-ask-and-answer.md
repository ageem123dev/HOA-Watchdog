---
baseline_commit: 51b942a
merge_request: 46
---

# Story 3.6b: Ask and answer

Status: done

## Why this story exists

This is the first thing a board member sees. Everything in Epic 3 so far is machinery: a catalog, a
provenance log, a token-checked endpoint, a Python runtime, a model that picks an entry, a validator
that refuses an ungrounded number, and a wire between the two services. **Nobody can ask anything.**

> **UX-DR11** — "Oracle surface — three-layer answer: prose, always-visible evidence table, collapsed
> query disclosure. The question remains visible while the answer resolves."

The three layers are the product's argument in miniature. The prose is what a model wrote. The
evidence table is the rows it was drawn from, which AD-7 has already proved every number came from.
The disclosure names the catalog entry and version, which AD-14 has frozen. A board member can read
the first layer and act, or read the third and check.

### Blocked on 3.6a

Nothing here can start until a question round-trips. 3.6a builds `/chat/v1/turn`, the token in the
Node→agent direction, and the gateway client. This story renders what that returns.

### What this story is not

- **Not the failure states.** Story 3.7 owns "no catalog match" and "service unavailable" as distinct,
  honest states. This story renders a *successful* turn; 3.7 renders the rest, and the epic keeps
  them apart on purpose.
- **Not the access log.** Story 3.8 gives the provenance record a reader.
- **Not a new number anywhere.** Every figure on screen comes from the rows, and AD-7's validator has
  already said so. The renderer formats; it never computes.

## Story

**As** a board member,
**I want** to ask a question in my own words and see the answer with the records it came from,
**So that** I can act on it without asking the treasurer to check.

## Acceptance Criteria

**AC1 — ~~The persistent ask field (UX-DR7).~~ Moved to story 3.6c, 2026-08-11.**
The dashboard entry point is its own story. This one ends at an Oracle reachable by URL with the
question as a search parameter, which is what the three layers need in order to be proven. 3.6c adds
the field that puts the question there, and owns UX-DR7 entirely.

**AC2 — The question stays visible while the answer resolves (UX-DR11).**
From submission to answer, the question a board member typed remains on screen. They must never be
looking at a loading state wondering what they asked.

**AC3 — Three layers, in order (UX-DR11).**
Prose, then an **always-visible** evidence table of the rows, then a query disclosure. The evidence
table is not behind a control: the argument of this product is that the rows are always there.

**AC4 — The query disclosure (UX-DR6).**
Collapsed by default. Keyboard-operable with its state announced. Labelled with the catalog entry and
version — `dues_status@1`, the pair AD-14 froze and AD-12 logged. Open state persists for the session.

**AC5 — Every number on screen came from the rows.**
The rendered answer passes `validateAnswer` before it is shown. A turn whose answer cannot be
grounded renders no answer at all — story 3.7 owns what shows instead, and until it exists an honest
placeholder rather than an ungrounded sentence.

> **Decided 2026-08-11: one attempt, then fail.** AD-7 says a rejected answer "forces a retry", and
> that is deliberately not implemented here. Since story 3.6a the model lives across a wire, so a
> retry means another turn — which re-runs `route_question`, **re-executes the catalog entry**, and
> returns *different rows*. The validator would then check attempt two against attempt one's
> evidence, and AD-12 would record a second `query_log` row for one question, which a board member
> reading the access log would have to have explained to them.
>
> The fix that preserves the retry is a narrate-only endpoint taking the rows already returned — and
> that collides with AD-17's request clause. Rather than amend a second AD to keep a capability
> nothing yet needs, the surface calls `groundedAnswer(rows, produce, { attempts: 1 })`: the producer
> runs once, and a rejection raises `AnswerNotGrounded` for story 3.7 to render. **No code is dropped**
> — the retry stays available for the day that endpoint exists, configured to one attempt today.
>
> `attempts: 1` rather than calling `validateAnswer` directly, so the decision is a number somebody
> can change rather than a code path somebody has to rebuild.

**AC6 — Formatting has one home, and the evidence table is not it.** *(Clarified 2026-08-11.)*
No amount is re-spelled for display. The evidence table renders each value exactly as the rows carry
it, because those are the values AD-7 compared the prose against — re-formatting would break "every
figure in the answer must be locatable in the table", and would itself be the second statement of
money formatting this AC exists to forbid.

> **The original wording said amounts are "formatted through `valueOf`", and that is not a thing
> `valueOf` does.** Argus read it literally and asked for it; applying that would print `124000` for
> `1240.00`, since `valueOf` parses to minor units, and would *throw* on `unitNumber: '4B'`, taking
> the table down. The AC meant "do not write a second formatter", and there is no first one — so the
> correct implementation is to write none. Pinned by a test, so the suggestion cannot be applied
> later without something going red.

**AC7 — Focus and target rules (UX-DR9).**
Focus ring is 2px ink with 2px offset on stone grounds, inverse on ink. Never removed, never
colour-only. Interactive targets meet the minimum size the design system sets.

**AC8 — It is tested as a rendered surface.**
Render tests, per the pattern story 1.6c established — jsdom plus `@testing-library/react`, per-file
opt-in, and `include` widened to `.tsx`. The disclosure's keyboard operation and announced state are
asserted, not assumed.

## Tasks / Subtasks

- [x] **Task 1 — The Oracle route and the question's journey (AC1, AC2)**
  - [x] The surface. `/oracle?q=…`, with the turn running during that render.
  - [~] ~~The dashboard ask field~~ — moved to **3.6c** with AC1, 2026-08-11.
  - [~] ~~The absence of the intermediate empty state~~ — moved to **3.6c**; it is a claim about
        where submitting *goes*, and there is nothing to submit from until the field exists.

- [x] **Task 2 — The three layers (AC3, AC4)**
  - [x] Prose, evidence table, disclosure — in that order, with the table always visible.
  - [x] Disclosure: collapsed by default, keyboard-operable, state announced, labelled
        `entry@version`.
  - [x] **Session-persistent.** Missed in the story branch and caught at close-out; delivered by the
        follow-up chore MR below.

- [x] **Task 3 — Grounding and formatting (AC5, AC6)**
  - [x] `validateAnswer` before render, via `groundedAnswer(rows, produce, { attempts: 1 })`.
  - [x] Formatting through the existing contract — the table re-spells nothing.

- [x] **Task 4 — Accessibility and the gate (AC7, AC8)**
  - [x] Focus ring. Global in `BASE_CSS`'s `:focus-visible`; this surface uses a native `<button>`
        and overrides nothing, which is what a test now asserts.
  - [x] **Target size.** Missed in the story branch and caught at close-out; delivered by the
        follow-up chore MR below.
  - [x] Render tests per story 1.6c's harness.
  - [x] Gate. `test:db` and `test:py` correctly not run — this touches neither `app/tools/` nor
        `agent/`.

## Dev Notes

### Read the UX design before building any of this

`_bmad-output/planning-artifacts/ux-designs/` holds the surface specifications, and
`core/design/tokens.ts` holds the system. UX-DR9's focus ring and the target sizes are stated there
precisely; this story must not invent a second version of either.

### The evidence table is the argument, not a detail

It is tempting to collapse it — it is the widest thing on the page. UX-DR11 says **always-visible**,
and the reason is the whole product: an answer a board member has to expand something to verify is an
answer they will stop verifying. The disclosure is collapsed; the table is not.

### Learnings that apply directly

- **Story 1.6c established the render-test harness**: jsdom + `@testing-library/react`, per-file
  opt-in, `include` widened to `.tsx`. Do not re-derive it.
- **Story 1.5d found four defects after 29 mutations found none**, one of which showed "Reading" to a
  treasurer forever for a document already read. A surface story's defects are states that never
  resolve, and mutation testing does not find them.
- **Story 3.5**: an assertion that something is absent cannot tell "correctly excluded" from "never
  seen". A render test asserting a thing is *not* shown passes on a component that renders nothing.

### If this has to be cut

Cut **AC1's dashboard ask field** last and keep the Oracle surface itself — a route reachable by URL
still proves the three layers. What must not be cut is AC5: a surface that renders an ungrounded
answer is the failure the whole epic was built to prevent, and it would be shipping it on the first
day anyone can see it.

### References

- [Source: epics.md#Epic-3] — 3.6b's row, and the split rationale
- [Source: epics.md] — UX-DR6, UX-DR7, UX-DR9, UX-DR11
- [Source: ARCHITECTURE-SPINE.md#AD-7] — every numeric token is provenance-bound
- [Source: ARCHITECTURE-SPINE.md#AD-14] — the entry@version pair the disclosure names
- [Source: core/answer/] — `validateAnswer`, `groundedAnswer`, `valueOf`
- [Source: 3-6a-the-chat-turn-crosses-the-wire.md] — what the turn returns
- [Source: 1-6c-see-what-is-waiting.md] — the render-test harness

## Dev Agent Record

_To be filled by the dev agent._

## Review Findings

### Argus, whole-story diff (`51b942a..HEAD`)

| # | Finding | Outcome |
| --- | --- | --- |
| 1 | `entryFor` outside the `try` crashed the page on a version skew instead of rendering the honest failure | Fixed — moved inside |
| 2 | `aria-controls` pointed at an id absent from the document while collapsed | Fixed — set only while the target exists |
| 3 | `attempts: 1` was pinned by nothing; changing it to 3 failed no test | Fixed — spy assertion added |
| 4 | "Use `valueOf` in the table cells" | **Rejected.** `valueOf('1240.00')` is `124000` (minor units, not formatting) and `valueOf('4B')` throws, so the unit column would crash the table. AC6's wording was the real defect and was reworded. Pinned by a test so the suggestion cannot be applied later without a failure. |

### CodeRabbit CLI — 13 of 13 files reviewed, none unreviewed

| # | Severity | Finding | Outcome |
| --- | --- | --- | --- |
| 1 | **major** | `page.tsx` guarded on `!session?.user` and read `session.user.id ?? ''`; a session with no id was refused by `askOracle` and the refusal surfaced as *"The records could not be reached just now."* | Fixed — guard requires the id. Verified `page.tsx:67 → ask.ts:72` before acting. |
| 2 | trivial | `vi.clearAllMocks()` keeps implementations, so a stub leaks between tests | Fixed — `resetAllMocks`. **Not pinned by any test, and cannot be** (see below). |
| 3 | trivial | `questionFrom` unbounded | Fixed — truncates at `MAX_QUESTION_LENGTH` (500) |
| 4 | trivial | Unrecognised failures swallowed before `explain()` | Fixed — logged first; the two named failures still are not |
| 5 | trivial | The attempts test sat in an unrelated describe block | Fixed |
| 6 | trivial | Columns from `rows[0]`, and `jsonb` values rendering `[object Object]` | Fixed — union of all keys, and objects serialized |

**Sensitivity check on all six**: five fail when the fix is reverted. #2 does not and cannot — it
prevents a *future* test from passing against a stub it never configured, and reverting it leaves all
53 oracle tests green. That is the hazard, not evidence against the fix.

**The correction this round produced.** `page.tsx` was believed untestable because importing it pulls
`auth → next-auth → next/server` — the reason `questionFrom` was extracted. That was wrong:
`app/quarantine/page.test.tsx` has mocked that chain since story 1.5, and `vi.mock` hoists above the
fatal import. `app/oracle/page.test.tsx` now carries six tests. Its `redirect` mock throws the way
the real one does; a mock that returned would let the page carry on and ask the question anyway.

Argus re-run on the final head: no findings.

### MR !46, round 1 — 2 actionable, both about tests that proved less than they looked

| # | Finding | Outcome |
| --- | --- | --- |
| 1 | `never returns a partially scrubbed answer` asserted `toBeInstanceOf(Error)` | Fixed — asserts `AnswerNotGrounded` and the refused numeral. The loose form passed for a typo'd mock, an unconfigured `askAgent`, any `TypeError`; it could not tell "AD-7 refused this" from "the test is broken". |
| 2 | The `does not log` test covered only `NoCatalogMatchError` | Fixed — a second test covers `AnswerNotGrounded`. **Verified unpinned first**: deleting `&& !(failure instanceof AnswerNotGrounded)` from `page.tsx` left all 53 green. |

Both are findings in *last round's fix*, which is where the gate says to expect them.

Sensitivity on the round: deleting the log clause fails 1 test; making `ask.ts` rewrap the refusal as
a generic `Error` fails 6 — a mutation the old assertion sat green through, while `page.tsx` branches
on that exact type to choose what a board member reads.

**Two type errors caught by the gate, not the suite.** The round pushed tsc from 8 to 10: a duplicate
`AnswerNotGrounded` import (the file already bound it via `await import`) and a `Rejection` missing
its `index`. Vitest does not typecheck, so 54 tests passed over both.

### Argus on the fix diff — 4 findings, 2 rejected

| Severity | Finding | Outcome |
| --- | --- | --- |
| critical ×2 | `vi.mock` factories reference unhoisted consts → `ReferenceError` | **Rejected.** The consts are referenced inside arrow-function bodies, evaluated at first import of the mocked module, not at hoist time — and `./page` is imported dynamically inside each test. 54 tests run and pass, which a real hoisting `ReferenceError` cannot produce. |
| medium | `logged.mockRestore()` after the assertions is skipped when one fails, muting `console.error` for every later test | **Fixed** — `afterEach(vi.restoreAllMocks)`. `resetAllMocks` does not restore a spy, so the mute persisted exactly when things were already going wrong. |
| high | `.mcp.json` holds a machine-local absolute path | Out of scope — an uncommitted user file, not in this branch's diff. |

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-11 | Story created when 3.6 was split. Stays `backlog` until 3.6a lands — the surface has nothing to render before the wire exists. |
| 2026-08-11 | 3.6a merged. Baselined on `51b942a`. Two decisions taken before any code: **one attempt, then fail** (AD-7's retry clause deliberately unimplemented — see AC5), and the whole surface ships as one story, since the three layers are meaningless apart. Status → in-progress. |
| 2026-08-11 | Argus round: 3 fixed, 1 rejected with a pinning test. CodeRabbit CLI round: 6 findings, all fixed, 5 pinned. `app/oracle/page.test.tsx` added after the "untestable page" belief turned out to be wrong. MR !46 opened; gate green on `d384e44` — 2073 tests, 109 files. |
| 2026-08-11 | MR !46 round 1: 2 findings, both in the previous round's fix, both fixed and pinned. Argus on the fix diff: 1 fixed, 2 rejected as false (hoisting), 1 out of scope. Two type errors caught by tsc that the suite ran past. |

### Close-out audit, after MR !46 merged

Checking every AC against the code before marking the story done found **two clauses that were never
implemented**, both of which the review rounds had passed over:

- **AC4 — "Open state persists for the session."** The disclosure used `useState`, which forgets on
  every navigation. Four review passes (two Argus, one CodeRabbit CLI, one MR round) read that
  component and none compared it to this sentence. Reviewers check the code in front of them; only
  the AC list checks for code that is *absent*.
- **AC7 — the 24x24 CSS px minimum target.** The disclosure button had no styling at all. The focus
  ring half of AC7 was satisfied by accident and by good luck: `:focus-visible` is global in
  `BASE_CSS`, and a native `<button>` inherits it.

Delivered by the follow-up chore branch `chore/oracle-session-disclosure-and-target-size`, with a
third fix Argus raised against that work: `useSyncExternalStore` reads `sessionStorage` **during
render**, so a browser that restricts storage — Safari private mode, restricted embedding — threw
`SecurityError` and took down the whole Oracle. The disclosure now falls back to page-lifetime memory
and keeps working.

**The lesson is the process one, and it is worth more than the fixes.** The story was one step from
being marked done on unverified work, and what stopped it was reading the ACs one at a time against
the code rather than trusting four green reviews.
| 2026-08-11 | MR !46 merged. Close-out audit found AC4's session persistence and AC7's target size were never implemented; both delivered by a follow-up chore MR, along with a `SecurityError` crash Argus found in the fix. Status → done. |
