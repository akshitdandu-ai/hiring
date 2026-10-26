import { differenceInCalendarDays, parseISO } from 'date-fns';
import type { Booking, Finding } from '../model/types';
import { gbp, num } from '../util/format';
import type { Totals } from './deriveTotals';

/** Non-rulebook observations. Always Info: they never block or downgrade a booking. */
export function sanityChecks(b: Booking, t: Totals, todayISO: string): Finding[] {
  const out: Finding[] = [];
  for (const i of b.items) {
    if (i.unitPrice === 0) {
      out.push({ ruleId: 'INFO', severity: 'Info', scope: i.sku, problem: `Item ${i.sku} has a unit price of £0`, evidence: 'Unit price is 0.', fix: 'Customs expects a real value even for samples. Check the price.' });
    }
  }
  if (b.grossWeightKg && t.netWeightKg && b.grossWeightKg > t.netWeightKg * 2 && b.grossWeightKg - t.netWeightKg > 50) {
    out.push({
      ruleId: 'INFO',
      severity: 'Info',
      scope: 'booking',
      problem: 'Gross weight is much more than the goods weigh',
      evidence: `Gross ${num(b.grossWeightKg)} kg vs ${num(t.netWeightKg)} kg of product (more than double).`,
      fix: 'Check that the packaging and pallet weight are realistic.',
    });
  }
  if (b.readyDate) {
    const days = differenceInCalendarDays(parseISO(b.readyDate), parseISO(todayISO));
    if (days > 90) {
      out.push({ ruleId: 'INFO', severity: 'Info', scope: 'booking', problem: 'Ready date is more than 90 days away', evidence: `${days} days from today.`, fix: 'Check the date is right; carrier prices may change.' });
    }
  }
  if (b.declaredValue && b.declaredValue > 100000) {
    out.push({ ruleId: 'INFO', severity: 'Info', scope: 'booking', problem: 'High declared value', evidence: `${gbp(b.declaredValue)}.`, fix: 'Check for an extra zero, and consider cargo insurance.' });
  }
  return out;
}
