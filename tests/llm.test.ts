import { describe, expect, it } from 'vitest';
import { llmExtract, mergeLlm } from '../src/chat/llm';
import { ruleExtract } from '../src/chat/extractor';
import { respond, initialState } from '../src/chat/conversationState';
import { resultsToCsv } from '../src/util/csv';
import { evaluateBooking } from '../src/engine/evaluateBooking';
import { booking, TODAY } from './fixtures';

const jsonRes = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

describe('optional LLM extractor', () => {
  it('returns validated ops', async () => {
    const f = async () => jsonRes({ updates: [{ op: 'set', field: 'pallets', value: 4 }] });
    expect(await llmExtract('make it 4 pallets', booking(), f as unknown as typeof fetch)).toEqual([{ op: 'set', field: 'pallets', value: 4 }]);
  });
  it('invalid JSON shape → null (rule-based parser takes over)', async () => {
    const f = async () => jsonRes({ updates: [{ op: 'format_disk' }] });
    expect(await llmExtract('x', booking(), f as unknown as typeof fetch)).toBeNull();
  });
  it('server error → null', async () => {
    expect(await llmExtract('x', booking(), (async () => jsonRes({}, 502)) as unknown as typeof fetch)).toBeNull();
  });
  it('network failure → null', async () => {
    expect(await llmExtract('x', booking(), (async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toBeNull();
  });
  it('timeout (> 6 s budget) → null', async () => {
    const hang = (_u: unknown, init?: { signal?: AbortSignal }) => new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    expect(await llmExtract('x', booking(), hang as unknown as typeof fetch, 20)).toBeNull();
  });
  it('a missing key (501) disables it for the session and returns null', async () => {
    let calls = 0;
    const f = async () => { calls++; return jsonRes({ error: 'not configured' }, 501); };
    expect(await llmExtract('x', booking(), f as unknown as typeof fetch)).toBeNull();
    expect(await llmExtract('x', booking(), f as unknown as typeof fetch)).toBeNull();
    expect(calls).toBe(1);
  });
  it('merge: LLM ops replace rule ops, but a refused currency can never become a value', () => {
    const rule = ruleExtract('declared value is €5,000', { booking: booking(), awaiting: [], today: TODAY });
    const merged = mergeLlm(rule, [{ op: 'set', field: 'declaredValue', value: 5000 }, { op: 'set', field: 'pallets', value: 2 }]);
    expect(merged.ops).toEqual([{ op: 'set', field: 'pallets', value: 2 }]);
    expect(merged.warnings[0]).toContain('Only GBP');
  });
  it('merge with null keeps the rule-based result (app works with the LLM off)', () => {
    const rule = ruleExtract('add a pallet', { booking: booking(), awaiting: [], today: TODAY });
    expect(mergeLlm(rule, null)).toBe(rule);
    const st = respond(initialState(), 'add a pallet', TODAY, mergeLlm(rule, null));
    expect(st.messages.length).toBeGreaterThan(1);
  });
});

describe('results CSV', () => {
  it('has a header row and one row per booking, quoting commas and quotes', () => {
    const r = evaluateBooking(booking({ sellerName: 'Smith, "Jones" & Co', declaredValue: 9999 }), { today: TODAY });
    const csv = resultsToCsv([r, evaluateBooking(booking({ bookingId: 'BK-002' }), { today: TODAY })]);
    const lines = csv.replace(/^﻿/, '').split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('Booking ID,Seller,Route,Status');
    expect(lines[1]).toContain('"Smith, ""Jones"" & Co"');
    expect(lines[1]).toContain('Blocked');
    expect(lines[1]).toContain('R-02');
    expect(lines[2]).toContain('Ready');
  });
});

describe('seller name capture', () => {
  it('stops before "and I want…"', () => {
    const r = ruleExtract("we're Northfield Goods and I want to ship some mugs", { booking: booking(), awaiting: [], today: TODAY });
    expect(r.ops).toContainEqual({ op: 'set', field: 'sellerName', value: 'Northfield Goods' });
  });
});
