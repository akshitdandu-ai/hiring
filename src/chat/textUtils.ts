import { addDays, addMonths, addWeeks, endOfMonth, format, getDay, startOfMonth, startOfWeek } from 'date-fns';

// ---------- number words ----------
const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const NUMWORD = new Set([...Object.keys(ONES), ...Object.keys(TENS), 'hundred', 'thousand', 'dozen', 'half']);

/**
 * Replace number words with digits: "three" → "3", "a dozen" → "12", "two hundred and fifty" → "250", "half a dozen" → "6".
 * Leaves everything else (including case) alone.
 */
export function convertNumberWords(text: string): string {
  const parts = text.split(/(\s+)/);
  const out: string[] = [];
  let i = 0;
  const isWord = (p: string | undefined) => !!p && NUMWORD.has(p.toLowerCase().replace(/[^a-z]/g, '')) && /^[A-Za-z]+[,.;:!?]?$/.test(p);
  while (i < parts.length) {
    const tok = parts[i];
    const clean = tok.toLowerCase().replace(/[^a-z]/g, '');
    // "half a dozen"
    if (clean === 'half' && parts[i + 2]?.toLowerCase() === 'a' && parts[i + 4]?.toLowerCase().startsWith('dozen')) {
      out.push('6' + (/[,.;:!?]$/.test(parts[i + 4]) ? parts[i + 4].slice(-1) : ''));
      i += 5;
      continue;
    }
    // "a dozen" / "a hundred" / "a thousand"
    if ((clean === 'a' || clean === 'an') && /^(dozen|hundred|thousand)/i.test(parts[i + 2] ?? '')) {
      i += 2;
      continue; // the next token converts as "dozen" alone below with an implicit 1
    }
    if (isWord(tok)) {
      let total = 0;
      let current = 0;
      let j = i;
      let last = '';
      let any = false;
      let endJ = i;
      while (j < parts.length) {
        const t = parts[j];
        const c = t.toLowerCase().replace(/[^a-z]/g, '');
        if (/^\s+$/.test(t)) {
          j++;
          continue;
        }
        const next = parts.slice(j + 1).find((p) => !/^\s+$/.test(p));
        if (c === 'and' && any && next && isWord(next) && (last === 'hundred' || last === 'thousand')) {
          j++;
          continue;
        }
        if (c in ONES) current += ONES[c];
        else if (c in TENS) current += TENS[c];
        else if (c === 'hundred') current = (current || 1) * 100;
        else if (c === 'thousand') {
          total += (current || 1) * 1000;
          current = 0;
        } else if (c === 'dozen') {
          current = (current || 1) * 12;
        } else break;
        any = true;
        last = c;
        j++;
        endJ = j;
        if (/[,.;:!?]$/.test(t)) break;
      }
      if (any) {
        const lastTok = parts[endJ - 1];
        out.push(String(total + current) + (/[,.;:!?]$/.test(lastTok) ? lastTok.slice(-1) : ''));
        i = endJ;
        continue;
      }
    }
    out.push(tok);
    i++;
  }
  return out.join('');
}

/** "5k" → 5000, "1.2k" → 1200 (never "5kg"). */
export function expandK(text: string): string {
  return text.replace(/(?<![\w.])(\d+(?:\.\d+)?)\s?k\b(?!g)/gi, (_, n) => String(Math.round(parseFloat(n) * 1000)));
}

export const NUM_SRC = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;
export const parseNum = (s: string) => parseFloat(s.replace(/,/g, ''));

