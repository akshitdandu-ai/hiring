import { useRef, useState } from 'react';
import { cx } from '../ui/styles';

export function FileDropzone({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled?: boolean }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const take = (list: FileList | null) => {
    const files = list ? Array.from(list) : [];
    if (files.length) onFiles(files);
    if (input.current) input.current.value = '';
  };
  return (
    <div
      className={cx('rounded-xl border-2 border-dashed p-6 text-center transition-colors sm:p-10', over ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-white', disabled && 'opacity-60')}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled) take(e.dataTransfer.files);
      }}
    >
      <p className="text-base font-semibold">Drop your Bookings and Items files here</p>
      <p className="mt-1 text-sm text-slate-600">One workbook (.xlsx or .xls) with both sheets, or two .csv files. Sheets are recognised by their column headers, not their names.</p>
      <label className="mt-4 inline-flex cursor-pointer items-center rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-indigo-600 hover:bg-indigo-800">
        Choose files
        <input ref={input} type="file" multiple accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" className="sr-only" disabled={disabled} onChange={(e) => take(e.target.files)} />
      </label>
    </div>
  );
}
