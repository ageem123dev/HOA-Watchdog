# Spine Pair Review — AI Condo Treasury Bot (Fiduciary Watchdog)

## Overall verdict

The pair commits its load-bearing decisions and a downstream consumer could extract most of
what it needs. Two categories are genuinely weak: **state coverage**, where four of eight IA
surfaces have no states specified at all, and **flow coverage**, which omits the single most
likely daily failure — a question the fixed query catalog cannot answer. That omission is
critical because AD-5 guarantees the case will occur, not merely permit it.

## 1. Flow coverage — thin

Checked: PRD sources frontmatter → UJ-1 (Sarah, Treasurer) and UJ-2 (David, President). Both
have Key Flows with verbatim protagonist names, numbered steps, and a climax beat. A third
invented flow covers the AD-8 quarantine confirmation.

### Findings

- **critical** No flow or state covers a question the catalog cannot answer (EXPERIENCE.md § Key Flows, § State Patterns). AD-5 fixes the catalog, so a user asking something outside it is guaranteed, not hypothetical — and it will happen for the first time in front of someone. Nothing specifies what David sees. *Fix:* add a `no-catalog-match` state and a failure branch on the David flow.
- **high** Neither key flow has a failure path (EXPERIENCE.md § Key Flows). Sarah's flow assumes extraction succeeds; the rubric expects a failure branch where applicable, and extraction failure mid-payment-run is exactly where it applies. *Fix:* branch step 2.
- **low** The quarantine flow has no climax beat, unlike the other two. Defensible for a 4-step utility flow but inconsistent.

## 2. Token completeness — adequate

Every token in both frontmatter blocks carries a concrete value; every `{path.to.token}`
reference in prose resolves. Contrast targets are stated for load-bearing combinations, with
measured ratios.

### Findings

- **high** No light/dark pairs; dark theme entirely unspecified (DESIGN.md § Colors). Logged as an open item, but downstream code mirrors the spine and will ship light-only by default. *Fix:* either commit to light-only explicitly as a design decision, or add the dark pairs.
- **low** `colors.on-ink` and `spacing.base` are declared in frontmatter and never referenced in prose. *Fix:* reference or remove.

## 3. Component coverage — adequate

Extracted seven component names across both spines. Five have both a visual spec (DESIGN.md §
Components) and a behavioral spec (EXPERIENCE.md § Component Patterns), with real rules rather
than one-word descriptions.

### Findings

- **medium** `Figure block` has a visual spec but no behavioral spec (DESIGN.md § Components; absent from EXPERIENCE.md § Component Patterns). *Fix:* specify whether figures are interactive, and what a stale figure does.
- **medium** `Export control` has a behavioral spec but no visual spec (EXPERIENCE.md § Component Patterns; absent from DESIGN.md § Components). *Fix:* add a row.

## 4. State coverage — thin

Walked all eight IA surfaces. Upload is strong — five distinct states including the AD-9
schema-failure case that forbids partial data. Dashboard and Oracle are partly covered.

### Findings

- **critical** Oracle has no `no-answer-available` state — see § 1. *Fix:* as above.
- **high** Four surfaces have no states specified: Finding detail, Reviewed register, Access log, Sign-in (EXPERIENCE.md § State Patterns). Register and access log both need at least empty and export-in-progress. *Fix:* extend the state table per surface.
- **medium** No error state anywhere for the Oracle failing outright — timeout, model unavailable, tool endpoint down. Distinct from the catalog-match case. *Fix:* add.
- **low** No dashboard cold-load state.

## 5. Visual reference coverage — broken

`.working/directions-4.html` exists. `mockups/` and `wireframes/` do not yet exist.

### Findings

- **high** Neither spine links to any visual reference, and neither states spines-win-on-conflict (DESIGN.md, EXPERIENCE.md). The rubric requires inline links naming what each illustrates. *Fix:* link the promoted direction and the pending mocks at their relevant sections; state precedence once.

## 6. Bloat & overspecification — adequate

No pixel specs where tokens cover it. No restatement of PRD personas, FRs, or scope — sources
are referenced rather than duplicated. Tables used where tables work.

### Findings

- **medium** EXPERIENCE.md carries editorial voice in several places ("a table that scrolls sideways in a meeting is a table nobody reads"; "having succeeded"). The spec reserves editorial voice for DESIGN.md; EXPERIENCE.md should be flat. *Fix:* flatten, or accept as a deliberate deviation and note it.

## 7. Inheritance discipline — thin

`sources` frontmatter resolves in both files. UJ protagonist names are verbatim from the PRD.
EXPERIENCE.md token references resolve to DESIGN.md by name.

### Findings

- **high** Glossary divergence: the spines say **finding**, while the PRD (FR-8, "Watchdog Alerts") and the architecture (`ALERT` entity, AD-13 alert keying) say **alert** (EXPERIENCE.md § Voice and Tone, § Alert Lifecycle). The rename was deliberate and arguably better for a volunteer audience, but it is undeclared, and § Alert Lifecycle uses both terms in the same section. Downstream, a story author will not know which entity is meant. *Fix:* declare the mapping explicitly, or revert to `alert`.

## 8. Shape fit — strong

DESIGN.md sections in canonical order. All eight EXPERIENCE.md defaults present. Invented
sections (Evidence Presentation, Alert Lifecycle) carry product-specific concerns the defaults
don't reach and earn their place. Responsive & Platform correctly triggered.

### Findings

- **medium** `Inspiration & Anti-patterns` is absent but triggered: the memlog records both an explicit reject (the architecture-run HTML renderings, ruled out as design input) and three rejected directions (B Plainspoken, C Console, D Documentary). *Fix:* add the section capturing what was rejected and why.

## Mechanical notes

- One malformed token reference (`{colors.rule-strong)`) was found and corrected during distillation.
- Both frontmatter blocks complete; `status: final` set on both.
- No Mermaid in either spine.
- Component names are consistent across sections within each file.
