'use server'

/**
 * Changing a mapping: what it will cost, and then doing it (story 5.7, AC6).
 *
 * ## Why this is not in `actions.ts`
 *
 * Everything here reaches what that module may not — object storage, `ingest`,
 * the document candidates. That prohibition is not an inconvenience routed
 * around by putting the same code in a different file: it is the rule that keeps
 * the *sample* path away from the permanent record, and a sample is not a
 * document the association is keeping. Two modules because there are two
 * privileges, and `actions.test.ts` asserts the split with a positive control
 * naming this module's own dependencies.
 *
 * ## Two actions, because AC6 describes two acts
 *
 * A treasurer is *"told, before it runs, how many documents it will re-read"*,
 * and then it runs. `previewMappingChange` is the telling and writes nothing;
 * `changeMapping` is the act. Collapsing them into one call that re-imported and
 * then reported the number would be showing somebody the bill after taking the
 * money.
 *
 * `actions.ts`'s `saveMapping` remains the plain save, for a shape nothing was
 * imported under. Two entry points for two different acts — not two ways to do
 * one thing. The wizard asks for the preview first and chooses between them on
 * the answer.
 *
 * ## Why saving and re-importing are one action
 *
 * `save` returns the mapping it replaced, and that value exists nowhere else
 * afterwards — the row is overwritten. The record AC6 asks for names the old
 * mapping and the new one, so the only place it can be written is the call that
 * still holds both. Handing the previous mapping back to the browser and
 * accepting it again would make an audit record's content something the client
 * asserts, which is worse than not having one.
 */

import { auth } from '@/adapters/auth/auth'
import { createMappingChangeLog } from '@/adapters/db/mapping-change-log-postgres'
import { createMappingStore } from '@/adapters/db/mapping-store-postgres'
import { createReimportCandidates } from '@/adapters/db/reimport-candidates-postgres'
import { readHeadings } from '@/core/extraction/headings'
import { isDocumentKind } from '@/core/extraction/record'
import { ingest } from '@/core/ingestion/ingest'
import { previewReimport, reimport } from '@/core/mapping/reimport'
import { shapeKey } from '@/core/mapping/saved'
import { draftFromPairings } from './parse-mapping'
import type { ChangeState, PreviewState } from './change-state'
import { ingestionDependencies } from '../../ingestion-dependencies'

/** Session, kind and the shape derived here — never taken from the form. */
async function context(formData: FormData) {
  const session = await auth()
  const member = session?.user?.id

  if (typeof member !== 'string' || member.trim() === '') return null

  const kind = formData.get('documentKind')
  if (!isDocumentKind(kind)) return null

  const header = parseJson(formData.get('headerRow'))
  if (!Array.isArray(header) || !header.every((cell) => typeof cell === 'string')) return null

  // The importer's own reading, so a shape derived here and a shape derived at
  // upload time cannot disagree. A client-sent shape would decide which stored
  // mapping a re-import rewrites, which is the one input that must not be
  // assertable.
  const headings = readHeadings([header])
  if (!headings.ok) return null

  return {
    member,
    kind,
    shape: shapeKey(kind, headings.headings),
    columns: headings.headings.length,
  }
}

function parseJson(value: FormDataEntryValue | null): unknown {
  if (typeof value !== 'string') return null

  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

/**
 * How many documents changing this mapping would re-read. Writes nothing.
 *
 * `nothing-to-change` is not a failure and must not be shown as one: it is the
 * ordinary answer for a shape nobody has mapped yet, and it is what tells the
 * wizard to use the plain save instead.
 */
export async function previewMappingChange(
  _previous: PreviewState,
  formData: FormData,
): Promise<PreviewState> {
  const where = await context(formData)
  if (where === null) {
    return { status: 'error', error: 'That mapping could not be read. Start the wizard again.' }
  }

  const existing = await createMappingStore().find(where.member, where.kind, where.shape)
  if (existing === null) return { status: 'nothing-to-change' }

  const { affected, unreadable } = await previewReimport(where.member, where.kind, where.shape, {
    ...ingestionDependencies('mapping-change'),
    ingest,
    candidates: createReimportCandidates(),
  })

  return { status: 'would-replace', affected, unreadable }
}

/**
 * Replace the mapping, re-import what it affects, and record that it happened.
 *
 * In that order, and all three in one action for the reason the header gives:
 * after `save`, the mapping it replaced exists nowhere else.
 *
 * **The record is written last, and only after the re-import.** It names which
 * documents were re-imported and what happened to each, so writing it first
 * would mean a row claiming a re-import that had not run — and migration 027
 * revokes UPDATE, so there would be no correcting it.
 */
export async function changeMapping(
  _previous: ChangeState,
  formData: FormData,
): Promise<ChangeState> {
  const where = await context(formData)
  if (where === null) {
    return { status: 'error', error: 'That mapping could not be read. Start the wizard again.' }
  }

  /**
   * Built here from the pairings alone. The form sends no kind and no column
   * count, so it cannot assert either.
   *
   * This took an entire `DraftMapping` from the form and checked its shape.
   * Argus found the hole: a form could declare `documentKind: deposit` - so the
   * shape was derived for a deposit - and send a mapping whose own `kind` was
   * `invoice`. It would be stored under the deposit shape and applied to every
   * later deposit export, pairing that file's columns to an invoice's fields,
   * with nothing thrown and every value plausible where it landed.
   *
   * A kind check would have closed it. Deriving both instead means there is
   * nothing to check.
   */
  const mapping = draftFromPairings(where.kind, where.columns, parseJson(formData.get('pairings')))
  if (mapping === null) {
    return { status: 'error', error: 'That mapping is not valid. Check the columns and try again.' }
  }

  const replaced = await createMappingStore().save({
    savedBy: where.member,
    kind: where.kind,
    shape: where.shape,
    mapping,
  })

  const documents = await reimport(where.member, where.kind, where.shape, {
    ...ingestionDependencies('mapping-change'),
    ingest,
    candidates: createReimportCandidates(),
  })

  try {
    await createMappingChangeLog().record({
      changedBy: where.member,
      kind: where.kind,
      shape: where.shape,
      // Null when nothing was replaced, which the column is nullable for.
      previous: replaced?.mapping ?? null,
      next: mapping,
      documents,
    })
  } catch (error) {
    /**
     * The change already happened: the mapping is replaced and the documents
     * are re-parsed. Rethrowing would report a failure that did not occur and
     * invite the treasurer to run it again.
     *
     * So it is reported as its own outcome. There is no transaction that could
     * have avoided this - the act spans object storage and many rows across two
     * tables, and 027 revokes UPDATE so the record cannot be written first and
     * corrected after. Raised by ocr.
     */
    console.error('[mapping-change] the change was applied but not recorded', error)

    return { status: 'changed-unrecorded', documents }
  }

  // Per document, not summarised. AC7 refuses a single "done", and a treasurer
  // whose statement could not be re-read needs to know which one.
  return { status: 'changed', documents }
}
