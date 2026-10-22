import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { bestXi, normalCdf, price, rating, winDrawWin } from '../src/build/odds.ts';
import { gaussian, mulberry32 } from '../src/build/simulation.ts';
import { matchResult, streaks } from '../src/build/tables.ts';

describe('prices', () => {
  it('rounds down onto the fractional ladder, with the overround', () => {
    assert.deepEqual(price(0.5), { dec: 1.83, frac: '5/6' }); // fair 1.90 after the 5% margin
    assert.deepEqual(price(0.25), { dec: 3.75, frac: '11/4' });
    assert.deepEqual(price(0.999), { dec: 1.01, frac: '1/100' }); // never below the shortest price
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

describe('rating', () => {
  const results = [40, 60, 70].map((pf, i) => matchResult(i + 1, 0, pf, 50));
  it('starts at the league mean', () => {
    assert.equal(rating([], 50), 50);
  });
  it('weights recent weeks more', () => {
    const recentFirst = rating(results, 50);
    const recentLast = rating([...results].reverse(), 50);
    assert.ok(recentFirst > recentLast);
  });
});

describe('bestXi', () => {
  const rules = {
    play: 11,
    ...{
      min_play_GKP: 1,
      max_play_GKP: 1,
      min_play_DEF: 3,
      max_play_DEF: 5,
      min_play_MID: 2,
      max_play_MID: 5,
      min_play_FWD: 1,
      max_play_FWD: 3,
    },
  };
  // 2 GKP, 5 DEF, 5 MID, 3 FWD; the forwards project best, the defenders worst.
  const types = [1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4];
  const ep = [5, 1, 1, 1, 1, 1, 1, 4, 4, 4, 4, 4, 6, 6, 6];
  const squad = types.map((_, i) => i);
  it('picks the best legal XI', () => {
    const xi = bestXi(
      squad,
      (pid) => ep[pid],
      (pid) => types[pid],
      rules,
    );
    assert.equal(xi.ids.length, 11);
    assert.equal(xi.pts, 5 + 3 * 1 + 4 * 4 + 3 * 6); // 3-4-3: three forwards is the most allowed
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
