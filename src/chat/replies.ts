import { DESTINATION_CITIES, ITEM_COUNTRIES, ORIGIN_CITIES } from '../config/allowedValues';
import { describeRoute } from '../engine/confirmation';
import type { Booking, BookingResult } from '../model/types';
import { gbp, longDate, num } from '../util/format';
import type { CalcProposal, Plan } from './questionPlanner';
import type { Slot } from './ops';
import { NEW_ITEM, type Group } from './slotTracker';

export const GREETING =
  "Hi, I'm Pre-Flight. Describe your UK → EU shipment in your own words, for example \"3 pallets of ceramic mugs from Manchester to a warehouse in Frankfurt\". I'll ask only for what's missing, then check the booking for mistakes before anything leaves. You can change anything at any time, and \"undo\" reverts the last change.";

const HS_HINTS: Array<[RegExp, string, string]> = [
  [/\b(mug|cup|ceramic|porcelain|plate|bowl|teapot|stoneware)s?\b/i, '6912', 'ceramic tableware'],
  [/\b(t-?shirt|tee)s?\b/i, '6109', 'knitted T-shirts'],
  [/\b(hoodie|jumper|sweater|sweatshirt|cardigan)s?\b/i, '6110', 'knitted jumpers and hoodies'],
  [/\b(tote|handbag|backpack|bag)s?\b/i, '4202', 'bags and cases'],
  [/\b(candle)s?\b/i, '3406', 'candles'],
  [/\b(notebook|diary|journal)s?\b/i, '4820', 'notebooks and diaries'],
  [/\b(toy|doll|game|puzzle)s?\b/i, '9503', 'toys'],
  [/\b(soap)s?\b/i, '3401', 'soap'],
  [/\b(lamp|light fitting)s?\b/i, '9405', 'lamps and lighting'],
  [/\b(cushion|pillow)s?\b/i, '9404', 'cushions and bedding'],
];

export function hsHint(description: string): string | null {
  const h = HS_HINTS.find(([re]) => re.test(description));
  return h ? `for ${h[2]} this is often under heading ${h[1]}; please confirm the full code on the UK Trade Tariff` : null;
}

const itemOf = (b: Booking, sku: string) => b.items.find((i) => i.sku === sku);
const name = (b: Booking, sku: string) => {
  const it = itemOf(b, sku);
  return it?.description || it?.sku || 'this item';
};

export function questionText(b: Booking, slot: Slot): string {
  if (slot.scope === 'item') {
    if (slot.sku === NEW_ITEM) return 'What are you shipping? Give me the product and, if you have them, the quantity and unit price. You can list several products.';
    const n = name(b, slot.sku);
    switch (slot.field) {
      case 'description': return 'What is this product? A plain description is fine.';
      case 'hsCode': {
        const hint = hsHint(n);
        return `What is the HS code for ${n}? It needs at least 6 digits${hint ? ` (${hint})` : ''}.`;
      }
      case 'quantity': return `How many units of ${n} are you shipping?`;
      case 'unitPrice': return `What is the price of one unit of ${n}, in GBP?`;
      case 'unitsPerCarton': return `How many units of ${n} fit in one carton?`;
      case 'cartons': return `How many cartons of ${n}?`;
      case 'unitWeightKg': return `How much does one unit of ${n} weigh, in kg?`;
      case 'countryOfOrigin': return `What is the country of origin for ${n}, i.e. where was it made (${ITEM_COUNTRIES.join(', ')})? Say "skip" if you don't know.`;
      default: return `What is the ${slot.field} of ${n}?`;
    }
  }
  switch (slot.field) {
    case 'sellerName': return 'What is your business (seller) name?';
    case 'originCity': return `Which UK city will we collect from (${ORIGIN_CITIES.join(', ')})?`;
    case 'destinationCity': {
      const country = b.destinationCountry && DESTINATION_CITIES[b.destinationCountry];
      return country
        ? `Which city in ${b.destinationCountry} is it going to (${country.join(', ')})?`
        : `Which city is it going to? Germany: ${DESTINATION_CITIES.Germany.join(', ')}; France: ${DESTINATION_CITIES.France.join(', ')}; Netherlands: ${DESTINATION_CITIES.Netherlands.join(', ')}.`;
    }
    case 'destinationType': return 'Is the delivery to a Warehouse or a Business address?';
    case 'pallets': return 'How many pallets?';
    case 'cartons': return 'How many cartons in total?';
    case 'declaredValue': return 'What is the total declared value of the goods, in GBP?';
    case 'grossWeightKg': return 'What is the total gross weight in kg, including cartons and pallets?';
    case 'readyDate': return 'When will the goods be ready for collection? (day first, e.g. 05/11 or "next Friday")';
    case 'appointmentBooked': return 'Have you booked a delivery appointment with the receiving warehouse? (yes / no)';
    case 'priority': return 'What matters most: Cheapest, Fastest, Most reliable or Balanced?';
    default: return `What is the ${slot.field}?`;
  }
}

