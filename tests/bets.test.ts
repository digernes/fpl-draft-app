import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { leadersOf, leftIn, oddsNow, payoutOf, profitOf, resultOf, type Bet } from '../src/shared/bets.ts';
import { slimFeed } from '../worker/feed.ts';
import { NOW, rawFeed } from './fixtures/live-feed.ts';
import { annVBobLive } from './fixtures/match.ts';

const bet = (name: string, gw: number, stake: number, payout?: number): Bet => ({
  id: 0,
  name,
  season: '2026-27',
  gw,
  home: 1,
  away: 2,
  pick: 0,
  stake,
  price: 2,
  at: 0,
  ...(payout === undefined ? {} : { result: 0, payout }),
});

describe('the betting’s rules', () => {
  it('reads a finished head-to-head’s result from its points, a level score a draw', () => {
    const m = { gw: 1, home: 1, away: 2, homePts: 50, awayPts: 40, started: true, finished: true };
    assert.equal(resultOf(m), 0);
    assert.equal(resultOf({ ...m, awayPts: 50 }), 1);
    assert.equal(resultOf({ ...m, awayPts: 60 }), 2);
    assert.equal(resultOf({ ...m, finished: false }), null);
  });

  it('pays back whole coins, and counts what a bet won or lost once it’s settled', () => {
    assert.equal(payoutOf(150, 2.15), 323);
    assert.equal(profitOf(bet('Ola', 1, 100, 210)), 110);
    assert.equal(profitOf(bet('Ola', 1, 100, 0)), -100);
    assert.equal(profitOf(bet('Ola', 1, 100)), 0);
  });

  it('gives each gameweek its own allowance', () => {
    const bets = [bet('Ola', 3, 300), bet('Ola', 4, 100), { ...bet('Ola', 3, 500), season: '2025-26' }];
    assert.equal(leftIn(bets, '2026-27', 3), 700);
    assert.equal(leftIn(bets, '2026-27', 4), 900);
    assert.equal(leftIn(bets, '2026-27', 5), 1000);
  });

  it('ranks on winnings from settled bets, then on the average per gameweek', () => {
    const bets = [
      bet('Ola', 1, 100, 300), // +200
      bet('Kari', 1, 100, 200), // +100
      bet('Kari', 2, 100, 200), // +100: +200 over two gameweeks
      bet('Per', 1, 100, 0),
      bet('Per', 2, 500), // open: not counted
    ];
    assert.deepEqual(leadersOf(bets), [
      { name: 'Ola', profit: 200, gws: 1, bets: 1, won: 1 },
      { name: 'Kari', profit: 200, gws: 2, bets: 2, won: 2 },
      { name: 'Per', profit: -100, gws: 1, bets: 1, won: 0 },
    ]);
  });

  it('prices a live match at its live odds, until a result is all but sure', () => {
    const d = annVBobLive();
    const m = d.matches.find((x) => x.gw === 3)!;
    const feed = slimFeed(rawFeed() as never, NOW);
    const live = oddsNow(d, m, NOW, feed, (f) => feed.matches[f]);
    assert.ok(typeof live === 'object');
    assert.deepEqual(live.live, [11, 7]);
    assert.ok(live.prices.every((p) => p > 1));
    // Haaland's 30 minutes now worth nothing more, and all but done: Ann's 11 to Bob's 2.
    const done = slimFeed(rawFeed([0, 89]) as never, NOW);
    done.fixtures.forEach((f) => Object.assign(f, { done: true }));
    const decided = oddsNow(d, m, NOW, done, () => undefined);
    assert.equal(decided, 'Betting has closed: the result is all but sure');
    assert.equal(oddsNow(d, m, NOW, null), 'Live betting opens once the gameweek’s first data build is in');
  });
});
