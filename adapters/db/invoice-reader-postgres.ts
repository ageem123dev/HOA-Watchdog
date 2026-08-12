import type { InvoiceReading } from '../../core/detection/duplicate-invoice'
import type { InvoiceReader } from '../../core/ports/invoice-reader'
import { writerPool } from './pool'

/**
 * The `InvoiceReader` port backed by Postgres.
 *
 * ## An invoice is an `extraction` row
 *
 * There is no invoice table. `document_kind = 'invoice'` with `vendor_name`,
 * `document_number`, `issued_on` and `total_amount` is what an invoice is, and
 * every one of those columns is nullable — null is what the extractor writes
 * when it could not read the field.
 *
 * ## The nulls are handled by SQL's own semantics, not by a guard
 *
 * `total_amount = $2` with a null parameter matches nothing, because `null =
 * null` is null and not true. `vendor_normalised_name` is `strict`, so a null
 * vendor folds to null and compares the same way. That is the behaviour we
 * want — an invoice nobody could read an amount for must not pair with another
 * one — and it is worth naming, because it looks like an omission. `test:db`
 * asserts it rather than trusting this paragraph.
 *
 * ## `vendor_normalised_name`, never a rule of its own
 *
 * Migration 009's function is what `vendor.normalised_name` and
 * `quarantine_item.normalised_name` are both generated from. Comparing folded
 * names here with a *second* definition would let one vendor be two vendors to
 * the detector alone — the defect the whole of epic story 1.6 exists to prevent.
 *
 * ## The writer credential
 *
 * `watchdog_reader` is the LLM-driven query path's role and has no business
 * running detection. This adapter shares the writer pool with
 * `finding-postgres.ts`, which the same component uses to raise what it finds.
 */

interface Row {
  id: string
  document_id: string
  vendor_name: string | null
  document_number: string | null
  issued_on: string | null
  amount: string | null
}

/**
 * `issued_on` as `YYYY-MM-DD` and `total_amount` as its exact decimal string.
 *
 * `to_char` rather than letting `pg` hand back a `Date`: a date is a calendar
 * day and a `Date` is an instant, so midnight UTC rendered west of Greenwich is
 * the day before — an invoice filed under the wrong month in the column the
 * finding is keyed on. `::text` on the numeric for story 2.2's reason: exact
 * decimal end to end, never through a float.
 */
const COLUMNS = `e.id,
       e.document_id,
       e.vendor_name,
       e.document_number,
       to_char(e.issued_on, 'YYYY-MM-DD') as issued_on,
       e.total_amount::text as amount`

function toReading(row: Row): InvoiceReading {
  return {
    extractionId: row.id,
    documentId: row.document_id,
    vendorName: row.vendor_name,
    documentNumber: row.document_number,
    issuedOn: row.issued_on,
    amount: row.amount,
  }
}

export function createInvoiceReader(): InvoiceReader {
  return {
    async invoicesOn(documentId: string): Promise<readonly InvoiceReading[]> {
      const { rows } = await writerPool().query<Row>(
        `select ${COLUMNS}
           from extraction e
          where e.document_id = $1
            and e.document_kind = 'invoice'
          order by e.id`,
        [documentId],
      )

      return rows.map(toReading)
    },

    async priorCandidates(subject: InvoiceReading): Promise<readonly InvoiceReading[]> {
      // Bound parameters throughout. `vendor_name` and `document_number` are
      // **extracted strings** — AD-8 says they are escaped on output and never
      // interpolated, and a vendor name is the field an injection payload
      // arrives in.
      const { rows } = await writerPool().query<Row>(
        `select ${COLUMNS}
           from extraction e
           join document d on d.id = e.document_id
          where e.document_kind = 'invoice'
            and e.total_amount = $2::numeric
            and vendor_normalised_name(e.vendor_name) = vendor_normalised_name($3)
            -- Strictly earlier, and this is also what excludes the subject's
            -- own document: a tuple is never less than itself, so every row on
            -- the document being checked falls out here. A separate
            -- self-exclusion clause stood beside this one until a sensitivity
            -- check removed it and no test failed. It was redundant, and a
            -- guard nothing can break is a guard worth deleting.
            and (d.uploaded_at, d.id)
                < (select uploaded_at, id from document where id = $1)
          order by d.uploaded_at, d.id, e.id`,
        [subject.documentId, subject.amount, subject.vendorName],
      )

      return rows.map(toReading)
    },
  }
}
