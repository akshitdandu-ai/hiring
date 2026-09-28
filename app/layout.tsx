import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = { title: 'Kargo Hiring', description: 'CV scoring and candidate outreach for Kargo' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <strong>Kargo Hiring</strong>
          <nav>
            <Link href="/">Upload</Link>
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/rubric">Rubric</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
