// The automated pipeline: score -> (rank) -> brief + draft email. Work is done one unit per call
// so every serverless invocation stays short; rows are claimed so parallel workers never collide.
import { config, ROLE_LABEL, type Decision, type Role } from './config';
import { getRubric, ready, type CandidateRow, type Criterion } from './db';
import { AIError, generateJSON } from './gemini';
import { rankCandidates, weightedScore } from './ranking';

/** Temporary AI problems (Google busy, quota used up) are not the CV's fault and don't use up a retry. */
const waitKind = (e: unknown) => (e instanceof AIError && e.kind !== 'fatal' ? e.kind : null);

const CLAIM_TIMEOUT = "interval '90 seconds'";
const MAX_ATTEMPTS = 3;

const SYSTEM = `You work for ${config.companyName}, a Series A logistics SaaS company in Mumbai that helps mid-sized freight forwarders automate shipment tracking, documentation and carrier coordination. You help the founder, ${config.founderName}, hire a Product Manager and a Senior Product Manager.
Personal details have been removed from every CV before you see it: the candidate is written as [CANDIDATE], and [EMAIL], [PHONE], [LINK] are placeholders. Never guess or invent a name, gender or any personal detail.`;

// ---------- Scoring ----------

type ScoreItem = { criterion_id: string; score: number; reason: string };
type ScoreResult = { headline: string; pm: ScoreItem[]; spm: ScoreItem[] };

function rubricBlock(criteria: Criterion[], role: Role) {
  return criteria
    .filter((c) => c.role === role)
    .map(
      (c) =>
        `- criterion_id: ${c.id}\n  Name: ${c.name} (weight ${c.weight}%)\n  5 = ${c.anchor_5}\n  3 = ${c.anchor_3}\n  1 = ${c.anchor_1}`,
    )
    .join('\n');
}

function scoreSchema(criteria: Criterion[]) {
  const items = (role: Role) => ({
    type: 'ARRAY',
    items: {
      type: 'OBJECT',
      properties: {
        criterion_id: { type: 'STRING', enum: criteria.filter((c) => c.role === role).map((c) => c.id) },
        score: { type: 'INTEGER', description: '1 to 5' },
        reason: { type: 'STRING', description: 'One line citing the specific CV evidence (or its absence).' },
      },
      required: ['criterion_id', 'score', 'reason'],
      propertyOrdering: ['criterion_id', 'score', 'reason'],
    },
  });
  return {
    type: 'OBJECT',
    properties: {
      headline: { type: 'STRING', description: 'One neutral line (max 20 words) on who this candidate is professionally. No names.' },
      pm: items('PM'),
      spm: items('SPM'),
    },
    required: ['headline', 'pm', 'spm'],
    propertyOrdering: ['headline', 'pm', 'spm'],
  };
}

export async function scoreCandidate(c: Pick<CandidateRow, 'id' | 'cv_text'>) {
  const db = await ready();
  const { criteria, guidance } = await getRubric();
  const prompt = `Score this CV against BOTH hiring rubrics below (Product Manager and Senior Product Manager), regardless of the role applied for.

SCORING RULES
${guidance.how_to_score}
Use integers 1-5. 5, 3 and 1 are the anchors; use 4 or 2 only when the evidence sits clearly between two anchors.
Every reason must be one line (max 25 words) and point to what is actually written in the CV - quote or paraphrase the specific evidence, or say plainly what is missing.

${guidance.do_not_reward || ''}

WHERE THE RUBRIC COMES FROM (background only - these are past hires, not the candidate)
${guidance.patterns || ''}

PRODUCT MANAGER (PM) RUBRIC
${rubricBlock(criteria, 'PM')}

SENIOR PRODUCT MANAGER (SPM) RUBRIC
${rubricBlock(criteria, 'SPM')}

Return one entry for every criterion_id in each rubric.

CV (personal details removed)
"""
${c.cv_text.slice(0, 30_000)}
"""`;

  const { data: result, model } = await generateJSON<ScoreResult>({ system: SYSTEM, prompt, schema: scoreSchema(criteria) });

  const rows: { criterion_id: string; role: Role; score: number; reason: string }[] = [];
  const totals: Record<Role, number> = { PM: 0, SPM: 0 };
  for (const role of ['PM', 'SPM'] as Role[]) {
    const roleCriteria = criteria.filter((x) => x.role === role);
    const got = (role === 'PM' ? result.pm : result.spm) || [];
    const items = roleCriteria.map((crit) => {
      const item = got.find((g) => g.criterion_id === crit.id);
      if (!item) throw new Error(`AI response missing score for ${crit.id}`);
      const score = Math.min(5, Math.max(1, Math.round(Number(item.score))));
      if (!Number.isFinite(score)) throw new Error(`AI returned a non-numeric score for ${crit.id}`);
      rows.push({ criterion_id: crit.id, role, score, reason: String(item.reason || '').trim() });
      return { score, weight: Number(crit.weight) };
    });
    totals[role] = weightedScore(items);
  }

  await db.begin(async (tx) => {
    await tx`delete from scores where candidate_id = ${c.id}`;
    for (const r of rows) {
      await tx`insert into scores (candidate_id, criterion_id, role, score, reason)
               values (${c.id}, ${r.criterion_id}, ${r.role}, ${r.score}, ${r.reason})`;
    }
    await tx`update candidates set status = 'scored', headline = ${String(result.headline || '').trim()},
               pm_score = ${totals.PM}, spm_score = ${totals.SPM}, scored_at = now(), last_error = null, ai_model = ${model},
               claimed_at = null, updated_at = now()
             where id = ${c.id}`;
  });
  return totals;
}

