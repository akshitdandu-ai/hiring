import { describe, expect, it } from 'vitest';
import { ruleExtract } from '../src/chat/extractor';
import { initialState, respond, type ConversationState } from '../src/chat/conversationState';
import { emptyBooking } from '../src/chat/slotTracker';
import { applyOps, describeBookingDiff } from '../src/chat/changeDetector';
import { convertNumberWords, expandK, findDate, findForeignMoney, findGbp, findWeights } from '../src/chat/textUtils';
import { parseExtraction } from '../src/chat/ops';
import { booking, item, TODAY } from './fixtures';
import type { Slot } from '../src/chat/ops';

const ops = (text: string, b = booking(), awaiting: Slot[] = []) => ruleExtract(text, { booking: b, awaiting, today: TODAY });
const empty = () => emptyBooking('CHAT-001');

describe('input understanding: numbers, units, money, dates', () => {
  it('number words', () => {
    expect(convertNumberWords('I have three pallets and a dozen boxes')).toBe('I have 3 pallets and 12 boxes');
    expect(convertNumberWords('two dozen')).toBe('24');
    expect(convertNumberWords('two hundred and fifty units')).toBe('250 units');
    expect(convertNumberWords('half a dozen')).toBe('6');
    expect(convertNumberWords('three and four')).toBe('3 and 4');
  });
  it('k suffix', () => {
    expect(expandK('5k')).toBe('5000');
    expect(expandK('1.2k units')).toBe('1200 units');
    expect(expandK('620kg')).toBe('620kg');
  });
  it('weights convert to kg with a note', () => {
    expect(findWeights('620kg')[0].kg).toBe(620);
    expect(findWeights('620 kilos')[0].kg).toBe(620);
    expect(findWeights('0.6 tonnes')[0].kg).toBe(600);
    const lbs = findWeights('1,200 lbs')[0];
    expect(lbs.kg).toBeCloseTo(544.31, 2);
    expect(lbs.note).toContain('1,200 lbs = 544.31 kg');
  });
  it('money in GBP and foreign currency detection', () => {
    expect(findGbp('£5,400')[0].value).toBe(5400);
    expect(findGbp('5400 pounds')[0].value).toBe(5400);
    expect(findGbp('5400 GBP')[0].value).toBe(5400);
    expect(findGbp('1,200 pounds weight')).toEqual([]);
    expect(findForeignMoney('€5,000')[0].currency).toBe('EUR');
    expect(findForeignMoney('$5000')[0].currency).toBe('USD');
    expect(findForeignMoney('5000 euros')[0].currency).toBe('EUR');
  });
  it('dates are day-first and relative to today (Mon 26 Oct 2026)', () => {
    expect(findDate('tomorrow', TODAY)?.iso).toBe('2026-10-27');
    expect(findDate('next Friday', TODAY)?.iso).toBe('2026-11-06');
    expect(findDate('on Friday', TODAY)?.iso).toBe('2026-10-30');
    expect(findDate('5th Nov', TODAY)?.iso).toBe('2026-11-05');
    expect(findDate('5 November 2027', TODAY)?.iso).toBe('2027-11-05');
    expect(findDate('05/11', TODAY)?.iso).toBe('2026-11-05');
    expect(findDate('12/01', TODAY)?.iso).toBe('2027-01-12'); // 12 January, next occurrence (not 1 December)
    expect(findDate('05/11/2026', TODAY)?.iso).toBe('2026-11-05');
    expect(findDate('5-11-26', TODAY)?.iso).toBe('2026-11-05');
    expect(findDate('in 3 days', TODAY)?.iso).toBe('2026-10-29');
    expect(findDate('2/10', TODAY)?.iso).toBe('2027-10-02'); // already past this year → next occurrence
    expect(findDate('01/10/2026', TODAY)?.iso).toBe('2026-10-01'); // explicit past date is kept
    expect(findDate('nothing here', TODAY)).toBeNull();
  });
});