/** Why we need it, used when the seller says "I don't know". */
export function whyText(b: Booking, slot: Slot): string {
  const f = slot.field;
  const n = slot.scope === 'item' ? name(b, slot.sku) : '';
  const why: Record<string, string> = {
    sellerName: 'it goes on the booking and the commercial invoice',
    originCity: 'we need to know where to collect from',
    destinationCity: 'it decides the route and the carrier price',
    destinationType: 'warehouses need a delivery appointment, business addresses do not',
    pallets: 'carrier prices are per pallet, and the pallet weight limit depends on it',
    cartons: 'the carton total must match your items for the warehouse to receive it',
    declaredValue: 'customs relies on the declared value, and it must match your items',
    grossWeightKg: 'carriers have a weight limit per pallet, so I need the total weight',
    readyDate: 'the collection date and delivery estimate depend on it',
    appointmentBooked: 'a warehouse can refuse a delivery that has no booked slot',
    priority: 'it decides which carrier I recommend',
    description: 'customs needs to know what is in the shipment',
    hsCode: `customs classifies ${n} by its HS code, and a missing code can hold the shipment${hsHint(n) ? ` (${hsHint(n)})` : ''}. I won't guess one`,
    quantity: 'the invoice and the value check use the quantity',
    unitPrice: 'the declared value is checked against quantity × unit price',
    unitsPerCarton: 'units per carton × cartons must equal the quantity',
    unitWeightKg: 'it lets me check that the gross weight is realistic',
    countryOfOrigin: 'customs wants to know where goods were made',
  };
  return `I need ${slotLabel(slot).toLowerCase()} because ${why[f] ?? 'the checks use it'}.`;
}

export function slotLabel(slot: Slot): string {
  const l: Record<string, string> = {
    sellerName: 'The seller name', originCity: 'The origin city', destinationCity: 'The destination city', destinationType: 'The destination type', pallets: 'The pallet count',
    cartons: 'The carton count', declaredValue: 'The declared value', grossWeightKg: 'The gross weight', readyDate: 'The ready date', appointmentBooked: 'The appointment status',
    priority: 'Your priority', description: 'The description', hsCode: 'The HS code', quantity: 'The quantity', unitPrice: 'The unit price', unitsPerCarton: 'Units per carton',
    unitWeightKg: 'The unit weight', countryOfOrigin: 'The country of origin',
  };
  return l[slot.field] ?? slot.field;
}

const INTRO: Record<Group, string> = {
  route: 'Let me get the route and delivery sorted.',
  goods: 'Now the goods.',
  packing: 'Next, how it is packed.',
  value: 'Now value and weight.',
  dateAppt: 'Now dates and delivery.',
  priority: 'Last one.',
};

export function calcText(proposals: CalcProposal[]): string {
  const booking = proposals.filter((p) => p.slot.scope === 'booking');
  const items = proposals.filter((p) => p.slot.scope === 'item');
  const parts: string[] = [];
  if (booking.length) parts.push(`Your items add up to ${booking.map((p) => p.text).join(' and ')}.`);
  for (const p of items) parts.push(`${p.text}.`);
  return `${parts.join(' ')} Use ${proposals.length > 1 ? 'these' : 'this'}?`;
}

