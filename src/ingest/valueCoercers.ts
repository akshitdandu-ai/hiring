import { format } from 'date-fns';
import { cleanHsCode } from '../util/hs';

export type Coerced<T> = { kind: 'ok'; value: T } | { kind: 'blank' } | { kind: 'bad'; reason: string };

export const isBlank = (v: unknown): boolean => v === null || v === undefined || (typeof v === 'string' && v.replace(/ /g, ' ').trim() === '');

/** 5400, "5,400", "£5,400.00", " 5400 ", "GBP 5400". */
export function coerceNumber(v: unknown): Coerced<number> {
  if (isBlank(v)) return { kind: 'blank' };
  if (typeof v === 'number') return Number.isFinite(v) ? { kind: 'ok', value: v } : { kind: 'bad', reason: 'not a finite number' };
  if (typeof v === 'boolean' || v instanceof Date) return { kind: 'bad', reason: 'not a number' };
  const s = String(v).replace(/ /g, ' ').trim();
  const cleaned = s.replace(/^(?:£|gbp)\s*/i, '').replace(/\s*(?:gbp|kg|kgs)$/i, '').replace(/,/g, '').replace(/\s+/g, '');
  if (!/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(cleaned)) return { kind: 'bad', reason: `"${s}" is not a number` };
  return { kind: 'ok', value: Number(cleaned) };
}

const pad = (n: number) => String(n).padStart(2, '0');

function isoIfReal(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Excel serial day number → ISO date (1900 date system). */
export function serialToIso(n: number): string | null {
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return null;
  const ms = Math.round((Math.floor(n) - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Always day-first. Accepts Excel serials, Date objects, DD-MM-YYYY, DD/MM/YYYY, D-M-YY, DD.MM.YYYY and ISO. */
export function coerceDate(v: unknown): Coerced<string> {
  if (isBlank(v)) return { kind: 'blank' };
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return { kind: 'bad', reason: 'invalid date' };
    return { kind: 'ok', value: format(v, 'yyyy-MM-dd') };
  }
  if (typeof v === 'number') {
    const iso = serialToIso(v);
    return iso ? { kind: 'ok', value: iso } : { kind: 'bad', reason: `${v} is not a date` };
  }
  const s = String(v).trim();
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const iso = serialToIso(Number(s));
    if (iso) return { kind: 'ok', value: iso };
  }
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) {
    const iso = isoIfReal(+m[1], +m[2], +m[3]);
    return iso ? { kind: 'ok', value: iso } : { kind: 'bad', reason: `"${s}" is not a real date` };
  }
  m = /^(\d{1,2})[-/.\s](\d{1,2})[-/.\s](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const iso = isoIfReal(year, +m[2], +m[1]);
    return iso ? { kind: 'ok', value: iso } : { kind: 'bad', reason: `"${s}" is not a real date (dates are read day-first)` };
  }
  return { kind: 'bad', reason: `"${s}" is not a date` };
}

/** Y, N, TRUE, FALSE, yes, no. */
export function coerceYesNo(v: unknown): Coerced<boolean> {
  if (isBlank(v)) return { kind: 'blank' };
  if (typeof v === 'boolean') return { kind: 'ok', value: v };
  if (typeof v === 'number') return v === 1 ? { kind: 'ok', value: true } : v === 0 ? { kind: 'ok', value: false } : { kind: 'bad', reason: `${v} is not Yes/No` };
  const s = String(v).trim().toLowerCase();
  if (['y', 'yes', 'true', 't', '1'].includes(s)) return { kind: 'ok', value: true };
  if (['n', 'no', 'false', 'f', '0'].includes(s)) return { kind: 'ok', value: false };
  return { kind: 'bad', reason: `"${String(v).trim()}" is not Yes or No` };
}

export function coerceText(v: unknown): string {
  if (isBlank(v)) return '';
  if (typeof v === 'number') return String(v);
  return String(v).replace(/ /g, ' ').trim();
}

export { cleanHsCode };

export function normalizeBookingId(v: unknown): string {
  return coerceText(v).replace(/\s+/g, '').toUpperCase();
}

/** Split "Manchester · United Kingdom" on ·, |, , or -. */
export function splitCombined(v: unknown): [string, string] {
  const s = coerceText(v);
  if (!s) return ['', ''];
  const m = /^(.*?)\s*[·|,\-–—]\s*(.+)$/.exec(s);
  return m ? [m[1].trim(), m[2].trim()] : [s, ''];
}