describe('rule-based parser: change operations', () => {
  it.each([
    ['add a pallet', { op: 'increment', field: 'pallets', amount: 1 }],
    ['one more carton', { op: 'increment', field: 'cartons', amount: 1 }],
    ['add 2 more pallets', { op: 'increment', field: 'pallets', amount: 2 }],
    ['remove 2 pallets', { op: 'decrement', field: 'pallets', amount: 2 }],
    ['take off 5 cartons', { op: 'decrement', field: 'cartons', amount: 5 }],
    ['make it 4 pallets', { op: 'set', field: 'pallets', value: 4 }],
    ["actually it's 650 kg", { op: 'set', field: 'grossWeightKg', value: 650 }],
    ['change it to Lyon', { op: 'set', field: 'destinationCity', value: 'Lyon' }],
    ["it's a business address", { op: 'set', field: 'destinationType', value: 'Business address' }],
    ['actually fastest matters most', { op: 'set', field: 'priority', value: 'Fastest' }],
    ['add 100 units of the mugs', { op: 'update_item', match: 'MUG-01', field: 'quantity', value: 100, mode: 'increment' }],
    ['drop the mugs', { op: 'remove_item', match: 'MUG-01' }],
    ['we use 2 skids', { op: 'set', field: 'pallets', value: 2 }],
    ['sixty boxes', { op: 'set', field: 'cartons', value: 60 }],
    ['mugs are £6 each', { op: 'update_item', match: 'MUG-01', field: 'unitPrice', value: 6, mode: 'set' }],
    ['HS code for mugs is 6912.00', { op: 'update_item', match: 'MUG-01', field: 'hsCode', value: '6912.00', mode: 'set' }],
  ])('%s', (text, expected) => {
    expect(ops(text).ops).toContainEqual(expected);
  });
  it('"add 2" is ambiguous', () => {
    const r = ops('add 2');
    expect(r.ops).toEqual([]);
    expect(r.signals.ambiguous).toEqual({ sign: 1, amount: 2 });
  });
  it('questions are not changes', () => {
    const r = ops('what is a pallet?');
    expect(r.ops).toEqual([]);
    expect(r.signals.question).toBe(true);
  });
  it('edits an item by SKU or by description among several', () => {
    const b = booking({}, [item(), item({ sku: 'TOTE-01', description: 'Canvas tote bag' })]);
    expect(ops('the tote bags are £8 each', b).ops).toContainEqual({ op: 'update_item', match: 'TOTE-01', field: 'unitPrice', value: 8, mode: 'set' });
    expect(ops('TOTE-01 weighs 0.4 kg each', b).ops).toContainEqual({ op: 'update_item', match: 'TOTE-01', field: 'unitWeightKg', value: 0.4, mode: 'set' });
    expect(ops('remove the tote bags', b).ops).toContainEqual({ op: 'remove_item', match: 'TOTE-01' });
  });
});

