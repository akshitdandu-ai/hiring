import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { coerceDate, coerceNumber, coerceYesNo, splitCombined, serialToIso } from '../src/ingest/valueCoercers';
import { normHeader } from '../src/ingest/headerMatcher';
import { evaluateFiles, evaluateGrids } from '../src/ingest';
import { buildSampleWorkbook, buildTemplateWorkbook } from '../src/ingest/sampleData';
import { gridsFromFile, parseCsv, type SheetGrid } from '../src/ingest/workbookReader';
import { cleanHsCode } from '../src/util/hs';
import { TODAY } from './fixtures';

describe('number coercion', () => {
  it.each([
    [5400, 5400], ['5400', 5400], ['5,400', 5400], ['£5,400.00', 5400], [' 5400 ', 5400], ['GBP 5400', 5400], ['0.5', 0.5], ['-3', -3],
  ])('%j → %j', (input, out) => expect(coerceNumber(input)).toEqual({ kind: 'ok', value: out }));
  it('blank', () => expect(coerceNumber('  ').kind).toBe('blank'));
  it.each(['abc', 'five', '12 pallets', '1.2.3'])('non-numeric %j is bad', (v) => expect(coerceNumber(v).kind).toBe('bad'));
});

describe('date coercion (always day-first)', () => {
  it.each([
    ['05-11-2026', '2026-11-05'],
    ['05/11/2026', '2026-11-05'],
    ['5-11-26', '2026-11-05'],
    ['5/11/26', '2026-11-05'],
    ['05.11.2026', '2026-11-05'],
    ['2026-11-05', '2026-11-05'],
    ['12-01-2026', '2026-01-12'], // not 1 December
  ])('%s → %s', (input, iso) => expect(coerceDate(input)).toEqual({ kind: 'ok', value: iso }));
  it('Excel serial number', () => {
    expect(serialToIso(46331)).toBe('2026-11-05');
    expect(coerceDate(46331)).toEqual({ kind: 'ok', value: '2026-11-05' });
  });
  it('JS Date object', () => expect(coerceDate(new Date(2026, 10, 5))).toEqual({ kind: 'ok', value: '2026-11-05' }));
  it.each(['31-02-2026', '13/13/2026', 'tomorrow', '00-01-2026'])('%s is invalid', (v) => expect(coerceDate(v).kind).toBe('bad'));
});

describe('yes/no, HS code and combined columns', () => {
  it.each([['Y', true], ['yes', true], ['TRUE', true], [true, true], ['N', false], ['no', false], ['FALSE', false]])('%j', (v, out) => expect(coerceYesNo(v)).toEqual({ kind: 'ok', value: out }));
  it('blank and junk', () => {
    expect(coerceYesNo('').kind).toBe('blank');
    expect(coerceYesNo('maybe').kind).toBe('bad');
  });
  it('HS formats', () => {
    expect(cleanHsCode(691200).digits).toBe('691200');
    expect(cleanHsCode('691200.0').digits).toBe('691200');
    expect(cleanHsCode('6912.00').digits).toBe('691200');
    expect(cleanHsCode('6912 00').digits).toBe('691200');
    expect(cleanHsCode('').digits).toBe('');
    expect(cleanHsCode(null).raw).toBe('');
    expect(cleanHsCode(69120)).toMatchObject({ digits: '69120', wasNumeric: true });
    expect(cleanHsCode('69A1').invalid).toBe(true);
  });
  it('splits on · | , -', () => {
    for (const sep of [' · ', ' | ', ', ', ' - ']) expect(splitCombined(`Manchester${sep}United Kingdom`)).toEqual(['Manchester', 'United Kingdom']);
    expect(splitCombined('Leeds')).toEqual(['Leeds', '']);
  });
  it('headers: punctuation, case and (kg) variants', () => {
    expect(normHeader('  Total GROSS weight (kg) ')).toBe('total gross weight kg');
    expect(normHeader('Origin city · Origin country')).toBe('origin city origin country');
  });
});

