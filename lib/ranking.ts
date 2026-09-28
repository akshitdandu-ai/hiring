// Pure ranking / decision logic (no I/O) so it can be unit-tested.
import type { Decision, Role } from './config';

export type RankInput = {
  id: string;
  applied_role: Role;
  status: string;
  pm_score: number | null;
  spm_score: number | null;
  decision_override: Decision | null;
  created_at: string | Date;
};

export type RankInfo = {
  rank: number | null;
  recommended: Decision | null;
  decision: Decision | null;
};

export function appliedScore(c: Pick<RankInput, 'applied_role' | 'pm_score' | 'spm_score'>): number | null {
  return c.applied_role === 'PM' ? c.pm_score : c.spm_score;
}

/** Weighted score out of 100: sum(score / 5 x weight). */
export function weightedScore(items: { score: number; weight: number }[]): number {
  const total = items.reduce((a, i) => a + (i.score / 5) * i.weight, 0);
  return Math.round(total * 10) / 10;
}

/**
 * Rank scored candidates within the role they applied for. The system recommends an interview
 * for the top N who also clear the score threshold; the founder's override always wins.
 */
export function rankCandidates(rows: RankInput[], topN: number, threshold: number): Map<string, RankInfo> {
  const out = new Map<string, RankInfo>();
  for (const role of ['PM', 'SPM'] as Role[]) {
    const scored = rows
      .filter((r) => r.applied_role === role && r.status === 'scored' && appliedScore(r) !== null)
      .sort(
        (a, b) =>
          (appliedScore(b) as number) - (appliedScore(a) as number) ||
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
    scored.forEach((r, i) => {
      const rank = i + 1;
      const recommended: Decision = rank <= topN && (appliedScore(r) as number) >= threshold ? 'invite' : 'reject';
      out.set(r.id, { rank, recommended, decision: r.decision_override ?? recommended });
    });
  }
  for (const r of rows) if (!out.has(r.id)) out.set(r.id, { rank: null, recommended: null, decision: r.decision_override });
  return out;
}

/** Put the candidate's real name back into AI-written text (the AI only ever sees placeholders). */
export function personalise(text: string, name?: string): string {
  const first = (name || '').trim().split(/\s+/)[0] || 'there';
  return text.replace(/\[(?:NAME|FIRST[_ ]NAME|CANDIDATE(?:[_ ]NAME)?)\]/gi, first);
}
