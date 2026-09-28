import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRubric } from '../lib/rubric-parse.mjs';
import { splitPersonalDetails } from '../lib/extract.ts';
import { rankCandidates, weightedScore, personalise } from '../lib/ranking.ts';

test('rubric.txt parses into 5 criteria per role, weights summing to 100', () => {
  const { criteria, guidance } = parseRubric(readFileSync(new URL('../rubric.txt', import.meta.url), 'utf8'));
  for (const role of ['PM', 'SPM']) {
    const rs = criteria.filter((c: { role: string }) => c.role === role);
    assert.equal(rs.length, 5);
    assert.equal(rs.reduce((a: number, c: { weight: number }) => a + c.weight, 0), 100);
    for (const c of rs) assert.ok(c.anchor_5 && c.anchor_3 && c.anchor_1, `${c.id} anchors`);
  }
  assert.ok(guidance.how_to_score.includes('Weighted score'));
});

test('personal details are split out and redacted from the CV text', () => {
  const cv = `ENTERPRISE SALES · LOGISTICS
Meera Kulkarni
meera.k.pm@mesa-test.com  |  +91 98765 43210  |  Mumbai  |  linkedin.com/in/meerak
EXPERIENCE
Operations Executive 2017-2020: Bills of Lading, DO release. Meera built an Excel tracker.`;
  const { personal, redacted } = splitPersonalDetails(cv);
  assert.equal(personal.name, 'Meera Kulkarni');
  assert.equal(personal.email, 'meera.k.pm@mesa-test.com');
  assert.equal(personal.phone, '+91 98765 43210');
  assert.deepEqual(personal.links, ['linkedin.com/in/meerak']);
  for (const pii of ['Meera', 'Kulkarni', 'mesa-test', '98765', 'linkedin']) assert.ok(!redacted.includes(pii), pii);
  assert.ok(redacted.includes('2017-2020'), 'year ranges are not mistaken for phone numbers');
  assert.ok(redacted.includes('Bills of Lading'));
});

test('labelled and all-caps names are found', () => {
  assert.equal(splitPersonalDetails('CURRICULUM VITAE\nName: Karan Mehra\nkaran@x.com\n' + 'x'.repeat(50)).personal.name, 'Karan Mehra');
  assert.equal(splitPersonalDetails('RAHUL BOSE\nGrowth Leader\nrahul.bose@x.com').personal.name, 'Rahul Bose');
});

test('weighted score = sum(score/5 x weight)', () => {
  assert.equal(weightedScore([{ score: 5, weight: 30 }, { score: 3, weight: 15 }, { score: 1, weight: 55 }]), 50);
});

test('top N above threshold get invites; overrides win', () => {
  const mk = (id: string, role: 'PM' | 'SPM', s: number, o: 'invite' | 'reject' | null = null) => ({
    id, applied_role: role, status: 'scored', pm_score: s, spm_score: s, decision_override: o, created_at: '2026-01-01',
  });
  const r = rankCandidates([mk('a', 'PM', 90), mk('b', 'PM', 80), mk('c', 'PM', 70), mk('d', 'SPM', 40), mk('e', 'PM', 20, 'invite')], 2, 60);
  assert.deepEqual([r.get('a')!.decision, r.get('b')!.decision, r.get('c')!.decision], ['invite', 'invite', 'reject']);
  assert.equal(r.get('d')!.decision, 'reject', 'top of its role but below the threshold');
  assert.equal(r.get('e')!.decision, 'invite');
  assert.equal(r.get('e')!.recommended, 'reject');
});

test('real first name replaces placeholders', () => {
  assert.equal(personalise('Hi [NAME], re [CANDIDATE]', 'Lavanya Iyer'), 'Hi Lavanya, re Lavanya');
});
