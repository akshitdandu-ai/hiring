import type { Booking } from '../model/types';
import { gbp, longDate, num } from '../util/format';
import { card, cx } from '../ui/styles';
import { slotKey, type Slot } from './ops';
import { type ConversationState } from './conversationState';
import { isMissing, requiredSlots, slotStatus, slotValue, type SlotStatus } from './slotTracker';

const BADGE: Record<SlotStatus, { label: string; cls: string; icon: string }> = {
  missing: { label: 'Missing', cls: 'border-slate-300 bg-slate-100 text-slate-700', icon: '○' },
  filled: { label: 'Filled', cls: 'border-sky-300 bg-sky-50 text-sky-900', icon: '●' },
  calculated: { label: 'Calculated', cls: 'border-violet-300 bg-violet-50 text-violet-900', icon: '≈' },
  confirmed: { label: 'Confirmed', cls: 'border-emerald-300 bg-emerald-50 text-emerald-900', icon: '✔' },
};

function formatValue(b: Booking, slot: Slot): string {
  const v = slotValue(b, slot);
  if (v === null || v === '') return '—';
  if (slot.scope === 'item') {
    switch (slot.field) {
      case 'unitPrice': return gbp(v as number);
      case 'unitWeightKg': return `${num(v as number, 3)} kg`;
      case 'quantity':
      case 'unitsPerCarton':
      case 'cartons': return num(v as number, 3);
      default: return String(v);
    }
  }
  switch (slot.field) {
    case 'readyDate': return longDate(String(v));
    case 'declaredValue': return gbp(v as number);
    case 'grossWeightKg': return `${num(v as number)} kg`;
    case 'pallets':
    case 'cartons': return num(v as number, 3);
    case 'appointmentBooked': return v ? 'Yes' : 'No';
    case 'originCity': return `${v}${b.originCountry ? `, ${b.originCountry}` : ''}`;
    case 'destinationCity': return `${v}${b.destinationCountry ? `, ${b.destinationCountry}` : ''}`;
    default: return String(v);
  }
}

const ROW_LABEL: Record<string, string> = {
  sellerName: 'Seller name', originCity: 'Origin', destinationCity: 'Destination', destinationType: 'Destination type', appointmentBooked: 'Delivery appointment',
  readyDate: 'Ready to ship', priority: 'Seller priority', pallets: 'Pallets', cartons: 'Cartons', declaredValue: 'Declared value', grossWeightKg: 'Gross weight',
  description: 'Description', hsCode: 'HS code', quantity: 'Quantity', unitPrice: 'Unit price', unitsPerCarton: 'Units per carton', unitWeightKg: 'Unit weight', countryOfOrigin: 'Country of origin',
};

function Row({ label, value, status, skipped }: { label: string; value: string; status: SlotStatus; skipped?: boolean }) {
  const b = BADGE[status];
  return (
    <li className="flex items-center justify-between gap-2 py-1.5 text-sm">
      <span className="min-w-0 text-slate-600">{label}</span>
      <span className="flex min-w-0 items-center gap-2">
        <span className={cx('truncate text-right font-medium', status === 'missing' && 'text-slate-400')}>{value}</span>
        <span className={cx('inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold', b.cls)}>
          <span aria-hidden="true">{b.icon}</span>
          {skipped ? 'Skipped' : b.label}
        </span>
      </span>
    </li>
  );
}

export function LiveBookingPanel({ state }: { state: ConversationState }) {
  const b = state.booking;
  const defs = requiredSlots(b);
  const total = defs.length;
  const done = defs.filter((d) => !isMissing(b, d.slot)).length;
  const deferred = new Set(state.deferred);
  const bookingSlots = defs.filter((d) => d.slot.scope === 'booking');
  const rowFor = (slot: Slot) => (
    <Row
      key={slotKey(slot)}
      label={ROW_LABEL[slot.field] ?? slot.field}
      value={formatValue(b, slot)}
      status={slotStatus(b, slot)}
      skipped={isMissing(b, slot) && deferred.has(slotKey(slot))}
    />
  );
  const pick = (fields: string[]) => bookingSlots.filter((d) => fields.includes(d.slot.field)).map((d) => rowFor(d.slot));

  return (
    <section className={cx(card, 'p-4')} aria-label="Live booking">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-bold">Booking {b.bookingId}</h3>
        <span className="text-xs text-slate-600">{done} of {total} fields</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Booking completeness">
        <div className="h-full rounded-full bg-indigo-600 transition-all" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>
      <p className="mt-2 text-xs text-slate-500">Currency is always GBP. Countries are worked out from the cities.</p>

      <h4 className="mt-3 text-xs font-bold uppercase tracking-wide text-slate-500">Route and delivery</h4>
      <ul className="divide-y divide-slate-100">{pick(['sellerName', 'originCity', 'destinationCity', 'destinationType', 'appointmentBooked', 'readyDate', 'priority'])}</ul>

      <h4 className="mt-3 text-xs font-bold uppercase tracking-wide text-slate-500">Shipment</h4>
      <ul className="divide-y divide-slate-100">{pick(['pallets', 'cartons', 'declaredValue', 'grossWeightKg'])}</ul>

      <h4 className="mt-3 text-xs font-bold uppercase tracking-wide text-slate-500">Items</h4>
      {b.items.length === 0 ? (
        <ul>
          <Row label="Items" value="—" status="missing" />
        </ul>
      ) : (
        <div className="space-y-2">
          {b.items.map((it) => (
            <div key={it.sku} className="rounded-lg border border-slate-200 p-2">
              <p className="text-sm font-semibold">
                <span className="font-mono text-xs text-slate-500">{it.sku}</span> {it.description || 'Untitled item'}
              </p>
              <ul className="divide-y divide-slate-100">
                {(['hsCode', 'quantity', 'unitPrice', 'unitsPerCarton', 'cartons', 'unitWeightKg', 'countryOfOrigin'] as const).map((f) => rowFor({ scope: 'item', sku: it.sku, field: f }))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