describe('rule-based parser: first messages', () => {
  it('extracts everything from one long message, in any order', () => {
    const r = ops(
      "We are Northfield Goods. Shipping 1080 ceramic mugs at £5 each from Manchester to a warehouse in Frankfurt, 12 per carton, 90 cartons, HS code 6912.00, 0.5kg each, made in the UK. 3 pallets, about 620 kg, ready 5th Nov. Cheapest please.",
      empty(),
    );
    const set = (f: string) => (r.ops.find((o) => o.op === 'set' && o.field === f) as { value: unknown } | undefined)?.value;
    expect(set('sellerName')).toBe('Northfield Goods');
    expect(set('originCity')).toBe('Manchester');
    expect(set('destinationCity')).toBe('Frankfurt');
    expect(set('destinationType')).toBe('Warehouse');
    expect(set('pallets')).toBe(3);
    expect(set('cartons')).toBe(90);
    expect(set('grossWeightKg')).toBe(620);
    expect(set('readyDate')).toBe('2026-11-05');
    expect(set('priority')).toBe('Cheapest');
    const add = r.ops.find((o) => o.op === 'add_item') as { item: Record<string, unknown> };
    expect(add.item).toMatchObject({ description: 'ceramic mugs', quantity: 1080, unitPrice: 5, unitsPerCarton: 12, hsCode: '6912.00', unitWeightKg: 0.5, countryOfOrigin: 'United Kingdom' });
    expect(r.ops.some((o) => o.op === 'set' && o.field === 'declaredValue')).toBe(false); // £5 each is a unit price
  });
  it('several items in one message', () => {
    const r = ops('1080 ceramic mugs at £5 each and 200 tote bags at £8 each, 12 per carton', empty());
    const items = r.ops.filter((o) => o.op === 'add_item') as Array<{ item: Record<string, unknown> }>;
    expect(items).toHaveLength(2);
    expect(items[0].item).toMatchObject({ description: 'ceramic mugs', quantity: 1080, unitPrice: 5 });
    expect(items[1].item).toMatchObject({ description: 'tote bags', quantity: 200, unitPrice: 8, unitsPerCarton: 12 });
  });
  it('declared value vs unit price', () => {
    expect(ops('total value £5,400', empty()).ops).toContainEqual({ op: 'set', field: 'declaredValue', value: 5400 });
    expect(ops('worth 5.4k GBP', empty()).ops).toContainEqual({ op: 'set', field: 'declaredValue', value: 5400 });
  });
  it('boxes = cartons, skids = pallets', () => {
    const r = ops('2 skids, 10 boxes', empty());
    expect(r.ops).toContainEqual({ op: 'set', field: 'pallets', value: 2 });
    expect(r.ops).toContainEqual({ op: 'set', field: 'cartons', value: 10 });
  });
  it('EUR/USD are refused, never converted', () => {
    const r = ops('declared value is €5,000', empty());
    expect(r.ops.some((o) => o.op === 'set' && o.field === 'declaredValue')).toBe(false);
    expect(r.warnings[0]).toContain('Only GBP is supported');
    expect(r.unsupportedCurrency).toBe('EUR');
  });
  it('unsupported destinations are named and the supported ones listed', () => {
    const r = ops('ship to Köln please', empty());
    expect(r.warnings[0]).toContain('Köln is not supported');
    expect(r.warnings[0]).toContain('Berlin, Frankfurt, Hamburg');
    expect(r.ops.some((o) => o.op === 'set' && o.field === 'destinationCity')).toBe(false);
  });
  it('aliases and typos', () => {
    expect(ops('send it to Frankfort', empty()).ops).toContainEqual({ op: 'set', field: 'destinationCity', value: 'Frankfurt' });
    expect(ops('delivery to Holland', empty()).ops).toContainEqual({ op: 'set', field: 'destinationCountry', value: 'Netherlands' });
  });
  it('a country with no city asks for the city', () => {
    expect(ops('to Germany', empty()).countryOnly).toBe('Germany');
  });
  it('weight conversion is stated', () => {
    const r = ops('about 1,200 lbs', empty());
    expect(r.ops).toContainEqual({ op: 'set', field: 'grossWeightKg', value: 544.31 });
    expect(r.notes[0]).toContain('1,200 lbs = 544.31 kg');
  });
  it('bare answers use what we just asked', () => {
    expect(ops('3', empty(), [{ scope: 'booking', field: 'pallets' }]).ops).toContainEqual({ op: 'set', field: 'pallets', value: 3 });
    expect(ops('Northfield Goods', empty(), [{ scope: 'booking', field: 'sellerName' }]).ops).toContainEqual({ op: 'set', field: 'sellerName', value: 'Northfield Goods' });
    expect(ops('3, 620', empty(), [{ scope: 'booking', field: 'pallets' }, { scope: 'booking', field: 'grossWeightKg' }]).ops).toEqual([
      { op: 'set', field: 'pallets', value: 3 },
      { op: 'set', field: 'grossWeightKg', value: 620 },
    ]);
    expect(ops('yes', empty(), [{ scope: 'booking', field: 'appointmentBooked' }]).ops).toContainEqual({ op: 'set', field: 'appointmentBooked', value: true });
  });
});

