import type { Booking, Item } from '../model/types';
import { round2 } from '../util/format';

export interface Totals {
  /** null when any item lacks quantity or unit price */
  valueSum: number | null;
  itemCartonsSum: number | null;
  netWeightKg: number | null;
  weightPerPallet: number | null;
}

const ok = (n: number | null): n is number => typeof n === 'number' && Number.isFinite(n);

export function itemValue(i: Item): number | null {
  return ok(i.quantity) && ok(i.unitPrice) ? i.quantity * i.unitPrice : null;
}

function sumOrNull(items: Item[], f: (i: Item) => number | null): number | null {
  let t = 0;
  for (const i of items) {
    const v = f(i);
    if (v === null) return null;
    t += v;
  }
  return t;
}

export function deriveTotals(b: Booking): Totals {
  const hasItems = b.items.length > 0;
  const value = hasItems ? sumOrNull(b.items, itemValue) : null;
  const cartons = hasItems ? sumOrNull(b.items, (i) => (ok(i.cartons) ? i.cartons : null)) : null;
  const net = hasItems ? sumOrNull(b.items, (i) => (ok(i.unitWeightKg) && ok(i.quantity) ? i.unitWeightKg * i.quantity : null)) : null;
  const wpp = ok(b.grossWeightKg) && ok(b.pallets) && b.pallets > 0 ? b.grossWeightKg / b.pallets : null;
  return {
    valueSum: value === null ? null : round2(value),
    itemCartonsSum: cartons,
    netWeightKg: net === null ? null : Math.round(net * 1000) / 1000,
    weightPerPallet: wpp,
  };
}

/** Suggestions the chat can offer for "I don't know" answers. */
export function calculableFields(b: Booking): { cartons?: number; declaredValue?: number } {
  const t = deriveTotals(b);
  const out: { cartons?: number; declaredValue?: number } = {};
  if (t.itemCartonsSum !== null && t.itemCartonsSum > 0) out.cartons = t.itemCartonsSum;
  if (t.valueSum !== null && t.valueSum > 0) out.declaredValue = t.valueSum;
  return out;
}
