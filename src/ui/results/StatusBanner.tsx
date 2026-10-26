import type { BookingStatus } from '../../model/types';
import { cx, STATUS_STYLE } from '../styles';

export function StatusChip({ status, className }: { status: BookingStatus; className?: string }) {
  const s = STATUS_STYLE[status];
  return (
    <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold', s.chip, className)}>
      <span aria-hidden="true">{s.icon}</span>
      {s.label}
    </span>
  );
}

export function StatusBanner({ status, reason }: { status: BookingStatus; reason: string }) {
  const s = STATUS_STYLE[status];
  return (
    <div role="status" className={cx('flex items-start gap-3 rounded-xl border-2 p-4', s.banner)}>
      <span className="text-2xl leading-none" aria-hidden="true">{s.icon}</span>
      <div className="min-w-0">
        <p className="text-lg font-bold">{s.label}</p>
        <p className="text-sm">{reason}</p>
      </div>
    </div>
  );
}
