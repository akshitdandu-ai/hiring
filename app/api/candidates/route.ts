import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { handler } from '@/lib/api';
import { config, type Role } from '@/lib/config';
import { ready, type CandidateRow } from '@/lib/db';
import { fileToText, splitPersonalDetails } from '@/lib/extract';
import { scoreCandidate, pipelineStatus } from '@/lib/pipeline';
import { rankCandidates } from '@/lib/ranking';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/** Upload one CV: extract text, split off personal details, store, then score straight away. */
export const POST = handler(async (req: Request) => {
  const form = await req.formData();
  const file = form.get('file');
  const role = String(form.get('role') || '').toUpperCase() as Role;
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
  if (role !== 'PM' && role !== 'SPM') return NextResponse.json({ error: 'Select the role applied for (PM or SPM)' }, { status: 400 });
  if (file.size > 4 * 1024 * 1024) return NextResponse.json({ error: 'File is larger than 4 MB' }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  let text: string;
  try {
    text = await fileToText(file.name, buf);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 422 });
  }
  const { personal, redacted } = splitPersonalDetails(text);
  const hash = createHash('sha256').update(text).digest('hex');

  const db = await ready();
  const [existing] = await db<{ id: string }[]>`select id from candidates where content_hash = ${hash}`;
  if (existing) {
    return NextResponse.json({ error: 'This CV has already been uploaded', duplicate: true, id: existing.id }, { status: 409 });
  }
  const [row] = await db<CandidateRow[]>`
    insert into candidates (file_name, content_hash, applied_role, personal_details, cv_text, claimed_at, attempts)
    values (${file.name}, ${hash}, ${role}, ${db.json(personal)}, ${redacted}, now(), 1)
    on conflict (content_hash) do nothing
    returning *`;
  if (!row) return NextResponse.json({ error: 'This CV has already been uploaded', duplicate: true }, { status: 409 });

  // Score inline so the result is visible immediately. If it fails, the pipeline retries it.
  let scores: Record<Role, number> | null = null;
  let scoreError: string | null = null;
  try {
    scores = await scoreCandidate(row);
  } catch (e) {
    scoreError = (e as Error).message;
    await db`update candidates set last_error = ${scoreError}, claimed_at = null where id = ${row.id}`;
  }
  return NextResponse.json({
    id: row.id,
    name: personal.name ?? null,
    hasEmail: Boolean(personal.email),
    scores,
    scoreError,
  });
});

/** Everything the dashboard needs: candidates with scores, rank and the system's recommendation. */
export const GET = handler(async () => {
  const db = await ready();
  const rows = await db<CandidateRow[]>`
    select id, created_at, file_name, applied_role, personal_details, status, attempts, last_error, headline,
           pm_score, spm_score, decision_override, brief, draft_decision, email_subject, email_body, draft_edited,
           draft_error, email_status, sent_at, sent_to, send_error
    from candidates order by created_at`;
  const scores = await db`
    select s.candidate_id, s.criterion_id, s.role, s.score, s.reason, r.name, r.weight, r.position
    from scores s join rubric_criteria r on r.id = s.criterion_id order by r.role, r.position`;
  const ranks = rankCandidates(rows, config.topN, config.inviteThreshold);
  const byCandidate = new Map<string, unknown[]>();
  for (const s of scores) {
    const list = byCandidate.get(s.candidate_id) ?? [];
    list.push(s);
    byCandidate.set(s.candidate_id, list);
  }
  return NextResponse.json({
    config: { topN: config.topN, inviteThreshold: config.inviteThreshold, testRecipient: config.testRecipient || null, resendConfigured: Boolean(process.env.RESEND_API_KEY), aiConfigured: Boolean(process.env.GEMINI_API_KEY) },
    status: await pipelineStatus(),
    candidates: rows.map((r) => ({ ...r, ...ranks.get(r.id), scores: byCandidate.get(r.id) ?? [] })),
  });
});
