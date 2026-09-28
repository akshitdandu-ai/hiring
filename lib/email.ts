import { createHash } from 'node:crypto';
import { config } from './config';
import { ready, type CandidateRow } from './db';
import { personalise } from './ranking';

export class SendError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Sends the candidate's current draft via Resend and marks the record as sent. */
export async function sendCandidateEmail(id: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new SendError('RESEND_API_KEY is not set. Add it in your hosting environment variables and redeploy.', 500);
  const db = await ready();

  // Claim the send atomically so a double click can never send twice.
  const [c] = await db<CandidateRow[]>`
    update candidates set email_status = 'sending', send_error = null, updated_at = now()
    where id = ${id} and email_status in ('none', 'failed') and email_body is not null
    returning *`;
  if (!c) {
    const [cur] = await db<CandidateRow[]>`select email_status, email_body from candidates where id = ${id}`;
    if (!cur) throw new SendError('Candidate not found', 404);
    if (cur.email_status === 'sent') throw new SendError('This email has already been sent.', 409);
    if (cur.email_status === 'sending') throw new SendError('This email is already being sent.', 409);
    throw new SendError('There is no draft email for this candidate yet.');
  }

  const fail = async (msg: string, status = 400): Promise<never> => {
    await db`update candidates set email_status = 'failed', send_error = ${msg} where id = ${id}`;
    throw new SendError(msg, status);
  };

  const name = c.personal_details?.name;
  const candidateEmail = (c.personal_details?.email || '').trim();
  const to = config.testRecipient || candidateEmail;
  if (!to) return fail('No email address was found on this CV. Add one in the candidate details first.');
  const domain = to.split('@')[1]?.toLowerCase() || '';
  if (config.allowedDomains.length && !config.allowedDomains.some((d) => domain === d || domain.endsWith('.' + d))) {
    return fail(`Refusing to send to ${to}: domain is not in EMAIL_ALLOWED_DOMAINS.`);
  }

  const subject = personalise(c.email_subject || '', name);
  const text = personalise(c.email_body || '', name);
  const res = await fetch(`${config.resendApiBase}/emails`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      'idempotency-key': `candidate-${c.id}-${createHash('sha256').update(to + subject + text).digest('hex').slice(0, 16)}`,
    },
    body: JSON.stringify({
      from: config.emailFrom,
      to: [to],
      subject,
      text,
      ...(config.emailReplyTo ? { reply_to: config.emailReplyTo } : {}),
    }),
  }).catch((e: Error) => fail(`Could not reach Resend: ${e.message}`, 502));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return fail(`Resend ${res.status}: ${data?.message || data?.error || 'send failed'}`, 502);

  const [updated] = await db<CandidateRow[]>`
    update candidates set email_status = 'sent', sent_at = now(), sent_to = ${to},
      resend_id = ${data?.id ?? null}, send_error = null, updated_at = now()
    where id = ${id} returning *`;
  return updated;
}
