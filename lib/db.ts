import postgres from 'postgres';
import { SCHEMA_SQL } from './schema.mjs';
import rubricData from './rubric.generated.json';
import type { Role } from './config';

export type Criterion = {
  id: string;
  role: Role;
  position: number;
  name: string;
  weight: number;
  anchor_5: string;
  anchor_3: string;
  anchor_1: string;
  source: string;
};

export type PersonalDetails = {
  name?: string;
  email?: string;
  phone?: string;
  links?: string[];
};

export type CandidateRow = {
  id: string;
  created_at: string;
  file_name: string | null;
  applied_role: Role;
  personal_details: PersonalDetails;
  cv_text: string;
  status: 'new' | 'scored' | 'error';
  attempts: number;
  last_error: string | null;
  headline: string | null;
  pm_score: number | null;
  spm_score: number | null;
  decision_override: 'invite' | 'reject' | null;
  brief: string | null;
  draft_decision: 'invite' | 'reject' | null;
  email_subject: string | null;
  email_body: string | null;
  draft_edited: boolean;
  draft_error: string | null;
  email_status: 'none' | 'sending' | 'sent' | 'failed';
  sent_at: string | null;
  sent_to: string | null;
  send_error: string | null;
};

const globalForDb = globalThis as unknown as { __sql?: postgres.Sql; __ready?: Promise<void> };

export function sql(): postgres.Sql {
  if (!globalForDb.__sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    globalForDb.__sql = postgres(url, {
      // Required for Supabase's transaction pooler (port 6543) and harmless elsewhere.
      prepare: false,
      max: 3,
      idle_timeout: 20,
      ssl: local || /sslmode=disable/.test(url) ? false : 'require',
      types: { numeric: { to: 1700, from: [1700], serialize: String, parse: Number } },
      onnotice: () => {},
    });
  }
  return globalForDb.__sql;
}

async function setup() {
  const db = sql();
  await db.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(424242)`;
    await tx.unsafe(SCHEMA_SQL);
    const [{ n }] = await tx`select count(*)::int as n from rubric_criteria`;
    if (n === 0) {
      for (const c of rubricData.criteria) {
        await tx`insert into rubric_criteria ${tx(c, 'id', 'role', 'position', 'name', 'weight', 'anchor_5', 'anchor_3', 'anchor_1', 'source')}
                 on conflict (id) do nothing`;
      }
    }
    for (const [key, content] of Object.entries(rubricData.guidance)) {
      await tx`insert into rubric_guidance (key, content) values (${key}, ${content})
               on conflict (key) do nothing`;
    }
  });
}

/** Creates tables and seeds the rubric on first use. Safe to call on every request. */
export async function ready(): Promise<postgres.Sql> {
  if (!globalForDb.__ready) {
    globalForDb.__ready = setup().catch((e) => {
      globalForDb.__ready = undefined;
      throw e;
    });
  }
  await globalForDb.__ready;
  return sql();
}

export async function getRubric(): Promise<{ criteria: Criterion[]; guidance: Record<string, string> }> {
  const db = await ready();
  const criteria = await db<Criterion[]>`select * from rubric_criteria order by role, position`;
  const g = await db<{ key: string; content: string }[]>`select key, content from rubric_guidance`;
  return { criteria, guidance: Object.fromEntries(g.map((r) => [r.key, r.content])) };
}
