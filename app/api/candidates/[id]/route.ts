import { NextResponse } from 'next/server';
import { handler, isUuid } from '@/lib/api';
import { ready } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** Founder actions on one candidate. The system recommends; these let Arjun decide. */
export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return bad('Invalid id');
  const body = await req.json().catch(() => ({}));
  const db = await ready();
  const [c] = await db`select email_status from candidates where id = ${id}`;
  if (!c) return bad('Candidate not found', 404);
  const locked = c.email_status === 'sent' || c.email_status === 'sending';

  switch (body.action) {
    case 'override': {
      if (locked) return bad('Email already sent - the decision can no longer change.', 409);
      const d = body.decision === 'invite' || body.decision === 'reject' ? body.decision : null;
      await db`update candidates set decision_override = ${d}, draft_attempts = 0, updated_at = now() where id = ${id}`;
      break;
    }
    case 'edit_email': {
      if (locked) return bad('Email already sent.', 409);
      const subject = String(body.subject ?? '').trim();
      const text = String(body.body ?? '').trim();
      if (!subject || !text) return bad('Subject and body are required');
      await db`update candidates set email_subject = ${subject}, email_body = ${text}, draft_edited = true,
                 email_status = 'none', send_error = null, updated_at = now() where id = ${id}`;
      break;
    }
    case 'edit_details': {
      const details = {
        name: String(body.name ?? '').trim() || undefined,
        email: String(body.email ?? '').trim() || undefined,
        phone: String(body.phone ?? '').trim() || undefined,
      };
      if (details.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email)) return bad('That email address looks invalid');
      await db`update candidates set personal_details = personal_details || ${db.json(details)}, updated_at = now() where id = ${id}`;
      break;
    }
    case 'set_role': {
      if (locked) return bad('Email already sent.', 409);
      if (body.role !== 'PM' && body.role !== 'SPM') return bad('Role must be PM or SPM');
      // Different role -> different ranking and email; clear the old draft so it is rewritten.
      await db`update candidates set applied_role = ${body.role}, decision_override = null, brief = null,
                 email_body = null, draft_decision = null, draft_attempts = 0, updated_at = now() where id = ${id}`;
      break;
    }
    case 'regenerate': {
      if (locked) return bad('Email already sent.', 409);
      await db`update candidates set email_body = null, draft_decision = null, brief = null, draft_edited = false,
                 draft_attempts = 0, draft_error = null, email_status = 'none', updated_at = now() where id = ${id}`;
      break;
    }
    case 'rescore': {
      if (locked) return bad('Email already sent.', 409);
      await db`update candidates set status = 'new', attempts = 0, last_error = null, claimed_at = null, brief = null,
                 email_body = null, draft_decision = null, draft_attempts = 0, updated_at = now() where id = ${id}`;
      break;
    }
    default:
      return bad('Unknown action');
  }
  return NextResponse.json({ ok: true });
});

export const DELETE = handler(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return bad('Invalid id');
  const db = await ready();
  await db`delete from candidates where id = ${id}`;
  return NextResponse.json({ ok: true });
});
