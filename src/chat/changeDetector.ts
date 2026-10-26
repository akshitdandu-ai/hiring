import { CITY_TO_COUNTRY, COUNTRY_ALIASES, DESTINATION_COUNTRIES, ITEM_COUNTRIES, ORIGIN_COUNTRY } from '../config/allowedValues';
import { validateBooking } from '../engine/dataChecks';
import type { Booking, FieldSource, Item } from '../model/types';
import { gbp, longDate, num } from '../util/format';
import { cleanHsCode } from '../util/hs';
import { matchFixed } from '../util/text';
import { resolveItem } from './extractor';
import type { ItemFieldName, Op } from './ops';
import { BOOKING_LABELS, emptyItem, ITEM_LABELS } from './slotTracker';

export interface ApplyResult {
  booking: Booking;
  /** Plain notes: things that could not be applied, or that need the seller's attention. */
  notes: string[];
  /** Data problems in the values that were just set (reported at once so the seller can fix them). */
  warnings: string[];
}

export type ChangeKind = 'fill' | 'change' | 'clear';
export interface ChangeLine {
  kind: ChangeKind;
  text: string;
}

const clone = <T>(x: T): T => structuredClone(x);

function nextSku(items: Item[]): string {
  let n = items.length + 1;
  while (items.some((i) => i.sku.toLowerCase() === `item-${n}`)) n++;
  return `ITEM-${n}`;
}

const setSource = (b: Booking, key: string, src: FieldSource) => {
  b.fieldSources[key] = src;
};

function applyItemValue(b: Booking, item: Item, field: ItemFieldName, value: string | number, mode: 'set' | 'increment' | 'decrement', notes: string[]) {
  const key = `item:${item.sku}:${field}`;
  const numeric = (cur: number | null): number => {
    const v = Number(value);
    if (mode === 'increment') return (cur ?? 0) + v;
    if (mode === 'decrement') return (cur ?? 0) - v;
    return v;
  };
  switch (field) {
    case 'sku': {
      const old = item.sku;
      item.sku = String(value).toUpperCase();
      for (const k of Object.keys(b.fieldSources)) if (k.startsWith(`item:${old}:`)) delete b.fieldSources[k];
      return;
    }
    case 'description': item.description = String(value).trim(); break;
    case 'hsCode': {
      const hs = cleanHsCode(typeof value === 'number' ? String(value) : value);
      item.hsCodeRaw = hs.raw;
      item.hsCodeDigits = hs.digits;
      item.hsCodeWasNumeric = false;
      break;
    }
    case 'countryOfOrigin': {
      const m = matchFixed(value, ITEM_COUNTRIES, COUNTRY_ALIASES);
      item.countryOfOrigin = m ? m.value : String(value).trim();
      if (!m) notes.push(`"${value}" is not a supported country of origin (${ITEM_COUNTRIES.join(', ')}).`);
      break;
    }
    case 'quantity': {
      const v = numeric(item.quantity);
      if (v < 0) return void notes.push(`${item.sku}: quantity cannot go below zero, so I left it at ${num(item.quantity)}.`);
      item.quantity = v;
      break;
    }
    case 'unitPrice': item.unitPrice = numeric(item.unitPrice); break;
    case 'unitsPerCarton': item.unitsPerCarton = numeric(item.unitsPerCarton); break;
    case 'cartons': item.cartons = numeric(item.cartons); break;
    case 'unitWeightKg': item.unitWeightKg = numeric(item.unitWeightKg); break;
  }
  delete b.fieldSources[key]; // stated by the seller
}