// ---------- weights ----------
export interface WeightHit {
  kg: number;
  /** text of the whole match */
  raw: string;
  index: number;
  length: number;
  note?: string;
  unit: 'kg' | 'tonnes' | 'lbs' | 'g';
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Find weights and convert to kg. Pounds *weight* needs "lb(s)" – "pounds" alone means money. */
export function findWeights(text: string): WeightHit[] {
  const hits: WeightHit[] = [];
  const re = new RegExp(String.raw`(?<![\w.])(${NUM_SRC})\s*(kgs?|kilos?|kilograms?|kilogrammes?|tonnes?|tons?|lbs?|pounds?\s+weight|grams?|gm|g)(?![a-z])`, 'gi');
  for (const m of text.matchAll(re)) {
    const n = parseNum(m[1]);
    const u = m[2].toLowerCase().replace(/\s+/g, ' ');
    let kg: number;
    let unit: WeightHit['unit'];
    let note: string | undefined;
    if (/^(kg|kgs|kilo|kilos|kilogram|kilograms|kilogramme|kilogrammes)$/.test(u)) {
      kg = n;
      unit = 'kg';
    } else if (/^(tonne|tonnes|ton|tons)$/.test(u)) {
      kg = n * 1000;
      unit = 'tonnes';
      note = `${m[1]} ${u} = ${r2(kg)} kg`;
    } else if (/^lbs?$|^pounds? weight$/.test(u)) {
      kg = r2(n * 0.45359237);
      unit = 'lbs';
      note = `${m[1]} lbs = ${kg} kg`;
    } else {
      kg = n / 1000;
      unit = 'g';
      note = `${m[1]} g = ${r2(kg * 1000) / 1000} kg`;
    }
    hits.push({ kg, raw: m[0], index: m.index!, length: m[0].length, note, unit });
  }
  return hits;
}

// ---------- money ----------
export interface MoneyHit {
  value: number;
  raw: string;
  index: number;
  length: number;
}

export function findGbp(text: string): MoneyHit[] {
  const hits: MoneyHit[] = [];
  const re = new RegExp(String.raw`(?:£\s*(${NUM_SRC})(?![\d])|(?<![\w.£€$])(${NUM_SRC})\s*(?:pounds?(?!\s+weight)|gbp|quid|sterling)\b|\bgbp\s*(${NUM_SRC}))`, 'gi');
  for (const m of text.matchAll(re)) {
    const v = parseNum((m[1] ?? m[2] ?? m[3])!);
    hits.push({ value: v, raw: m[0], index: m.index!, length: m[0].length });
  }
  return hits;
}

export interface ForeignMoney {
  currency: 'EUR' | 'USD';
  raw: string;
  index: number;
  length: number;
}

export function findForeignMoney(text: string): ForeignMoney[] {
  const out: ForeignMoney[] = [];
  const re = new RegExp(String.raw`(?:(€|\$)\s*(?:${NUM_SRC})|(?<![\w.])(?:${NUM_SRC})\s*(euros?|eur|usd|dollars?|bucks)\b|\b(eur|usd)\s*(?:${NUM_SRC}))`, 'gi');
  for (const m of text.matchAll(re)) {
    const tag = (m[1] ?? m[2] ?? m[3]).toLowerCase();
    out.push({ currency: tag === '€' || tag.startsWith('eur') ? 'EUR' : 'USD', raw: m[0], index: m.index!, length: m[0].length });
  }
  // currency named without an amount: "it's worth about 5000 in euros"
  if (!out.length) {
    const named = /\b(?:in|using)\s+(euros?|dollars?|usd|eur)\b/i.exec(text);
    if (named) out.push({ currency: /^e/i.test(named[1]) ? 'EUR' : 'USD', raw: named[0], index: named.index, length: named[0].length });
  }
  return out;
}

// ---------- dates ----------
const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const WEEKDAYS: Record<string, number> = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6 };

export interface DateHit {
  iso: string;
  raw: string;
  index: number;
  length: number;
  /** How we read it, for the reply ("next Friday → Fri 6 Nov 2026"). */
  explain: string;
}

const iso = (d: Date) => format(d, 'yyyy-MM-dd');
const realDate = (y: number, m: number, d: number): Date | null => {
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? dt : null;
};
/** Without a year: the next occurrence on or after today. */
function nextOccurrence(d: number, m: number, today: Date): Date | null {
  for (const y of [today.getFullYear(), today.getFullYear() + 1, today.getFullYear() + 2]) {
    const dt = realDate(y, m, d);
    if (dt && dt >= today) return dt;
  }
  return null;
}
const fullYear = (y: string) => (y.length === 2 ? 2000 + +y : +y);

