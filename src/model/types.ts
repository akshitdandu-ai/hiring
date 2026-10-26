import type { Severity } from '../config/rulebook';

export type FieldSource = 'stated' | 'calculated-confirmed' | 'inferred' | 'default';

export interface Item {
  sku: string;
  description: string;
  hsCodeRaw: string;
  hsCodeDigits: string;
  /** true when the raw HS value arrived as a number (Excel may have dropped a leading zero). */
  hsCodeWasNumeric?: boolean;
  quantity: number | null;
  unitPrice: number | null;
  unitsPerCarton: number | null;
  cartons: number | null;
  unitWeightKg: number | null;
  /** '' when blank. Canonical country name when recognised, raw text otherwise. */
  countryOfOrigin: string;
}

export interface Booking {
  bookingId: string;
  sellerName: string;
  originCity: string;
  originCountry: string;
  destinationCity: string;
  destinationCountry: string;
  /** 'Warehouse' | 'Business address' | '' (blank) | any other raw text (flagged as DATA). */
  destinationType: string;
  /** ISO yyyy-MM-dd, or null when missing/invalid. */
  readyDate: string | null;
  /** 'Cheapest' | 'Fastest' | 'Most reliable' | 'Balanced' | '' | raw text. */
  priority: string;
  pallets: number | null;
  cartons: number | null;
  declaredValue: number | null;
  currency: string;
  grossWeightKg: number | null;
  appointmentBooked: boolean | null;
  items: Item[];
  fieldSources: Record<string, FieldSource>;
  /** Problems found while reading a file (bad date, not a number...). Chat bookings leave this empty. */
  ingestFindings?: Finding[];
}

export type RuleId = 'R-01' | 'R-02' | 'R-03' | 'R-04' | 'R-05' | 'R-06' | 'R-07' | 'R-08' | 'R-09' | 'R-10' | 'DATA' | 'INFO';

export interface Finding {
  ruleId: RuleId;
  severity: Severity;
  /** 'booking' or the item SKU. */
  scope: string;
  problem: string;
  evidence: string;
  fix: string;
  /** Which input field this is about (used to avoid reporting the same data problem twice). */
  field?: string;
}

export interface CouldNotCheck {
  ruleId: string;
  reason: string;
}

export interface ScoreBreakdown {
  cost: number;
  transit: number;
  reliability: number;
  total: number;
}

export interface CarrierOption {
  carrier: string;
  service: string;
  label: string;
  pricePerPallet: number;
  transitDays: number;
  onTimeRate: number;
  maxWeightPerPalletKg: number;
  cost: number | null;
  weightPerPallet: number | null;
  eligible: boolean;
  excludedReason?: string;
  /** ISO date, estimated, calendar days. */
  eta: string | null;
  score?: ScoreBreakdown;
}

export interface Recommendation {
  option: CarrierOption;
  priority: string;
  reason: string;
  provisional: boolean;
}

export interface PalletSuggestion {
  option: CarrierOption;
  palletsNeeded: number;
  cost: number;
}

export type BookingStatus = 'Blocked' | 'Needs attention' | 'Ready';

export interface BookingResult {
  booking: Booking;
  findings: Finding[];
  passedRules: string[];
  couldNotCheck: CouldNotCheck[];
  status: BookingStatus;
  statusReason: string;
  carrierOptions: CarrierOption[];
  recommendation: Recommendation | null;
  /** Shown when no carrier can take the load as booked. */
  palletSuggestion: PalletSuggestion | null;
  /** Why there is no recommendation (no route, no pallets, none eligible...). */
  noRecommendationReason: string | null;
  etaBaseNote: string;
  confirmationText: string;
  nextSteps: string[];
  /** Extra evidence for rules that passed, e.g. R-05 "206.7 kg per pallet ≤ 500 kg". */
  passNotes: Record<string, string>;
}
