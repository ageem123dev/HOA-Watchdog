/**
 * AD-17's other half: `/chat/v*` is the **only** way Node reaches the agent.
 *
 * "The Node gateway reaches the Python agent service through versioned
 * `/chat/v*` endpoints only." The *Prevents* line names what that is for: "the
 * two runtimes accumulating ad-hoc endpoints between them."
 *
 * `core/tools/sole-data-path.test.ts` guards the same property in the other
 * direction, and this is its shape. It also carries that file's hardest-won
 * lesson: **the detector is tested against planted violations**, because a
 * scanner reporting green on the thing it exists to catch is worse than none.
 *
 * ## Why this asks "who knows how to reach the agent" and not "who calls it"
 *
 * The obvious guard — list the files that import `askAgent` and assert it is a
 * known set — is **vacuous today**. Story 3.6b builds the first caller; until
 * then the set is empty, and an assertion over nothing passes by describing an
 * empty world. Story 3.5 spent four review rounds on exactly that mistake in a
 * different guard, and story 3.3 shipped it twice.
 *
 * So the property is the one that holds now and keeps holding: **exactly one
 * file knows the agent's address**. A second route to the agent has to name the
 * base URL or spell the path, and either fails here. When 3.6b adds a caller it
 * will import `askAgent`, which is not a way of knowing the address — it is a
 * way of not needing to.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

import { neutralise } from '../../core/ports/declared-members'

const REPO_ROOT = join(__dirname, '..', '..')

/** The one file allowed to know where the agent is. */
const THE_DOOR = 'adapters/agent/chat-client.ts'

const SCANNED_ROOTS = ['app', 'core', 'adapters', 'scripts'] as const

// `.cjs` and `.cts` too. The pattern matched `.mjs` and not its CommonJS
// counterpart, so a file with either extension would have been invisible to the
// sweep — and invisible is the direction that fails silently. No such file
// exists today, which is exactly when it costs nothing to fix.
// `core/tools/sole-data-path.test.ts` shared the gap and is changed with it;
// leaving one guard narrower than its sibling is how the two drift.
// Raised by CodeRabbit.
const SOURCE = /\.(?:[cm]?[jt]sx?)$/
const IS_TEST = /\.test\.(?:[cm]?[jt]sx?)$/

/**
 * How a file would betray that it talks to the agent directly: it names the
 * variable holding the address, or it spells a versioned chat path.
 */
const REACHES_THE_AGENT = [/AGENT_BASE_URL/, /\/chat\/v\d+/]

/**
 * Comments removed, string contents kept — `core/ports/declared-members.ts`'s
 * helper, shared rather than copied. Without it a commented-out reference fails
 * the build for a line nobody executes; with it, the specifiers this looks for
 * still live inside strings and survive.
 */
export function knowsWhereTheAgentIs(source: string): boolean {
  const { commentsBlanked } = neutralise(source)

  return REACHES_THE_AGENT.some((pattern) => pattern.test(commentsBlanked))
}

function productionFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue
    const full = join(directory, entry.name)

    if (entry.isDirectory()) productionFiles(full, found)
    else if (SOURCE.test(entry.name) && !IS_TEST.test(entry.name)) {
      found.push(relative(REPO_ROOT, full).split(sep).join('/'))
    }
  }

  return found
}

const everyScannedFile = (): string[] => SCANNED_ROOTS.flatMap((root) => productionFiles(join(REPO_ROOT, root)))

describe('the agent has one door', () => {
  it('is known to the client and to nothing else', () => {
    const reaching = everyScannedFile().filter((file) =>
      knowsWhereTheAgentIs(readFileSync(join(REPO_ROOT, file), 'utf8')),
    )

    expect(reaching).toEqual([THE_DOOR])
  })

  it('finds files to scan in every root, so an empty sweep cannot pass', () => {
    // The assertion above is also satisfied by a walk returning nothing and a
    // `THE_DOOR` that no longer exists. Both halves are pinned.
    for (const root of SCANNED_ROOTS) {
      expect(productionFiles(join(REPO_ROOT, root)).length, `${root}/ contributed nothing`).toBeGreaterThan(0)
    }

    expect(everyScannedFile()).toContain(THE_DOOR)
  })

  it.each([
    ['a .cjs production file', 'app/x.cjs'],
    ['a .cts production file', 'app/x.cts'],
    ['a .mjs production file', 'app/x.mjs'],
  ])('scans %s', (_label, name) => {
    expect(SOURCE.test(name)).toBe(true)
    expect(IS_TEST.test(name)).toBe(false)
  })

  it.each([['a .cjs test', 'app/x.test.cjs'], ['a .cts test', 'app/x.test.cts']])(
    'excludes %s from the sweep',
    (_label, name) => {
      expect(IS_TEST.test(name)).toBe(true)
    },
  )

  it.each([
    ['reading the base URL', "const base = process.env.AGENT_BASE_URL"],
    ['a destructured read', "const { AGENT_BASE_URL } = process.env"],
    ['spelling the path', "await fetch(`${somewhere}/chat/v1/turn`)"],
    ['a different version of the path', "fetch('/chat/v2/turn')"],
  ])('sees %s', (_label, source) => {
    expect(knowsWhereTheAgentIs(source)).toBe(true)
  })

  it.each([
    ['a name merely containing the variable', 'const AGENT_BASE_URL_DOCS = "see the README"'],
  ])('sees %s, which is fail-closed and deliberate', (_label, source) => {
    // A file naming something that *contains* the variable is a file that
    // probably knows the address, and a scanner that cannot tell must not
    // answer "fine" — the reasoning `sole-data-path.test.ts` applies to an
    // interpolated specifier. It costs nothing until somebody writes one.
    expect(knowsWhereTheAgentIs(source)).toBe(true)
  })

  it.each([
    ['an unrelated import', "import { askAgent } from '@/adapters/agent/chat-client'"],
    ['the agent named in prose', '// the agent is reached through the chat client'],
    ['a commented-out reference', "// const base = process.env.AGENT_BASE_URL"],
    ['a commented-out path', '// fetch("/chat/v1/turn")'],
  ])('does not fire on %s', (_label, source) => {
    expect(knowsWhereTheAgentIs(source)).toBe(false)
  })
})
