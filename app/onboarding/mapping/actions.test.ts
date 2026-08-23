/**
 * The sample-reading action (story 5.4, Task 3 — the surface story 5.3 held back).
 *
 * A server action is its own entry point, reachable without the page ever
 * rendering, so the route's protection guards nothing here. That is the argument
 * `app/quarantine/actions.test.ts` already makes, and it applies with less at
 * stake but the same shape: unguarded, this is a public file parser.
 *
 * The other half of this file is structural. **Nothing here stores anything**,
 * and no behavioural test can prove the absence of a write it never triggered —
 * so one test reads the module's own imports. Story 5.3 arrived at that shape
 * after a check written to prove two modules shared a folding turned out to be
 * satisfied by an import the module never used.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MAX_DOCUMENT_BYTES } from '@/core/ingestion/acceptance'
import { specifiersIn } from '@/core/ports/module-specifiers'

const auth = vi.fn()
const decode = vi.fn<(bytes: Uint8Array) => { ok: true; rows: string[][] } | { ok: false }>(() => ({
  ok: true,
  rows: [
    ['Date', 'Amount', 'Unit'],
    ['2026-03-01', '1240.00', '12B'],
  ],
}))

const askModel = vi.fn()

vi.mock('@/adapters/auth/auth', () => ({ auth: () => auth() }))
vi.mock('@/adapters/extraction/suggester-gemini', () => ({
  askModelForColumns: (...args: unknown[]) => askModel(...args),
}))
vi.mock('@/adapters/extraction/workbook-sheetjs', () => ({
  readWorkbook: (bytes: Uint8Array) => decode(bytes),
}))

/** What `save` reports it replaced. `null` is a first mapping. */
const save = vi.fn<(mapping: unknown) => Promise<unknown>>(async () => null)
vi.mock('@/adapters/db/mapping-store-postgres', () => ({
  createMappingStore: () => ({ save: (mapping: unknown) => save(mapping), find: vi.fn() }),
}))

const SIGNED_IN = { user: { id: 'director-1', email: 'treasurer@example.com' } }

const CSV = 'Date,Amount,Unit\r\n2026-03-01,1240.00,12B\r\n'

/**
 * The same sample plus a column nothing recognises.
 *
 * The model is only asked about the **residue**, so a file whose columns are all
 * matched produces no call at all — that is the behaviour, not a defect, and the
 * first version of the configured-path test below failed for exactly that
 * reason. `Mystery` is what makes a call happen: `description` stays unfilled
 * and column 4 stays unclaimed.
 */
const CSV_WITH_RESIDUE = 'Date,Amount,Unit,Mystery\r\n2026-03-01,1240.00,12B,x\r\n'

/** A `File` the action will read, with a size it can check before reading. */
function sample(
  content: string | Uint8Array,
  { name = 'deposits.csv', type = 'text/csv' } = {},
): File {
  return new File([content as BlobPart], name, { type })
}

function form(fields: Record<string, string | File>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

async function act() {
  const { readSample } = await import('./actions')
  return readSample
}

const IDLE = { status: 'idle' } as const

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  /**
   * **Every test in this file, not one.** `readSample` calls
   * `suggestWithModel(..., askModelForColumns)` on every successful read, so
   * an ambient `GEMINI_API_KEY` from a developer shell or a CI job would make
   * the success test issue a real outbound request — and could fill
   * `description`, failing its exact fixture.
   *
   * `vi.unstubAllEnvs()` above removes stubs *tests* set; it does nothing
   * about a real variable in the environment. Pinning one test and calling
   * that 'pinned rather than assumed' was still an assumption about the
   * machine. Raised by CodeRabbit.
   */
  vi.stubEnv('GEMINI_API_KEY', '')
  vi.stubEnv('GEMINI_SUGGEST_MODEL', '')
  auth.mockResolvedValue(SIGNED_IN)

  // `vi.clearAllMocks()` clears calls but keeps implementations, so a
  // `mockResolvedValue` set by one test survives into the next. Here that would
  // mean a later test seeing a *replaced* mapping it never arranged - and the
  // one it would break is the one asserting a first save reports `saved`.
  save.mockResolvedValue(null)
})

