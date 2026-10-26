/** Lower-case, strip diacritics and full stops, collapse whitespace. */
export function norm(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export interface FixedMatch {
  value: string;
  how: 'exact' | 'alias' | 'fuzzy';
}

/**
 * Match free text against a fixed list: exact (case-insensitive) → alias → fuzzy (edit distance ≤ 2,
 * only for words of 5+ letters and only when the best match is unique).
 */
export function matchFixed(raw: unknown, candidates: readonly string[], aliases: Record<string, string> = {}): FixedMatch | null {
  const q = norm(raw);
  if (!q) return null;
  for (const c of candidates) if (norm(c) === q) return { value: c, how: 'exact' };
  const a = aliases[q];
  if (a && candidates.includes(a)) return { value: a, how: 'alias' };
  if (q.length < 5) return null;
  const pool: Array<[string, string]> = [
    ...candidates.map((c): [string, string] => [norm(c), c]),
    ...Object.entries(aliases)
      .filter(([, v]) => candidates.includes(v))
      .map(([k, v]): [string, string] => [k, v]),
  ];
  let best = 3;
  const winners = new Set<string>();
  for (const [key, value] of pool) {
    if (key.length < 4) continue;
    const d = editDistance(q, key);
    if (d < best) {
      best = d;
      winners.clear();
      winners.add(value);
    } else if (d === best) winners.add(value);
  }
  if (best <= 2 && winners.size === 1) return { value: [...winners][0], how: 'fuzzy' };
  return null;
}

export function listOr(items: readonly string[]): string {
  return items.join(', ');
}
