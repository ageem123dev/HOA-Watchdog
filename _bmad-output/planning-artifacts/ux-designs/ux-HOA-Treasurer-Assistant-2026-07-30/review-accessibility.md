# Accessibility Review — AI Condo Treasury Bot (Fiduciary Watchdog)

Lens: WCAG 2.2 AA, the floor the spine itself declares. Regulated stakes.

## Overall verdict

The colour work is sound and unusually well-evidenced — ratios are measured, stated, and one
token was already rejected for failing. The gap is that the spine claims **2.2** AA while
addressing mostly **2.1** criteria: three of the criteria 2.2 added are unmentioned, and one
of them (Target Size) is the kind of thing that gets retrofitted expensively. Non-visual
semantics on the evidence tables are specified well, which matters most given those tables are
the artifact read aloud in a dispute.

## Findings

- **high** **2.4.11 Focus Not Obscured (Minimum)** — new in 2.2, unaddressed. The ask field is specified as *persistent* on the dashboard. If it is implemented as sticky, a keyboard user tabbing down the findings list can move focus behind it, which fails outright. (EXPERIENCE.md § Component Patterns → Ask field.) *Fix:* specify that the persistent ask field must not overlay focusable content, or reserve scroll padding.

- **high** **Focus ring is specified for one ground only.** `{components.focus-ring}` is `2px solid #14213D` — ink on stone reads ≈ 12.4:1, but on the ink masthead field it is invisible against itself. The masthead contains at least the account control. (DESIGN.md § Components.) *Fix:* define an inverse focus ring for ink-ground surfaces using `{colors.on-ink}`, which is currently declared and unused.

- **medium** **2.5.8 Target Size (Minimum)** — new in 2.2, unspecified. No minimum interactive target is stated anywhere. The finding row is specified as fully clickable, which is good, but the query disclosure toggle and export controls have no size floor. (Both spines.) *Fix:* state 24×24 CSS px minimum, or 44×44 for the phone surface.

- **medium** **3.3.8 Accessible Authentication (Minimum)** — new in 2.2, unaddressed. Sign-in is acknowledged as unelicited, but this criterion prohibits cognitive-function tests without an alternative. Inheriting Supabase auth does not discharge it. (EXPERIENCE.md § Open Items.) *Fix:* note the constraint so it binds whoever designs sign-in.

- **medium** **The reflow treatment is asserted but not specified.** "Stacked label/value groups, one record per group" is the right instinct, and reflow (1.4.10) is where financial tables usually fail — but a story author cannot build a compliant table from that sentence. Which column becomes the group heading? What happens to a 6-column dues history? (EXPERIENCE.md § Responsive & Platform.) *Fix:* specify the transform per table type, or mock it.

- **medium** **Severity is text + tick, but the text is unspecified.** § Accessibility Floor requires every tick be paired with a text label; nothing states what the labels are. "High/Medium" is a system register, and the spine's own Voice section forbids that. (EXPERIENCE.md § Accessibility Floor.) *Fix:* define the visible severity vocabulary in plain language.

- **low** **1.4.12 Text Spacing** unaddressed. Dense ruled rows with fixed heights are the usual failure. *Fix:* state that row heights flex.

- **low** **No reduced-data or print stylesheet**, though the register's whole purpose is producing a board-packet export. Print is not a WCAG criterion but is an access concern for this specific audience — some directors will read on paper. *Fix:* note print as a supported output.

## What is already strong

- Contrast measured and stated per combination, with a token **rejected on evidence** rather than adjusted quietly.
- Colour never the sole channel — stated as a rule, not an aspiration.
- Real table semantics required, with a rationale tied to the dispute scenario.
- Live regions specified for both long operations.
- Currency announced as currency.
- `prefers-reduced-motion` respected, and motion limited to functional transitions.
