/**
 * The one place this system talks to the outside world on its own initiative.
 *
 * ## The dangerous direction is resolving, not rejecting
 *
 * Every other client in this repository argues that a failure must not become an
 * empty success. Here the consequence is sharper than usual: the ledger writes a
 * delivery row when this resolves, and **that row is what stops the alert ever
 * being retried**. A false success is not a missed email — it is permanent
 * silence for that finding, with a database record saying the board was warned.
 *
 * So most of this file is one property approached from seven directions: *this
 * resolves only when the message actually went.*
 *
 * The reverse check matters too. It must refuse to *try* when trying could not
 * succeed — an empty recipient list, or one with a hole in it — so that no
 * delivery row is ever written for a send that was never possible.
 *
 * ## Nothing here reaches the network
 *
 * `fetch` is injected. Every failure below is forced with a stub rather than
 * assumed, which is what makes the assertions about timeouts and error bodies
 * mean anything.
 */

import { describe, expect, it, vi } from 'vitest'

import { MailNotSentError } from '../../core/ports/mail'
import { MailNotConfiguredError, readBaseUrl, readMailConfig } from './env'
import { createHttpMailSender } from './mail-sender-http'

const KEY = 'mail-key-do-not-leak-9f3a'

const env = (overrides: Record<string, string | undefined> = {}) => ({
  MAIL_API_URL: 'https://mail.example.test/v1/send',
  MAIL_API_KEY: KEY,
  MAIL_FROM: 'watchdog@association.example.test',
  WATCHDOG_BASE_URL: 'https://watchdog.example.test',
  ...overrides,
})

const message = {
  to: ['treasurer@example.test', 'president@example.test'],
  subject: 'Watchdog: Possible duplicate invoice',
  text: 'Two payments to Coastal Landscaping match on amount and date.',
}

/** A stub that records what it was called with and answers however the test says. */
function stubFetch(answer: () => Promise<Response> | Response) {
  const calls: { url: string; init: RequestInit }[] = []
  const doFetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })

    return answer()
  })

  return { calls, doFetch: doFetch as unknown as typeof globalThis.fetch }
}

const ok = (body: unknown = { id: 'provider-message-id' }) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

describe('reading the configuration', () => {
  it('yields the three values when all of them are set', () => {
    expect(readMailConfig(env())).toEqual({
      url: 'https://mail.example.test/v1/send',
      key: KEY,
      from: 'watchdog@association.example.test',
    })
  })

  it.each([['MAIL_API_URL'], ['MAIL_API_KEY'], ['MAIL_FROM']])(
    'refuses when %s is absent, and names it',
    (variable) => {
      expect(() => readMailConfig(env({ [variable]: undefined }))).toThrow(MailNotConfiguredError)

      try {
        readMailConfig(env({ [variable]: undefined }))
      } catch (error) {
        expect((error as MailNotConfiguredError).missing).toContain(variable)
      }
    },
  )

  it.each([['MAIL_API_URL'], ['MAIL_API_KEY'], ['MAIL_FROM']])(
    'treats a blank %s as absent, because a blank credential is not one',
    (variable) => {
      expect(() => readMailConfig(env({ [variable]: '   ' }))).toThrow(MailNotConfiguredError)
    },
  )

  it('never puts a value in the message, only a name', () => {
    // A configuration error is the message most likely to be pasted into an
    // issue, and one of these names a bearer token.
    try {
      readMailConfig(env({ MAIL_FROM: undefined }))
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as Error).message).not.toContain(KEY)
      expect((error as Error).message).toContain('MAIL_FROM')
    }
  })

  it('refuses a MAIL_API_URL that is not a URL', () => {
    expect(() => readMailConfig(env({ MAIL_API_URL: 'not a url' }))).toThrow(MailNotConfiguredError)
    expect(() => readMailConfig(env({ MAIL_API_URL: '/v1/send' }))).toThrow(MailNotConfiguredError)
  })

  it('refuses a plaintext MAIL_API_URL, because the key travels to it', () => {
    // The bearer token goes in a header to whatever this names, so the scheme
    // here is a credential boundary rather than a preference -- the rule
    // `chat-client.ts` states for AGENT_BASE_URL, and for the same reason:
    // `fetch` will open `http:` quite happily.
    //
    // This is deliberately *not* the rule for WATCHDOG_BASE_URL below. That one
    // carries no credential; it is an address a director's browser follows.
    expect(() => readMailConfig(env({ MAIL_API_URL: 'http://mail.example.test/v1/send' }))).toThrow(
      MailNotConfiguredError,
    )
  })

  it('reads an absolute base URL for the link a board member follows', () => {
    expect(readBaseUrl(env())).toBe('https://watchdog.example.test')
  })

  it('drops a trailing slash so the link has one spelling', () => {
    expect(readBaseUrl(env({ WATCHDOG_BASE_URL: 'https://watchdog.example.test/' }))).toBe(
      'https://watchdog.example.test',
    )
  })

  it('refuses a base URL that is a path', () => {
    // Links built from one work in development and are dead in every inbox,
    // which is the worst place to discover it.
    expect(() => readBaseUrl(env({ WATCHDOG_BASE_URL: '/dashboard' }))).toThrow(
      MailNotConfiguredError,
    )
    expect(() => readBaseUrl(env({ WATCHDOG_BASE_URL: 'watchdog.example.test' }))).toThrow(
      MailNotConfiguredError,
    )
  })

  it('accepts http for the base URL, because a pilot may not have a certificate yet', () => {
    // Deliberate, and narrower than it looks: this is the address a board
    // member's browser follows and it carries no credential. `MAIL_API_URL` is
    // held to `https:` because the key travels to it -- the two are different
    // decisions and the test above is the other half of this one.
    expect(readBaseUrl(env({ WATCHDOG_BASE_URL: 'http://localhost:3000' }))).toBe(
      'http://localhost:3000',
    )
  })

  it('refuses a base URL with a scheme that is not http', () => {
    expect(() => readBaseUrl(env({ WATCHDOG_BASE_URL: 'ftp://watchdog.example.test' }))).toThrow(
      MailNotConfiguredError,
    )
    expect(() =>
      readBaseUrl(env({ WATCHDOG_BASE_URL: 'javascript:alert(1)' })),
    ).toThrow(MailNotConfiguredError)
  })
})

