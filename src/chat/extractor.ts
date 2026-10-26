import { ALL_DESTINATION_CITIES, CITY_ALIASES, COUNTRY_ALIASES, DESTINATION_COUNTRIES, ITEM_COUNTRIES, ORIGIN_CITIES, UNSUPPORTED_PLACES } from '../config/allowedValues';
import type { Booking, Item } from '../model/types';
import { scanDangerous } from '../engine/rules/R06';
import { matchFixed, norm } from '../util/text';
import type { ItemFieldName, ItemPatch, Op, Slot } from './ops';
import { convertNumberWords, expandK, findDate, findForeignMoney, findGbp, findWeights, NUM_SRC, parseNum } from './textUtils';

export interface ParseContext {
  booking: Booking;
  /** Slots the assistant asked about last turn: lets a bare "3" or "Northfield Goods" be understood. */
  awaiting: Slot[];
  today: Date;
  /** The seller's original message (set by ruleExtract), for case-sensitive cues. */
  rawText?: string;
}

export interface Signals {
  undo?: boolean;
  startOver?: boolean;
  yes?: boolean;
  no?: boolean;
  skip?: boolean;
  runChecks?: boolean;
  ambiguous?: { sign: 1 | -1; amount: number };
  question?: boolean;
}

export interface Extracted {
  ops: Op[];
  /** Conversions and interpretations to tell the seller ("1,200 lbs = 544.31 kg"). */
  notes: string[];
  /** Things we cannot do ("only GBP is supported"). */
  warnings: string[];
  signals: Signals;
  /** Country named without a city: ask for the city. */
  countryOnly?: string;
  unsupportedCurrency?: 'EUR' | 'USD';
  /** Item mentioned with no HS code: used to give a hint, never to fill the field. */
  hsUnknownFor?: string;
}

