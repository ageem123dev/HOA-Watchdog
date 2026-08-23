/**
 * That the board is actually told, and by every path a document can take.
 *
 * `detection-wiring.test.ts` exists because a step that is silently never called
 * **fails nothing** — a document is read, stored, and never compared against
 * what came before, and every test stays green. This file is that argument one
 * step further along, where it is sharper: an alert that is never sent looks
 * exactly like a month with no findings, because the dashboard still shows the
 * finding and the upload still succeeds.
 *
 * `notifyFindings` treats missing collaborators as "do nothing", which is what
 * keeps every caller written before this story working. That default is a real
 * gap rather than a neutral one, and these assertions are the only thing between
 * it and a mailer nobody notices is unwired.
 *
 * The call sites are read as source, for the reason those files give: a route
 * handler needs a session, a database and an object store before it runs a line,
 * and the question here is narrower than any of that — does the wiring exist.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8')

const CALL_SITES = [
  {
    // Story 5.7 moved this composition out of the upload action: a mapping
    // change re-imports through `ingest` too, and two hand-built dependency
    // objects would drift. Asserting it here now covers both callers at once.
    what: 'the shared ingestion composition (the upload action, the path an invoice CSV takes)',
    path: 'app/ingestion-dependencies.ts',
  },
  {
    what: 'the extract route, the path a scanned invoice takes',
    path: 'app/api/documents/[id]/extract/route.ts',
  },
] as const

describe.each(CALL_SITES)('$what', ({ path }) => {
  const source = read(path)

  it('passes a finding reader, so something can choose what to alert on', () => {
    expect(source).toMatch(/findingReader:\s*createFindingReader\(\)/)
  })

  it('passes the alert ledger, so a warning is sent once and not twice', () => {
    expect(source).toMatch(/alerts:\s*createFindingAlertLedger\(\)/)
  })

  it('passes the recipient list', () => {
    expect(source).toMatch(/recipients:\s*createBoardRecipients\(\)/)
  })

  it('passes the mailer and the base URL together', () => {
    // Together, because either alone does nothing: `notifyFindings` needs every
    // collaborator, and a mailer with no base URL would build links that are
    // dead in an inbox.
    expect(source).toContain('...alerting')
  })

  it('imports them from the adapters rather than building its own', () => {
    // A hand-rolled sender here would be a second component that owns sending,
    // and a second one is how the same warning goes out twice.
    expect(source).toContain("from '@/adapters/db/finding-alert-postgres'")
    expect(source).toContain("from '@/adapters/mail/mail-sender-http'")
  })

  it('resolves mail configuration at the call site, not inside core', () => {
    // `core/` imports nothing outward, so it cannot read the environment. The
    // call site turns absent configuration into an absent collaborator, which
    // is the shape `notifyFindings` already treats as "do nothing" -- rather
    // than a string-matched error class crossing the boundary.
    expect(source).toMatch(/alerting\s*=\s*createAlerting\(/)
  })
})

const INGESTION_PATHS = [
  { what: 'the deferred path, for a scan a model has to read', path: 'core/ingestion/extract-document.ts' },
  { what: 'the immediate path, for a CSV parsed at upload', path: 'core/ingestion/ingest.ts' },
] as const

describe.each(INGESTION_PATHS)('$what calls it after detection', ({ path }) => {
  const source = read(path)

  it('notifies, and only after detection has run', () => {
    // A finding cannot be mailed before it is raised. Asserted as an ordering
    // rather than as two independent presences, because both being present in
    // the wrong order is exactly the bug that sends nothing on the run that
    // found something.
    const detect = source.indexOf('await runDetection(')
    const notify = source.indexOf('await notifyFindings(')

    expect(detect).toBeGreaterThan(-1)
    expect(notify).toBeGreaterThan(-1)
    expect(notify).toBeGreaterThan(detect)
  })

  it('cannot let the alert fail the upload, even if notifyFindings breaks its contract', () => {
    // **The first version asserted the symbol was present**, which the test
    // above already proves -- so it passed with the guard deleted. Raised by
    // CodeRabbit.
    //
    // `notifyFindings` resolves rather than throwing and its own suite holds it
    // to that, but this `try` reports a persistence failure *after* the write
    // committed. A rejection escaping here would tell a treasurer their figures
    // were not saved when they were. So the call is wrapped, and this asserts
    // the wrapping rather than the call.
    const call = source.indexOf('await notifyFindings(')
    expect(call).toBeGreaterThan(-1)

    const before = source.slice(0, call)
    const after = source.slice(call)

    // Opened immediately before the call, and closed by a catch immediately
    // after it — not by some outer block that also covers the persistence.
    expect(before.trimEnd().endsWith('try {')).toBe(true)
    // The binding is optional: `catch {` today, `catch (error) {` the moment
    // somebody logs it. A guard that fails on a legitimate change is one that
    // gets loosened until it forbids nothing. Raised by Argus.
    expect(after).toMatch(/\}\s*catch\s*(?:\([^)]*\)\s*)?\{/)
  })
})
