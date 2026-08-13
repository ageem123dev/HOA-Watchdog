/**
 * Raising a dues shortfall (story 4.4, AC3/AC7/AC8/AC9).
 *
 * `dues-shortfall.test.ts` proves the arithmetic. This proves what a board
 * member ends up looking at: what key it is filed under, whose name is on it,
 * and — the decision this story had to make — that a unit whose position
 * changes gets one finding that changes with it rather than two that disagree.
 */

import { describe, expect, it, vi } from 'vitest'

import { detectDuesShortfalls, UNIT_DUES_SHORTFALL } from './detect-dues-shortfalls'
import type { FindingRegister, RaisedFinding } from '../ports/finding'
import type { DuesReader, UnitDues } from '../ports/dues-reader'
import { yearRange } from './detection-run'

const DOCUMENT = 'd-deposit'
const UNIT = 'u-101'

function dues(overrides: Partial<UnitDues> = {}): UnitDues {
  return {
    unitId: UNIT,
    unitNumber: '101',
    assessment: { annualAmount: '1200.00', billingCycle: 'monthly', assessmentYear: 2026 },
    payments: [],
    holderName: 'Dana Whitfield',
    ...overrides,
  }
}

function reader(
  units: readonly UnitDues[],
  evaluatedOn: string | null = '2026-04-01',
  covered: readonly number[] = [],
): DuesReader {
  return {
    evaluationDateFor: vi.fn(async () => evaluatedOn),
    yearsCoveredBy: vi.fn(async () => covered),
    duesForYear: vi.fn(async (year: number) =>
      // Keyed on the year so a multi-year deposit can hand back different rolls,
      // which is the whole point of the case below.
      units.filter((unit) => unit.assessment.assessmentYear === year),
    ),
  }
}

function register(alreadyKnown = false) {
  const raised: Parameters<FindingRegister['raise']>[0][] = []
  const port: FindingRegister = {
    raise: vi.fn(async (request): Promise<RaisedFinding> => {
      raised.push(request)

      return { id: `f-${raised.length}`, wasAlreadyKnown: alreadyKnown }
    }),
  }

  return { port, raised }
}

