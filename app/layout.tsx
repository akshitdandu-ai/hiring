import type { Metadata } from 'next';
import GooeyGradientBackground from './GooeyGradientBackground';
import Nav from './Nav';
import './globals.css';

export const metadata: Metadata = { title: 'Kargo Hiring', description: 'CV scoring and candidate outreach for Kargo' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <GooeyGradientBackground className="app-bg" />
        <header className="top">
          <div className="top-inner">
            <div className="brand"><span className="logo">K</span> Kargo Hiring</div>
            <Nav />
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
