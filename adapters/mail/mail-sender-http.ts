import { MailNotSentError, type MailMessage, type MailSender } from '../../core/ports/mail'
import { MailNotConfiguredError, readBaseUrl, readMailConfig } from './env'

/**
 * The one place this system talks to the outside world on its own initiative.
 *
 * ## The provider is configuration, not code
 *
 * `MAIL_API_URL` is read rather than compiled in, so swapping providers is a
 * value in `.env.local`. The body below is the shape Resend and Postmark both
 * accept — `from`, `to`, `subject`, `text` — which is the smallest thing that
 * can actually send. Naming a provider in `core/` would be the mistake; naming
 * none *here* would mean shipping something that cannot send at all.
 *
 * SMTP was the alternative and would have meant a dependency, a connection pool
 * and TLS configuration. Story 4.7 took the same tie the same way, choosing CSV
 * over a PDF library, and `adapters/agent/chat-client.ts` is the precedent this
 * follows: a hand-rolled `fetch` client with named variables, a bounded timeout,
 * and a refusal that is never an empty success.
 *
 * ## Resolving is the dangerous direction
 *
 * `FindingAlertLedger.recordSent` runs when this resolves, and that row is what
 * stops the alert ever being retried. A false success is not a missed email — it
 * is permanent silence for that finding, with a database record saying the board
 * was warned. Every branch below that could resolve on an unsent message
 * rejects instead.
 *
 * ## Nothing thrown from here names a recipient or the key
 *
 * The error is read by whoever is working out why a board was never warned, and
 * providers routinely echo the request back inside their error bodies — which is
 * exactly where every director's address is. Status codes and shapes only.
 */

/**
 * How long a send may take before the gateway gives up.
 *
 * Bounded, because without a bound one unresponsive provider holds an ingestion
 * request open indefinitely — and this runs at the end of an upload a treasurer
 * is watching. Shorter than the agent client's minute: a mail API returns an
 * accepted-for-delivery acknowledgement, not a model call.
 */
const DEFAULT_TIMEOUT_MS = 15_000

export interface HttpMailSenderOptions {
  /** Defaults to `process.env`, read at call time — never at module scope. */
  readonly env?: Readonly<Record<string, string | undefined>>
  /** Injected by tests; production uses the platform `fetch`. */
  readonly fetch?: typeof globalThis.fetch
  readonly timeoutMs?: number
}

/** Everything the provider is asked for, checked before anything is asked. */
function refuseUnsendable(message: MailMessage): void {
  // A send with nobody to send to is not a send. Refused *before* `fetch`,
  // because resolving would have the ledger write a delivery row naming nobody
  // — which migration 023 refuses anyway — and rejecting after a successful
  // call would report a failure for a message that went.
  if (message.to.length === 0) {
    throw new MailNotSentError('there was nobody on the board to send it to')
  }

  if (message.to.some((address) => address.trim() === '')) {
    throw new MailNotSentError('the recipient list had a blank address in it')
  }

  if (message.subject.trim() === '') {
    throw new MailNotSentError('the message had no subject')
  }
}

