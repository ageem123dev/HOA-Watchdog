---
name: 'AI Condo Treasury Bot — Fiduciary Watchdog'
type: design-spine
status: final
created: '2026-07-30'
updated: '2026-07-30'
direction: institutional
sources:
  - docs/prd/prd.md
  - _bmad-output/planning-artifacts/architecture/architecture-HOA-Treasurer-Assistant-2026-07-29/ARCHITECTURE-SPINE.md
companions:
  - EXPERIENCE.md

colors:
  ink: '#14213D'
  ink-muted: '#5A6478'
  stone: '#E5E5E0'
  stone-raised: '#F2F2EE'
  rule: '#C7C7C0'
  rule-strong: '#9E9E96'
  brass: '#6E5426'
  brass-tint: '#EDE3CE'
  flag: '#8C2F1E'
  flag-tint: '#F6E4DF'
  affirm: '#2C5233'
  on-ink: '#FFFFFF'

typography:
  serif: 'ui-serif, Georgia, "Iowan Old Style", "Times New Roman", serif'
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'
  mono: 'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace'
  scale-figure: '1.55rem'
  scale-title: '1.125rem'
  scale-body: '0.9375rem'
  scale-label: '0.6875rem'
  tracking-label: '0.14em'

rounded:
  none: '0'
  slight: '2px'

spacing:
  base: '4px'
  row: '12px'
  block: '24px'
  section: '40px'

components:
  margin-tick-width: '3px'
  rule-hairline: '1px'
  rule-heading: '2px'
  focus-ring: '2px solid #14213D, 2px offset'
---

# Design — Fiduciary Watchdog

## Brand & Style

The register of record, not an app. Every screen should read as a document an association
produced and could hand to an auditor — because several of them literally become that. The
visual register is institutional: hard rules, serif figures, no ornament that isn't carrying
information.

Formality is structural, never verbal. The frame is austere; the words inside it are plain
(see EXPERIENCE.md → Voice and Tone). A board member should feel they are reading something
official without feeling they need a finance background to understand it.

Restraint is the brand. Where a consumer product would add a colour, a pill, or a rounded
card, this adds a rule and more space.

## Colors

| Token | Value | Use |
| --- | --- | --- |
| `{colors.ink}` | `#14213D` | Primary text, headings, figures, the masthead field, focus ring |
| `{colors.ink-muted}` | `#5A6478` | Secondary text, labels, evidence sub-lines |
| `{colors.stone}` | `#E5E5E0` | Page ground |
| `{colors.stone-raised}` | `#F2F2EE` | Raised surfaces — never a shadowed card, only a lighter plane |
| `{colors.rule}` | `#C7C7C0` | Hairline row separators |
| `{colors.rule-strong}` | `#9E9E96` | Table heads, section boundaries |
| `{colors.brass}` | `#6E5426` | Medium-severity margin tick; register and archival affordances |
| `{colors.brass-tint}` | `#EDE3CE` | Brass fills only — nothing may depend on perceiving this alone |
| `{colors.flag}` | `#8C2F1E` | High-severity margin tick, destructive confirmation, error text |
| `{colors.flag-tint}` | `#F6E4DF` | Flag fills only — same constraint as brass-tint |
| `{colors.affirm}` | `#2C5233` | Resolved and reconciled states only. Never a call to action. |

**Contrast obligations.** Measured against `{colors.stone}`: ink ≈ 12.4:1, flag ≈ 7.9:1,
brass ≈ 5.2:1 — all clear the 4.5:1 AA text minimum. The direction's original brass
(`#A47E3B`) measured ≈ 2.9:1 and was **rejected for text and indicator use**; it survives
only as `brass-tint`. Any new colour must be measured before it enters this table.

**Light-only for the pilot.** There is no dark theme. This is a decision, not an omission — the
product is a record read in meetings and on paper, and a second theme would double the contrast
surface for no journey that needs it. Revisit only with a journey that demands it.

**Visual reference:** `mockups/directions-4.html` shows this palette applied to the dashboard,
alongside the three rejected directions. **These spines win over anything visible in any mockup.**

**Semantic colour is not the accent.** Flag, brass and affirm encode state. They are not
available for emphasis, branding, or decoration. A screen with nothing wrong on it shows no
semantic colour at all.