const BH = ['Booking ID', 'Seller name', 'Origin city', 'Origin country', 'Destination city', 'Destination country', 'Destination type', 'Ready to ship date', 'Seller priority', 'Pallets', 'Cartons', 'Total declared value', 'Currency', 'Total gross weight (kg)', 'Delivery appointment booked'];
const IH = ['Booking ID', 'SKU', 'Description', 'HS code', 'Quantity (units)', 'Unit price', 'Units per carton', 'Cartons', 'Unit weight (kg)', 'Country of origin'];
const bRow = ['bk-001 ', ' Northfield Goods', 'manchester', 'UK', 'Frankfort', 'DE', 'warehouse', '05-11-2026', 'cheapest', ' 3 ', '90', '£5,400.00', 'gbp', '620', 'Y'];
const iRow = ['BK-001', 'MUG-01', 'Ceramic coffee mug', 691200.0, '1,080', '5.00', 12, 90, 0.5, 'uk'];
const grid = (sheet: string, rows: unknown[][], file = 'f.xlsx', firstRow = 1): SheetGrid => ({ file, sheet, firstRow, rows });

describe('sheet identification and messy files', () => {
  it('finds sheets by headers, not names or order; header row not on row 1; skips empty rows', () => {
    const r = evaluateGrids(
      [
        grid('Data B', [['Items for the quarter'], ['(notes)'], IH, iRow, [null, '', null], iRow.map((c) => (c === 'MUG-01' ? 'MUG-02' : c))]),
        grid('Zzz', [['Bookings export'], [], [], BH, bRow, [], []]),
        grid('Glossary', [['Sheet', 'Column', 'What it means'], ['Bookings', 'x', 'y']]),
      ],
      TODAY,
    );
    expect(r.report.errors).toEqual([]);
    expect(r.report.bookingsSheet).toBe('Zzz');
    expect(r.report.itemsSheet).toBe('Data B');
    expect(r.report.ignoredSheets).toContain('Glossary');
    expect(r.results).toHaveLength(1);
    const b = r.results[0].booking;
    expect(b.bookingId).toBe('BK-001'); // trimmed + upper-cased
    expect(b.items).toHaveLength(2);
    expect(b.destinationCity).toBe('Frankfurt'); // alias
    expect(b.destinationCountry).toBe('Germany'); // alias
    expect(b.originCountry).toBe('United Kingdom');
    expect(b.items[0].quantity).toBe(1080);
    expect(b.items[0].countryOfOrigin).toBe('United Kingdom');
    expect(r.report.emptyRowsSkipped).toBeGreaterThan(0);
    // two identical items double the cartons, so only R-04 (and the weight check) may complain
    expect(r.results[0].findings.filter((f) => f.ruleId === 'DATA' || ['R-01', 'R-03', 'R-06'].includes(f.ruleId))).toEqual([]);
  });

  it('accepts a combined "City · Country" column', () => {
    const bh = BH.filter((h) => !['Origin country', 'Destination country', 'Origin city', 'Destination city'].includes(h));
    const row = [...bRow];
    const head = ['Booking ID', 'Seller name', 'Origin city · Origin country', 'Destination city · Destination country', ...bh.slice(2)];
    const data = ['BK-001', 'Northfield', 'Manchester · United Kingdom', 'Frankfurt | Germany', 'Warehouse', '05-11-2026', 'Cheapest', 3, 90, 5400, 'GBP', 620, 'Yes'];
    void row;
    const r = evaluateGrids([grid('A', [head, data]), grid('B', [IH, iRow])], TODAY);
    expect(r.results[0].booking.originCity).toBe('Manchester');
    expect(r.results[0].booking.destinationCountry).toBe('Germany');
  });

  it('duplicate booking id → DATA finding, first evaluated; orphans listed; no-item bookings flagged', () => {
    const r = evaluateGrids(
      [
        grid('Bookings', [BH, bRow, [...bRow.slice(0, 1), 'Other seller', ...bRow.slice(2)], ['BK-002', 'No items Ltd', ...bRow.slice(2)]]),
        grid('Items', [IH, iRow, ['BK-404', 'X', 'Orphan', 123456, 1, 1, 1, 1, 1, 'China']]),
      ],
      TODAY,
    );
    expect(r.results).toHaveLength(2);
    expect(r.results[0].booking.sellerName).toBe('Northfield Goods');
    expect(r.results[0].findings.some((f) => f.ruleId === 'DATA' && f.problem.includes('appears 2 times'))).toBe(true);
    expect(r.report.orphanItems).toMatchObject([{ bookingId: 'BK-404', sku: 'X', row: 3 }]);
    expect(r.results[1].findings.some((f) => f.problem.includes('No items'))).toBe(true);
    expect(r.results[1].couldNotCheck.map((c) => c.ruleId)).toContain('R-01');
  });

  it('bad numbers, bad dates, invalid lists, blank priority/appointment — never crashes the batch', () => {
    const bad = ['BK-001', 'S', 'Manchester', 'United Kingdom', 'Köln', 'Germany', 'Home', '32/13/2026', '', 'three', '90', 'lots', 'EUR', '620kg??', ''];
    const good = ['BK-002', ...bRow.slice(1)];
    const r = evaluateGrids([grid('Bookings', [BH, bad, good]), grid('Items', [IH, ['BK-001', 'A', 'thing', 'abc', 'x', 5, 0, -1, 0.5, 'Spain'], ['BK-002', ...iRow.slice(1)]])], TODAY);
    expect(r.results).toHaveLength(2);
    const f = r.results[0].findings;
    expect(f.some((x) => x.field === 'pallets' && x.problem.includes('not a number'))).toBe(true);
    expect(f.some((x) => x.field === 'readyDate')).toBe(true);
    expect(f.some((x) => x.field === 'destinationCity' && x.fix.includes('Berlin, Frankfurt, Hamburg'))).toBe(true);
    expect(f.some((x) => x.field === 'destinationType')).toBe(true);
    expect(f.some((x) => x.field === 'currency')).toBe(true);
    expect(f.some((x) => x.field === 'quantity')).toBe(true);
    expect(f.some((x) => x.field === 'unitsPerCarton')).toBe(true);
    expect(f.some((x) => x.field === 'countryOfOrigin' && x.fix.includes('United Kingdom, China'))).toBe(true);
    expect(r.results[0].booking.priority).toBe('Balanced');
    expect(r.results[0].booking.fieldSources.priority).toBe('default');
    expect(r.results[0].status).toBe('Blocked');
    expect(r.results[1].status).toBe('Ready');
  });

  it('blank appointment is treated as No and reported', () => {
    const row = [...bRow];
    row[14] = '';
    const r = evaluateGrids([grid('Bookings', [BH, row]), grid('Items', [IH, iRow])], TODAY);
    expect(r.results[0].findings.some((f) => f.ruleId === 'R-08')).toBe(true);
    expect(r.results[0].findings.some((f) => f.ruleId === 'INFO' && f.problem.includes('appointment'))).toBe(true);
  });

  it('HS code arriving as numbers and floats', () => {
    const items = [691200, 691200.0, '6912.00', 69120, ''].map((hs, n) => ['BK-001', `S${n}`, 'Mug', hs, 12, 5, 12, 1, 0.5, 'UK']);
    const r = evaluateGrids([grid('Bookings', [BH, ['BK-001', ...bRow.slice(1, 11), 300, ...bRow.slice(12)]]), grid('Items', [IH, ...items])], TODAY);
    const hs = r.results[0].findings.filter((f) => f.ruleId === 'R-01');
    expect(hs.map((f) => f.scope).sort()).toEqual(['S3', 'S4']);
    expect(hs.find((f) => f.scope === 'S3')!.evidence).toContain('leading zero');
  });

  it('friendly error when no sheet matches', () => {
    const r = evaluateGrids([grid('Sheet1', [['a', 'b'], [1, 2]])], TODAY);
    expect(r.results).toEqual([]);
    expect(r.report.errors[0]).toContain('Bookings sheet');
  });

  it('no file at all / unreadable file does not throw', () => {
    expect(evaluateFiles([], TODAY).report.errors.length).toBeGreaterThan(0);
    const r = evaluateFiles([{ name: 'x.xlsx', data: new TextEncoder().encode('not a workbook').buffer as ArrayBuffer }], TODAY);
    expect(r.results).toEqual([]);
  });
});

