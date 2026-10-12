import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'The Dispatch',
  description: 'Weekly newsletter on the Indian startup ecosystem',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-50 font-sans">
        {children}
      </body>
    </html>
  )
}
