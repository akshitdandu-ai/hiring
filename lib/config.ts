export type Role = 'PM' | 'SPM';
export type Decision = 'invite' | 'reject';

export const ROLES: Role[] = ['PM', 'SPM'];
export const ROLE_LABEL: Record<Role, string> = {
  PM: 'Product Manager',
  SPM: 'Senior Product Manager',
};

function num(name: string, fallback: number) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== '' && process.env[name] !== undefined ? v : fallback;
}

export const config = {
  /** How many candidates per role can be above the interview line. */
  topN: num('TOP_N_PER_ROLE', 5),
  /** Minimum weighted score (out of 100) to be recommended for interview, even if in the top N. */
  inviteThreshold: num('INVITE_THRESHOLD', 60),
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  geminiApiBase: process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com',
  resendApiBase: process.env.RESEND_API_BASE || 'https://api.resend.com',
  emailFrom: process.env.EMAIL_FROM || 'Kargo Hiring <onboarding@resend.dev>',
  emailReplyTo: process.env.EMAIL_REPLY_TO || '',
  founderName: process.env.FOUNDER_NAME || 'Arjun Mehta',
  companyName: process.env.COMPANY_NAME || 'Kargo',
  /** Optional comma-separated domains; if set, emails to any other domain are refused. */
  allowedDomains: (process.env.EMAIL_ALLOWED_DOMAINS || '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean),
  /** Optional: send every email here instead of the candidate's address (for testing). */
  testRecipient: process.env.EMAIL_TEST_RECIPIENT || '',
};

export function missingEnv(): string[] {
  const missing: string[] = [];
  if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
  if (!process.env.GEMINI_API_KEY) missing.push('GEMINI_API_KEY');
  return missing;
}
