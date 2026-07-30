---
baseline_commit: 137aea96f73c50cee6b48bcc39a8d3bcde7844ae
---

# Story 1.3: Visual foundation

Status: done

## Story

As a board member,
I want every screen to be legible, consistent, and operable without a mouse,
so that I can use this during a meeting, on a laptop, without fighting the interface.

## Acceptance Criteria

**AC1 — The token set is the single source of styling truth**

**Given** the DESIGN.md token set
**When** the visual foundation is implemented
**Then** colors, typography, spacing, radii, and component tokens exist in code as the single source of styling truth
**And** no component defines a color or type value outside the token set

**AC2 — Focus is never invisible**

**Given** any interactive element
**When** it receives keyboard focus
**Then** a visible focus ring is shown using the ink ring on stone grounds
**And** the inverse ring is used on ink grounds, so focus is never invisible against its own background

**AC3 — Contrast is measured, not assumed**

**Given** every token pairing used for text
**When** contrast is measured
**Then** each meets or exceeds 4.5:1
**And** an automated check fails the build if a new pairing falls below it

**AC4 — Light theme only, as a decision**

**Given** the pilot scope
**When** themes are considered
**Then** only the light theme exists, as an explicit decision recorded in DESIGN.md

## Tasks / Subtasks

- [x] **Task 1 — The token set as pure data** (AC: 1, 4)
  - [x] `core/design/tokens.ts` — **pure**, no imports, no I/O. Mirrors the DESIGN.md frontmatter
        exactly: `colors` (12 entries), `typography` (faces + 5 scales + tracking), `rounded`
        (`none`, `slight`), `spacing` (`base`, `row`, `block`, `section`), `components`
        (`margin-tick-width`, `rule-hairline`, `rule-heading`, focus ring width/offset).
  - [x] Values are copied from DESIGN.md verbatim. A drift between the two is the defect this
        story exists to prevent, so **write a test that reads DESIGN.md's frontmatter and asserts
        every colour token matches** — the document stays the specification, the module stays the
        implementation, and neither can move without the other.
  - [x] Export the theme name as a single-member union (`'light'`) so a second theme cannot be added
        without a deliberate type change. AC4 is a decision, and the type should say so.

- [x] **Task 2 — Contrast measurement** (AC: 3)
  - [x] `core/design/contrast.ts` — **pure**. WCAG 2.x relative luminance and contrast ratio:
        - `parseHexColor(hex: string): { r: number; g: number; b: number }`
        - `relativeLuminance(hex: string): number`
        - `contrastRatio(a: string, b: string): number`
  - [x] Implement the sRGB transfer function exactly as WCAG defines it (`c/12.92` below the
        0.03928 threshold, else `((c+0.055)/1.055) ** 2.4`). An approximation here silently
        weakens every downstream assertion.
  - [x] Verify against **known values**, not self-consistency: black on white is 21:1, a colour on
        itself is 1:1, and the ratio is symmetric. Cross-check at least one mid-tone pair against a
        hand-computed figure.
  - [x] Reject malformed input (`TypeError`) rather than returning a plausible number — a silent
        `NaN` would make the AC3 gate pass for a pairing nobody measured.

- [x] **Task 3 — The declared text pairings and the gate** (AC: 3)
  - [x] `core/design/text-pairings.ts` — an explicit list of every `{ foreground, ground }` token
        pair used for text, each with a short `usage` string naming where it appears.
  - [x] `core/design/text-pairings.test.ts` — **this is the automated check AC3 requires.** It
        asserts every declared pairing measures ≥ 4.5:1, and reports the measured ratio in the
        failure message so a contributor sees how far short they fell.
  - [x] It must also assert the **rejected** pairing stays rejected: DESIGN.md records that the
        direction's original brass `#A47E3B` measured ≈2.9:1 and was rejected for text. Encode that
        as a test so nobody reintroduces it believing it was an oversight.
  - [x] Guard against a vacuous gate: assert the pairing list is non-empty and covers every colour
        token that is used for text.

