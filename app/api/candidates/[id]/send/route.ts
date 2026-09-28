import { NextResponse } from 'next/server';
import { handler, isUuid } from '@/lib/api';
import { sendCandidateEmail } from '@/lib/email';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

export const POST = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const c = await sendCandidateEmail(id);
  return NextResponse.json({ ok: true, sent_to: c.sent_to, sent_at: c.sent_at });
});
