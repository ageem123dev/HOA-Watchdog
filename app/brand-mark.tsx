import Image from 'next/image'

/**
 * The product's wordmark, as one component rather than a path repeated per page.
 *
 * The file is a transparent PNG so it sits on `--color-stone` without a plate
 * of its own; the source artwork was a black drawing on an off-white rectangle,
 * which reads as a white box on every surface this application has.
 */
const LOGO = '/hoa-watchdog-logo.png'

/** The asset's own pixels. Width below is a render size; this fixes the ratio. */
const INTRINSIC = { width: 649, height: 206 } as const

/**
 * `alt` carries the product name because the mark replaces the text eyebrow
 * that used to say it. An empty `alt` here would delete the name from the
 * accessibility tree of the sign-in page, where nothing else states it.
 */
export function BrandMark({ width }: { width: number }) {
  return (
    <Image
      src={LOGO}
      alt="HOA Watchdog"
      width={width}
      height={Math.round((width * INTRINSIC.height) / INTRINSIC.width)}
      // The two surfaces that use this are the first paint of a session, and the
      // mark is above the fold on both. Deferring it is a flash of nothing.
      priority
      style={{ height: 'auto' }}
    />
  )
}
