import { z } from 'zod';

export const BOOKING_FIELD_NAMES = [
  'sellerName', 'originCity', 'destinationCity', 'destinationCountry', 'destinationType', 'readyDate', 'priority', 'pallets', 'cartons',
  'declaredValue', 'grossWeightKg', 'appointmentBooked',
] as const;
export type BookingFieldName = (typeof BOOKING_FIELD_NAMES)[number];

export const ITEM_FIELD_NAMES = ['sku', 'description', 'hsCode', 'quantity', 'unitPrice', 'unitsPerCarton', 'cartons', 'unitWeightKg', 'countryOfOrigin'] as const;
export type ItemFieldName = (typeof ITEM_FIELD_NAMES)[number];

export const COUNTABLE_BOOKING_FIELDS = ['pallets', 'cartons', 'declaredValue', 'grossWeightKg'] as const;

const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const itemPatch = z.object({
  sku: z.string().optional(),
  description: z.string().optional(),
  hsCode: z.union([z.string(), z.number()]).optional(),
  quantity: z.number().optional(),
  unitPrice: z.number().optional(),
  unitsPerCarton: z.number().optional(),
  cartons: z.number().optional(),
  unitWeightKg: z.number().optional(),
  countryOfOrigin: z.string().optional(),
});
export type ItemPatch = z.infer<typeof itemPatch>;

export const opSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set'), field: z.enum(BOOKING_FIELD_NAMES), value: scalar }),
  z.object({ op: z.literal('increment'), field: z.enum(COUNTABLE_BOOKING_FIELDS), amount: z.number() }),
  z.object({ op: z.literal('decrement'), field: z.enum(COUNTABLE_BOOKING_FIELDS), amount: z.number() }),
  z.object({ op: z.literal('add_item'), item: itemPatch }),
  z.object({ op: z.literal('remove_item'), match: z.string() }),
  z.object({
    op: z.literal('update_item'),
    match: z.string().optional(),
    field: z.enum(ITEM_FIELD_NAMES),
    value: z.union([z.string(), z.number()]),
    mode: z.enum(['set', 'increment', 'decrement']).optional(),
  }),
]);
export type Op = z.infer<typeof opSchema>;

/** What the LLM must return: JSON only, validated here before use. */
export const extractionSchema = z.object({ updates: z.array(opSchema).max(40) });
export type Extraction = z.infer<typeof extractionSchema>;

export function parseExtraction(raw: unknown): Op[] | null {
  const r = extractionSchema.safeParse(raw);
  return r.success ? r.data.updates : null;
}

/** A question the planner can ask: a booking field or one field of one item. */
export type Slot = { scope: 'booking'; field: BookingFieldName } | { scope: 'item'; sku: string; field: ItemFieldName };
export const slotKey = (s: Slot) => (s.scope === 'booking' ? s.field : `item:${s.sku}:${s.field}`);