export function questionsIntro(plan: Plan): string {
  return plan.group ? INTRO[plan.group] : '';
}

export function summaryLines(b: Booking): string[] {
  const lines = [
    `Seller: ${b.sellerName || '—'}`,
    `Route: ${describeRoute(b)}${b.destinationType ? ` (${b.destinationType}${b.destinationType === 'Warehouse' ? `, appointment ${b.appointmentBooked === null ? 'unknown' : b.appointmentBooked ? 'booked' : 'not booked'}` : ''})` : ''}`,
  ];
  for (const i of b.items) {
    const extra = [
      i.hsCodeRaw ? `HS ${i.hsCodeRaw}` : 'no HS code',
      i.unitsPerCarton !== null ? `${num(i.unitsPerCarton)} per carton` : '',
      i.cartons !== null ? `${num(i.cartons)} cartons` : '',
      i.unitWeightKg !== null ? `${num(i.unitWeightKg, 3)} kg each` : '',
      i.countryOfOrigin ? `made in ${i.countryOfOrigin}` : 'no country of origin',
    ].filter(Boolean);
    lines.push(`Item ${i.sku}: ${i.quantity === null ? '?' : num(i.quantity)} × ${i.description || '—'}${i.unitPrice !== null ? ` at ${gbp(i.unitPrice)}` : ''} (${extra.join(', ')})`);
  }
  lines.push(`Shipment: ${b.pallets === null ? '?' : num(b.pallets, 3)} pallets, ${b.cartons === null ? '?' : num(b.cartons, 3)} cartons, ${b.grossWeightKg === null ? '?' : num(b.grossWeightKg)} kg gross, declared ${b.declaredValue === null ? '?' : gbp(b.declaredValue)}`);
  lines.push(`Ready: ${b.readyDate ? longDate(b.readyDate) : '—'} · Priority: ${b.priority || '—'}`);
  return lines;
}

export function resultSummary(r: BookingResult): string {
  const red = r.findings.filter((f) => f.severity === 'Red');
  const amber = r.findings.filter((f) => f.severity === 'Amber');
  const parts = [`${r.status}: ${r.statusReason}`];
  if (red.length) parts.push(`Red: ${red.slice(0, 4).map((f) => (f.ruleId === 'DATA' ? f.problem : `${f.ruleId} ${f.problem}`)).join('; ')}${red.length > 4 ? '…' : ''}.`);
  if (amber.length) parts.push(`Amber: ${amber.slice(0, 4).map((f) => `${f.ruleId} ${f.problem}`).join('; ')}${amber.length > 4 ? '…' : ''}.`);
  if (r.recommendation) {
    const o = r.recommendation.option;
    parts.push(`${r.recommendation.provisional ? 'Provisional carrier' : 'Recommended carrier'}: ${o.label} at ${gbp(o.cost)}, estimated delivery ${longDate(o.eta)}.`);
  } else if (r.noRecommendationReason) parts.push(`No carrier yet: ${r.noRecommendationReason}`);
  return parts.join(' ');
}

export function offTopic(text: string): string {
  const t = text.toLowerCase();
  if (/\bhs\b|commodity code|tariff/.test(t)) return 'An HS code classifies a product for customs; you can look yours up on the UK Trade Tariff (gov.uk). Here it needs at least 6 digits.';
  if (/pallet/.test(t)) return 'A pallet is a platform holding many cartons; carriers price per pallet and limit the weight of each one.';
  if (/carton|box/.test(t)) return 'A carton is a box of units; the carton counts on your items must add up to the booking total.';
  if (/duty|vat|tax|customs/.test(t)) return 'Customs uses your HS codes and declared value. I check they are present and consistent, but I cannot calculate duty.';
  if (/carrier|price|cost|rate|cheap/.test(t)) return 'Carrier prices come from the fixed rate card (£160 to £340 per pallet depending on route and service); I pick one using your priority.';
  if (/who|what can you|help|what do you do/.test(t)) return "I'm Pre-Flight: I take a UK → Germany/France/Netherlands shipment, check it against the ten rules and recommend a carrier.";
  return 'I can only help with booking UK → Germany/France/Netherlands shipments.';
}
