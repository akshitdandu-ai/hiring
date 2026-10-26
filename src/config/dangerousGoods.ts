/**
 * R-06 keyword list. Each entry is a regex source matched on whole words, case-insensitive.
 * `label` is what we show as evidence.
 */
export interface DgTerm {
  label: string;
  pattern: string;
  kind: 'lithium battery' | 'aerosol' | 'flammable liquid';
}

export const DG_TERMS: DgTerm[] = [
  { label: 'lithium', pattern: 'lithium', kind: 'lithium battery' },
  { label: 'lithium-ion', pattern: 'lithium[\\s-]?ion', kind: 'lithium battery' },
  { label: 'li-ion', pattern: 'li[\\s-]?ion', kind: 'lithium battery' },
  { label: 'lipo', pattern: 'li[\\s-]?po', kind: 'lithium battery' },
  { label: 'power bank', pattern: 'power[\\s-]?banks?', kind: 'lithium battery' },
  { label: 'e-cigarette', pattern: 'e[\\s-]?cigarettes?|e[\\s-]?cigs?', kind: 'lithium battery' },
  { label: 'vape', pattern: 'vapes?|vaping', kind: 'lithium battery' },
  { label: 'aerosol', pattern: 'aerosols?', kind: 'aerosol' },
  { label: 'spray can', pattern: 'spray[\\s-]?cans?', kind: 'aerosol' },
  { label: 'spray paint', pattern: 'spray[\\s-]?paints?', kind: 'aerosol' },
  { label: 'hairspray', pattern: 'hair[\\s-]?spray', kind: 'aerosol' },
  { label: 'deodorant spray', pattern: 'deodorant[\\s-]?spray', kind: 'aerosol' },
  { label: 'compressed gas', pattern: 'compressed[\\s-]?gas', kind: 'aerosol' },
  { label: 'butane', pattern: 'butane', kind: 'flammable liquid' },
  { label: 'propane', pattern: 'propane', kind: 'flammable liquid' },
  { label: 'gas canister', pattern: 'gas[\\s-]?canisters?', kind: 'flammable liquid' },
  { label: 'lighter fluid', pattern: 'lighter[\\s-]?fluid', kind: 'flammable liquid' },
  { label: 'petrol', pattern: 'petrol', kind: 'flammable liquid' },
  { label: 'gasoline', pattern: 'gasoline', kind: 'flammable liquid' },
  { label: 'diesel', pattern: 'diesel', kind: 'flammable liquid' },
  { label: 'kerosene', pattern: 'kerosene', kind: 'flammable liquid' },
  { label: 'paraffin', pattern: 'paraffin', kind: 'flammable liquid' },
  { label: 'ethanol', pattern: 'ethanol', kind: 'flammable liquid' },
  { label: 'alcohol-based', pattern: 'alcohol[\\s-]?based', kind: 'flammable liquid' },
  { label: 'isopropyl', pattern: 'isopropyl', kind: 'flammable liquid' },
  { label: 'acetone', pattern: 'acetone', kind: 'flammable liquid' },
  { label: 'nail polish', pattern: 'nail[\\s-]?polish', kind: 'flammable liquid' },
  { label: 'nail varnish', pattern: 'nail[\\s-]?varnish', kind: 'flammable liquid' },
  { label: 'paint thinner', pattern: 'paint[\\s-]?thinners?', kind: 'flammable liquid' },
  { label: 'solvent', pattern: 'solvents?', kind: 'flammable liquid' },
  { label: 'white spirit', pattern: 'white[\\s-]?spirits?', kind: 'flammable liquid' },
  { label: 'perfume', pattern: 'perfumes?', kind: 'flammable liquid' },
  { label: 'fragrance', pattern: 'fragrances?', kind: 'flammable liquid' },
  { label: 'eau de parfum', pattern: 'eau[\\s-]?de[\\s-]?parfum', kind: 'flammable liquid' },
  { label: 'cologne', pattern: 'cologne', kind: 'flammable liquid' },
  { label: 'flammable', pattern: 'flammable', kind: 'flammable liquid' },
];

/** Plain "battery" is only flagged in an electronics / rechargeable context. */
export const BATTERY_PATTERN = 'batter(?:y|ies)';
export const BATTERY_RED_CONTEXT = [
  'electronic', 'electronics', 'rechargeable', 'phone', 'charger', 'laptop', 'tablet', 'e-bike', 'ebike', 'scooter', 'drone',
  'camera', 'speaker', 'headphones', 'earbuds', 'bluetooth', 'wireless', 'usb', 'pack', 'bank', 'cell', 'cells', 'device', 'gadget',
];
export const BATTERY_INFO_CONTEXT = ['alkaline', 'aa', 'aaa', 'zinc', 'carbon', 'non-rechargeable', 'dry cell'];

/** Whole phrases that cancel a match (spec list). Context checks ("no"/"non"/"-free") are applied on top. */
export const NEGATION_PHRASES = [
  'battery-free', 'battery free', 'no batteries', 'no battery', 'batteries not included', 'battery not included', 'non-aerosol',
  'non aerosol', 'non-flammable', 'non flammable', 'nonflammable', 'alcohol-free', 'alcohol free', 'pump spray (non-aerosol)',
  'without batteries', 'without battery', 'fragrance-free', 'fragrance free', 'perfume-free', 'solvent-free', 'solvent free',
];