// ---------- Brief + email drafts ----------

type ScoreJoin = { criterion_id: string; name: string; weight: number; score: number; reason: string; role: Role };

async function scoresFor(id: string): Promise<ScoreJoin[]> {
  const db = await ready();
  return db<ScoreJoin[]>`select s.criterion_id, r.name, r.weight, s.score, s.reason, s.role
                         from scores s join rubric_criteria r on r.id = s.criterion_id
                         where s.candidate_id = ${id} order by r.role, r.position`;
}

export async function draftFor(c: CandidateRow, decision: Decision, needBrief: boolean) {
  const db = await ready();
  const role = c.applied_role;
  const other: Role = role === 'PM' ? 'SPM' : 'PM';
  const scores = await scoresFor(c.id);
  const scoreLines = scores
    .filter((s) => s.role === role)
    .map((s) => `- ${s.name} (weight ${s.weight}%): ${s.score}/5 - ${s.reason}`)
    .join('\n');
  const appliedScore = role === 'PM' ? c.pm_score : c.spm_score;
  const otherScore = role === 'PM' ? c.spm_score : c.pm_score;

  const emailRules =
    decision === 'invite'
      ? `Write an interview invitation email for the ${ROLE_LABEL[role]} role.
- Open with "Hi [NAME]," exactly - [NAME] is replaced with their real first name later.
- In one or two sentences, mention one or two specific things from their CV that made ${config.founderName.split(' ')[0]} want to talk (real details from the CV, not scores or rubric language).
- Invite them to a 45-minute conversation with ${config.founderName}, founder of ${config.companyName}, and ask them to reply with two or three times that work for them over the next week.
- Warm, direct, plain text, under 140 words. Sign off as "${config.founderName}\\nFounder, ${config.companyName}".`
      : `Write a warm, respectful rejection email for the ${ROLE_LABEL[role]} role.
- Open with "Hi [NAME]," exactly - [NAME] is replaced with their real first name later.
- Thank them and show their application was actually read by mentioning one genuine, specific strength from their CV.
- Say clearly and kindly that ${config.companyName} will not be moving forward for this role. Do not give scores, rubric language, or invented reasons; do not promise feedback or future roles.
- Plain text, under 120 words. Sign off as "${config.founderName}\\nFounder, ${config.companyName}".`;

  const briefRules = needBrief
    ? `Also write an interview brief for ${config.founderName.split(' ')[0]} (internal, never sent): EXACTLY three sentences.
Sentence 1: who this candidate is professionally, in concrete terms from the CV.
Sentence 2: why the system ranked them here - the strongest rubric evidence.
Sentence 3: what to probe in the interview - the weakest or least-evidenced criterion, as a specific question to test.
Refer to the candidate as "the candidate", never by name or pronoun guesses.`
    : 'Set "brief" to an empty string.';

  const prompt = `The candidate applied for ${ROLE_LABEL[role]}. Weighted score on the ${role} rubric: ${appliedScore}/100 (on the ${other} rubric: ${otherScore}/100).

Rubric scores for ${role}:
${scoreLines}

${emailRules}

${briefRules}

Format the email body as short paragraphs separated by blank lines (greeting, body paragraphs, sign-off on its own lines).
Never mention AI, automated screening, rubrics or scores in the email. Do not invent facts that are not in the CV.

CV (personal details removed)
"""
${c.cv_text.slice(0, 30_000)}
"""`;

  const { data: out } = await generateJSON<{ brief: string; subject: string; body: string }>({
    system: SYSTEM,
    prompt,
    temperature: 0.4,
    schema: {
      type: 'OBJECT',
      properties: {
        brief: { type: 'STRING' },
        subject: { type: 'STRING' },
        body: { type: 'STRING' },
      },
      required: ['brief', 'subject', 'body'],
      propertyOrdering: ['brief', 'subject', 'body'],
    },
  });

  const brief = needBrief ? String(out.brief || '').trim() : null;
  await db`update candidates set
             email_subject = ${String(out.subject || '').trim()},
             email_body = ${String(out.body || '').trim()},
             draft_decision = ${decision},
             brief = coalesce(${brief}, brief),
             draft_edited = false, drafted_at = now(), draft_error = null, draft_attempts = 0,
             claimed_at = null, updated_at = now()
           where id = ${c.id}`;
}

