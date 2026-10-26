import { longDate } from '../../util/format';
import type { Rule } from './types';

export const R10: Rule = ({ booking, todayISO }) => {
  if (!booking.readyDate) return { findings: [], couldNotCheck: 'the ready date is missing or invalid' };
  // ISO dates compare correctly as strings; date only, so "today" passes.
  if (booking.readyDate >= todayISO) return { findings: [] };
  return {
    findings: [
      {
        ruleId: 'R-10',
        severity: 'Amber',
        scope: 'booking',
        problem: 'Ready to ship date is in the past',
        evidence: `Ready date ${longDate(booking.readyDate)}; today is ${longDate(todayISO)}.`,
        fix: 'Set a ready date of today or later.',
      },
    ],
  };
};