describe('rule-based parser: more natural phrasings', () => {
  it('lbs, fulfilment centre, fastest', () => {
    const r = ops("I need to send 5 pallets of t-shirts from Leeds to Rotterdam. Total weight about 1,200 lbs. It's for a fulfilment centre. We want the fastest option.", empty());
    expect(r.ops).toContainEqual({ op: 'set', field: 'pallets', value: 5 });
    expect(r.ops).toContainEqual({ op: 'set', field: 'grossWeightKg', value: 544.31 });
    expect(r.ops).toContainEqual({ op: 'set', field: 'destinationType', value: 'Warehouse' });
    expect(r.ops).toContainEqual({ op: 'set', field: 'priority', value: 'Fastest' });
    expect(r.ops).toContainEqual({ op: 'add_item', item: { description: 't-shirts' } });
  });
  it('seller cue, total value, per-box packing', () => {
    const r = ops('Hello! Seller is Acme Candles Ltd. We have 500 soy candles, 20 per box, worth £4,000 in total, going from Birmingham to Hamburg. Ready tomorrow.', empty());
    expect(r.ops).toContainEqual({ op: 'set', field: 'sellerName', value: 'Acme Candles Ltd.' });
    expect(r.ops).toContainEqual({ op: 'set', field: 'declaredValue', value: 4000 });
    expect(r.ops).toContainEqual({ op: 'set', field: 'readyDate', value: '2026-10-27' });
    expect(r.ops.find((o) => o.op === 'add_item')).toMatchObject({ item: { description: 'soy candles', quantity: 500, unitsPerCarton: 20 } });
  });
  it('item details with no item named never leak into booking-level fields', () => {
    const r = ops("it's 12 boxes with 24 units each of scented candles, £6.50 per unit, 0.3 kg per candle, made in Vietnam, HS code 340490", empty());
    expect(r.ops.some((o) => o.op === 'set' && (o.field === 'grossWeightKg' || o.field === 'declaredValue'))).toBe(false);
    expect(r.ops.find((o) => o.op === 'add_item')).toMatchObject({ item: { description: 'scented candles', unitsPerCarton: 24, unitWeightKg: 0.3, unitPrice: 6.5, hsCode: '340490', countryOfOrigin: 'Vietnam' } });
  });
  it('two items with prices in brackets', () => {
    const r = ops('shipping 200 hoodies (£25 each) and 300 beanies (£8 each) london to paris business address', empty());
    const items = r.ops.filter((o) => o.op === 'add_item') as Array<{ item: Record<string, unknown> }>;
    expect(items.map((i) => i.item)).toEqual([
      { description: 'hoodies', quantity: 200, unitPrice: 25 },
      { description: 'beanies', quantity: 300, unitPrice: 8 },
    ]);
  });
});

describe('LLM output validation', () => {
  it('accepts well-formed updates', () => {
    expect(parseExtraction({ updates: [{ op: 'set', field: 'pallets', value: 4 }, { op: 'increment', field: 'cartons', amount: 2 }] })).toHaveLength(2);
  });
  it.each([
    [{ updates: [{ op: 'set', field: 'hsCodeEverything', value: 1 }] }],
    [{ updates: [{ op: 'delete_everything' }] }],
    [{ updates: 'nope' }],
    [null],
    [{ updates: [{ op: 'increment', field: 'sellerName', amount: 1 }] }],
  ])('rejects malformed output %#', (raw) => expect(parseExtraction(raw)).toBeNull());
});

