/**
 * Every module specifier a file loads — the one scanner, shared.
 *
 * ## Why this is a module and not a line in each test
 *
 * Four structural guards in this repo need "what does this file import?":
 * `boundary.test.ts` (`core/` imports nothing outward), `sole-data-path.test.ts`
 * (only one module may reach the executor), `finding.test.ts` (no model in the
 * alerting path) and `mapping/suggest.test.ts` (no credential in the suggester).
 * Each had grown its own copy of the pattern, and they had **already drifted** —
 * two matched only `'` and `"` while the third had been widened to backticks
 * after Argus found a `import(`…`)` slipping through.
 *
 * That is this project's most-repeated defect shape, in the place where it costs
 * most: these are the tests standing in for AD-4 and AD-8, and a copy that is one
 * revision behind reports clean on exactly the import it was widened to catch.
 *
 * ## The two hard-won parts
 *
 * **Every form that loads a module**, not just `from '…'` — `boundary.test.ts`
 * found a formatter-wrapped import list, a side-effect `import '…'`, a dynamic
 * `import()` and a `require()` each escaping a narrower pattern, and Argus later
 * added the template literal.
 *
 * **Comments are blanked first, string contents kept.** Without that, a file's
 * own prose *about* imports is read as an import: `finding.test.ts` had a
 * sentence satisfy its own "did we read any imports at all?" control, so the
 * guard written to stop a vacuous pass was itself passing on a comment (raised
 * by CodeRabbit), and `sole-data-path.test.ts` failed on a commented-out import.
 * String contents must be kept, because the specifiers live inside strings.
 */

import { neutralise } from './declared-members'

/**
 * The three quote characters, as escapes rather than as themselves: `'`, `"`, `` ` ``.
 *
 * **This is not stylistic.** Written as a literal character class, this pattern
 * contains a raw backtick — and `neutralise` does not know what a regex literal
 * is, so it read that backtick as opening a template literal and stopped
 * blanking comments for the rest of the file. The symptom was this module
 * reporting an import of `@/x/${e}`, a specifier that exists only in the doc
 * comment below, which then failed `sole-data-path.test.ts`'s executor sweep.
 *
 * Caught because moving the scanner into a production file put it under the
 * sweeps for the first time. The same hole is still open for **any** production
 * file whose regex literal contains a quote — see the note in `suggest.test.ts`'s
 * File List; teaching `neutralise` about regex literals means resolving the
 * regex-versus-division ambiguity, which is more than this story should take on.
 */
const QUOTES = '\\x27\\x22\\x60'

/**
 * Matches `from '…'`, `import '…'`, `import('…')` and `require('…')`, in single
 * quotes, double quotes or backticks.
 *
 * Global, so it carries `lastIndex` between uses — only ever spread or iterated
 * through `matchAll`, never `.test()`ed in a loop.
 */
export const MODULE_SPECIFIER = new RegExp(
  '\\b(?:from|import|require)\\s*\\(?\\s*[' + QUOTES + ']([^' + QUOTES + ']+)[' + QUOTES + ']',
  'g',
)

/**
 * Every specifier `source` loads, comments excluded.
 *
 * An interpolated specifier comes back containing its literal `${…}`. That is
 * deliberate and callers must treat it as **indeterminate**: `import(`@/x/${e}`)`
 * cannot be resolved without running the program, and a scanner that cannot tell
 * must not answer "fine".
 */
export function specifiersIn(source: string): readonly string[] {
  const { commentsBlanked } = neutralise(source)

  return [...commentsBlanked.matchAll(MODULE_SPECIFIER)]
    .map(([, specifier]) => specifier)
    .filter((specifier): specifier is string => specifier !== undefined)
}
