import { addDays, format, parseISO } from 'date-fns';
import { CITY_TO_COUNTRY, DESTINATION_COUNTRIES, ORIGIN_COUNTRY } from '../config/allowedValues';
import { CARRIER_RATES } from '../config/carriers';
import type { Booking, CarrierOption, PalletSuggestion, Recommendation, ScoreBreakdown } from '../model/types';
import { EPS, gbp, num, round2 } from '../util/format';
import { norm } from '../util/text';

export interface CarrierOutcome {
  options: CarrierOption[];
  recommendation: Recommendation | null;
  palletSuggestion: PalletSuggestion | null;
  noRecommendationReason: string | null;
  /** The date the ETA is counted from, and why. */
  etaBaseNote: string;
}

/** The booking's destination country: the city decides, the stated country is the fallback. */
export function routeCountry(b: Booking): string | null {
  const city = Object.keys(CITY_TO_COUNTRY).find((c) => norm(c) === norm(b.destinationCity));
  const fromCity = city ? CITY_TO_COUNTRY[city] : null;
  if (fromCity && DESTINATION_COUNTRIES.includes(fromCity)) return fromCity;
  const stated = DESTINATION_COUNTRIES.find((c) => norm(c) === norm(b.destinationCountry));
  return stated ?? null;
}

const ok = (n: number | null): n is number => typeof n === 'number' && Number.isFinite(n);

export type Ranker = Pick<CarrierOption, 'cost' | 'transitDays' | 'onTimeRate' | 'label'>;

function byCost(a: Ranker, b: Ranker) {
  return (a.cost ?? 0) - (b.cost ?? 0);
}
const byTransit = (a: Ranker, b: Ranker) => a.transitDays - b.transitDays;
const byOnTime = (a: Ranker, b: Ranker) => b.onTimeRate - a.onTimeRate;
const byLabel = (a: Ranker, b: Ranker) => a.label.localeCompare(b.label);

/** Min-max normalised score; lower is better. */
export function balancedScores<T extends Ranker>(opts: T[]): Map<T, ScoreBreakdown> {
  const norm01 = (vals: number[], v: number) => {
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    return max === min ? 0 : (v - min) / (max - min);
  };
  const costs = opts.map((o) => o.cost ?? 0);
  const transits = opts.map((o) => o.transitDays);
  const unrel = opts.map((o) => 100 - o.onTimeRate);
  const m = new Map<T, ScoreBreakdown>();
  for (const o of opts) {
    const cost = norm01(costs, o.cost ?? 0);
    const transit = norm01(transits, o.transitDays);
    const reliability = norm01(unrel, 100 - o.onTimeRate);
    m.set(o, { cost, transit, reliability, total: (cost + transit + reliability) / 3 });
  }
  return m;
}

/** Rank eligible options best-first by the seller's priority. Pure and deterministic. */
export function rankOptions<T extends Ranker>(opts: T[], priority: string): { ranked: T[]; scores: Map<T, ScoreBreakdown> } {
  const scores = balancedScores(opts);
  const cmp: Record<string, (a: T, b: T) => number> = {
    Cheapest: (a, b) => byCost(a, b) || byTransit(a, b) || byOnTime(a, b) || byLabel(a, b),
    Fastest: (a, b) => byTransit(a, b) || byOnTime(a, b) || byCost(a, b) || byLabel(a, b),
    'Most reliable': (a, b) => byOnTime(a, b) || byCost(a, b) || byTransit(a, b) || byLabel(a, b),
    Balanced: (a, b) => {
      const d = scores.get(a)!.total - scores.get(b)!.total;
      if (Math.abs(d) > 1e-9) return d;
      return byCost(a, b) || byTransit(a, b) || byOnTime(a, b) || byLabel(a, b);
    },
  };
  const f = cmp[priority] ?? cmp.Balanced;
  return { ranked: [...opts].sort(f), scores };
}

function etaFor(base: Date, transitDays: number): string {
  return format(addDays(base, transitDays), 'yyyy-MM-dd');
}

function priorityPhrase(o: CarrierOption, priority: string, pallets: number | null, score?: ScoreBreakdown): string {
  switch (priority) {
    case 'Cheapest':
      return `cheapest at ${gbp(o.cost)}${pallets ? ` for ${num(pallets)} pallet${pallets === 1 ? '' : 's'}` : ''}`;
    case 'Fastest':
      return `fastest at ${o.transitDays} days in transit`;
    case 'Most reliable':
      return `most reliable at ${o.onTimeRate}% on-time`;
    default:
      return `best balance of cost, speed and reliability${score ? ` (score ${score.total.toFixed(2)}, lower is better)` : ''}`;
  }
}

