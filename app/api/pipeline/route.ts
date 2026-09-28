import { NextResponse } from 'next/server';
import { handler } from '@/lib/api';
import { pipelineStatus, pipelineStep } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/** Runs one unit of pipeline work (score a CV or draft an email) and reports what is left. */
export const POST = handler(async () => {
  const step = await pipelineStep();
  return NextResponse.json({ ...step, status: await pipelineStatus() });
});

export const GET = handler(async () => NextResponse.json({ status: await pipelineStatus() }));
