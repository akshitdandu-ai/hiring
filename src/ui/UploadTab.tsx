import { FileDropzone } from '../ingest/FileDropzone';
import { IngestReportView } from '../ingest/IngestReportView';
import type { BatchResult } from '../ingest';
import { btnGhost, card, cx } from './styles';

export function UploadTab({ loading, error, batch, onFiles, onLoadSample, onTemplate }: { loading: string | null; error: string | null; batch: BatchResult | null; onFiles: (f: File[]) => void; onLoadSample: () => void; onTemplate: () => void }) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <FileDropzone onFiles={onFiles} disabled={!!loading} />
      {loading && (
        <p role="status" className={cx(card, 'flex items-center gap-2 p-3 text-sm')}>
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" aria-hidden="true" />
          {loading}
        </p>
      )}
      {error && (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-950">
          <p className="font-semibold">We could not check that file</p>
          <p>{error}</p>
          <p className="mt-1">Tip: start from the template (Download template), keep one header row, and upload the Bookings and Items sheets together.</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnGhost} onClick={onLoadSample}>Load sample data</button>
        <button type="button" className={btnGhost} onClick={onTemplate}>Download template</button>
      </div>
      {batch && <IngestReportView report={batch.report} />}
    </div>
  );
}