describe('change detector: applying ops', () => {
  it('shows "Pallets: 3 → 4" and never mutates its input', () => {
    const b = booking();
    const r = applyOps(b, [{ op: 'increment', field: 'pallets', amount: 1 }]);
    expect(b.pallets).toBe(3);
    expect(describeBookingDiff(b, r.booking).map((c) => c.text)).toEqual(['Pallets: 3 → 4']);
  });
  it('destination change re-derives the country', () => {
    const r = applyOps(booking(), [{ op: 'set', field: 'destinationCity', value: 'Lyon' }]);
    expect(r.booking.destinationCountry).toBe('France');
    expect(describeBookingDiff(booking(), r.booking)[0].text).toBe('Destination: Frankfurt, Germany → Lyon, France');
  });
  it('business address sets the appointment to No silently; going back to warehouse re-opens the question', () => {
    const b1 = applyOps(booking(), [{ op: 'set', field: 'destinationType', value: 'Business address' }]).booking;
    expect(b1.appointmentBooked).toBe(false);
    expect(b1.fieldSources.appointmentBooked).toBe('inferred');
    const b2 = applyOps(b1, [{ op: 'set', field: 'destinationType', value: 'Warehouse' }]).booking;
    expect(b2.appointmentBooked).toBeNull();
  });
  it('refuses to take pallets to zero', () => {
    const r = applyOps(booking(), [{ op: 'decrement', field: 'pallets', amount: 3 }]);
    expect(r.booking.pallets).toBe(3);
    expect(r.notes[0]).toContain('left it at 3');
  });
  it('item add / update / remove', () => {
    let b = applyOps(booking(), [{ op: 'add_item', item: { description: 'Tote bag', quantity: 10 } }]).booking;
    expect(b.items.map((i) => i.sku)).toEqual(['MUG-01', 'ITEM-2']);
    b = applyOps(b, [{ op: 'update_item', match: 'tote', field: 'unitPrice', value: 8 }]).booking;
    expect(b.items[1].unitPrice).toBe(8);
    b = applyOps(b, [{ op: 'remove_item', match: 'ITEM-2' }]).booking;
    expect(b.items).toHaveLength(1);
  });
  it('flags impossible values straight away', () => {
    const r = applyOps(booking(), [{ op: 'set', field: 'pallets', value: 2.5 }]);
    expect(r.warnings[0]).toContain('whole number');
  });
});

// ----- whole conversations -----
function say(st: ConversationState, ...lines: string[]): ConversationState {
  return lines.reduce((s, l) => respond(s, l, TODAY), st);
}
const last = (st: ConversationState) => st.messages[st.messages.length - 1];
/** Keep confirming ("yes") until the results are showing. */
function confirmAll(st: ConversationState): ConversationState {
  for (let i = 0; i < 8 && st.phase !== 'results'; i++) st = say(st, 'yes');
  return st;
}

