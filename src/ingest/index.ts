import { evaluateBooking } from '../engine/evaluateBooking';
import type { BookingResult } from '../model/types';
import { assemble } from './bookingAssembler';
import type { IngestReport } from './ingestReport';
import { gridsFromFile, readSheets, type SheetGrid } from './workbookReader';

export interface BatchResult {
  results: BookingResult[];
  report: IngestReport;
}

export function evaluateGrids(grids: SheetGrid[], today?: Date): BatchResult {
  const { bookings, report } = assemble(readSheets(grids));
  const results = bookings.map((b) => {
    try {
      return evaluateBooking(b, { today });
    } catch (e) {
      // One bad row must never take down the batch.
      const msg = e instanceof Error ? e.message : 'unknown error';
      const broken = evaluateBooking({ ...b, items: [], ingestFindings: [] }, { today });
      broken.findings.unshift({ ruleId: 'DATA', severity: 'Red', scope: 'booking', problem: 'This booking could not be evaluated', evidence: msg, fix: 'Check the row for unusual values and re-upload.' });
      broken.status = 'Blocked';
      return broken;
    }
  });
  return { results, report };
}

export interface UploadedFile {
  name: string;
  data: ArrayBuffer;
}

export function evaluateFiles(files: UploadedFile[], today?: Date): BatchResult {
  const grids: SheetGrid[] = [];
  const unreadable: string[] = [];
  for (const f of files) {
    try {
      grids.push(...gridsFromFile(f.name, f.data));
    } catch {
      unreadable.push(f.name);
    }
  }
  const out = evaluateGrids(grids, today);
  for (const n of unreadable) out.report.warnings.push(`Could not read "${n}". Is it a valid .xlsx, .xls or .csv file?`);
  if (!grids.length && unreadable.length) out.report.errors.unshift(`Could not read ${unreadable.join(', ')}. Please upload .xlsx, .xls or .csv files.`);
  return out;
}
