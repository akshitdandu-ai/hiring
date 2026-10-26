import { format, startOfDay } from 'date-fns';
import { RULEBOOK } from '../config/rulebook';
import type { Booking, BookingResult, BookingStatus, CouldNotCheck, Finding } from '../model/types';
import { recommendCarrier } from './carrierEngine';
import { buildConfirmation, buildNextSteps } from './confirmation';
import { validateBooking } from './dataChecks';
import { deriveTotals } from './deriveTotals';
import { RULES } from './rules';
import { r05Evidence } from './rules/R05';
import { sanityChecks } from './sanityChecks';

export interface EvaluateOptions {
  /** Defaults to the local date now. Pass a fixed date in tests. */
  today?: Date;
}

const sevOrder = { Red: 0, Amber: 1, Info: 2 } as const;

function sortFindings(fs: Finding[]): Finding[] {
  return fs
    .map((f, i) => [f, i] as const)
    .sort(([a, ai], [b, bi]) => sevOrder[a.severity] - sevOrder[b.severity] || Number(b.ruleId === 'DATA') - Number(a.ruleId === 'DATA') || a.ruleId.localeCompare(b.ruleId) || ai - bi)
    .map(([f]) => f);
}

function dedupe(fs: Finding[]): Finding[] {
  const seen = new Set<string>();
  return fs.filter((f) => {
    const k = f.field ? `${f.ruleId}|${f.scope}|${f.field}` : `${f.ruleId}|${f.scope}|${f.problem}|${f.evidence}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function evaluateBooking(booking: Booking, opts: EvaluateOptions = {}): BookingResult {
  const today = startOfDay(opts.today ?? new Date());
  const todayISO = format(today, 'yyyy-MM-dd');
  const totals = deriveTotals(booking);
  const carrier = recommendCarrier(booking, today);

  const ingest = booking.ingestFindings ?? [];
  const ingestKeys = new Set(ingest.filter((f) => f.field).map((f) => `${f.scope}|${f.field}`));
  const data = [...ingest, ...validateBooking(booking).filter((f) => !ingestKeys.has(`${f.scope}|${f.field}`))];

  const findings: Finding[] = [...data];
  const passed: string[] = [];
  const couldNotCheck: CouldNotCheck[] = [];
  const passNotes: Record<string, string> = {};
  for (const [id, rule] of RULES) {
    let out;
    try {
      out = rule({ booking, today, todayISO, carrier, totals });
    } catch (e) {
      out = { findings: [], couldNotCheck: `unexpected error (${e instanceof Error ? e.message : 'unknown'})` };
    }
    findings.push(...out.findings);
    if (out.couldNotCheck) couldNotCheck.push({ ruleId: id, reason: out.couldNotCheck });
    if (!out.couldNotCheck && !out.findings.some((f) => f.severity !== 'Info')) passed.push(id);
  }
  if (passed.includes('R-05')) {
    const n = r05Evidence(carrier);
    if (n) passNotes['R-05'] = n;
  }
  findings.push(...sanityChecks(booking, totals, todayISO));

  const sorted = sortFindings(dedupe(findings));
  const red = sorted.filter((f) => f.severity === 'Red').length;
  const amber = sorted.filter((f) => f.severity === 'Amber').length;
  const hasData = sorted.some((f) => f.ruleId === 'DATA');
  const status: BookingStatus = red > 0 || hasData ? 'Blocked' : amber > 0 ? 'Needs attention' : 'Ready';
  const dataCount = sorted.filter((f) => f.ruleId === 'DATA').length;
  const statusReason =
    status === 'Blocked'
      ? `${red} red issue${red === 1 ? '' : 's'}${dataCount ? ` (including ${dataCount} data problem${dataCount === 1 ? '' : 's'})` : ''} must be fixed before this can be booked.`
      : status === 'Needs attention'
        ? `${amber} amber issue${amber === 1 ? '' : 's'} to check; the booking can proceed but may be delayed.`
        : 'All ten checks passed.';

  const recommendation = carrier.recommendation ? { ...carrier.recommendation, provisional: status === 'Blocked' } : null;
  const confirmationText = buildConfirmation({ booking, status, statusReason, findings: sorted, recommendation, palletSuggestion: carrier.palletSuggestion, noRecommendationReason: carrier.noRecommendationReason });
  const result: BookingResult = {
    booking,
    findings: sorted,
    passedRules: passed,
    couldNotCheck,
    status,
    statusReason,
    carrierOptions: carrier.options,
    recommendation,
    palletSuggestion: carrier.palletSuggestion,
    noRecommendationReason: carrier.noRecommendationReason,
    etaBaseNote: carrier.etaBaseNote,
    confirmationText,
    nextSteps: buildNextSteps(status, booking, recommendation),
    passNotes,
  };
  return result;
}

export function ruleText(id: string): string {
  return RULEBOOK.find((r) => r.id === id)?.text ?? id;
}

/** Plain-English sentences describing what changed between two evaluations of the same booking. */
export function describeResultChange(prev: BookingResult, next: BookingResult): string[] {
  const out: string[] = [];
  const key = (f: Finding) => `${f.ruleId}|${f.scope}`;
  const prevKeys = new Map(prev.findings.filter((f) => f.severity !== 'Info').map((f) => [key(f), f]));
  const nextKeys = new Map(next.findings.filter((f) => f.severity !== 'Info').map((f) => [key(f), f]));
  const rulesOf = (m: Map<string, Finding>) => new Set([...m.values()].map((f) => f.ruleId));
  const pr = rulesOf(prevKeys);
  const nr = rulesOf(nextKeys);
  const fixed = [...pr].filter((r) => !nr.has(r) && r !== 'DATA');
  const broke = [...nr].filter((r) => !pr.has(r) && r !== 'DATA');
  for (const r of fixed) if (next.passedRules.includes(r)) out.push(`${r} now passes`);
  for (const r of broke) out.push(`${r} now fails`);
  if (pr.has('DATA') && !nr.has('DATA')) out.push('the data problems are resolved');
  if (!pr.has('DATA') && nr.has('DATA')) out.push('there are now data problems to fix');
  const pc = prev.recommendation?.option;
  const nc = next.recommendation?.option;
  if (pc && nc) {
    if (pc.label !== nc.label) out.push(`recommended carrier changes from ${pc.label} to ${nc.label}`);
    if (pc.cost !== null && nc.cost !== null && pc.cost !== nc.cost) {
      out.push(`cost ${nc.cost > pc.cost ? 'rises' : 'falls'} from ${gbpLocal(pc.cost)} to ${gbpLocal(nc.cost)}`);
    }
  } else if (!pc && nc) out.push(`${nc.label} is now recommended at ${gbpLocal(nc.cost)}`);
  else if (pc && !nc) out.push('no carrier can take the load any more');
  if (prev.status !== next.status) out.push(`status moves from ${prev.status} to ${next.status}`);
  return out;
}

const gbpLocal = (n: number | null) => (n === null ? '—' : '£' + (Math.round(n * 100) / 100).toLocaleString('en-GB'));
