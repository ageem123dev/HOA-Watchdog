import type { ExtractionRecord } from '../extraction/record'

/**
 * Reading a document that no deterministic parser can read.
 *
 * The port is deliberately narrow. Everything above it sees this project's own
 * record vocabulary and nothing else — no candidate wrappers, no confidence
 * scores, no vendor response envelope. That is AD-16's lesson applied a second
 * time: the moment a provider's shape is visible above its adapter, replacing
 * the provider stops being an adapter change.
 *
 * It is also where AD-8's boundary is made structural rather than careful. The
 * return type is `ExtractionRecord[]`, whose fields are all constrained columns
 * — a known kind, a `numeric(14,2)` amount, a date, a currency from a closed
 * set, and two text columns capped at 200 and 64 characters. There is no
 * free-form field, so there is nowhere for a poisoned document to smuggle a
 * paragraph of instructions through a value. "Raw extracted text never crosses"
 * is therefore a property of this type, not of anyone remembering it.
 */

/** What the provider is asked to read. Bytes and their type — nothing else. */
export interface ExtractionRequest {
  readonly bytes: Uint8Array
  /** A media type the provider path handles: PDF or an image. */
  readonly mediaType: string
}

/**
 * Why an extraction produced nothing.
 *
 * The distinction is the whole point of this type. `unavailable` means the
 * provider could not be reached or could not answer — the document is fine, the
 * treasurer should wait, and 1.5d's retry path applies. `invalid` means the
 * provider answered and its answer could not be trusted — retrying changes
 * nothing, and the treasurer needs a better scan.
 *
 * Story 1.5b collapsed a similar pair into one `failed` outcome and had to add
 * `figures-not-stored` to separate them again. Two names from the start here.
 */
export const EXTRACTION_REFUSALS = ['unavailable', 'invalid'] as const

export type ExtractionRefusal = (typeof EXTRACTION_REFUSALS)[number]

/**
 * A collection, never a single record.
 *
 * A statement holds many figures and `extraction` is many-rows-per-document. A
 * single-record result would either drop rows or force an aggregation nobody
 * asked for and nothing records. Validation is all-or-nothing across the set,
 * exactly as it is on the tabular path — a document is read or it is not.
 */
export type ExtractionResult =
  | { readonly ok: true; readonly records: readonly ExtractionRecord[] }
  | { readonly ok: false; readonly refusal: ExtractionRefusal }

export interface Extractor {
  extract(request: ExtractionRequest): Promise<ExtractionResult>
}
