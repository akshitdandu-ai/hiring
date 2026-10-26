import { describe, expect, it } from 'vitest';
import { evaluateBooking } from '../src/engine/evaluateBooking';
import { balancedScores, rankOptions, recommendCarrier } from '../src/engine/carrierEngine';
import { startOfDay } from 'date-fns';
import { booking, TODAY } from './fixtures';

const rec = (over = {}) => evaluateBooking(booking(over), { today: TODAY });

describe('priority ranking on the real rate card (Germany, 3 pallets, 206.7 kg/pallet)', () => {
  it('Cheapest → Carrier A', () => expect(rec({ priority: 'Cheapest' }).recommendation?.option.label).toBe('Carrier A Road economy'));
  it('Fastest → Carrier C', () => expect(rec({ priority: 'Fastest' }).recommendation?.option.label).toBe('Carrier C Road express'));
  it('Most reliable → Carrier C', () => expect(rec({ priority: 'Most reliable' }).recommendation?.option.label).toBe('Carrier C Road express'));
  it('Balanced → Carrier C (lowest combined score) and shows a breakdown', () => {
    const r = rec({ priority: 'Balanced' });
    expect(r.recommendation?.option.label).toBe('Carrier C Road express');
    expect(r.recommendation?.option.score?.total).toBeCloseTo(1 / 3, 5);
    expect(r.recommendation?.reason).toContain('score');
  });
  it('cost = price per pallet × pallets', () => {
    const r = rec({ pallets: 4, priority: 'Cheapest' });
    expect(r.recommendation?.option.cost).toBe(720);
    expect(r.carrierOptions.map((o) => o.cost)).toEqual([720, 880, 1360]);
  });
  it('France and Netherlands use their own rates', () => {
    expect(rec({ destinationCity: 'Lyon', destinationCountry: 'France' }).recommendation?.option.cost).toBe(510);
    expect(rec({ destinationCity: 'Rotterdam', destinationCountry: 'Netherlands' }).recommendation?.option.cost).toBe(480);
  });
  it('the city decides the route when the country disagrees', () => {
    const r = rec({ destinationCity: 'Lyon', destinationCountry: 'Germany' });
    expect(r.carrierOptions.every((o) => [170, 210, 330].includes(o.pricePerPallet))).toBe(true);
  });
  it('reason names the runner-up trade-off', () => {
    const reason = rec({ priority: 'Cheapest' }).recommendation!.reason;
    expect(reason).toContain('cheapest at £540 for 3 pallets');
    expect(reason).toContain('Carrier B Road standard is £120 more and 2 days faster and 3 points more reliable.');
  });
});

describe('ETA', () => {
  it('is ready date + transit days (calendar days)', () => {
    const r = rec({ readyDate: '2026-11-05', priority: 'Cheapest' });
    expect(r.recommendation?.option.eta).toBe('2026-11-10');
  });
  it('counts from today when the ready date is in the past', () => {
    const r = rec({ readyDate: '2026-10-01', priority: 'Fastest' });
    expect(r.recommendation?.option.eta).toBe('2026-10-28');
  });
});

describe('exclusions', () => {
  it('lists excluded options with the reason, still shows them in the table', () => {
    const r = rec({ grossWeightKg: 1950 }); // 650 kg per pallet
    const c = r.carrierOptions.find((o) => o.carrier === 'Carrier C')!;
    expect(c.eligible).toBe(false);
    expect(c.excludedReason).toBe('pallet weight 650 kg > max 400 kg');
    expect(r.carrierOptions).toHaveLength(3);
    expect(r.recommendation?.option.label).toBe('Carrier B Road standard');
  });
  it('no route when the destination is unknown', () => {
    const out = recommendCarrier(booking({ destinationCity: 'Madrid', destinationCountry: 'Spain' }), startOfDay(TODAY));
    expect(out.options).toEqual([]);
    expect(out.noRecommendationReason).toContain('No carrier route');
  });
});

describe('ranking helpers', () => {
  const o = (label: string, cost: number, transitDays: number, onTimeRate: number) => ({ label, cost, transitDays, onTimeRate });
  it('Cheapest tie → shorter transit → higher on-time', () => {
    const { ranked } = rankOptions([o('slow', 100, 5, 99), o('fast', 100, 3, 90), o('fast-rel', 100, 3, 95)], 'Cheapest');
    expect(ranked.map((x) => x.label)).toEqual(['fast-rel', 'fast', 'slow']);
  });
  it('Fastest tie → higher on-time → lower cost', () => {
    const { ranked } = rankOptions([o('a', 100, 2, 90), o('b', 120, 2, 95), o('c', 90, 2, 95)], 'Fastest');
    expect(ranked.map((x) => x.label)).toEqual(['c', 'b', 'a']);
  });
  it('Most reliable tie → lower cost → shorter transit', () => {
    const { ranked } = rankOptions([o('a', 100, 2, 95), o('b', 90, 4, 95), o('c', 90, 3, 95)], 'Most reliable');
    expect(ranked.map((x) => x.label)).toEqual(['c', 'b', 'a']);
  });
  it('Balanced: all values equal → every term is 0, tie-break by cost/transit/on-time', () => {
    const opts = [o('x', 100, 3, 95), o('y', 100, 3, 95)];
    const s = balancedScores(opts);
    expect(s.get(opts[0])).toEqual({ cost: 0, transit: 0, reliability: 0, total: 0 });
    expect(rankOptions(opts, 'Balanced').ranked.map((x) => x.label)).toEqual(['x', 'y']);
  });
  it('Balanced: score ties are broken by lower cost', () => {
    // a: cost 0, transit 1, rel 0 → 1/3 ; b: cost 1, transit 0, rel 0 → 1/3
    const opts = [o('b', 200, 2, 95), o('a', 100, 4, 95)];
    const { ranked } = rankOptions(opts, 'Balanced');
    expect(ranked.map((x) => x.label)).toEqual(['a', 'b']);
  });
  it('Balanced: a single option is picked', () => {
    expect(rankOptions([o('only', 100, 3, 90)], 'Balanced').ranked[0].label).toBe('only');
  });
  it('Balanced normalises over eligible options only', () => {
    const r = rec({ priority: 'Balanced', grossWeightKg: 1950 }); // C excluded
    expect(r.recommendation?.option.label).toBe('Carrier B Road standard');
    expect(r.carrierOptions.find((x) => x.carrier === 'Carrier C')?.score).toBeUndefined();
  });
});
