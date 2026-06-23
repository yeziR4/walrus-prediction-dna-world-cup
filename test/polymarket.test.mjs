import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeWorldCupPositions, buildPolymarketDna, isWorldCupPosition } from '../polymarket.mjs';

const fixture = [
  { conditionId: 'a', asset: '1', slug: 'fifwc-eng-hrv-2026-goals-kane-gte1', eventSlug: 'fifwc-eng-hrv-2026-player-props', title: 'Harry Kane: 1+ goals', outcome: 'No', avgPrice: .7, curPrice: 1, redeemable: true, endDate: '2026-06-17' },
  { conditionId: 'b', asset: '2', slug: 'fifwc-ger-kor-2026-match-winner', eventSlug: 'fifwc-ger-kor-2026', title: 'Germany to win', outcome: 'Yes', avgPrice: .6, curPrice: 0, redeemable: true, endDate: '2026-06-14' },
  { conditionId: 'c', asset: '3', slug: 'unrelated-market', title: 'Not football', outcome: 'Yes', avgPrice: .5, curPrice: .5, redeemable: false }
];

test('recognizes World Cup slugs', () => assert.equal(isWorldCupPosition(fixture[0]), true));
test('recognizes football world-cup slugs without pulling cricket world cups', () => {
  assert.equal(isWorldCupPosition({ slug: 'world-cup-goals-h2h-messi-vspt-ronaldo-20260604005506837', title: 'World Cup Goals H2H: Messi vs. Ronaldo' }), true);
  assert.equal(isWorldCupPosition({ slug: 'crint-nzl6-sco5-2026-06-23', title: 'ICC T20 World Cup, Women: New Zealand vs Scotland' }), false);
});
test('builds a DNA only from World Cup positions', () => {
  const dna = analyzeWorldCupPositions(fixture, { address: `0x${'a'.repeat(40)}`, displayName: 'Ada' });
  assert.equal(dna.summary.totalWorldCupPositions, 2);
  assert.equal(dna.summary.resolved, 2);
  assert.equal(dna.summary.winRate, 50);
  assert.equal(dna.predictions[0].marketType, 'player_goals');
  assert.equal(dna.displayName, 'Ada');
});
test('builds an emerging DNA before the first prediction resolves', () => {
  const dna = analyzeWorldCupPositions([{ conditionId: 'open', asset: '1', slug: 'fifwc-usa-mex-2026-match-winner', eventSlug: 'fifwc-usa-mex-2026', title: 'USA to win', outcome: 'Yes', avgPrice: .4, curPrice: .4, redeemable: false }], { displayName: 'New fan' });
  assert.equal(dna.summary.totalWorldCupPositions, 1);
  assert.equal(dna.summary.resolved, 0);
  assert.equal(dna.archetype, 'The Emerging Scout');
  assert.deepEqual(dna.traits.slice(0, 2), ['Emerging sample', 'Awaiting outcomes']);
});
test('builds from current World Cup positions when closed history is temporarily unavailable', async () => {
  const fetchImpl = async url => {
    if (String(url).includes('/closed-positions')) return { ok: false, status: 408, json: async () => [] };
    return { ok: true, status: 200, json: async () => [{ conditionId: 'open', asset: '1', slug: 'world-cup-goals-h2h-messi-vspt-ronaldo-20260604005506837', eventSlug: 'world-cup-goals-h2h-messi-vspt-ronaldo-20260604005506837', title: 'World Cup Goals H2H: Messi vs. Ronaldo', outcome: 'Messi', avgPrice: .92, curPrice: .96, redeemable: false }] };
  };
  const dna = await buildPolymarketDna(`0x${'b'.repeat(40)}`, 'Agent wallet', fetchImpl);
  assert.equal(dna.summary.totalWorldCupPositions, 1);
  assert.equal(dna.summary.resolved, 0);
  assert.match(dna.metadata.closedReadWarning, /offset 0/);
});
