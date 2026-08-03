/**
 * The token set — the single source of styling truth.
 *
 * Values are copied verbatim from the `DESIGN.md` frontmatter, which remains the
 * specification; this module is its implementation. `tokens.test.ts` asserts the
 * two agree, so neither can move without the other.
 *
 * Pure: no imports, no I/O, no framework types.
 */

/**
 * Light only, and the type says so. DESIGN.md records the reasoning under
 * *Colors* → "Light-only for the pilot… This is a decision, not an omission."
 * A second theme requires changing this union, which is the deliberate step the
 * decision calls for. The absence of any `prefers-color-scheme` handling in this
 * codebase is part of the same decision.
 */
export const THEME = 'light' as const
export type Theme = typeof THEME

export const colors = {
  ink: '#14213D',
  'ink-muted': '#5A6478',
  stone: '#E5E5E0',
  'stone-raised': '#F2F2EE',
  rule: '#C7C7C0',
  'rule-strong': '#9E9E96',
  brass: '#6E5426',
  'brass-tint': '#EDE3CE',
  flag: '#8C2F1E',
  'flag-tint': '#F6E4DF',
  affirm: '#2C5233',
  'on-ink': '#FFFFFF',
} as const

export type ColorToken = keyof typeof colors

export const typography = {
  serif: 'ui-serif, Georgia, "Iowan Old Style", "Times New Roman", serif',
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: 'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace',
  'scale-figure': '1.55rem',
  'scale-title': '1.125rem',
  'scale-body': '0.9375rem',
  'scale-label': '0.6875rem',
  'tracking-label': '0.14em',
} as const

export const rounded = {
  none: '0',
  slight: '2px',
} as const

export const spacing = {
  base: '4px',
  row: '12px',
  block: '24px',
  section: '40px',
} as const

export const components = {
  'margin-tick-width': '3px',
  'rule-hairline': '1px',
  'rule-heading': '2px',
  'focus-ring-width': '2px',
  'focus-ring-offset': '2px',
} as const

/**
 * `--color-ink`, `--type-scale-body`, `--space-row`, and so on. One prefix per
 * group so a custom property's name says which vocabulary it belongs to.
 */
const GROUPS = [
  ['color', colors],
  ['type', typography],
  ['radius', rounded],
  ['space', spacing],
  ['component', components],
] as const satisfies readonly (readonly [string, Readonly<Record<string, string>>])[]

export function customPropertyName(group: string, token: string): string {
  return `--${group}-${token}`
}

/** Every token as a `[customPropertyName, value]` pair, in group order. */
export function tokenCustomProperties(): [string, string][] {
  return GROUPS.flatMap(([group, tokens]) =>
    Object.entries(tokens).map(
      ([token, value]) => [customPropertyName(group, token), value] as [string, string],
    ),
  )
}

/**
 * The `:root` block. Generated rather than hand-written: a parallel CSS file
 * listing the same values is exactly the drift this story exists to prevent.
 */
export function rootCustomPropertiesCss(): string {
  const declarations = tokenCustomProperties()
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n')

  return `:root {\n${declarations}\n}`
}