// ---------- The work loop ----------

export type PipelineStatus = { scoring: number; drafts: number; errors: number };

type DraftNeed = { row: CandidateRow; decision: Decision; needBrief: boolean; rank: number };

async function draftNeeds(): Promise<DraftNeed[]> {
  const db = await ready();
  const rows = await db<(CandidateRow & { draft_attempts: number; claimed_at: Date | null })[]>`
    select * from candidates where status = 'scored'`;
  const ranks = rankCandidates(rows, config.topN, config.inviteThreshold);
  const needs: DraftNeed[] = [];
  for (const row of rows) {
    const info = ranks.get(row.id)!;
    if (!info.decision || row.email_status === 'sent' || row.email_status === 'sending') continue;
    if (row.draft_attempts >= MAX_ATTEMPTS) continue;
    const missingBrief = info.decision === 'invite' && !row.brief;
    if (row.draft_decision !== info.decision || !row.email_body || missingBrief) {
      needs.push({ row, decision: info.decision, needBrief: info.decision === 'invite', rank: info.rank ?? 999 });
    }
  }
  // Invites first, then by rank.
  return needs.sort((a, b) => (a.decision === b.decision ? a.rank - b.rank : a.decision === 'invite' ? -1 : 1));
}

export async function pipelineStatus(): Promise<PipelineStatus> {
  const db = await ready();
  const [{ scoring, errors }] = await db`select
      count(*) filter (where status = 'new')::int as scoring,
      count(*) filter (where status = 'error')::int as errors
    from candidates`;
  const drafts = (await draftNeeds()).length;
  return { scoring, drafts, errors };
}

/** Does one unit of work (score one CV, or draft one email). Returns what it did. */
export async function pipelineStep(): Promise<{ did: string | null; error?: string; wait?: 'busy' | 'quota' }> {
  const db = await ready();

  const [job] = await db<CandidateRow[]>`
    update candidates set claimed_at = now(), attempts = attempts + 1
    where id = (
      select id from candidates
      where status = 'new' and (claimed_at is null or claimed_at < now() - ${db.unsafe(CLAIM_TIMEOUT)})
      order by created_at for update skip locked limit 1)
    returning *`;
  if (job) {
    try {
      await scoreCandidate(job);
      return { did: `scored ${job.id}` };
    } catch (e) {
      const msg = (e as Error).message;
      const wait = waitKind(e);
      if (wait) {
        await db`update candidates set attempts = attempts - 1, last_error = null, claimed_at = null where id = ${job.id}`;
        return { did: null, error: msg, wait };
      }
      const failed = job.attempts >= MAX_ATTEMPTS;
      await db`update candidates set last_error = ${msg}, claimed_at = null,
                 status = ${failed ? 'error' : 'new'}, updated_at = now() where id = ${job.id}`;
      return { did: `score failed ${job.id}`, error: msg };
    }
  }

  // Drafts depend on the ranking, so wait until every CV has been scored.
  const [{ pending }] = await db`select count(*)::int as pending from candidates where status = 'new'`;
  if (pending > 0) return { did: null };

  for (const need of await draftNeeds()) {
    const [claimed] = await db`
      update candidates set claimed_at = now(), draft_attempts = draft_attempts + 1
      where id = ${need.row.id} and (claimed_at is null or claimed_at < now() - ${db.unsafe(CLAIM_TIMEOUT)})
      returning id`;
    if (!claimed) continue;
    try {
      await draftFor(need.row, need.decision, need.needBrief);
      return { did: `drafted ${need.decision} ${need.row.id}` };
    } catch (e) {
      const msg = (e as Error).message;
      const wait = waitKind(e);
      if (wait) {
        await db`update candidates set draft_attempts = draft_attempts - 1, draft_error = null, claimed_at = null where id = ${need.row.id}`;
        return { did: null, error: msg, wait };
      }
      await db`update candidates set draft_error = ${msg}, claimed_at = null where id = ${need.row.id}`;
      return { did: `draft failed ${need.row.id}`, error: msg };
    }
  }
  return { did: null };
}