- [x] **Task 4 — Tokens reach the DOM without a second source of truth** (AC: 1)
  - [x] Render CSS custom properties from `core/design/tokens.ts` in `app/layout.tsx`
        (`:root { --color-ink: …; … }`). **Do not hand-write a parallel CSS file** — two lists of
        the same values is precisely the drift AC1 forbids.
  - [x] A test asserting the generated CSS contains a custom property for every token, so a token
        added to the module cannot silently fail to reach the DOM.

- [x] **Task 5 — Focus ring, both grounds** (AC: 2)
  - [x] `:focus-visible` uses `2px solid {colors.ink}` with `2px` offset on stone and stone-raised
        grounds.
  - [x] **On ink grounds the ring uses `{colors.on-ink}`.** DESIGN.md is explicit that an ink ring
        on an ink field is invisible and that this is "a conformance failure, not a cosmetic one".
        Provide a documented mechanism — an `.on-ink` ground class that flips the ring colour — and
        apply it wherever an ink ground exists.
  - [x] The ring is never removed and never relies on colour alone (it is an outline with offset).

- [x] **Task 6 — Migrate the existing surfaces off literals** (AC: 1)
  - [x] `app/sign-in/page.tsx` and `app/dashboard/page.tsx` currently inline literal hex values with
        a comment saying this story replaces them. Replace every one with `var(--…)`.
  - [x] Remove the now-duplicated focus-ring `<style>` added in Story 1.2 in favour of the token-driven
        rule from Task 5.

- [x] **Task 7 — The no-raw-values check** (AC: 1)
  - [x] A test that scans `app/` for raw colour literals (hex, `rgb(`, `hsl(`) and named font
        families, and fails on any occurrence outside `core/design/`.
  - [x] It must **prove it can fail**: the sensitivity check in Step 9 applies here specifically,
        since a scanner with a broken pattern silently passes forever.
  - [x] Scope it honestly — scan the files a developer writes, not build output or vendored code.

- [x] **Task 8 — Record the light-theme decision** (AC: 4)
  - [x] DESIGN.md already records it under *Colors* → "Light-only for the pilot… This is a decision,
        not an omission." **Do not restate it in a second place** where it can drift. Reference it
        from the token module and let the single-member theme type carry it in code.
  - [x] Add no `prefers-color-scheme` handling. Its absence is the decision.

- [x] **Task 9 — Gates**
  - [x] `npm run lint`, `npm run build` (no Supabase env), `npm test`, `npx tsc --noEmit` all clean.

## Dev Notes

### Scope boundaries

- **No new surfaces.** Story 1.3 is a foundation, not a screen. The dashboard stays the placeholder
  Story 1.2 left; the figure blocks, ask field and findings list are Epic 3 and later stories.
- **No component library.** The components DESIGN.md names — margin tick, figure block, finding row,
  evidence table, query disclosure, ask field, export control — are *specified* here as tokens only.
  Building them without a surface that needs them is speculative work; each arrives with its story.
- **No dark theme, no theme switching, no `prefers-color-scheme`.** See AC4.
- **No CSS framework.** DESIGN.md's whole register is "a rule and more space"; a utility framework
  would add a second vocabulary competing with the token set.

### Why the contrast check is the load-bearing part

AC3 is the only acceptance criterion in this story that can fail silently in production. A colour
that reads fine on the implementer's monitor and measures 3.8:1 is a conformance failure nobody
notices until an audit. The check must therefore be a real measurement against the WCAG formula, over
an explicit list of pairings, run in the ordinary suite — not a comment asserting the values were
checked once.

The failure mode to design against is **vacuity**: a pairing list that silently loses an entry, or a
gate that passes because it measured nothing. Task 3's non-emptiness and coverage assertions exist
for that reason, and the same reasoning applies to Task 7's scanner.

### Architectural constraints