export function createHttpMailSender(options: HttpMailSenderOptions = {}): MailSender {
  return {
    async send(message: MailMessage): Promise<void> {
      // Configuration first, so an unconfigured deploy fails with a named
      // variable rather than a network error. `MailNotConfiguredError` escapes
      // deliberately: it is not a send that failed, it is a send that was never
      // possible, and the wiring treats the two differently.
      const { url, key, from } = readMailConfig(options.env ?? process.env)

      refuseUnsendable(message)

      const doFetch = options.fetch ?? globalThis.fetch
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

      let response: Response
      try {
        response = await doFetch(url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${key}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            from,
            to: message.to,
            subject: message.subject,
            text: message.text,
          }),
          // **Never follow a redirect.** Measured on this runtime: Node strips
          // `Authorization` across origins, so a redirect cannot carry the key
          // away -- which is what was raised in review and it does not hold.
          //
          // The body is the reason. It names a vendor, an amount and a unit,
          // and following a redirect would POST an association's finding to a
          // host nobody configured. A `MAIL_API_URL` pointing at something that
          // redirects is a misconfiguration, and this makes it fail loudly
          // rather than deliver quietly to the wrong place.
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (error) {
        // A connection that never became a response is still an unsent message.
        // Letting this escape as a raw `TypeError` means the wiring cannot tell
        // it from a programming fault. The name only — a fetch error message
        // can carry the host, and the host is the provider's, not ours to leak
        // into a log a board reads.
        throw new MailNotSentError(
          `the mail provider could not be reached (${error instanceof Error ? error.name : 'unknown'})`,
          { cause: error },
        )
      }

      if (!response.ok) {
        // **Cancel the body before throwing.** Undici holds the socket open
        // until an unread body is garbage-collected, so a provider having a bad
        // afternoon leaks one connection per upload -- and this runs at the end
        // of an upload a treasurer is watching. Raised by Argus.
        //
        // Cancelled rather than read, deliberately: reading it would put the
        // provider's echo of the request within reach of the error message, and
        // that echo contains every director's address.
        await response.body?.cancel().catch(() => {
          // Already consumed, already errored, or no body at all. Releasing the
          // socket is best-effort; failing to do it must not replace a real
          // send failure with a plumbing one.
        })

        // The status and nothing else, for the reason above.
        throw new MailNotSentError(`the mail provider refused it with ${response.status}`)
      }

      // **A 2xx is not proof.** Providers answer 200 with an error object, and
      // that shape is the one that most reliably becomes a delivery row for a
      // message nobody received. An unreadable body is treated the same way: a
      // success this cannot confirm is not one it may record.
      // An **empty** body is a success, and treating it as a failure was a real
      // defect: SendGrid answers `202 Accepted` with nothing at all, so a
      // correctly delivered warning was recorded as failed and re-sent on every
      // sweep once its claim went stale. The endpoint is configuration here, so
      // that is not a hypothetical provider. Raised by CodeRabbit.
      //
      // The distinction that keeps this honest: nothing at all is a provider
      // saying yes tersely; half a JSON document is a provider -- or a proxy --
      // saying something went wrong, and that still rejects.
      // **Read failures are not empty bodies.** `.catch(() => '')` here made a
      // connection reset mid-body indistinguishable from a provider's terse
      // yes, so a send whose outcome is genuinely unknown would be recorded as
      // delivered and never retried -- the exact false success this adapter
      // exists to refuse, arriving through the fix for a different one. Raised
      // by Argus on the fix diff, which is where this project keeps finding
      // them.
      let body: string
      try {
        body = (await response.text()).trim()
      } catch (error) {
        throw new MailNotSentError('the mail provider answer could not be read to the end', {
          cause: error,
        })
      }

      // Nothing at all is a provider saying yes tersely. Load-bearing: without
      // this line `parseObject('')` fails to parse and the send is reported as
      // failed, which is exactly the SendGrid defect.
      if (body === '') return

      const payload = parseObject(body)
      if (payload === null) {
        throw new MailNotSentError('the mail provider answered with something that was not JSON')
      }

      // `false` is not an error, and neither is `null`. Only a value that says
      // something went wrong does.
      const reported = payload['error']
      if (reported !== undefined && reported !== null && reported !== false) {
        throw new MailNotSentError('the mail provider reported an error alongside a success status')
      }
    },
  }
}

/**
 * The body as an object, or `null` if it is not one.
 *
 * Text is read at the call site rather than through `response.json()`, because
 * that cannot tell an empty body from a malformed one -- both throw -- and that
 * difference is the whole point: one is a success and the other is not.
 */
function parseObject(body: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(body)

    // An array or a scalar is not an object, and `payload['error']` on one is
    // meaningless -- so the narrowing happens here rather than at the check.
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * The alerting collaborators, or nothing at all.
 *
 * **Configuration is resolved here rather than inside `core/`, and that is the
 * boundary doing its job.** `core/` imports nothing outward, so it cannot read
 * the environment — and `notifyFindings` already treats an absent collaborator
 * as "do nothing". Turning absent configuration into an absent collaborator
 * therefore needs no new mechanism, and in particular no error class crossing
 * the boundary to be matched on by name.
 *
 * The alternative was letting `MailNotConfiguredError` escape from the first
 * send. That would claim every finding first, so an unconfigured deploy would
 * take ownership of alerts it could never deliver and hold them for the retry
 * window — an acceptance criterion says explicitly that not being configured
 * means no delivery row at all.
 *
 * `onError` receives the named error when configuration is incomplete, because
 * a mailer that is silently absent is indistinguishable from one that had
 * nothing to send. It is reported once per ingestion rather than per finding.
 */
export function createAlerting(
  onError?: (error: unknown) => void,
): { mail: MailSender; baseUrl: string } | Record<string, never> {
  try {
    // Read before anything is constructed, so an incomplete environment is a
    // named error rather than a sender that fails on its first use.
    readMailConfig()

    return { mail: createHttpMailSender(), baseUrl: readBaseUrl() }
  } catch (error) {
    onError?.(error)

    // **Only a configuration error means "not configured".** Anything else
    // reaching here -- a constructor throwing, a bug in the reader -- would
    // otherwise be silently indistinguishable from an unset variable, and the
    // whole alerting path would disappear with a single log line nobody
    // correlates. Raised by CodeRabbit.
    if (!(error instanceof MailNotConfiguredError)) throw error

    // Empty rather than `undefined`, so a call site can spread it
    // unconditionally: `...alerting` contributes nothing when mail is not
    // configured, and there is no second branch to forget.
    return {}
  }
}
