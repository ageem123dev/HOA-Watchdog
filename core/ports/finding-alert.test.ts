/**
 * What the alert ledger is allowed to do, and what it must not be able to say.
 *
 * Three arguments live in these shapes.
 *
 * **Claiming answers a question, so it returns one.** A `Promise<void>` claim
 * cannot tell "I own this send" from "somebody else already does", and a caller
 * that cannot tell will send anyway. That is the duplicate AD-13 forbids,
 * arriving through a return type.
 *
 * **The staleness boundary is handed in, never read.** A ledger that consulted
 * the clock itself could not be tested for the retry window without moving the
 * machine's date. The seam is `staleBefore`, and it exists so the test can force
 * a stale claim rather than wait for one.
 *
 * **There is no way to un-send.** Migration 023's trigger refuses it and its
 * grants revoke the delete, so a method declared here would be one the database
 * answers with an exception on its first call. Two statements of one rule, which
 * is safe precisely because something fails when they disagree — the arrangement
 * migration 007's comment argues for.
 *
 * Choosing *what* to alert on is deliberately not here. It is a read of the
 * register and it belongs on `FindingReader` with the other three, for the
 * reason that file gives: one object that could both choose the work and claim
 * it is one refactor from a mailer that decides what the board hears about.
 *
 * The helper is `core/ports/declared-members.ts`, which has its own tests.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { declaredMembers } from './declared-members'

const HERE = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(HERE, 'finding-alert.ts'), 'utf8')
const readerSource = readFileSync(join(HERE, 'finding-reader.ts'), 'utf8')

describe('the FindingAlertLedger port', () => {
  it('declares exactly claim, sent and failed', () => {
    // The absence of anything that removes or rewrites a delivery is the
    // assertion. `recordSent` and `recordFailure` are both one-way stamps on a
    // row that already exists, which is why neither takes the finding's
    // contents — only its id.
    expect(declaredMembers(source, 'FindingAlertLedger')).toEqual([
      'claim(findingId: string, staleBefore: Date): Promise<boolean>',
      'recordSent(findingId: string, recipients: readonly string[]): Promise<void>',
      'recordFailure(findingId: string, failure: string): Promise<void>',
    ])
  })
})

describe('choosing what to alert on is a read of the register', () => {
  it('sits on FindingReader with the other reads, bounded like them', () => {
    // Membership, not the whole list. `finding-reader.test.ts` owns the
    // exhaustive assertion; restating it here would be one list in two files,
    // and the pair would drift the first time somebody updated only the one
    // they were looking at.
    //
    // Bounded for the reason `unreviewed` and `register` are: a caller that
    // forgets a limit is the one that reads a table which only grows. The
    // detail shape rather than the id, because the message is built from the
    // finding's own evidence and a second read to fetch it would be a second
    // chance for the two to disagree.
    expect(declaredMembers(readerSource, 'FindingReader')).toContain(
      'awaitingAlert(limit: number): Promise<readonly FindingDetail[]>',
    )
  })

  it('is a read, so it is not on the ledger', () => {
    // The split, from the other side. One object able to both choose the work
    // and claim it is one refactor from a mailer that decides what the board
    // hears about.
    expect(declaredMembers(source, 'FindingAlertLedger').join(' ')).not.toMatch(/awaiting/i)
  })
})
