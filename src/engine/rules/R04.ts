import { num } from '../../util/format';
import type { Rule } from './types';
import { NO_ITEMS } from './types';

export const R04: Rule = ({ booking, totals }) => {
  if (!booking.items.length) return { findings: [], couldNotCheck: NO_ITEMS };
  if (booking.cartons === null || !Number.isFinite(booking.cartons)) return { findings: [], couldNotCheck: 'the booking carton count is missing' };
  if (totals.itemCartonsSum === null) return { findings: [], couldNotCheck: 'an item is missing its carton count' };
  if (booking.cartons === totals.itemCartonsSum) return { findings: [] };
  return {
    findings: [
      {
        ruleId: 'R-04',
        severity: 'Red',
        scope: 'booking',
        problem: 'Booking carton total does not match the items',
        evidence: `Booking says ${num(booking.cartons)} cartons; the items add up to ${num(totals.itemCartonsSum)} cartons.`,
        fix: `Set the booking cartons to ${num(totals.itemCartonsSum)}, or correct the carton count on the item(s) that are wrong.`,
      },
    ],
  };
};
