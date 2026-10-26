import { ALL_DESTINATION_CITIES, CITY_ALIASES, COUNTRY_ALIASES, CURRENCY, DESTINATION_COUNTRIES, DESTINATION_TYPES, DESTINATION_TYPE_ALIASES, ITEM_COUNTRIES, ORIGIN_CITIES, ORIGIN_COUNTRY, PRIORITIES, PRIORITY_ALIASES } from '../config/allowedValues';
import type { Booking, Finding, FieldSource, Item } from '../model/types';
import { matchFixed } from '../util/text';
import type { BookingField, ColumnMap, ItemField } from './headerMatcher';
import type { IngestReport } from './ingestReport';
import { cleanHsCode, coerceDate, coerceNumber, coerceText, coerceYesNo, isBlank, normalizeBookingId, splitCombined, type Coerced } from './valueCoercers';
import type { RawRow, ReadSheets } from './workbookReader';

const dataF = (scope: string, field: string, problem: string, evidence: string, fix: string): Finding => ({ ruleId: 'DATA', severity: 'Red', scope, field, problem, evidence, fix });
const infoF = (scope: string, problem: string, evidence: string, fix = 'No action needed unless this is wrong.'): Finding => ({ ruleId: 'INFO', severity: 'Info', scope, problem, evidence, fix });

const first = (a: unknown, b: unknown) => (isBlank(a) ? b : a);

/** Read a numeric cell; non-numeric text becomes a DATA finding and null. */
function numCell(v: unknown, label: string, field: string, scope: string, row: number, findings: Finding[], hint: string): number | null {
  const c: Coerced<number> = coerceNumber(v);
  if (c.kind === 'ok') return c.value;
  if (c.kind === 'bad') {
    findings.push(dataF(scope, field, `${label} is not a number`, `Row ${row}: ${c.reason}.`, hint));
  }
  return null;
}

export interface AssembleOutput {
  bookings: Booking[];
  report: IngestReport;
}

export function assemble(read: ReadSheets): AssembleOutput {
  const report = read.report;
  if (report.errors.length) return { bookings: [], report };

  // Group booking rows by normalised id; the first wins.
  const groups = new Map<string, RawRow<BookingField>[]>();
  const order: string[] = [];
  for (const row of read.bookings) {
    let id = normalizeBookingId(row.get('bookingId'));
    if (!id) id = `ROW-${row.rowNumber}`;
    if (!groups.has(id)) order.push(id);
    groups.set(id, [...(groups.get(id) ?? []), row]);
  }

  const bookings = new Map<string, Booking>();
  for (const id of order) {
    const rows = groups.get(id)!;
    const b = buildBooking(id, rows[0]);
    if (rows.length > 1) {
      const rowNums = rows.map((r) => r.rowNumber);
      report.duplicateBookingIds.push({ bookingId: id, rows: rowNums });
      b.ingestFindings!.push(
        dataF('booking', 'bookingId', `Booking ID ${id} appears ${rows.length} times`, `Rows ${rowNums.join(', ')}. Only the first (row ${rowNums[0]}) was evaluated; the others were ignored.`, 'Give every shipment a unique Booking ID, or delete the duplicate rows.'),
      );
    }
    if (id.startsWith('ROW-')) {
      b.ingestFindings!.push(dataF('booking', 'bookingId', 'Booking ID is missing', `Row ${rows[0].rowNumber} has no Booking ID.`, 'Add a Booking ID so items can be matched to this booking.'));
    }
    bookings.set(id, b);
  }

  const itemCounters = new Map<string, number>();
  for (const row of read.items) {
    const id = normalizeBookingId(row.get('bookingId'));
    const sku = coerceText(first(row.get('sku'), splitCombined(row.get('skuDescription'))[0]));
    const b = id ? bookings.get(id) : undefined;
    if (!b) {
      report.orphanItems.push({ bookingId: id || '(blank)', sku: sku || '(no SKU)', row: row.rowNumber, file: row.file });
      continue;
    }
    const n = (itemCounters.get(id) ?? 0) + 1;
    itemCounters.set(id, n);
    b.items.push(buildItem(row, n, b.ingestFindings!));
  }
  // Duplicate SKUs inside one booking get a suffix so findings stay unambiguous.
  for (const b of bookings.values()) {
    const seen = new Map<string, number>();
    for (const i of b.items) {
      const k = i.sku.toLowerCase();
      const c = (seen.get(k) ?? 0) + 1;
      seen.set(k, c);
      if (c > 1) i.sku = `${i.sku} (#${c})`;
    }
  }
  report.bookingCount = bookings.size;
  report.itemCount = read.items.length - report.orphanItems.length;
  return { bookings: order.map((id) => bookings.get(id)!), report };
}