## Typography

| Role | Face | Notes |
| --- | --- | --- |
| Figures and amounts | `{typography.serif}` | Always `font-variant-numeric: tabular-nums`. Money is the most-read content on every screen. |
| Finding titles | `{typography.serif}` | `{typography.scale-title}`, 600 weight |
| Body and evidence | `{typography.sans}` | `{typography.scale-body}`, line-height 1.5 |
| Labels and column heads | `{typography.sans}` | `{typography.scale-label}`, uppercase, `{typography.tracking-label}` |
| SQL, identifiers, hashes | `{typography.mono}` | Query disclosure, invoice numbers, document hashes |

The serif/sans split is functional, not decorative: **serif means a value or a claim; sans
means a label or an explanation.** A reader can tell what kind of thing they are looking at
before reading it. Do not mix the assignment.

Running prose caps at ~65 characters. Headings take `text-wrap: balance`.

## Layout & Spacing

Ruled rows on a single ground. Content sits in one column of findings with figures
right-aligned in a consistent gutter, so amounts form a scannable vertical edge.

Spacing steps: `{spacing.row}` within a row, `{spacing.block}` between blocks,
`{spacing.section}` between sections. Nothing between these values.

Sibling groups use flex or grid with `gap` — never per-element margins.

**Responsive (desktop-primary).** Below 48rem, evidence tables do not scroll horizontally.
They reflow to stacked label/value pairs, one record per group, retaining tabular figures.
This is a designed treatment, not a fallback (see EXPERIENCE.md → Responsive & Platform).

## Elevation & Depth

**There are no shadows.** Depth is expressed by rule weight and ground value only:
`{components.rule-hairline}` separates rows, `{components.rule-heading}` opens a section, and
`{colors.stone-raised}` lifts a plane. A drop shadow anywhere in this product is a defect.

## Shapes

Square by default (`{rounded.none}`). `{rounded.slight}` is permitted only on inline chips
and the mono query block. No pill shapes, no circular avatars beyond the account control,
no rounded cards.

## Components

**Margin tick.** The severity primitive. A `{components.margin-tick-width}` vertical bar in
the row's left gutter: `{colors.flag}` high, `{colors.brass}` medium, none for informational.
Replaces the status pill entirely. **Never the sole carrier of meaning** — every tick is
accompanied by a text severity label for screen readers and for anyone who does not perceive
the colour.

**Figure block.** Label in sans small-caps above, amount in serif at
`{typography.scale-figure}`, tabular. Used for operating balance, reserve, and counts.

**Finding row.** `[tick] [title + evidence line] [amount]`. The evidence line is
`{colors.ink-muted}` sans and states what was compared — it is the finding's justification,
never flavour text.

**Evidence table.** Column heads in sans label style over `{colors.rule-strong}`; body rows
hairline-separated; every numeric column tabular and right-aligned. Carries real table
semantics — see EXPERIENCE.md → Accessibility Floor.

**Query disclosure.** Collapsed by default beneath an evidence table, labelled with the
catalog entry and version. Opens to mono SQL on `{colors.stone-raised}`.

**Ask field.** Persistent on the dashboard, `{colors.stone-raised}` ground with a
`{colors.rule-strong}` bottom rule. Full-width, single line, no placeholder question that
implies capabilities the catalog does not have.

**Export control.** Sans label at `{typography.scale-body}`, ink text over a
`{colors.rule-strong}` hairline border, square. Never a filled button — export is a records
action, not a call to action. Minimum target 24×24 CSS px.

**Focus ring.** `{components.focus-ring}` on stone and stone-raised grounds. **On ink grounds —
the masthead and any inverted surface — the ring uses `{colors.on-ink}` instead.** An ink ring on
an ink field is invisible, which is a conformance failure, not a cosmetic one.

## Do's and Don'ts

**Do** let the amount column form a clean vertical edge — it is how a treasurer scans.
**Do** keep semantic colour absent when nothing is wrong.
**Do** pair every tick with text.

**Don't** add a shadow, a gradient, or a rounded card.
**Don't** use `{colors.affirm}` for a button — green here means reconciled, and a green
button would read as "this is fine" on a screen about money.
**Don't** introduce an accent colour. The palette is complete.
**Don't** let brass-tint or flag-tint carry meaning alone.