| Constraint | Source | What it means here |
| --- | --- | --- |
| Layer direction | Spine §Design Paradigm | `core/design/` is pure: no React, no Next, no `fs`. The *tests* may read files; the modules may not. |
| Tokens are the contract | DESIGN.md §Colors, §Typography | "These spines win over anything visible in any mockup." Where a mockup and DESIGN.md disagree, DESIGN.md wins. |
| Semantic colour is not an accent | DESIGN.md §Colors | `flag`, `brass`, `affirm` encode state and are unavailable for emphasis or decoration. A screen with nothing wrong shows no semantic colour. |
| No shadows, square by default | DESIGN.md §Elevation, §Shapes | `rounded.slight` (2px) only on inline chips and the mono query block. A drop shadow anywhere is a defect. |
| Focus ring on ink grounds | DESIGN.md §Components | Inverse ring using `on-ink`. Explicitly "a conformance failure, not a cosmetic one". |
| Serif/sans split is functional | DESIGN.md §Typography | Serif means a value or a claim; sans means a label or an explanation. Do not mix the assignment. |

### Testing standards

- Vitest, `environment: 'node'`, `*.test.ts` colocated.
- `core/design/*` is pure and tested directly.
- Tests that read DESIGN.md or scan `app/` must resolve paths from the repository root
  (`import.meta.url` + `git rev-parse --show-toplevel`), not `process.cwd()` — Story 1.2's review
  found exactly that defect in the NFR-2 guard, and the same shape would silently scan nothing here.

## Project Structure Notes

```text
core/design/
  tokens.ts                 # NEW — pure; the token set
  tokens.test.ts            # NEW — asserts parity with DESIGN.md frontmatter
  contrast.ts               # NEW — pure; WCAG relative luminance and ratio
  contrast.test.ts          # NEW — known-value verification
  text-pairings.ts          # NEW — declared text pairings
  text-pairings.test.ts     # NEW — the AC3 gate
  no-raw-values.test.ts     # NEW — the AC1 scanner
app/
  layout.tsx                # UPDATE — renders custom properties + both focus rings
  sign-in/page.tsx          # UPDATE — literals to var(--…)
  dashboard/page.tsx        # UPDATE — literals to var(--…)
```

## References

