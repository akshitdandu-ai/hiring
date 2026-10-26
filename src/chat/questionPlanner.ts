import type { Booking } from '../model/types';
import { calculableFields } from '../engine/deriveTotals';
import { gbp, num } from '../util/format';
import { type Slot, slotKey } from './ops';
import { type Group, GROUP_ORDER, isMissing, requiredSlots } from './slotTracker';

export interface CalcProposal {
  slot: Slot;
  value: number;
  /** "90 cartons" / "£5,400" / "1,080 units ÷ 12 per carton = 90 cartons of Ceramic mugs" */
  text: string;
}

export interface Plan {
  group: Group | null;
  /** At most three plain questions. */
  questions: Slot[];
  /** Computed values to offer for confirmation instead of asking. */
  calc: CalcProposal[];
  complete: boolean;
}

export interface PlanOptions {
  deferred: ReadonlySet<string>;
  declined: ReadonlySet<string>;
}

export const MAX_QUESTIONS = 3;

/** Values we can compute from what the seller already told us. */
export function calcProposalFor(b: Booking, slot: Slot): CalcProposal | null {
  if (slot.scope === 'booking') {
    const c = calculableFields(b);
    if (slot.field === 'cartons' && c.cartons !== undefined) return { slot, value: c.cartons, text: `${num(c.cartons)} cartons` };
    if (slot.field === 'declaredValue' && c.declaredValue !== undefined) return { slot, value: c.declaredValue, text: gbp(c.declaredValue) };
    return null;
  }
  if (slot.field === 'cartons') {
    const it = b.items.find((i) => i.sku === slot.sku);
    if (it && it.quantity && it.unitsPerCarton && it.unitsPerCarton > 0 && Number.isInteger(it.quantity / it.unitsPerCarton)) {
      const n = it.quantity / it.unitsPerCarton;
      return { slot, value: n, text: `${num(it.quantity)} units ÷ ${num(it.unitsPerCarton)} per carton = ${num(n)} cartons of ${it.description || it.sku}` };
    }
  }
  return null;
}

export function planNext(b: Booking, opts: PlanOptions): Plan {
  const defs = requiredSlots(b).filter((d) => isMissing(b, d.slot) && !opts.deferred.has(slotKey(d.slot)));
  for (const group of GROUP_ORDER) {
    const inGroup = defs.filter((d) => d.group === group);
    if (!inGroup.length) continue;
    const questions: Slot[] = [];
    const calc: CalcProposal[] = [];
    for (const d of inGroup) {
      const proposal = calcProposalFor(b, d.slot);
      if (proposal && !opts.declined.has(slotKey(d.slot))) {
        calc.push(proposal);
        continue;
      }
      // Booking cartons are better computed once the items' cartons are known.
      if (d.slot.scope === 'booking' && d.slot.field === 'cartons') {
        const itemCartonsPending = b.items.some((i) => i.cartons === null && !opts.deferred.has(slotKey({ scope: 'item', sku: i.sku, field: 'cartons' })));
        if (itemCartonsPending && !opts.declined.has('cartons')) continue;
      }
      if (questions.length < MAX_QUESTIONS) questions.push(d.slot);
    }
    if (questions.length || calc.length) return { group, questions, calc, complete: false };
  }
  return { group: null, questions: [], calc: [], complete: true };
}
