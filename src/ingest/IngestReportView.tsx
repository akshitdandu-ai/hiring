import type { IngestReport } from './ingestReport';
import { card, cx } from '../ui/styles';

/** Data problems that are not rule breaks: what was read, what was skipped and why. */
export function IngestReportView({ report }: { report: IngestReport }) {
  const has = report.orphanItems.length || report.duplicateBookingIds.length || report.warnings.length || report.errors.length;
  return (
    <section className={cx(card, 'space-y-2 p-4 text-sm')} aria-label="Upload report">
      <h3 className="text-base font-bold">Upload report</h3>
      <p className="text-slate-700">
        Read {report.files.join(', ') || 'no files'}. Bookings sheet: <strong>{report.bookingsSheet ?? 'not found'}</strong>; Items sheet: <strong>{report.itemsSheet ?? 'not found'}</strong>
        {report.ignoredSheets.length ? <> (ignored: {report.ignoredSheets.join(', ')})</> : null}. {report.bookingCount} booking{report.bookingCount === 1 ? '' : 's'} and {report.itemCount} item row{report.itemCount === 1 ? '' : 's'} evaluated
        {report.emptyRowsSkipped ? `; ${report.emptyRowsSkipped} empty row${report.emptyRowsSkipped === 1 ? '' : 's'} skipped` : ''}.
      </p>
      {report.errors.map((e, i) => (
        <p key={i} className="rounded-lg border border-red-300 bg-red-50 p-2 text-red-950">⛔ {e}</p>
      ))}
      {report.orphanItems.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-amber-950">
          <p className="font-semibold">▲ Orphan items: {report.orphanItems.length} item row{report.orphanItems.length === 1 ? '' : 's'} have a Booking ID that is not on the Bookings sheet, so they were not evaluated</p>
          <ul className="list-disc pl-5">
            {report.orphanItems.map((o, i) => (
              <li key={i}>
                {o.sku} (Booking ID {o.bookingId}, {o.file} row {o.row})
              </li>
            ))}
          </ul>
        </div>
      )}
      {report.duplicateBookingIds.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-amber-950">
          <p className="font-semibold">▲ Duplicate Booking IDs: the first row was evaluated and the rest ignored</p>
          <ul className="list-disc pl-5">
            {report.duplicateBookingIds.map((d) => (
              <li key={d.bookingId}>
                {d.bookingId}: rows {d.rows.join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}
      {report.warnings.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-slate-700">
          {report.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      {!has && <p className="text-emerald-800">✔ No file-level problems found.</p>}
    </section>
  );
}
