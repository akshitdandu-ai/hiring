import { useState } from 'react';
import { describeGoods, describeRoute } from '../../engine/confirmation';
import type { BookingResult } from '../../model/types';
import { gbp, longDate, num } from '../../util/format';
import { copyText } from '../../util/csv';
import { btnGhost, card, cx } from '../styles';

export function confirmationForCopy(r: BookingResult): string {
  const issues = r.findings.filter((f) => f.severity !== 'Info').map((f) => `- ${f.ruleId}${f.scope !== 'booking' ? ` [${f.scope}]` : ''}: ${f.problem}. Fix: ${f.fix}`);
  return [r.confirmationText, issues.length ? `\nIssues:\n${issues.join('\n')}` : '', `\nWhat happens next:\n${r.nextSteps.map((s) => `- ${s}`).join('\n')}`].join('\n').trim();
}

export function ConfirmationCard({ result }: { result: BookingResult }) {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');
  const b = result.booking;
  const rec = result.recommendation?.option;
  const rows: Array<[string, string]> = [
    ['Booking', `${b.bookingId}${b.sellerName ? ` · ${b.sellerName}` : ''}`],
    ['Route', `${describeRoute(b)}${b.destinationType ? ` (${b.destinationType.toLowerCase()})` : ''}`],
    ['Goods', describeGoods(b)],
    ['Shipment', `${b.pallets === null ? '?' : num(b.pallets, 3)} pallets · ${b.cartons === null ? '?' : num(b.cartons, 3)} cartons · ${b.grossWeightKg === null ? '?' : num(b.grossWeightKg)} kg gross`],
    ['Declared value', b.declaredValue === null ? 'not provided' : gbp(b.declaredValue)],
    ['Carrier', rec ? `${rec.label} at ${gbp(rec.cost)}${result.recommendation!.provisional ? ' (provisional)' : ''}` : 'not chosen yet'],
    ['Collection', b.readyDate ? longDate(b.readyDate) : 'date not set'],
    ['Estimated delivery', rec ? `${longDate(rec.eta)} (estimated, calendar days)` : '—'],
  ];
  return (
    <section className={cx(card, 'space-y-3 p-4')} aria-label="Confirmation">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-bold">Confirmation</h3>
        <button
          type="button"
          className={btnGhost}
          onClick={async () => {
            const ok = await copyText(confirmationForCopy(result));
            setCopied(ok ? 'ok' : 'fail');
            setTimeout(() => setCopied('idle'), 2500);
          }}
        >
          {copied === 'ok' ? '✔ Copied' : copied === 'fail' ? 'Copy failed: select the text instead' : 'Copy confirmation'}
        </button>
      </div>
      <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[9rem_1fr]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-medium text-slate-600">{k}</dt>
            <dd className="min-w-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>
      <div>
        <h4 className="mb-1 text-sm font-semibold text-slate-700">What happens next</h4>
        {result.status === 'Blocked' ? (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-950">{result.nextSteps[0]}</p>
        ) : (
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {result.nextSteps.map((s, i) => (
              <li key={i} className={s.startsWith('Resolve the amber') ? 'font-semibold text-amber-900' : undefined}>{s}</li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
