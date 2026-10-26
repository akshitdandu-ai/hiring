import type { Booking } from '../model/types';
import type { Extracted } from './extractor';
import { type Op, parseExtraction } from './ops';

/**
 * The LLM is optional. It is only used when the build sets VITE_ENABLE_LLM=true and a serverless
 * function at /api/extract has a key. Anything wrong (no key, error, timeout, invalid JSON) returns
 * null and the rule-based parser is used instead.
 */
export const LLM_TIMEOUT_MS = 6000;

export const llmEnabled = (): boolean => (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_ENABLE_LLM === 'true';

let disabledForSession = false;

/** The slice of the booking the model needs to resolve "add a pallet" or "the mugs". */
export function compactBooking(b: Booking) {
  return {
    sellerName: b.sellerName,
    originCity: b.originCity,
    destinationCity: b.destinationCity,
    destinationCountry: b.destinationCountry,
    destinationType: b.destinationType,
    readyDate: b.readyDate,
    priority: b.priority,
    pallets: b.pallets,
    cartons: b.cartons,
    declaredValue: b.declaredValue,
    grossWeightKg: b.grossWeightKg,
    appointmentBooked: b.appointmentBooked,
    items: b.items.map((i) => ({
      sku: i.sku,
      description: i.description,
      hsCode: i.hsCodeRaw,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      unitsPerCarton: i.unitsPerCarton,
      cartons: i.cartons,
      unitWeightKg: i.unitWeightKg,
      countryOfOrigin: i.countryOfOrigin,
    })),
  };
}

export async function llmExtract(message: string, booking: Booking, fetchImpl: typeof fetch = fetch, timeoutMs = LLM_TIMEOUT_MS): Promise<Op[] | null> {
  if (disabledForSession) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl('/api/extract', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, booking: compactBooking(booking) }),
      signal: ctl.signal,
    });
    if (res.status === 404 || res.status === 501 || res.status === 503) {
      disabledForSession = true;
      return null;
    }
    if (!res.ok) return null;
    return parseExtraction(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Combine the two: control words, warnings and unit-conversion notes always come from the rule-based
 * pass (deterministic); the field updates come from the LLM when it returned valid JSON.
 */
export function mergeLlm(rule: Extracted, llmOps: Op[] | null): Extracted {
  if (!llmOps) return rule;
  // Never let the model turn a refused currency into a value, or answer a question as an edit.
  const ops = llmOps.filter((o) => {
    if (rule.unsupportedCurrency && ((o.op === 'set' && o.field === 'declaredValue') || (o.op === 'update_item' && o.field === 'unitPrice'))) return false;
    return true;
  });
  if (rule.signals.question || rule.signals.ambiguous || rule.signals.undo || rule.signals.startOver) return rule;
  return { ...rule, ops, notes: rule.notes };
}
