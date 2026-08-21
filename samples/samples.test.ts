/**
 * Every committed sample is a file this application actually accepts.
 *
 * AC2 and AC3. A sample that fails the gate it exists to demonstrate is the
 * worst possible sample — a reader following the README would conclude the
 * application is broken, and be reasonable.
 *
 * So each one is put through `assess()`, the same function the upload route
 * calls, and then through the reader that would read it. Nothing here trusts
 * that a writer produced what it claimed: SheetJS's `biff8` book type is asked
 * for and the **OLE signature is checked**, because `assess()` checks signature
 * bytes rather than extensions and a writer that quietly emitted a ZIP would
 * produce a `.xls` refused as `unsupported-type`.
 */

import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { ACCEPTED_CONTENT_TYPES, assess } from '../core/ingestion/acceptance'
import { readRows, readTable } from '../core/extraction/tabular'
import { readWorkbook } from '../adapters/extraction/workbook-sheetjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const bytesOf = (file: string): Buffer => readFileSync(join(here, file))

/** One sample per accepted content type — the claim AC2 makes. */
const SAMPLES = [
  // The roll first, and it was the omission review found: it is the sample a
  // new installer uploads *first*, and the one sample nothing assessed. The
  // list was one-per-content-type because the coverage assertion wanted a 1:1
  // map -- so the assertion shaped the fixture and the fixture lost a file.
  { file: 'assessment-roll.csv', contentType: 'text/csv' },
  { file: 'deposit-slip.pdf', contentType: 'application/pdf' },
  { file: 'deposit-slip.png', contentType: 'image/png' },
  { file: 'deposit-slip.jpg', contentType: 'image/jpeg' },
  { file: 'deposits.csv', contentType: 'text/csv' },
  { file: 'statement.xls', contentType: 'application/vnd.ms-excel' },
  {
    file: 'invoices.xlsx',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
] as const

describe('the samples cover every format the application accepts', () => {
  it('covers every accepted content type, and claims none the code does not accept', () => {
    // A set on both sides. Sorted-list equality forced one sample per type and
    // silently excluded a second CSV; what AC2 claims is coverage, not a
    // bijection.
    expect(new Set(SAMPLES.map((sample) => sample.contentType))).toEqual(
      new Set(ACCEPTED_CONTENT_TYPES),
    )
  })

  it('assesses every file committed under samples/', () => {
    // The guard on the list above. A sample added to the directory and forgotten
    // here is a sample nothing checks -- which is exactly how the roll sample
    // came to be unassessed.
    const committed = readdirSync(here)
      .filter((name) => !name.endsWith('.ts'))
      .sort()

    expect(SAMPLES.map((sample) => sample.file).sort()).toEqual(committed)
  })
})

describe.each(SAMPLES)('$file', ({ file, contentType }) => {
  it('is accepted by the same gate the upload route uses', () => {
    const outcome = assess({ contentType, bytes: bytesOf(file) })

    // Named rather than `.outcome === 'accepted'`: a failure should say which
    // reason, because `too-large` and `unsupported-type` send a reader to two
    // completely different fixes.
    expect(outcome.outcome === 'accepted' ? 'accepted' : outcome.reason).toBe('accepted')
  })

  it('is not empty', () => {
    expect(bytesOf(file).length).toBeGreaterThan(0)
  })
})

describe('the .xls sample is a real BIFF8 workbook', () => {
  it('begins with the OLE compound file signature', () => {
    // The story's warning, checked rather than assumed: SheetJS's `xls` book
    // type does not unconditionally produce BIFF8, and an .xlsx renamed to .xls
    // is a ZIP. `assess()` would refuse it, and the sample would teach a reader
    // that Excel files do not work.
    expect([...bytesOf('statement.xls').subarray(0, 8)]).toEqual([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
    ])
  })

  it('is not secretly a ZIP', () => {
    // The discriminating half. An .xlsx begins `PK\x03\x04`, and asserting only
    // "starts with OLE" would pass for a file that is both — which is exactly
    // why `acceptance.ts` keeps the two signatures apart: an *encrypted* .xlsx
    // is also an OLE compound file.
    expect([...bytesOf('statement.xls').subarray(0, 4)]).not.toEqual([0x50, 0x4b, 0x03, 0x04])
  })
})

describe('the tabular samples read into the records the README promises', () => {
  it('reads the assessment roll as roll rows for four units', () => {
    const result = readTable(readFileSync(join(here, 'assessment-roll.csv'), 'utf8'), 'assessment_roll')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.records.map((record) => record.documentKind)).toEqual([
      'assessment_roll',
      'assessment_roll',
      'assessment_roll',
      'assessment_roll',
    ])
    expect(result.rollRows.map((row) => row.unitNumber)).toEqual(['4B', '5C', '6A', '7D'])
    // Every billing cycle the code has, so the sample exercises the vocabulary
    // rather than the one value that happened to be typed first.
    expect(new Set(result.rollRows.map((row) => row.billingCycle))).toEqual(
      new Set(['monthly', 'six_monthly', 'annual']),
    )
  })

  it('reads the deposits, including the reference the roll spells differently', () => {
    const result = readTable(readFileSync(join(here, 'deposits.csv'), 'utf8'), 'deposit')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // `4b ` in the sample, `4b` here: `validate` trims every text field before
    // it becomes a record, so a trailing space cannot reach the ledger and a
    // sample cannot demonstrate one. Asserting `'4b '` here would be asserting
    // what the file says rather than what the system does.
    expect(result.records.map((record) => record.unitReference)).toEqual([
      '4B',
      '4b',
      '6A',
      '9Z',
    ])
    // The case difference is the part that does survive, and it is what the
    // folding exists for: this row still resolves to the roll's `4B`.
    expect(result.records[1]!.unitReference).not.toBe(result.records[0]!.unitReference)
  })

  it('reads the statement, which has no type column, as statements', () => {
    // The default kind, and the case most likely to surprise someone who
    // assumes `type` is required. Read the way ingestion reads a workbook:
    // decode to rows, then through the same tabular reader a CSV uses.
    const workbook = readWorkbook(bytesOf('statement.xls'))
    expect(workbook.ok).toBe(true)
    if (!workbook.ok) return

    const result = readRows(workbook.rows, 'statement')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.records.map((record) => record.documentKind)).toEqual([
      'statement',
      'statement',
      'statement',
    ])
    // A negative amount is a credit, and the sample carries one on purpose.
    expect(result.records.some((record) => record.totalAmount?.startsWith('-'))).toBe(true)
  })

  it('reads the invoice workbook as invoices', () => {
    const workbook = readWorkbook(bytesOf('invoices.xlsx'))
    expect(workbook.ok).toBe(true)
    if (!workbook.ok) return

    const result = readRows(workbook.rows, 'invoice')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.records.map((record) => record.documentKind)).toEqual([
      'invoice',
      'invoice',
      'invoice',
    ])
    expect(result.records.map((record) => record.vendorName)).toContain('Evergreen Landscaping')
  })
})

