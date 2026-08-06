import { describe, expect, it } from 'vitest'

import { mapWithLimit } from './bounded'

describe('running work with a concurrency limit', () => {
  it('returns results in the order it was given, not the order they finished', async () => {
    const delays = [30, 5, 15]

    const results = await mapWithLimit(delays, 2, async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms))
      return ms
    })

    expect(results).toEqual([30, 5, 15])
  })

  it('never runs more than the limit at once', async () => {
    // The property the whole helper exists for. `Promise.all` over a queue of
    // thirty names opens thirty connections against a pool of five.
    let running = 0
    let peak = 0

    await mapWithLimit([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running -= 1
      return n
    })

    expect(peak).toBe(3)
  })

  it('runs everything even when there are fewer items than the limit', async () => {
    const results = await mapWithLimit([1, 2], 5, async (n) => n * 2)

    expect(results).toEqual([2, 4])
  })

  it('does nothing for an empty list', async () => {
    expect(await mapWithLimit([], 3, async () => 1)).toEqual([])
  })

  it('propagates a failure rather than returning a short list', async () => {
    // Swallowing here would render a queue whose rows quietly lost their
    // candidates, which reads as "no similar vendors".
    await expect(
      mapWithLimit([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('lookup failed')
        return n
      }),
    ).rejects.toThrow('lookup failed')
  })
})

describe('when one item fails', () => {
  it('stops taking new work', async () => {
    // Raised in review, and a defect in the helper written to fix another one.
    // `Promise.all` rejects as soon as one worker throws, but the others keep
    // looping — so the remaining items still run, and any that also fail become
    // unhandled rejections after the caller has already been told.
    const started: number[] = []

    await expect(
      mapWithLimit([1, 2, 3, 4, 5, 6, 7, 8], 2, async (n) => {
        started.push(n)
        await new Promise((resolve) => setTimeout(resolve, 1))
        if (n === 1) throw new Error('first failed')
        return n
      }),
    ).rejects.toThrow('first failed')

    await new Promise((resolve) => setTimeout(resolve, 20))

    // The two in flight when it failed are unavoidable; nothing after them is.
    expect(started.length).toBeLessThanOrEqual(2)
  })

  it('reports the first failure, not a later one', async () => {
    await expect(
      mapWithLimit([1, 2], 2, async (n) => {
        await new Promise((resolve) => setTimeout(resolve, n * 5))
        throw new Error(`failure ${n}`)
      }),
    ).rejects.toThrow('failure 1')
  })
})
