/**
 * The member lines an interface declares, for the port tests that assert a port
 * cannot do something.
 *
 * Several ports in this directory argue in prose that they are read-only, or
 * write-only, and the argument is only worth anything if adding the missing
 * capability fails a test. That is what this reads: the body of one interface,
 * as lines.
 *
 * **It returns lines, not parsed names, and that is the whole design.** Five
 * rounds of review on `unit-directory.test.ts` and `assessment-directory.test.ts`
 * found five member forms that a name-matching version silently dropped — a
 * function-typed property, a generic method, a call signature, an index
 * signature, and optional (`record?()`) and quoted (`"record"()`) members. Each
 * was a way to add a write capability that an exhaustive assertion would report
 * as absent: the same defect wearing a new syntax each time.
 *
 * So nothing is matched. Every non-empty line inside the interface is a member
 * line, whatever it looks like, and there is no form left for a sixth round to
 * find. The trade is that harmless reformatting also fails the assertion — on a
 * port, that is the right trade, because a port should not change quietly.
 *
 * ## Everything here is one string-aware pass, and both halves had to be
 *
 * Comments are removed and braces are counted by the same scanner, because doing
 * either one naively corrupts the other. Two failures, both real:
 *
 * - Stripping `//` with a global regex first deletes the tail of any line whose
 *   *string literal* contains one — `endpoint(url: 'https://x'): void` loses its
 *   closing quote, and the brace matcher then reads the rest of the file as one
 *   long string. `migrations/executable-sql.ts` is this project's SQL-side
 *   equivalent, written after the same lesson.
 * - Counting braces without string-awareness desyncs on an unmatched brace
 *   inside a string literal type (`closing(sep: '}')`). That one shipped in
 *   story 2.1's version and was found by review.
 *
 * ## It throws rather than returning nothing
 *
 * A misspelled or renamed interface used to come back as `[]`, which is also
 * what a genuinely empty interface returns. The two mean opposite things: one is
 * "this port declares no capability", which is the assertion these tests exist
 * to make, and the other is "this test read nothing at all". Any assertion of
 * the form `toEqual([])` would pass for both. So the failures are loud, and `[]`
 * now means only what it says.
 *
 * **This is a test helper living in `core/ports/` rather than in a test file**,
 * because five copies of it already exist there. Those five are not migrated
 * here: that is a sweep across five well-reviewed files and it is not this
 * story's, so it is recorded as deferred work instead. New port tests use this.
 */

export class InterfaceNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InterfaceNotFoundError'
  }
}

/**
 * Every non-empty line inside `interface {name} { … }`, trimmed and collapsed.
 *
 * Throws `InterfaceNotFoundError` if the interface is not declared in `text`, or
 * if its body is not brace-balanced.
 */
export function declaredMembers(text: string, interfaceName: string): readonly string[] {
  // The name must not be followed by another identifier character, or a lookup
  // for `QueryLog` finds `QueryLogEntry` — which is not a hypothetical: this file
  // was written with `indexOf` and the first two assertions in
  // `query-log.test.ts` failed by reading the wrong interface's body entirely.
  // A port test that silently checks a neighbouring type reports the port as
  // whatever that neighbour happens to be.
  const declaration = new RegExp(`\\binterface\\s+${escapeForRegExp(interfaceName)}(?![\\w$])`)
  const start = text.search(declaration)
  if (start === -1) {
    throw new InterfaceNotFoundError(`no \`interface ${interfaceName}\` is declared in this source`)
  }

  const body = balancedBody(text, start, interfaceName)

  return body
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter((line) => line.length > 0)
}

/**
 * The text between the interface's braces, with comments blanked out.
 *
 * One pass. Newlines inside blanked comments are kept, so the caller still sees
 * the original line structure.
 */
function balancedBody(text: string, start: number, interfaceName: string): string {
  const open = text.indexOf('{', start)
  if (open === -1) {
    throw new InterfaceNotFoundError(`\`interface ${interfaceName}\` has no opening brace`)
  }

  const kept: string[] = []
  let depth = 0

  for (let i = open; i < text.length; i += 1) {
    const ch = text[i]!
    const next = text[i + 1]

    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1
      kept.push('\n')
      continue
    }

    if (ch === '/' && next === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] === '\n') kept.push('\n')
        i += 1
      }
      i += 1
      continue
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      kept.push(ch)
      i += 1
      while (i < text.length && text[i] !== ch) {
        if (text[i] === '\\') {
          kept.push(text[i]!)
          i += 1
        }
        if (i < text.length) kept.push(text[i]!)
        i += 1
      }
      if (i < text.length) kept.push(text[i]!)
      continue
    }

    if (ch === '{') {
      depth += 1
      kept.push(ch)
      continue
    }

    if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        // Drop the outermost braces; everything between them is the body.
        return kept.slice(1).join('')
      }
      kept.push(ch)
      continue
    }

    kept.push(ch)
  }

  throw new InterfaceNotFoundError(`\`interface ${interfaceName}\` has no closing brace`)
}

/** An interface name is an identifier today; escaped anyway, so it stays a name. */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
