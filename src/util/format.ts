import { format, parseISO } from 'date-fns';

export const EPS = 0.001;

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function gbp(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const v = round2(n);
  return '£' + v.toLocaleString('en-GB', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });
}

export function num(n: number | null | undefined, dp = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n.toFixed(dp)).toLocaleString('en-GB', { maximumFractionDigits: dp });
}

export function longDate(iso: string | null | undefined): string {
  if (!iso) return 'not set';
  try {
    return format(parseISO(iso), 'EEE d MMM yyyy');
  } catch {
    return iso;
  }
}

export function plural(n: number, one: string, many = one + 's'): string {
  return `${num(n, 3)} ${n === 1 ? one : many}`;
}
