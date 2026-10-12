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
      const err = e as Error & { status?: number; code?: string };
      console.error(err);
      // Database unreachable (e.g. Supabase free project paused after a week of inactivity).
      if (/tenant\/user .* not found|Tenant or user not found|ENOTFOUND|ECONNREFUSED|CONNECT_TIMEOUT|ETIMEDOUT/i.test(`${err.code ?? ''} ${err.message}`)) {
        return NextResponse.json(
          { error: 'Cannot reach the database. If the Supabase project was paused for inactivity, restore it in the Supabase dashboard, then try again.' },
          { status: 503 },
        );
      }
      return NextResponse.json({ error: err.message || 'Unexpected error' }, { status: err.status && err.status >= 400 ? err.status : 500 });
    }
  };
}

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
