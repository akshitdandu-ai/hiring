import { describe, expect, it } from 'vitest';
import { evaluateBooking } from '../src/engine/evaluateBooking';
import { scanDangerous } from '../src/engine/rules/R06';
import { booking, item, TODAY } from './fixtures';
import type { Booking } from '../src/model/types';

const run = (b: Booking) => evaluateBooking(b, { today: TODAY });
const ids = (b: Booking, sev?: string) => [...new Set(run(b).findings.filter((f) => !sev || f.severity === sev).map((f) => f.ruleId))];
const has = (b: Booking, rule: string) => run(b).findings.some((f) => f.ruleId === rule && f.severity !== 'Info');

describe('clean booking', () => {
  it('is Ready, passes all ten rules and recommends Carrier A (cheapest)', () => {
    const r = run(booking());
    expect(r.findings.filter((f) => f.severity !== 'Info')).toEqual([]);
    expect(r.status).toBe('Ready');
    expect(r.passedRules).toEqual(['R-01', 'R-02', 'R-03', 'R-04', 'R-05', 'R-06', 'R-07', 'R-08', 'R-09', 'R-10']);
    expect(r.recommendation?.option.label).toBe('Carrier A Road economy');
    expect(r.recommendation?.option.cost).toBe(540);
    expect(r.recommendation?.provisional).toBe(false);
    expect(r.nextSteps.join(' ')).toContain('Label every carton with BK-001');
  });
});

describe('R-01 HS code', () => {
  const hs = (v: unknown) => booking({}, [item({ ...(typeof v === 'string' || typeof v === 'number' ? {} : {}), hsCodeRaw: String(v ?? '') })]);
  it.each(['691200', '691200.0', '6912.00', '6912 00', '6912-00-00-00', '6912001000'])('%s passes', (v) => {
    expect(has(hs(v), 'R-01')).toBe(false);
  });
  it('blank is Red "missing"', () => {
    const f = run(hs('')).findings.find((x) => x.ruleId === 'R-01')!;
    expect(f.severity).toBe('Red');
    expect(f.problem).toContain('missing');
  });
  it('69120 (5 digits) is Red', () => expect(has(hs('69120'), 'R-01')).toBe(true));
  it('numeric 69120 notes the dropped leading zero', () => {
    const b = booking({}, [item({ hsCodeRaw: '69120', hsCodeDigits: '69120', hsCodeWasNumeric: true })]);
    expect(run(b).findings.find((f) => f.ruleId === 'R-01')!.evidence).toContain('leading zero');
  });
  it('letters are invalid', () => {
    const f = run(hs('69A200')).findings.find((x) => x.ruleId === 'R-01')!;
    expect(f.problem).toContain('invalid');
  });
  it('more than 10 digits is only Info', () => {
    const r = run(hs('69120012345'));
    expect(r.findings.find((f) => f.ruleId === 'R-01')!.severity).toBe('Info');
    expect(r.status).toBe('Ready');
  });
});

describe('R-02 declared value', () => {
  it('passes within 1%', () => expect(has(booking({ declaredValue: 5400 }), 'R-02')).toBe(false));
  it('passes at exactly 1%', () => expect(has(booking({ declaredValue: 5454 }), 'R-02')).toBe(false));
  it('passes at exactly -1%', () => expect(has(booking({ declaredValue: 5346 }), 'R-02')).toBe(false));
  it('fails at 1.01%', () => {
    const f = run(booking({ declaredValue: 5454.54 })).findings.find((x) => x.ruleId === 'R-02')!;
    expect(f.severity).toBe('Red');
    expect(f.evidence).toContain('£5,454.54');
    expect(f.fix).toContain('£5,400');
  });
  it('fails when far off and shows £ and %', () => {
    const f = run(booking({ declaredValue: 6000 })).findings.find((x) => x.ruleId === 'R-02')!;
    expect(f.evidence).toMatch(/£600/);
    expect(f.evidence).toMatch(/11\.11%/);
  });
  it('sum 0 and declared > 0 fails', () => {
    expect(has(booking({ declaredValue: 100 }, [item({ unitPrice: 0 })]), 'R-02')).toBe(true);
  });
  it('sum 0 and declared 0 passes', () => {
    expect(has(booking({ declaredValue: 0 }, [item({ unitPrice: 0 })]), 'R-02')).toBe(false);
  });
});

