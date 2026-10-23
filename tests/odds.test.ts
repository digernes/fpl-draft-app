import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fromProjections, normalCdf, price, winDrawWin } from '../src/build/odds.ts';
import { bestXi } from '../src/shared/best-xi.ts';
import type { Position } from '../src/shared/data.ts';
import { gaussian, mulberry32 } from '../src/build/simulation.ts';
import { liveOdds } from '../src/shared/odds.ts';
import { matchResult, streaks } from '../src/build/tables.ts';

describe('prices', () => {
  it('rounds down onto each ladder, with the overround', () => {
    assert.deepEqual(price(0.5), { dec: 1.9, frac: '5/6' }); // fair 1.905 after the 5% margin
    assert.deepEqual(price(0.25), { dec: 3.8, frac: '11/4' });
    assert.deepEqual(price(0.022), { dec: 42, frac: '40/1' });
    assert.deepEqual(price(0.999), { dec: 1.01, frac: '1/100' }); // never below the shortest price
    assert.deepEqual(price(0), { dec: 100, frac: '100/1' }); // nor above the longest
  });

  it('tells close chances apart in decimal, where the fractional ladder cannot', () => {
    const [a, b] = [price(0.482), price(0.497)];
    assert.equal(a.frac, b.frac);
    assert.deepEqual([a.dec, b.dec], [1.97, 1.91]);
  });

  it('gives home, draw and away probabilities that add up to one', () => {
    const p = winDrawWin(55, 48, 14);
    assert.ok(Math.abs(p.home + p.draw + p.away - 1) < 1e-12);
    assert.ok(p.home > p.away && p.draw > 0 && p.draw < 0.05);
  });

  it('is symmetric for equal managers', () => {
    const p = winDrawWin(50, 50, 13);
    assert.ok(Math.abs(p.home - p.away) < 1e-12);
  });

  it('has a normal CDF close to the real one', () => {
    assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-7);
    assert.ok(Math.abs(normalCdf(1.96) - 0.975) < 1e-4);
    assert.ok(Math.abs(normalCdf(-1) - 0.1587) < 1e-4);
  });
});

describe('expected scores', () => {
  it('put each side as far from the league average as its projected XI is from the average one', () => {
    const score = fromProjections({ 1: 50, 2: 40, 3: 45 }, 47);
    assert.deepEqual([1, 2, 3].map(score), [52, 42, 47]);
  });
});

describe('bestXi', () => {
  const limits: Record<Position, [number, number]> = { GKP: [1, 1], DEF: [3, 5], MID: [2, 5], FWD: [1, 3] };
  // 2 GKP, 5 DEF, 5 MID, 3 FWD; the forwards project best, the defenders worst.
  const positions: Position[] = ['GKP', 'GKP', 'DEF', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'MID', 'FWD', 'FWD', 'FWD'];
  const ep = [5, 1, 1, 1, 1, 1, 1, 4, 4, 4, 4, 4, 6, 6, 6];
  const squad = positions.map((_, i) => i);
  it('picks the best legal XI', () => {
    const xi = bestXi(
      squad,
      (pid) => ep[pid],
      (pid) => positions[pid],
      limits,
    );
    assert.equal(xi.ids.length, 11);
    assert.equal(xi.pts, 5 + 3 * 1 + 4 * 4 + 3 * 6); // 3-4-3: three forwards is the most allowed
  });

  it('keeps every position within its limits', () => {
    // One goalkeeper, three defenders, six midfielders and a forward: the only way to
    // eleven is six midfielders, one over the maximum, so there is no legal XI.
    const short: Position[] = ['GKP', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'MID', 'MID', 'FWD'];
    const ids = (list: Position[]) => list.map((_, i) => i);
    assert.deepEqual(
      bestXi(
        ids(short),
        () => 1,
        (pid) => short[pid],
        limits,
      ).ids,
      [],
    );
    // A second forward, even one worth nothing, makes 1-3-5-2 possible.
    const fixed: Position[] = [...short, 'FWD'];
    const xi = bestXi(
      ids(fixed),
      (pid) => (pid === 11 ? 0 : 1),
      (pid) => fixed[pid],
      limits,
    );
    assert.deepEqual(
      xi.ids.sort((a, b) => a - b),
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11],
    );
  });
});

describe('simulation randomness', () => {
  it('is the same for the same seed', () => {
    const a = gaussian(mulberry32(7));
    const b = gaussian(mulberry32(7));
    assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  });
  it('looks like a standard normal', () => {
    const normal = gaussian(mulberry32(1));
    const draws = Array.from({ length: 20000 }, normal);
    const mean = draws.reduce((s, x) => s + x, 0) / draws.length;
    const sd = Math.sqrt(draws.reduce((s, x) => s + (x - mean) ** 2, 0) / draws.length);
    assert.ok(Math.abs(mean) < 0.03 && Math.abs(sd - 1) < 0.03);
  });
});

describe('streaks', () => {
  it('finds the best winning run and the current form', () => {
    const results = [60, 60, 40, 60, 60, 60, 50].map((pf, i) => matchResult(i + 1, 0, pf, 50));
    assert.deepEqual(streaks(results), { bestWin: 3, current: 'D1' });
    assert.deepEqual(streaks([]), { bestWin: 0, current: null });
  });
});

describe('live odds', () => {
  it('favour the side ahead, more so as the gameweek runs out', () => {
    const early = liveOdds({ mean: 50, variance: 90 }, { mean: 45, variance: 90 }, 1.05);
    const late = liveOdds({ mean: 50, variance: 4 }, { mean: 45, variance: 4 }, 1.05);
    assert.ok(early.p[0] > early.p[2] && late.p[0] > early.p[0]);
  });
  it('settle once nothing is left to play', () => {
    const over = liveOdds({ mean: 52, variance: 0 }, { mean: 48, variance: 0 }, 1.05);
    assert.deepEqual(over.p, [1, 0, 0]);
    assert.equal(over.prices[0].dec, 1.01);
    const level = liveOdds({ mean: 50, variance: 0 }, { mean: 50, variance: 0 }, 1.05);
    assert.deepEqual(level.p, [0, 1, 0]);
  });
});
