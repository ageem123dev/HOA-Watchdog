/**
 * The port through which a human's answer is recorded.
 *
 * `core/ports/quarantine-queue.ts` says this port does not exist yet, and gives
 * the reason: reading the queue and acting on it are different capabilities, and
 * a port that could do both would let a caller act on what it found there. This
 * is the acting half, and story 1.6d is where it arrives.
 *
 * Two operations rather than one with an optional vendor id. An optional id is
 * exactly how "here are some candidates" becomes "resolved to the first one" —
 * `VendorDirectory`'s header describes that failure, and preventing it is what
 * the whole of epic story 1.6 is for. `confirmAsNew` creates an identity;
 * `matchToExisting` states that one already covers this name. Neither can be
 * mistaken for the other at a call site.
 */

/** A vendor identity now exists that did not before. */
export interface VendorCreated {
  readonly outcome: 'created'
  readonly vendorId: string
}

/** An existing identity now covers this name. Nothing was created. */
export interface VendorMatched {
  readonly outcome: 'matched'
  readonly vendorId: string
}

/**
 * Somebody answered first — another tab, another board member.
 *
 * A returned value rather than a thrown error, because it is an ordinary race
 * and not a fault. As an exception, every caller would have to catch it to
 * render an expected outcome, and the caller that forgets shows a treasurer a
 * crash for something that worked.
 */
export interface AlreadyResolved {
  readonly outcome: 'already-resolved'
}

export interface VendorResolution {
  /**
   * Record that this name is a vendor nobody had yet.
   *
   * May return `matched`: two people confirming the same new name is a race the
   * unique index settles, and the one who loses it should end up pointing at the
   * winner's row rather than seeing a constraint violation. Both answered the
   * same question the same way.
   */
  confirmAsNew(
    documentId: string,
    extractedName: string,
  ): Promise<VendorCreated | VendorMatched | AlreadyResolved>

  /**
   * Record that an existing vendor is who this document meant.
   *
   * Cannot return `created`, and the type says so rather than a comment saying
   * so. AC2 requires that no vendor is created on this path, and a method that
   * *could* report one would eventually do it — a "create if missing" fallback
   * is the natural-looking change that makes the guarantee untrue while the
   * method name still claims it.
   */
  matchToExisting(
    documentId: string,
    extractedName: string,
    vendorId: string,
  ): Promise<VendorMatched | AlreadyResolved>
}
