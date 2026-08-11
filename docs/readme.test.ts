/**
 * The README's checkable claims are true of this tree.
 *
 * AC1. Not every sentence can be tested — "a reader reaches a running
 * application" is a claim about a person — but the specific things that went
 * wrong before are all mechanical, and every one of them was true when written:
 *
 *   - it named a vendor the project does not use, for four weeks
 *   - it counted three gates where there are five
 *   - it described a CI pipeline that no longer exists
 *   - it listed a source tree that had grown four directories past it
 *
 * None of those needed a person to be careless. They needed only time. So the
 * countable ones are counted here.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readme = readFileSync(join(root, 'README.md'), 'utf8')

const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts as Record<
  string,
  string
>

/** The variable names `.env.example` actually declares. */
const declaredVariables = (): string[] =>
  readFileSync(join(root, '.env.example'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
    .map((line) => line.split('=')[0]!)

describe('the README describes this environment', () => {
  it('names every variable .env.example declares', () => {
    const missing = declaredVariables().filter((name) => !readme.includes(name))
    expect(missing, `absent from the README: ${missing.join(', ')}`).toEqual([])
  })

  it('states how many there are, and is right', () => {
    // The sentence a reader counts against. Ten was true when written and is
    // exactly the kind of number that stops being true.
    //
    // The list had the same fault one level up: it stopped at `twelve`, so the
    // thirteenth variable made this assert `**undefined** variables` — a failure
    // that describes the lookup table rather than the README. Extended, and the
    // lookup is now guarded so running off the end says so.
    const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty']
    const count = declaredVariables().length
    expect(words[count], `no word for ${count} — extend the list`).toBeDefined()
    expect(readme).toContain(`**${words[count]}** variables`)
  })

  it('names no variable that .env.example does not declare', () => {
    // The other direction. A variable removed from the example and left in the
    // prose sends a reader looking for something that does not exist.
    const declared = declaredVariables()
    const named = [...readme.matchAll(/`([A-Z][A-Z0-9_]{4,})`/g)].map((match) => match[1]!)
    const strays = [...new Set(named)].filter(
      (name) => !declared.includes(name) && !name.startsWith('MAX_') && name !== 'SELECT',
    )
    expect(strays, `named by the README but not declared: ${strays.join(', ')}`).toEqual([])
  })
})

describe('the README describes this gate', () => {
  it('shows a command for every npm script the gate uses', () => {
    // `npm test` is spelled without `run`, and getting that wrong made this
    // assertion vacuous: the first version asserted `npm run test`, which is a
    // prefix of `npm run test:db`, so the README could lose `npm test`
    // altogether and this still passed. Raised by Argus, and confirmed by
    // deleting the line and watching all thirteen stay green.
    //
    // Anchored to the start of a line for the same reason: `toContain` on a
    // command that prefixes another command is a coincidence, not a check.
    const commands: Record<string, string> = {
      lint: 'npm run lint',
      build: 'npm run build',
      test: 'npm test',
      'test:db': 'npm run test:db',
    }

    for (const [script, command] of Object.entries(commands)) {
      expect(scripts[script], `package.json has no "${script}" script`).toBeDefined()

      const shown = readme
        .split(/\r?\n/)
        .some((line) => line === command || line.startsWith(command + ' '))

      expect(shown, `the README never shows the command ${command}`).toBe(true)
    }
  })

  it('includes the type check, which no npm script runs', () => {
    // The one that is easiest to lose: it is not an npm script, so a reader
    // copying the block would simply not have it.
    expect(readme).toContain('tsc --noEmit')
  })

  it('says plainly that nothing runs automatically', () => {
    // The single most misleading sentence the old README carried was that CI
    // ran the gates on every push. Asserting the correction is present is the
    // only way that correction cannot quietly be edited back out.
    expect(readme).toMatch(/There is no CI|None of them run automatically/)
  })

  it('does not claim a pipeline runs them', () => {
    expect(readme).not.toMatch(/CI runs them|fails the pipeline/)
  })
})

describe('the README describes this tree', () => {
  it('counts the migrations correctly', () => {
    const count = readdirSync(join(root, 'migrations')).filter((name) =>
      name.endsWith('.sql'),
    ).length
    expect(readme).toContain(`${count} SQL migrations`)
  })

  it('names every top-level source directory that exists', () => {
    // Derived from the tree, not hard-coded. A list written by hand is the same
    // artefact as the Layout block it checks, and would go stale the same way --
    // which is how the old README came to say the remaining directories 'arrive
    // with the stories that need them' after four of them had arrived. Raised by
    // review.
    const ignored = new Set([
      'node_modules',
      '.next',
      '.git',
      '.claude',
      '.agents',
      '.probe',
      '.argus',
      '_bmad',
      '_bmad-output',
      '.vscode',
      '.github',
    ])

    const directories = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !ignored.has(entry.name))
      .map((entry) => `${entry.name}/`)

    expect(directories.length, 'no source directories found -- wrong root?').toBeGreaterThan(3)

    const missing = directories.filter((directory) => !readme.includes(directory))
    expect(missing, `the Layout block omits: ${missing.join(', ')}`).toEqual([])
  })

  it('names no vendor this project does not use', () => {
    // The defect that motivated the story, kept from recurring by name.
    expect(readme).not.toMatch(/Supabase/i)
  })
})

describe('the README describes these samples', () => {
  const sampleFiles = readdirSync(join(root, 'samples')).filter(
    (name) => !name.endsWith('.ts'),
  )

  it('names every committed sample', () => {
    const missing = sampleFiles.filter((file) => !readme.includes(file))
    expect(missing, `absent from the README: ${missing.join(', ')}`).toEqual([])
  })

  it('promises no sample that is not committed', () => {
    const promised = [...readme.matchAll(/`(samples\/)?([\w-]+\.(?:csv|xlsx?|pdf|png|jpg))`/g)].map(
      (match) => match[2]!,
    )
    const strays = [...new Set(promised)].filter((file) => !sampleFiles.includes(file))
    expect(strays, `promised by the README but not committed: ${strays.join(', ')}`).toEqual([])
  })

  it('tells a reader to upload the roll first', () => {
    // Without this the deposit sample holds every line and a new installer
    // concludes the application is broken. It is the single most consequential
    // sentence in the file.
    expect(readme).toContain('assessment-roll.csv')
    expect(readme).toMatch(/before anything else|upload first/i)
  })
})
