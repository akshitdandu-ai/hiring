import { cleanHsCode } from '../src/util/hs';
import type { Booking, Item } from '../src/model/types';

export const TODAY = new Date(2026, 9, 26); // 26 Oct 2026, local

export function item(over: Partial<Item> = {}): Item {
  const hs = cleanHsCode(over.hsCodeRaw ?? '691200');
  return {
    sku: 'MUG-01',
    description: 'Ceramic coffee mug, 350 ml',
    hsCodeRaw: hs.raw,
    hsCodeDigits: hs.digits,
    quantity: 1080,
    unitPrice: 5,
    unitsPerCarton: 12,
    cartons: 90,
    unitWeightKg: 0.5,
    countryOfOrigin: 'United Kingdom',
    ...over,
  };
}

/** The template's example booking: fully clean on TODAY. */
export function booking(over: Partial<Booking> = {}, items?: Item[]): Booking {
  return {
    bookingId: 'BK-001',
    sellerName: 'Northfield Goods',
    originCity: 'Manchester',
    originCountry: 'United Kingdom',
    destinationCity: 'Frankfurt',
    destinationCountry: 'Germany',
    destinationType: 'Warehouse',
    readyDate: '2026-11-05',
    priority: 'Cheapest',
    pallets: 3,
    cartons: 90,
    declaredValue: 5400,
    currency: 'GBP',
    grossWeightKg: 620,
    appointmentBooked: true,
    items: items ?? [item()],
    fieldSources: {},
    ...over,
  };
}