- Story statement and acceptance criteria: [Source: _bmad-output/planning-artifacts/epics.md#Story 1.3: Visual foundation]
- Token values, contrast obligations, light-only decision: [Source: .../ux-designs/.../DESIGN.md#Colors]
- Typography roles and the serif/sans split: [Source: .../DESIGN.md#Typography]
- Focus ring on both grounds: [Source: .../DESIGN.md#Components]
- Accessibility floor (colour never sole channel, visible focus): [Source: .../EXPERIENCE.md#Accessibility Floor]
- Layer purity: [Source: .../ARCHITECTURE-SPINE.md#Design Paradigm]

## Dev Agent Record

### Agent Model Used

claude-opus-5[1m] (Claude Opus 5, 1M context) — `bmad-dev-tdd`

### Test Design

Three behaviors carry logic. The token set itself is data, but data that must not drift from its
specification, so it gets a parity test rather than a unit test.

#### Behavior A — contrast measurement

| # | Failure mode | Class | Test |
| --- | --- | --- | --- |
| A1 | **The sRGB transfer function is approximated**, weakening every downstream assertion in the passing direction | GUARD | `uses the linear branch for very dark channels` — `#050505` sits below the 0.03928 threshold, so an implementation applying the power curve everywhere passes every other test and fails this one |
| A2 | The luminance coefficients are transposed | GUARD | The three primaries measure exactly 0.2126 / 0.7152 / 0.0722 |
| A3 | A malformed colour returns a plausible number, so a gate passes on something nobody measured | GUARD — `TypeError` | Seven malformed inputs plus a non-string |
| A4 | Argument order changes the answer | GUARD | Symmetry asserted directly |
| A5 | Shorthand hex mis-expanded | GUARD | `#abc` → `#aabbcc` |
| A6 | The ratio drifts silently | GUARD — cross-check | `#767676` on white is the canonical just-above-4.5:1 case; `#777777` must fall below |

*Cross-check:* black-on-white at exactly 21:1 and the `#767676` boundary pair are values derived
outside this module, so a self-consistent but wrong implementation cannot pass.

#### Behavior B — token parity

| # | Failure mode | Class | Test |
| --- | --- | --- | --- |
| B1 | **A token value drifts from DESIGN.md** — the defect this story exists to prevent | GUARD | Four blocks compared with `toEqual`, so an added, removed or changed token fails |
| B2 | The parity test reads nothing and passes vacuously | GUARD | `reads the DESIGN.md frontmatter at all` |
| B3 | A token exists in the module but never reaches the DOM | GUARD | The `:root` block must contain every generated property |
| B4 | Two tokens collide on one custom-property name | GUARD | Uniqueness asserted |
| B5 | A second theme is introduced by accident | GUARD | Single-member type, plus a scan asserting no `prefers-color-scheme` anywhere |

The `components` block is compared field-by-field rather than wholesale: DESIGN.md writes the focus
ring as one descriptive string for a designer, while the code needs width and offset separately.
That divergence is deliberate and is itself asserted.

#### Behavior C — the contrast gate

| # | Failure mode | Class | Test |
| --- | --- | --- | --- |
| C1 | **The pairing list is empty or loses an entry, so the gate measures nothing** | GUARD | Non-emptiness, plus coverage of every colour token used for text |
| C2 | A pairing names a token that does not exist | GUARD | Every foreground and ground checked against the token set |
| C3 | A rejected colour is reinstated from a mockup | GUARD | `#A47E3B` asserted still below the floor, and asserted absent from the token set |
| C4 | A failure does not say which screen broke | GUARD | Every pairing carries a `usage` string, asserted non-empty; the measured ratio appears in the failure message |
| C5 | Duplicate pairings inflate apparent coverage | GUARD | Uniqueness asserted |

#### Behavior D — the no-raw-values scanner

Its own failure mode is **a broken pattern that matches nothing and passes forever**. Guarded four
ways: seven positive fixtures asserting each literal form is still detected, four negative fixtures
asserting custom properties are not flagged, a non-empty file-list assertion, and a live sensitivity
check.

### Debug Log References

**Contrast module:** 27 tests, green on the first run against known WCAG values.

**Token parity:** 14 of 15 green immediately. The one failure was my own test bug — `git grep` exits
1 when it matches nothing, which is the *passing* case, and a non-zero exit throws. Fixed to treat
exit 1 as "no matches" and rethrow anything else, so a genuine git failure cannot be swallowed into
a green test.

**Contrast gate:** all 13 declared pairings cleared 4.5:1 on the first run. One assertion failed —
see the DESIGN.md discrepancy below.

**Scanner:** two false positives on its own first run, both from the font pattern. The `\s*` after
the colon backtracked past the negative lookahead, so `fontFamily: 'var(--type-serif)'` was flagged
as a raw literal. Rewritten to require a letter after the optional quote, which makes the backtrack
unproductive.

**Sensitivity check.** Injected `color: '#8C2F1E'` into `app/dashboard/page.tsx`; the scanner failed
with `app/dashboard/page.tsx:72 (colour)` and the offending line. Restored; 13 passed.

**Final gates:** `npm run lint` clean, `npx tsc --noEmit` clean, `npm run build` clean with no
Supabase environment, **312 tests passing across 11 files**.

### Completion Notes List

**A discrepancy in DESIGN.md that needs a decision.** DESIGN.md states measured contrast against
stone as "ink ≈ 12.4:1, flag ≈ 7.9:1, brass ≈ 5.2:1". Measured here:

| Pairing | DESIGN.md | Measured | Delta |
| --- | --- | --- | --- |
| ink on stone | 12.4 | **12.64** | +0.24 |
| flag on stone | 7.9 | **6.54** | **−1.36** |
| brass on stone | 5.2 | **5.62** | +0.42 |

`flag` is materially off. The implementation is the trustworthy side — it reproduces black-on-white
at exactly 21:1, the three WCAG channel coefficients exactly, the sub-threshold linear branch, and
the canonical `#767676` boundary, and I recomputed `flag` on `stone` by hand at 6.54. **Nothing is
out of conformance:** 6.54 clears the 4.5:1 floor comfortably, so no colour needs changing. But the
document's figure is wrong and the next person to read it will trust it. The test pins the measured
values with the divergence documented inline. Correcting DESIGN.md is an edit to a planning artifact
and is left as the user's call rather than made unilaterally.

**Tokens are generated into the DOM, not hand-mirrored.** `app/layout.tsx` renders the `:root` block
from `core/design/tokens.ts`. A hand-written CSS file listing the same values would be a second
source of truth, which is the drift AC1 forbids — so there isn't one.

**The focus ring covers both grounds.** `:focus-visible` uses the ink ring; `.on-ink` flips it to
`on-ink`. DESIGN.md is explicit that an ink ring on an ink field is "a conformance failure, not a
cosmetic one", so the inverse ships now as a mechanism rather than when the masthead first needs it —
the alternative is a surface shipping without it and nobody noticing.

**Both existing surfaces migrated.** Sign-in and the dashboard carry zero colour or font literals,
and the scanner enforces it. Story 1.2's local focus-ring `<style>` was removed in favour of the
token-driven rule.

**Out of scope, deliberately:** no components were built. DESIGN.md names seven — margin tick, figure
block, finding row, evidence table, query disclosure, ask field, export control — and each arrives
with the story that needs it. Building them against no surface would be speculative. The one
exception is a two-line `.figure` base rule, which encodes the tabular-numerals obligation the money
convention depends on.

**AC4 carries no second copy.** The light-only decision stays recorded in DESIGN.md alone; the code
expresses it as a single-member `Theme` type plus an asserted absence of `prefers-color-scheme`.
Restating the reasoning elsewhere would create something that can drift.

### File List

- `core/design/tokens.ts` (new)
- `core/design/stylesheet.ts` (new)
- `core/design/stylesheet.test.ts` (new)
- `core/design/tokens.test.ts` (new)
- `core/design/contrast.ts` (new)
- `core/design/contrast.test.ts` (new)
- `core/design/text-pairings.ts` (new)
- `core/design/text-pairings.test.ts` (new)
- `core/design/no-raw-values.test.ts` (new)
- `app/layout.tsx` (modified — renders tokens, base rules, both focus rings)
- `app/sign-in/page.tsx` (modified — literals to custom properties)
- `app/dashboard/page.tsx` (modified — literals to custom properties)
- `_bmad-output/implementation-artifacts/1-3-visual-foundation.md` (new)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)

### Local Code Review (AI) — 2026-07-30

Two adversarial layers ran against `137aea9..a947de2`. Both independently confirmed the contrast
mathematics is correct — one re-derived WCAG luminance from the specification and reproduced every
figure — and both then found that **the gates built on top of it were vacuous in four places**. The
story's own thesis is that vacuity is the failure mode to design against, so this was the right
finding to get.

**Fixed — critical:**

- [x] **The commit was red, and the story claimed 312 passing.** The "no `prefers-color-scheme`
      handling" guard ran `git grep` over `core/`, and `core/design/tokens.ts` contains a docstring
      saying the absence of that handling *is* the decision — so the guard matched its own
      documentation. It passed while the files were untracked (git grep only searches tracked
      files) and went red the instant they were committed. **My claim of a clean gate was verified
      before the commit and not re-verified after it, which is exactly the check that mattered.**
      Replaced with a filesystem walk scoped to `app/` and `adapters/`, where CSS and runtime
      behaviour actually live. Verified green with the files tracked.

**Fixed — the gates that were not gating:**

- [x] **The AC1 scanner never opened `app/layout.tsx`** — the one file holding every CSS rule this
      story added. The `app/**/*.tsx` git pathspec, without `:(glob)` magic, requires a literal
      directory segment, so it matched only nested files. `git ls-files -- 'app/**/*.tsx'` returned
      2 of 4 files. The "scans at least one file" guard was satisfied by the two it did see, and my
      own sensitivity check happened to use a nested file, so neither caught it. Replaced with a
      directory walk, and a test now asserts `app/layout.tsx` and `app/page.tsx` are among the
      scanned files by name. Verified by injecting a hex into `layout.tsx` — previously invisible,
      now reported.
- [x] **The scanner enforced "no hex, rgb, hsl" while AC1 says "no color".** `background: 'white'`,
      `rebeccapurple`, `oklch()`, `lab()`, `hwb()`, `ButtonText` and the `font:` shorthand all sailed
      through. The seven positive fixtures tested exactly what the pattern was written to catch,
      which is self-fulfilling rather than adversarial. Now covers named and system colours, every
      modern colour function, and the shorthand — 18 detection fixtures against 11 no-false-positive
      fixtures.
- [x] **The scanner also cried wolf**, flagging `// see issue #1234`, `href="#section"` and CSS id
      selectors as colours. Hex matching is now anchored to value position (after a `:`), which is
      what distinguishes a colour from a fragment identifier.
- [x] **No test asserted the tokens reach the DOM**, despite a test named for exactly that — it
      asserted on the string a generator returns, and nothing imported `app/layout.tsx`. Deleting
      the `<style>` element would have left all 312 tests green and every screen unstyled, since the
      migration moved background, colour and font onto `body`. The stylesheet moved to a pure
      `core/design/stylesheet.ts`, and `stylesheet.test.ts` asserts both its content and that the
      layout renders it.
- [x] **AC2 had no test of any kind.** Now covered: the ink ring is built from the token width and
      offset, `.on-ink` inverts it, the outline is never removed, and a regression test asserts the
      selector is *not* a descendant selector.
- [x] **The AC3 gate measured a hand-written list disconnected from what the screens render.**
      `ink` on `on-ink` — live on the only interactive surface in the product — was absent from it.
      Added, and a new test extracts every `--color-*` the surfaces reference and asserts each one
      appears in a declared pairing. It is a coarse link rather than a style graph, and says so.

**Fixed — correctness and honesty:**

- [x] **A code comment cited a hand-verification of `flag` that was not in the tree.** The
      conclusion was right (6.54, recomputed) but the citation pointed at a test that did not exist,
      which is the more dangerous combination — a reader follows the pointer, finds nothing, and
      cannot tell which half to distrust. `contrast.test.ts` now carries the pairing with the full
      arithmetic worked through in the comment.
- [x] **`.on-ink :focus-visible` was a descendant selector**, so it would have painted a white ring
      on any nested stone panel — 1.26:1, invisible — which is the precise failure the rule exists
      to prevent. Narrowed to the element itself and its direct children, with a `.on-stone` reset
      for nested grounds.
- [x] **The migration shrank the sign-in footnote from 13px to 11px.** The token set has no 13px
      step and the value was snapped to `scale-label`, which is DESIGN.md's *uppercase tracked
      label* size — applied to running prose, in a story about legibility. Moved to `scale-body`.
- [x] **`components` parity was one-directional**, the one block where the code deliberately
      diverges and therefore the one place the weakest assertion should not have been. Now
      bidirectional, and the focus-ring derivation is matched positionally rather than by two
      `toContain` checks that are indistinguishable while width and offset are both `2px`.
- [x] **The DESIGN.md reader was unbounded by the frontmatter fences**, so a ```yaml sample in the
      prose — an ordinary edit to a design document — would have been parsed as the token source,
      satisfying the anti-vacuity guard on prose. Now bounded, and strict: double quotes, trailing
      comments and blank lines are handled, and a nested map throws rather than flattening.
- [x] **Both gates shelled out to `git rev-parse` at module scope**, so they failed to import
      wherever git or `.git` is absent — a Docker stage that copies only source, a tarball. Replaced
      with a walk up to `package.json`.
- [x] **The scanner reported one offence per line**, hiding a font violation behind a colour one
      until the first was fixed. Both are reported now.
- [x] Removed `.figure`, which had no consumer — the Completion Notes argued against speculative
      components and then shipped one.
- [x] The `<style>` element now carries `href` and `precedence` so React 19 hoists it into `<head>`;
      it was rendering inside `<body>`, an HTML conformance error that also inverted the cascade
      order the token layer assumes.

**Found by the new gate, and needing a decision — a second DESIGN.md problem:**

The moment the "every used colour is measured" test existed, it caught `--color-rule-strong`, used
for input and button borders and measured by nothing. Measuring it:

| Boundary pairing | Measured | SC 1.4.11 floor |
| --- | --- | --- |
| `rule-strong` on `stone` | **2.13:1** | 3:1 |
| `rule-strong` on `stone-raised` | **2.40:1** | 3:1 |

DESIGN.md §Components specifies `rule-strong` as the hairline border for controls, and at those
values it **fails WCAG 2.2 SC 1.4.11**, which governs the visual information that identifies a user
interface component. The white field ground does not rescue it: white against stone-raised is about
1.07:1, so the border is doing essentially all the work of saying "this is an input".

This cannot be fixed from code without either changing a token (breaking parity with DESIGN.md) or
ignoring the component specification, so it is **recorded as a pinned exception rather than silently
tolerated or unilaterally patched**. `KNOWN_NON_TEXT_GAPS` holds both pairings with their measured
values; if the palette changes, the pin fails and whoever changed it must delete the exception. An
exception nobody is forced to revisit becomes permanent.

**Accepted, not fixed:**

- **`on-ink` is used as the input background.** The token names a foreground — the colour text takes
  *on* an ink ground — and the migration reached for it because it equalled the `#FFFFFF` literal
  being replaced. The palette has no `paper`/`field` token, and inventing one would break DESIGN.md
  parity. The pairing is now measured (15.97:1). Recorded as a token-vocabulary gap for the designer.
- **The used-colour test is coarse.** It proves every referenced colour appears in some pairing, not
  that each rendered foreground/ground combination was measured. A precise version needs a style
  graph. The comment says so rather than implying more.
- **`ink-muted` on `stone` has 0.21 of headroom** (4.71:1) and is the tightest pairing in the set —
  and the one DESIGN.md's own "Contrast obligations" paragraph does not measure. Pinned by name and
  value so any narrowing is a visible decision rather than a surprise red build.

Final state after review fixes: **352 tests passing** across 12 files; `npm run lint`,
`npx tsc --noEmit` and `npm run build` all clean, verified with the files tracked.

### Change Log

| Date | Change |
| --- | --- |
| 2026-07-30 | Local adversarial review: the committed suite was red (a guard matching its own documentation once tracked); the AC1 scanner was blind to app/layout.tsx and to every non-hex colour form; no test asserted the tokens reach the DOM; AC2 had no test at all; the AC3 gate was disconnected from what the surfaces render. All fixed. The new used-colour gate then caught rule-strong control borders failing SC 1.4.11 at 2.13:1 -- recorded as a pinned exception for a design decision. |
| 2026-07-30 | Visual foundation: the DESIGN.md token set as pure data with a parity test against the document itself; WCAG contrast measurement verified against known values; an automated gate over every declared text pairing; focus ring on both stone and ink grounds; a scanner forbidding raw colour and font literals in application surfaces; both existing surfaces migrated off literals. |
