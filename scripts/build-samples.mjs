/**
 * Build the sample uploads from one source of truth.
 *
 * Seven files covering the six accepted content types — two are CSVs, because
 * the assessment roll and a deposit feed are different documents in the same
 * format. Five are written from the rows below; two are images of a document and
 * are **verified, not written** — see `RASTERS`.
 *
 * The reason this is a script rather than six committed files a human keeps in
 * step: six files hand-maintained against one contract is six chances for the
 * README to be right about five of them. `samples/samples.test.ts` runs this in
 * check mode, so a sample edited by hand fails the gate rather than drifting.
 *
 *   node scripts/build-samples.mjs          write the generated samples
 *   node scripts/build-samples.mjs --check  fail if any sample is out of date
 */

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as XLSX from 'xlsx'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const samples = join(root, 'samples')

/**
 * The assessment roll: the first thing to upload into a fresh install.
 *
 * Nothing else creates units, so every other sample resolves against these.
 * `cycle` and `year` are the roll's own columns; `unit` names the unit and
 * `description` names who holds it.
 */
const ROLL = {
  headers: ['date', 'description', 'amount', 'type', 'unit', 'cycle', 'year'],
  rows: [
    ['2026-01-01', 'Dana Whitfield', '3600.00', 'assessment_roll', '4B', 'monthly', '2026'],
    ['2026-01-01', 'Marcus Oyelaran', '3600.00', 'assessment_roll', '5C', 'monthly', '2026'],
    ['2026-01-01', 'Priya Raghunathan', '4200.00', 'assessment_roll', '6A', 'six_monthly', '2026'],
    ['2026-01-01', 'Tomas Lindqvist', '4200.00', 'assessment_roll', '7D', 'annual', '2026'],
  ],
}

/**
 * A deposit bank feed: the format the pilot actually ingests.
 *
 * `4b ` is deliberately mis-spelled against the roll's `4B` — the folding is
 * real and a sample that never exercises it teaches nothing. The last row names
 * a unit the roll does not have, so one line is held with `unknown-unit` and a
 * reader sees what that looks like on purpose rather than by accident.
 */
const DEPOSITS = {
  headers: ['date', 'description', 'amount', 'type', 'unit', 'reference'],
  rows: [
    ['2026-03-02', 'Dana Whitfield', '300.00', 'deposit', '4B', 'DEP-3001'],
    ['2026-03-02', 'Marcus Oyelaran', '300.00', 'deposit', '4b ', 'DEP-3002'],
    ['2026-03-03', 'Priya Raghunathan', '2100.00', 'deposit', '6A', 'DEP-3003'],
    ['2026-03-04', 'Unknown payer', '250.00', 'deposit', '9Z', 'DEP-3004'],
  ],
}

/** An invoice batch. An unfamiliar vendor is held for a human, not created. */
const INVOICES = {
  headers: ['date', 'description', 'amount', 'type', 'reference'],
  rows: [
    ['2026-03-05', 'Evergreen Landscaping', '1450.00', 'invoice', 'INV-4021'],
    ['2026-03-06', 'Harbour Glass & Glazing', '880.50', 'invoice', 'INV-4022'],
    ['2026-03-07', 'Municipal Water Authority', '312.75', 'invoice', 'INV-4023'],
  ],
}

/**
 * A bank statement with **no `type` column at all**.
 *
 * The default kind is `statement`, and this is the case most likely to surprise
 * someone who assumes the column is required. A negative amount is a credit.
 */
const STATEMENT = {
  headers: ['date', 'description', 'amount', 'reference'],
  rows: [
    ['2026-03-01', 'Opening balance', '18420.00', 'STMT-0301'],
    ['2026-03-02', 'Deposit batch 3001-3004', '2950.00', 'STMT-0302'],
    ['2026-03-05', 'Evergreen Landscaping', '-1450.00', 'STMT-0305'],
  ],
}

