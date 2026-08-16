/**
 * No model is in the alerting path, enforced rather than described.
 *
 * Epic 4's independence claim rests on it, in as many words: *"detection and
 * alert copy are deterministic: SQL identifies the finding, templated prose
 * describes it, no reasoning model is involved anywhere in FR-6, FR-7 or FR-8.
 * The moment model-written alert prose is wanted, this epic acquires a hard
 * dependency on Epic 3 and the two stop being swappable."*
 *
 * That sentence was a planning assumption until this file. It is worth holding
 * to for three reasons that outlive the assumption:
 *
 * - **Falsifiability.** SM-2 claims *100%* of mathematically exact duplicates are
 *   flagged. That is a claim only a deterministic detector can be held to, and
 *   the same is true of the sentence describing it.
 * - **Cost.** An alert is sent per finding, unattended, from inside an upload.
 *   A model call there is a bill nobody is watching.
 * - **AD-8.** The email carries extracted values. Introducing a model into the
 *   path that renders them is precisely the interpolation AD-8 forbids —
 *   *"extracted strings are never string-interpolated into any prompt"* — and it
 *   would arrive as a rendering change rather than as an architecture decision.
 *
 * ## What this checks, and what it cannot
 *
 * It reads the modules that build and send an alert and asserts that none of
 * them reaches a model credential or imports a module that does. It cannot see a
 * model reached through a chain of three intermediaries, and it does not try —
 * the property worth holding is that the *alerting path itself* is
 * deterministic, and a reviewer looking at a diff that adds an import here will
 * see it.
 *
 * The detector is `readsEnvironmentVariable` from `dual-llm-boundary.ts`, reused
 * rather than copied. `forbidden-credentials.ts` states why that matters: a
 * guard that flags legitimate mentions "gets deleted by the first developer it
 * inconveniences", and a second copy of a subtle matcher is how the two
 * versions come to disagree.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { readsEnvironmentVariable } from './dual-llm-boundary'

const REPO_ROOT = process.cwd()

/**
 * Every module between a raised finding and a sent email.
 *
 * Listed rather than globbed, deliberately. A glob would silently stop covering
 * the path the moment a file moved, and the list is short enough that adding to
 * it is a conscious act — which is the point, since adding a module here is
 * exactly when somebody might be reaching for a model.
 */
const ALERTING_PATH = [
  'core/findings/alert-email.ts',
  'core/findings/finding-view.ts',
  'core/findings/detail-view.ts',
  'core/ingestion/notify-findings.ts',
  'adapters/mail/mail-sender-http.ts',
  'adapters/mail/env.ts',
  // The two adapters behind the ports `notifyFindings` calls. Omitting them was
  // a real hole: this file claimed to cover every module from a finding to an
  // email while the implementations of two of the four collaborators went
  // unread, so a credential read in either passed the guard. Raised by
  // CodeRabbit on the merge request.
  'adapters/db/finding-reader-postgres.ts',
  'adapters/db/finding-alert-postgres.ts',
] as const

/**
 * Names that would mean a model is reachable from here.
 *
 * Both sides of AD-10's boundary, plus the two ambient names CrewAI picks up on
 * its own — `.env.example` warns that setting either of those in the agent's
 * environment silently hands the reasoning model the extraction credential.
 */
const MODEL_CREDENTIALS = [
  'REASONING_API_KEY',
  'REASONING_MODEL',
  'GEMINI_API_KEY',
  'GEMINI_OCR_MODEL',
  'GOOGLE_API_KEY',
  'ANTHROPIC_API_KEY',
] as const

/** Modules whose whole purpose is to reach a model or the service that holds one. */
const MODEL_MODULES = ['adapters/extraction/', 'adapters/agent/', 'core/answer/'] as const

const sources = ALERTING_PATH.map((path) => ({
  path,
  text: readFileSync(join(REPO_ROOT, path), 'utf8'),
}))

