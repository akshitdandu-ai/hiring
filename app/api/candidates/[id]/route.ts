import { NextResponse } from 'next/server';
import { handler, isUuid } from '@/lib/api';
import { ready } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Retry a CV whose scoring failed: puts it back in the pipeline queue. */
export const POST = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const db = await ready();
  await db`update candidates set status = 'new', attempts = 0, last_error = null, claimed_at = null, updated_at = now()
           where id = ${id} and status = 'error'`;
  return NextResponse.json({ ok: true });
});