const toCsv = ({ headers, rows }) =>
  [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'

/** RFC 4180: quote when the cell contains a comma, a quote, or leading/trailing space. */
const csvCell = (value) =>
  /[",\r\n]|^\s|\s$/.test(value) ? `"${value.replaceAll('"', '""')}"` : value

const sheet = ({ headers, rows }) => XLSX.utils.aoa_to_sheet([headers, ...rows])

function workbook(table, bookType) {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet(table), 'Sheet1')
  return XLSX.write(book, { type: 'buffer', bookType })
}

/**
 * A one-page PDF holding the deposit table as text.
 *
 * Written by hand rather than with a library, because this repository has no PDF
 * dependency and a sample is not a reason to acquire one. The structure is the
 * minimum a reader will accept: catalog, pages, page, a Helvetica font, and one
 * content stream. The cross-reference offsets are computed from the assembled
 * bytes, so editing the text above cannot silently produce a broken file.
 */
function buildPdf(table) {
  const lines = [
    'Sunnyvale Gardens Condominium Association',
    'Deposit slip - March 2026',
    '',
    table.headers.join('   '),
    ...table.rows.map((row) => row.join('   ')),
  ]

  const text = lines
    .map((line, index) => {
      const escaped = line.replace(/([\\()])/g, '\\$1')
      return index === 0 ? `(${escaped}) Tj` : `T* (${escaped}) Tj`
    })
    .join('\n')

  const content = `BT\n/F1 11 Tf\n16 TL\n56 760 Td\n${text}\nET\n`

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]

  let pdf = '%PDF-1.7\n'
  const offsets = []

  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'))
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })

  const startxref = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`

  return Buffer.from(pdf, 'latin1')
}

/** What each generated sample is, and what writes it. */
const GENERATED = [
  { file: 'assessment-roll.csv', build: () => Buffer.from(toCsv(ROLL), 'utf8') },
  { file: 'deposits.csv', build: () => Buffer.from(toCsv(DEPOSITS), 'utf8') },
  { file: 'invoices.xlsx', build: () => workbook(INVOICES, 'xlsx') },
  { file: 'statement.xls', build: () => workbook(STATEMENT, 'biff8') },
  { file: 'deposit-slip.pdf', build: () => buildPdf(DEPOSITS) },
]

/**
 * The two that are not generated.
 *
 * A PNG and a JPG carry figures a model reads, which means they have to be real
 * images of a real document rather than something assembled from the rows above.
 * They are committed and this script **verifies** them: regenerating would need
 * a rasterising dependency, and this repository has avoided one.
 *
 * Stated here and in the README, because a reader who edits one and re-runs the
 * script will otherwise think it was silently ignored.
 */
const RASTERS = [
  { file: 'deposit-slip.png', signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { file: 'deposit-slip.jpg', signature: [0xff, 0xd8, 0xff] },
]

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 12)

function main() {
  const check = process.argv.includes('--check')
  const problems = []

  for (const { file, build } of GENERATED) {
    const built = build()
    const path = join(samples, file)

    if (!check) {
      writeFileSync(path, built)
      console.log(`wrote ${file} (${built.length} bytes, ${digest(built)})`)
      continue
    }

    let current
    try {
      current = readFileSync(path)
    } catch {
      problems.push(`${file} is missing — run: node scripts/build-samples.mjs`)
      continue
    }

    if (!current.equals(built)) {
      problems.push(
        `${file} does not match what the rows produce — edit scripts/build-samples.mjs, not the sample`,
      )
    }
  }

  for (const { file, signature } of RASTERS) {
    let bytes
    try {
      bytes = readFileSync(join(samples, file))
    } catch {
      problems.push(`${file} is missing, and this script does not generate it`)
      continue
    }

    const head = [...bytes.subarray(0, signature.length)]
    if (signature.some((byte, index) => head[index] !== byte)) {
      problems.push(`${file} does not begin with its format's signature bytes`)
    }
    if (!check) console.log(`verified ${file} (${bytes.length} bytes, ${digest(bytes)})`)
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(`  ${problem}`)
    process.exitCode = 1
  }
}

main()