describe('the alerting path can actually fail this check', () => {
  it('covers every module an alert passes through', () => {
    // **The coverage list itself is asserted**, because the checks below are
    // generated from it: dropping an entry removes its cases rather than
    // failing anything, so the guard can silently shrink to nothing. Found by
    // the sensitivity pass on the round that added the two adapters -- removing
    // one of them changed 19 passing tests into 17 passing tests.
    //
    // Four collaborators reach an alert, and each has an implementation: the
    // reader that chooses, the ledger that claims and records, the recipients,
    // and the sender. Two of those live in one adapter file, which is why this
    // is six paths and not seven.
    expect([...ALERTING_PATH].sort()).toEqual(
      [
        'adapters/db/finding-alert-postgres.ts',
        'adapters/db/finding-reader-postgres.ts',
        'adapters/mail/env.ts',
        'adapters/mail/mail-sender-http.ts',
        'core/findings/alert-email.ts',
        'core/findings/detail-view.ts',
        'core/findings/finding-view.ts',
        'core/ingestion/notify-findings.ts',
      ].sort(),
    )
  })

  it('reads every module it names, and none of them is empty', () => {
    // The control. A path that silently read nothing would report no violations
    // for the best possible reason and the worst possible one, and they look
    // identical from outside.
    expect(sources).toHaveLength(ALERTING_PATH.length)
    for (const source of sources) {
      expect(source.text.length).toBeGreaterThan(200)
    }
  })

  it('would notice a credential read if one were added', () => {
    // The detector is not being trusted on its own say-so. If this stops
    // failing, the assertions below have stopped meaning anything.
    //
    // **The probe text is interpolated, never written out.** A literal
    // `process.env.REASONING_API_KEY` here would be a real credential read as
    // far as any text scanner is concerned -- and `dual-llm-boundary.test.ts`
    // duly reported this file as one that reads both sides of AD-10's boundary
    // the first time it was written that way. `dual-llm-boundary.test.ts` plants
    // its own probes by interpolation for exactly this reason.
    const [reasoning, extraction] = [MODEL_CREDENTIALS[0], MODEL_CREDENTIALS[2]]

    expect(readsEnvironmentVariable(`const k = process.env.${reasoning}`, reasoning)).toBe(true)
    expect(readsEnvironmentVariable(`const { ${extraction} } = process.env`, extraction)).toBe(true)
    // And the other direction: a mention that is not a read must not count, or
    // this file's own list of names would be a violation.
    expect(readsEnvironmentVariable(`a comment mentioning ${reasoning}`, reasoning)).toBe(false)
  })

  it('would notice an import of a model module if one were added', () => {
    expect(mentionsModelModule("import { x } from '../../adapters/agent/chat-client'")).toBe(true)
    expect(mentionsModelModule("import { y } from '../ports/mail'")).toBe(false)
  })
})

describe('FR-8 is deterministic', () => {
  it.each(sources)('$path reaches no model credential', ({ text }) => {
    for (const credential of MODEL_CREDENTIALS) {
      expect(readsEnvironmentVariable(text, credential)).toBe(false)
    }
  })

  it.each(sources)('$path imports no module whose job is to reach a model', ({ text }) => {
    expect(mentionsModelModule(text)).toBe(false)
  })
})

/**
 * An import of a module that exists to reach a model.
 *
 * Matched on the specifier rather than anywhere in the text, so a comment
 * *mentioning* `adapters/agent` — and this story's files do mention it, because
 * `chat-client.ts` is the template the mail adapter was written from — is not a
 * violation. A guard that fires on its own documentation is the one that gets
 * deleted.
 */
function mentionsModelModule(text: string): boolean {
  const specifiers = [...text.matchAll(/\b(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g)].map(
    (match) => match[1] ?? '',
  )

  return specifiers.some((specifier) =>
    MODEL_MODULES.some((module) => specifier.includes(module.replace(/\/$/, ''))),
  )
}
