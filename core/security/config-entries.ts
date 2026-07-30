/**
 * Configuration entries, normalised into one shape so a single detector can be
 * pointed at process environments and at text config files alike.
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
 * `NAME=value`, `NAME: value`, or `export NAME=value`, with any leading
 * indentation. The value capture is greedy to the end of the line so only the
 * first delimiter splits — a connection string may contain both `:` and `=`.
 */
const ASSIGNMENT_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*[:=]\s*(.*)$/

function stripMatchingQuotes(value: string): string {
  const first = value[0]
  if ((first === '"' || first === "'") && value.length >= 2 && value.endsWith(first)) {
    return value.slice(1, -1)
  }
  return value
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

  for (const line of content.split(/\r?\n/)) {
    if (COMMENT_LINE.test(line)) continue

    const match = ASSIGNMENT_LINE.exec(line)
    if (match === null) continue

    const [, name, rawValue = ''] = match
    if (name === undefined) continue

    entries.push({ source, name, value: stripMatchingQuotes(rawValue.trimEnd()) })
  }

  return entries
}
