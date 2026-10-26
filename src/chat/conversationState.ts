import { format } from 'date-fns';
import { describeResultChange, evaluateBooking } from '../engine/evaluateBooking';
import type { Booking, BookingResult, BookingStatus } from '../model/types';
import { gbp } from '../util/format';
import { applyOps, type ChangeLine, describeBookingDiff } from './changeDetector';
import { detectSignals, type Extracted, resolveItem, ruleExtract } from './extractor';
import type { Op, Slot } from './ops';
import { slotKey } from './ops';
import { calcProposalFor, type CalcProposal, planNext } from './questionPlanner';
import { calcText, GREETING, hsHint, offTopic, questionText, questionsIntro, resultSummary, summaryLines, whyText } from './replies';
import { emptyBooking, isMissing } from './slotTracker';

export type Phase = 'collecting' | 'confirming' | 'results';

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  /** Diff lines, e.g. "Pallets: 3 → 4". */
  changes?: ChangeLine[];
  /** What changed in the checks, e.g. "R-05 now passes". */
  checkChanges?: string[];
  notes?: string[];
  warnings?: string[];
  questions?: string[];
  summary?: string[];
  status?: BookingStatus;
}

export type Pending =
  | { kind: 'calc'; proposals: CalcProposal[] }
  | { kind: 'ambiguous'; amount: number; sign: 1 | -1; unit?: 'units' }
  | { kind: 'reset' }
  | { kind: 'run' };

interface Snapshot {
  booking: Booking;
  phase: Phase;
}

export interface ConversationState {
  booking: Booking;
  messages: ChatMessage[];
  phase: Phase;
  awaiting: Slot[];
  pending: Pending | null;
  history: Snapshot[];
  /** How many times the seller said "I don't know" for each slot. */
  skips: Record<string, number>;
  deferred: string[];
  declined: string[];
  result: BookingResult | null;
  counter: number;
  nextId: number;
}

const bookingId = (n: number) => `CHAT-${String(n).padStart(3, '0')}`;

export function initialState(counter = 1, greeting: string = GREETING): ConversationState {
  return {
    booking: emptyBooking(bookingId(counter)),
    messages: [{ id: 1, role: 'assistant', text: greeting }],
    phase: 'collecting',
    awaiting: [],
    pending: null,
    history: [],
    skips: {},
    deferred: [],
    declined: [],
    result: null,
    counter,
    nextId: 2,
  };
}

type Reply = Omit<ChatMessage, 'id' | 'role'>;

const say = (st: ConversationState, r: Reply): ConversationState => ({ ...st, messages: [...st.messages, { id: st.nextId, role: 'assistant', ...r }], nextId: st.nextId + 1 });

/**
 * One conversational turn. Pure: the extraction (rule-based or LLM) is done by the caller and passed in,
 * and every reply is built from templates, never from model text.
 */
