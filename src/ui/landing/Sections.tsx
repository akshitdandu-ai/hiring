import { useCallback, useRef, useState } from 'react';
import { CARRIER_RATES } from '../../config/carriers';
import { RULEBOOK } from '../../config/rulebook';
import { cx } from '../styles';
import { HeroArt } from './HeroArt';
import { useScrollProgress } from './motion';

const REPO_URL = 'https://github.com/akshitdandu-ai/preflight-the-last-milers';

/* ------------------------------------------------------------------ statement */

export function Statement() {
  const section = useRef<HTMLElement>(null);
  const disc = useRef<HTMLDivElement>(null);
  const apply = useCallback((p: number) => {
    if (disc.current) disc.current.style.transform = `translate3d(0, ${(0.5 - p) * 120}px, 0) rotate(${p * 60}deg)`;
  }, []);
  useScrollProgress(section, apply, 'pass');

  return (
    <section ref={section} id="why" aria-labelledby="why-title" className="flex min-h-[80vh] items-center border-y hairline bg-groundSec">
      <div className="mx-auto grid w-full max-w-7xl grid-cols-12 gap-x-6 gap-y-10 px-4 py-20 sm:px-6">
        <div className="col-span-12 lg:col-span-8">
          <p className="label text-tealLight">Why pre-flight</p>
          <h2 id="why-title" className="mt-4 font-display text-4xl leading-[1.02] sm:text-6xl">
            Most shipping problems start as a typo in the paperwork.
          </h2>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-ink/70">
            Customs holds and missing units usually trace back to a wrong HS code, a value that does not add up, or a pallet that is too heavy. Pre-Flight checks ten rules before the goods leave, and tells the seller exactly how to fix each one.
          </p>
          <p aria-hidden="true" className="outline-number mt-10 select-none font-display text-[26vw] font-extrabold leading-none sm:text-[18vw] lg:text-[15rem]">10</p>
          <p className="label -mt-2 text-ink/60">rules checked on every booking</p>
        </div>
        <div className="col-span-12 flex items-center justify-center lg:col-span-4">
          <div className="relative aspect-square w-full max-w-sm overflow-hidden rounded-full border hairline">
            <div ref={disc} className="absolute -inset-[15%] opacity-40 mix-blend-luminosity" style={{ willChange: 'transform' }}>
              <HeroArt className="h-full w-full" decorative />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ card deck */

interface Scenario {
  tag: string;
  title: string;
  outcome: string;
  message: string;
  rotate: number;
}

/** Each message is a real conversation the app handles; the outcome line is what its checks conclude. */
export const SCENARIOS: Scenario[] = [
  {
    tag: 'Clean booking',
    title: 'Everything adds up',
    outcome: 'Ready. All ten checks pass, and Carrier A is recommended at £540 for 3 pallets.',
    message:
      "We're Northfield Goods. 1080 ceramic mugs at £5 each from Manchester to a warehouse in Frankfurt, 12 per carton, HS code 691200, 0.5kg each, made in the UK. 3 pallets, 620 kg, ready 5th Nov, appointment booked, cheapest please.",
    rotate: -2,
  },
  {
    tag: 'Too heavy',
    title: 'The pallets cannot take it',
    outcome: '900 kg per pallet is over every carrier’s limit (R-05, blocked). Say “add a pallet” and watch the checks re-run.',
    message:
      "We're Northfield Goods, 1080 mugs at £5 each, 12 per carton, 90 cartons, HS 691200, 0.5kg each, UK made, from Manchester to Hamburg warehouse, 2 pallets, 1800 kg, appointment booked, 5th Nov, cheapest",
    rotate: 3,
  },
  {
    tag: 'Restricted goods',
    title: 'A battery slips into the list',
    outcome: 'Lithium batteries are flagged red (R-06) and the booking is blocked until they come off the list.',
    message: 'We want to move 500 phone chargers with lithium batteries from London to Paris, 5 pallets',
    rotate: -1,
  },
];

export function FeatureDeck({ onTry, onStartChat, onSample }: { onTry: (text: string) => void; onStartChat: () => void; onSample: () => void }) {
  const [order, setOrder] = useState<number[]>(SCENARIOS.map((_, i) => i));
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState<1 | -1 | null>(null);
  const startX = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback((dir: 1 | -1) => {
    if (timer.current) return;
    setLeaving(dir);
    timer.current = setTimeout(() => {
      timer.current = null;
      setOrder((o) => [...o.slice(1), o[0]]);
      setLeaving(null);
      setDx(0);
      setDragging(false);
    }, 380);
  }, []);

  const onDown = (e: React.PointerEvent<HTMLElement>) => {
    if (leaving || (e.target as HTMLElement).closest('button')) return;
    startX.current = e.clientX;
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<HTMLElement>) => {
    if (startX.current === null) return;
    setDx(e.clientX - startX.current);
  };
  const onUp = () => {
    if (startX.current === null) return;
    startX.current = null;
    if (Math.abs(dx) > 100) dismiss(dx > 0 ? 1 : -1);
    else {
      setDx(0);
      setDragging(false);
    }
  };

  const total = SCENARIOS.length;
  const current = order[0];

  return (
    <section id="try" aria-labelledby="try-title" className="border-b hairline bg-ground">
      <div className="mx-auto grid max-w-7xl items-center gap-x-10 gap-y-12 px-4 py-24 sm:px-6 lg:grid-cols-2">
        <div>
          <p className="label text-tealLight">Try a real scenario</p>
          <h2 id="try-title" className="mt-4 font-display text-4xl leading-[1.05] sm:text-5xl">Throw a card, pick a booking.</h2>
          <p className="mt-5 max-w-md leading-relaxed text-ink/70">
            Each card is a seller message in plain language, the way a person would write it. Send one to the chat and Pre-Flight asks only for what is missing, then shows what is wrong, how serious it is and how to fix it.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button type="button" onClick={onStartChat} className="rounded-full bg-amber px-6 py-3 text-sm font-semibold text-ground transition-transform duration-500 hover:-translate-y-0.5 reveal">
              Open the chat
            </button>
            <button type="button" onClick={onSample} className="rounded-full border border-ink/30 px-6 py-3 text-sm font-semibold transition-colors duration-500 hover:border-amber hover:text-amber">
              Load sample data
            </button>
          </div>
        </div>

        <div className="mx-auto w-full max-w-md">
          <div className="relative h-[27rem] sm:h-[25rem]" role="group" aria-roledescription="carousel" aria-label="Example bookings. Drag the top card away, or use the Next example button.">
            {order.map((idx, rank) => {
              const s = SCENARIOS[idx];
              const top = rank === 0;
              const bottom = rank === total - 1 && total > 1;
              const out = top && leaving !== null;
              let transform = `rotate(${s.rotate}deg) translateY(${rank * 10}px) scale(${1 - rank * 0.04})`;
              if (top) {
                transform = out ? `translate(${600 * leaving!}px, -100px) rotate(${45 * leaving!}deg)` : `translate(${dx}px, 0) rotate(${s.rotate + dx / 18}deg)`;
              }
              return (
                <article
                  key={idx}
                  className={cx('deck-card absolute inset-0 flex flex-col justify-between rounded-2xl border hairline bg-panel p-6 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.9)]', !top && 'pointer-events-none')}
                  style={{
                    zIndex: top ? 20 : 10 - rank,
                    transform,
                    opacity: out ? 0 : bottom ? 0.6 : 1,
                    transition: dragging && top ? 'none' : 'transform 500ms cubic-bezier(0.16, 1, 0.3, 1), opacity 500ms cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                  aria-hidden={!top}
                  onPointerDown={top ? onDown : undefined}
                  onPointerMove={top ? onMove : undefined}
                  onPointerUp={top ? onUp : undefined}
                  onPointerCancel={top ? onUp : undefined}
                >
                  <div>
                    <p className="label text-amber">{s.tag}</p>
                    <h3 className="mt-3 font-display text-2xl leading-tight">{s.title}</h3>
                    <p className="mt-4 text-sm leading-relaxed text-ink/60">“{s.message.length > 150 ? `${s.message.slice(0, 148)}…` : s.message}”</p>
                  </div>
                  <div>
                    <p className="border-t hairline pt-4 text-sm leading-relaxed">{s.outcome}</p>
                    <button
                      type="button"
                      tabIndex={top ? 0 : -1}
                      onClick={() => onTry(s.message)}
                      className="label mt-4 rounded-full border border-ink/30 px-4 py-2 transition-colors duration-500 hover:border-amber hover:text-amber"
                    >
                      Try this in the chat →
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="mt-8 flex items-center gap-4">
            <div className="h-px flex-1 bg-hairline" role="progressbar" aria-label="Example position" aria-valuemin={1} aria-valuemax={total} aria-valuenow={current + 1}>
              <div className="h-px bg-amber transition-[width] duration-500" style={{ width: `${((current + 1) / total) * 100}%`, transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)' }} />
            </div>
            <span className="label tabular-nums text-ink/60" aria-hidden="true">
              {current + 1} / {total}
            </span>
            <button type="button" onClick={() => dismiss(1)} className="label rounded-full border border-ink/30 px-4 py-2 transition-colors duration-500 hover:border-amber hover:text-amber">
              Next example
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ roster: the ten checks */

const GLYPH: Record<string, string> = { 'R-01': '#', 'R-02': '£', 'R-03': '×', 'R-04': 'Σ', 'R-05': 'kg', 'R-06': '!', 'R-07': '≥', 'R-08': '◷', 'R-09': '⚑', 'R-10': '31' };
const SHORT: Record<string, string> = {
  'R-01': 'HS code of at least six digits',
  'R-02': 'Declared value matches the items',
  'R-03': 'Units per carton × cartons = quantity',
  'R-04': 'Booking cartons match the items',
  'R-05': 'Pallet weight fits the carrier',
  'R-06': 'No batteries, aerosols or flammables',
  'R-07': 'Gross weight is not below net weight',
  'R-08': 'Warehouse delivery has an appointment',
  'R-09': 'Every item has a country of origin',
  'R-10': 'Ready date is not in the past',
};

export function ChecksRoster() {
  return (
    <section id="checks" aria-labelledby="checks-title" className="border-b hairline bg-groundSec">
      <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
        <p className="label text-tealLight">The rulebook</p>
        <h2 id="checks-title" className="mt-4 font-display text-4xl leading-[1.05] sm:text-5xl">Ten checks on every booking.</h2>
        <ul className="mt-12">
          {RULEBOOK.map((r, i) => (
            <li key={r.id} className="roster-item group border-t hairline last:border-b">
              <div tabIndex={0} className="flex items-center gap-4 py-5 outline-offset-[-2px] sm:gap-6 sm:py-6" aria-label={`${r.id}: ${r.text}. Severity ${r.severity}.`}>
                <span className="roster-num w-10 shrink-0 font-mono text-sm text-amber" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                <div className="roster-thumb duotone relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100 sm:h-14 sm:w-14" aria-hidden="true">
                  <span className="font-display text-xl font-extrabold">{GLYPH[r.id]}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="roster-title font-display text-xl leading-snug sm:text-3xl">{SHORT[r.id]}</h3>
                  <p className="mt-1 hidden max-w-2xl text-sm text-ink/55 sm:block">{r.text}</p>
                </div>
                <span className="label shrink-0 font-mono text-ink/50">{r.id}</span>
                <span className={cx('label shrink-0 rounded-full border px-3 py-1', r.severity === 'Red' ? 'border-red-300 text-red-800' : 'border-amber/60 text-amber')}>
                  <span aria-hidden="true">{r.severity === 'Red' ? '● ' : '▲ '}</span>
                  {r.severity}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ rate card */

export function RatesTable() {
  const rows = CARRIER_RATES.map((r) => {
    const same = CARRIER_RATES.filter((x) => x.destination === r.destination);
    const tags: Array<{ label: string; tone: 'amber' | 'teal' }> = [];
    if (r.pricePerPallet === Math.min(...same.map((x) => x.pricePerPallet))) tags.push({ label: 'Cheapest', tone: 'amber' });
    if (r.transitDays === Math.min(...same.map((x) => x.transitDays))) tags.push({ label: 'Fastest', tone: 'teal' });
    if (r.onTimeRate === Math.max(...same.map((x) => x.onTimeRate))) tags.push({ label: 'Most reliable', tone: 'teal' });
    return { ...r, tags };
  });
  return (
    <section id="rates" aria-labelledby="rates-title" className="bg-ground">
      <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
        <p className="label text-tealLight">Carrier options</p>
        <h2 id="rates-title" className="mt-4 font-display text-4xl leading-[1.05] sm:text-5xl">The rate card behind every recommendation.</h2>
        <div className="relative mt-10 overflow-x-auto">
          <table className="w-full min-w-[46rem] border-collapse text-left text-sm">
            <caption className="sr-only">Carrier services by destination, with price per pallet, transit time, on-time rate and maximum pallet weight</caption>
            <thead>
              <tr className="border-b hairline text-ink/60">
                {['Destination', 'Carrier · service', '£ per pallet', 'Transit', 'On time', 'Max kg per pallet', ''].map((h, i) => (
                  <th key={i} scope="col" className="label py-3 pr-4 font-semibold">{h || <span className="sr-only">Highlights</span>}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b hairline transition-colors duration-500 hover:bg-white/[0.03]">
                  <td className="py-4 pr-4 font-display text-lg">{r.destination}</td>
                  <td className="py-4 pr-4 text-ink/80">{r.carrier} · {r.service}</td>
                  <td className="py-4 pr-4 font-mono tabular-nums">£{r.pricePerPallet}</td>
                  <td className="py-4 pr-4 font-mono tabular-nums">{r.transitDays} days</td>
                  <td className="py-4 pr-4 font-mono tabular-nums">{r.onTimeRate}%</td>
                  <td className="py-4 pr-4 font-mono tabular-nums">{r.maxWeightPerPalletKg}</td>
                  <td className="py-4">
                    <span className="flex flex-wrap gap-2">
                      {r.tags.map((t) => (
                        <span key={t.label} className={cx('label rounded-full border px-3 py-1', t.tone === 'amber' ? 'border-amber/70 text-amber' : 'border-tealLight/60 text-tealLight')}>
                          {t.label}
                        </span>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-6 max-w-2xl text-sm text-ink/55">Cost is the price per pallet times the pallets. A carrier is only offered when the weight per pallet is within its limit.</p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ finale */

export function GrandFinale({ onSubmit, onSample, onTemplate }: { onSubmit: (text: string) => void; onSample: () => void; onTemplate: () => void }) {
  const [text, setText] = useState('');
  return (
    <footer id="start" className="relative overflow-hidden border-t hairline bg-ground">
      <div className="relative z-10 mx-auto max-w-7xl px-4 pb-10 pt-24 sm:px-6">
        <p className="label text-tealLight">Start now</p>
        <h2 className="mt-4 max-w-3xl font-display text-4xl leading-[1.05] sm:text-6xl">Describe your shipment.</h2>
        <form
          className="mt-10 flex max-w-3xl flex-col gap-4 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            const v = text.trim();
            if (!v) return;
            setText('');
            onSubmit(v);
          }}
        >
          <label htmlFor="finale-input" className="sr-only">Describe your shipment</label>
          <input
            id="finale-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={1500}
            autoComplete="off"
            placeholder="e.g. 3 pallets of mugs from Manchester to a warehouse in Frankfurt"
            className="min-w-0 flex-1 border-0 border-b border-ink/40 bg-transparent px-0 py-3 text-lg outline-none transition-colors duration-500 focus:border-amber"
          />
          <button type="submit" className="label self-start rounded-full border border-ink/30 px-5 py-3 transition-colors duration-500 hover:border-amber hover:text-amber sm:self-auto">
            Send to the chat →
          </button>
        </form>

        <div className="mt-24 flex flex-col gap-4 border-t hairline pt-6 text-sm text-ink/60 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl">All rule checks and carrier choices are deterministic code that runs in your browser: no login, no sign-up, nothing is uploaded to a server.</p>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
            <button type="button" className="nav-link" onClick={onSample}>Sample data</button>
            <button type="button" className="nav-link" onClick={onTemplate}>Template</button>
            <a className="nav-link" href={REPO_URL} target="_blank" rel="noreferrer noopener">Source on GitHub</a>
          </nav>
        </div>
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-[22%] select-none whitespace-nowrap text-center font-display font-extrabold leading-none text-ink opacity-10" style={{ fontSize: '24vw', letterSpacing: '-0.03em' }}>
        PRE-FLIGHT
      </div>
    </footer>
  );
}
