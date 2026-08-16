/**
 * The register export route (AC4, AC5, AC6).
 *
 * ## The guard is the point of this file
 *
 * A route handler is not covered by the page's guard, and this one returns the
 * association's entire reviewed history. It is the single most attractive
 * request in the product to an unauthenticated caller and the easiest to
 * forget, because the page beside it is guarded and looks like it covers the
 * directory.
 *
 * Asserted by **the reader never being called**, not only by the status code: a
 * handler that queries first and refuses afterwards has already put the whole
 * record on the wire.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FindingDetail } from '@/core/ports/finding-reader'

const auth = vi.fn()
const registerRead = vi.fn<(filter: unknown) => Promise<{ findings: FindingDetail[]; total: number }>>()

vi.mock('@/adapters/auth/auth', () => ({ auth: () => auth() }))
vi.mock('@/adapters/db/finding-reader-postgres', () => ({
  createFindingReader: () => ({ register: registerRead, unreviewed: vi.fn(), byId: vi.fn() }),
}))

const { GET } = await import('./route')

function finding(overrides: Partial<FindingDetail> = {}): FindingDetail {
  return {
    id: '018f3a2b-4c5d-7e8f-9a0b-1c2d3e4f5a6b',
    findingType: 'possible_duplicate_invoice',
    subjectId: 'document-1',
    period: { from: '2026-04-01', until: '2026-05-01' },
    evidence: {
      invoicesChecked: 3,
      pairs: [{ reason: 'same-amount-and-date', vendorName: 'Coastal Landscaping', amount: '1450.00' }],
    },
    raisedOn: '2026-04-14',
    reviewed: { by: 'R. Mbeki', on: '2026-04-20' },
    ...overrides,
  }
}

const get = (url = 'https://watchdog.test/findings/register/export') =>
  GET(new Request(url))

beforeEach(() => {
  vi.clearAllMocks()
  auth.mockResolvedValue({ user: { id: 'member-1', email: 'board@example.org' } })
  registerRead.mockResolvedValue({ findings: [finding()], total: 1 })
})

afterEach(() => {
  vi.resetModules()
})

describe('AC6: it authenticates before it reads', () => {
  it.each([
    ['no session', null],
    ['a session carrying no user', {}],
    ['a user with no id', { user: { email: 'board@example.org' } }],
  ])('answers 404 for %s', async (_name, session) => {
    auth.mockResolvedValue(session)

    const response = await get()

    expect(response.status).toBe(404)
  })

  it('reads nothing at all for a caller it refuses', async () => {
    // **The assertion this file exists for.** A 404 is satisfied by a handler
    // that fetches the whole reviewed history and then declines to return it.
    auth.mockResolvedValue(null)

    await get()

    expect(registerRead).not.toHaveBeenCalled()
  })

  it('does not confirm the endpoint exists', async () => {
    // 404, not 401. Whether this route is here is not something an anonymous
    // caller needs told.
    auth.mockResolvedValue(null)

    const response = await get()

    expect(response.status).not.toBe(401)
    expect(response.status).not.toBe(403)
  })
})

describe('AC4: what downloads is what was on screen', () => {
  it('passes the search through to the register', async () => {
    await get('https://watchdog.test/findings/register/export?search=Coastal')

    expect(registerRead).toHaveBeenCalledWith({ search: 'Coastal', limit: 50 })
  })

  it('passes the limit through', async () => {
    await get('https://watchdog.test/findings/register/export?limit=25')

    expect(registerRead).toHaveBeenCalledWith({ limit: 25 })
  })

  it('asks for no search when none was given', async () => {
    await get()

    expect(registerRead).toHaveBeenCalledWith({ limit: 50 })
  })

  it('reads a repeated parameter the same way the page does', async () => {
    // **Found by the whole-story review, and invisible to either task alone.**
    // Next.js hands the page an *array* for a repeated parameter, and
    // `filterFrom` takes the first of it. `Object.fromEntries(searchParams)`
    // keeps only the **last**. So `?search=a&search=b` showed the reader
    // findings matching "a" and offered them a download of findings matching
    // "b" — the page and its export quietly disagreeing, which is the one thing
    // AC4 exists to prevent.
    await get('https://watchdog.test/findings/register/export?search=Coastal&search=Harbour')

    expect(registerRead).toHaveBeenCalledWith({ search: 'Coastal', limit: 50 })
  })

  it('reads a repeated limit the same way too', async () => {
    await get('https://watchdog.test/findings/register/export?limit=25&limit=200')

    expect(registerRead).toHaveBeenCalledWith({ limit: 25 })
  })

  it('reads the filter the same way the page does', async () => {
    // Same module, so a URL cannot mean one thing to the page and another to
    // the file it offers — which is how an export comes to hold a different
    // document from the one on screen.
    await get('https://watchdog.test/findings/register/export?search=%20%20&limit=0.5')

    expect(registerRead).toHaveBeenCalledWith({ limit: 50 })
  })
})

describe('AC5: what comes back is a CSV a spreadsheet can open', () => {
  it('answers 200 with the register', async () => {
    const response = await get()

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('Possible duplicate invoice — Coastal Landscaping')
  })

  it('declares itself as CSV in UTF-8', async () => {
    const response = await get()

    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8')
  })

  it('opens with a byte order mark, because the header alone does not reach Excel', async () => {
    // Excel ignores `charset=utf-8` on a downloaded file and falls back to the
    // system codepage, so a member named José arrives as JosÃ© in the record of
    // who reviewed what.
    //
    // **Read as bytes.** `Response.text()` UTF-8 decodes, and that strips a
    // leading BOM — so an assertion on the text can never see one and fails
    // against a response that carries it. `app/access-log/export/route.test.ts`
    // records the same trap, and the first version of this test walked into it.
    const bytes = new Uint8Array(await (await get()).arrayBuffer())

    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf])
  })

  it('is offered as a download rather than rendered in a tab', async () => {
    const response = await get()
    const disposition = response.headers.get('content-disposition') ?? ''

    expect(disposition).toMatch(/^attachment/)
    expect(disposition).toContain('reviewed-findings.csv')
  })

  it('is never cached, because a board packet must not omit the latest review', async () => {
    const response = await get()

    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('returns a header row even when the register is empty', async () => {
    // A zero-byte file is indistinguishable from a failed download.
    registerRead.mockResolvedValue({ findings: [], total: 0 })

    const body = await (await get()).text()

    expect(body).toContain('"id"')
    expect(body.length).toBeGreaterThan(1)
  })
})
