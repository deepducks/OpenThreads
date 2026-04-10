import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'OpenThreads',
  description: 'Unified communication channel abstraction with human-in-the-loop support',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
