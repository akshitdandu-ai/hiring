import { ALL_DESTINATION_CITIES, CITY_TO_COUNTRY, CURRENCY, DESTINATION_COUNTRIES, DESTINATION_TYPES, ITEM_COUNTRIES, ORIGIN_CITIES, ORIGIN_COUNTRY, PRIORITIES } from '../config/allowedValues';
import type { Booking, Finding, Item } from '../model/types';
import { listOr, norm } from '../util/text';
import { num } from '../util/format';

const data = (scope: string, field: string, problem: string, evidence: string, fix: string): Finding => ({
  ruleId: 'DATA',
  severity: 'Red',
  scope,
  field,
  problem,
  evidence,
  fix,
});

const blank = (s: string) => norm(s) === '';
const isNum = (n: number | null): n is number => typeof n === 'number' && Number.isFinite(n);

const SUPPORTED_ORIGINS = `Supported origin cities: ${listOr(ORIGIN_CITIES)}.`;
const SUPPORTED_DESTS = `Supported destinations: Germany (Berlin, Frankfurt, Hamburg), France (Paris, Lyon), Netherlands (Amsterdam, Rotterdam).`;

function cityKey(city: string): string | undefined {
  return Object.keys(CITY_TO_COUNTRY).find((c) => norm(c) === norm(city));
}

function checkCount(out: Finding[], scope: string, field: string, label: string, v: number | null, opts: { allowZero?: boolean; integer?: boolean }) {
  if (v === null) return out.push(data(scope, field, `${label} is missing`, 'No value was provided.', `Enter ${label.toLowerCase()} as a number.`));
  if (!isNum(v)) return out.push(data(scope, field, `${label} is not a number`, String(v), 'Enter a number.'));
  if (v < 0 || (!opts.allowZero && v === 0)) {
    return out.push(data(scope, field, `${label} must be ${opts.allowZero ? 'zero or more' : 'greater than zero'}`, `Got ${num(v)}.`, `Correct ${label.toLowerCase()}.`));
  }
  if (opts.integer && !Number.isInteger(v)) {
    out.push(data(scope, field, `${label} must be a whole number`, `Got ${num(v, 3)}.`, `Use a whole number (you cannot ship part of a ${label.toLowerCase().includes('pallet') ? 'pallet' : 'unit'}).`));
  }
}

