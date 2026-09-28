'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Nav() {
  const path = usePathname();
  return (
    <nav>
      <Link href="/" className={path === '/' ? 'on' : ''}>Upload CVs</Link>
      <Link href="/dashboard" className={path.startsWith('/dashboard') ? 'on' : ''}>Dashboard</Link>
    </nav>
  );
}
