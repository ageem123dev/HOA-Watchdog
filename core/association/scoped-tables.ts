/**
 * The tables that hold association data, in one place.
 *
 * Two tests need this list and they need the *same* list. `migrations/association.test.ts`
 * checks the live schema against it — every table here must carry a non-null
 * `association_id`, and every table that does not must be named in that file's
 * allowlist. `catalog/registry.test.ts` uses it to decide which tables a catalog
 * entry is obliged to scope to `$1`.
 *
 * Kept apart from both because a copy in each is two statements of one rule with
 * nothing failing on disagreement — the shape migration 007's comment warns
 * about, and the one story 5.1b's own review found here. A table added to the
 * schema but missed in the catalog's copy would be scoped by nothing while the
 * sweep reported success.
 *
 * **The database is the authority; this is the assertion.** Because the drift
 * guard holds the schema to this list, a scoped table added without being added
 * here turns that suite red — so the list cannot fall behind reality silently,
 * and the catalog sweep inherits a list that has been checked.
 *
 * Not a runtime value. Nothing in the product reads it; it exists so that two
 * tests cannot disagree about what needs scoping.
 */
/**
 * Typed `readonly string[]` rather than a literal tuple. The narrower type
 * gains nothing — both consumers ask "is this table name in the list?" — and it
 * costs: `includes(someString)` stops compiling against a tuple of literals.
 */
export const ASSOCIATION_SCOPED_TABLES: readonly string[] = [
  'board_member',
  'document',
  'extraction',
  'vendor',
  'quarantine_item',
  'unit',
  'unit_holder',
  'unit_membership',
  'assessment',
  'payment',
  'held_payment',
  'query_log',
  'finding',
  'finding_alert',
]