/** Apply field updates to a copy of the booking. Pure: never mutates the input. */
export function applyOps(before: Booking, ops: Op[]): ApplyResult {
  const b = clone(before);
  const notes: string[] = [];
  const touched = new Set<string>();

  for (const op of ops) {
    switch (op.op) {
      case 'set': {
        const v = op.value;
        switch (op.field) {
          case 'sellerName': b.sellerName = String(v ?? '').trim(); break;
          case 'originCity':
            b.originCity = String(v ?? '');
            b.originCountry = b.originCity ? ORIGIN_COUNTRY : '';
            setSource(b, 'originCountry', 'inferred');
            break;
          case 'destinationCity': {
            b.destinationCity = String(v ?? '');
            const country = CITY_TO_COUNTRY[b.destinationCity];
            if (country) {
              b.destinationCountry = country;
              setSource(b, 'destinationCountry', 'inferred');
            }
            break;
          }
          case 'destinationCountry': {
            const c = matchFixed(v, DESTINATION_COUNTRIES, COUNTRY_ALIASES)?.value ?? String(v ?? '');
            b.destinationCountry = c;
            setSource(b, 'destinationCountry', 'stated');
            if (b.destinationCity && CITY_TO_COUNTRY[b.destinationCity] !== c) {
              notes.push(`${b.destinationCity} is in ${CITY_TO_COUNTRY[b.destinationCity]}, so I cleared the city. Which city in ${c}?`);
              b.destinationCity = '';
            }
            break;
          }
          case 'destinationType':
            b.destinationType = String(v ?? '');
            if (b.destinationType === 'Business address') {
              b.appointmentBooked = false; // not needed for a business address; set silently
              setSource(b, 'appointmentBooked', 'inferred');
            } else if (b.destinationType === 'Warehouse' && b.fieldSources.appointmentBooked === 'inferred') {
              b.appointmentBooked = null;
              delete b.fieldSources.appointmentBooked;
            }
            break;
          case 'readyDate': b.readyDate = v === null ? null : String(v); break;
          case 'priority': b.priority = String(v ?? ''); break;
          case 'appointmentBooked': b.appointmentBooked = typeof v === 'boolean' ? v : /^(y|yes|true)/i.test(String(v)); break;
          case 'pallets':
          case 'cartons':
          case 'declaredValue':
          case 'grossWeightKg': b[op.field] = v === null ? null : Number(v); break;
        }
        if (op.field !== 'destinationCountry' || true) setSource(b, op.field, 'stated');
        touched.add(op.field);
        break;
      }
      case 'increment':
      case 'decrement': {
        const cur = b[op.field];
        const sign = op.op === 'increment' ? 1 : -1;
        if (cur === null) {
          if (sign < 0) {
            notes.push(`${BOOKING_LABELS[op.field]} has not been given yet, so there is nothing to remove.`);
            break;
          }
          b[op.field] = op.amount;
          notes.push(`You had not given ${BOOKING_LABELS[op.field].toLowerCase()} yet, so I set it to ${num(op.amount)}.`);
        } else {
          const next = cur + sign * op.amount;
          if (next <= 0 && (op.field === 'pallets' || op.field === 'grossWeightKg')) {
            notes.push(`That would leave ${BOOKING_LABELS[op.field].toLowerCase()} at ${num(next)}, so I left it at ${num(cur)}. Tell me the number you want.`);
            break;
          }
          if (next < 0) {
            notes.push(`${BOOKING_LABELS[op.field]} cannot go below zero, so I left it at ${num(cur)}.`);
            break;
          }
          b[op.field] = Math.round(next * 1000) / 1000;
        }
        setSource(b, op.field, 'stated');
        touched.add(op.field);
        break;
      }
      case 'add_item': {
        const p = op.item;
        const existing = p.sku ? b.items.find((i) => i.sku.toLowerCase() === p.sku!.toLowerCase()) : undefined;
        const item = existing ?? emptyItem((p.sku ?? nextSku(b.items)).toUpperCase());
        const fields: Array<[ItemFieldName, string | number | undefined]> = [
          ['description', p.description], ['hsCode', p.hsCode], ['quantity', p.quantity], ['unitPrice', p.unitPrice],
          ['unitsPerCarton', p.unitsPerCarton], ['cartons', p.cartons], ['unitWeightKg', p.unitWeightKg], ['countryOfOrigin', p.countryOfOrigin],
        ];
        for (const [f, v] of fields) if (v !== undefined) applyItemValue(b, item, f, v, 'set', notes);
        if (!existing) b.items.push(item);
        touched.add(`item:${item.sku}`);
        break;
      }
      case 'remove_item': {
        const it = resolveItem(b.items, op.match);
        if (!it) {
          notes.push(`I could not find an item matching "${op.match}".`);
          break;
        }
        b.items = b.items.filter((i) => i !== it);
        for (const k of Object.keys(b.fieldSources)) if (k.startsWith(`item:${it.sku}:`)) delete b.fieldSources[k];
        break;
      }
      case 'update_item': {
        const it = op.match ? resolveItem(b.items, op.match) : b.items.length === 1 ? b.items[0] : null;
        if (!it) {
          notes.push(op.match ? `I could not find an item matching "${op.match}".` : 'Which item do you mean?');
          break;
        }
        applyItemValue(b, it, op.field, op.value, op.mode ?? 'set', notes);
        touched.add(`item:${it.sku}`);
        break;
      }
    }
  }

  // Report data problems in the values the seller just gave, right away.
  const warnings = validateBooking(b)
    .filter((f) => {
      if (f.scope === 'booking') return f.field !== undefined && touched.has(f.field) && !/missing/i.test(f.problem);
      return touched.has(`item:${f.scope}`) && !/missing/i.test(f.problem);
    })
    .map((f) => `${f.problem}. ${f.fix}`);
  return { booking: b, notes, warnings };
}