export function step(state: ConversationState, userText: string, ex: Extracted, today: Date): ConversationState {
  let st: ConversationState = { ...state, messages: [...state.messages, { id: state.nextId, role: 'user', text: userText }], nextId: state.nextId + 1 };
  const out: Reply = { text: '' };
  const lead: string[] = [];

  const ops: Op[] = [...ex.ops];
  const sig = ex.signals;

  // ---- start over (needs confirmation) ----
  if (st.pending?.kind === 'reset') {
    if (sig.yes) return { ...initialState(st.counter + 1, 'Fresh start. Tell me about the next shipment.'), messages: [...st.messages, { id: st.nextId, role: 'assistant', text: 'Done: the booking and chat are cleared.' }, { id: st.nextId + 1, role: 'assistant', text: 'Fresh start. Tell me about the next shipment.' }], nextId: st.nextId + 2 };
    st = { ...st, pending: null };
    if (sig.no || (!ops.length && !sig.startOver)) lead.push('OK, I have kept your booking.');
  }
  if (sig.startOver && !ops.length) {
    st = { ...st, pending: { kind: 'reset' } };
    return say(st, { text: 'Start over? This clears the booking and the chat. Reply "yes" to confirm, or "no" to keep going.' });
  }

  // ---- undo ----
  if (sig.undo && !ops.length) {
    const snap = st.history[st.history.length - 1];
    if (!snap) return replan({ ...st }, today, { text: 'There is nothing to undo yet.' });
    const changes = describeBookingDiff(st.booking, snap.booking);
    const prevResult = st.result;
    st = { ...st, booking: snap.booking, history: st.history.slice(0, -1), pending: null };
    return finish(st, today, { text: 'Undone.', changes }, prevResult);
  }

  // ---- ambiguous amount from last turn ("add 2" → "pallets") ----
  if (st.pending?.kind === 'ambiguous') {
    const p = st.pending;
    const t = userText.toLowerCase();
    let resolved = true;
    if (/\b(pallets?|skids?)\b/.test(t)) ops.push({ op: p.sign > 0 ? 'increment' : 'decrement', field: 'pallets', amount: p.amount });
    else if (/\b(cartons?|boxes|box)\b/.test(t)) ops.push({ op: p.sign > 0 ? 'increment' : 'decrement', field: 'cartons', amount: p.amount });
    else if (/\b(units?|pieces?|pcs)\b/.test(t) || p.unit === 'units') {
      const target = st.booking.items.length === 1 ? st.booking.items[0] : resolveItem(st.booking.items, userText);
      if (target) ops.push({ op: 'update_item', match: target.sku, field: 'quantity', value: p.amount, mode: p.sign > 0 ? 'increment' : 'decrement' });
      else {
        st = { ...st, pending: { ...p, unit: 'units' } };
        return say(st, { text: `${p.amount} units of which item? Say its name or SKU (${st.booking.items.map((i) => i.sku).join(', ') || 'none yet'}).` });
      }
    } else resolved = !!ops.length || !!ex.signals.ambiguous;
    if (resolved) st = { ...st, pending: null };
    else return say(st, { text: `${p.amount} of what: pallets, cartons or units?` });
  }
  if (sig.ambiguous && !ops.length) {
    st = { ...st, pending: { kind: 'ambiguous', amount: sig.ambiguous.amount, sign: sig.ambiguous.sign } };
    return say(st, { text: `${sig.ambiguous.amount} of what: pallets, cartons or units?` });
  }

  // ---- answers to a calculated-value offer ----
  let calcApplied: CalcProposal[] = [];
  if (st.pending?.kind === 'calc') {
    const p = st.pending;
    if (sig.yes && !ops.length) {
      calcApplied = p.proposals;
      for (const pr of p.proposals) ops.push(pr.slot.scope === 'booking' ? { op: 'set', field: pr.slot.field, value: pr.value } : { op: 'update_item', match: pr.slot.sku, field: pr.slot.field, value: pr.value, mode: 'set' });
    } else if (sig.no && !ops.length) {
      st = { ...st, declined: [...new Set([...st.declined, ...p.proposals.map((x) => slotKey(x.slot))])] };
      lead.push('No problem, I will not use the calculated values.');
    }
    st = { ...st, pending: null };
  }

  // ---- run the checks ----
  const wantsRun = (st.pending?.kind === 'run' && sig.yes && !ops.length) || (sig.runChecks && !ops.length);
  if (st.pending?.kind === 'run' && sig.no && !ops.length) {
    st = { ...st, pending: null, phase: 'collecting' };
    return say(st, { text: 'OK. Tell me what to change, for example "make it 4 pallets" or "change it to Lyon".' });
  }
  if (wantsRun) {
    const incomplete = !planNext(st.booking, { deferred: new Set(st.deferred), declined: new Set(st.declined) }).complete;
    st = { ...st, pending: null, phase: 'results', result: evaluateBooking(st.booking, { today }), awaiting: [] };
    return say(st, {
      text: `${incomplete ? 'Running the checks with what I have; anything missing is reported as a data problem. ' : ''}${resultSummary(st.result!)}`,
      status: st.result!.status,
      notes: ['The full list of checks, the carrier comparison and the confirmation are in the panel. Tell me any change and I will re-run everything.'],
    });
  }

  // ---- apply field updates ----
  const before = st.booking;
  const applied = applyOps(before, ops);
  let booking = applied.booking;
  for (const pr of calcApplied) {
    const key = pr.slot.scope === 'booking' ? pr.slot.field : `item:${pr.slot.sku}:${pr.slot.field}`;
    booking = { ...booking, fieldSources: { ...booking.fieldSources, [key]: 'calculated-confirmed' } };
  }
  const changes = describeBookingDiff(before, booking);
  const prevResult = st.result;
  if (changes.length) st = { ...st, booking, history: [...st.history.slice(-30), { booking: before, phase: st.phase }] };
  else st = { ...st, booking };

  const warnings = [...ex.warnings, ...applied.warnings];
  if (ops.some((o) => o.op === 'set' && o.field === 'readyDate') && booking.readyDate) {
    if (booking.readyDate < format(today, 'yyyy-MM-dd')) warnings.push('That date is in the past. I have accepted it, but rule R-10 will flag it (amber). Say a new date to fix it.');
  }
  if (ex.hsUnknownFor !== undefined) {
    const h = hsHint(ex.hsUnknownFor);
    lead.push(h ? `No problem. ${h[0].toUpperCase() + h.slice(1)}. The HS code stays missing until you give me one.` : 'No problem. The HS code stays missing until you give me one; you can look it up on the UK Trade Tariff.');
  }
  // narrowing a country to a city ("France" → "Lyon, France") refines the booking rather than replacing a value
  const narrowed = (c: { text: string }) => !before.destinationCity && c.text.startsWith('Destination:');
  const overwrote = changes.some((c) => c.kind === 'change' && !narrowed(c)) && ops.some((o) => o.op === 'set' || (o.op === 'update_item' && (o.mode ?? 'set') === 'set'));
  if (overwrote) lead.push('Using your latest value.');
  if (calcApplied.length) lead.push('Confirmed.');
  out.notes = [...ex.notes, ...applied.notes];
  out.warnings = warnings;

  // ---- "I don't know" for what we just asked ----
  if (sig.skip && st.awaiting.length) {
    const skips = { ...st.skips };
    const deferred = new Set(st.deferred);
    const offered: CalcProposal[] = [];
    for (const slot of st.awaiting) {
      if (!isMissing(st.booking, slot)) continue;
      const key = slotKey(slot);
      const calc = calcProposalFor(st.booking, slot);
      if (slot.scope === 'item' && slot.field === 'countryOfOrigin') {
        deferred.add(key);
        lead.push(`OK, I will leave the country of origin blank for ${st.booking.items.find((i) => i.sku === slot.sku)?.description || slot.sku}. Check R-09 will flag it as amber.`);
      } else if (calc) offered.push(calc);
      else if ((skips[key] ?? 0) >= 1) {
        deferred.add(key);
        lead.push(`OK, I will leave ${whyText(st.booking, slot).replace(/^I need /, '').replace(/ because.*/, '')} blank. The checks will report it as a data problem.`);
      } else {
        skips[key] = (skips[key] ?? 0) + 1;
        lead.push(whyText(st.booking, slot) + ' Could you give it another try?');
      }
    }
    // an "I don't know" re-opens a calculated offer the seller declined earlier
    st = { ...st, skips, deferred: [...deferred], declined: st.declined.filter((k) => !offered.some((c) => slotKey(c.slot) === k)) };
    if (offered.length) lead.push('I can work that out from your items.');
  }

  // ---- nothing understood ----
  const understood = (ops.length > 0 && !sig.question) || changes.length > 0 || sig.skip || sig.yes || sig.no || ex.warnings.length > 0 || out.notes.length > 0;
  if (!understood) {
    const isQuestion = /\?\s*$|^(?:what|how|why|who|can|could|do|does|is|are|should|which|where|when)\b/i.test(userText.trim());
    lead.push(isQuestion ? offTopic(userText) : "Sorry, I didn't catch a booking detail in that.");
  }

  out.text = lead.join(' ');
  return finish(st, today, out, prevResult, changes);
}

