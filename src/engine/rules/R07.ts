import { EPS, num } from '../../util/format';
import type { Rule } from './types';
import { NO_ITEMS } from './types';

export const R07: Rule = ({ booking, totals }) => {
  if (!booking.items.length) return { findings: [], couldNotCheck: NO_ITEMS };
  if (booking.grossWeightKg === null || !Number.isFinite(booking.grossWeightKg)) return { findings: [], couldNotCheck: 'gross weight is missing' };
  if (totals.netWeightKg === null) return { findings: [], couldNotCheck: 'an item is missing its unit weight or quantity' };
  if (booking.grossWeightKg >= totals.netWeightKg - EPS) return { findings: [] };
  const short = totals.netWeightKg - booking.grossWeightKg;
  return {
    findings: [
      {
        ruleId: 'R-07',
        severity: 'Amber',
        scope: 'booking',
        problem: 'Gross weight is lighter than the goods alone',
        evidence: `Gross weight ${num(booking.grossWeightKg)} kg; product weight (unit weight × quantity) is ${num(totals.netWeightKg)} kg; shortfall ${num(short)} kg.`,
        fix: 'Re-weigh; gross weight must include product, cartons and pallets.',
      },
    ],
  };
};