describe('CSV', () => {
  it('parses quotes, CRLF and BOM without converting types', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n05-11-2026,001')).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['05-11-2026', '001']]);
  });
  it('two CSV files work like one workbook', () => {
    const csv = (rows: unknown[][]) => rows.map((r) => r.map((c) => (String(c).includes(',') ? `"${c}"` : c)).join(',')).join('\n');
    const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
    const r = evaluateFiles([{ name: 'items.csv', data: enc(csv([IH, iRow])) }, { name: 'bookings.csv', data: enc(csv([BH, bRow])) }], TODAY);
    expect(r.report.errors).toEqual([]);
    expect(r.results).toHaveLength(1);
    expect(r.results[0].status).toBe('Ready');
  });
});

describe('sample workbook (round-trips through a real .xlsx file)', () => {
  const run = () => evaluateFiles([{ name: 'sample.xlsx', data: buildSampleWorkbook(TODAY) }], TODAY);
  const by = (id: string) => run().results.find((r) => r.booking.bookingId === id)!;
  const rules = (id: string) => [...new Set(by(id).findings.filter((f) => f.severity !== 'Info').map((f) => f.ruleId))].sort();

  it('evaluates all ten bookings and ignores the rate card / rulebook sheets', () => {
    const r = run();
    expect(r.results).toHaveLength(10);
    expect(r.report.ignoredSheets.sort()).toEqual(['Carrier options', 'Rulebook']);
    expect(r.report.orphanItems.map((o) => o.bookingId)).toEqual(['BK-099']);
  });
  it('BK-001 is clean and Ready', () => {
    expect(by('BK-001').status).toBe('Ready');
    expect(by('BK-001').recommendation?.option.label).toBe('Carrier A Road economy');
  });
  it('each planted error is caught by the right rule', () => {
    expect(rules('BK-002')).toEqual(['R-01']);
    expect(rules('BK-003')).toEqual(['R-02']);
    expect(rules('BK-004')).toEqual(['R-03']);
    expect(rules('BK-005')).toEqual(['R-04']);
    expect(rules('BK-006')).toEqual(['R-05']);
    expect(rules('BK-007')).toEqual(['R-06']);
    expect(rules('BK-008')).toEqual(['R-01', 'R-02', 'R-03', 'R-04', 'R-07', 'R-08', 'R-09', 'R-10']);
    expect(rules('BK-009')).toEqual(['DATA']);
    expect(rules('BK-010')).toEqual(['R-08', 'R-09']);
  });
  it('BK-007 flags the power bank but not the battery-free torch', () => {
    const f = by('BK-007').findings.filter((x) => x.ruleId === 'R-06');
    expect(f.map((x) => x.scope)).toEqual(['PWR-01']);
  });
  it('BK-009 reports bad date, pallets = 0 and the Paris/Germany mismatch', () => {
    const f = by('BK-009').findings;
    expect(f.some((x) => x.field === 'readyDate')).toBe(true);
    expect(f.some((x) => x.field === 'pallets')).toBe(true);
    expect(f.some((x) => x.problem.includes('Paris is in France'))).toBe(true);
    expect(by('BK-009').status).toBe('Blocked');
  });
  it('BK-010 is Needs attention', () => expect(by('BK-010').status).toBe('Needs attention'));
  it('BK-006 suggests more pallets', () => {
    const f = by('BK-006').findings.find((x) => x.ruleId === 'R-05')!;
    expect(f.fix).toContain('at least 3 pallets');
  });
  it('the template has headers + one example row and reads back as one clean booking', () => {
    const r = evaluateFiles([{ name: 'template.xlsx', data: buildTemplateWorkbook(TODAY) }], TODAY);
    expect(r.results).toHaveLength(1);
    expect(r.results[0].status).toBe('Ready');
  });
  it('gridsFromFile keeps sheet order and numeric cells as numbers', () => {
    const g = gridsFromFile('s.xlsx', buildSampleWorkbook(TODAY));
    expect(g.map((x) => x.sheet)).toEqual(['Bookings', 'Items', 'Carrier options', 'Rulebook']);
    expect(g[1].rows[2][3]).toBe(691200);
  });
  it('an .xls binary also reads', () => {
    const wb = XLSX.read(buildSampleWorkbook(TODAY), { type: 'array' });
    const xls = XLSX.write(wb, { type: 'array', bookType: 'biff8' }) as ArrayBuffer;
    const r = evaluateFiles([{ name: 'sample.xls', data: xls }], TODAY);
    expect(r.results).toHaveLength(10);
  });
});
