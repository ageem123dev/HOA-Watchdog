/**
 * A named parameter set, turned into the positional array a query expects.
 *
 * Small enough to look like it belongs inline in the executor, and it does not,
 * for two reasons. It is the one place where `bind`'s ordering contract is
 * actually applied — the join between `{ unitNumber, assessmentYear }` and
 * `$1, $2` — and getting it wrong produces a query that succeeds while answering
 * about the wrong unit. And it is pure, so it can be tested against entry shapes
 * the catalog does not hold yet, which is where its only real hazard lives.
 */

import type { CatalogEntry } from './entry'

/**
 * The values for `$1 … $n`, in the entry's declared order.
 *
 * **An absent optional parameter binds as `null`, never as `undefined`.** `pg`
 * refuses `undefined` outright — it throws rather than treating it as SQL NULL —
 * so a bound optional parameter that a caller omitted would crash the query
 * instead of filtering on nothing. No entry in the catalog declares an optional
 * bound parameter today, which is exactly why this is written now: the first one
 * that does would otherwise find this out in production, and `dues_status@1`'s
 * own tests could never have caught it.
 *
 * `??` and not `||`, so a legitimately empty string or a zero is bound as
 * itself. A unit number of `'0'` is a unit number.
 *
 * The parameters are assumed to have passed `validateParameters` already: this
 * orders values, it does not police them. Anything undeclared has been rejected
 * before it gets here, so `bind` — which the registry tests hold to the entry's
 * own property list — cannot name something that is not in the schema.
 */
export function bindValues(
  entry: CatalogEntry,
  parameters: Readonly<Record<string, unknown>>,
): readonly unknown[] {
  return entry.bind.map((name) => parameters[name] ?? null)
}
