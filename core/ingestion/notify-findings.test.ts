/**
 * Telling the board, and everything that must not stop it.
 *
 * ## The failure here is silence, and silence looks like success
 *
 * Every other step in ingestion fails visibly — a wrong number on a page
 * somebody is looking at, or an upload that reports an error. An alert that is
 * never sent looks exactly like a month with no findings: the dashboard still
 * shows the finding, the upload still succeeds, and nothing is broken enough to
 * notice.
 *
 * So most of what follows is about **not stopping**. One finding whose send
 * fails must cost exactly one finding. A collaborator that throws must not fail
 * an upload whose document really was read. And the reporting of a failure must
 * not itself become one — the defect `run-detection.ts` was fixed for.
 *
 * ## The clock is a parameter
 *
 * The staleness boundary is computed from it, and a test cannot wait fifteen
 * minutes for a claim to go stale. Injecting it is what makes the retry path —
 * the whole of the recovery story — testable at all.
 */

import { describe, expect, it, vi } from 'vitest'

import type { BoardRecipients } from '../ports/board-recipients'
import type { FindingAlertLedger } from '../ports/finding-alert'
import type { FindingDetail, FindingReader } from '../ports/finding-reader'
import { MailNotSentError, type MailMessage, type MailSender } from '../ports/mail'
import { POSSIBLE_DUPLICATE_INVOICE } from '../findings/finding-view'
import { ALERT_RETRY_AFTER_MS, MOST_ALERTS_PER_RUN, notifyFindings } from './notify-findings'

const BASE = 'https://watchdog.example.test'
const NOW = new Date('2026-03-11T09:00:00Z')

const finding = (id: string): FindingDetail => ({
  id,
  findingType: POSSIBLE_DUPLICATE_INVOICE,
  subjectId: '0199a0f0-0000-7000-8000-0000000000ff',
  period: { from: '2026-03-01', until: '2026-04-01' },
  evidence: {
    invoicesChecked: 12,
    pairs: [{ vendorName: 'Coastal Landscaping', amount: '1240.00', matchReason: 'exact' }],
  },
  raisedOn: '2026-03-11',
  reviewed: null,
})

/** A reader that answers with the findings given, and records how it was asked. */
function reader(findings: readonly FindingDetail[]) {
  const limits: number[] = []
  const port = {
    unreviewed: vi.fn(),
    byId: vi.fn(),
    register: vi.fn(),
    awaitingAlert: vi.fn(async (limit: number) => {
      limits.push(limit)

      return findings
    }),
  } as unknown as FindingReader

  return { port, limits }
}

/** A ledger that grants every claim unless told otherwise. */
function ledger(options: { claim?: (id: string) => Promise<boolean> } = {}) {
  const claimed: { id: string; staleBefore: Date }[] = []
  const sent: { id: string; recipients: readonly string[] }[] = []
  const failed: { id: string; failure: string }[] = []

  const port: FindingAlertLedger = {
    async claim(findingId, staleBefore) {
      claimed.push({ id: findingId, staleBefore })

      return options.claim === undefined ? true : options.claim(findingId)
    },
    async recordSent(findingId, recipients) {
      sent.push({ id: findingId, recipients })
    },
    async recordFailure(findingId, failure) {
      failed.push({ id: findingId, failure })
    },
  }

  return { port, claimed, sent, failed }
}

function recipients(addresses: readonly string[]) {
  const calls: number[] = []
  const port: BoardRecipients = {
    async active() {
      calls.push(1)

      return addresses
    },
  }

  return { port, calls }
}

function mailer(options: { failOn?: (message: MailMessage) => boolean } = {}) {
  const sent: MailMessage[] = []
  const port: MailSender = {
    async send(message) {
      if (options.failOn?.(message) === true) {
        throw new MailNotSentError('the provider refused it')
      }

      sent.push(message)
    },
  }

  return { port, sent }
}

const wired = (over: Record<string, unknown> = {}) => ({
  findings: reader([finding('f-1')]).port,
  alerts: ledger().port,
  recipients: recipients(['treasurer@example.test']).port,
  mail: mailer().port,
  baseUrl: BASE,
  now: () => NOW,
  ...over,
})