/** After applying changes: re-run checks if results are showing, otherwise ask for what is missing. */
function finish(
  st: ConversationState,
  today: Date,
  reply: Reply,
  prevResult: BookingResult | null,
  changesArg?: ChangeLine[],
): ConversationState {
  const changes = changesArg ?? reply.changes;
  const base: Reply = { ...reply, changes: changes?.length ? changes : undefined };

  if (st.phase === 'results') {
    const result = evaluateBooking(st.booking, { today });
    const checkChanges = prevResult ? describeResultChange(prevResult, result) : [];
    st = { ...st, result };
    const plan = planNext(st.booking, { deferred: new Set(st.deferred), declined: new Set(st.declined) });
    const asked = askMissing(st, plan);
    st = asked.state;
    return say(st, {
      ...base,
      text: [base.text, changes?.length || checkChanges.length ? '' : 'No change to the booking.', `Re-ran all checks: ${resultSummary(result)}`].filter(Boolean).join(' '),
      checkChanges: checkChanges.length ? checkChanges : undefined,
      status: result.status,
      questions: asked.questions.length ? asked.questions : undefined,
      notes: [...(base.notes ?? []), ...(asked.intro ? [asked.intro] : [])],
    });
  }
  return replan(st, today, base);
}

function askMissing(st: ConversationState, plan: ReturnType<typeof planNext>): { state: ConversationState; questions: string[]; intro: string } {
  if (plan.complete) return { state: { ...st, awaiting: [] }, questions: [], intro: '' };
  const questions = plan.questions.map((q) => questionText(st.booking, q));
  const pending: Pending | null = plan.calc.length ? { kind: 'calc', proposals: plan.calc } : null;
  const calcQ = plan.calc.length ? [calcText(plan.calc)] : [];
  return { state: { ...st, awaiting: plan.questions, pending: pending ?? st.pending }, questions: [...calcQ, ...questions], intro: questionsIntro(plan) };
}

function replan(st: ConversationState, _today: Date, base: Reply): ConversationState {
  const plan = planNext(st.booking, { deferred: new Set(st.deferred), declined: new Set(st.declined) });
  if (plan.complete) {
    const state: ConversationState = { ...st, phase: 'confirming', awaiting: [], pending: { kind: 'run' } };
    return say(state, { ...base, text: [base.text, 'I have everything I need. Here is your booking:'].filter(Boolean).join(' '), summary: summaryLines(state.booking), questions: ['Shall I run the checks?'] });
  }
  const { state, questions, intro } = askMissing({ ...st, phase: st.phase === 'confirming' ? 'collecting' : st.phase }, plan);
  const first = base.text || ((base.changes?.length ?? 0) > 0 ? 'Got it.' : '');
  return say(state, { ...base, text: [first, intro].filter(Boolean).join(' '), questions });
}

export { gbp };
export { detectSignals };

/** Rule-based turn: parse the message with the fallback parser and step. The UI may swap in LLM ops first. */
export function respond(state: ConversationState, text: string, today: Date, ex?: Extracted): ConversationState {
  const extracted = ex ?? ruleExtract(text, { booking: state.booking, awaiting: state.awaiting, today });
  return step(state, text, extracted, today);
}
