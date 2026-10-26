import { RULEBOOK } from '../../config/rulebook';
import type { BookingResult, Finding } from '../../model/types';
import { card, cx, SEVERITY_STYLE } from '../styles';

function FindingCard({ f }: { f: Finding }) {
  const s = SEVERITY_STYLE[f.severity];
  return (
    <li className={cx('rounded-lg border p-3 text-sm', s.card)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cx('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-bold', s.chip)}>
          <span aria-hidden="true">{s.icon}</span>
          {f.ruleId === 'DATA' ? 'DATA' : f.ruleId}
          <span className="sr-only">, {s.label}</span>
        </span>
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">{s.label}</span>
        {f.scope !== 'booking' && <span className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-xs text-slate-700">{f.scope}</span>}
      </div>
      <p className="mt-1.5 font-semibold text-slate-900">{f.problem}</p>
      <dl className="mt-1 space-y-0.5 text-slate-800">
        <div>
          <dt className="inline font-medium">Evidence: </dt>
          <dd className="inline">{f.evidence}</dd>
        </div>
        <div>
          <dt className="inline font-medium">Fix: </dt>
          <dd className="inline">{f.fix}</dd>
        </div>
      </dl>
    </li>
  );
}

export function ChecksPanel({ result }: { result: BookingResult }) {
  const red = result.findings.filter((f) => f.severity === 'Red');
  const amber = result.findings.filter((f) => f.severity === 'Amber');
  const info = result.findings.filter((f) => f.severity === 'Info');
  const section = (title: string, items: Finding[]) =>
    items.length ? (
      <div>
        <h4 className="mb-1.5 text-sm font-semibold text-slate-700">
          {title} ({items.length})
        </h4>
        <ul className="space-y-2">{items.map((f, i) => <FindingCard key={`${f.ruleId}-${f.scope}-${f.field ?? i}-${i}`} f={f} />)}</ul>
      </div>
    ) : null;

  return (
    <section className={cx(card, 'space-y-4 p-4')} aria-label="What's wrong">
      <h3 className="text-base font-bold">What&apos;s wrong</h3>
      {!red.length && !amber.length && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">✔ No issues found: every rule passed.</p>}
      {section('Red: must be fixed before booking', red)}
      {section('Amber: risky, check or fix', amber)}
      {section('Info', info)}
      {result.couldNotCheck.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-sm font-semibold text-slate-700">Could not check</h4>
          <ul className="space-y-1 text-sm text-slate-800">
            {result.couldNotCheck.map((c) => (
              <li key={c.ruleId} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5">
                <span className="font-mono font-semibold">{c.ruleId}</span> Could not check: {c.reason}.
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <h4 className="mb-1.5 text-sm font-semibold text-slate-700">Passed ({result.passedRules.length} of {RULEBOOK.length})</h4>
        {result.passedRules.length ? (
          <p className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="font-medium text-emerald-800">✔ Passed:</span>
            {result.passedRules.map((id) => (
              <span key={id} title={RULEBOOK.find((r) => r.id === id)?.text} className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-900">
                ✔ {id}
                {result.passNotes[id] ? <span className="font-normal"> · {result.passNotes[id]}</span> : null}
              </span>
            ))}
          </p>
        ) : (
          <p className="text-sm text-slate-600">No rule passed cleanly yet.</p>
        )}
      </div>
    </section>
  );
}