describe('the generated samples cannot drift from the rows that produce them', () => {
  /**
   * Both tests in this pair spawn `node` and run a whole build, which is ~2s of
   * real work and more under load. Vitest's 5s default left no headroom: this
   * pair went red three times across stories 3.4 and 3.6a on a busy machine
   * while the assertions themselves were fine.
   *
   * The assertions are unchanged. What changed is that an intermittently red
   * gate is one people learn to re-run rather than read — and this project has
   * exactly one gate, so a test that cries wolf costs more than the seconds it
   * saves. `dual-llm-boundary.test.ts` was given the same headroom for the same
   * reason.
   */
  it('matches what scripts/build-samples.mjs produces', { timeout: 30_000 }, () => {
    // AC3 for the samples. Editing a sample by hand, or editing the rows and
    // forgetting to rebuild, fails here rather than shipping a README that
    // describes a file nobody has.
    expect(() =>
      execFileSync('node', ['scripts/build-samples.mjs', '--check'], {
        cwd: root,
        stdio: 'pipe',
      }),
    ).not.toThrow()
  })

  it('the check actually fails when a sample is wrong', { timeout: 30_000 }, () => {
    // Against a disposable copy, not the tracked tree. The first version
    // corrupted `samples/deposits.csv` and restored it, which loops a watcher,
    // leaves a dirty tree if the run aborts, and races anything else walking the
    // repository -- it was already my leading suspect for an unexplained
    // transient during task 2. Raised by review on independent grounds.
    //
    // `.probe/` is gitignored and *inside* the repository, so `xlsx` still
    // resolves from node_modules while nothing tracked is touched.
    const scratch = join(root, '.probe', 'sample-drift')

    try {
      rmSync(scratch, { recursive: true, force: true })
      mkdirSync(join(scratch, 'scripts'), { recursive: true })
      cpSync(here, join(scratch, 'samples'), { recursive: true })
      cpSync(
        join(root, 'scripts', 'build-samples.mjs'),
        join(scratch, 'scripts', 'build-samples.mjs'),
      )

      // Sound to begin with, or the assertion below would prove nothing.
      expect(() =>
        execFileSync('node', ['scripts/build-samples.mjs', '--check'], {
          cwd: scratch,
          stdio: 'pipe',
        }),
      ).not.toThrow()

      const copy = join(scratch, 'samples', 'deposits.csv')
      writeFileSync(
        copy,
        Buffer.concat([readFileSync(copy), Buffer.from('2026-03-09,Extra,1.00\r\n')]),
      )

      // Not a bare `toThrow()`. That passes when node is missing, when the copy
      // failed, or on any unrelated crash -- so it cannot tell "the check caught
      // the drift" from "the check never ran". Raised by review, and it is this
      // project's own rule about `toThrow` written down elsewhere.
      let failure: { status?: number; stderr?: Buffer } | undefined
      try {
        execFileSync('node', ['scripts/build-samples.mjs', '--check'], {
          cwd: scratch,
          stdio: 'pipe',
        })
      } catch (error) {
        failure = error as { status?: number; stderr?: Buffer }
      }

      expect(failure, 'the drift check accepted a corrupted sample').toBeDefined()
      expect(failure?.status).toBe(1)
      expect(String(failure?.stderr ?? '')).toContain(
        'deposits.csv does not match what the rows produce',
      )
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })
})
