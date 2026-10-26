export interface CleanedHs {
  raw: string;
  digits: string;
  /** characters other than digits remained after cleaning */
  invalid: boolean;
  wasNumeric: boolean;
}

/**
 * Keep the raw value, strip spaces / dots / hyphens and a trailing ".0" left behind by float conversion.
 * 691200, 691200.0, "6912.00", "6912 00" all become "691200".
 */
export function cleanHsCode(value: unknown): CleanedHs {
  if (value === null || value === undefined) return { raw: '', digits: '', invalid: false, wasNumeric: false };
  const wasNumeric = typeof value === 'number';
  const raw = String(value).trim();
  let s = raw;
  const floaty = /^(\d+)\.0$/.exec(s);
  if (floaty) s = floaty[1];
  s = s.replace(/[\s.\- ]/g, '');
  const invalid = /[^0-9]/.test(s);
  return { raw, digits: s, invalid, wasNumeric };
}
