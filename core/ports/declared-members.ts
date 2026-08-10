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
 * ## One masking pass, and every step reads from it
 *
 * Comments and string literals are neutralised **once**, into a copy the same
 * length as the source, so every offset found in the mask is an offset in the
 * original. Finding the declaration, finding the opening brace and counting to
 * the closing one all read the mask; only the member text is taken from the
 * source. Three separate failures made that the shape:
 *
 * - Counting braces without string-awareness desyncs on an unmatched brace in a
 *   string literal type (`closing(sep: '}')`). Shipped in story 2.1's version.
 * - Stripping `//` with a global regex *before* scanning eats the closing quote
 *   of any member holding `'https://example.com'`, and the scanner then reads
 *   the rest of the file as one string — returning nothing from an interface
 *   that declares something. `migrations/executable-sql.ts` is this project's
 *   SQL-side fix for the identical mistake.
 * - Searching the **raw** text for the declaration finds a commented-out or
 *   quoted `interface Foo {` before the real one, and the body scan then runs
 *   from there. That one survived the previous fix, because the body scan was
 *   made safe and the lookup that positions it was not. Raised on the merge
 *   request.
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
 * Throws `InterfaceNotFoundError` if the interface is not declared in `text`
 * outside comments and strings, or if its body is not brace-balanced.
 */
export function declaredMembers(text: string, interfaceName: string): readonly string[] {
  const { masked, commentsBlanked } = neutralise(text)

  // The name must not be followed by another identifier character, or a lookup
  // for `QueryLog` finds `QueryLogEntry` — which is not a hypothetical: this file
  // was written with `indexOf` and the first two assertions in
  // `query-log.test.ts` failed by reading the wrong interface's body entirely.
  // A port test that silently checks a neighbouring type reports the port as
  // whatever that neighbour happens to be.
  const declaration = new RegExp(`\\binterface\\s+${escapeForRegExp(interfaceName)}(?![\\w$])`)
  const start = masked.search(declaration)
  if (start === -1) {
    throw new InterfaceNotFoundError(`no \`interface ${interfaceName}\` is declared in this source`)
  }

  const open = masked.indexOf('{', start)
  if (open === -1) {
    throw new InterfaceNotFoundError(`\`interface ${interfaceName}\` has no opening brace`)
  }

  let depth = 0
  for (let i = open; i < masked.length; i += 1) {
    if (masked[i] === '{') depth += 1
    else if (masked[i] === '}') {
      depth -= 1
      if (depth === 0) {
        return commentsBlanked
          .slice(open + 1, i)
          .split('\n')
          .map((line) => line.trim().replace(/\s+/g, ' '))
          .filter((line) => line.length > 0)
      }
    }
  }

  throw new InterfaceNotFoundError(`\`interface ${interfaceName}\` has no closing brace`)
}

/**
 * Two offset-aligned copies of the source, built in one pass.
 *
 * `masked` — comments **and** string contents replaced by spaces. Nothing in it
 * can be mistaken for code, so searching and brace-counting are safe.
 *
 * `commentsBlanked` — comments replaced by spaces, string contents kept. This is
 * what a member line is read from, because `closing(sep: '}')` has to survive
 * into the output intact.
 *
 * Both preserve length and newlines, so an index into either is an index into
 * the original.
 *
 * **It does not mask regex literals, and that is a bounded decision.** Telling
 * `/interface Example {/` from a division is not possible without parsing the
 * program, so a regex literal containing braces or an interface name could
 * desync this. The input is a `.ts` file in `core/ports/` — type declarations
 * and prose — where a regex literal cannot appear at all outside a comment or a
 * string, both of which *are* masked. `migrations/executable-sql.ts` bounds its
 * own scope the same way and for the same reason: this is a test helper, not a
 * parser, and it should not grow into one.
 */
function neutralise(text: string): { masked: string; commentsBlanked: string } {
  const masked: string[] = []
  const commentsBlanked: string[] = []

  const blank = (ch: string) => (ch === '\n' ? '\n' : ' ')
  const push = (maskedCh: string, keptCh: string) => {
    masked.push(maskedCh)
    commentsBlanked.push(keptCh)
  }

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!

    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') {
        push(blank(text[i]!), blank(text[i]!))
        i += 1
      }
      if (i < text.length) push('\n', '\n')
      continue
    }

    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      const stop = end === -1 ? text.length : end + 2
      for (; i < stop; i += 1) push(blank(text[i]!), blank(text[i]!))
      i -= 1
      continue
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      push(ch, ch)
      i += 1
      while (i < text.length && text[i] !== ch) {
        if (text[i] === '\\' && i + 1 < text.length) {
          push(blank(text[i]!), text[i]!)
          i += 1
        }
        if (i < text.length) push(blank(text[i]!), text[i]!)
        i += 1
      }
      if (i < text.length) push(ch, ch)
      continue
    }

    push(ch, ch)
  }

  return { masked: masked.join(''), commentsBlanked: commentsBlanked.join('') }
}

/** An interface name is an identifier today; escaped anyway, so it stays a name. */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
