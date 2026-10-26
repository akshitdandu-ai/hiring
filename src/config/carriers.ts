export interface CarrierRate {
  carrier: string;
  service: string;
  origin: string;
  destination: string;
  pricePerPallet: number; // GBP
  transitDays: number;
  onTimeRate: number; // %
  maxWeightPerPalletKg: number;
}

/** Sheet 3 "Carrier options", verbatim. Judges use exactly this rate card. */
const rows: Array<[string, string, string, number, number, number, number]> = [
  ['Carrier A', 'Road economy', 'Germany', 180, 5, 92, 500],
  ['Carrier B', 'Road standard', 'Germany', 220, 3, 95, 750],
  ['Carrier C', 'Road express', 'Germany', 340, 2, 98, 400],
  ['Carrier A', 'Road economy', 'France', 170, 5, 92, 500],
  ['Carrier B', 'Road standard', 'France', 210, 3, 95, 750],
  ['Carrier C', 'Road express', 'France', 330, 2, 98, 400],
  ['Carrier A', 'Road economy', 'Netherlands', 160, 5, 92, 500],
  ['Carrier B', 'Road standard', 'Netherlands', 200, 3, 95, 750],
  ['Carrier C', 'Road express', 'Netherlands', 320, 2, 98, 400],
];

export const CARRIER_RATES: CarrierRate[] = rows.map(
  ([carrier, service, destination, pricePerPallet, transitDays, onTimeRate, maxWeightPerPalletKg]) => ({
    carrier,
    service,
    origin: 'United Kingdom',
    destination,
    pricePerPallet,
    transitDays,
    onTimeRate,
    maxWeightPerPalletKg,
  }),
);
