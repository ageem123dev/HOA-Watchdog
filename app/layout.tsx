import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Fiduciary Watchdog',
  description: 'Financial records for a condominium association board.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/*
          The focus ring lives here rather than on one surface, so every
          focusable element in the product carries it. DESIGN.md: 2px solid ink
          with a 2px offset on stone grounds; the inverse ring for ink grounds
          arrives with the masthead in Story 1.3, which also moves these literals
          into the token layer.
        */}
        <style>{`
          :focus-visible {
            outline: 2px solid #14213D;
            outline-offset: 2px;
          }
        `}</style>
        {children}
      </body>
    </html>
  )
}
