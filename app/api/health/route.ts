import { NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { ready } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Public health check (no candidate data): is the database reachable and the rubric loaded? */
export async function GET() {
  const out: Record<string, unknown> = {
    ai: Boolean(process.env.GEMINI_API_KEY),
    aiModels: config.geminiModels,
    email: Boolean(process.env.RESEND_API_KEY),
  };
  try {
    const db = await ready();
    const rows = await db`select role, count(*)::int as n from rubric_criteria group by role order by role`;
    const [{ n }] = await db`select count(*)::int as n from candidates`;
    out.database = 'ok';
    out.rubricCriteria = Object.fromEntries(rows.map((r) => [r.role, r.n]));
    out.candidates = n;
  } catch (e) {
    out.database = `error: ${(e as Error).message}`;
  }
  return NextResponse.json(out, { status: out.database === 'ok' ? 200 : 503 });
}
