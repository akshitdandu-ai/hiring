import type { Finding } from '../../model/types';
import { norm } from '../../util/text';
import type { Rule } from './types';
import { NO_ITEMS } from './types';

export const MISSING_COUNTRY = ['', 'n/a', 'na', '-', '–', 'unknown', 'none', '?'];

export const R09: Rule = ({ booking }) => {
  if (!booking.items.length) return { findings: [], couldNotCheck: NO_ITEMS };
  const findings: Finding[] = [];
  for (const i of booking.items) {
    if (!MISSING_COUNTRY.includes(norm(i.countryOfOrigin))) continue;
    findings.push({
      ruleId: 'R-09',
      severity: 'Amber',
      scope: i.sku,
      problem: `Item ${i.sku} has no country of origin`,
      evidence: i.countryOfOrigin.trim() ? `Value is "${i.countryOfOrigin.trim()}".` : 'Country of origin is blank.',
      fix: 'Enter where the product was made (not where it ships from): United Kingdom, China, India, Vietnam, Turkey or Germany.',
    });
  }
  return { findings };
};