const WEEKDAY_OR_MONTH = /^(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?$|^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*$/i;

// ---------- control words ----------
export function detectSignals(raw: string): Signals {
  const t = raw.trim().toLowerCase().replace(/[!.]+$/g, '');
  const sig: Signals = {};
  if (/^(undo|undo that|undo last|undo last change|revert|revert that|go back|take that back|scrap that)$/.test(t) || /\bundo\b/.test(t)) sig.undo = true;
  if (/\b(start over|start again|begin again|restart|reset( everything| it)?|new booking|from scratch|clear everything)\b/.test(t)) sig.startOver = true;
  if (/^(yes|y|yep|yeah|yup|sure|ok|okay|correct|confirm|confirmed|go ahead|please do|do it|sounds good|that'?s right|that is right|right|use (these|them|those|it)|looks good|all good|perfect|great)\b/.test(t)) sig.yes = true;
  if (/^(no|n|nope|nah|not really|incorrect|wrong|no thanks|negative)\b/.test(t) && !/^no (more|extra|appointment|batter|pallet|carton)/.test(t)) sig.no = true;
  if (/\b(don'?t know|do not know|dont know|no idea|not sure|unsure|skip|dunno|can'?t say|not known|unknown|i have no|haven'?t got that|not yet|n\/a)\b/.test(t)) sig.skip = true;
  if (/\b(run|do|start) (the |all )?(checks?|pre-?flight)\b|\bcheck (it|everything|my booking)\b|^run it$/.test(t)) sig.runChecks = true;
  return sig;
}

/**
 * Which of the questions we just asked an "I don't know" answers. "not sure on origin" means the country of
 * origin only; a bare "don't know" means the first thing we asked, never everything at once.
 */
export function skipTargets(text: string, awaiting: Slot[]): Slot[] {
  const t = text.toLowerCase();
  const topics: Array<[RegExp, (s: Slot) => boolean]> = [
    [/\b(origin|made in|manufactur|produced|sourced)\b/, (s) => s.field === 'countryOfOrigin'],
    [/\b(hs|h\.s|tariff|commodity)\b|\bcode\b/, (s) => s.field === 'hsCode'],
    [/\b(each|per unit|per item|individual|unit weight)\b/, (s) => s.field === 'unitWeightKg'],
    [/\b(weigh|weight|kg|kilos?)\b/, (s) => s.field === 'grossWeightKg' || s.field === 'unitWeightKg'],
    [/\b(pallets?|skids?)\b/, (s) => s.field === 'pallets'],
    [/\b(per (?:carton|box)|packing|packed)\b/, (s) => s.field === 'unitsPerCarton'],
    [/\b(cartons?|boxes)\b/, (s) => s.field === 'cartons'],
    [/\b(price|cost)\b/, (s) => s.field === 'unitPrice'],
    [/\b(value|worth|declared)\b/, (s) => s.field === 'declaredValue'],
    [/\b(quantity|how many|units)\b/, (s) => s.field === 'quantity'],
    [/\b(name|company|seller|business)\b/, (s) => s.field === 'sellerName'],
    [/\b(date|ready|when)\b/, (s) => s.field === 'readyDate'],
    [/\b(appointment|slot)\b/, (s) => s.field === 'appointmentBooked'],
  ];
  let named = false;
  for (const [re, pick] of topics) {
    if (!re.test(t)) continue;
    named = true;
    const hit = awaiting.filter(pick);
    if (hit.length) return hit;
  }
  if (named) return [];
  return awaiting.slice(0, 1);
}

// ---------- item helpers ----------
const STOP_DESC = new Set(['the', 'a', 'an', 'of', 'some', 'my', 'our', 'these', 'those', 'new', 'same', 'extra', 'more', 'other', 'another']);
const NOT_ITEM = new Set([
  'pallet', 'pallets', 'skid', 'skids', 'carton', 'cartons', 'box', 'boxes', 'ctn', 'ctns', 'kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms', 'tonne', 'tonnes', 'ton', 'tons',
  'lb', 'lbs', 'pound', 'pounds', 'gbp', 'euro', 'euros', 'usd', 'dollars', 'unit', 'units', 'piece', 'pieces', 'pcs', 'pc', 'item', 'items', 'day', 'days', 'week', 'weeks',
  'more', 'extra', 'per', 'each', 'of', 'in', 'a', 'to', 'and', 'x', 'percent', 'gram', 'grams', 'g', 'quid', 'sterling', 'ml', 'cm', 'mm', 'am', 'pm', 'st', 'nd', 'rd', 'th', 'k', 'kgs',
]);

/** "ceramic mugs" → ["ceramic", "mug"]; plural stripped so "mugs" matches "mug". */
export function descTokens(s: string): string[] {
  return norm(s)
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((w) => w && !STOP_DESC.has(w))
    .map((w) => (w.length > 3 ? w.replace(/(?:ies)$/, 'y').replace(/(?:ches|shes|sses|xes)$/, (m) => m.slice(0, -2)).replace(/s$/, '') : w));
}

/** Same product if the head nouns agree, or one description's words are all inside the other's. */
export function sameProduct(a: string, b: string): boolean {
  const ta = descTokens(a);
  const tb = descTokens(b);
  if (!ta.length || !tb.length) return false;
  if (ta[ta.length - 1] === tb[tb.length - 1]) return true;
  const sa = new Set(ta);
  const sb = new Set(tb);
  return ta.every((w) => sb.has(w)) || tb.every((w) => sa.has(w));
}

/** Find an existing item by SKU or by description words. */
export function resolveItem(items: Item[], match: string): Item | null {
  const m = match.trim();
  if (!m) return null;
  const bySku = items.find((i) => i.sku.toLowerCase() === m.toLowerCase());
  if (bySku) return bySku;
  const hits = items.filter((i) => sameProduct(i.description, m) || (i.sku && new RegExp(`(?<![A-Za-z0-9])${i.sku.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`, 'i').test(m)));
  return hits.length ? hits[0] : null;
}

interface Draft {
  existing: Item | null;
  description: string;
  patch: ItemPatch;
  /** where its text starts and ends in the working string */
  start: number;
  end: number;
  descOnly?: boolean;
}

function cleanDescription(s: string): string {
  return s
    .replace(/^(?:units?|pcs\.?|pieces?|items?|x)\s+/i, '')
    .replace(/^(?:of\s+)?(?:the\s+|some\s+|my\s+|our\s+)?/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}


export function ruleExtract(textRaw: string, ctx: ParseContext): Extracted {
  const ex: Extracted = { ops: [], notes: [], warnings: [], signals: detectSignals(textRaw) };
  ctx = { ...ctx, rawText: textRaw };
  // A question ("what is a pallet?") is not a booking change.
  const trimmed = textRaw.trim();
  if ((/\?\s*$/.test(trimmed) || /^(?:what|how|why|who|which|where|when|can you explain|could you explain)\b/i.test(trimmed)) && !/\d/.test(trimmed) && !/\b(?:add|make|change|set|remove|drop|switch|update|use|put)\b/i.test(trimmed)) {
    ex.signals = { question: true };
    return ex;
  }
  const booking = ctx.booking;
  const today = ctx.today;

  // ---- normalise ----
  let s = textRaw.replace(/[’‘]/g, "'").replace(/ /g, ' ');
  s = convertNumberWords(s);
  s = expandK(s);
  s = s.replace(/\banother\b/gi, '1 more').replace(/\b(?:an|a|one)\s+(?:extra|additional)\b/gi, '1 more');
  s = s.replace(/\b(?:an?)\s+(?=(?:more\s+)?(?:pallets?|skids?|cartons?|boxes|box)\b)/gi, '1 ');
  // "four pounds fifty" → £4.50 (not a weight, not a count of something else)
  s = s.replace(/\b(\d+)\s*(?:pounds?|quid)\s+(\d{1,2})\b(?!\s*(?:kg|kgs|kilos?|lbs?|units?|pallets?|cartons?|boxes|pcs|%|per\s+(?:carton|box|pallet)))/gi, (_m, p: string, c: string) => `£${p}.${c.padStart(2, '0')}`);
  // "about 300 of them" is a quantity of the item we are already talking about
  s = s.replace(/(\d[\d,]*)\s+of\s+(?:them|these|those|it)\b/gi, '$1 units');
  // "mugs 100 at £5" reads like "100 mugs at £5"
  s = s.replace(
    /(?<![\w-])(?!(?:ship|shipping|send|sending|have|got|of|is|are|about|around|approx|approximately|total|value|worth|priced|cost|costs|price|only|just|at|for|x|and|with|per|each)\b)([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*)?)\s+(\d[\d,]*)\s+(?:at|@|for|x)\s*(?=£)/gi,
    (_m, noun: string, n: string) => `${n} ${noun} at `,
  );
  const blank = (idx: number, len: number) => {
    s = s.slice(0, idx) + ' '.repeat(len) + s.slice(idx + len);
  };
  const awaits = (f: string) => ctx.awaiting.some((a) => (a.scope === 'booking' ? a.field : `item.${a.field}`) === f || (a.scope === 'item' && a.field === f));
  const awaitsBooking = (f: string) => ctx.awaiting.some((a) => a.scope === 'booking' && a.field === f);
  const awaitedItemSku = ctx.awaiting.find((a) => a.scope === 'item' && a.sku && a.sku !== '*new*') as Extract<Slot, { scope: 'item' }> | undefined;

  // ---- 1. foreign currency: never convert silently ----
  const foreign = findForeignMoney(s);
  if (foreign.length) {
    ex.unsupportedCurrency = foreign[0].currency;
    ex.warnings.push(`Only GBP is supported, so I have not used the ${foreign[0].currency} amount${foreign.length > 1 ? 's' : ''}. Please give me the value in GBP (£).`);
    for (const f of [...foreign].reverse()) blank(f.index, f.length);
  }

  // ---- 2. date ----
  let date = findDate(s, today);
  if (date && /\b(?:appointment|slot)\b[^,.;]{0,30}\b(?:for|on|at)\s+(?:the\s+)?[^,.;]*$/i.test(s.slice(Math.max(0, date.index - 45), date.index + date.length))) {
    ex.notes.push('I did not use that date because it looks like the delivery appointment day. Say "ready on <date>" if it is the day the goods are ready.');
    date = null;
  }
  if (date) {
    ex.ops.push({ op: 'set', field: 'readyDate', value: date.iso });
    if (/→/.test(date.explain)) ex.notes.push(`Read "${date.explain}"`);
    blank(date.index, date.length);
  }

  const drafts: Draft[] = [];
  const itemsPool = (): Array<{ existing: Item | null; draft: Draft | null; description: string }> => [
    ...booking.items.map((i) => ({ existing: i, draft: drafts.find((d) => d.existing === i) ?? null, description: i.description })),
    ...drafts.filter((d) => !d.existing).map((d) => ({ existing: null, draft: d, description: d.description })),
  ];
  const draftFor = (desc: string): Draft => {
    // existing item, an item already mentioned in this message, or a brand new one
    const hit = itemsPool().find((p) => sameProduct(p.description, desc) || (p.existing && resolveItem([p.existing], desc)));
    if (hit?.draft) return hit.draft;
    const d: Draft = { existing: hit?.existing ?? null, description: hit?.existing ? hit.existing.description : desc, patch: {}, start: -1, end: -1 };
    drafts.push(d);
    return d;
  };
  const setDesc = (d: Draft, desc: string) => {
    if (!d.existing && desc.length > d.description.length) d.description = desc;
    if (!d.existing) d.patch.description = d.description;
    // "mugs" earlier, "ceramic mugs" now: keep the more specific wording
    else if (desc.length > d.existing.description.length && sameProduct(desc, d.existing.description)) d.patch.description = desc;
  };

  // ---- 3a. "change cartons to 12", "pallets: 4", "number of pallets is 4" ----
  const setCountRe = new RegExp(
    String.raw`\b(?:(?:change|set|make|update|amend|edit|correct)\s+)?(?:the\s+)?(?:(?:number|count|total)\s+of\s+)?(pallets?|skids?|cartons?|boxes)(?:\s+(?:count|total|number))?\s*(?:to|=|:|as|is|are|should\s+be)\s*(${NUM_SRC})\b(?!\s*(?:per|each|kg|kgs|kilos?|lbs?|units?|pcs|x\b|[£%]|of\b))`,
    'i',
  );
  const setCount = setCountRe.exec(s);
  if (setCount) {
    ex.ops.push({ op: 'set', field: /^(pallet|skid)/i.test(setCount[1]) ? 'pallets' : 'cartons', value: parseNum(setCount[2]) });
    blank(setCount.index, setCount[0].length);
  }
  // "change the quantity to 200" (one item) or "change the quantity of the mugs to 200"
  const setQtyRe = new RegExp(String.raw`\b(?:change|set|make|update|amend|edit|correct)\s+(?:the\s+)?(?:quantity|qty|number\s+of\s+units)(?:\s+of\s+(?:the\s+)?([A-Za-z][A-Za-z'\-]*(?:\s+[A-Za-z][A-Za-z'\-]*){0,3}?))?\s*(?:to|=|as)\s*(${NUM_SRC})\b`, 'i');
  const setQ = setQtyRe.exec(s);
  if (setQ) {
    const target = setQ[1] ? resolveItem(booking.items, setQ[1]) : booking.items.length === 1 ? booking.items[0] : null;
    if (target) {
      ex.ops.push({ op: 'update_item', match: target.sku, field: 'quantity', value: parseNum(setQ[2]), mode: 'set' });
      blank(setQ.index, setQ[0].length);
    }
  }

  // ---- 3. pallets / cartons ----
  const UNIT = String.raw`(?:pallets?|skids?|plts?|cartons?|ctns?|boxes|box)`;
  const verbRe = new RegExp(
    String.raw`(?:\b(add|plus|remove|drop|delete|take\s+off|take\s+away|minus|reduce(?:\s+by)?|decrease(?:\s+by)?|increase(?:\s+by)?|cut(?:\s+by)?|bump(?:\s+up)?(?:\s+by)?|up\s+by)\s+)?(?<![\w.£])(?<!\d,)(${NUM_SRC})\s*(more\s+|extra\s+|additional\s+|fewer\s+|less\s+)?(${UNIT})\b(\s+of\s+(?:the\s+)?([A-Za-z][A-Za-z'\-]*(?:\s+[A-Za-z][A-Za-z'\-]*){0,3}))?`,
    'gi',
  );
  const unitField = (u: string): 'pallets' | 'cartons' => (/^(pallet|skid|plt)/i.test(u) ? 'pallets' : 'cartons');
  const countMatches = [...s.matchAll(verbRe)];
  const upcLater: Array<{ upc: number; cartons: number }> = [];
  for (const m of countMatches.reverse()) {
    const unitWord = m[4];
    // "cartons of 12" = units per carton, not a carton count
    if (/^(?:cartons?|boxes|box|ctns?)$/i.test(unitWord) && m[5] && /^\s+of\s+\d/.test(m[5])) continue;
    const field = unitField(unitWord);
    const amount = parseNum(m[2]);
    const verb = (m[1] ?? '').toLowerCase();
    const mod = (m[3] ?? '').trim().toLowerCase();
    const dec = /remove|drop|delete|take|minus|reduce|decrease|cut/.test(verb) || mod === 'fewer' || mod === 'less';
    const inc = /add|plus|increase|bump|up/.test(verb) || mod === 'more' || mod === 'extra' || mod === 'additional';
    const desc = m[6] ? cleanDescription(m[6].split(/\s+(?:at|for|from|to|with|and|,)\b/i)[0]) : '';
    // "20 cartons of 12 mugs each": 12 is the packing, the units are 20 × 12
    const tailM =
      field === 'cartons' && !desc
        ? new RegExp(String.raw`^\s*(?:of|with|containing|holding)\s+(${NUM_SRC})(?!\d)(?!\s*(?:kg|kgs|kilos?|lbs?|£|%|pallets?|cartons?|boxes))(?!\s*(?:units?|pcs|pieces)\s+(?:each|per\s+(?:carton|box)|in\s+each)\s+of\b)\s*(?:units?|pcs|pieces)?\s*(?:each\s+|per\s+(?:carton|box)\s+)?([A-Za-z][A-Za-z'\-]*(?:\s+[A-Za-z][A-Za-z'\-]*){0,1})?`, 'i').exec(s.slice(m.index! + m[0].length))
        : null;
    if (tailM) {
      const per = parseNum(tailM[1]);
      const tailDesc = tailM[2] ? cleanDescription(tailM[2].split(/\s+(?:each|at|for|from|to|with|and|in)\b/i)[0]) : '';
      ex.ops.push({ op: 'set', field: 'cartons', value: amount });
      if (tailDesc && !NOT_ITEM.has(tailDesc.split(' ')[0].toLowerCase()) && !WEEKDAY_OR_MONTH.test(tailDesc.split(' ')[0])) {
        const d = draftFor(tailDesc);
        setDesc(d, tailDesc);
        d.patch.unitsPerCarton = per;
        d.patch.quantity = amount * per;
        ex.notes.push(`Worked out ${amount} cartons × ${per} = ${(amount * per).toLocaleString('en-GB')} units of ${tailDesc}.`);
      } else upcLater.push({ upc: per, cartons: amount });
      blank(m.index!, m[0].length + tailM[0].length);
      continue;
    }
    if (field === 'cartons' && desc) {
      // "90 cartons of mugs": cartons belong to that item
      const d = draftFor(desc);
      setDesc(d, desc);
      d.patch.cartons = amount;
    } else {
      ex.ops.push(dec ? { op: 'decrement', field, amount } : inc ? { op: 'increment', field, amount } : { op: 'set', field, value: amount });
      if (desc && field === 'pallets') {
        const known = itemsPool().some((p) => sameProduct(p.description, desc));
        if (!known) {
          const d = draftFor(desc);
          setDesc(d, desc);
          d.descOnly = true;
        }
      }
    }
    // the optional "of <words>" tail may run on into "from Birmingham": blank only up to where the product name ends
    const rawCut = m[6] ? m[6].search(/\s+(?:at|for|from|to|with|and|,)\b/i) : -1;
    blank(m.index!, m[0].length - (rawCut >= 0 ? m[6].length - rawCut : 0));
  }
  // ambiguous: "add 2", "remove 3"
  const amb = /\b(add|plus|remove|drop|take\s+off|minus|reduce(?:\s+by)?|increase(?:\s+by)?)\s+(\d+(?:\.\d+)?)(?!\s*(?:\d|[a-z%£]))/i.exec(s);
  if (amb) {
    ex.signals.ambiguous = { sign: /remove|drop|take|minus|reduce/i.test(amb[1]) ? -1 : 1, amount: parseNum(amb[2]) };
    blank(amb.index, amb[0].length);
  }

  // ---- 4. relative edits of an existing item: "add 100 units of the mugs", "drop the mugs" ----
  const removeRe = /\b(?:remove|drop|delete|take\s+out|take\s+off|scrap|get\s+rid\s+of|cancel)\s+(?:the\s+|my\s+|that\s+)?([A-Za-z][A-Za-z0-9'\-]*(?:\s+[A-Za-z][A-Za-z0-9'\-]*){0,3}?)(?=\s*(?:$|[,.;!?]|\sand\b|\sfrom\b|\sitem\b|\sline\b|\splease\b))/gi;
  for (const m of [...s.matchAll(removeRe)].reverse()) {
    const target = m[1].replace(/\s+(?:item|line)$/i, '').trim();
    const hit = itemsPool().find((p) => resolveItem(p.existing ? [p.existing] : [], target) || sameProduct(p.description, target));
    if (hit && !NOT_ITEM.has(target.toLowerCase())) {
      ex.ops.push({ op: 'remove_item', match: hit.existing ? hit.existing.sku : target });
      blank(m.index!, m[0].length);
    }
  }
  const relItemRe = new RegExp(
    String.raw`\b(add|plus|remove|drop|take\s+off|minus|reduce(?:\s+by)?|increase(?:\s+by)?)\s+(${NUM_SRC})\s*(?:more\s+|extra\s+)?(?:units?|pcs\.?|pieces?|items?)?\s*(?:of\s+)?(?:the\s+)?([A-Za-z][A-Za-z0-9'\-]*(?:\s+[A-Za-z][A-Za-z0-9'\-]*){0,3}?)(?=\s*(?:$|[,.;!?]|\sand\b|\sto\b|\sfrom\b))`,
    'gi',
  );
  for (const m of [...s.matchAll(relItemRe)].reverse()) {
    const word = m[3].trim();
    if (NOT_ITEM.has(word.toLowerCase())) continue;
    const target = resolveItem(booking.items, word);
    if (!target) continue;
    const dec = /remove|drop|take|minus|reduce/i.test(m[1]);
    ex.ops.push({ op: 'update_item', match: target.sku, field: 'quantity', value: parseNum(m[2]), mode: dec ? 'decrement' : 'increment' });
    blank(m.index!, m[0].length);
  }

  // "24 units each of scented candles": units per carton plus the product
  const upcOf = new RegExp(String.raw`(?<![\w.£])(?<!\d,)(${NUM_SRC})\s*(?:units?|pcs\.?|pieces?)\s+(?:each|per\s+(?:box|carton)|in\s+each(?:\s+(?:box|carton))?)\s+of\s+(?:the\s+|my\s+|our\s+)?([A-Za-z][A-Za-z'\-]*(?:\s+[A-Za-z][A-Za-z'\-]*){0,3})`, 'i').exec(s);
  if (upcOf) {
    const desc = cleanDescription(upcOf[2].split(/\s+(?:at|for|from|to|with|and)\b/i)[0]);
    if (desc && !NOT_ITEM.has(desc.split(' ')[0].toLowerCase())) {
      const d = draftFor(desc);
      setDesc(d, desc);
      d.patch.unitsPerCarton = parseNum(upcOf[1]);
      blank(upcOf.index, upcOf[0].length);
    }
  }

  // ---- 5. item anchors: "1080 ceramic mugs", "200 units of tote bags" ----
  const anchorRe = new RegExp(String.raw`(?<![\w£.\/-])(?<!\d,)(${NUM_SRC})(?![\d.:/-])\s+(?:x\s+)?([A-Za-z][A-Za-z0-9'\-]*(?:\s+[A-Za-z0-9'\-]+){0,5})`, 'g');
  const stopRe = /(?:[,;.()@=]|\s(?:at|for|priced|with|and|in|each|per|that|which|made|manufactured|to|from|ready|weigh|weighs|weighing|hs|sku|worth|costing|cost|are|is|using|via|by|on|packed|origin|sourced)\b|\s[£\d])/i;
  type Anchor = { d: Draft; qty: number | null; start: number; end: number };
  const anchors: Anchor[] = [];
  for (let m: RegExpExecArray | null; (m = anchorRe.exec(s)); ) {
    const rest = m[2];
    const cut = rest.search(stopRe);
    // resume right after this item's description so "200 candles and 150 tote bags" yields both items
    const used = m[0].length - rest.length + (cut >= 0 ? cut : rest.length);
    anchorRe.lastIndex = m.index + Math.max(1, used);
    let desc = (cut >= 0 ? rest.slice(0, cut) : rest).trim();
    const lead = /^(units?|pcs\.?|pieces?|items?)\b\s*(of\s+)?/i.exec(desc);
    let hasUnits = false;
    if (lead) {
      hasUnits = true;
      desc = desc.slice(lead[0].length);
    }
    desc = cleanDescription(desc);
    const first = desc.split(' ')[0]?.toLowerCase() ?? '';
    const qty = parseNum(m[1]);
    // "20 tiles per carton" is packing, not a quantity
    if (/^\s*(?:per|in\s+(?:a|each|every|one)|each\s+(?:in\s+)?)\s*(?:carton|box|ctn)|^\s*\/\s*(?:carton|box|ctn)/i.test(rest.slice(cut >= 0 ? cut : rest.length))) continue;
    if (!desc || NOT_ITEM.has(first) || WEEKDAY_OR_MONTH.test(first) || /^(?:at|for|from|with|by|on|off|up|down)$/.test(first)) {
      // "1080 units" with no description: quantity of the current item
      if (hasUnits && !desc) anchors.push({ d: undefined as unknown as Draft, qty, start: m.index!, end: m.index! + m[0].length });
      continue;
    }
    const d = draftFor(desc);
    setDesc(d, desc);
    d.patch.quantity = qty;
    d.start = m.index!;
    anchors.push({ d, qty, start: m.index!, end: m.index! + m[1].length + 1 + (cut >= 0 ? cut : rest.length) });
  }
  // segment ends: each anchor's attributes run until the next anchor starts
  const real = anchors.filter((a) => a.d).sort((a, b) => a.start - b.start);
  real.forEach((a, i) => {
    a.d.start = a.start;
    const nextAnchor = i + 1 < real.length ? real[i + 1].start : s.length;
    // an item's details end at the end of its sentence, so "…made in the UK. 3 pallets, 620 kg" keeps the weight with the shipment
    const brk = /[.;!?](?=\s|$)|\n/.exec(s.slice(a.end));
    a.d.end = Math.min(nextAnchor, brk ? a.end + brk.index : s.length);
  });
  for (const a of anchors) if (!a.d) a.d = undefined as unknown as Draft;
  for (const a of real) blank(a.start, a.end - a.start);

  /** An item named by SKU or description words, existing or mentioned in this message. */
  const refDraft = (phrase: string): Draft | null => {
    const ex1 = resolveItem(booking.items, phrase);
    if (ex1) return draftFor(ex1.description || ex1.sku);
    const mentioned = drafts.find((d) => sameProduct(d.description, phrase));
    return mentioned ?? null;
  };
  /** The item whose name appears closest before (or just after) a position in the text. */
  const nearestMention = (pos: number): Draft | null => {
    let best: { d: Draft; dist: number } | null = null;
    const consider = (d: Draft, idx: number, len: number) => {
      const dist = idx + len <= pos ? pos - (idx + len) : idx - pos;
      const between = idx + len <= pos ? s.slice(idx + len, pos) : s.slice(pos, idx);
      if (dist > 70 || /[;.!?]/.test(between)) return;
      if (!best || dist < best.dist) best = { d, dist };
    };
    for (const p of itemsPool()) {
      const words = new Set(descTokens(p.description).filter((t) => t.length > 2));
      if (p.existing?.sku) words.add(p.existing.sku.toLowerCase());
      for (const w of words) {
        for (const m of s.matchAll(new RegExp(`(?<![A-Za-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:e?s)?(?![A-Za-z0-9])`, 'gi'))) {
          const d = p.draft ?? (p.existing ? draftFor(p.existing.description || p.existing.sku) : null);
          if (d) consider(d, m.index!, m[0].length);
        }
      }
    }
    return best ? (best as { d: Draft }).d : null;
  };
  const currentDraft = (pos: number | null): Draft | null => {
    if (pos !== null) {
      const inSeg = real.find((a) => pos >= a.d.start && pos < a.d.end);
      if (inSeg) return inSeg.d;
      if (booking.items.length > 1 || drafts.length > 1) {
        const near = nearestMention(pos);
        if (near) return near;
      }
    }
    // the item named in the message, the item we just asked about, or the only/last item
    const mentioned = drafts.filter((d) => !d.descOnly || drafts.length === 1);
    if (mentioned.length === 1) return mentioned[0];
    if (awaitedItemSku) {
      const it = booking.items.find((i) => i.sku === awaitedItemSku.sku);
      if (it) return draftFor(it.description || it.sku);
    }
    if (drafts.length) return drafts[drafts.length - 1];
    const it = booking.items.length === 1 ? booking.items[0] : booking.items[booking.items.length - 1];
    if (it) return draftFor(it.description || it.sku);
    // item details with no item named yet ("£6.50 per unit, 0.3 kg each"): start an item, its description is asked for next
    const blank: Draft = { existing: null, description: '', patch: {}, start: -1, end: -1 };
    drafts.push(blank);
    return blank;
  };
  // "I want to ship some mugs to Germany": a description with no quantity
  if (!booking.items.length && !drafts.length) {
    const say = /\b(?:shipping|ship|sending|send|exporting|export|selling|sell|moving|booking)\s+(?:in\s+)?(?:some\s+|a\s+few\s+|my\s+|our\s+|the\s+|a\s+|an\s+)?([A-Za-z][A-Za-z'\-]*(?:\s+[A-Za-z][A-Za-z'\-]*){0,4}?)(?=\s+(?:to|from|into|in|for|at|via|by|on|and|with)\b|[,.;!?]|$)/i.exec(s);
    if (say) {
      const desc = cleanDescription(say[1]);
      const first = desc.split(' ')[0].toLowerCase();
      const vague = /^(?:it|this|that|them|these|those|something|stuff|things?|goods|items?|stock|products?|shipment|parcels?|packages?|orders?|freight|cargo|pallets?|cartons?|boxes|skids?|one|two|\d+)$/i;
      if (desc && !vague.test(desc) && !NOT_ITEM.has(first) && !matchFixed(desc, [...ALL_DESTINATION_CITIES, ...ORIGIN_CITIES, ...DESTINATION_COUNTRIES], { ...CITY_ALIASES, ...COUNTRY_ALIASES })) {
        const d = draftFor(desc);
        setDesc(d, desc);
        d.descOnly = true;
      }
    }
  }
  // bare "1080 units"
  for (const a of anchors.filter((x) => !x.d)) {
    const d = currentDraft(null);
    if (d && a.qty !== null) {
      d.patch.quantity = a.qty;
      blank(a.start, a.end - a.start);
    }
  }

  for (const u of upcLater) {
    const d = currentDraft(null);
    if (!d) continue;
    if (d.patch.unitsPerCarton === undefined) d.patch.unitsPerCarton = u.upc;
    if (d.patch.quantity === undefined && !d.existing?.quantity) {
      d.patch.quantity = u.cartons * u.upc;
      ex.notes.push(`Worked out ${u.cartons} cartons × ${u.upc} = ${(u.cartons * u.upc).toLocaleString('en-GB')} units.`);
    }
  }

  // ---- 6. weights ----
  const allWeights = findWeights(s);
  const eachRe = /^\s*(?:each|per\s+(?!pallet|skid|shipment|order|booking|carton|box)[a-z]+|apiece|a\s+piece|\/\s*(?:unit|piece))/i;
  const anyEach = allWeights.some((x) => eachRe.test(s.slice(x.index + x.length, x.index + x.length + 22)));
  for (const w of [...allWeights].reverse()) {
    const after = s.slice(w.index + w.length, w.index + w.length + 22);
    const before = s.slice(Math.max(0, w.index - 34), w.index);
    // "each pallet weighs 400kg", "350 kg per pallet": a per-pallet figure, multiplied out to the gross weight
    const perPallet =
      /\b(?:each|per|every)\s+(?:pallet|skid)s?\b[^,.;\d]{0,24}$/i.test(before) ||
      /^\s*(?:per|each|a|every)\s+(?:pallet|skid)\b/i.test(after) ||
      /\b(?:pallets?|skids?)\s+(?:each\s+)?(?:weighs?|weigh|weighing|come\s+to|comes\s+to)\b[^,.;\d]{0,12}$/i.test(before);
    if (perPallet) {
      const setPallets = [...ex.ops].reverse().find((o) => o.op === 'set' && o.field === 'pallets') as { value: number } | undefined;
      const count = setPallets?.value ?? booking.pallets;
      if (count && count > 0) {
        const gross = Math.round(w.kg * count * 100) / 100;
        ex.ops.push({ op: 'set', field: 'grossWeightKg', value: gross });
        if (w.note) ex.notes.push(`Converted ${w.note}`);
        ex.notes.push(`Each pallet ${w.kg} kg × ${count} pallet${count === 1 ? '' : 's'} = ${gross.toLocaleString('en-GB')} kg gross.`);
      } else ex.warnings.push(`I need the number of pallets to turn ${w.kg} kg per pallet into a total gross weight. How many pallets?`);
      blank(w.index, w.length);
      continue;
    }
    const each = eachRe.test(after) || /unit\s+weight\W*(?:is|of|:|=)?\s*$/i.test(before) || /\b(?:each|every|one)\b[^,.;]{0,24}\b(?:weighs?|weighing|weight)\b[^,.;\d]{0,8}$/i.test(before);
    const total = /\b(gross|total|altogether|in total|all in|whole|shipment|consignment|load|everything|overall|all-in)\b/i.test(before + ' ' + after);
    const seg = real.find((a) => w.index >= a.d.start && w.index < a.d.end);
    const refd = /\b(weigh|weighs|weighing|weight)\b/i.test(before) && itemsPool().some((p) => descTokens(p.description).some((t) => t.length > 2 && new RegExp(`\\b${t}`, 'i').test(before)));
    const plausibleUnit = w.kg <= 40;
    let unit = each || (!total && ((!!seg && plausibleUnit && seg.d.patch.unitWeightKg === undefined) || refd));
    if (!each && !total && !seg && !refd) unit = awaits('unitWeightKg') && !awaitsBooking('grossWeightKg') && plausibleUnit && !anyEach;
    if (unit) {
      const d = currentDraft(w.index);
      if (d) d.patch.unitWeightKg = w.kg;
      else ex.ops.push({ op: 'set', field: 'grossWeightKg', value: w.kg });
    } else ex.ops.push({ op: 'set', field: 'grossWeightKg', value: w.kg });
    if (w.note) ex.notes.push(`Converted ${w.note}`);
    blank(w.index, w.length);
  }

  /** "totes £9", "candles are £4": an item's name sits right before the amount. */
  const namedItemBefore = (pos: number): boolean => {
    const m = /([A-Za-z][A-Za-z'\-]*)\s*(?:(?:are|is|at|cost|costs|priced\s+at|for|@|=|:)\s*)*$/i.exec(s.slice(Math.max(0, pos - 30), pos));
    return !!m && !NOT_ITEM.has(m[1].toLowerCase()) && itemsPool().some((p) => sameProduct(p.description, m[1]));
  };

  // ---- 7. money (GBP) ----
  for (const g of [...findGbp(s)].reverse()) {
    const after = s.slice(g.index + g.length, g.index + g.length + 24);
    const before = s.slice(Math.max(0, g.index - 30), g.index);
    const eachCue = /^\s*(?:each|per\s+(?!pallet|skid|shipment|order|booking|carton|box)[a-z]+|apiece|a\s+(?:piece|unit)|\/\s*(?:unit|piece)|ea\b)/i.test(after) || /(?:@|\bat|unit\s+price(?:\s+(?:is|of|to))?|priced\s+at|costs?(?:\s+(?:is|to))?|costing|price(?:\s+(?:is|to|of|at))?|selling\s+(?:at|for))\s*[:=]?\s*$/i.test(before);
    const declaredCue = /\b(declared|total\s+value|worth|value\s+of|valued|goods\s+value|invoice|customs\s+value|total\s+cost|in\s+total|altogether|overall|value\s+is|value)\b/i.test(before + ' ' + after.slice(0, 14)) && !/unit\s+price/i.test(before);
    const seg = real.find((a) => g.index >= a.d.start && g.index < a.d.end);
    let target: 'declared' | 'unit';
    if (eachCue && !/\btotal\b/i.test(before)) target = 'unit';
    else if (declaredCue) target = 'declared';
    else if (namedItemBefore(g.index)) target = 'unit';
    else if (seg && seg.d.patch.unitPrice === undefined) target = 'unit';
    else if (awaitsBooking('declaredValue')) target = 'declared';
    else if (awaits('unitPrice')) target = 'unit';
    else target = 'declared';
    if (target === 'unit') {
      const d = currentDraft(g.index);
      if (d) d.patch.unitPrice = g.value;
      else ex.ops.push({ op: 'set', field: 'declaredValue', value: g.value });
    } else ex.ops.push({ op: 'set', field: 'declaredValue', value: g.value });
    blank(g.index, g.length);
  }

  // a value or weight stated with a label but no currency / unit: "declared value is 5400", "weight 620"
  if (!ex.ops.some((o) => o.op === 'set' && o.field === 'declaredValue')) {
    const v = new RegExp(String.raw`\b(?:declared\s+value|total\s+value|goods\s+value|invoice\s+(?:value|total)|customs\s+value|value|worth)\s*(?:is|of|=|:|to|at)?\s*(?:about|around|approximately|approx\.?|roughly)?\s*(${NUM_SRC})(?![\d,.]*\s*(?:kg|kgs|kilos?|lbs?|pallets?|cartons?|boxes|units?|pcs|%|x\b|per\b|each\b))`, 'i').exec(s);
    if (v) {
      ex.ops.push({ op: 'set', field: 'declaredValue', value: parseNum(v[1]) });
      blank(v.index, v[0].length);
    }
  }
  if (!ex.ops.some((o) => o.op === 'set' && o.field === 'grossWeightKg')) {
    const gw = new RegExp(String.raw`\b(?:gross\s+weight|total\s+weight|weight)\s*(?:is|of|=|:|to|at)?\s*(?:about|around|approximately|approx\.?|roughly)?\s*(${NUM_SRC})(?![\d,.]*\s*(?:kg|kgs|kilos?|lbs?|tonnes?|g\b|each\b|per\b|£|%|pallets?|cartons?|units?))`, 'i').exec(s);
    if (gw) {
      const kg = parseNum(gw[1]);
      ex.ops.push({ op: 'set', field: 'grossWeightKg', value: kg });
      ex.notes.push(`Took ${kg.toLocaleString('en-GB')} as kilograms.`);
      blank(gw.index, gw[0].length);
    }
  }

  // ---- 8. other item attributes ----
  // HS code
  const hsRe = /\b(?:hs|h\.s\.|hts|commodity|tariff)(?:\s*code)?(?:\s+for\s+(?:the\s+|my\s+)?([A-Za-z][A-Za-z0-9'\-]*(?:\s+[A-Za-z0-9'\-]+){0,3}?))?\s*(?:is|of|=|:|-|number|no\.?)?\s*([0-9][0-9 .\-]{3,14}[0-9])/i;
  const hs = hsRe.exec(s);
  if (hs) {
    const d = (hs[1] && refDraft(hs[1])) || currentDraft(hs.index);
    if (d) d.patch.hsCode = hs[2].trim();
    blank(hs.index, hs[0].length);
  } else if (/\b(?:hs|commodity|tariff)(?:\s*code)?\b[^.]{0,20}\b(?:unknown|not sure|don'?t know|no idea|dunno)\b/i.test(s)) {
    const d = currentDraft(null);
    ex.hsUnknownFor = d?.description ?? booking.items[0]?.description ?? '';
  }
  // units per carton
  const upcRe = new RegExp(String.raw`(?<![\w.])(?<!\d,)(${NUM_SRC})\s*(?:units?|pcs|pieces|(?!(?:pallets?|skids?|cartons?|boxes|box|ctns?|kilos?|kgs?|lbs?|pounds?|tonnes?|grams?|gbp)\b)[A-Za-z]{3,15})?\s*(?:per|in\s+(?:a|each|every|one)|\/|a|each|to\s+a|to\s+each|inside\s+each)\s*(?:carton|box|ctn)s?\b`, 'i');
  const upcRe2 = new RegExp(String.raw`\b(?:cartons?|boxes|box)\s+(?:of|hold|holds|contain|contains)\s+(${NUM_SRC})\b`, 'i');
  const upcAll = [...s.matchAll(new RegExp(upcRe.source, 'gi'))];
  const upcHits = upcAll.length ? upcAll : [upcRe2.exec(s)].filter((x): x is RegExpExecArray => !!x);
  for (const upc of upcHits.reverse()) {
    const d = currentDraft(upc.index!);
    if (d) d.patch.unitsPerCarton = parseNum(upc[1]);
    blank(upc.index!, upc[0].length);
  }
  // country of origin
  const cooRe = /\b(?:made|manufactured|produced|sourced|manufacture)\s+in\s+([A-Za-z][A-Za-z.\s]{1,22}?)(?=$|[,;.!?]|\s+(?:and|with|at|for|hs|then)\b)|\b(?:country\s+of\s+origin|origin)\s*(?:is|:|=)?\s*([A-Za-z][A-Za-z.\s]{1,22}?)(?=$|[,;.!?]|\s+(?:and|with|at|for|hs|then)\b)|\b(?:from|in)\s+(china|india|vietnam|turkey|türkiye|germany|uk|u\.k\.|prc)\b(?=\s*(?:$|[,;.!?]))/i;
  const cooM = cooRe.exec(s);
  if (cooM) {
    const text = (cooM[1] ?? cooM[2] ?? cooM[3] ?? '').trim().replace(/^the\s+/i, '');
    const m = matchFixed(text, ITEM_COUNTRIES, COUNTRY_ALIASES);
    if (m) {
      const d = currentDraft(cooM.index);
      if (d) d.patch.countryOfOrigin = m.value;
      blank(cooM.index, cooM[0].length);
    } else if (/^(?:unknown|n\/?a|not sure)/i.test(text)) blank(cooM.index, cooM[0].length);
    else if (text) ex.warnings.push(`"${text}" is not one of the supported countries of origin (${ITEM_COUNTRIES.join(', ')}).`);
  } else if (awaits('countryOfOrigin') && !ex.signals.skip) {
    const m = matchFixed(s.replace(/[^A-Za-z .]/g, ' ').trim(), ITEM_COUNTRIES, COUNTRY_ALIASES) ?? ITEM_COUNTRIES.map((c) => matchFixed(s.match(new RegExp(`\\b${c}\\b`, 'i'))?.[0] ?? '', ITEM_COUNTRIES)).find(Boolean) ?? null;
    if (m) {
      const d = currentDraft(null);
      if (d) d.patch.countryOfOrigin = m.value;
    }
  }
  // "UK-made", "China made"
  const madeAdj = /\b([A-Za-z]{2,14})[\s-]made\b/i.exec(s);
  if (madeAdj && !cooM) {
    const m = matchFixed(madeAdj[1], ITEM_COUNTRIES, COUNTRY_ALIASES);
    const d = m ? currentDraft(madeAdj.index) : null;
    if (m && d) {
      d.patch.countryOfOrigin = m.value;
      blank(madeAdj.index, madeAdj[0].length);
    }
  }
  // SKU
  const skuM = /\bsku\s*(?:is|:|=|-)?\s*([A-Za-z0-9][A-Za-z0-9_\-]{1,20})/i.exec(s) ?? /\b([A-Z]{2,6}-\d{1,4})\b/.exec(s);
  if (skuM) {
    const d = currentDraft(skuM.index);
    if (d && !d.existing) d.patch.sku = skuM[1].toUpperCase();
    else if (d && d.existing && d.existing.sku.toLowerCase() !== skuM[1].toLowerCase() && !resolveItem(booking.items, skuM[1])) d.patch.sku = skuM[1].toUpperCase();
    blank(skuM.index, skuM[0].length);
  }
  // price/qty edits on an existing item by name: "mugs are £6 each" handled by money; "make the mugs 1200" below
  const setQty = /\b(?:make|set|change|update)\s+(?:the\s+)?([A-Za-z][A-Za-z0-9'\-]*(?:\s+[A-Za-z0-9'\-]+){0,3}?)\s+(?:quantity\s+)?(?:to|=)\s+(\d[\d,]*)\b(?!\s*(?:pallets?|cartons?|kg))/i.exec(s);
  if (setQty && resolveItem(booking.items, setQty[1])) {
    const t = resolveItem(booking.items, setQty[1])!;
    ex.ops.push({ op: 'update_item', match: t.sku, field: 'quantity', value: parseNum(setQty[2]), mode: 'set' });
    blank(setQty.index, setQty[0].length);
  }

  // ---- 9. booking-level words ----
  const words = s;
  // unsupported places (we say so and list what we serve)
  const unsupported = new Set<string>();
  for (const p of UNSUPPORTED_PLACES) {
    if (new RegExp(`(?<![A-Za-z])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z])`, 'i').test(words)) unsupported.add(p);
  }
  const placeStop = new Set(['warehouse', 'business', 'cheapest', 'fastest', 'balanced', 'reliable', 'friday', 'monday', 'tuesday', 'wednesday', 'thursday', 'saturday', 'sunday', 'tomorrow', 'today', 'me', 'you', 'us', 'the', 'a', 'an', 'it', 'them', 'one', 'my', 'our']);
  const generic = /\b(?:ship(?:ping)?\s+to|send(?:ing)?\s+to|deliver(?:ed|ing)?\s+to|going\s+to|change\s+(?:it\s+)?to|move\s+(?:it\s+)?to|switch\s+(?:it\s+)?to|destination\s+(?:is|:)|collect(?:ed|ion)?\s+from)\s+(?:a\s+|the\s+)?([A-Z][A-Za-zäöüéèßÄÖÜ'\-]{2,})/g;
  for (const m of words.matchAll(generic)) {
    const w = m[1];
    const known = matchFixed(w, [...ALL_DESTINATION_CITIES, ...ORIGIN_CITIES, ...DESTINATION_COUNTRIES, 'United Kingdom'], { ...CITY_ALIASES, ...COUNTRY_ALIASES });
    if (!known && !placeStop.has(w.toLowerCase()) && !WEEKDAY_OR_MONTH.test(w) && !/^(?:warehouse|business|cheapest|fastest|balanced)/i.test(w)) unsupported.add(w);
  }
  if (unsupported.size) {
    ex.warnings.push(`${[...unsupported].join(', ')} ${unsupported.size > 1 ? 'are' : 'is'} not supported. I can collect from ${ORIGIN_CITIES.join(', ')} and deliver to Germany (Berlin, Frankfurt, Hamburg), France (Paris, Lyon) or the Netherlands (Amsterdam, Rotterdam).`);
  }
  // cities
  const seenCity = new Set<string>();
  for (const m of words.matchAll(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'\-]*(?:\s+am\s+Main)?/g)) {
    const tok = m[0];
    if (unsupported.has(tok)) continue;
    const isCap = /^[A-ZÀ-Ý]/.test(tok);
    const origin = matchFixed(tok, ORIGIN_CITIES, CITY_ALIASES);
    const dest = matchFixed(tok, ALL_DESTINATION_CITIES, CITY_ALIASES);
    const hit = (origin && (origin.how !== 'fuzzy' || isCap) ? origin : null) ?? (dest && (dest.how !== 'fuzzy' || isCap) ? dest : null);
    if (hit && !seenCity.has(hit.value)) {
      seenCity.add(hit.value);
      const isOrigin = (ORIGIN_CITIES as readonly string[]).includes(hit.value);
      ex.ops.push({ op: 'set', field: isOrigin ? 'originCity' : 'destinationCity', value: hit.value });
      if (hit.how !== 'exact') ex.notes.push(`Read "${tok}" as ${hit.value}`);
    }
  }
  // country without a city ("to Germany")
  if (!ex.ops.some((o) => o.op === 'set' && o.field === 'destinationCity')) {
    for (const m of words.matchAll(/\b(Germany|Deutschland|France|Netherlands|Holland|DE|FR|NL)\b|\b(germany|deutschland|france|netherlands|holland|the netherlands)\b/gi)) {
      const c = matchFixed(m[0], DESTINATION_COUNTRIES, COUNTRY_ALIASES);
      if (c && !/^(de|fr|nl)$/.test(m[0]) || (c && /^(DE|FR|NL)$/.test(m[0]))) {
        ex.countryOnly = c!.value;
        ex.ops.push({ op: 'set', field: 'destinationCountry', value: c!.value });
        break;
      }
    }
  }
  // destination type
  const lowerWords = words.replace(/\bfrom\s+(?:our|my|the|a)\s+warehouse\b/gi, ' ');
  if (/\b(warehouse|fulfil?ment\s+(?:centre|center)|distribution\s+(?:centre|center)|fba|depot)\b/i.test(lowerWords)) ex.ops.push({ op: 'set', field: 'destinationType', value: 'Warehouse' });
  else if (/\b(business\s+address|office|shop|store|retail(?:er)?|customer'?s?\s+(?:home|address|premises)|residential|a\s+business|commercial\s+address|business)\b/i.test(lowerWords) && !/\bbusiness\s+(?:name|called|is)\b/i.test(words)) {
    ex.ops.push({ op: 'set', field: 'destinationType', value: 'Business address' });
  }
  // appointment
  if (/\b(?:no|not|n't|without|haven'?t|hasn'?t|yet to|still need(?:s)? to|need to)\b[^.]{0,25}\b(?:appointment|delivery\s+slot|slot)\b|\bappointment\b[^.]{0,20}\b(?:not|no|isn'?t|hasn'?t|yet|pending|needed)\b/i.test(words)) {
    ex.ops.push({ op: 'set', field: 'appointmentBooked', value: false });
  } else if (/\b(?:appointment|delivery\s+slot|slot)\b[^.]{0,25}\b(?:booked|confirmed|arranged|made|sorted|in place|yes)\b|\b(?:booked|have|got|confirmed|arranged)\b[^.]{0,20}\b(?:appointment|delivery\s+slot|slot)\b/i.test(words)) {
    ex.ops.push({ op: 'set', field: 'appointmentBooked', value: true });
  }
  // priority
  const pr = priorityFrom(words, awaitsBooking('priority'));
  if (pr) ex.ops.push({ op: 'set', field: 'priority', value: pr });
  // seller name
  const seller = sellerFrom(textRaw) ?? leadingCompany(textRaw, booking);
  if (seller) ex.ops.push({ op: 'set', field: 'sellerName', value: seller });

  // ---- 10. bare answers to what we just asked ----
  bareAnswers(ex, s, ctx, drafts, currentDraft);

  // restricted goods mentioned in passing ("chargers with lithium batteries") must reach rule R-06 even though the product name stops earlier
  if (!ex.signals.question) {
    const reds = scanDangerous(textRaw).filter((h) => h.severity === 'Red');
    if (reds.length) {
      const d = currentDraft(null);
      const current = d ? (d.existing ? (d.patch.description ?? d.existing.description) : d.description) : '';
      const missing = reds.filter((h) => !scanDangerous(`${current} ${d?.existing?.sku ?? ''}`).some((x) => x.label === h.label));
      if (d && missing.length) {
        const text = `${current}${current ? ' ' : ''}(${missing.map((h) => h.label).join(', ')})`.trim();
        d.patch.description = text;
        if (!d.existing) d.description = text;
      }
    }
  }

  // ---- 11. turn drafts into ops ----
  for (const d of drafts) {
    const p = { ...d.patch };
    if (d.existing) {
      for (const [field, value] of Object.entries(p) as Array<[ItemFieldName, string | number]>) {
        ex.ops.push({ op: 'update_item', match: d.existing.sku, field, value, mode: 'set' });
      }
    } else if (Object.keys(p).length || d.description) {
      ex.ops.push({ op: 'add_item', item: { ...p, description: d.description || p.description } });
    }
  }
  return ex;
}

function priorityFrom(text: string, awaiting: boolean): string | null {
  const t = text.toLowerCase();
  const strong: Array<[RegExp, string]> = [
    [/\b(cheapest|cheaper|cheap(?:ly)?|lowest\s+(?:cost|price)|least\s+expensive|budget|save\s+money|lowest\s+price|(?:price|cost)\s+(?:matters|is\s+(?:key|most|what\s+matters|the\s+priority))|keep\s+(?:it|costs?)\s+(?:low|down))\b/, 'Cheapest'],
    [/\b(fastest|quickest|as\s+fast\s+as\s+possible|speed\s+(?:matters|is\s+key|is\s+most)|urgent(?:ly)?|asap|express|quick(?:ly)?|soonest|as\s+soon\s+as\s+possible|time[-\s]?critical|speed\s+is\s+(?:key|critical)|in\s+a\s+hurry|rush)\b/, 'Fastest'],
    [/\b(most\s+reliable|reliab(?:le|ility)|on[-\s]?time|dependab(?:le|ility)|never\s+late)\b/, 'Most reliable'],
    [/\b(balanced|balance|no\s+(?:strong\s+)?preference|don'?t\s+mind|do\s+not\s+mind|best\s+trade-?off|a\s+mix|bit\s+of\s+everything|middle\s+ground|whatever|either\s+is\s+fine|all[-\s]?round|best\s+overall|overall\s+best|good\s+mix|compromise|bit\s+of\s+both)\b/, 'Balanced'],
  ];
  for (const [re, v] of strong) if (re.test(t)) return v;
  if (awaiting) {
    if (/\b(fast|quick)\b/.test(t)) return 'Fastest';
    if (/\b(cost|price|money)\b/.test(t)) return 'Cheapest';
  }
  return null;
}

/** "Acme Ltd, 100 mugs at £5…": a company-looking name at the very start, before the first comma. */
function leadingCompany(raw: string, booking: Booking): string | null {
  if (booking.sellerName) return null;
  const m = /^\s*([A-Z][\w&'.\-]*(?:\s+(?:&|[A-Z0-9][\w&'.\-]*)){0,4})\s*[,:\-\u2013]\s+\S/.exec(raw.replace(/[\u2019\u2018]/g, "'"));
  if (!m) return null;
  const name = m[1].replace(/[,;:]+$/, '').trim();
  if (!/\b(?:Ltd\.?|Limited|Co\.?|Inc\.?|LLC|Plc|Corp\.?|Bros\.?|Group|Goods|Trading|Supplies|Imports|Exports|Wholesale|Studios?|Stores?|Shop|Foods|Crafts|Designs|Brands|Company)$/i.test(name)) return null;
  if (matchFixed(name, [...ORIGIN_CITIES, ...ALL_DESTINATION_CITIES])) return null;
  return name;
}

/** Words and phrases that are answers to other questions, never a company name. */
const NOT_A_NAME = /^(?:ASAP|URGENT|OK|N\/?A|NA|FBA|ETA|UK|TBC|TBD|NOW|TODAY|NEXT|MORE|YES|NO|(?:collect|collection|deliver|delivery|ship|shipping|send|sending|pick|picking|going|from|to|in|at|on|by|for|with|it|that|this|actually|make|change|set|add|remove|drop|now|also|please|sorry|okay|hmm|um|well|so|maybe|what|how|why|can|could)\b.*)$/i;

const NAME_BAD = /^(?:shipping|sending|looking|trying|booking|going|ready|just|based|a|an|the|not|on|in|at|to|from|here|calling|writing|new|your)$/i;
function sellerFrom(raw: string): string | null {
  const text = raw.replace(/[’‘]/g, "'");
  const cap = String.raw`([A-Z][\w&'.\-]*(?:\s+(?:&|and|of|the|(?!I\b)[A-Z0-9][\w&'.\-]*)){0,5})`;
  const ci = (w: string) => w.replace(/[a-z]/gi, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`);
  const nounCue = ['seller', 'company', 'business', 'brand', 'shop', 'store', 'firm'].map(ci).join('|');
  const patterns = [
    new RegExp(String.raw`\b(?:${nounCue})(?:\s+${ci('name')})?\s*(?:${ci('is')}|:|=|${ci('called')}|${ci('named')})\s+(?:${ci('the')}\s+)?${cap}`),
    new RegExp(String.raw`\b(?:${ci('my')}|${ci('our')})\s+(?:${nounCue})\s+(?:${ci('is')}\s+)?(?:${ci('called')}\s+|${ci('named')}\s+)?${cap}`),
    new RegExp(String.raw`\b(?:[Ww]e're|[Ww]e\s+are|I'm|I\s+am|i'm|i\s+am)\s+(?:from|with|at)\s+${cap}`),
    new RegExp(String.raw`\b(?:[Ww]e're|[Ww]e\s+are)\s+${cap}`),
    new RegExp(String.raw`\b[Ii]\s+(?:work|am working)\s+(?:for|at|with)\s+${cap}`),
    new RegExp(String.raw`\b[Ww]e\s+(?:work|are working)\s+(?:for|at|with)\s+${cap}`),
    new RegExp(String.raw`\b${ci('on')}\s+${ci('behalf')}\s+${ci('of')}\s+${cap}`),
    new RegExp(String.raw`\b[Tt]his\s+is\s+(?:[A-Z][a-z]+\s+(?:from|at|of)\s+)?${cap}\s+(?:here|speaking)`),
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (!m) continue;
    let name = m[1].trim().replace(/[.,;:!]+$/, '').replace(/\s+(?:and|the|of)$/i, '');
    // do not swallow "Northfield Goods and I want…"
    name = name.split(/\s+(?:and|but|who|which|that)\s+(?=[a-z])/)[0].trim();
    // stop at the end of a sentence ("Northfield Goods. Shipping…") but keep "Ltd." / "Co."
    const toks = name.split(/\s+/);
    const kept: string[] = [];
    for (const t of toks) {
      kept.push(t);
      if (/\.$/.test(t)) break;
    }
    name = kept.join(' ').replace(/[,;:!]+$/, '').replace(/(?<!\bLtd|\bCo|\bInc|\bLLC|\bPlc|\bBros|\bCorp)\.$/, '').trim();
    if (!name || NAME_BAD.test(name.split(' ')[0])) continue;
    if (matchFixed(name, [...ORIGIN_CITIES, ...ALL_DESTINATION_CITIES])) continue;
    if (WEEKDAY_OR_MONTH.test(name.split(' ')[0])) continue;
    return name;
  }
  return null;
}

function bareAnswers(
  ex: Extracted,
  s: string,
  ctx: ParseContext,
  drafts: Draft[],
  current: (pos: number | null) => Draft | null,
): void {
  const awaiting = ctx.awaiting;
  if (!awaiting.length) return;
  const hasSet = (f: string) => ex.ops.some((o) => (o.op === 'set' || o.op === 'increment' || o.op === 'decrement') && o.field === f);
  const text = s.trim();
  const plain = text.replace(/[.!]+$/, '').trim();

  // appointment yes/no
  const apptAwaited = awaiting.some((a) => a.scope === 'booking' && a.field === 'appointmentBooked');
  if (apptAwaited && !hasSet('appointmentBooked')) {
    if (ex.signals.yes) ex.ops.push({ op: 'set', field: 'appointmentBooked', value: true });
    else if (ex.signals.no) ex.ops.push({ op: 'set', field: 'appointmentBooked', value: false });
  }

  // seller name
  const sellerAwaited = awaiting.some((a) => a.scope === 'booking' && a.field === 'sellerName');
  if (sellerAwaited && !hasSet('sellerName') && !ex.signals.skip && awaiting.length > 1) {
    // "Northfield Goods, collecting from Manchester…": a leading capitalised phrase before the first comma
    const lead = /^\s*(?:it'?s\s+|we are\s+|we're\s+)?([A-Z][\w&'.\-]*(?:\s+(?:&|and|of|the|[A-Z0-9][\w&'.\-]*)){0,4})\s*(?:,|;|$)/.exec(ctx.rawText ?? '');
    const notAName = (x: string) => NOT_A_NAME.test(x) || priorityFrom(x, false) !== null || findDate(x, ctx.today) !== null;
    if (lead && !notAName(lead[1]) && !matchFixed(lead[1], [...ORIGIN_CITIES, ...ALL_DESTINATION_CITIES, ...DESTINATION_COUNTRIES], { ...CITY_ALIASES, ...COUNTRY_ALIASES }) && !WEEKDAY_OR_MONTH.test(lead[1]) && !/^(?:yes|no|hi|hello|hey|thanks|ok|okay|cheapest|fastest|balanced|warehouse|business)\b/i.test(lead[1])) {
      ex.ops.push({ op: 'set', field: 'sellerName', value: lead[1].trim() });
    }
  }
  if (sellerAwaited && !hasSet('sellerName') && !ex.signals.skip) {
    const onlyThis = awaiting.length === 1;
    const candidate = plain.replace(/^(?:it'?s|its|it is|we are|we're|i am|i'm|this is|my (?:company|business) is|seller(?: name)? is|called|name is|the name is)\s+/i, '').trim();
    const looksLikeCommand = NOT_A_NAME.test(candidate) || ex.warnings.length > 0 || priorityFrom(candidate, false) !== null || findDate(candidate, ctx.today) !== null;
    if (onlyThis && candidate && candidate.length <= 60 && !/\d/.test(candidate) && !looksLikeCommand && !drafts.length && !ex.ops.length && !ex.signals.yes && !ex.signals.no && !ex.signals.question && !ex.signals.ambiguous) {
      ex.ops.push({ op: 'set', field: 'sellerName', value: candidate.replace(/\s+/g, ' ') });
    }
  }

  // numeric answers
  const numbers = [...plain.matchAll(new RegExp(String.raw`(?<![\w.])(${NUM_SRC})(?![\w.])`, 'g'))].map((m) => parseNum(m[1]));
  const numericSlots = awaiting.filter((a) => ['pallets', 'cartons', 'declaredValue', 'grossWeightKg', 'quantity', 'unitPrice', 'unitsPerCarton', 'unitWeightKg'].includes(a.field));
  const unlabelled = numericSlots.filter((a) => {
    if (a.scope === 'booking') return !hasSet(a.field);
    return true;
  });
  const alreadyItem = (sku: string, f: string) => drafts.some((d) => d.patch[f as keyof ItemPatch] !== undefined && (d.existing?.sku === sku || (!d.existing && sku === '*new*')));
  let pending = unlabelled.filter((a) => (a.scope === 'booking' ? true : !alreadyItem(a.sku, a.field)));
  const onlyNumbers = !/[A-Za-z]/.test(plain.replace(/[£,]/g, ''));
  if (onlyNumbers && numbers.length > 0 && numbers.length < pending.length) pending = pending.slice(0, numbers.length);
  if (pending.length && numbers.length === pending.length && !ex.signals.skip && !/[A-Za-z]{4,}/.test(plain.replace(/\b(?:pounds?|gbp|kg|kgs|kilos?|units?|pallets?|cartons?|boxes|each|per|about|around|roughly|approx|approximately|it'?s|its|is|are|total|of|about)\b/gi, ''))) {
    pending.forEach((slot, i) => {
      const v = numbers[i];
      if (slot.scope === 'booking') ex.ops.push({ op: 'set', field: slot.field, value: v });
      else {
        const d = slot.sku === '*new*' ? null : booking_item_draft(ctx, drafts, slot.sku);
        if (d) d.patch[slot.field as 'quantity'] = v;
      }
    });
  }

  // HS code
  const hsSlot = awaiting.find((a) => a.scope === 'item' && a.field === 'hsCode') as Extract<Slot, { scope: 'item' }> | undefined;
  if (hsSlot && !alreadyItem(hsSlot.sku, 'hsCode') && !ex.signals.skip) {
    const m = /^(?:it'?s\s+|its\s+|is\s+)?(\d[\d .\-]{3,14}\d)$/.exec(plain);
    if (m) {
      const d = booking_item_draft(ctx, drafts, hsSlot.sku);
      if (d) d.patch.hsCode = m[1].trim();
    }
  }

  // description of a new item
  const newItem = awaiting.some((a) => a.scope === 'item' && a.sku === '*new*' && a.field === 'description');
  if (newItem && !drafts.length && !ex.signals.skip && plain && !ex.signals.yes && !ex.signals.no && !ex.signals.undo && !ex.signals.startOver && !ex.signals.runChecks) {
    const rest = plain.replace(/^(?:i(?:'m| am)?\s+(?:selling|shipping|sending)|we(?:'re| are)?\s+(?:selling|shipping|sending)|it'?s|its|they(?:'re| are)|some|my|our)\s+/i, '');
    if (rest.length <= 80 && /[A-Za-z]{3}/.test(rest) && !NOT_A_NAME.test(rest) && !ex.warnings.length && !ex.ops.some((o) => o.op === 'set' && ['pallets', 'cartons'].includes(o.field))) {
      const d: Draft = { existing: null, description: cleanDescription(rest), patch: {}, start: -1, end: -1 };
      d.patch.description = d.description;
      drafts.push(d);
    }
  }
  void current;
}

function booking_item_draft(ctx: ParseContext, drafts: Draft[], sku: string): Draft | null {
  const it = ctx.booking.items.find((i) => i.sku === sku);
  if (!it) return null;
  let d = drafts.find((x) => x.existing === it);
  if (!d) {
    d = { existing: it, description: it.description, patch: {}, start: -1, end: -1 };
    drafts.push(d);
  }
  return d;
}