export function findDate(text: string, today: Date): DateHit | null {
  const monthNames = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
  const dayNames = Object.keys(WEEKDAYS).sort((a, b) => b.length - a.length).join('|');
  let m: RegExpExecArray | null;
  const hit = (d: Date | null, mm: RegExpExecArray, explain?: string): DateHit | null =>
    d ? { iso: iso(d), raw: mm[0], index: mm.index, length: mm[0].length, explain: explain ?? mm[0].trim() } : null;

  m = /\b(day after tomorrow)\b/i.exec(text);
  if (m) return hit(addDays(today, 2), m);
  m = /\b(tomorrow|tmrw|tmw)\b/i.exec(text);
  if (m) return hit(addDays(today, 1), m);
  m = /\b(today|asap|straight away|right away)\b/i.exec(text);
  if (m && /today/i.test(m[1])) return hit(today, m);
  m = /\bready\s+(?:now|immediately|straight\s+away|right\s+away|to\s+go)\b|\b(?:immediately|right\s+now)\b/i.exec(text);
  if (m) return hit(today, m, 'now → today');
  m = /\b(?:(?:at\s+)?the\s+)?end\s+of\s+(?:the\s+|this\s+)?month\b|\bmonth[-\s]end\b/i.exec(text);
  if (m) return hit(endOfMonth(today), m, `${m[0].trim()} → ${format(endOfMonth(today), 'EEE d MMM yyyy')}`);
  m = /\b(?:start|beginning)\s+of\s+next\s+month\b|\bnext\s+month\b/i.exec(text);
  if (m) {
    const d = startOfMonth(addMonths(today, 1));
    return hit(d, m, `${m[0].trim()} → ${format(d, 'EEE d MMM yyyy')}`);
  }
  m = /\bend\s+of\s+(next|this|the)\s+week\b/i.exec(text);
  if (m) {
    const monday = addWeeks(startOfWeek(today, { weekStartsOn: 1 }), /next/i.test(m[1]) ? 1 : 0);
    const d = addDays(monday, 4);
    return hit(d, m, `${m[0].trim()} → ${format(d, 'EEE d MMM yyyy')}`);
  }
  m = /\bnext\s+week\b/i.exec(text);
  if (m) {
    const d = addWeeks(startOfWeek(today, { weekStartsOn: 1 }), 1);
    return hit(d, m, `${m[0].trim()} → ${format(d, 'EEE d MMM yyyy')}`);
  }
  m = /\bin\s+(\d+)\s+(day|days|week|weeks)\b/i.exec(text);
  if (m) return hit(addDays(today, /week/i.test(m[2]) ? +m[1] * 7 : +m[1]), m);
  m = new RegExp(String.raw`\b(?:(next|this|on|by|for)\s+)?(${dayNames})\b`, 'i').exec(text);
  if (m && !/^(sat|sun|mon|wed|fri|thu|tue)$/i.test(m[2]) || (m && m[1])) {
    const target = WEEKDAYS[m![2].toLowerCase()];
    const mod = (m![1] ?? '').toLowerCase();
    let d: Date;
    if (mod === 'next') {
      // the target day in the week after this one (weeks start on Monday)
      d = addDays(addWeeks(startOfWeek(today, { weekStartsOn: 1 }), 1), (target + 6) % 7);
    } else {
      const diff = (target - getDay(today) + 7) % 7 || 7;
      d = addDays(today, diff);
    }
    return hit(d, m!, `${m![0].trim()} → ${format(d, 'EEE d MMM yyyy')}`);
  }
  // 5th Nov, 5 November 2026
  m = new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:of\s+)?(${monthNames})\.?(?:,?\s*(\d{4}))?\b`, 'i').exec(text);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    const d = m[3] ? realDate(+m[3], mo, +m[1]) : nextOccurrence(+m[1], mo, today);
    return hit(d, m, `${m[0].trim()} → ${d ? format(d, 'EEE d MMM yyyy') : '?'}`);
  }
  // November 5th
  m = new RegExp(String.raw`\b(${monthNames})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b`, 'i').exec(text);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    const d = m[3] ? realDate(+m[3], mo, +m[2]) : nextOccurrence(+m[2], mo, today);
    return hit(d, m, `${m[0].trim()} → ${d ? format(d, 'EEE d MMM yyyy') : '?'}`);
  }
  // 05/11/2026, 5-11-26, 05/11  (always day-first); dots only with a year
  m = /(?<![\d.,£\w])(\d{1,2})([/-])(\d{1,2})(?:\2(\d{2}|\d{4}))?(?![\d/\-]|\.\d)/.exec(text);
  const dotted = !m ? /(?<![\d.,£\w])(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})(?![\d])/.exec(text) : null;
  if (m || dotted) {
    const day = m ? +m[1] : +dotted![1];
    const mon = m ? +m[3] : +dotted![2];
    const yr = m ? m[4] : dotted![3];
    const mm = (m ?? dotted)!;
    const d = yr ? realDate(fullYear(yr), mon, day) : nextOccurrence(day, mon, today);
    return hit(d, mm, `${mm[0].trim()} → ${d ? format(d, 'EEE d MMM yyyy') : '?'}`);
  }
  return null;
}
