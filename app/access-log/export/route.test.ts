/**
 * The export endpoint's guard, which is the one most easily forgotten.
 *
 * A route handler is not covered by the page's guard, and this one returns the
 * whole audit trail — every question every board member has asked. The page
 * beside it is guarded and *looks* like it covers the directory, which is
 * exactly how an endpoint like this ships open.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.fn()
const recent = vi.fn()

vi.mock('@/adapters/auth/auth', () => ({ auth: () => auth() }))
vi.mock('@/adapters/db/query-log-reader-postgres', () => ({
  createQueryLogReader: () => ({ recent }),
}))

const RECORD = {
  id: '018f-1',
  actorId: 'user-7',
  executedAt: new Date('2026-08-12T01:00:00.000Z'),
  entryId: 'dues_status',
  entryVersion: 1,
  parameters: { unitNumber: '4B' },
  sqlText: 'select 1',
}

beforeEach(() => {
  vi.resetAllMocks()
  recent.mockResolvedValue([RECORD])
})

async function get(url = 'https://example.test/access-log/export') {
  const { GET } = await import('./route')
  return GET(new Request(url))
}

describe('who may download the audit trail', () => {
  it('refuses a caller with no session, and reads nothing', async () => {
    auth.mockResolvedValue(null)

    const response = await get()

    expect(response.status).toBe(404)
    // The assertion that matters: a handler that queried and *then* refused has
    // still put the whole trail through the database and into memory.
    expect(recent).not.toHaveBeenCalled()
  })

  it('refuses a session carrying no id', async () => {
    // Story 3.6b's finding, applied here too.
    auth.mockResolvedValue({ user: { email: 'treasurer@example.com' } })

    expect((await get()).status).toBe(404)
    expect(recent).not.toHaveBeenCalled()
  })

  it('serves a signed-in board member', async () => {
    // The positive control in the same breath: a handler that refused everyone
    // would satisfy both tests above.
    auth.mockResolvedValue({ user: { id: 'user-7' } })

    const response = await get()

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('dues_status')
  })
})

describe('what it sends', () => {
  beforeEach(() => {
    auth.mockResolvedValue({ user: { id: 'user-7' } })
  })

  it('is a CSV attachment, with an encoding it does not make the reader guess', async () => {
    const response = await get()

    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('content-disposition')).toContain('attachment')
  })

  it('is never cached', async () => {
    // Per-actor authorised content. A shared cache holding this would serve one
    // board member's export to the next caller.
    expect((await get()).headers.get('cache-control')).toBe('no-store')
  })

  it('honours the filter, so the download matches the screen', async () => {
    await get('https://example.test/access-log/export?actorId=user-9&entryId=dues_status')

    expect(recent).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'user-9', entryId: 'dues_status' }),
    )
  })

  it('neutralises a formula that reached the trail through a parameter', async () => {
    // End to end rather than only in the CSV module's own test: this is the path
    // the payload actually travels, and a route that built its own string would
    // pass that test and fail here.
    recent.mockResolvedValue([{ ...RECORD, parameters: { unitNumber: "=cmd|'/c calc'!A1" } }])

    const body = await (await get()).text()

    expect(body).not.toMatch(/(^|,)"=/)
    expect(body).toContain('cmd')
  })
})
