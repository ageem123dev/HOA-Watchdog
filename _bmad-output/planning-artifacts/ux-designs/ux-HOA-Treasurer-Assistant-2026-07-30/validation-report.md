# Validation Report — AI Condo Treasury Bot (Fiduciary Watchdog)

- **DESIGN.md:** `_bmad-output/planning-artifacts/ux-designs/ux-HOA-Treasurer-Assistant-2026-07-30/DESIGN.md`
- **EXPERIENCE.md:** `_bmad-output/planning-artifacts/ux-designs/ux-HOA-Treasurer-Assistant-2026-07-30/EXPERIENCE.md`
- **Run at:** 2026-07-30
- **Lenses:** rubric walker, accessibility (WCAG 2.2 AA)

> **Method note.** Both lenses were run **inline by the facilitator**, not dispatched as
> independent parallel subagents, per a standing instruction in this session. A lens's value comes
> partly from arriving at the work fresh; these did not. Treat the findings as a self-review — real,
> but less independent than the design intends.

## Overall verdict

The pair commits its load-bearing decisions and a downstream consumer could extract most of what
it needs. Two categories were genuinely weak on first pass: **state coverage**, where four of eight
IA surfaces had no states at all, and **flow coverage**, which omitted the single most likely daily
failure — a question the fixed query catalog cannot answer.

The accessibility lens found the colour work sound and unusually well-evidenced, but caught that
the spine claimed **2.2** AA while addressing mostly **2.1** criteria. Three criteria new in 2.2
were unmentioned, including Target Size, which is expensive to retrofit.

**All critical and high findings were resolved before close.** Six medium and four low findings
were also resolved; the remaining open items are recorded in EXPERIENCE.md → Open Items.

## Category verdicts

| Category | Verdict (first pass) | After resolution |
| --- | --- | --- |
| Flow coverage | thin | resolved — failure branches added to both key flows |
| Token completeness | adequate | resolved — light-only committed explicitly |
| Component coverage | adequate | resolved — figure block and export control now specified in both spines |
| State coverage | thin | resolved — 10 states added across 5 surfaces |
| Visual reference coverage | broken | resolved — mockups linked, precedence stated |
| Bloat & overspecification | adequate | accepted as-is (see below) |
| Inheritance discipline | thin | resolved — glossary mapping declared |
| Shape fit | strong | improved — Inspiration & Anti-patterns added |

## Findings by severity

### Critical (1)

**[Flow / State coverage]** — No state or flow for a question the catalog cannot answer
(EXPERIENCE.md § Key Flows, § State Patterns)
AD-5 fixes the query catalog, so a user asking outside it is guaranteed rather than possible — and
in UJ-2 it happens in front of a hostile room. Nothing specified what David would see.
**Resolved:** added an `Oracle — no catalog match` state and a failure branch on the David flow.
The system names what it cannot do and offers the nearest supported question in one breath, never
improvising or silently answering something narrower.

### High (6)

**[Flow coverage]** — Neither key flow had a failure path. **Resolved:** Sarah's flow branches at
extraction failure, with the no-partial-data rule made explicit.

**[Token completeness]** — No dark theme, and no statement that its absence was intentional.
**Resolved:** light-only committed as a decision with rationale, flagged as facilitator-made and
cheaply reversible.

**[State coverage]** — Four surfaces had no states: Finding detail, Reviewed register, Access log,
Sign-in. **Resolved:** states added for the first three; sign-in remains an acknowledged open item.

**[Visual reference coverage]** — Neither spine linked any visual reference or stated
spines-win-on-conflict. **Resolved:** both linked, precedence stated.

**[Inheritance discipline]** — Glossary divergence: spines said *finding*, PRD says *alert*,
architecture models `ALERT`, and one section used two of them. **Resolved:** explicit three-layer
mapping table declared in Voice and Tone.

**[Accessibility — 2.4.11 Focus Not Obscured]** — The persistent ask field could hide focus from a
keyboard user tabbing the findings list. **Resolved:** specified that it must not overlay focusable
content, with scroll padding if sticky.

**[Accessibility — focus ring]** — The single ink focus ring is invisible on the ink masthead.
**Resolved:** inverse ring on ink grounds using `on-ink`, which was previously declared and unused.

### Medium (7)

- **Component coverage** — `Figure block` had no behavioural spec. *Resolved:* specified as non-interactive with a mandatory "as of" date.
- **Component coverage** — `Export control` had no visual spec. *Resolved:* added.
- **Accessibility — 2.5.8 Target Size** unspecified. *Resolved:* 24×24 CSS px, 44×44 on phone.
- **Accessibility — 3.3.8 Accessible Authentication** unaddressed. *Resolved:* recorded as binding on whoever designs sign-in.
- **Accessibility — severity text unspecified** while being required. *Resolved:* "Needs review" / "Worth checking", in the plain register the Voice section demands.
- **Shape fit** — `Inspiration & Anti-patterns` missing though triggered. *Resolved:* added, capturing three rejected directions and the excluded architecture-run renderings.
- **State coverage** — no Oracle service-failure state, distinct from no-catalog-match. *Resolved:* added.
- **Accessibility — reflow under-specified.** *Partially resolved:* recorded as an open item to settle when the register mock is built.

### Low (4)

- Declared-but-unreferenced tokens (`on-ink`, `spacing.base`). *Resolved:* `on-ink` now carries the inverse focus ring; `spacing.base` retained as the scale root.
- Quarantine flow has no climax beat. *Accepted* — a four-step utility flow does not need one.
- Text spacing (1.4.12). *Resolved:* row heights flex.
- No print treatment. *Resolved:* print named as a supported output for register and finding detail.

### Accepted without change (1)

**[Bloat]** — EXPERIENCE.md carries editorial voice in a few places, which the spec reserves for
DESIGN.md. Kept deliberately: the lines carrying it ("a table that scrolls sideways in a meeting is
a table nobody reads") encode *why* a rule exists, and this contract will be read by story authors
who did not attend the design conversation.

## Reviewer files

- `review-rubric.md`
- `review-accessibility.md`

## Not produced

The HTML twin of this report (`validation-report.html`) was **not rendered**. The synthesis
pipeline calls for both; this Markdown twin carries the full content, and the HTML was skipped to
keep the session focused on the spines and mocks. Say the word and I'll render it.
