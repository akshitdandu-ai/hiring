import { gbp, num } from '../../util/format';
import type { Rule } from './types';

export const R05: Rule = ({ booking, carrier }) => {
  if (booking.pallets === null || !(booking.pallets > 0)) return { findings: [], couldNotCheck: 'pallets is missing or not a valid number' };
  if (booking.grossWeightKg === null || !(booking.grossWeightKg > 0)) return { findings: [], couldNotCheck: 'gross weight is missing or not a valid number' };
  if (!carrier.options.length) return { findings: [], couldNotCheck: carrier.noRecommendationReason ?? 'no carrier route' };
  if (carrier.recommendation) return { findings: [] };
  const wpp = booking.grossWeightKg / booking.pallets;
  const s = carrier.palletSuggestion;
  const limits = carrier.options.map((o) => `${o.label} ${o.maxWeightPerPalletKg} kg`).join(', ');
  return {
    findings: [
      {
        ruleId: 'R-05',
        severity: 'Red',
        scope: 'booking',
        problem: 'Pallets are too heavy for every carrier on this route',
        evidence: `${num(booking.grossWeightKg)} kg ÷ ${num(booking.pallets)} pallets = ${num(wpp, 1)} kg per pallet. Limits: ${limits}.`,
        fix: s
          ? `Use at least ${s.palletsNeeded} pallets (best match: ${s.option.label}, ${gbp(s.cost)} total), or correct the gross weight.`
          : 'Add pallets or correct the gross weight.',
      },
    ],
  };
};

/** When R-05 passes, say what it was checked against. */
export function r05Evidence(carrier: { recommendation: { option: { label: string; maxWeightPerPalletKg: number; weightPerPallet: number | null } } | null }): string | null {
  const r = carrier.recommendation?.option;
  if (!r || r.weightPerPallet === null) return null;
  return `${num(r.weightPerPallet, 1)} kg per pallet ≤ ${r.maxWeightPerPalletKg} kg (${r.label})`;
}