describe('a collaborator that is not wired means nothing happens', () => {
  it.each([['findings'], ['alerts'], ['recipients'], ['mail'], ['baseUrl']])(
    'does nothing at all when %s is absent',
    async (absent) => {
      // "Do nothing" rather than "throw", the rule `run-detection.ts` states —
      // and the gap it names: a document is read, stored, and the board is never
      // told, with nothing failing. The wiring test below is what keeps that
      // honest.
      await expect(notifyFindings(wired({ [absent]: undefined }))).resolves.toBeNull()
    },
  )

  it.each([['mail'], ['baseUrl']])(
    'writes no delivery row when %s is missing, not even a claim',
    async (absent) => {
      // **Returning `null` is not the whole of the requirement.** An
      // unconfigured deploy must leave the ledger untouched: a claim is
      // ownership of a send, and taking it without being able to deliver would
      // hold every finding for the retry window on every upload, so nothing
      // else could try either.
      //
      // The earlier assertion above passes against an implementation that
      // claims first and returns `null` afterwards, which is why this one
      // exists. Found by the acceptance-criteria audit.
      const alerts = ledger()
      const mail = mailer()

      await notifyFindings(wired({ alerts: alerts.port, mail: mail.port, [absent]: undefined }))

      expect(alerts.claimed).toEqual([])
      expect(alerts.sent).toEqual([])
      expect(alerts.failed).toEqual([])
      expect(mail.sent).toEqual([])
    },
  )
})

describe('telling the board', () => {
  it('claims, sends and records one finding', async () => {
    const alerts = ledger()
    const mail = mailer()
    const outcome = await notifyFindings(
      wired({ alerts: alerts.port, mail: mail.port, recipients: recipients(['a@example.test', 'b@example.test']).port }),
    )

    expect(outcome).toEqual({ sent: 1, failed: 0, skipped: 0, remaining: 0 })
    expect(alerts.claimed.map((claim) => claim.id)).toEqual(['f-1'])
    expect(mail.sent).toHaveLength(1)
    expect(mail.sent[0]!.to).toEqual(['a@example.test', 'b@example.test'])
    // The record must name the list that was actually sent to.
    expect(alerts.sent).toEqual([{ id: 'f-1', recipients: ['a@example.test', 'b@example.test'] }])
    expect(alerts.failed).toEqual([])
  })

  it('links each message at the configured base', async () => {
    const mail = mailer()
    await notifyFindings(wired({ mail: mail.port }))

    expect(mail.sent[0]!.text).toContain(`${BASE}/findings/f-1`)
  })

  it('reads the board once per run, not once per finding', async () => {
    // Three findings and one read. A read per finding is three round trips for
    // an answer that cannot change inside one run.
    const people = recipients(['a@example.test'])
    await notifyFindings(
      wired({
        findings: reader([finding('f-1'), finding('f-2'), finding('f-3')]).port,
        recipients: people.port,
      }),
    )

    expect(people.calls).toHaveLength(1)
  })

  it('bounds what one run will send', async () => {
    const findings = reader([finding('f-1')])
    await notifyFindings(wired({ findings: findings.port }))

    expect(findings.limits).toEqual([MOST_ALERTS_PER_RUN])
  })

  it('says how many it left for the next run', async () => {
    // A cap that drops work silently reads as "everything was sent". The
    // outcome has to be able to say otherwise.
    const full = Array.from({ length: MOST_ALERTS_PER_RUN }, (_unused, index) =>
      finding(`f-${index}`),
    )
    const outcome = await notifyFindings(wired({ findings: reader(full).port }))

    expect(outcome!.sent).toBe(MOST_ALERTS_PER_RUN)
    // A full page means there may be more behind it; the reader is bounded and
    // cannot say how many, so "at least one" is the honest answer.
    expect(outcome!.remaining).toBeGreaterThan(0)
  })

  it('computes the staleness boundary from the injected clock', async () => {
    const alerts = ledger()
    await notifyFindings(wired({ alerts: alerts.port }))

    expect(alerts.claimed[0]!.staleBefore).toEqual(new Date(NOW.getTime() - ALERT_RETRY_AFTER_MS))
  })
})

describe('an empty board', () => {
  it('sends nothing and claims nothing', async () => {
    // Nobody to tell is not the same as a send with no recipients, which
    // migration 023 refuses to record. Claiming here would take ownership of a
    // send that cannot happen, and the claim would have to go stale before
    // anybody else could try.
    const alerts = ledger()
    const mail = mailer()

    const outcome = await notifyFindings(
      wired({ alerts: alerts.port, mail: mail.port, recipients: recipients([]).port }),
    )

    expect(outcome).toEqual({ sent: 0, failed: 0, skipped: 0, remaining: 0 })
    expect(alerts.claimed).toEqual([])
    expect(mail.sent).toEqual([])
  })
})

