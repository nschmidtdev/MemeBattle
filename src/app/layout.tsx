import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Meme Battle',
  description: 'Self-hosted multiplayer meme party game — caption templates, vote on each other, win points.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