describe('raising a shortfall', () => {
  it('keys the finding on the unit and the assessment year', async () => {
    // **Not on the document.** Absence has no document to hang off, and a unit
    // id survives re-ingest where an extraction id does not.
    const findings = register()

    await detectDuesShortfalls(DOCUMENT, { dues: reader([dues()]), findings: findings.port })

    expect(findings.raised).toHaveLength(1)
    expect(findings.raised[0]).toMatchObject({
      findingType: UNIT_DUES_SHORTFALL,
      subjectId: UNIT,
      period: { from: '2026-01-01', until: '2027-01-01' },
    })
  })

  it('names what it found without claiming more than arithmetic', async () => {
    // AC8, decided before the code was written. A shortfall against a schedule
    // is a subtraction; "delinquent" is a claim about a person, and the
    // commonest cause of one is a deposit nobody has uploaded yet.
    expect(UNIT_DUES_SHORTFALL).toBe('unit_dues_shortfall')
    expect(UNIT_DUES_SHORTFALL).toMatch(/^[a-z][a-z0-9_]*$/)
  })

  it('carries the figures a board member needs to check the claim', async () => {
    const findings = register()

    await detectDuesShortfalls(DOCUMENT, {
      dues: reader([dues({ payments: [{ paidOn: '2026-01-05', amount: '300.00' }] })]),
      findings: findings.port,
    })

    expect(findings.raised[0]!.evidence).toMatchObject({
      kind: 'below-expected',
      expected: '400.00',
      received: '300.00',
      shortfall: '100.00',
      instalmentsDue: 4,
      billingCycle: 'monthly',
      evaluatedOn: '2026-04-01',
      unitNumber: '101',
      holderName: 'Dana Whitfield',
    })

    // The denominator UX-DR24 asks for is the one about *this unit* — how many
    // instalments the shortfall rests on. A count of the whole roll was here
    // until Argus noticed it contradicted its own comment.
    expect(findings.raised[0]!.evidence).not.toHaveProperty('unitsChecked')
  })

  it('files one finding that changes rather than two that disagree', async () => {
    // **The reason this story ships one finding type.** A unit with nothing
    // recorded, then a part-payment, is the same finding with new evidence —
    // not a second finding beside a stale first. Two types would not collide on
    // `finding_identity`, which is precisely the problem: migration 021 makes a
    // finding one-way, so nothing would ever retract the out-of-date one.
    const findings = register()
    const deps = { findings: findings.port }

    await detectDuesShortfalls(DOCUMENT, { ...deps, dues: reader([dues()]) })
    await detectDuesShortfalls(DOCUMENT, {
      ...deps,
      dues: reader([dues({ payments: [{ paidOn: '2026-02-01', amount: '50.00' }] })]),
    })

    expect(findings.raised.map((request) => request.findingType)).toEqual([
      UNIT_DUES_SHORTFALL,
      UNIT_DUES_SHORTFALL,
    ])
    expect(findings.raised.map((request) => request.subjectId)).toEqual([UNIT, UNIT])
    expect(findings.raised.map((request) => request.period)).toEqual([
      { from: '2026-01-01', until: '2027-01-01' },
      { from: '2026-01-01', until: '2027-01-01' },
    ])
    // Same key both times, so the register amends rather than adds — and the
    // kind moves with the evidence.
    expect(findings.raised[0]!.evidence).toMatchObject({ kind: 'not-recorded' })
    expect(findings.raised[1]!.evidence).toMatchObject({ kind: 'below-expected' })
  })

  it('evaluates every year the deposit carries money for', async () => {
    // **The defect Argus found, and it was worse than the note admitting it.**
    // A deposit arriving in January settling last year's arrears was only ever
    // checked against the new year, so the *previous* year's finding was never
    // re-evaluated — and migration 021 makes a finding one-way, so nothing else
    // would ever correct it. A board member would go on reading arrears that
    // had been paid.
    const findings = register()
    const lastYear = dues({
      unitId: 'u-1',
      assessment: { annualAmount: '1200.00', billingCycle: 'annual', assessmentYear: 2025 },
    })
    const thisYear = dues({
      unitId: 'u-1',
      assessment: { annualAmount: '1200.00', billingCycle: 'annual', assessmentYear: 2026 },
    })

    const outcome = await detectDuesShortfalls(DOCUMENT, {
      // Uploaded in January 2026, carrying a payment dated 2025.
      dues: reader([lastYear, thisYear], '2026-01-10', [2025]),
      findings: findings.port,
    })

    expect(findings.raised.map((request) => request.period)).toEqual([
      { from: '2025-01-01', until: '2026-01-01' },
      { from: '2026-01-01', until: '2027-01-01' },
    ])
    // Accumulated across the years, not overwritten by the last one — a
    // mutation replacing `+=` with `=` survived until this line existed.
    // One unit, two years: `subjectsChecked` counts distinct units, so it is 1
    // and not 2. Raised by CodeRabbit — summing per year would overstate the
    // roll to any surface that reports it.
    expect(outcome).toMatchObject({ raised: 2, subjectsChecked: 1 })
  })

  it('checks the current roll even when the deposit carries no payments', async () => {
    const findings = register()

    await detectDuesShortfalls(DOCUMENT, {
      dues: reader([dues()], '2026-04-01', []),
      findings: findings.port,
    })

    expect(findings.raised).toHaveLength(1)
    expect(findings.raised[0]!.period).toEqual({ from: '2026-01-01', until: '2027-01-01' })
  })

  it('raises one finding per unit and counts them all', async () => {
    const findings = register()
    const short = dues({ unitId: 'u-1', unitNumber: '1' })
    const alsoShort = dues({ unitId: 'u-2', unitNumber: '2' })
    const settled = dues({
      unitId: 'u-3',
      unitNumber: '3',
      payments: [{ paidOn: '2026-01-05', amount: '1200.00' }],
    })

    const outcome = await detectDuesShortfalls(DOCUMENT, {
      dues: reader([short, alsoShort, settled]),
      findings: findings.port,
    })

    expect(findings.raised.map((request) => request.subjectId)).toEqual(['u-1', 'u-2'])
    expect(outcome).toEqual({ raised: 2, amended: 0, subjectsChecked: 3 })
  })

  it('reports an amended finding as amended rather than raised', async () => {
    const findings = register(true)

    const outcome = await detectDuesShortfalls(DOCUMENT, {
      dues: reader([dues()]),
      findings: findings.port,
    })

    expect(outcome).toEqual({ raised: 0, amended: 1, subjectsChecked: 1 })
  })

  it('takes the year from the evaluation date, not from a clock', async () => {
    // AC3. Two runs of the same document agree because the date is a property
    // of the document; a detector reading `now()` would file the finding under
    // whichever year it happened to be asked in.
    const findings = register()

    await detectDuesShortfalls(DOCUMENT, {
      dues: reader([dues({ assessment: { annualAmount: '600.00', billingCycle: 'annual', assessmentYear: 2024 } })], '2024-09-09'),
      findings: findings.port,
    })

    expect(findings.raised[0]).toMatchObject({
      period: { from: '2024-01-01', until: '2025-01-01' },
      evidence: { evaluatedOn: '2024-09-09' },
    })
  })
})