// ---------- diffs ----------
const fmtSrc = (b: Booking, field: string): string => {
  switch (field) {
    case 'readyDate': return b.readyDate ? longDate(b.readyDate) : '';
    case 'declaredValue': return b.declaredValue === null ? '' : gbp(b.declaredValue);
    case 'grossWeightKg': return b.grossWeightKg === null ? '' : `${num(b.grossWeightKg)} kg`;
    case 'pallets': return b.pallets === null ? '' : num(b.pallets, 3);
    case 'cartons': return b.cartons === null ? '' : num(b.cartons, 3);
    case 'appointmentBooked': return b.appointmentBooked === null ? '' : b.appointmentBooked ? 'Yes' : 'No';
    case 'originCity': return b.originCity ? `${b.originCity}, ${b.originCountry || ORIGIN_COUNTRY}` : '';
    case 'destination': return b.destinationCity ? `${b.destinationCity}${b.destinationCountry ? ', ' + b.destinationCountry : ''}` : b.destinationCountry;
    default: return String((b as unknown as Record<string, unknown>)[field] ?? '');
  }
};

const itemVal = (i: Item, f: ItemFieldName): string => {
  switch (f) {
    case 'unitPrice': return i.unitPrice === null ? '' : gbp(i.unitPrice);
    case 'unitWeightKg': return i.unitWeightKg === null ? '' : `${num(i.unitWeightKg, 3)} kg`;
    case 'hsCode': return i.hsCodeRaw;
    case 'description': return i.description;
    case 'sku': return i.sku;
    case 'countryOfOrigin': return i.countryOfOrigin;
    default: {
      const v = i[f as 'quantity'];
      return v === null ? '' : num(v, 3);
    }
  }
};

/** Describe what changed between two bookings, e.g. "Pallets: 3 → 4". Used for chat edits and for undo. */
export function describeBookingDiff(a: Booking, z: Booking): ChangeLine[] {
  const out: ChangeLine[] = [];
  const fields = ['sellerName', 'originCity', 'destination', 'destinationType', 'appointmentBooked', 'readyDate', 'priority', 'pallets', 'cartons', 'declaredValue', 'grossWeightKg'];
  for (const f of fields) {
    const from = fmtSrc(a, f);
    const to = fmtSrc(z, f);
    if (from === to) continue;
    const label = f === 'destination' ? 'Destination' : f === 'originCity' ? 'Origin' : BOOKING_LABELS[f];
    if (!from) out.push({ kind: 'fill', text: `${label}: ${to}` });
    else if (!to) out.push({ kind: 'clear', text: `${label}: ${from} → (cleared)` });
    else out.push({ kind: 'change', text: `${label}: ${from} → ${to}` });
  }
  for (const it of z.items) {
    const old = a.items.find((i) => i.sku === it.sku);
    if (!old) {
      const bits = [it.quantity !== null ? `${num(it.quantity)} ×` : '', it.description || it.sku, it.unitPrice !== null ? `at ${gbp(it.unitPrice)}` : ''].filter(Boolean);
      out.push({ kind: 'fill', text: `Item ${it.sku} added: ${bits.join(' ')}` });
      continue;
    }
    for (const f of ['description', 'hsCode', 'quantity', 'unitPrice', 'unitsPerCarton', 'cartons', 'unitWeightKg', 'countryOfOrigin'] as ItemFieldName[]) {
      const from = itemVal(old, f);
      const to = itemVal(it, f);
      if (from === to) continue;
      const label = `${it.sku} ${ITEM_LABELS[f].toLowerCase()}`;
      if (!from) out.push({ kind: 'fill', text: `${label}: ${to}` });
      else if (!to) out.push({ kind: 'clear', text: `${label}: ${from} → (cleared)` });
      else out.push({ kind: 'change', text: `${label}: ${from} → ${to}` });
    }
  }
  for (const it of a.items) {
    if (!z.items.some((i) => i.sku === it.sku)) out.push({ kind: 'clear', text: `Item ${it.sku} removed${it.description ? ` (${it.description})` : ''}` });
  }
  return out;
}
