export interface OrphanItem {
  bookingId: string;
  sku: string;
  row: number;
  file: string;
}
export interface DuplicateId {
  bookingId: string;
  rows: number[];
}
export interface IngestReport {
  files: string[];
  bookingsSheet: string | null;
  itemsSheet: string | null;
  ignoredSheets: string[];
  bookingCount: number;
  itemCount: number;
  emptyRowsSkipped: number;
  orphanItems: OrphanItem[];
  duplicateBookingIds: DuplicateId[];
  /** Missing columns, odd headers, anything the user may want to know. Not rule breaks. */
  warnings: string[];
  /** Fatal: nothing could be evaluated. Friendly text saying what to fix. */
  errors: string[];
}

export const emptyReport = (): IngestReport => ({
  files: [],
  bookingsSheet: null,
  itemsSheet: null,
  ignoredSheets: [],
  bookingCount: 0,
  itemCount: 0,
  emptyRowsSkipped: 0,
  orphanItems: [],
  duplicateBookingIds: [],
  warnings: [],
  errors: [],
});