function tradeOff(chosen: CarrierOption, other: CarrierOption): string {
  const parts: string[] = [];
  const dc = round2((other.cost ?? 0) - (chosen.cost ?? 0));
  if (Math.abs(dc) > EPS) parts.push(dc < 0 ? `${gbp(-dc)} cheaper` : `${gbp(dc)} more`);
  const dt = other.transitDays - chosen.transitDays;
  if (dt !== 0) parts.push(dt < 0 ? `${-dt} day${dt === -1 ? '' : 's'} faster` : `${dt} day${dt === 1 ? '' : 's'} slower`);
  const dr = other.onTimeRate - chosen.onTimeRate;
  if (dr !== 0) parts.push(dr > 0 ? `${dr} points more reliable` : `${-dr} points less reliable`);
  if (!parts.length) return `${other.label} is identical on cost, speed and reliability.`;
  const [first, ...rest] = parts;
  return `${other.label} is ${first}${rest.length ? ' and ' + rest.join(' and ') : ''}.`;
}

export function buildReason(chosen: CarrierOption, ranked: CarrierOption[], priority: string, pallets: number | null, scores: Map<CarrierOption, ScoreBreakdown>): string {
  const basis = priority && ['Cheapest', 'Fastest', 'Most reliable', 'Balanced'].includes(priority) ? priority : 'Balanced';
  let s = `${chosen.label}: ${priorityPhrase(chosen, basis, pallets, scores.get(chosen))}.`;
  if (ranked.length > 1) s += ` ${tradeOff(chosen, ranked[1])}`;
  else s += ' It is the only option that can carry this load.';
  return s;
}

export function recommendCarrier(b: Booking, today: Date): CarrierOutcome {
  const country = routeCountry(b);
  const base = b.readyDate && parseISO(b.readyDate) >= today ? parseISO(b.readyDate) : today;
  const etaBaseNote = `Estimated delivery counts calendar days from ${b.readyDate && parseISO(b.readyDate) >= today ? 'the ready date' : 'today (the ready date is missing or in the past)'}.`;
  const none = (reason: string, options: CarrierOption[] = []): CarrierOutcome => ({
    options,
    recommendation: null,
    palletSuggestion: null,
    noRecommendationReason: reason,
    etaBaseNote,
  });

  if (!country) return none('No carrier route: the destination country is missing or not supported (Germany, France, Netherlands).');
  const rates = CARRIER_RATES.filter((r) => r.origin === ORIGIN_COUNTRY && r.destination === country);
  if (!rates.length) return none(`No carrier options run from the United Kingdom to ${country}.`);

  const pallets = ok(b.pallets) && b.pallets > 0 ? b.pallets : null;
  const gross = ok(b.grossWeightKg) && b.grossWeightKg > 0 ? b.grossWeightKg : null;
  const wpp = pallets && gross ? gross / pallets : null;

  const options: CarrierOption[] = rates.map((r) => {
    const label = `${r.carrier} ${r.service}`;
    const tooHeavy = wpp !== null && wpp > r.maxWeightPerPalletKg + EPS;
    return {
      carrier: r.carrier,
      service: r.service,
      label,
      pricePerPallet: r.pricePerPallet,
      transitDays: r.transitDays,
      onTimeRate: r.onTimeRate,
      maxWeightPerPalletKg: r.maxWeightPerPalletKg,
      cost: pallets ? round2(r.pricePerPallet * pallets) : null,
      weightPerPallet: wpp,
      eligible: !tooHeavy,
      excludedReason: tooHeavy ? `pallet weight ${num(wpp, 1)} kg > max ${r.maxWeightPerPalletKg} kg` : undefined,
      eta: etaFor(base, r.transitDays),
    };
  });

  if (!pallets) return none('Cannot price or choose a carrier until the number of pallets is a valid whole number.', options);

  const eligible = options.filter((o) => o.eligible);
  if (!eligible.length) {
    // Suggest the smallest change that makes a carrier work: add pallets, ranked by the seller's priority.
    const hypo = options.map((o) => {
      const palletsNeeded = Math.ceil(gross! / o.maxWeightPerPalletKg - 1e-9);
      return { option: o, palletsNeeded, cost: round2(palletsNeeded * o.pricePerPallet), label: o.label, transitDays: o.transitDays, onTimeRate: o.onTimeRate };
    });
    const { ranked } = rankOptions(hypo, b.priority);
    const best = ranked[0];
    return {
      options,
      recommendation: null,
      palletSuggestion: { option: best.option, palletsNeeded: best.palletsNeeded, cost: best.cost },
      noRecommendationReason: `No carrier on this route can take ${num(wpp, 1)} kg per pallet (the highest limit is ${Math.max(...options.map((o) => o.maxWeightPerPalletKg))} kg).`,
      etaBaseNote,
    };
  }

  const { ranked, scores } = rankOptions(eligible, b.priority);
  for (const o of eligible) o.score = scores.get(o);
  const chosen = ranked[0];
  const basis = ['Cheapest', 'Fastest', 'Most reliable', 'Balanced'].includes(b.priority) ? b.priority : 'Balanced';
  return {
    options,
    recommendation: { option: chosen, priority: basis, reason: buildReason(chosen, ranked, basis, pallets, scores), provisional: false },
    palletSuggestion: null,
    noRecommendationReason: null,
    etaBaseNote,
  };
}
