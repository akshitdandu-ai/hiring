import { addDays, format } from 'date-fns';
import * as XLSX from 'xlsx';
import { CARRIER_RATES } from '../config/carriers';
import { RULEBOOK } from '../config/rulebook';

const BOOKING_HEADERS = [
  'Booking ID', 'Seller name', 'Origin city', 'Origin country', 'Destination city', 'Destination country', 'Destination type',
  'Ready to ship date', 'Seller priority', 'Pallets', 'Cartons', 'Total declared value', 'Currency', 'Total gross weight (kg)', 'Delivery appointment booked',
];
const ITEM_HEADERS = ['Booking ID', 'SKU', 'Description', 'HS code', 'Quantity (units)', 'Unit price', 'Units per carton', 'Cartons', 'Unit weight (kg)', 'Country of origin'];

type Cell = string | number | null;

const d = (today: Date, days: number, fmt = 'dd-MM-yyyy') => format(addDays(today, days), fmt);

function bookingRows(today: Date): Cell[][] {
  const UK = 'United Kingdom';
  return [
    // clean
    ['BK-001', 'Northfield Goods', 'Manchester', UK, 'Frankfurt', 'Germany', 'Warehouse', d(today, 10), 'Cheapest', 3, 90, 5400, 'GBP', 620, 'Yes'],
    // R-01 missing + short HS code
    ['BK-002', 'Harbour Textiles', 'Leeds', UK, 'Paris', 'France', 'Business address', d(today, 5), 'Fastest', 2, 40, 8000, 'GBP', 260, 'No'],
    // R-02 declared value too high
    ['BK-003', 'Kestrel Bags', 'Birmingham', UK, 'Amsterdam', 'Netherlands', 'Warehouse', d(today, 7), 'Balanced', 2, 20, 3600, 'GBP', 280, 'Yes'],
    // R-03 cartons × units per carton ≠ quantity
    ['BK-004', 'Lumen Candles', 'London', UK, 'Hamburg', 'Germany', 'Warehouse', d(today, 6), 'Cheapest', 2, 38, 7200, 'GBP', 340, 'Yes'],
    // R-04 booking cartons ≠ item cartons (messy formats on purpose: "£5,880.00", D-M-YY)
    ['BK-005', 'Stoneware & Co', 'Manchester', UK, 'Lyon', 'France', 'Warehouse', d(today, 8, 'd-M-yy'), 'Most reliable', 2, 95, '£5,880.00', 'GBP', 700, 'Yes'],
    // R-05 pallets too heavy for every carrier
    ['BK-006', 'Ironworks Garden', 'Leeds', UK, 'Rotterdam', 'Netherlands', 'Business address', d(today, 9), 'Cheapest', 2, 20, 3000, 'GBP', 1800, 'No'],
    // R-06 lithium power bank (and a battery-free torch that must NOT be flagged)
    ['BK-007', 'Brightside Gadgets', 'Birmingham', UK, 'Berlin', 'Germany', 'Warehouse', d(today, 4), 'Balanced', 1, 20, 2800, 'GBP', 120, 'Yes'],
    // multi-error
    ['BK-008', 'Rushmore Imports', 'London', UK, 'Frankfurt', 'Germany', 'Warehouse', d(today, -1), 'Cheapest', 1, 50, 9000, 'GBP', 150, 'No'],
    // DATA problems: invalid date, pallets = 0, city/country mismatch (plus an orphan item BK-099)
    ['BK-009', 'Dataloom Ltd', 'Manchester', UK, 'Paris', 'Germany', 'Warehouse', '31-02-2026', 'Fastest', 0, 10, 1000, 'GBP', 200, 'Yes'],
    // amber only: blank appointment, missing country of origin; date as DD/MM/YYYY
    ['BK-010', 'Tulip Trading', 'Manchester', UK, 'Amsterdam', 'Netherlands', 'Warehouse', d(today, 12, 'dd/MM/yyyy'), 'Balanced', 3, 90, 4200, 'GBP', 450, null],
  ];
}

