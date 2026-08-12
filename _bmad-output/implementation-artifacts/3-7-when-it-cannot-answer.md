---
baseline_commit: d4ad9f3
---

# Story 3.7: When it cannot answer

Status: review

## Why this story exists

Story 3.6b shipped the Oracle with three failure sentences and a comment saying story 3.7 owns the
real surfaces. This is that story.

It matters more than a story about error states usually would, because on this product the failures
are not edge cases. **AD-5 fixes the query catalog, so a question outside it is guaranteed rather
than hypothetical** — the catalog holds one entry today, and "I can't answer that" is the single most
likely thing a board member will see in their first session.

> **UX-DR17** — Oracle no-catalog-match state: names what it cannot answer and offers the nearest
> supported question in one response. Never improvises, approximates, or silently answers a narrower
> question.

> **UX-DR18** — Oracle service-unavailable state: distinct from no-catalog-match; question retained
> on screen, retry offered, no partial answer shown.

### There are three states, not two

The epics row names two. **AD-7's amendment of 2026-08-12 makes a third one first-class**: a rejected
answer "is never shown and never repaired — the surface says plainly that no answer could be
grounded, and the board member may ask again."

That is not the same as either of the others, and collapsing it into "service unavailable" would be a
lie in the direction that matters most: the service was fine, the records were fine, and the model
produced a sentence the validator could not tie to the rows. Story 3.6b already keeps the three apart
in `page.tsx`; this story gives each one a surface.

| State | What actually happened | What the reader must not conclude |
| --- | --- | --- |
| No catalog match | The question is outside the catalog | That the records are missing |
| Ungrounded answer (AD-7) | The model wrote a figure the rows do not support | That the system is broken, or that there is no answer |
| Service unavailable | The agent or a tool endpoint failed | That their question was unanswerable |

### The clause that is easy to skip

**"Offer the nearest supported question as a single action."** The tempting implementation writes the
offer by hand from the UX spec's own example — *"I can look up dues status, payment history, vendor
totals, and invoice comparisons."* Three of those four do not exist. Story 3.6c hit this exact trap
with the ask-field placeholder and solved it by deriving the copy from `ALL_ENTRIES` and pinning it
with a test that fails when the catalog changes. Do the same here.

## Story

**As** a board member whose question could not be answered,
**I want** to be told which of those things happened and what I can do next,
**So that** I neither doubt the records nor re-ask a question the system will never support.

## Acceptance Criteria

**AC1 — No-catalog-match names what it cannot answer, and what it can (UX-DR17).**
It says the question is not supported, never that the data is missing. The distinction is the whole
criterion: a treasurer told "no data" goes looking for a bookkeeping problem that does not exist.

**AC2 — The nearest supported question is offered as a single action, derived from the catalog.**
Not hand-written copy. It comes from the registered entries and their descriptions, and a test fails
when the catalog gains or loses an entry — the same pin story 3.6c put on the ask-field placeholder.
"A single action" means one control that asks it, not a sentence describing what to type.

**AC3 — Service-unavailable is a distinct surface, with the question retained and a retry (UX-DR18).**
The question stays on screen and the retry re-asks *that* question. Because 3.6c made the question a
search parameter, a retry is a link to the same URL — no state to preserve and nothing to lose.

**AC4 — An ungrounded answer is its own state, visible and re-askable (AD-7, amended 2026-08-12).**
Never presented as an outage and never as "no records". The validator refusing is the system working;
the surface says so plainly and lets the reader ask again.

**AC5 — No partial answer, in any state.**
No prose fragment, no partially-populated evidence table, no figure. UX: "Never present a partial
answer." An ungrounded sentence is the failure this entire epic exists to prevent.

**AC6 — The three states are distinguishable, and tested as three.**
A test that only asserts "some failure text appeared" passes against a surface that renders the same
lump for all three, which is exactly the defect. Each state asserts its own copy *and* asserts the
absence of the other two.

