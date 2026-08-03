/**
 * Configuration entries, normalised into one shape so a single detector can be
 * pointed at process environments, text config files and JSON config alike.
 *
 * Pure by construction: nothing here reads a file, an environment, or a clock.
 * Callers do the I/O and hand the results in.
 */

export interface ConfigEntry {
  /** Where the entry came from, e.g. `process.env` or `.github/workflows/ci.yml`. */
  readonly source: string
  readonly name: string
  /** Absent when only the key is known — an environment variable name with no readable value. */
  readonly value?: string
}

/** `# comment`, with any leading indentation. */
const COMMENT_LINE = /^\s*#/

/**
 * `NAME=value`, `NAME: value`, or `export NAME=value`, optionally as a YAML
 * sequence item (`- NAME: value`), with any leading indentation. The value
 * capture is greedy to the end of the line so only the first delimiter splits —
 * a connection string may contain both `:` and `=`.
 */
const ASSIGNMENT_LINE = /^\s*(?:-\s+)?(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*[:=]\s*(.*)$/

/** A GitHub Actions secret reference: `${{ secrets.NAME }}`, spacing optional. */
const SECRET_REFERENCE = /\$\{\{\s*secrets\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g

/** CRLF, lone LF, and lone CR — the last still reaches us through old tooling. */
const LINE_BREAK = /\r\n|\r|\n/

function splitLines(content: string): string[] {
  return content.split(LINE_BREAK)
}

/**
 * Strips surrounding quotes only when they genuinely wrap the value. A value
 * that merely starts and ends with the same character — `"a" and "b"` — is left
 * alone, because unbalancing it would corrupt the text the detector reasons over.
 */
function stripMatchingQuotes(value: string): string {
  const first = value[0]
  if (first !== '"' && first !== "'") return value
  if (value.length < 2 || !value.endsWith(first)) return value
  if (value.slice(1, -1).includes(first)) return value
  return value.slice(1, -1)
}

export function entriesFromEnv(
  source: string,
  env: Readonly<Record<string, string | undefined>>,
): ConfigEntry[] {
  if (env === null || typeof env !== 'object') {
    throw new TypeError('entriesFromEnv expects an environment object')
  }

  return Object.entries(env).map(([name, value]) =>
    value === undefined ? { source, name } : { source, name, value },
  )
}

export function entriesFromText(source: string, content: string): ConfigEntry[] {
  if (typeof content !== 'string') {
    throw new TypeError('entriesFromText expects file content as a string')
  }

  const entries: ConfigEntry[] = []

  for (const line of splitLines(content)) {
    if (COMMENT_LINE.test(line)) continue

    const match = ASSIGNMENT_LINE.exec(line)
    if (match === null) continue

    const [, name, rawValue = ''] = match
    if (name === undefined) continue

    entries.push({ source, name, value: stripMatchingQuotes(rawValue.trimEnd()) })
  }

  return entries
}

/**
 * Walks parsed JSON and reports every leaf under the key that names it. JSON
 * config — `vercel.json` above all — carries environment wiring in quoted keys,
 * which no line-oriented parser can see.
 */
export function entriesFromJson(source: string, content: string): ConfigEntry[] {
  if (typeof content !== 'string') {
    throw new TypeError('entriesFromJson expects file content as a string')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (cause) {
    throw new Error(`${source} is not valid JSON, so it could not be checked`, { cause })
  }

  const entries: ConfigEntry[] = []

  /**
   * A key whose value is absent still reports the key. `findForbiddenCredentials`
   * matches on `entry.name` as well as on the value, so the name alone is enough
   * to raise a violation — and a name is exactly what survives when the value is
   * held somewhere this walk cannot see.
   *
   * Without this, `{"env": {"PLAID_SECRET": null}}` and `{"env": {"PLAID_SECRET":
   * {}}}` both pass the guard clean, because the recursion returns before any
   * entry is pushed and the key name is discarded. `entriesFromEnv` already keeps
   * the name and omits the value in the same situation; this matches it.
   */
  const walk = (node: unknown, name: string | undefined): void => {
    if (Array.isArray(node)) {
      if (node.length === 0) {
        if (name !== undefined) entries.push({ source, name })
        return
      }
      for (const item of node) walk(item, name)
      return
    }

    if (node !== null && typeof node === 'object') {
      const children = Object.entries(node)
      if (children.length === 0) {
        if (name !== undefined) entries.push({ source, name })
        return
      }
      for (const [key, child] of children) walk(child, key)
      return
    }

    if (name === undefined) return

    if (node === null || node === undefined) {
      entries.push({ source, name })
      return
    }

    entries.push({ source, name, value: String(node) })
  }

  walk(parsed, undefined)
  return entries
}

/**
 * Reports the secrets a file *reaches for*, independent of the variable name it
 * maps them onto. `MISC_TOKEN: ${{ secrets.PLAID_SECRET }}` names the rail in
 * plain sight while defeating any check that only reads the left-hand side —
 * and a workflow file is precisely where a deploy unit's secrets become visible.
 */
export function secretReferencesFromText(source: string, content: string): ConfigEntry[] {
  if (typeof content !== 'string') {
    throw new TypeError('secretReferencesFromText expects file content as a string')
  }

  // Matched with matchAll rather than a shared exec loop so no lastIndex
  // survives the call and results cannot depend on what was scanned before.
  return [...content.matchAll(SECRET_REFERENCE)]
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined)
    .map((name) => ({ source, name }))
}
