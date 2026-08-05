/**
 * The port through which the rest of the system asks "do we know this vendor?"
 *
 * Two methods, deliberately, where one with a flag would be shorter. A single
 * call that returns "resolved, or else here are some candidates" is how a
 * suggestion becomes a resolution: some later caller reads the candidate list,
 * takes the top entry, and an automatic near-match is back — silently, because
 * nothing about that code looks wrong.
 *
 * `resolve` answers a yes-or-no question and is allowed to decide.
 * `suggest` ranks for a human and decides nothing.
 */

/**
 * A candidate for a human to choose between, never for code to choose from.
 *
 * `score` is included so the surface can show *why* an order was proposed. It
 * is not a threshold anybody is meant to compare against — `AUTO_RESOLVE_RULE`
 * in `core/vendor/name.ts` is the only rule that decides identity.
 */
export interface VendorSuggestion {
  readonly id: string
  readonly displayName: string
  /** Trigram similarity, 0 to 1. Ordering information, not a decision. */
  readonly score: number
}

/**
 * Resolved carries an id and nothing else.
 *
 * Not the name: "Vendors are referenced by id, never by extracted name"
 * (architecture, Consistency Conventions). Handing back a name invites a caller
 * to compare or store it, and the whole point of this table is that the name a
 * document carried is not the identity.
 */
export type VendorResolution =
  | { readonly outcome: 'resolved'; readonly vendorId: string }
  /**
   * We do not know this vendor.
   *
   * Not an error, and **not an instruction to create one**. AD-8 puts unknown
   * vendors in front of a human; story 1.6b is what does that. Nothing on this
   * path may write a vendor row.
   */
  | { readonly outcome: 'unresolved' }

export interface VendorDirectory {
  /** Normalised-exact, or nothing. Never a near match. */
  resolve(extractedName: string): Promise<VendorResolution>

  /**
   * Known vendors ranked by similarity to the name, most similar first.
   *
   * For the quarantine queue in stories 1.6c and 1.6d. A caller that treats the
   * first entry as an answer has reintroduced automatic near-matching.
   */
  suggest(extractedName: string, limit: number): Promise<readonly VendorSuggestion[]>
}
