import * as XLSX from 'xlsx';
import { BOOKING_HEADERS, ITEM_HEADERS, findHeaderRow, type BookingField, type ColumnMap, type ItemField } from './headerMatcher';
import { isBlank } from './valueCoercers';
import { emptyReport, type IngestReport } from './ingestReport';

export interface SheetGrid {
  file: string;
  sheet: string;
  /** Row index 0 is sheet row `firstRow`. */
  firstRow: number;
  rows: unknown[][];
}

export interface RawRow<F extends string> {
  /** 1-based spreadsheet row number, for messages. */
  rowNumber: number;
  file: string;
  get(field: F): unknown;
}

export interface ReadSheets {
  bookings: RawRow<BookingField>[];
  items: RawRow<ItemField>[];
  bookingMap: ColumnMap<BookingField> | null;
  itemMap: ColumnMap<ItemField> | null;
  report: IngestReport;
}

/** Minimal CSV parser: quotes, escaped quotes, CRLF, BOM, comma / semicolon / tab. Never type-converts. */
export function parseCsv(text: string): unknown[][] {
  const t = text.replace(/^﻿/, '');
  const firstLine = t.split(/\r?\n/, 1)[0] ?? '';
  const delim = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Turn an uploaded file into one grid per sheet. */
export function gridsFromFile(name: string, data: ArrayBuffer): SheetGrid[] {
  if (/\.csv$/i.test(name) || /\.txt$/i.test(name)) {
    const text = new TextDecoder('utf-8').decode(data);
    return [{ file: name, sheet: name, firstRow: 1, rows: parseCsv(text) }];
  }
  const wb = XLSX.read(data, { type: 'array' });
  return wb.SheetNames.map((sheet) => {
    const ws = wb.Sheets[sheet];
    const ref = ws['!ref'];
    const firstRow = ref ? XLSX.utils.decode_range(ref).s.r + 1 : 1;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: true });
    return { file: name, sheet, firstRow, rows };
  });
}

const rowIsEmpty = (cells: unknown[]) => cells.every(isBlank);

/** Find the Bookings and Items sheets by their headers (not by name or order). */
export function readSheets(grids: SheetGrid[]): ReadSheets {
  const report = emptyReport();
  report.files = [...new Set(grids.map((g) => g.file))];

  let bk: { g: SheetGrid; hit: NonNullable<ReturnType<typeof findHeaderRow<BookingField>>> } | null = null;
  let it: { g: SheetGrid; hit: NonNullable<ReturnType<typeof findHeaderRow<ItemField>>> } | null = null;
  for (const g of grids) {
    const b = findHeaderRow<BookingField>(g.rows, BOOKING_HEADERS, ['bookingId', 'pallets']);
    const i = findHeaderRow<ItemField>(g.rows, ITEM_HEADERS, ['bookingId', 'quantity']);
    // A sheet is whichever table its headers fit better.
    const bScore = b ? b.matched + (b.map.declaredValue !== undefined ? 3 : 0) : -1;
    const iScore = i ? i.matched + (i.map.unitPrice !== undefined ? 3 : 0) : -1;
    if (b && bScore >= iScore && (!bk || b.matched > bk.hit.matched)) {
      if (bk) report.ignoredSheets.push(`${bk.g.sheet}`);
      bk = { g, hit: b };
    } else if (i && (!it || i.matched > it.hit.matched)) {
      if (it) report.ignoredSheets.push(`${it.g.sheet}`);
      it = { g, hit: i };
    } else report.ignoredSheets.push(g.sheet);
  }
  report.bookingsSheet = bk ? bk.g.sheet : null;
  report.itemsSheet = it ? it.g.sheet : null;
  report.ignoredSheets = report.ignoredSheets.filter((s) => s !== report.bookingsSheet && s !== report.itemsSheet);

  if (!bk) report.errors.push('Could not find a Bookings sheet. Expected a header row (within the first 10 rows) with columns such as Booking ID, Seller name, Pallets, Cartons and Total declared value.');
  if (!it) report.errors.push('Could not find an Items sheet. Expected a header row (within the first 10 rows) with columns such as Booking ID, SKU, Description, Quantity (units) and Unit price.');

  const extract = <F extends string>(src: { g: SheetGrid; hit: { headerRow: number; map: ColumnMap<F> } } | null): RawRow<F>[] => {
    if (!src) return [];
    const out: RawRow<F>[] = [];
    for (let r = src.hit.headerRow + 1; r < src.g.rows.length; r++) {
      const cells = src.g.rows[r] ?? [];
      if (rowIsEmpty(cells)) {
        report.emptyRowsSkipped++;
        continue;
      }
      out.push({
        rowNumber: src.g.firstRow + r,
        file: src.g.file,
        get: (f: F) => {
          const c = src.hit.map[f];
          return c === undefined ? undefined : cells[c];
        },
      });
    }
    return out;
  };

  const warnMissing = <F extends string>(label: string, map: ColumnMap<F>, wanted: Array<[F, string]>) => {
    for (const [f, text] of wanted) if (map[f] === undefined) report.warnings.push(`${label}: no "${text}" column found, so that value is treated as missing.`);
  };
  if (bk) {
    const m = bk.hit.map;
    const wantBk: Array<[BookingField, string]> = [
      ['sellerName', 'Seller name'], ['destinationType', 'Destination type'], ['readyDate', 'Ready to ship date'], ['priority', 'Seller priority'],
      ['pallets', 'Pallets'], ['cartons', 'Cartons'], ['declaredValue', 'Total declared value'], ['grossWeightKg', 'Total gross weight (kg)'], ['appointmentBooked', 'Delivery appointment booked'],
    ];
    warnMissing('Bookings', m, wantBk);
    if (m.originCity === undefined && m.originCombined === undefined) report.warnings.push('Bookings: no origin city column found.');
    if (m.destinationCity === undefined && m.destinationCombined === undefined) report.warnings.push('Bookings: no destination city column found.');
  }
  if (it) {
    const m = it.hit.map;
    warnMissing('Items', m, [
      ['hsCode', 'HS code'], ['unitPrice', 'Unit price'], ['unitsPerCarton', 'Units per carton'], ['cartons', 'Cartons'], ['unitWeightKg', 'Unit weight (kg)'], ['countryOfOrigin', 'Country of origin'],
    ]);
    if (m.sku === undefined && m.skuDescription === undefined) report.warnings.push('Items: no SKU column found; SKUs are numbered ITEM-1, ITEM-2…');
    if (m.description === undefined && m.skuDescription === undefined) report.warnings.push('Items: no Description column found.');
  }

  return {
    bookings: extract<BookingField>(bk),
    items: extract<ItemField>(it),
    bookingMap: bk?.hit.map ?? null,
    itemMap: it?.hit.map ?? null,
    report,
  };
}