**AC7 — Keyboard, focus and targets (UX-DR9, UX-DR20).**
The retry and the suggested-question control are real links or buttons — reachable, operable, focus
ring never overridden, 24×24 minimum. Story 3.6b's lesson: assert what an element *is*, rather than
simulating a keypress jsdom does not translate.

**AC8 — Tested as a rendered surface.**
Render tests per story 1.6c's harness: jsdom, `@testing-library/react`, per-file opt-in.

## Tasks / Subtasks

- [x] **Task 1 — The three states as components (AC1, AC4, AC5, AC6)**
  - [x] Props-driven, so the tests need no server. `AnswerView` is the shape to follow.
  - [x] Copy for each state, written to the distinction in the table above.
  - [x] Assert the absence of the other two states' copy in each test.

- [x] **Task 2 — The nearest supported question (AC2)**
  - [x] Derive from `ALL_ENTRIES` and each entry's `description`, which story 3.4 added for exactly
        this kind of use.
  - [x] Offer it as a control that asks it — a link to `/oracle?q=…`, which needs no JavaScript.
  - [x] Pin against the catalog so the copy cannot outgrow it silently.

- [x] **Task 3 — Retry (AC3, AC7)**
  - [x] A link to the same `?q=`. Assert it carries the question, not merely that it exists.

- [x] **Task 4 — Wire into `page.tsx`, replacing `explain()` (AC6)**
  - [x] The three branches already exist and are already distinct; they return sentences. Replace
        with the three surfaces, keeping the branch structure.

- [x] **Task 5 — The gate**
  - [x] `npm run lint`, `npm run build`, `npm test`, `npx --no-install tsc --noEmit` against the
        8-error baseline. `test:db` and `test:py` only if this touches `app/tools/` or `agent/`,
        which it should not.

## Dev Notes

### What already exists

`app/oracle/page.tsx` catches three things and maps them through `explain()`:
`NoCatalogMatchError`, `AnswerNotGrounded`, and everything else. The branch structure is correct and
tested — `page.test.tsx` asserts each maps to its own sentence, and that the two named failures are
not logged as faults. **Keep the branches; replace what they return.**

`app/oracle/question.ts` exports `questionFrom` and `MAX_QUESTION_LENGTH`. The question is a search
parameter, which is what makes retry a link.

### The offer must come from the catalog

`catalog/registry.ts` exports `ALL_ENTRIES`; each entry carries a `description` written for a reader.
Today there is one, `dues_status@1`: one unit, one assessment year. Its description says what it does
*and* what it does not — "does not say what is overdue today, does not break the year into
instalments" — which is unusually good material for this surface.

A suggested question built from that is honest by construction. One written from the UX spec's
example is a lie the first time somebody clicks it.

### Learnings that apply directly

- **Story 3.6c**: derive user-facing capability copy from `ALL_ENTRIES` and pin it with a test that
  fails when the catalog changes. Also: a plain link or GET form beats client-side navigation here —
  no JavaScript, back button correct, and the URL is the state.
- **Story 3.6b**: the close-out audit found two ACs that four green review rounds had missed. Read
  this AC list against the code *before* opening the MR, not after.
- **Story 3.6b**: `page.tsx` is testable — mock `@/adapters/auth/auth` and `next/navigation`, and
  make the `redirect` mock **throw**, because the real one unwinds the render.
- **Story 1.5d**: a surface story's defects are states that never resolve. Four were found after 29
  mutations found none, one of which showed "Reading" to a treasurer forever.
- **Story 3.5**: an assertion that something is absent cannot tell "correctly excluded" from "never
  rendered". Assert the positive case in the same breath — which AC6 makes structural here.

### Anything carrying a backslash

Write it with the editing tool, never through a shell heredoc: a command string loses one level of
backslash escaping before the shell receives it. `docs/no-control-characters.test.ts` now catches the
resulting literal control bytes, after that bug landed four times.

### If this has to be cut

The service-unavailable retry is the least valuable piece — a board member can refresh. The
no-catalog-match state is the one that must ship, because it is the failure they will actually meet.

### References

- [Source: epics.md] — UX-DR17, UX-DR18
- [Source: ux-designs/…/EXPERIENCE.md] — the failure-state copy table; the "I can't answer that one"
  example, whose capability list this catalog cannot honour