describe('one finding must cost exactly one finding', () => {
  it('keeps going when a send fails in the middle of the batch', async () => {
    const alerts = ledger()
    const mail = mailer({ failOn: (message) => message.text.includes('f-2') })

    const outcome = await notifyFindings(
      wired({
        findings: reader([finding('f-1'), finding('f-2'), finding('f-3')]).port,
        alerts: alerts.port,
        mail: mail.port,
      }),
    )

    expect(outcome).toEqual({ sent: 2, failed: 1, skipped: 0, remaining: 0 })
    expect(alerts.sent.map((entry) => entry.id)).toEqual(['f-1', 'f-3'])
    expect(alerts.failed.map((entry) => entry.id)).toEqual(['f-2'])
  })

  it('never records a failed send as sent', async () => {
    const alerts = ledger()
    const mail = mailer({ failOn: () => true })

    await notifyFindings(wired({ alerts: alerts.port, mail: mail.port }))

    expect(alerts.sent).toEqual([])
    expect(alerts.failed).toHaveLength(1)
  })

  it('never records a successful send as failed', async () => {
    const alerts = ledger()

    await notifyFindings(wired({ alerts: alerts.port }))

    expect(alerts.failed).toEqual([])
    expect(alerts.sent).toHaveLength(1)
  })

  it('leaves a finding another run already owns alone', async () => {
    // A lost claim is neither a failure nor a send. Counting it as either would
    // make the outcome say something untrue about what this run did.
    const alerts = ledger({ claim: async () => false })
    const mail = mailer()

    const outcome = await notifyFindings(wired({ alerts: alerts.port, mail: mail.port }))

    expect(outcome).toEqual({ sent: 0, failed: 0, skipped: 1, remaining: 0 })
    expect(mail.sent).toEqual([])
    expect(alerts.sent).toEqual([])
    expect(alerts.failed).toEqual([])
  })

  it('reports the failure without letting it escape', async () => {
    const onError = vi.fn()
    const mail = mailer({ failOn: () => true })

    await expect(
      notifyFindings(wired({ mail: mail.port, onError })),
    ).resolves.toMatchObject({ failed: 1 })

    expect(onError).toHaveBeenCalledTimes(1)
    // The finding, not the document. `ingest.ts` shipped a version that logged a
    // uuid under the label `filename` because both were strings, and Argus
    // caught it -- the label is the only thing that makes the line legible.
    expect(onError.mock.calls[0]![1]).toBe('f-1')
  })
})

describe('nothing here may fail an upload that succeeded', () => {
  it('resolves when the reader itself throws', async () => {
    const findings = {
      awaitingAlert: async () => {
        throw new Error('the register was unreachable')
      },
    } as unknown as FindingReader

    await expect(notifyFindings(wired({ findings }))).resolves.toEqual({
      sent: 0,
      failed: 0,
      skipped: 0,
      remaining: 0,
    })
  })

  it('resolves when the recipient read throws', async () => {
    const people = {
      active: async () => {
        throw new Error('the directory was unreachable')
      },
    } as unknown as BoardRecipients

    await expect(notifyFindings(wired({ recipients: people }))).resolves.toBeDefined()
  })

  it('resolves when recording the send throws after the mail went', async () => {
    // The case that spends the at-least-once guarantee: the email is in an
    // inbox and the row that would stop it being sent again was not written. It
    // is reported and survived, never thrown -- the document really was read.
    const onError = vi.fn()
    const alerts = ledger()
    alerts.port.recordSent = async () => {
      throw new Error('the ledger was unreachable')
    }

    await expect(
      notifyFindings(wired({ alerts: alerts.port, onError })),
    ).resolves.toBeDefined()
    expect(onError).toHaveBeenCalled()
  })

  it('survives an onError that itself throws', async () => {
    // Reporting the failure must not become the failure. A logger with a broken
    // transport is an ordinary thing to have, and thrown from here it would
    // escape into an ingestion path that had already stored the document's
    // records. The exact defect `run-detection.ts` was fixed for.
    const onError = vi.fn(() => {
      throw new Error('the log transport is down')
    })
    const mail = mailer({ failOn: () => true })

    await expect(notifyFindings(wired({ mail: mail.port, onError }))).resolves.toBeDefined()
  })

  it('keeps going when claiming one finding throws', async () => {
    const alerts = ledger()
    let calls = 0
    alerts.port.claim = async () => {
      calls += 1
      if (calls === 1) throw new Error('the ledger blinked')

      return true
    }

    const outcome = await notifyFindings(
      wired({ findings: reader([finding('f-1'), finding('f-2')]).port, alerts: alerts.port }),
    )

    expect(outcome).toMatchObject({ sent: 1, failed: 1 })
  })
})

describe('the retry that makes a failed send recoverable', () => {
  it('re-claims once the earlier claim has gone stale', async () => {
    // The whole of the recovery story, and it is only testable because the
    // clock is a parameter. A run that claimed and then died leaves the board
    // never warned; the boundary moving forward is what lets the next run in.
    const alerts = ledger()
    const later = new Date(NOW.getTime() + ALERT_RETRY_AFTER_MS * 2)

    await notifyFindings(wired({ alerts: alerts.port }))
    await notifyFindings(wired({ alerts: alerts.port, now: () => later }))

    expect(alerts.claimed).toHaveLength(2)
    expect(alerts.claimed[1]!.staleBefore.getTime()).toBeGreaterThan(
      alerts.claimed[0]!.staleBefore.getTime(),
    )
  })
})