describe('R-03 units per carton × cartons', () => {
  it('passes', () => expect(has(booking(), 'R-03')).toBe(false));
  it('fails and suggests cartons', () => {
    const f = run(booking({}, [item({ cartons: 80 })])).findings.find((x) => x.ruleId === 'R-03')!;
    expect(f.fix).toContain('Cartons should be 90');
    expect(f.evidence).toContain('960');
  });
  it('suggests units per carton when cartons divide the quantity', () => {
    const f = run(booking({}, [item({ quantity: 1000, unitsPerCarton: 12, cartons: 100 })])).findings.find((x) => x.ruleId === 'R-03')!;
    expect(f.fix).toContain('Units per carton should be 10');
  });
  it('else suggests quantity', () => {
    const f = run(booking({}, [item({ quantity: 1001, unitsPerCarton: 12, cartons: 90 })])).findings.find((x) => x.ruleId === 'R-03')!;
    expect(f.fix).toContain('Quantity should be');
    expect(f.fix).toContain('1,080');
  });
});

describe('R-04 booking cartons', () => {
  it('passes', () => expect(has(booking(), 'R-04')).toBe(false));
  it('fails and shows both totals', () => {
    const f = run(booking({ cartons: 95 })).findings.find((x) => x.ruleId === 'R-04')!;
    expect(f.evidence).toContain('95');
    expect(f.evidence).toContain('90');
  });
  it('sums several items', () => {
    const items = [item(), item({ sku: 'B', quantity: 120, unitsPerCarton: 12, cartons: 10, unitPrice: 0 })];
    expect(has(booking({ cartons: 100, declaredValue: 5400 }, items), 'R-04')).toBe(false);
  });
});

describe('R-05 weight per pallet vs carrier', () => {
  it('passes when the recommended carrier can carry it', () => expect(has(booking(), 'R-05')).toBe(false));
  it('equal to the carrier max passes (500 kg/pallet on Carrier A)', () => {
    const r = run(booking({ grossWeightKg: 1500 }, [item({ unitWeightKg: 0.5 })]));
    expect(r.findings.some((f) => f.ruleId === 'R-05')).toBe(false);
    expect(r.recommendation?.option.label).toBe('Carrier A Road economy');
    expect(r.carrierOptions.find((o) => o.carrier === 'Carrier C')?.eligible).toBe(false);
  });
  it('just over A max excludes A and falls through to B', () => {
    const r = run(booking({ grossWeightKg: 1500.5 }));
    expect(r.recommendation?.option.label).toBe('Carrier B Road standard');
    expect(r.carrierOptions.find((o) => o.carrier === 'Carrier A')?.excludedReason).toContain('> max 500 kg');
  });
  it('fails when no carrier can take it, with minimum pallets and cost', () => {
    const r = run(booking({ pallets: 2, grossWeightKg: 1800 }));
    const f = r.findings.find((x) => x.ruleId === 'R-05')!;
    expect(f.severity).toBe('Red');
    expect(r.recommendation).toBeNull();
    // cheapest priority: A needs 4 pallets (£720), B needs 3 (£660) → B is cheapest
    expect(f.fix).toContain('3 pallets');
    expect(f.fix).toContain('£660');
    expect(r.status).toBe('Blocked');
  });
  it('pallets 0 is a DATA finding and R-05 could not be checked', () => {
    const r = run(booking({ pallets: 0 }));
    expect(r.findings.some((f) => f.ruleId === 'DATA' && f.field === 'pallets')).toBe(true);
    expect(r.couldNotCheck.map((c) => c.ruleId)).toContain('R-05');
    expect(r.status).toBe('Blocked');
  });
});

describe('R-06 dangerous goods', () => {
  const d = (description: string, sku = 'X-1') => booking({}, [item({ description, sku })]);
  it.each([
    'Lithium-ion power bank 10000mAh',
    'Aerosol deodorant',
    'Butane gas canister',
    'Nail polish remover (acetone)',
    'Eau de parfum 50ml',
    'LiPo battery pack',
    'Rechargeable phone battery',
    'Spray paint cans',
  ])('flags "%s"', (t) => expect(has(d(t), 'R-06')).toBe(true));
  it('flags a dangerous SKU too', () => expect(has(d('Gift set', 'LITHIUM-PACK'), 'R-06')).toBe(true));
  it.each([
    'Battery-free LED torch',
    'Toy (no batteries)',
    'Remote control, batteries not included',
    'Pump spray (non-aerosol) cleaner',
    'Non-flammable fabric',
    'Alcohol-free hand wash',
    'Ceramic mug',
  ])('does not flag "%s"', (t) => expect(has(d(t), 'R-06')).toBe(false));
  it('plain AA alkaline is only Info', () => {
    const r = run(d('AA alkaline batteries 4-pack'));
    const f = r.findings.find((x) => x.ruleId === 'R-06')!;
    expect(f.severity).toBe('Info');
    expect(r.status).toBe('Ready');
  });
  it('whole words only', () => expect(scanDangerous('Dieselpunk poster')).toEqual([]));
  it('evidence is the matched term', () => {
    expect(run(d('Hairspray 250ml')).findings.find((f) => f.ruleId === 'R-06')!.evidence).toContain('hairspray');
  });
});

