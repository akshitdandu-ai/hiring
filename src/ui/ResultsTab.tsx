import type { BatchResult } from '../ingest';
import { download, resultsToCsv } from '../util/csv';
import { btnGhost, btnPrimary, card, cx } from './styles';
import { BatchTable } from './results/BatchTable';
import { BookingSummaryCard } from './results/BookingSummaryCard';
import { ResultView } from './results/ResultView';
import { IngestReportView } from '../ingest/IngestReportView';

export function ResultsTab({ batch, selected, onSelect, onLoadSample, onGoUpload }: { batch: BatchResult | null; selected: string | null; onSelect: (id: string) => void; onLoadSample: () => void; onGoUpload: () => void }) {
  if (!batch || !batch.results.length) {
    return (
      <div className={cx(card, 'mx-auto max-w-xl space-y-3 p-6 text-center')}>
        <p className="text-lg font-bold">No bookings checked yet</p>
        <p className="text-sm text-slate-600">Upload a Bookings and Items file, or load the built-in sample (ten bookings with planted mistakes) to see every check in action.</p>
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" className={btnPrimary} onClick={onLoadSample}>Load sample data</button>
          <button type="button" className={btnGhost} onClick={onGoUpload}>Upload files</button>
        </div>
      </div>
    );
  }
  const count = (s: string) => batch.results.filter((r) => r.status === s).length;
  const current = batch.results.find((r) => r.booking.bookingId === selected) ?? batch.results[0];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-700" aria-live="polite">
          <strong>{batch.results.length}</strong> bookings checked: <span className="font-semibold text-red-800">⛔ {count('Blocked')} blocked</span> · <span className="font-semibold text-amber-800">⚠ {count('Needs attention')} need attention</span> ·{' '}
          <span className="font-semibold text-emerald-800">✔ {count('Ready')} ready</span>
        </p>
        <button type="button" className={btnPrimary} onClick={() => download('preflight-results.csv', resultsToCsv(batch.results), 'text/csv;charset=utf-8')}>
          Download results (CSV)
        </button>
      </div>
      <BatchTable results={batch.results} selected={current.booking.bookingId} onSelect={onSelect} />
      <div className="space-y-4" id="booking-detail">
        <BookingSummaryCard result={current} />
        <ResultView result={current} />
      </div>
      <details className="rounded-xl">
        <summary className="cursor-pointer text-sm font-medium text-indigo-800">Upload report (orphans, duplicates, warnings)</summary>
        <div className="mt-2">
          <IngestReportView report={batch.report} />
        </div>
      </details>
    </div>
  );
}