function itemRows(): Cell[][] {
  const UK = 'United Kingdom';
  return [
    ['BK-001', 'MUG-01', 'Ceramic coffee mug, 350 ml', 691200, 1080, 5, 12, 90, 0.5, UK],
    ['BK-002', 'TEE-01', 'Cotton t-shirt', null, 400, 8, 20, 20, 0.2, UK],
    ['BK-002', 'SCF-02', 'Wool scarf', 62171, 400, 12, 20, 20, 0.3, 'India'],
    ['BK-003', 'TOTE-01', 'Canvas tote bag', '4202.92', 500, 6, 25, 20, 0.4, 'India'],
    ['BK-004', 'CAN-01', 'Soy wax candle, 200 g', '340490', 960, 7.5, 24, 38, 0.3, UK],
    ['BK-005', 'MUG-01', 'Stoneware mug', '6912.00', 600, 5, 12, 50, 0.5, UK],
    ['BK-005', 'PLT-02', 'Stoneware side plate', '6912.00', 480, 6, 12, 40, 0.6, UK],
    ['BK-006', 'PLN-01', 'Cast iron planter', '732393', 120, 25, 6, 20, 14, 'China'],
    ['BK-007', 'PWR-01', 'Lithium-ion power bank 10,000 mAh', '850760', 200, 12, 20, 10, 0.25, 'China'],
    ['BK-007', 'LED-03', 'Wind-up LED torch (battery-free)', '940560', 100, 4, 10, 10, 0.2, 'China'],
    ['BK-008', 'A1', 'Wireless speaker', 8518, 300, 20, 10, 30, 0.8, null],
    ['BK-008', 'A2', 'Desk lamp', null, 100, 15, 5, 15, 1, 'China'],
    ['BK-009', 'DL-01', 'Notebook, A5', '482010', 100, 10, 10, 10, 0.1, UK],
    ['BK-099', 'GHOST-01', 'Item whose booking does not exist', '123456', 10, 1, 5, 2, 0.5, UK],
    ['BK-010', 'TUL-01', 'Tulip bulb gift box', '060110', 600, 5, 10, 60, 0.6, 'Germany'],
    ['BK-010', 'TUL-02', 'Garden gloves', '611610', 600, 2, 20, 30, 0.1, null],
  ];
}

function carrierSheet(): Cell[][] {
  return [
    ['FIXED - judges will use exactly this rate card. Do not edit.'],
    ['Carrier', 'Service', 'Origin country', 'Destination country', 'Price per pallet', 'Currency', 'Transit time (days)', 'On-time rate (%)', 'Max weight per pallet (kg)'],
    ...CARRIER_RATES.map((r) => [r.carrier, r.service, r.origin, r.destination, r.pricePerPallet, 'GBP', r.transitDays, r.onTimeRate, r.maxWeightPerPalletKg] as Cell[]),
  ];
}
function rulebookSheet(): Cell[][] {
  return [['FIXED - these are the only rules judges will test against. Do not edit.'], ['Rule ID', 'Rule', 'Severity if broken'], ...RULEBOOK.map((r) => [r.id, r.text, r.severity] as Cell[])];
}

function workbook(bookings: Cell[][], items: Cell[][], note: string): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const withTitle = (title: string, headers: string[], rows: Cell[][]) => [[title], headers, ...rows];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(withTitle(`Bookings — one row per shipment. ${note}`, BOOKING_HEADERS, bookings)), 'Bookings');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(withTitle(`Items — one row per product. ${note}`, ITEM_HEADERS, items)), 'Items');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(carrierSheet()), 'Carrier options');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rulebookSheet()), 'Rulebook');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

/** Ten bookings: one clean, one per red rule, a multi-error one, one with data problems, one amber-only. */
export function buildSampleWorkbook(today: Date = new Date()): ArrayBuffer {
  return workbook(bookingRows(today), itemRows(), 'Sample data (dates are relative to today).');
}

/** Headers plus one example row, same layout the judges use. */
export function buildTemplateWorkbook(today: Date = new Date()): ArrayBuffer {
  return workbook(bookingRows(today).slice(0, 1), itemRows().slice(0, 1), 'Example row — replace it with your own data.');
}
