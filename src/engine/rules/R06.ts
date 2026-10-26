import { BATTERY_INFO_CONTEXT, BATTERY_PATTERN, BATTERY_RED_CONTEXT, DG_TERMS, NEGATION_PHRASES } from '../../config/dangerousGoods';
import type { Finding } from '../../model/types';
import type { Rule } from './types';
import { NO_ITEMS } from './types';

const FIX = 'Remove this item, or ship it via a dangerous-goods service (not offered here).';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function hasWord(text: string, word: string): boolean {
  return new RegExp(`(?<![a-z0-9])${escapeRe(word)}(?![a-z0-9])`, 'i').test(text);
}

/** A match is cancelled by "no / non / without" just before it, or "free / not included" just after it. */
function negatedAt(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - 14), start);
  const after = text.slice(end, end + 20);
  return /(?:^|[^a-z])(?:no|non|without|free of)[\s-]*$/i.test(before) || /^[\s-]*(?:free\b|not included|not required)/i.test(after);
}

export interface DgHit {
  label: string;
  kind: string;
  severity: 'Red' | 'Info';
}

/** Scan free text for dangerous goods. Exposed for tests. */
export function scanDangerous(input: string): DgHit[] {
  let text = ` ${input.toLowerCase()} `;
  for (const p of NEGATION_PHRASES) text = text.split(p).join(' '.repeat(p.length));
  const hits: DgHit[] = [];
  const seen = new Set<string>();
  const add = (h: DgHit) => {
    if (!seen.has(h.label)) {
      seen.add(h.label);
      hits.push(h);
    }
  };
  for (const t of DG_TERMS) {
    const re = new RegExp(`(?<![a-z0-9])(?:${t.pattern})(?![a-z0-9])`, 'gi');
    for (const m of text.matchAll(re)) {
      if (!negatedAt(text, m.index!, m.index! + m[0].length)) {
        add({ label: t.label, kind: t.kind, severity: 'Red' });
        break;
      }
    }
  }
  const reBat = new RegExp(`(?<![a-z0-9])${BATTERY_PATTERN}(?![a-z0-9])`, 'gi');
  for (const m of text.matchAll(reBat)) {
    if (negatedAt(text, m.index!, m.index! + m[0].length)) continue;
    const lithiumAlready = hits.some((h) => h.kind === 'lithium battery');
    if (lithiumAlready) break;
    const redCtx = BATTERY_RED_CONTEXT.some((w) => hasWord(text, w));
    const infoCtx = BATTERY_INFO_CONTEXT.some((w) => hasWord(text, w));
    if (infoCtx && !hasWord(text, 'rechargeable')) add({ label: m[0].trim(), kind: 'battery (type unclear)', severity: 'Info' });
    else if (redCtx) add({ label: m[0].trim(), kind: 'lithium battery', severity: 'Red' });
    else add({ label: m[0].trim(), kind: 'battery (type unclear)', severity: 'Info' });
    break;
  }
  return hits;
}

export const R06: Rule = ({ booking }) => {
  if (!booking.items.length) return { findings: [], couldNotCheck: NO_ITEMS };
  const findings: Finding[] = [];
  for (const i of booking.items) {
    const hits = scanDangerous(`${i.description} ${i.sku}`);
    const red = hits.filter((h) => h.severity === 'Red');
    if (red.length) {
      findings.push({
        ruleId: 'R-06',
        severity: 'Red',
        scope: i.sku,
        problem: `Item ${i.sku} looks like a restricted item (${[...new Set(red.map((h) => h.kind))].join(' / ')})`,
        evidence: `Matched ${red.map((h) => `"${h.label}"`).join(', ')} in "${i.description}"${i.sku ? ` / SKU ${i.sku}` : ''}.`,
        fix: FIX,
      });
    }
    const info = hits.find((h) => h.severity === 'Info');
    if (info && !red.length) {
      findings.push({
        ruleId: 'R-06',
        severity: 'Info',
        scope: i.sku,
        problem: `Item ${i.sku} mentions batteries`,
        evidence: `Matched "${info.label}" in "${i.description}". Plain alkaline batteries are normally fine; lithium ones are not.`,
        fix: 'Confirm the battery type. If it is lithium, remove the item.',
      });
    }
  }
  return { findings };
};