function buildBooking(id: string, row: RawRow<BookingField>): Booking {
  const findings: Finding[] = [];
  const src: Record<string, FieldSource> = {};
  const g = (f: BookingField) => row.get(f);
  const n = row.rowNumber;
  const scope = 'booking';

  // origin / destination: separate columns, or a combined "City · Country" column
  const [oc1, oco1] = splitCombined(g('originCombined'));
  const [dc1, dco1] = splitCombined(g('destinationCombined'));
  const oCityRaw = coerceText(first(g('originCity'), oc1));
  const oCountryRaw = coerceText(first(g('originCountry'), oco1));
  const dCityRaw = coerceText(first(g('destinationCity'), dc1));
  const dCountryRaw = coerceText(first(g('destinationCountry'), dco1));

  const fixed = (raw: string, list: readonly string[], aliases: Record<string, string>, label: string): string => {
    const m = matchFixed(raw, list, aliases);
    if (!m) return raw;
    if (m.how !== 'exact' && m.value !== raw) findings.push(infoF(scope, `${label} "${raw}" was read as "${m.value}"`, `Matched by ${m.how === 'alias' ? 'a known alias' : 'close spelling'}.`));
    return m.value;
  };

  const originCity = fixed(oCityRaw, ORIGIN_CITIES, CITY_ALIASES, 'Origin city');
  const originCountry = oCountryRaw ? fixed(oCountryRaw, [ORIGIN_COUNTRY], COUNTRY_ALIASES, 'Origin country') : ORIGIN_COUNTRY;
  if (!oCountryRaw) src.originCountry = 'inferred';
  const destinationCity = fixed(dCityRaw, ALL_DESTINATION_CITIES, CITY_ALIASES, 'Destination city');
  let destinationCountry = dCountryRaw ? fixed(dCountryRaw, DESTINATION_COUNTRIES, COUNTRY_ALIASES, 'Destination country') : '';
  if (!dCountryRaw) {
    // infer from a recognised city
    const known = DESTINATION_COUNTRIES.find((c) => (c === 'Germany' ? ['Berlin', 'Frankfurt', 'Hamburg'] : c === 'France' ? ['Paris', 'Lyon'] : ['Amsterdam', 'Rotterdam']).includes(destinationCity));
    if (known) {
      destinationCountry = known;
      src.destinationCountry = 'inferred';
    }
  }

  const destinationType = fixed(coerceText(g('destinationType')), DESTINATION_TYPES, DESTINATION_TYPE_ALIASES, 'Destination type');

  const dateCell = coerceDate(g('readyDate'));
  let readyDate: string | null = null;
  if (dateCell.kind === 'ok') readyDate = dateCell.value;
  else if (dateCell.kind === 'bad') findings.push(dataF(scope, 'readyDate', 'Ready to ship date is invalid', `Row ${n}: ${dateCell.reason}.`, 'Enter the date as DD-MM-YYYY (day first), e.g. 05-11-2026.'));

  let priority = fixed(coerceText(g('priority')), PRIORITIES, PRIORITY_ALIASES, 'Priority');
  if (!priority) {
    priority = 'Balanced';
    src.priority = 'default';
    findings.push(infoF(scope, 'Seller priority was blank, so Balanced was used', 'No priority given.', 'Set a priority if you prefer cheapest, fastest or most reliable.'));
  }

  const pallets = numCell(g('pallets'), 'Pallets', 'pallets', scope, n, findings, 'Enter the number of pallets as a whole number.');
  const cartons = numCell(g('cartons'), 'Cartons', 'cartons', scope, n, findings, 'Enter the total cartons as a whole number.');
  const declaredValue = numCell(g('declaredValue'), 'Total declared value', 'declaredValue', scope, n, findings, 'Enter the total value in GBP, e.g. 5400.');
  const grossWeightKg = numCell(g('grossWeightKg'), 'Total gross weight (kg)', 'grossWeightKg', scope, n, findings, 'Enter the weight in kilograms, e.g. 620.');

  let currency = coerceText(g('currency')).toUpperCase();
  if (currency === '£') currency = 'GBP';
  else if (currency === '€') currency = 'EUR';
  else if (currency === '$') currency = 'USD';
  if (!currency) {
    currency = CURRENCY;
    src.currency = 'default';
  }

  const yn = coerceYesNo(g('appointmentBooked'));
  let appointmentBooked: boolean | null;
  if (yn.kind === 'ok') appointmentBooked = yn.value;
  else if (yn.kind === 'blank') {
    appointmentBooked = false;
    src.appointmentBooked = 'default';
    if (destinationType === 'Warehouse') findings.push(infoF(scope, 'Delivery appointment was blank, so it is treated as "No"', 'No value was provided.', 'Enter Yes or No in the appointment column.'));
  } else {
    appointmentBooked = null;
    findings.push(dataF(scope, 'appointmentBooked', 'Delivery appointment is not Yes or No', `Row ${n}: ${yn.reason}.`, 'Use Yes or No.'));
  }

  for (const f of ['sellerName', 'originCity', 'destinationCity', 'destinationType', 'readyDate', 'pallets', 'cartons', 'declaredValue', 'grossWeightKg'] as const) {
    src[f] = src[f] ?? 'stated';
  }
  return {
    bookingId: id,
    sellerName: coerceText(g('sellerName')),
    originCity,
    originCountry,
    destinationCity,
    destinationCountry,
    destinationType,
    readyDate,
    priority,
    pallets,
    cartons,
    declaredValue,
    currency,
    grossWeightKg,
    appointmentBooked,
    items: [],
    fieldSources: src,
    ingestFindings: findings,
  };
}

