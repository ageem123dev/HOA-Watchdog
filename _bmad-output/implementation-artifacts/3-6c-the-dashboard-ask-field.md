---
baseline_commit: TBD
---

# Story 3.6c: The dashboard ask field

Status: backlog

## Why this story exists

Story 3.6b built the Oracle and left it reachable only by typing a URL. **Nobody asks a question by
editing an address bar.** This is the last piece of the path a board member actually walks: they open
the dashboard, they have a question, and they type it.

> **UX-DR7** — "Persistent ask field on the dashboard — submitting navigates to the Oracle with the
> question already sent, no intermediate empty state. Must not overlay focusable content; reserves
> scroll padding if sticky."

> **EXPERIENCE.md** — "Typing and submitting navigates to the Oracle with the question already sent —
> no intermediate empty state, no second submit. Placeholder text must not imply capabilities the
> catalog cannot serve."

### The two clauses that are easy to skip

**"No intermediate empty state, no second submit."** The obvious implementation navigates to
`/oracle` and lets the Oracle render its empty state while the question is typed in again, or posts
the question from a second form. Both give a board member a moment where the surface is present and
their question is not, and that moment reads as *the app lost it*.

**"Placeholder text must not imply capabilities the catalog cannot serve."** AD-5 fixes the query
catalog, so questions outside it are guaranteed rather than hypothetical — the placeholder is the
single most-read piece of copy in the product and it sets what people try. A placeholder promising
"ask anything about your association" manufactures the most likely daily failure.

### What this story is not

- **Not the Oracle's failure states.** Story 3.7 owns no-catalog-match and service-unavailable as
  distinct, honest surfaces. 3.6b renders honest placeholders for both; 3.7 replaces them.
- **Not the dashboard's other content.** UX-DR10 lists figure blocks, unreviewed findings, a
  quarantine entry point and a register link. Those exist or are other stories'. This adds one field.
- **Not a chat history.** One question, one answer, one provenance row.

## Story

**As** a board member on the dashboard,
**I want** to type a question and be taken straight to its answer,
**So that** asking costs me nothing more than the question.

## Acceptance Criteria

**AC1 — The field is on the dashboard and persistent (UX-DR7, UX-DR10).**
An ask field on the dashboard surface, present without scrolling to find it.

**AC2 — Submitting arrives at the Oracle with the question already sent.**
No intermediate empty state and no second submit. Navigating from the field lands on a surface that
is already resolving the question — which, given 3.6b, means the question reaches `/oracle` as a
search parameter and the turn runs during that render.

**AC3 — It does not overlay focusable content (UX-DR7).**
If sticky, it reserves scroll padding so nothing lands underneath it. Asserted, not eyeballed: a
sticky element covering a link is a link nobody can click, and it is invisible in a screenshot taken
at the top of the page.

**AC4 — The placeholder promises only what the catalog serves.**
It must not imply capabilities AD-5 makes impossible. A test pins the copy against the registered
catalog entries, so a placeholder that outgrows the catalog fails rather than misleads.

**AC5 — An empty question does nothing.**
Submitting blank does not navigate and does not spend a model call. The field says why, or simply
stays put — it must not appear to have worked.

**AC6 — Keyboard and focus (UX-DR9).**
Submittable by keyboard alone, with the focus ring rules the design system fixes: 2px ink with 2px
offset on stone, inverse on ink, never removed, never colour-only.

**AC7 — Tested as a rendered surface.**
Render tests per story 1.6c's harness — jsdom, `@testing-library/react`, per-file opt-in. The
no-intermediate-state claim of AC2 is asserted on where submitting *goes*, not on how it looks.

## Tasks / Subtasks

- [ ] **Task 1 — The field (AC1, AC4, AC6)**
  - [ ] The component, props-driven so its tests need no server — the shape `QueueList` established
        after a server-action import pulled `next-auth` in and broke the suite's ability to load the
        file.
  - [ ] Placeholder copy, and the test that pins it against `ALL_ENTRIES`.
  - [ ] Focus ring and target size from `core/design/tokens.ts`. Do not invent a second version.

- [ ] **Task 2 — Submitting (AC2, AC5)**
  - [ ] Navigate to `/oracle?q=…` — a `GET` form is the whole mechanism, and it is worth preferring
        precisely because it needs no client JavaScript to satisfy AC2.
  - [ ] Blank submits do not navigate. Test that nothing is called and nowhere is reached.

- [ ] **Task 3 — Layout (AC3)**
  - [ ] Scroll padding if sticky. A test that the field does not sit above focusable content.

- [ ] **Task 4 — The gate**
  - [ ] `npm run lint`, `npm run build`, `npm test`, `npx --no-install tsc --noEmit` against the
        8-error baseline. `test:db` and `test:py` only if this touches `app/tools/` or `agent/`,
        which it should not.

## Dev Notes

### A GET form is probably the whole story

`/oracle` already takes `?q=`. A plain `<form action="/oracle" method="get">` with a `name="q"` input
satisfies AC2 exactly — the browser navigates, the question is in the URL, the Oracle renders with it
already asked, and there is no intermediate state because there is no second request to make one.

It also works with JavaScript disabled, is back-button correct, and makes the answer a linkable URL,
which matters for a product whose evidence a board member may want to send to somebody.

**Resist the client component** unless something in the ACs actually needs one. The temptation is
`useRouter().push()`, which buys nothing here and costs the above.

### The placeholder is load-bearing copy

AD-5 means "what can I ask?" has a finite, knowable answer, and the placeholder is where most people
will look for it. `catalog/registry.ts` exports `ALL_ENTRIES`, and each entry now carries a
`description` written for exactly this kind of use (story 3.4 added it). A placeholder derived from,
or tested against, the real catalog cannot promise what the catalog will not serve.

The UX spec's own example of the failure it prevents: *"I can't answer that one. I can look up dues
status, payment history, vendor totals, and invoice comparisons."* Today the catalog holds **one**
entry, `dues_status@1`. A placeholder listing four things would be a lie the first time somebody
tried the other three.

### Learnings that apply directly

- **Story 3.6b**: `fireEvent`, not `@testing-library/user-event` — it is not installed, and a
  dependency to drive two clicks is a dependency somebody maintains. And assert keyboard operability
  as *what an element is* rather than by simulating a keypress jsdom does not translate.
- **Story 1.5d** found four defects after 29 mutations found none, one of which showed "Reading" to a
  treasurer forever. A surface story's defects are states that never resolve.
- **Story 3.5**: an assertion that something is absent cannot tell "correctly excluded" from "never
  seen". A test asserting the field did *not* navigate passes against a component that renders
  nothing at all — assert the positive case in the same breath.

### If this has to be cut

There is not much to cut. If it comes to it, ship the field without the sticky behaviour: a field
that scrolls away still satisfies every clause but "persistent", and AC3 exists only because sticky
positioning is what creates the overlay hazard.

### References

- [Source: epics.md] — UX-DR7, UX-DR9, UX-DR10
- [Source: ux-designs/…/EXPERIENCE.md] — "Ask field" under Component Patterns; the Oracle failure copy
- [Source: 3-6b-ask-and-answer.md] — the Oracle, and `?q=` as its entry
- [Source: app/oracle/page.tsx] — what `?q=` already does
- [Source: catalog/registry.ts] — `ALL_ENTRIES`, and each entry's `description`
- [Source: core/design/tokens.ts] — the focus ring and target sizes

## Dev Agent Record

_To be filled by the dev agent._

## Review Findings

_To be filled by the review._

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-11 | Story created when 3.6b was re-scoped to the Oracle surface alone. Carries UX-DR7 in full. |
