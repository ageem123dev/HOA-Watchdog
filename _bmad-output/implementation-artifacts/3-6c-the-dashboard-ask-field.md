---
baseline_commit: 9b2902f
---

# Story 3.6c: The dashboard ask field

Status: in-progress

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

- [x] **Task 1 — The field (AC1, AC4, AC6)**
  - [x] The component. It needed **no props at all** — a plain form has nothing to inject, so the
        `QueueList` shape was not required. Not a client component either.
  - [x] Placeholder copy, pinned against `ALL_ENTRIES`: the test fails when the catalog gains or
        loses an entry, which is what makes the copy unable to outgrow it silently.
  - [x] Focus ring inherited from `BASE_CSS`'s global `:focus-visible`, with a test that this
        surface does not override `outline`. Target 44px on both dimensions for both controls,
        exceeding the 24x24 the spec sets for desktop and matching what it asks of the phone surface.
        The test pins the 24x24 the criterion actually requires.
  - [x] A real `<label>`, because a placeholder disappears the moment somebody types.

- [x] **Task 2 — Submitting (AC2, AC5)**
  - [x] `<form action="/oracle" method="get">` with the field named `q`. No client JavaScript, so
        AC2 holds by construction — there is no second request that could make an intermediate state.
  - [x] Blank submits do not navigate: `required` plus `pattern` refuse empty *and* whitespace-only
        before any navigation, with JavaScript disabled. Asserted via `checkValidity`, which is the
        real mechanism, plus the positive case in the same breath.

- [x] **Task 3 — Layout (AC3)**
  - [x] Not sticky, which is the story's own fallback and removes the overlay hazard rather than
        managing it. A test asserts the form is not positioned, so making it sticky later fails here
        and whoever does it owes the scroll padding.

- [x] **Task 4 — The gate**
  - [x] lint 0 errors, build clean, 2098 tests across 110 files, tsc at its 8-error baseline.
        `test:db` and `test:py` correctly not run — this touches neither `app/tools/` nor `agent/`.

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

### Test Design — failure modes, written before any code

**B1 — The field exists on the dashboard and is reachable.**
| Failure mode | Class | Note |
| --- | --- | --- |
| Rendered below the findings list, so keyboard users traverse every finding to reach it | GUARD | EXPERIENCE.md: "reachable by keyboard from the top of the dashboard without traversing every finding" |
| Sticky positioning overlays focusable content | GUARD | WCAG 2.4.11; AC3 |
| Focus ring removed or overridden locally | GUARD | The ring is global in `BASE_CSS`; the only way to break it here is to override `outline` |
| Target below 24x24 CSS px | GUARD | Both dimensions — story 3.6b shipped with only the height pinned |
| Placeholder used as the only label | GUARD | A placeholder disappears on input, leaving a screen reader with no accessible name |

**B2 — Submitting arrives at the Oracle with the question already sent.**
| Failure mode | Class | Note |
| --- | --- | --- |
| Client-side `router.push` produces an intermediate empty state | GUARD | AC2's actual claim. A plain GET form cannot produce one — there is no second request to make it |
| The question is not URL-encoded, so `&` or `#` truncates it | GUARD | The browser encodes a GET form's fields; building the URL by hand is what breaks this |
| Input named something other than `q` | GUARD | `/oracle` reads `?q=`; any other name renders the empty state and looks like the app lost the question |
| Question longer than the Oracle accepts | OUT-OF-SCOPE | `questionFrom` truncates at `MAX_QUESTION_LENGTH`, added in 3.6b |

**B3 — An empty question does nothing.**
| Failure mode | Class | Note |
| --- | --- | --- |
| Blank submit navigates to `/oracle?q=`, showing the empty state — it *appears* to have worked | GUARD | AC5 |
| Whitespace-only passes a naive emptiness check | GUARD | `required` alone accepts `"   "` |
| The guard is JavaScript-only, so it does not hold without JS | GUARD | Solved by `required` + `pattern`, which are the browser's own |

**B4 — The placeholder promises only what the catalog serves.**
| Failure mode | Class | Note |
| --- | --- | --- |
| Copy names capabilities AD-5 makes impossible | GUARD | The UX spec's own example lists four; the catalog holds **one** |
| Copy silently outgrows the catalog as entries are added or removed | GUARD | AC4 wants a test that *fails* when this happens |

### The probe that decided the design

Whether AC5 could be met without JavaScript turned on whether jsdom implements constraint
validation. It does: `required` plus `pattern` refuses `""` and `"   "` and accepts a real question.
So the whole surface is a plain GET form and no client component — which also satisfies AC2 by
construction, since there is no second request that could produce an intermediate state.

**The pattern is `.*\S.*`, and the corruption is detected rather than dodged.** *(Revised after
the Argus round — the first version of this section claimed the opposite, and was wrong.)*

The first probe used `.*\S.*` and the attribute arrived as `.*S.*`: the backslash eaten in transit,
exactly as `\b` was on story 3.5. The cause was found during this story — a command string loses one
level of backslash escaping before the shell sees it, so `\\S` reaches the file as `\S`, and
JavaScript then reads `'\S'` as `'S'`. **The same corruption hit this very paragraph**: the `\b`
above was written as a literal backspace character until the Argus round caught the section. Anything
carrying a backslash is now written with the editing tool rather than through a shell heredoc.

The first response was to avoid backslashes entirely, with `.*[^ ].*`. **That traded a correctness bug
for a tooling inconvenience**, and Argus caught it: `[^ ]` excludes only U+0020, so a pasted tab or
non-breaking space passed validation, navigated, and reached an Oracle that trimmed the question back
to empty and showed its empty state — the "appears to have worked" AC5 forbids.

A corrupted pattern still compiles and silently matches nothing, which is an argument for a test that
reads the attribute back out of the DOM, not for a weaker pattern. That test compares against a
literal rather than the exported constant, so corruption cannot move both sides together.

## Review Findings

_To be filled by the review._

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-11 | Story created when 3.6b was re-scoped to the Oracle surface alone. Carries UX-DR7 in full. |
| 2026-08-12 | AD-7 amended in this branch: a rejected answer is shown as an honest failure the reader may retry by asking again. Implemented test-first as a plain GET form with no client JavaScript. Seven sensitivity mutations, all caught. |