function buildItem(row: RawRow<ItemField>, n: number, findings: Finding[]): Item {
  const g = (f: ItemField) => row.get(f);
  const [skuPart, descPart] = splitCombined(g('skuDescription'));
  let sku = coerceText(first(g('sku'), skuPart));
  if (!sku) sku = `ITEM-${n}`;
  const description = coerceText(first(g('description'), descPart));
  const hs = cleanHsCode(isBlank(g('hsCode')) ? null : g('hsCode'));
  const r = row.rowNumber;
  const num = (f: ItemField, label: string, field: string, hint: string) => numCell(g(f), label, field, sku, r, findings, hint);

  const cooRaw = coerceText(g('countryOfOrigin'));
  const coo = matchFixed(cooRaw, ITEM_COUNTRIES, COUNTRY_ALIASES);

  return {
    sku,
    description,
    hsCodeRaw: hs.raw,
    hsCodeDigits: hs.digits,
    hsCodeWasNumeric: hs.wasNumeric,
    quantity: num('quantity', `Item ${sku}: quantity`, 'quantity', 'Enter the number of units as a whole number.'),
    unitPrice: num('unitPrice', `Item ${sku}: unit price`, 'unitPrice', 'Enter the price of one unit in GBP.'),
    unitsPerCarton: num('unitsPerCarton', `Item ${sku}: units per carton`, 'unitsPerCarton', 'Enter units per carton as a whole number.'),
    cartons: num('cartons', `Item ${sku}: cartons`, 'cartons', 'Enter the number of cartons as a whole number.'),
    unitWeightKg: num('unitWeightKg', `Item ${sku}: unit weight (kg)`, 'unitWeightKg', 'Enter the weight of one unit in kilograms.'),
    countryOfOrigin: coo ? coo.value : cooRaw,
  };
}

export type { ColumnMap };
