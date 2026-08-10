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
 * The brace matcher is string-aware. Without that, an unmatched brace inside a
 * string literal type (`closing(sep: '}')`) desyncs the depth counter and
 * truncates the member list — which is how story 2.1's version passed with the
 * string-awareness removed.
 *
 * **This is a test helper living in `core/ports/` rather than in a test file**,
 * because five copies of it already exist there. Those five are not migrated
 * here: that is a sweep across five well-reviewed files and it is not this
 * story's, so it is recorded as deferred work instead. New port tests use this.
 */

/** Every non-empty line inside `interface {name} { … }`, trimmed and collapsed. */
export function declaredMembers(text: string, interfaceName: string): readonly string[] {
  const withoutComments = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

  // The name must not be followed by another identifier character, or a lookup
  // for `QueryLog` finds `QueryLogEntry` — which is not a hypothetical: this file
  // was written with `indexOf` and the first two assertions in
  // `query-log.test.ts` failed by reading the wrong interface's body entirely.
  // A port test that silently checks a neighbouring type reports the port as
  // whatever that neighbour happens to be.
  const declaration = new RegExp(`interface ${escapeForRegExp(interfaceName)}(?![\\w$])`)
  const start = withoutComments.search(declaration)
  if (start === -1) return []

  const open = withoutComments.indexOf('{', start)
  if (open === -1) return []

  let depth = 0
  let close = -1
  for (let i = open; i < withoutComments.length; i += 1) {
    const ch = withoutComments[i]

    if (ch === "'" || ch === '"' || ch === '`') {
      i += 1
      while (i < withoutComments.length && withoutComments[i] !== ch) {
        if (withoutComments[i] === '\\') i += 1
        i += 1
      }
      continue
    }

    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        close = i
        break
      }
    }
  }
  if (close === -1) return []

  return withoutComments
    .slice(open + 1, close)
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter((line) => line.length > 0)
}

/** An interface name is an identifier today; escaped anyway, so it stays a name. */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
