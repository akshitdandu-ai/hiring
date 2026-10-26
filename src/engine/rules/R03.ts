import type { Finding } from '../../model/types';
import { num } from '../../util/format';
import type { Rule } from './types';
import { NO_ITEMS } from './types';

export const R03: Rule = ({ booking }) => {
  if (!booking.items.length) return { findings: [], couldNotCheck: NO_ITEMS };
  const findings: Finding[] = [];
  const skipped: string[] = [];
  for (const i of booking.items) {
    const { quantity: q, unitsPerCarton: u, cartons: c } = i;
    if (q === null || u === null || c === null || !Number.isFinite(q + u + c)) {
      skipped.push(i.sku);
      continue;
    }
    if (u * c === q) continue;
    let fix: string;
    if (u > 0 && Number.isInteger(q / u)) fix = `Cartons should be ${q / u} (${num(q)} units ÷ ${num(u)} per carton).`;
    else if (c > 0 && Number.isInteger(q / c)) fix = `Units per carton should be ${q / c} (${num(q)} units ÷ ${num(c)} cartons).`;
    else fix = `Quantity should be units per carton × cartons = ${num(u * c)}, or correct the carton figures.`;
    findings.push({
      ruleId: 'R-03',
      severity: 'Red',
      scope: i.sku,
      problem: `Item ${i.sku}: units per carton × cartons does not equal the quantity`,
      evidence: `${num(u)} per carton × ${num(c)} cartons = ${num(u * c)}, but quantity is ${num(q)}.`,
      fix,
    });
  }
  return { findings, couldNotCheck: skipped.length ? `item ${skipped.join(', ')} is missing quantity, units per carton or cartons` : undefined };
};