/** Data problems that are not rule breaks: missing, impossible or unsupported values. Shared by file and chat. */
export function validateBooking(b: Booking): Finding[] {
  const out: Finding[] = [];

  if (blank(b.sellerName)) out.push(data('booking', 'sellerName', 'Seller name is missing', 'No value was provided.', 'Enter the name of the business sending the goods.'));

  // origin
  if (blank(b.originCity)) out.push(data('booking', 'originCity', 'Origin city is missing', 'No value was provided.', SUPPORTED_ORIGINS));
  else if (!(ORIGIN_CITIES as readonly string[]).some((c) => norm(c) === norm(b.originCity))) {
    const known = cityKey(b.originCity);
    out.push(
      data('booking', 'originCity', `"${b.originCity}" is not a supported origin city`, known ? `${known} is in ${CITY_TO_COUNTRY[known]}.` : 'Not in the supported list.', SUPPORTED_ORIGINS),
    );
  }
  if (!blank(b.originCountry) && norm(b.originCountry) !== norm(ORIGIN_COUNTRY)) {
    out.push(data('booking', 'originCountry', `Origin country "${b.originCountry}" is not supported`, 'Only collections from the United Kingdom are supported.', 'Set the origin country to United Kingdom.'));
  }

  // destination
  const destCityOk = ALL_DESTINATION_CITIES.some((c) => norm(c) === norm(b.destinationCity));
  if (blank(b.destinationCity)) out.push(data('booking', 'destinationCity', 'Destination city is missing', 'No value was provided.', SUPPORTED_DESTS));
  else if (!destCityOk) {
    const known = cityKey(b.destinationCity);
    out.push(
      data(
        'booking',
        'destinationCity',
        `"${b.destinationCity}" is not a supported destination city`,
        known ? `${known} is in ${CITY_TO_COUNTRY[known]}, which is not a destination we serve.` : 'Not in the supported list.',
        SUPPORTED_DESTS,
      ),
    );
  }
  if (!blank(b.destinationCountry) && !DESTINATION_COUNTRIES.some((c) => norm(c) === norm(b.destinationCountry))) {
    out.push(data('booking', 'destinationCountry', `Destination country "${b.destinationCountry}" is not supported`, 'Not in the supported list.', SUPPORTED_DESTS));
  } else if (destCityOk && !blank(b.destinationCountry)) {
    const real = CITY_TO_COUNTRY[cityKey(b.destinationCity)!];
    if (norm(real) !== norm(b.destinationCountry)) {
      out.push(
        data(
          'booking',
          'destinationCountry',
          `${cityKey(b.destinationCity)} is in ${real}, not ${b.destinationCountry}`,
          `City "${b.destinationCity}" and country "${b.destinationCountry}" do not match.`,
          `Change the destination country to ${real}, or pick a city in ${b.destinationCountry}.`,
        ),
      );
    }
  }

  if (blank(b.destinationType)) out.push(data('booking', 'destinationType', 'Destination type is missing', 'No value was provided.', `Choose one of: ${listOr(DESTINATION_TYPES)}.`));
  else if (!(DESTINATION_TYPES as readonly string[]).includes(b.destinationType)) {
    out.push(data('booking', 'destinationType', `Destination type "${b.destinationType}" is not allowed`, 'Not in the allowed list.', `Choose one of: ${listOr(DESTINATION_TYPES)}.`));
  }

  if (b.readyDate === null) out.push(data('booking', 'readyDate', 'Ready to ship date is missing or invalid', 'No valid date was provided.', 'Enter the date as DD-MM-YYYY (day first), e.g. 05-11-2026.'));

  if (blank(b.priority)) out.push(data('booking', 'priority', 'Seller priority is missing', 'No value was provided.', `Choose one of: ${listOr(PRIORITIES)}.`));
  else if (!(PRIORITIES as readonly string[]).includes(b.priority)) {
    out.push(data('booking', 'priority', `Seller priority "${b.priority}" is not allowed`, 'Not in the allowed list.', `Choose one of: ${listOr(PRIORITIES)}.`));
  }

  checkCount(out, 'booking', 'pallets', 'Pallets', b.pallets, { integer: true });
  checkCount(out, 'booking', 'cartons', 'Cartons', b.cartons, { allowZero: true, integer: true });
  if (b.declaredValue === null) out.push(data('booking', 'declaredValue', 'Total declared value is missing', 'No value was provided.', 'Enter the total value of the goods in GBP.'));
  else if (isNum(b.declaredValue) && b.declaredValue < 0) out.push(data('booking', 'declaredValue', 'Total declared value cannot be negative', `Got ${num(b.declaredValue)}.`, 'Enter the total value of the goods in GBP.'));
  checkCount(out, 'booking', 'grossWeightKg', 'Total gross weight (kg)', b.grossWeightKg, {});

  if (!blank(b.currency) && b.currency.trim().toUpperCase() !== CURRENCY) {
    out.push(data('booking', 'currency', `Currency "${b.currency}" is not supported`, 'Only GBP is supported.', 'Convert the values to GBP and set the currency to GBP.'));
  }
  if (b.destinationType === 'Warehouse' && b.appointmentBooked === null) {
    out.push(data('booking', 'appointmentBooked', 'Delivery appointment answer is missing', 'No value was provided.', 'Say whether a delivery slot is booked (Yes / No).'));
  }

  if (b.items.length === 0) {
    out.push(data('booking', 'items', 'No items found for this booking', 'The booking has no item rows.', 'Add at least one item (SKU, description, HS code, quantity, unit price, units per carton, cartons, unit weight, country of origin).'));
  }
  b.items.forEach((i) => validateItem(i, out));
  return out;
}

function validateItem(i: Item, out: Finding[]) {
  const s = i.sku;
  if (blank(i.description)) out.push(data(s, 'description', `Item ${s}: description is missing`, 'No value was provided.', 'Add a plain description of the product.'));
  checkCount(out, s, 'quantity', `Item ${s}: quantity`, i.quantity, { integer: true });
  if (i.unitPrice === null) out.push(data(s, 'unitPrice', `Item ${s}: unit price is missing`, 'No value was provided.', 'Enter the price of one unit in GBP.'));
  else if (isNum(i.unitPrice) && i.unitPrice < 0) out.push(data(s, 'unitPrice', `Item ${s}: unit price cannot be negative`, `Got ${num(i.unitPrice)}.`, 'Enter the price of one unit in GBP.'));
  checkCount(out, s, 'unitsPerCarton', `Item ${s}: units per carton`, i.unitsPerCarton, { integer: true });
  checkCount(out, s, 'cartons', `Item ${s}: cartons`, i.cartons, { allowZero: true, integer: true });
  checkCount(out, s, 'unitWeightKg', `Item ${s}: unit weight (kg)`, i.unitWeightKg, {});
  const c = i.countryOfOrigin;
  const unknownish = ['', 'n/a', 'na', '-', '–', 'unknown', 'none', '?'].includes(norm(c));
  if (!unknownish && !(ITEM_COUNTRIES as readonly string[]).some((x) => norm(x) === norm(c))) {
    out.push(data(s, 'countryOfOrigin', `Item ${s}: country of origin "${c}" is not in the allowed list`, 'Not in the allowed list.', `Use one of: ${listOr(ITEM_COUNTRIES)}.`));
  }
}