describe('R-07 gross vs net weight', () => {
  it('passes when gross is more than net', () => expect(has(booking(), 'R-07')).toBe(false));
  it('passes when equal', () => expect(has(booking({ grossWeightKg: 540 }), 'R-07')).toBe(false));
  it('fails below net with the shortfall', () => {
    const f = run(booking({ grossWeightKg: 500 })).findings.find((x) => x.ruleId === 'R-07')!;
    expect(f.severity).toBe('Amber');
    expect(f.evidence).toContain('shortfall 40 kg');
  });
});

describe('R-08 appointment', () => {
  it('passes with an appointment', () => expect(has(booking(), 'R-08')).toBe(false));
  it('fails for a warehouse without one', () => expect(has(booking({ appointmentBooked: false }), 'R-08')).toBe(true));
  it('does not apply to a business address', () => expect(has(booking({ destinationType: 'Business address', appointmentBooked: false }), 'R-08')).toBe(false));
});

describe('R-09 country of origin', () => {
  it('passes', () => expect(has(booking(), 'R-09')).toBe(false));
  it.each(['', '  ', 'N/A', '-', 'unknown'])('"%s" fails', (v) => expect(has(booking({}, [item({ countryOfOrigin: v })]), 'R-09')).toBe(true));
});

describe('R-10 ready date', () => {
  it('today passes', () => expect(has(booking({ readyDate: '2026-10-26' }), 'R-10')).toBe(false));
  it('yesterday fails', () => {
    const r = run(booking({ readyDate: '2026-10-25' }));
    expect(r.findings.find((f) => f.ruleId === 'R-10')!.fix).toBe('Set a ready date of today or later.');
    expect(r.status).toBe('Needs attention');
  });
  it('missing date is a DATA finding', () => {
    const r = run(booking({ readyDate: null }));
    expect(r.findings.some((f) => f.ruleId === 'DATA' && f.field === 'readyDate')).toBe(true);
    expect(r.couldNotCheck.map((c) => c.ruleId)).toContain('R-10');
  });
});

describe('status and data checks', () => {
  it('amber only → Needs attention', () => expect(run(booking({ appointmentBooked: false })).status).toBe('Needs attention'));
  it('red → Blocked and carrier is provisional', () => {
    const r = run(booking({ declaredValue: 9999 }));
    expect(r.status).toBe('Blocked');
    expect(r.recommendation?.provisional).toBe(true);
  });
  it('booking with no items: DATA, item rules not checked', () => {
    const r = run(booking({}, []));
    expect(r.findings.some((f) => f.problem.includes('No items'))).toBe(true);
    expect(r.couldNotCheck.map((c) => c.ruleId)).toEqual(expect.arrayContaining(['R-01', 'R-02', 'R-03', 'R-04', 'R-06', 'R-07', 'R-09']));
    expect(r.passedRules).not.toContain('R-01');
  });
  it('city/country mismatch', () => {
    const f = run(booking({ destinationCity: 'Paris', destinationCountry: 'Germany' })).findings.find((x) => x.field === 'destinationCountry')!;
    expect(f.problem).toContain('Paris is in France');
  });
  it('unsupported city lists the supported ones', () => {
    const f = run(booking({ destinationCity: 'Köln', destinationCountry: 'Germany' })).findings.find((x) => x.field === 'destinationCity')!;
    expect(f.fix).toContain('Berlin, Frankfurt, Hamburg');
  });
  it('non-GBP currency', () => expect(ids(booking({ currency: 'EUR' }))).toContain('DATA'));
  it('decimal pallets and negative quantities are DATA', () => {
    expect(run(booking({ pallets: 2.5 })).findings.some((f) => f.field === 'pallets')).toBe(true);
    expect(run(booking({}, [item({ quantity: -5 })])).findings.some((f) => f.field === 'quantity')).toBe(true);
  });
  it('allowed-value violations list the allowed values', () => {
    expect(run(booking({ priority: 'Whenever' })).findings.find((f) => f.field === 'priority')!.fix).toContain('Cheapest');
    expect(run(booking({ destinationType: 'Home' })).findings.find((f) => f.field === 'destinationType')!.fix).toContain('Warehouse');
  });
});