describe('sending', () => {
  it('posts the message as JSON, with the key in a header and nowhere else', async () => {
    const { calls, doFetch } = stubFetch(() => ok())
    const sender = createHttpMailSender({ env: env(), fetch: doFetch })

    await sender.send(message)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://mail.example.test/v1/send')
    expect(calls[0]!.init.method).toBe('POST')

    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers['content-type']).toBe('application/json')
    expect(headers.authorization).toBe(`Bearer ${KEY}`)

    // Parsed, not matched as a string: a form-encoded body would carry the same
    // words and the provider would silently see no recipients.
    const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>
    expect(body).toEqual({
      from: 'watchdog@association.example.test',
      to: ['treasurer@example.test', 'president@example.test'],
      subject: message.subject,
      text: message.text,
    })
    expect(String(calls[0]!.init.body)).not.toContain(KEY)
  })

  it('arms a timeout, so one unresponsive provider cannot hold ingestion open', async () => {
    const { calls, doFetch } = stubFetch(() => ok())
    const sender = createHttpMailSender({ env: env(), fetch: doFetch, timeoutMs: 5_000 })

    await sender.send(message)

    const signal = calls[0]!.init.signal
    expect(signal).toBeInstanceOf(AbortSignal)
    // Armed, not merely present. A signal that never fires is the shape this
    // project has already shipped once as a `requestTimeout` that only logged.
    expect(signal!.aborted).toBe(false)
  })

  it('rejects rather than hanging when the provider never answers', async () => {
    // **End to end, with a real timer, and deliberately not with fake ones.**
    // `AbortSignal.timeout` runs on an internal timer that Vitest's fake clock
    // does not drive, so `advanceTimersByTime` leaves it unfired and the
    // assertion passes or fails for reasons unrelated to the code. Worse, that
    // version asserted a property of the signal object rather than the
    // behaviour anybody cares about.
    //
    // This forces the thing that actually matters: a provider that never
    // answers must end as a rejection, not as an upload that hangs while a
    // treasurer watches it.
    const doFetch = ((_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        })
      })) as unknown as typeof globalThis.fetch

    const sender = createHttpMailSender({ env: env(), fetch: doFetch, timeoutMs: 20 })

    await expect(sender.send(message)).rejects.toBeInstanceOf(MailNotSentError)
  })

  it('rejects when the network never produced a response', async () => {
    const { doFetch } = stubFetch(() => {
      throw new TypeError('fetch failed')
    })
    const sender = createHttpMailSender({ env: env(), fetch: doFetch })

    await expect(sender.send(message)).rejects.toBeInstanceOf(MailNotSentError)
  })

  it.each([[400], [401], [403], [422], [429], [500], [503]])(
    'rejects a %i rather than treating it as sent',
    async (status) => {
      const { doFetch } = stubFetch(() => new Response('{}', { status }))
      const sender = createHttpMailSender({ env: env(), fetch: doFetch })

      await expect(sender.send(message)).rejects.toBeInstanceOf(MailNotSentError)
    },
  )

  it('rejects a 200 whose body reports a failure', async () => {
    // Providers do this. A success status with an error object is the shape
    // that most reliably becomes a delivery row for a message nobody received.
    const { doFetch } = stubFetch(() => ok({ error: { message: 'domain not verified' } }))
    const sender = createHttpMailSender({ env: env(), fetch: doFetch })

    await expect(sender.send(message)).rejects.toBeInstanceOf(MailNotSentError)
  })

  it('resolves on a 200 that reports nothing wrong', async () => {
    const { doFetch } = stubFetch(() => ok())
    const sender = createHttpMailSender({ env: env(), fetch: doFetch })

    await expect(sender.send(message)).resolves.toBeUndefined()
  })

  it('never puts the key or the recipients in what it throws', async () => {
    // The error is read by whoever is debugging why a board was not warned, and
    // providers echo the request back in their error bodies -- which is where
    // every address is.
    const { doFetch } = stubFetch(
      () =>
        new Response(
          JSON.stringify({
            error: `rejected: to=${message.to.join(',')} key=${KEY}`,
          }),
          { status: 422 },
        ),
    )
    const sender = createHttpMailSender({ env: env(), fetch: doFetch })

    await expect(sender.send(message)).rejects.toSatisfy((error) => {
      const text = `${(error as Error).name}: ${(error as Error).message}`
      expect(text).not.toContain(KEY)
      expect(text).not.toContain('treasurer@example.test')
      expect(text).not.toContain('president@example.test')

      return true
    })
  })

  it('refuses an empty recipient list without calling the provider', async () => {
    // A send with nobody to send to is not a send. Refusing before `fetch`
    // matters because resolving would write a delivery row that migration 023
    // refuses anyway -- and rejecting after a successful call would report a
    // failure for a message that went.
    const { calls, doFetch } = stubFetch(() => ok())
    const sender = createHttpMailSender({ env: env(), fetch: doFetch })

    await expect(sender.send({ ...message, to: [] })).rejects.toBeInstanceOf(MailNotSentError)
    expect(calls).toHaveLength(0)
  })

  it('refuses a recipient list with a blank in it', async () => {
    const { calls, doFetch } = stubFetch(() => ok())
    const sender = createHttpMailSender({ env: env(), fetch: doFetch })

    await expect(sender.send({ ...message, to: ['treasurer@example.test', '  '] })).rejects.toBeInstanceOf(
      MailNotSentError,
    )
    expect(calls).toHaveLength(0)
  })

  it('releases the connection when the provider refuses', async () => {
    // Undici holds the socket until an unread body is garbage-collected, so a
    // provider having a bad afternoon would leak one connection per upload --
    // and this runs at the end of an upload a treasurer is watching. Cancelled
    // rather than read: reading it would put the provider's echo of the request
    // within reach of the error message, which is what the test above forbids.
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{}'))
        controller.close()
      },
      cancel() {
        cancelled = true
      },
    })

    const { doFetch } = stubFetch(() => new Response(body, { status: 500 }))
    const sender = createHttpMailSender({ env: env(), fetch: doFetch })

    await expect(sender.send(message)).rejects.toBeInstanceOf(MailNotSentError)
    expect(cancelled).toBe(true)
  })

  it('refuses before calling when the configuration is incomplete', async () => {
    const { calls, doFetch } = stubFetch(() => ok())
    const sender = createHttpMailSender({ env: env({ MAIL_API_KEY: undefined }), fetch: doFetch })

    await expect(sender.send(message)).rejects.toBeInstanceOf(MailNotConfiguredError)
    expect(calls).toHaveLength(0)
  })
})