- [Source: ARCHITECTURE-SPINE.md] — AD-7 as amended 2026-08-12, AD-5, AD-12
- [Source: app/oracle/page.tsx] — the three branches and `explain()`
- [Source: catalog/registry.ts] — `ALL_ENTRIES` and each entry's `description`

## Dev Agent Record

_To be filled by the dev agent._

## Review Findings

### AC audit, done before the MR

| AC | Status | Pinned by |
| --- | --- | --- |
| AC1 blames the question, not the records | met | "says it cannot look that up, and that nothing is missing" |
| AC2 offer is a single action, catalog-derived | met | `suggested-question.test.ts` (7 cases) + the link's `href` |
| AC3 unavailable is distinct, question retained, retry offered | met | three tests, incl. a question containing `&` and `#` |
| AC4 a refusal is its own state | met | "explains that the check did its job" + "ask again" link |
| AC5 no partial answer | met | `it.each` over all three: no `<table>` renders |
| AC6 the three are distinguishable | met | each state asserts its own copy **and** the absence of the other two |
| AC7 keyboard, focus, targets | met | all three controls: `tagName`, `href`, both dimensions, no `outline` override |
| AC8 tested as a rendered surface | met | 15 render tests under 1.6c's harness |

### Argus — three rounds, four findings, two rejected

| Round | Finding | Outcome |
| --- | --- | --- |
| 1 | **high** — logging the failure object leaks the gateway token, because a rejected `fetch` carries its request config | **Rejected, then pinned.** `chat-client.ts` reduces the fetch error to its `name` and throws a fresh `AgentUnavailableError` with no `cause`. But that was read once and enforced by nothing, so there is now a test that rejects a fetch *with* a request config attached and asserts the token appears nowhere in the serialised error. Wrapping the original as `cause` fails it. |
| 1 | **medium** — the AC7 loop omits `NoCatalogMatch` | **Fixed.** Its suggested question is the control a reader is most likely to use. |
| 2 | **high** — `vi.resetAllMocks()` destroys the throwing `redirect` mock, so the auth tests pass on a `TypeError` | **Rejected.** Probed: in this Vitest, `mockReset` *restores* the function passed to `vi.fn(impl)` and discards only runtime-configured implementations. The finding also mispredicts the failure — those tests assert the `NEXT_REDIRECT` message specifically, so a `TypeError` would fail them. Reasoning moved into the `beforeEach` so it is not re-raised. |
| 2 | **medium** — `EXAMPLE_IDS` vs `ALL_ENTRIES.map(id)` without dedup | **Fixed.** `indexEntries` accepts two versions of one id (verified), so publishing `dues_status@2` would have failed a test about copy that was still correct. Deduplicated, with a positive control so the relaxation did not relax what the test is *for*. |
| 3 | **medium** — `next/link` requires JavaScript | **Rejected.** `Link` renders a real `<a href>` and degrades to ordinary navigation without JS; the AC7 test already asserts `tagName === 'A'` with a real `href`. It is also the project's established choice from story 1.5's review, where a bare anchor was rejected for discarding router state. |

**Both rejections came from a probe, not an argument.** The `resetAllMocks` one is worth keeping: story
3.6b made the *opposite* change for the opposite reason, and the two are not in conflict — there the
implementations came from `mockResolvedValue` inside tests and had to be discarded; here it comes
from the `vi.fn(impl)` constructor and is restored. Same API, two lifetimes.

### CodeRabbit CLI — clean

`review_completed`, **9 of 9 files reviewed, none unreviewed, zero findings.** Joined by
`argus_ingest` on `537ae14`.

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-12 | Story created after 3.6c merged. Scoped to **three** states rather than the two the epics row names: AD-7's amendment of the same day makes the ungrounded refusal a first-class surface, distinct from an outage. |
| 2026-08-12 | Implemented test-first. Three Argus rounds (two findings fixed, two rejected by probe), CodeRabbit CLI clean on 9 of 9 files. AC audit done before the MR. |
