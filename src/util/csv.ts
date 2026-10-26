import type { BookingResult } from '../model/types';
import { describeRoute } from '../engine/confirmation';

const q = (v: unknown): string => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function resultsToCsv(results: BookingResult[]): string {
  const head = ['Booking ID', 'Seller', 'Route', 'Status', 'Red', 'Amber', 'Info', 'Recommended carrier', 'Carrier cost (GBP)', 'Estimated delivery', 'Provisional', 'Issues (rule: problem | fix)', 'Passed rules', 'Could not check'];
  const rows = results.map((r) => {
    const red = r.findings.filter((f) => f.severity === 'Red').length;
    const amber = r.findings.filter((f) => f.severity === 'Amber').length;
    const info = r.findings.filter((f) => f.severity === 'Info').length;
    const rec = r.recommendation?.option;
    const issues = r.findings
      .filter((f) => f.severity !== 'Info')
      .map((f) => `${f.ruleId}${f.scope !== 'booking' ? ` [${f.scope}]` : ''}: ${f.problem} (${f.evidence}) | Fix: ${f.fix}`)
      .join(' ‖ ');
    return [
      r.booking.bookingId,
      r.booking.sellerName,
      describeRoute(r.booking),
      r.status,
      red,
      amber,
      info,
      rec?.label ?? '',
      rec?.cost ?? '',
      rec?.eta ?? '',
      rec ? (r.recommendation!.provisional ? 'Yes' : 'No') : '',
      issues,
      r.passedRules.join(' '),
      r.couldNotCheck.map((c) => `${c.ruleId}: ${c.reason}`).join('; '),
    ];
  });
  return '﻿' + [head, ...rows].map((r) => r.map(q).join(',')).join('\r\n');
}

export function download(filename: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
