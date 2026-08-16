import { auth } from '@/adapters/auth/auth'
import { createPostgresDocumentRepository } from '@/adapters/db/document-repository-postgres'
import { createPostgresExtractionRepository } from '@/adapters/db/extraction-repository-postgres'
import { createGeminiExtractor } from '@/adapters/extraction/extractor-gemini'
import { createPaymentRepository } from '@/adapters/db/payment-repository-postgres'
import { createDuesReader } from '@/adapters/db/dues-reader-postgres'
import { createInvoiceReader } from '@/adapters/db/invoice-reader-postgres'
import { createFindingRegister } from '@/adapters/db/finding-postgres'
import {
  createBoardRecipients,
  createFindingAlertLedger,
} from '@/adapters/db/finding-alert-postgres'
import { createFindingReader } from '@/adapters/db/finding-reader-postgres'
import { createAlerting } from '@/adapters/mail/mail-sender-http'
import { createQuarantine } from '@/adapters/db/quarantine-postgres'
import { createUnitDirectory } from '@/adapters/db/unit-directory-postgres'
import { createVendorDirectory } from '@/adapters/db/vendor-directory-postgres'
import { createS3DocumentStore } from '@/adapters/storage/document-store-s3'
import { extractDocument } from '@/core/ingestion/extract-document'

/**
 * The follow-up that reads a document the upload only stored.
 *
 * Story 1.5c decided extraction is deferred: a model call is seconds, and a
 * treasurer uploading twenty scans should not hold one request open for
 * minutes. The upload stores the bytes and returns; the surface polls this.
 *
 * **This endpoint is the access-control surface of the whole feature**, which is
 * easy to miss because it looks like a progress bar. It takes a document id and
 * does expensive, chargeable work against the bytes behind it, so an unguarded
 * version would let anyone on the internet spend the association's money reading
 * documents they cannot otherwise see.
 *
 * Idempotent by consequence rather than by decoration: a document that has
 * already been read is no longer `held`, so it cannot be claimed, and a second
 * call reports the state instead of extracting again. Two calls arriving
 * together produce one provider call because the claim is taken before the
 * spend.
 */

/**
 * Built once for the process, for the reason `app/upload/actions.ts` gives:
 * neither factory reads its environment at construction, so module scope is
 * safe and `next build` needs no credentials.
 */
const documentStore = createS3DocumentStore()
const documentRepository = createPostgresDocumentRepository()
const extractionRepository = createPostgresExtractionRepository()
const extractor = createGeminiExtractor()
const vendors = createVendorDirectory()
const quarantine = createQuarantine()

/** Lower-case canonical UUID, which is what `uuidv7()` produces. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth()

  // Deny by default. Checked for substance rather than for `undefined`: a
  // session callback supplying `null` or an empty string would pass a loose
  // check and leave this endpoint open.
  const callerId = session?.user?.id
  if (typeof callerId !== 'string' || callerId.trim() === '') {
    return Response.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const { id } = await context.params

  // Refused before the database sees it. A malformed id is a client mistake,
  // and letting Postgres reject it would surface as a 500 — a broken server
  // where the honest answer is a bad request.
  if (!UUID.test(id)) {
    return Response.json({ error: 'not a document id' }, { status: 400 })
  }

  // Resolved once per request. Empty when mail is not configured, which
  // `notifyFindings` treats as "do nothing" -- so an unconfigured deploy
  // sends nothing and, importantly, claims nothing either. The named error
  // goes to the log rather than being swallowed: a mailer that is silently
  // absent is indistinguishable from one that had nothing to send.
  const alerting = createAlerting((error) => {
    console.error('[extract] alerting is not configured', error)
  })

  const result = await extractDocument(id, {
    repository: documentRepository,
    store: documentStore,
    extractions: extractionRepository,
    extractor,
    vendors,
    quarantine,
    // Both optional on the dependency type, so callers predating story 2.5 keep
    // working — which means absent here a deposit is read, stored, and recorded
    // against nobody, with nothing failing. `route.test.ts` asserts this call
    // passes them.
    units: createUnitDirectory(),
    payments: createPaymentRepository(),
    // Story 4.2. Absent, a document is read, stored, and never compared against
    // what came before -- and nothing fails. `duplicate-detection-wiring.test.ts`
    // asserts this call passes them.
    invoices: createInvoiceReader(),
    dues: createDuesReader(),
    findings: createFindingRegister(),
    // Story 4.8. Absent, a finding is raised and nobody is told -- and
    // nothing fails. `alert-wiring.test.ts` asserts this call passes them.
    //
    // `alerting` is spread because it is empty when mail is not configured,
    // which `notifyFindings` already treats as "do nothing". That keeps the
    // configuration decision at this boundary, where the environment is
    // readable, rather than inside `core/`, which imports nothing outward.
    findingReader: createFindingReader(),
    alerts: createFindingAlertLedger(),
    recipients: createBoardRecipients(),
    ...alerting,
    onError: (error) => {
      // The treasurer gets a state; an operator gets the cause. Discarding it
      // would make a provider outage look like a bad scan in the logs too.
      console.error('[extract] document', id, error)
    },
  })

  if (result.outcome === 'not-found') {
    return Response.json({ outcome: result.outcome }, { status: 404 })
  }

  // Everything else is a state, not a failure — including `provider-unavailable`
  // and `in-progress`. A poller that received a 5xx for "we could not reach the
  // provider just now" would report an application fault for a condition the
  // application is handling correctly, and the surface would show the wrong
  // thing.
  return Response.json(result, { status: 200 })
}
