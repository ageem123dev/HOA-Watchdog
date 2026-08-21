/**
 * Whose records a question is answered from is decided by the session, and by
 * nothing that travels with the question.
 *
 * ## What this is, and what it is not
 *
 * `/tools/v1/catalog/execute` takes `actorId` as a field in its request body,
 * and story 5.1b derives the association from it. A review read that as "an
 * injected agent can pass another board member's id". **It cannot**, and the
 * reason is worth pinning rather than re-deriving:
 *
 * - `route_question(question, *, actor_id, ...)` takes the actor as a Python
 *   keyword argument threaded from the chat request. The model returns only
 *   `choice.name` and `choice.arguments`.
 * - `choice.arguments` is checked against the entry's own parameter schema,
 *   which is `additionalProperties: false`.
 * - Nothing in the declarations handed to the model mentions an actor at all.
 *
 * So the model cannot choose. What *can* go wrong is duller and likelier: **our
 * own code passing the wrong id** — a future surface reading it from a query
 * string or a form field instead of the session. That is a bug, not an attack,
 * and it is what this file exists to catch.
 *
 * Closing the remaining gap — that anything holding the service token may name
 * any board member — needs a signed actor token relayed by the agent service,
 * which changes AD-15/AD-17's wire contract. That is story 5.1c, and this guard
 * is deliberately not a substitute for it: it makes the deferral honest by
 * pinning the property the deferral relies on.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { ALL_ENTRIES } from '../../catalog/registry'

const REPO_ROOT = process.cwd()

/**
 * Every surface that asks the agent a question on a board member's behalf.
 *
 * Listed rather than globbed: there is one, adding another should be a
 * deliberate act, and a glob would quietly stop covering the file that moves.
 * `askOracle` is the only entry point that carries an `actorId` to the agent —
 * `sole-chat-path.test.ts` is what holds *that* true.
 */
const ASKING_SURFACES = ['app/oracle/page.tsx']

const read = (path: string) => readFileSync(join(REPO_ROOT, path), 'utf8')

describe('the model is never offered an actor to choose', () => {
  /**
   * The tool schemas are the whole of what the model may fill in. A parameter
   * named for an actor or an association would let a prompt-injected model
   * name one — and `additionalProperties: false` would not help, because the
   * property would be declared.
   */
  it.each(ALL_ENTRIES.map((entry) => [`${entry.id}@${entry.version}`, entry] as const))(
    '%s declares no parameter that names an actor or an association',
    (_label, entry) => {
      const declared = Object.keys(entry.parameters.properties)

      for (const name of declared) {
        expect(name).not.toMatch(/actor/i)
        expect(name).not.toMatch(/association/i)
        expect(name).not.toMatch(/tenant/i)
      }
    },
  )

  it('has entries to sweep, so the check above cannot pass over nothing', () => {
    expect(ALL_ENTRIES.length).toBeGreaterThan(0)
    expect(
      ALL_ENTRIES.some((entry) => Object.keys(entry.parameters.properties).length > 0),
    ).toBe(true)
  })
})

describe('a surface that asks the agent takes its actor from the session', () => {
  it.each(ASKING_SURFACES)('%s reads the actor from the authenticated session', (path) => {
    const source = read(path)

    expect(source).toContain('await auth()')
    expect(source).toMatch(/const actorId = session\.user\.id/)
  })

  /**
   * The failure this is really about. A surface that took the actor from the
   * request would answer about whoever the caller named, and it would look
   * entirely ordinary in review — `actorId` is a legitimate-looking parameter.
   */
  it.each(ASKING_SURFACES)('%s does not take the actor from the request', (path) => {
    const source = read(path)

    const actorLines = source
      .split('\n')
      .filter((line) => /actorId/.test(line) && !line.trimStart().startsWith('//'))

    expect(actorLines.length).toBeGreaterThan(0)

    for (const line of actorLines) {
      expect(line).not.toMatch(/searchParams/)
      expect(line).not.toMatch(/\bparams\b/)
      expect(line).not.toMatch(/formData/)
      expect(line).not.toMatch(/request\./)
      expect(line).not.toMatch(/headers/)
    }
  })

  /**
   * And it refuses rather than guessing when there is no session. Without this
   * the page would call the agent with `undefined`, which the gateway answers
   * with a `23502` — loud, but only after a turn has been spent and only
   * because a database constraint happened to catch it.
   */
  it.each(ASKING_SURFACES)('%s redirects rather than asking without a session', (path) => {
    const source = read(path)

    expect(source).toMatch(/if \(!session\?\.user\?\.id\) redirect\(/)
  })
})
