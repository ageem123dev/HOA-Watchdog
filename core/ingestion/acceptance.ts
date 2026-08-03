/**
 * The acceptance gate: what a board may upload, and why anything else is refused.
 *
 * FR-1 gives three consequences — accept PDF/PNG/JPG/CSV/Excel, reject
 * unsupported or oversized files "with a clear error message", and halt on a
 * file that cannot be read. This module decides all three, and decides nothing
 * about how any of it is worded. It returns a reason from a closed set; the
 * surface renders it. That split is what keeps an exception's text — a path, a
 * library name, a stack — from ever reaching a treasurer.
 *
 * The rules live in the tables below rather than in a chain of conditionals, so
 * adding a format is a row and not a branch, and so the surface can render the
 * accepted list and the limit as facts from the same data the gate enforces.
 */

/**
 * 25 MiB.
 *
 * FR-1 requires a limit and does not name one. A 40-page bank statement scanned
 * at 300 dpi lands around 10–20 MB, so this admits what a board actually has
 * while keeping one upload inside what a request buffer can hold. Whole
 * mebibytes so the message can quote a round number.
 */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024

/**
 * The leading bytes a container must present to be what it claims.
 *
 * `null` means the format has no signature — CSV is text, and any byte sequence
 * is potentially valid text. Readability for those is decided differently below.
 */
interface Format {
  readonly contentType: string
  /** Rendered in the rejection message, so a treasurer reads "PDF", not a media type. */
  readonly label: string
  readonly signature: readonly number[] | null
}

const FORMATS: readonly Format[] = [
  { contentType: 'application/pdf', label: 'PDF', signature: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  {
    contentType: 'image/png',
    label: 'PNG',
    signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  { contentType: 'image/jpeg', label: 'JPG', signature: [0xff, 0xd8, 0xff] },
  { contentType: 'text/csv', label: 'CSV', signature: null },
  // .xls is an OLE compound file; .xlsx is a ZIP. An *encrypted* .xlsx is also
  // an OLE compound file, which is why these two must not share a check.
  {
    contentType: 'application/vnd.ms-excel',
    label: 'Excel (.xls)',
    signature: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
  },
  {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    label: 'Excel (.xlsx)',
    signature: [0x50, 0x4b, 0x03, 0x04],
  },
]

/** Must equal `document_content_type_supported` in migration 004; a test asserts it. */
export const ACCEPTED_CONTENT_TYPES: readonly string[] = FORMATS.map(
  (format) => format.contentType,
)

export const ACCEPTED_FORMAT_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  FORMATS.map((format) => [format.contentType, format.label]),
)

/**
 * The complete set of things the surface has to be able to say. Closed on
 * purpose: a new reason is a deliberate change to the copy, not a string that
 * appeared from a caught exception.
 */
export const REJECTION_REASONS = [
  'unsupported-type',
  'too-large',
  'empty',
  'unreadable',
] as const

export type RejectionReason = (typeof REJECTION_REASONS)[number]

export interface UploadCandidate {
  /** As declared by the client. Treated as a claim to be checked, never as fact. */
  readonly contentType: string
  readonly bytes: Uint8Array
}

export type Assessment =
  | { readonly outcome: 'accepted'; readonly contentType: string }
  | { readonly outcome: 'rejected'; readonly reason: RejectionReason }

/** Browsers send `text/csv; charset=utf-8` and vary the case. Both are the same type. */
function normalizeContentType(declared: string): string {
  // `split` always yields at least one element, but `noUncheckedIndexedAccess`
  // does not know that, and the default keeps the empty-string case explicit.
  const [base = ''] = declared.split(';')

  return base.trim().toLowerCase()
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  // Length first: a file shorter than the signature can never match, and
  // indexing past the end would compare against `undefined` instead.
  if (bytes.length < signature.length) return false

  return signature.every((byte, index) => bytes[index] === byte)
}

/**
 * Does this PDF announce itself as encrypted?
 *
 * A `/Encrypt` entry belongs to the trailer dictionary, so the scan is scoped to
 * the tail. Searching the whole file would refuse any PDF whose page text
 * happens to contain the word — a false "unreadable" costs a board a document
 * they legitimately hold, which is worse than passing an encrypted one to
 * extraction, where it fails loudly.
 *
 * This answers "does the container say it is encrypted", not "can this be
 * parsed". The latter needs a PDF parser, which belongs with extraction.
 */
const PDF_TRAILER_SCAN_BYTES = 2048

function pdfAnnouncesEncryption(bytes: Uint8Array): boolean {
  const tail = bytes.subarray(Math.max(0, bytes.length - PDF_TRAILER_SCAN_BYTES))

  return new TextDecoder('latin1').decode(tail).includes('/Encrypt')
}

/**
 * CSV has no signature, so nothing structural can be compared. A NUL byte is the
 * tell: it does not occur in the text encodings a spreadsheet exports, and it
 * does occur immediately in anything binary that has been mislabelled.
 */
const CSV_TEXT_SCAN_BYTES = 8192

function looksBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, CSV_TEXT_SCAN_BYTES).includes(0x00)
}

export function assess(candidate: UploadCandidate): Assessment {
  const contentType = normalizeContentType(candidate.contentType)
  const format = FORMATS.find((entry) => entry.contentType === contentType)

  // Type first: it is the cheapest check, its message is the most actionable,
  // and running it first means an unsupported file's bytes are never scanned.
  if (!format) return { outcome: 'rejected', reason: 'unsupported-type' }

  const { bytes } = candidate

  // Before the size check, not after: `0 <= MAX` is true, so a size-only test
  // passes an empty file through to `document_byte_size_positive`, and the
  // treasurer gets a database error instead of a sentence.
  if (bytes.length === 0) return { outcome: 'rejected', reason: 'empty' }

  if (bytes.length > MAX_DOCUMENT_BYTES) return { outcome: 'rejected', reason: 'too-large' }

  // The declared type is a claim. Checking it against the container is what
  // stops anything renamed `.pdf` from being handed to extraction as a PDF.
  if (format.signature && !startsWith(bytes, format.signature)) {
    return { outcome: 'rejected', reason: 'unreadable' }
  }

  if (contentType === 'application/pdf' && pdfAnnouncesEncryption(bytes)) {
    return { outcome: 'rejected', reason: 'unreadable' }
  }

  if (format.signature === null && looksBinary(bytes)) {
    return { outcome: 'rejected', reason: 'unreadable' }
  }

  return { outcome: 'accepted', contentType }
}
