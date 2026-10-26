import type { Booking, FieldSource, Item } from '../model/types';
import { type ItemFieldName, type Slot, slotKey } from './ops';

export type SlotStatus = 'missing' | 'filled' | 'calculated' | 'confirmed';
export type Group = 'route' | 'goods' | 'packing' | 'value' | 'dateAppt' | 'priority';
export const GROUP_ORDER: Group[] = ['route', 'goods', 'packing', 'value', 'dateAppt', 'priority'];
export const NEW_ITEM = '*new*';

export function emptyBooking(bookingId: string): Booking {
  return {
    bookingId,
    sellerName: '',
    originCity: '',
    originCountry: '',
    destinationCity: '',
    destinationCountry: '',
    destinationType: '',
    readyDate: null,
    priority: '',
    pallets: null,
    cartons: null,
    declaredValue: null,
    currency: 'GBP',
    grossWeightKg: null,
    appointmentBooked: null,
    items: [],
    fieldSources: { currency: 'default' },
  };
}

export function emptyItem(sku: string): Item {
  return { sku, description: '', hsCodeRaw: '', hsCodeDigits: '', quantity: null, unitPrice: null, unitsPerCarton: null, cartons: null, unitWeightKg: null, countryOfOrigin: '' };
}

export function itemFieldValue(i: Item, f: ItemFieldName): string | number | null {
  switch (f) {
    case 'sku': return i.sku;
    case 'description': return i.description || null;
    case 'hsCode': return i.hsCodeRaw || null;
    case 'quantity': return i.quantity;
    case 'unitPrice': return i.unitPrice;
    case 'unitsPerCarton': return i.unitsPerCarton;
    case 'cartons': return i.cartons;
    case 'unitWeightKg': return i.unitWeightKg;
    case 'countryOfOrigin': return i.countryOfOrigin || null;
  }
}

export function slotValue(b: Booking, slot: Slot): string | number | boolean | null {
  if (slot.scope === 'item') {
    const it = b.items.find((i) => i.sku === slot.sku);
    return it ? itemFieldValue(it, slot.field) : null;
  }
  switch (slot.field) {
    case 'destinationCountry': return b.destinationCountry || null;
    case 'sellerName': return b.sellerName || null;
    case 'originCity': return b.originCity || null;
    case 'destinationCity': return b.destinationCity || null;
    case 'destinationType': return b.destinationType || null;
    case 'priority': return b.priority || null;
    default: return b[slot.field];
  }
}

export const isMissing = (b: Booking, slot: Slot) => {
  if (slot.scope === 'item' && slot.sku === NEW_ITEM) return b.items.length === 0;
  const v = slotValue(b, slot);
  return v === null || v === '';
};

export interface SlotDef {
  slot: Slot;
  group: Group;
}

/** Every slot the booking needs, in the order we ask about them. Appointment only applies to warehouses. */
export function requiredSlots(b: Booking): SlotDef[] {
  const out: SlotDef[] = [];
  const bk = (field: Extract<Slot, { scope: 'booking' }>['field'], group: Group) => out.push({ slot: { scope: 'booking', field }, group });
  bk('sellerName', 'route');
  bk('originCity', 'route');
  bk('destinationCity', 'route');
  bk('destinationType', 'route');
  if (!b.items.length) out.push({ slot: { scope: 'item', sku: NEW_ITEM, field: 'description' }, group: 'goods' });
  for (const i of b.items) {
    for (const f of ['description', 'hsCode', 'quantity', 'unitPrice'] as const) out.push({ slot: { scope: 'item', sku: i.sku, field: f }, group: 'goods' });
  }
  for (const i of b.items) {
    for (const f of ['unitsPerCarton', 'cartons', 'unitWeightKg', 'countryOfOrigin'] as const) out.push({ slot: { scope: 'item', sku: i.sku, field: f }, group: 'packing' });
  }
  bk('pallets', 'packing');
  bk('cartons', 'packing');
  bk('declaredValue', 'value');
  bk('grossWeightKg', 'value');
  bk('readyDate', 'dateAppt');
  if (b.destinationType === 'Warehouse') bk('appointmentBooked', 'dateAppt');
  bk('priority', 'priority');
  return out;
}

export function slotStatus(b: Booking, slot: Slot): SlotStatus {
  if (isMissing(b, slot)) return 'missing';
  const key = slot.scope === 'booking' ? slot.field : `item:${slot.sku}:${slot.field}`;
  const src: FieldSource | undefined = b.fieldSources[key];
  if (src === 'calculated-confirmed') return 'confirmed';
  if (src === 'inferred' || src === 'default') return 'calculated';
  return 'filled';
}

export const BOOKING_LABELS: Record<string, string> = {
  sellerName: 'Seller name',
  originCity: 'Origin city',
  destinationCity: 'Destination city',
  destinationCountry: 'Destination country',
  destinationType: 'Destination type',
  readyDate: 'Ready to ship date',
  priority: 'Seller priority',
  pallets: 'Pallets',
  cartons: 'Cartons',
  declaredValue: 'Declared value',
  grossWeightKg: 'Gross weight',
  appointmentBooked: 'Delivery appointment',
};
export const ITEM_LABELS: Record<ItemFieldName, string> = {
  sku: 'SKU',
  description: 'Description',
  hsCode: 'HS code',
  quantity: 'Quantity',
  unitPrice: 'Unit price',
  unitsPerCarton: 'Units per carton',
  cartons: 'Cartons',
  unitWeightKg: 'Unit weight',
  countryOfOrigin: 'Country of origin',
};

export { slotKey };
