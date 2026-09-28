import { NextResponse } from 'next/server';
import { missingEnv } from './config';

/** Wraps a route handler: consistent JSON errors and a clear message when setup is incomplete. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    const missing = missingEnv().filter((m) => m === 'DATABASE_URL');
    if (missing.length) {
      return NextResponse.json({ error: `Server is missing environment variables: ${missing.join(', ')}` }, { status: 500 });
    }
    try {
      return await fn(...args);
    } catch (e) {
      const err = e as Error & { status?: number };
      console.error(err);
      return NextResponse.json({ error: err.message || 'Unexpected error' }, { status: err.status && err.status >= 400 ? err.status : 500 });
    }
  };
}

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
