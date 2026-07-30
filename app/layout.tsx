import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { applicationStylesheet } from '@/core/design/stylesheet'

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
          `href` + `precedence` let React 19 hoist this into <head>. Without them
          a <style> stays where it is written, which is an HTML conformance error
          inside <body> and puts the token definitions after anything Next injects
          into <head> — inverting the cascade order the token layer assumes.
        */}
        <style href="watchdog-tokens" precedence="default">
          {applicationStylesheet()}
        </style>
        {children}
      </body>
    </html>
  )
}
