import { EPS, gbp, num, round2 } from '../../util/format';
import type { Rule } from './types';
import { NO_ITEMS } from './types';

export const R02: Rule = ({ booking, totals }) => {
  if (!booking.items.length) return { findings: [], couldNotCheck: NO_ITEMS };
  if (booking.declaredValue === null || !Number.isFinite(booking.declaredValue)) return { findings: [], couldNotCheck: 'the declared value is missing' };
  if (totals.valueSum === null) return { findings: [], couldNotCheck: 'an item is missing its quantity or unit price' };
  const declared = round2(booking.declaredValue);
  const sum = totals.valueSum;
  const diff = round2(declared - sum);
  const absDiff = Math.abs(declared - sum);
  const fail = sum === 0 ? declared > 0 : absDiff - sum * 0.01 > EPS;
  if (!fail) return { findings: [] };
  const pct = sum === 0 ? null : (absDiff / sum) * 100;
  return {
    findings: [
      {
        ruleId: 'R-02',
        severity: 'Red',
        scope: 'booking',
        problem: 'Declared value does not match the items',
        evidence: `Declared ${gbp(declared)}; items add up to ${gbp(sum)}; difference ${diff >= 0 ? '+' : '−'}${gbp(Math.abs(diff))}${pct === null ? '' : ` (${num(pct, 2)}%)`}. Allowed: within 1%.`,
        fix: `Change declared value to ${gbp(sum)}, or correct the unit price/quantity of the item(s) that are wrong.`,
      },
    ],
  };
};
