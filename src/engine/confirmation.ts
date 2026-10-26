import type { Booking, BookingStatus, CarrierOption, Finding, PalletSuggestion, Recommendation } from '../model/types';
import { gbp, longDate, num } from '../util/format';
import { routeCountry } from './carrierEngine';

export function describeRoute(b: Booking): string {
  const from = [b.originCity, b.originCountry || 'United Kingdom'].filter(Boolean).join(', ');
  const to = [b.destinationCity, routeCountry(b) ?? b.destinationCountry].filter(Boolean).join(', ');
  return `${from || 'origin not set'} → ${to || 'destination not set'}`;
}

export function describeGoods(b: Booking): string {
  if (!b.items.length) return 'no items listed';
  return b.items.map((i) => `${i.quantity === null ? '?' : num(i.quantity)} × ${i.description || i.sku}${i.hsCodeDigits ? ` (HS ${i.hsCodeDigits})` : ''}`).join('; ');
}

export interface ConfirmationInput {
  booking: Booking;
  status: BookingStatus;
  statusReason: string;
  findings: Finding[];
  recommendation: Recommendation | null;
  palletSuggestion: PalletSuggestion | null;
  noRecommendationReason: string | null;
}

export function buildConfirmation(i: ConfirmationInput): string {
  const b = i.booking;
  const lines: string[] = [];
  lines.push(`Booking ${b.bookingId}${b.sellerName ? ` for ${b.sellerName}` : ''}`);
  lines.push(`Status: ${i.status} — ${i.statusReason}`);
  lines.push(`Route: ${describeRoute(b)}${b.destinationType ? ` (${b.destinationType.toLowerCase()} delivery)` : ''}`);
  lines.push(`Goods: ${describeGoods(b)}`);
  lines.push(
    `Shipment: ${b.pallets === null ? '?' : num(b.pallets)} pallet${b.pallets === 1 ? '' : 's'}, ${b.cartons === null ? '?' : num(b.cartons)} carton${b.cartons === 1 ? '' : 's'}, ${b.grossWeightKg === null ? '?' : num(b.grossWeightKg)} kg gross weight`,
  );
  lines.push(`Declared value: ${b.declaredValue === null ? 'not provided' : gbp(b.declaredValue)}`);
  const r = i.recommendation;
  if (r) lines.push(carrierLine(r.option, r.provisional, b));
  else lines.push(`Carrier: none yet — ${i.noRecommendationReason ?? 'cannot choose a carrier'}${i.palletSuggestion ? ` Suggestion: ${i.palletSuggestion.palletsNeeded} pallets with ${i.palletSuggestion.option.label} (${gbp(i.palletSuggestion.cost)}).` : ''}`);
  const red = i.findings.filter((f) => f.severity === 'Red').length;
  const amber = i.findings.filter((f) => f.severity === 'Amber').length;
  lines.push(`Checks: ${red} red, ${amber} amber`);
  return lines.join('\n');
}

function carrierLine(o: CarrierOption, provisional: boolean, b: Booking): string {
  return `Carrier: ${o.label} — ${gbp(o.cost)} (${gbp(o.pricePerPallet)} per pallet)${provisional ? ' [provisional: fix the red issues before booking]' : ''}. Collection: ${b.readyDate ? longDate(b.readyDate) : 'date not set'}. Estimated delivery: ${longDate(o.eta)} (estimated, calendar days).`;
}

export function buildNextSteps(status: BookingStatus, b: Booking, rec: Recommendation | null): string[] {
  if (status === 'Blocked') {
    return ['Nothing is booked yet. Fix the red items (chat: just tell me the change; file: correct and re-upload).'];
  }
  const carrier = rec?.option.label ?? 'the carrier';
  const date = b.readyDate ? longDate(b.readyDate) : 'your ready date';
  const eta = rec ? longDate(rec.option.eta) : 'the estimated date';
  const steps = [
    `We'll request collection from ${carrier} on ${date}.`,
    `Label every carton with ${b.bookingId} and its carton number (e.g. 1 of ${b.cartons ?? '90'}).`,
    'A commercial invoice is prepared from your item list.',
    'Customs clearance uses your HS codes and declared value.',
    `Track the shipment until delivery on ${eta}.`,
  ];
  if (status === 'Needs attention') steps.push('Resolve the amber items to avoid delays.');
  return steps;
}