describe('reading a sample', () => {
  it('returns the headings the file actually has, in order', async () => {
    const readSample = await act()

    const state = await readSample(IDLE, form({ documentKind: 'deposit', sample: sample(CSV) }))

    expect(state).toEqual({
      status: 'read',
      kind: 'deposit',
      headings: [
        { position: 1, text: 'Date', normalised: 'date' },
        { position: 2, text: 'Amount', normalised: 'amount' },
        { position: 3, text: 'Unit', normalised: 'unit' },
      ],
      problems: [],
      // Story 5.5: the rows travel with the headings so the preview need not
      // ask for the file again.
      rows: [
        ['Date', 'Amount', 'Unit'],
        ['2026-03-01', '1240.00', '12B'],
      ],
      totalDataRows: 1,
      // Story 5.6b: the suggestion is computed here now, not in the client
      // component, because the model-backed half needs a server-only
      // credential. Written out rather than derived from `suggestColumns`, so
      // this is a fixture and not a restatement of the implementation.
      suggestions: [
        { target: 'date', position: 1 },
        { target: 'description', position: null },
        { target: 'amount', position: 2 },
        { target: 'unit', position: 3 },
      ],
    })
  })

  it('still reads the sample when no model is configured (story 5.6b, AC2)', async () => {
    /**
     * **FR-10's requirement, at the layer where it would break.** No test here
     * sets `GEMINI_API_KEY`, so the model half is unconfigured on every run in
     * this file — which is exactly the production case of a deployment that has
     * not enabled it. The action must return a readable sample with the
     * deterministic suggestion, not an error and not a rejected promise.
     *
     * **Pinned in `beforeEach`, for every test in this file.** "No test here
     * sets it" was a claim about the *runner's* environment: a developer or CI job
     * with `GEMINI_API_KEY` exported would have turned this suite into one that
     * makes a real outbound request. Raised by CodeRabbit.
     */
    const readSample = await act()

    const state = await readSample(IDLE, form({ documentKind: 'deposit', sample: sample(CSV) }))

    expect(state.status).toBe('read')
    expect(state.status === 'read' && state.suggestions?.length).toBeGreaterThan(0)
    // Deterministic matching still did its job; the absent model cost nothing.
    expect(
      state.status === 'read' &&
        state.suggestions?.find((s) => s.target === 'amount')?.position,
    ).toBe(2)
  })

  it('carries a model suggestion through when the model is configured', async () => {
    /**
     * **The path no test covered.** Pinning the credential in `beforeEach` — the
     * fix for a real hazard — left every test in this file running with the
     * model half disabled, so nothing exercised it being *on*. Raised by
     * CodeRabbit, and it is the shape where one fix opens a gap somewhere else.
     *
     * `Unit` is matched deterministically; `description` is not, so it is what
     * the model is asked about and what it fills here.
     */
    vi.stubEnv('GEMINI_API_KEY', 'test-key')
    vi.stubEnv('GEMINI_SUGGEST_MODEL', 'test-model')
    askModel.mockResolvedValue([{ target: 'description', position: 4 }])

    const readSample = await act()
    const state = await readSample(
      IDLE,
      form({ documentKind: 'deposit', sample: sample(CSV_WITH_RESIDUE) }),
    )

    expect(askModel).toHaveBeenCalledTimes(1)
    expect(state.status).toBe('read')
    expect(
      state.status === 'read' && state.suggestions?.find((s) => s.target === 'description')?.position,
    ).toBe(4)
  })

  it('falls back to the deterministic suggestion when the model rejects', async () => {
    // AC2 with the model configured and failing, rather than absent.
    vi.stubEnv('GEMINI_API_KEY', 'test-key')
    vi.stubEnv('GEMINI_SUGGEST_MODEL', 'test-model')
    askModel.mockRejectedValue(new Error('provider exploded'))

    const readSample = await act()
    const state = await readSample(
      IDLE,
      form({ documentKind: 'deposit', sample: sample(CSV_WITH_RESIDUE) }),
    )

    // The same sample as the success case, so the only difference is how the
    // model answered — otherwise this could pass by never asking at all.
    expect(askModel).toHaveBeenCalledTimes(1)
    expect(state.status).toBe('read')
    expect(
      state.status === 'read' && state.suggestions?.find((s) => s.target === 'amount')?.position,
    ).toBe(2)
    expect(
      state.status === 'read' && state.suggestions?.find((s) => s.target === 'description')?.position,
    ).toBeNull()
  })

  it('carries the duplicates and blanks story 5.3 reports rather than refusing them', async () => {
    const readSample = await act()

    const state = await readSample(
      IDLE,
      form({
        documentKind: 'deposit',
        sample: sample('Date,Amount,  ,amount\r\n2026-03-01,1240.00,x,99.00\r\n'),
      }),
    )

    expect(state.status).toBe('read')
    expect(state.status === 'read' && state.problems).toEqual([
      { reason: 'duplicate-heading', heading: 'amount', positions: [2, 4] },
      { reason: 'blank-heading', positions: [3] },
    ])
  })

  it('reads a spreadsheet through the workbook decoder, not only a CSV', async () => {
    const readSample = await act()

    const state = await readSample(
      IDLE,
      form({
        documentKind: 'deposit',
        sample: sample(new Uint8Array([1, 2, 3]), {
          name: 'deposits.xlsx',
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      }),
    )

    // Without the decoder passed, every spreadsheet comes back `no-reader`
    // while CSVs work — a wizard that reads half the formats the importer does.
    expect(decode).toHaveBeenCalledTimes(1)
    expect(state.status).toBe('read')
  })
})

describe('the guards, in the order they happen', () => {
  it('refuses without a session, before reading anything', async () => {
    auth.mockResolvedValue(null)
    const readSample = await act()

    const state = await readSample(IDLE, form({ documentKind: 'deposit', sample: sample(CSV) }))

    expect(state.status).toBe('error')
    // Asserted rather than only the refusal: the point is that no file is read,
    // not merely that a message comes back.
    expect(decode).not.toHaveBeenCalled()
  })

  it('refuses a session carrying no usable id', async () => {
    auth.mockResolvedValue({ user: { id: '   ' } })
    const readSample = await act()

    const state = await readSample(IDLE, form({ documentKind: 'deposit', sample: sample(CSV) }))

    expect(state.status).toBe('error')
  })

  it('refuses when no kind was declared', async () => {
    const readSample = await act()

    const state = await readSample(IDLE, form({ sample: sample(CSV) }))

    expect(state).toEqual({
      status: 'error',
      error: 'Choose which kind of import you are setting up.',
    })
  })

  it('refuses a kind the domain does not publish', async () => {
    const readSample = await act()

    const state = await readSample(
      IDLE,
      form({ documentKind: 'bank_feed', sample: sample(CSV) }),
    )

    expect(state.status).toBe('error')
  })

  it('refuses when no file was chosen', async () => {
    const readSample = await act()

    const state = await readSample(IDLE, form({ documentKind: 'deposit' }))

    expect(state).toEqual({ status: 'error', error: 'Choose a sample file to read.' })
  })

  it('refuses an empty file input, which arrives as a nameless zero-byte File', async () => {
    const readSample = await act()

    const state = await readSample(
      IDLE,
      form({ documentKind: 'deposit', sample: sample('', { name: '', type: '' }) }),
    )

    expect(state).toEqual({ status: 'error', error: 'Choose a sample file to read.' })
  })

  it('refuses a file past the size limit without reading it', async () => {
    const readSample = await act()
    const tooBig = sample(new Uint8Array(MAX_DOCUMENT_BYTES + 1), {
      name: 'huge.xlsx',
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    const state = await readSample(IDLE, form({ documentKind: 'deposit', sample: tooBig }))

    expect(state.status).toBe('error')
    // Reading first would hold the whole file in memory to decide it was too
    // big to hold in memory.
    expect(decode).not.toHaveBeenCalled()
  })

  it('accepts a file exactly at the size limit', async () => {
    // The boundary in the other direction, in the same block: without it the
    // refusal above passes against an action that refuses every file.
    const readSample = await act()
    // Padded inside the last cell, not after the final newline: trailing filler
    // makes a ragged row and the file is then refused as unreadable, which would
    // have passed this test for the wrong reason.
    const head = 'Date,Amount,Unit\r\n2026-03-01,1240.00,'
    const atLimit = sample(head + 'x'.repeat(MAX_DOCUMENT_BYTES - head.length - 2) + '\r\n')

    expect(atLimit.size).toBe(MAX_DOCUMENT_BYTES)

    const state = await readSample(IDLE, form({ documentKind: 'deposit', sample: atLimit }))

    expect(state.status).toBe('read')
  })
})

describe('the four refusals stay four', () => {
  // Story 5.3 kept `empty-file` apart from `unreadable-file` because "your file
  // is empty" and "your file could not be read" send a treasurer to different
  // places. Collapsed here, that distinction is lost at the last step.
  it('says something different for a format it cannot read', async () => {
    const readSample = await act()

    const state = await readSample(
      IDLE,
      form({ documentKind: 'deposit', sample: sample('x', { name: 'scan.pdf', type: 'application/pdf' }) }),
    )

    expect(state.status === 'error' && state.error).toMatch(/CSV|spreadsheet/i)
  })

  it('says something different for an empty file', async () => {
    const readSample = await act()

    const state = await readSample(IDLE, form({ documentKind: 'deposit', sample: sample(' ') }))

    expect(state.status === 'error' && state.error).toMatch(/empty/i)
  })

  it('says something different for a file whose headings are all blank', async () => {
    const readSample = await act()

    const state = await readSample(
      IDLE,
      form({ documentKind: 'deposit', sample: sample(' , , \r\n1,2,3\r\n') }),
    )

    expect(state.status === 'error' && state.error).toMatch(/blank/i)
  })

  it('gives each refusal its own sentence', async () => {
    const readSample = await act()
    const cases = [
      sample('x', { name: 'scan.pdf', type: 'application/pdf' }),
      sample(' '),
      sample(' , , \r\n1,2,3\r\n'),
    ]

    const messages = new Set<string>()
    for (const file of cases) {
      const state = await readSample(IDLE, form({ documentKind: 'deposit', sample: file }))
      if (state.status === 'error') messages.add(state.error)
    }

    // Three distinct reasons, three distinct sentences — and non-empty, because
    // a set built from nothing has a size the assertion would also accept.
    expect(messages.size).toBe(cases.length)
  })
})

describe('confirming a mapping (AC3)', () => {
  const saveAction = async () => (await import('./actions')).saveMapping

  const HEADER = JSON.stringify(['Date', 'Amount', 'Unit'])
  const PAIRINGS = JSON.stringify([
    { target: 'date', position: 1 },
    { target: 'amount', position: 2 },
  ])

  const confirm = async (fields: Record<string, string>) =>
    (await saveAction())({ status: 'idle' }, form(fields))

  it('refuses without a session', async () => {
    // A server action is its own entry point. Without this, anyone could write a
    // mapping into a board's setup.
    auth.mockResolvedValue(null)

    const state = await confirm({ documentKind: 'deposit', headerRow: HEADER, pairings: PAIRINGS })

    expect(state.status).toBe('error')
    expect(save).not.toHaveBeenCalled()
  })

  it('refuses a kind the form did not declare', async () => {
    auth.mockResolvedValue(SIGNED_IN)

    const state = await confirm({ documentKind: '', headerRow: HEADER, pairings: PAIRINGS })

    expect(state.status).toBe('error')
    expect(save).not.toHaveBeenCalled()
  })

  it('stores the shape it derives, never one the form sends', async () => {
    /**
     * The input that must not be assertable. The stored shape decides which
     * mapping a later upload matches, so a client-supplied one would let a form
     * claim its mapping applies to a heading row it was never built for.
     *
     * The form here sends a `shape` field outright, and it is ignored.
     */
    auth.mockResolvedValue(SIGNED_IN)

    await confirm({
      documentKind: 'deposit',
      headerRow: HEADER,
      pairings: PAIRINGS,
      shape: 'whatever-the-client-says',
    })

    const saved = save.mock.calls[0]?.[0] as { shape: string }

    expect(saved.shape).not.toContain('whatever-the-client-says')
    // Derived through the importer's own folding, so it is case- and
    // space-insensitive exactly as an upload's is.
    expect(saved.shape).toContain('date')
  })

  it('saves as the signed-in member, so the adapter can derive the association', async () => {
    auth.mockResolvedValue(SIGNED_IN)

    await confirm({ documentKind: 'deposit', headerRow: HEADER, pairings: PAIRINGS })

    const saved = save.mock.calls[0]?.[0] as { savedBy: string }

    expect(saved.savedBy).toBe('director-1')
  })

  it('refuses the whole submission when one pairing is invalid', async () => {
    /**
     * All-or-nothing. A partially applied mapping is the failure that looks like
     * success: the treasurer sees "saved" and one column they set is quietly
     * absent, surfacing weeks later as a column of empty amounts.
     *
     * Column 9 does not exist in a three-column sample, and `assign` is what
     * says so - this action does not re-decide it.
     */
    auth.mockResolvedValue(SIGNED_IN)

    const state = await confirm({
      documentKind: 'deposit',
      headerRow: HEADER,
      pairings: JSON.stringify([
        { target: 'date', position: 1 },
        { target: 'amount', position: 9 },
      ]),
    })

    expect(state.status).toBe('error')
    expect(save).not.toHaveBeenCalled()
  })

  it('refuses a target the kind does not offer', async () => {
    auth.mockResolvedValue(SIGNED_IN)

    const state = await confirm({
      documentKind: 'deposit',
      headerRow: HEADER,
      pairings: JSON.stringify([{ target: 'not_a_field', position: 1 }]),
    })

    expect(state.status).toBe('error')
    expect(save).not.toHaveBeenCalled()
  })

  it('refuses a mapping it cannot parse rather than storing an empty one', async () => {
    // The dangerous version of this bug stores `pairings: []` and reports
    // success, so every later upload of that shape imports nothing.
    auth.mockResolvedValue(SIGNED_IN)

    const state = await confirm({
      documentKind: 'deposit',
      headerRow: HEADER,
      pairings: 'not json at all',
    })

    expect(state.status).toBe('error')
    expect(save).not.toHaveBeenCalled()
  })

  it('reports a first mapping as saved', async () => {
    auth.mockResolvedValue(SIGNED_IN)
    save.mockResolvedValue(null)

    const state = await confirm({ documentKind: 'deposit', headerRow: HEADER, pairings: PAIRINGS })

    expect(state).toEqual({ status: 'saved' })
  })

  it('reports a changed mapping as replaced, which is what triggers the warning', async () => {
    // The distinction the story's second half turns on. Collapsing the two into
    // one `saved` would make the warning impossible to render.
    auth.mockResolvedValue(SIGNED_IN)
    save.mockResolvedValue({ savedBy: 'director-1', kind: 'deposit', shape: 's', mapping: {} })

    const state = await confirm({ documentKind: 'deposit', headerRow: HEADER, pairings: PAIRINGS })

    expect(state).toEqual({ status: 'replaced' })
  })
})

describe('nothing is stored', () => {
  it('imports no repository, no store and no ingestion', async () => {
    const source = readFileSync(fileURLToPath(new URL('./actions.ts', import.meta.url)), 'utf8')
    // Every shape a module specifier can arrive in, not just the single-line
    // `import ... from '...'` this originally matched. A multiline import - the
    // shape a formatter produces the moment this file gains one more name - was
    // invisible to it, and so was a re-export or a dynamic `import()`. A guard
    // that misses the syntax someone actually writes is not a guard.
    // Raised by CodeRabbit.
    //
    // **Now `specifiersIn`, shared.** Story 5.6 consolidated four private copies
    // of this scanner after finding they had drifted apart; this was a fifth it
    // never reached, and a weaker one — it did not blank comments, so a
    // commented-out import would have failed the build for a line nobody runs.
    const imported = specifiersIn(source)

    // Non-empty first: a filter over nothing reports success, which is how
    // story 5.3's `TABULAR_CONTENT_TYPES` round-trip passed against an empty
    // list.
    expect(imported.length).toBeGreaterThan(0)

    /**
     * **Narrowed by story 5.7, not relaxed.** This module now reaches the
     * mapping store, because AC3 puts the treasurer's confirmation here. It
     * still reaches nothing else, and the reason the rest of the list survives
     * is unchanged: a sample is not a document the association is keeping, and
     * one landing in `document` would sit in the permanent record and count
     * against the register a board reads.
     *
     * The allowance is **one exact specifier**, not a loosened pattern. Widening
     * the regex to let `mapping-store-postgres` through would have let every
     * other adapter through with it, and the test would still have passed - the
     * failure mode of every narrowing, which is why this one is a named
     * exception the positive control below re-proves.
     */
    const ALLOWED = '@/adapters/db/mapping-store-postgres'

    const forbids = (specifier: string) =>
      specifier !== ALLOWED &&
      /repository|-postgres|document-store|storage\/|\/ingest$/.test(specifier)

    expect(imported.filter(forbids)).toEqual([])

    // The mapping store really is reached, so the exception above is describing
    // this module rather than sitting unused and unfalsifiable.
    expect(imported).toContain(ALLOWED)

    /**
     * The positive control, and the whole reason the narrowing is trustworthy.
     * A rule that no longer refuses anything passes silently forever; this feeds
     * it the specifiers it must still refuse - including the re-import's own
     * dependencies, which is what makes "the re-import lives elsewhere" a tested
     * claim rather than an intention.
     */
    expect(
      [
        '@/adapters/db/document-repository-postgres',
        '@/adapters/db/reimport-candidates-postgres',
        '@/adapters/storage/r2',
        '@/core/ingestion/ingest',
        '@/core/ports/document-store',
      ].filter(forbids),
    ).toHaveLength(5)
  })
})
