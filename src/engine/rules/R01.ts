import type { Finding } from '../../model/types';
import type { Rule } from './types';
import { NO_ITEMS } from './types';

export const R01: Rule = ({ booking }) => {
  if (!booking.items.length) return { findings: [], couldNotCheck: NO_ITEMS };
  const findings: Finding[] = [];
  for (const i of booking.items) {
    const base = { ruleId: 'R-01' as const, scope: i.sku };
    const raw = i.hsCodeRaw.trim();
    if (!raw) {
      findings.push({ ...base, severity: 'Red', problem: `Item ${i.sku} has a missing HS code`, evidence: 'HS code is blank.', fix: 'Find the full 6-10 digit commodity code on the UK Trade Tariff and enter it for this item.' });
      continue;
    }
    if (/[^0-9]/.test(i.hsCodeDigits)) {
      findings.push({ ...base, severity: 'Red', problem: `Item ${i.sku} has an invalid HS code`, evidence: `"${raw}" contains characters other than digits.`, fix: 'Enter the HS code using digits only (dots and spaces are fine), at least 6 digits.' });
      continue;
    }
    const n = i.hsCodeDigits.length;
    if (n < 6) {
      const dropped = i.hsCodeWasNumeric && (n === 5 || n === 9);
      findings.push({
        ...base,
        severity: 'Red',
        problem: `Item ${i.sku} has an HS code that is too short`,
        evidence: `"${raw}" has ${n} digit${n === 1 ? '' : 's'}; at least 6 are required.${dropped ? ' Excel may have dropped a leading zero from this number.' : ''}`,
        fix: dropped ? 'Re-enter the full code (format the column as Text so a leading zero is kept) and check it against the UK Trade Tariff.' : 'Enter the full code, at least 6 digits, from the UK Trade Tariff.',
      });
    } else if (n > 10) {
      findings.push({ ...base, severity: 'Info', problem: `Item ${i.sku} has an unusually long HS code`, evidence: `"${raw}" has ${n} digits; UK commodity codes are up to 10.`, fix: 'Check the code against the UK Trade Tariff.' });
    }
  }
  return { findings };
};
