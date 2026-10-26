import { editDistance } from '../util/text';

export type BookingField =
  | 'bookingId' | 'sellerName' | 'originCity' | 'originCountry' | 'originCombined' | 'destinationCity' | 'destinationCountry'
  | 'destinationCombined' | 'destinationType' | 'readyDate' | 'priority' | 'pallets' | 'cartons' | 'declaredValue' | 'currency'
  | 'grossWeightKg' | 'appointmentBooked';
export type ItemField =
  | 'bookingId' | 'sku' | 'description' | 'skuDescription' | 'hsCode' | 'quantity' | 'unitPrice' | 'unitsPerCarton' | 'cartons'
  | 'unitWeightKg' | 'countryOfOrigin';

/** Normalised synonyms (see normHeader). */
export const BOOKING_HEADERS: Record<BookingField, string[]> = {
  bookingId: ['booking id', 'bookingid', 'booking ref', 'booking reference', 'booking no', 'booking number', 'booking'],
  sellerName: ['seller name', 'seller', 'seller business', 'customer'],
  originCity: ['origin city', 'collection city', 'from city'],
  originCountry: ['origin country', 'collection country', 'from country'],
  originCombined: ['origin city origin country', 'origin', 'origin city and country', 'from'],
  destinationCity: ['destination city', 'delivery city', 'to city', 'dest city'],
  destinationCountry: ['destination country', 'delivery country', 'to country', 'dest country'],
  destinationCombined: ['destination city destination country', 'destination', 'destination city and country', 'to'],
  destinationType: ['destination type', 'delivery type', 'dest type'],
  readyDate: ['ready to ship date', 'ready date', 'ready to ship', 'ready for collection', 'collection date', 'ship date'],
  priority: ['seller priority', 'priority'],
  pallets: ['pallets', 'pallet count', 'number of pallets', 'no of pallets'],
  cartons: ['cartons', 'carton count', 'total cartons', 'number of cartons', 'boxes'],
  declaredValue: ['total declared value', 'declared value', 'customs value', 'total value'],
  currency: ['currency', 'ccy'],
  grossWeightKg: ['total gross weight kg', 'total gross weight', 'gross weight kg', 'gross weight', 'weight kg', 'total weight kg', 'total weight'],
  appointmentBooked: ['delivery appointment booked', 'delivery appointment', 'appointment booked', 'appointment'],
};
export const ITEM_HEADERS: Record<ItemField, string[]> = {
  bookingId: ['booking id', 'bookingid', 'booking ref', 'booking reference', 'booking no', 'booking number', 'booking'],
  sku: ['sku', 'product code', 'item code', 'sku code'],
  description: ['description', 'product description', 'item description', 'product', 'item'],
  skuDescription: ['sku description', 'sku and description', 'sku desc'],
  hsCode: ['hs code', 'hscode', 'hs', 'commodity code', 'tariff code', 'hs code digits'],
  quantity: ['quantity units', 'quantity', 'qty', 'units', 'quantity unit'],
  unitPrice: ['unit price', 'price per unit', 'price', 'unit price gbp'],
  unitsPerCarton: ['units per carton', 'units carton', 'units per box', 'pcs per carton', 'qty per carton', 'upc'],
  cartons: ['cartons', 'carton count', 'number of cartons', 'no of cartons', 'boxes'],
  unitWeightKg: ['unit weight kg', 'unit weight', 'weight per unit kg', 'weight per unit', 'item weight kg'],
  countryOfOrigin: ['country of origin', 'origin country of item', 'coo', 'made in', 'country origin'],
};

/** Lower-case, drop punctuation (keeping the words), collapse spaces. "Total gross weight (kg)" → "total gross weight kg". */
export function normHeader(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** 0 = exact, 1 = near (edit distance ≤ 1 on 8+ chars), 2 = typo (≤ 2 on 12+ chars); null = no match. */
function score(h: string, synonyms: string[]): number | null {
  if (synonyms.includes(h)) return 0;
  let best: number | null = null;
  for (const syn of synonyms) {
    if (syn.length >= 8) {
      const d = editDistance(h, syn);
      if (d <= 1) best = Math.min(best ?? 9, 1);
      else if (d <= 2 && syn.length >= 12) best = Math.min(best ?? 9, 2);
    }
  }
  return best;
}

export type ColumnMap<F extends string> = Partial<Record<F, number>>;

export function mapHeaders<F extends string>(cells: unknown[], table: Record<F, string[]>): { map: ColumnMap<F>; matched: number } {
  const headers = cells.map(normHeader);
  const map: ColumnMap<F> = {};
  const used = new Set<number>();
  const fields = Object.keys(table) as F[];
  for (let pass = 0; pass <= 2; pass++) {
    for (const f of fields) {
      if (map[f] !== undefined) continue;
      for (let c = 0; c < headers.length; c++) {
        if (used.has(c) || !headers[c]) continue;
        if (score(headers[c], table[f]) === pass) {
          map[f] = c;
          used.add(c);
          break;
        }
      }
    }
  }
  return { map, matched: Object.keys(map).length };
}

export interface HeaderHit<F extends string> {
  headerRow: number; // 0-based
  map: ColumnMap<F>;
  matched: number;
}

/** Scan the first 10 rows for the best header row. */
export function findHeaderRow<F extends string>(rows: unknown[][], table: Record<F, string[]>, required: F[]): HeaderHit<F> | null {
  let best: HeaderHit<F> | null = null;
  for (let r = 0; r < Math.min(10, rows.length); r++) {
    const { map, matched } = mapHeaders(rows[r] ?? [], table);
    if (!required.every((f) => map[f] !== undefined)) continue;
    if (!best || matched > best.matched) best = { headerRow: r, map, matched };
  }
  return best;
}
