import { describeRoute } from '../../engine/confirmation';
import type { BookingResult } from '../../model/types';
import { gbp, longDate, num } from '../../util/format';
import { card, cx } from '../styles';
import { StatusChip } from './StatusBanner';

export function BookingSummaryCard({ result }: { result: BookingResult }) {
  const b = result.booking;
  return (
    <section className={cx(card, 'p-4')} aria-label="Booking summary">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-bold">
          {b.bookingId} <span className="font-normal text-slate-600">· {b.sellerName || 'no seller name'}</span>
        </h3>
        <StatusChip status={result.status} />
      </div>
      <p className="mt-1 text-sm text-slate-700">
        {describeRoute(b)} · {b.destinationType || 'destination type missing'} · ready {b.readyDate ? longDate(b.readyDate) : 'date missing'} · priority {b.priority || '—'}
      </p>
      <p className="text-sm text-slate-700">
        {b.pallets === null ? '?' : num(b.pallets, 3)} pallets · {b.cartons === null ? '?' : num(b.cartons, 3)} cartons · {b.grossWeightKg === null ? '?' : num(b.grossWeightKg)} kg · declared {b.declaredValue === null ? '?' : gbp(b.declaredValue)} · {b.items.length} item{b.items.length === 1 ? '' : 's'}
      </p>
    </section>
  );
}