describe('conversation', () => {
  it('a vague first message → asks only what is missing, in groups of at most 3, never re-asking', () => {
    let st = say(initialState(), 'I want to ship some mugs to Germany');
    expect(last(st).questions!.length).toBeLessThanOrEqual(3);
    expect(last(st).questions!.join(' ')).toContain('business (seller) name');
    expect(last(st).questions!.join(' ')).toContain('Which city in Germany');
    expect(st.booking.items[0].description).toBe('mugs');
    st = say(st, 'Northfield Goods, collecting from Manchester, Frankfurt warehouse');
    expect(st.booking.sellerName).toBe('Northfield Goods');
    expect(last(st).questions!.join(' ')).not.toMatch(/seller|collect|Which city/);
    expect(last(st).text).toContain('goods');
  });

  const complete = (): ConversationState =>
    say(
      initialState(),
      "We're Northfield Goods, sending 1080 ceramic mugs at £5 each from Manchester to a warehouse in Frankfurt, 12 per carton, HS code 691200, 0.5kg each, made in the UK",
      'yes', // use the calculated cartons
      '3 pallets, 620kg',
      'yes', // use the calculated cartons / value
      'yes',
      '5th Nov, appointment booked',
      'cheapest',
    );

  it('reaches a complete booking, shows a summary, asks to run the checks, then shows results', () => {
    let st = complete();
    expect(st.phase).toBe('confirming');
    expect(last(st).summary?.join(' ')).toContain('Northfield Goods');
    expect(last(st).questions).toEqual(['Shall I run the checks?']);
    expect(st.booking.fieldSources.cartons).toBe('calculated-confirmed');
    expect(st.booking.fieldSources.declaredValue).toBe('calculated-confirmed');
    expect(st.booking.cartons).toBe(90);
    expect(st.booking.declaredValue).toBe(5400);
    st = say(st, 'yes');
    expect(st.phase).toBe('results');
    expect(st.result?.status).toBe('Ready');
    expect(st.result?.recommendation?.option.label).toBe('Carrier A Road economy');
  });

  it('"add a pallet" mid-chat shows the diff and updates checks and carrier', () => {
    let st = say(initialState(), "We're Northfield Goods, 1080 mugs at £5 each, 12 per carton, 90 cartons, HS 691200, 0.5kg each, UK made, from Manchester to Hamburg warehouse, 2 pallets, 1800 kg, appointment booked, 5th Nov, cheapest");
    st = confirmAll(st);
    expect(st.phase).toBe('results');
    expect(st.result?.findings.some((f) => f.ruleId === 'R-05')).toBe(true);
    expect(st.result?.status).toBe('Blocked');
    st = say(st, 'add a pallet');
    const m = last(st);
    expect(m.changes?.map((c) => c.text)).toEqual(['Pallets: 2 → 3']);
    expect(m.checkChanges?.join(' ')).toContain('R-05 now passes');
    expect(m.checkChanges?.join(' ')).toMatch(/Carrier B Road standard/);
    expect(st.result?.findings.some((f) => f.ruleId === 'R-05')).toBe(false);
    expect(st.result?.recommendation?.option.cost).toBe(660);
  });

  it('cost change is reported', () => {
    let st = complete();
    st = say(st, 'yes', 'add a pallet');
    expect(last(st).changes?.map((c) => c.text)).toEqual(['Pallets: 3 → 4']);
    expect(last(st).checkChanges?.join(' ')).toContain('cost rises from £540 to £720');
  });

  it('absolute change, destination change and priority change re-run everything', () => {
    let st = say(complete(), 'yes');
    st = say(st, 'change it to Lyon');
    expect(last(st).changes?.[0].text).toBe('Destination: Frankfurt, Germany → Lyon, France');
    expect(st.result?.carrierOptions[0].pricePerPallet).toBe(170);
    st = say(st, "it's a business address");
    expect(st.booking.appointmentBooked).toBe(false);
    expect(st.result?.findings.some((f) => f.ruleId === 'R-08')).toBe(false);
    st = say(st, 'actually fastest matters most');
    expect(st.result?.recommendation?.option.label).toBe('Carrier C Road express');
  });

  it('conflicting values: the last one wins and is confirmed', () => {
    let st = say(complete(), 'make it 4 pallets');
    st = say(st, '3 pallets');
    expect(st.booking.pallets).toBe(3);
    expect(last(st).text).toContain('Using your latest value');
    expect(last(st).changes?.[0].text).toBe('Pallets: 4 → 3');
  });

  it('ambiguous "add 2" asks what to add', () => {
    let st = say(complete(), 'add 2');
    expect(last(st).text).toBe('2 of what: pallets, cartons or units?');
    st = say(st, 'pallets');
    expect(st.booking.pallets).toBe(5);
  });

  it('undo reverts the last change; start over asks for confirmation first', () => {
    let st = say(complete(), 'make it 4 pallets', 'undo');
    expect(st.booking.pallets).toBe(3);
    expect(last(st).changes?.[0].text).toBe('Pallets: 4 → 3');
    expect(last(say(initialState(), 'undo')).text).toContain('nothing to undo');
    st = say(st, 'start over');
    expect(last(st).text).toContain('Start over?');
    expect(st.booking.pallets).not.toBeNull(); // nothing cleared yet
    st = say(st, 'yes');
    expect(st.booking.pallets).toBeNull();
    expect(st.booking.bookingId).toBe('CHAT-002');
  });

  it('"no" to start over keeps the booking', () => {
    const st = say(complete(), 'start over', 'no');
    expect(st.booking.pallets).toBe(3);
  });

  it('"I don\'t know" for country of origin leaves it blank (R-09 amber)', () => {
    let st = say(initialState(), "We're Northfield Goods, 1080 mugs at £5 each, 12 per carton, HS 691200, 0.5kg each, Manchester to Frankfurt warehouse, 3 pallets, 620 kg, 5th Nov, appointment booked, cheapest");
    st = say(st, 'yes', 'yes', 'yes');
    expect(last(st).questions?.join(' ') ?? '').toContain('country of origin');
    st = say(st, "don't know");
    expect(st.booking.items[0].countryOfOrigin).toBe('');
    st = confirmAll(st);
    expect(st.result?.findings.some((f) => f.ruleId === 'R-09')).toBe(true);
    expect(st.result?.status).toBe('Needs attention');
  });

  it('never invents an HS code: explains, hints, asks once more, then leaves it missing (R-01 Red)', () => {
    let st = say(initialState(), "We're Northfield Goods, 1080 ceramic mugs at £5 each from Manchester to Frankfurt warehouse");
    expect(last(st).questions?.join(' ')).toContain('heading 6912');
    st = say(st, "I don't know the HS code");
    expect(last(st).text).toContain('customs');
    expect(last(st).questions?.join(' ')).toContain('HS code');
    st = say(st, 'still no idea');
    expect(st.booking.items[0].hsCodeRaw).toBe('');
    expect(last(st).questions?.join(' ')).not.toContain('HS code');
    st = say(st, '12 per carton, 0.5kg each, UK made, 3 pallets, 620 kg, 5th Nov, appointment booked, cheapest');
    st = confirmAll(st);
    expect(st.result?.findings.some((f) => f.ruleId === 'R-01' && f.severity === 'Red')).toBe(true);
  });

  it('declining a calculated value asks for the number', () => {
    let st = say(initialState(), "We're Northfield Goods, 1080 mugs at £5 each, 12 per carton, HS 691200, 0.5kg each, UK, Manchester to Frankfurt warehouse");
    expect(last(st).questions?.join(' ')).toContain('1,080 units ÷ 12 per carton = 90 cartons');
    st = say(st, 'no');
    expect(last(st).questions?.join(' ')).toContain('How many cartons of');
    st = say(st, '88');
    expect(st.booking.items[0].cartons).toBe(88);
  });

  it('currency: EUR is refused and the GBP value is asked for', () => {
    const st = say(initialState(), 'The total value is €5,000');
    expect(last(st).warnings?.[0]).toContain('Only GBP is supported');
    expect(st.booking.declaredValue).toBeNull();
  });

  it('a date in the past is accepted with a warning', () => {
    const st = say(initialState(), 'ready on 01/10/2026');
    expect(st.booking.readyDate).toBe('2026-10-01');
    expect(last(st).warnings?.join(' ')).toContain('R-10');
  });

  it('off-topic questions get a one-line answer and a steer back', () => {
    const st = say(initialState(), 'What is the weather like?');
    expect(last(st).text).toContain('I can only help with booking');
    expect(last(st).questions?.length).toBeGreaterThan(0);
  });

  it('appointment is only asked for warehouses', () => {
    const st = say(initialState(), 'Acme Ltd, 100 tote bags at £8 each, 10 per carton, 10 cartons, HS 420292, 0.4kg each, China, Leeds to a business address in Paris, 1 pallet, 60 kg, tomorrow, cheapest');
    expect(st.booking.appointmentBooked).toBe(false);
    expect(st.booking.fieldSources.appointmentBooked).toBe('inferred');
    expect(JSON.stringify(st.messages.map((m) => m.questions))).not.toContain('appointment');
  });
});
