import type { HeldItem } from '../ports/quarantine-queue'

/**
 * What the queue surface renders.
 *
 * A separate shape from `readonly HeldItem[]` for one reason: emptiness is a
 * decision, and AC2 makes it a criterion of its own. Left to each caller,
 * "nothing is waiting" gets defined once per surface and they can disagree.
 * Decided here, once.
 */
export interface QueueView {
  readonly items: readonly HeldItem[]
  readonly isEmpty: boolean
  readonly count: number
}

/**
 * The order is the query's, and stays the query's.
 *
 * Sorting here would look harmless and would be a second answer to "which is
 * first" -- the adapter already fixed one, breaking `created_at` ties by id so
 * two renders of an unchanged queue agree. Nothing is grouped or de-duplicated
 * either: a document held for two unrecognised names is two questions, not one
 * document carrying a list.
 *
 * A blank name is not defended against. The column forbids it, so a placeholder
 * would be unreachable -- and on the day it did run it would show a treasurer a
 * name no document ever contained, while they are being asked to recognise one.
 */
export function toQueueView(items: readonly HeldItem[]): QueueView {
  // Copied, so a caller sorting the view in place cannot reach back through it
  // and reorder what the adapter returned.
  const held = [...items]

  return {
    items: held,
    isEmpty: held.length === 0,
    count: held.length,
  }
}
