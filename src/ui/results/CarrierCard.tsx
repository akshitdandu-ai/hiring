import type { BookingResult, CarrierOption } from '../../model/types';
import { gbp, longDate, num } from '../../util/format';
import { card, cx } from '../styles';

export function CarrierCard({ result }: { result: BookingResult }) {
  const r = result.recommendation;
  return (
    <section className={cx(card, 'space-y-3 p-4')} aria-label="Recommended carrier">
      <h3 className="text-base font-bold">Recommended carrier</h3>
      {r ? (
        <div className={cx('rounded-lg border-2 p-3', r.provisional ? 'border-amber-300 bg-amber-50' : 'border-emerald-300 bg-emerald-50')}>
          {r.provisional && <p className="mb-1 text-xs font-bold uppercase tracking-wide text-amber-900">Provisional: fix the red issues before booking</p>}
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-lg font-bold">{r.option.label}</p>
            <p className="text-lg font-bold">{gbp(r.option.cost)}</p>
          </div>
          <p className="text-sm text-slate-700">
            {gbp(r.option.pricePerPallet)} per pallet · {r.option.transitDays} days in transit · {r.option.onTimeRate}% on time · max {r.option.maxWeightPerPalletKg} kg per pallet
          </p>
          <p className="mt-1 text-sm">
            Estimated delivery <strong>{longDate(r.option.eta)}</strong> <span className="text-slate-600">(estimated, calendar days)</span>
          </p>
          <p className="mt-2 text-sm">
            <span className="font-semibold">Why: </span>
            {r.reason}
          </p>
          <p className="mt-1 text-xs text-slate-600">Your priority: {r.priority}. {result.etaBaseNote}</p>
          {r.priority === 'Balanced' && r.option.score && (
            <p className="mt-1 text-xs text-slate-600">
              Balanced score (lower is better): cost {r.option.score.cost.toFixed(2)}, transit {r.option.score.transit.toFixed(2)}, unreliability {r.option.score.reliability.toFixed(2)} → average {r.option.score.total.toFixed(2)}.
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-lg border-2 border-red-300 bg-red-50 p-3 text-sm text-red-950">
          <p className="font-semibold">No carrier can be recommended yet.</p>
          <p>{result.noRecommendationReason}</p>
          {result.palletSuggestion && (
            <p className="mt-1">
              Suggestion: use <strong>{result.palletSuggestion.palletsNeeded} pallets</strong> with {result.palletSuggestion.option.label} for {gbp(result.palletSuggestion.cost)} in total.
            </p>
          )}
        </div>
      )}
      {result.carrierOptions.length > 0 && <CarrierComparisonTable options={result.carrierOptions} chosen={r?.option} />}
    </section>
  );
}

export function CarrierComparisonTable({ options, chosen }: { options: CarrierOption[]; chosen?: CarrierOption }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[34rem] text-left text-sm">
        <caption className="sr-only">All carrier options for this route</caption>
        <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-600">
          <tr>
            <th scope="col" className="px-3 py-2">Option</th>
            <th scope="col" className="px-3 py-2">Cost</th>
            <th scope="col" className="px-3 py-2">Transit</th>
            <th scope="col" className="px-3 py-2">On time</th>
            <th scope="col" className="px-3 py-2">Pallet weight / max</th>
            <th scope="col" className="px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {options.map((o) => (
            <tr key={o.label} className={cx('border-t border-slate-200', !o.eligible && 'bg-slate-50 text-slate-400', chosen?.label === o.label && 'bg-emerald-50 font-medium')}>
              <th scope="row" className="px-3 py-2 font-semibold">{o.label}</th>
              <td className="px-3 py-2">{gbp(o.cost)}</td>
              <td className="px-3 py-2">{o.transitDays} d</td>
              <td className="px-3 py-2">{o.onTimeRate}%</td>
              <td className="px-3 py-2">
                {o.weightPerPallet === null ? '—' : `${num(o.weightPerPallet, 1)} kg`} / {o.maxWeightPerPalletKg} kg
              </td>
              <td className="px-3 py-2">
                {chosen?.label === o.label ? <span className="font-semibold text-emerald-800">★ Recommended</span> : o.eligible ? <span className="text-slate-700">Eligible</span> : <span>✕ Excluded: {o.excludedReason}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
