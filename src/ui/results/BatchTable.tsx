import { describeRoute } from '../../engine/confirmation';
import type { BookingResult } from '../../model/types';
import { gbp } from '../../util/format';
import { card, cx } from '../styles';
import { StatusChip } from './StatusBanner';

export function BatchTable({ results, selected, onSelect }: { results: BookingResult[]; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <div className={cx(card, 'overflow-hidden')}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-left text-sm">
          <caption className="sr-only">All uploaded bookings. Select a row to see the full result.</caption>
          <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th scope="col" className="px-3 py-2">Booking ID</th>
              <th scope="col" className="px-3 py-2">Seller</th>
              <th scope="col" className="px-3 py-2">Route</th>
              <th scope="col" className="px-3 py-2">Status</th>
              <th scope="col" className="px-3 py-2 text-center">Red</th>
              <th scope="col" className="px-3 py-2 text-center">Amber</th>
              <th scope="col" className="px-3 py-2">Recommended carrier</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => {
              const red = r.findings.filter((f) => f.severity === 'Red').length;
              const amber = r.findings.filter((f) => f.severity === 'Amber').length;
              const id = r.booking.bookingId;
              const rec = r.recommendation;
              return (
                <tr
                  key={id}
                  className={cx('cursor-pointer border-t border-slate-200 hover:bg-indigo-50', selected === id && 'bg-indigo-50')}
                  onClick={() => onSelect(id)}
                >
                  <th scope="row" className="px-3 py-2 font-mono font-semibold">
                    <button type="button" className="text-left text-indigo-800 underline-offset-2 hover:underline" onClick={(e) => { e.stopPropagation(); onSelect(id); }} aria-pressed={selected === id}>
                      {id}
                    </button>
                  </th>
                  <td className="px-3 py-2">{r.booking.sellerName || '—'}</td>
                  <td className="px-3 py-2">{describeRoute(r.booking)}</td>
                  <td className="px-3 py-2"><StatusChip status={r.status} /></td>
                  <td className="px-3 py-2 text-center font-semibold">{red ? <span className="text-red-800">● {red}</span> : <span className="text-slate-400">0</span>}</td>
                  <td className="px-3 py-2 text-center font-semibold">{amber ? <span className="text-amber-800">▲ {amber}</span> : <span className="text-slate-400">0</span>}</td>
                  <td className="px-3 py-2">{rec ? `${rec.option.label} · ${gbp(rec.option.cost)}${rec.provisional ? ' (provisional)' : ''}` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