describe('the period a finding is filed under', () => {
  it.each([99999, -100, 0, 2026.5])('refuses %s rather than filing a finding under it', (year) => {
    // Tested on `yearRange` directly rather than through the detector: with a
    // year no unit is assessed for, the loop body never runs and the guard is
    // never reached — the first version of this case passed for that reason
    // and proved nothing.
    //
    // `padStart` does not truncate, so these would have become `99999-01-01`,
    // `-100-01-01` and `2026.5-01-01` — period keys nobody would match again,
    // built three layers from whatever produced the number. Raised by
    // CodeRabbit.
    expect(() => yearRange(year)).toThrow(RangeError)
  })

  it.each([1900, 2026, 2200])('accepts %s, the range migration 013 allows', (year) => {
    expect(yearRange(year).from).toBe(`${year}-01-01`)
  })
})

describe('when there is nothing to raise', () => {
  it('raises nothing when the roll has no assessed units', async () => {
    // A unit with no assessment for the year never reaches this function: the
    // reader selects from the roll, so "nothing owed" is expressed by absence.
    // That used to be a null field and a check here, until the AC audit found
    // the deeper problem the field was hiding.
    const findings = register()

    const outcome = await detectDuesShortfalls(DOCUMENT, {
      dues: reader([]),
      findings: findings.port,
    })

    expect(findings.port.raise).not.toHaveBeenCalled()
    expect(outcome).toEqual({ raised: 0, amended: 0, subjectsChecked: 0 })
  })

  it('raises nothing for a unit that has paid what was expected', async () => {
    const findings = register()

    await detectDuesShortfalls(DOCUMENT, {
      dues: reader([dues({ payments: [{ paidOn: '2026-01-05', amount: '400.00' }] })]),
      findings: findings.port,
    })

    expect(findings.port.raise).not.toHaveBeenCalled()
  })

  it('does nothing at all for a document it cannot date', async () => {
    // No evaluation date, no comparison. Reaching for today's date instead
    // would answer a different question every day.
    const findings = register()
    const dues_ = reader([dues()], null)

    const outcome = await detectDuesShortfalls(DOCUMENT, { dues: dues_, findings: findings.port })

    expect(outcome).toEqual({ raised: 0, amended: 0, subjectsChecked: 0 })
    expect(dues_.duesForYear).not.toHaveBeenCalled()
    expect(findings.port.raise).not.toHaveBeenCalled()
  })
})
