import type { BookingStatus } from '../model/types';

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

export const STATUS_STYLE: Record<BookingStatus, { banner: string; chip: string; icon: string; label: string }> = {
  Blocked: { banner: 'border-red-300 bg-red-50 text-red-950', chip: 'border-red-300 bg-red-100 text-red-900', icon: '⛔', label: 'Blocked' },
  'Needs attention': { banner: 'border-amber-300 bg-amber-50 text-amber-950', chip: 'border-amber-300 bg-amber-100 text-amber-900', icon: '⚠', label: 'Needs attention' },
  Ready: { banner: 'border-emerald-300 bg-emerald-50 text-emerald-950', chip: 'border-emerald-300 bg-emerald-100 text-emerald-900', icon: '✔', label: 'Ready' },
};

export const SEVERITY_STYLE = {
  Red: { card: 'border-red-200 bg-red-50', chip: 'bg-red-700 text-white', icon: '●', label: 'Red' },
  Amber: { card: 'border-amber-200 bg-amber-50', chip: 'bg-amber-600 text-white', icon: '▲', label: 'Amber' },
  Info: { card: 'border-sky-200 bg-sky-50', chip: 'bg-sky-700 text-white', icon: 'i', label: 'Info' },
} as const;

export const card = 'rounded-xl border border-hairline bg-panel';
export const btn = 'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2';
export const btnPrimary = `${btn} bg-amber text-ground hover:bg-amber/90 disabled:bg-slate-300 disabled:text-slate-500`;
export const btnGhost = `${btn} border border-hairline bg-transparent text-ink hover:border-amber hover:text-amber disabled:text-slate-400`;
