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
 * The values for `$1 … $n`: the association first, then the entry's declared
 * order.
 *
 * **`$1` is always the association and is never an entry parameter.** It is
 * prepended here rather than at the call site because this function is the one
 * place the ordering contract is applied, and an offset applied somewhere else
 * is an offset that can disagree with the one applied here. `registry.test.ts`
 * holds every entry to `bind.length === highest placeholder - 1` and refuses a
 * parameter named `associationId`, so an entry cannot quietly reclaim `$1` and
 * let a caller choose whose records it reads.
 *
 * The association is supplied by the executor from the provenance write, not by
 * the caller — see `core/ports/query-log.ts`.
 *
 * **An absent optional parameter binds as `null`, never as `undefined`** — as
 * this function's own contract, not as a workaround for the driver. An earlier
 * version of this comment claimed `pg` throws on `undefined`; it does not.
 * Checked against pg 8.22.0 rather than argued: both `null` and `undefined`
 * serialize to SQL NULL. Raised on the merge request, and the correction is
 * recorded here because a comment stating a false reason is worse than no
 * comment — the next reader would "simplify" against a fact that was never true.
 *
 * The coalesce stays because the contract should not be the driver's to define.
 * A pure function that returns `undefined` in a values array is describing an
 * absence it has no way to express downstream, and any caller that is not `pg` —
 * a fake in a test, a future driver, a logger — would have to rediscover what it
 * meant. No entry declares an optional bound parameter yet, so this is settled
 * before the first one arrives rather than after.
 *
 * `??` and not `||`, so a legitimately empty string or a zero is bound as
 * itself. A unit number of `'0'` is a unit number.
 *
 * **Own properties only**, matching `validateParameters` exactly. That symmetry
 * is load-bearing rather than tidy. `validateParameters` skips the type check for
 * a declared parameter that is absent, and absence there means *own* absence —
 * so a caller whose object *inherits* an optional parameter passes validation
 * without that value ever being checked. A plain read here would then bind it
 * into the query anyway. `Object.hasOwn` on both sides closes a hole that only
 * exists when the two disagree, which is why the guard is here and not left to
 * the validator alone.
 *
 * The parameters are otherwise assumed to have passed `validateParameters`: this
 * orders values, it does not police them. Anything undeclared has been rejected
 * before it gets here, so `bind` — which the registry tests hold to the entry's
 * own property list — cannot name something that is not in the schema.
 */
export function bindValues(
  entry: CatalogEntry,
  parameters: Readonly<Record<string, unknown>>,
  associationId: string,
): readonly unknown[] {
  return [
    associationId,
    ...entry.bind.map((name) =>
      Object.hasOwn(parameters, name) ? (parameters[name] ?? null) : null,
    ),
  ]
}
