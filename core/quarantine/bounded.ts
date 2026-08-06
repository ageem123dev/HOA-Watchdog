/**
 * Run `work` over `items` with at most `limit` in flight.
 *
 * `Promise.all` over the queue's distinct names opens one query per name at
 * once, against a pool that holds five. A queue is a human work list and is
 * usually short, but "usually" is not a bound, and the burst arrives on every
 * render. Raised in review.
 *
 * Results come back in input order regardless of which finished first, so a
 * caller can zip them against the list it passed in. A failure propagates rather
 * than being swallowed: a row that quietly lost its candidates renders exactly
 * like a name that resembles no vendor.
 */
export async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  // Set by whichever worker fails first. Without it the others keep taking work
  // after `Promise.all` has already rejected: the caller has its answer, the
  // queries keep going, and a second failure becomes an unhandled rejection with
  // nobody left to receive it. Raised in review — a defect in the helper written
  // to fix another one.
  let failed = false

  async function worker(): Promise<void> {
    while (next < items.length && !failed) {
      // Read and advance before the first await, so two workers cannot take the
      // same index.
      const index = next
      next += 1

      try {
        results[index] = await work(items[index] as T)
      } catch (error) {
        failed = true
        throw error
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker())

  // `all`, not `allSettled`: the first failure is the one to report, and a row
  // that quietly lost its candidates renders exactly like a name that resembles
  // no vendor.
  await Promise.all(workers)

  return results
}
