import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fromProjections, normalCdf, price, winDrawWin } from '../src/build/odds.ts';
import { bestXi } from '../src/shared/best-xi.ts';
import type { Position } from '../src/shared/data.ts';
import { gaussian, mulberry32 } from '../src/build/simulation.ts';
import {
  dropsOf,
  finalChances,
  finalScore,
  jumpsMean,
  liveOdds,
  lnGamma,
  lowerGamma,
  outcomeProbabilities,
  type Grid,
  type Heading,
  type Jump,
} from '../src/shared/odds.ts';
import { rareDrops } from '../src/shared/live-projection.ts';
import { matchResult, streaks } from '../src/build/tables.ts';

describe('prices', () => {
  it('rounds down onto each ladder, with the overround', () => {
    assert.deepEqual(price(0.5), { dec: 1.9, frac: '9/10' }); // fair 1.905 after the 5% margin
    assert.deepEqual(price(0.25), { dec: 3.8, frac: '14/5' });
    assert.deepEqual(price(0.53), { dec: 1.79, frac: '3/4' }); // filled in near evens: not 8/11 (1.73)
    assert.deepEqual(price(0.022), { dec: 42, frac: '42/1' }); // every whole price at the long end
    assert.deepEqual(price(0.999), { dec: 1.01, frac: '1/100' }); // never below the shortest price
    assert.deepEqual(price(1), { dec: 1, frac: '1/5000' }); // but a sure thing is 1.00
    assert.deepEqual(price(0.9996), { dec: 1, frac: '1/5000' }); // as is what shows as 100%
    assert.deepEqual(price(0), { dec: 5000, frac: '5000/1' }); // nor above the longest
  });

  it('goes on to the books’ long prices beyond 100/1, for a side all but beaten', () => {
    assert.deepEqual(price(0.003), { dec: 300, frac: '300/1' }); // fair 317.5
    assert.deepEqual(price(0.0004), { dec: 2250, frac: '2000/1' }); // fair 2381: the decimal ladder is finer
    assert.deepEqual(price(0.0001), { dec: 5000, frac: '5000/1' }); // fair 9524, capped
  });

  it('tells close chances apart in decimal, where the fractional ladder cannot', () => {
    const [a, b] = [price(0.489), price(0.498)];
    assert.equal(a.frac, b.frac);
    assert.deepEqual([a.dec, b.dec], [1.94, 1.91]);
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
    // Or a part of that gap.
    const half = fromProjections({ 1: 50, 2: 40, 3: 45 }, 47, 0.5);
    assert.deepEqual([1, 2, 3].map(half), [49.5, 44.5, 47]);
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
    assert.equal(over.prices[0].dec, 1); // 1.00: it's won
    const level = liveOdds({ mean: 50, variance: 0 }, { mean: 50, variance: 0 }, 1.05);
    assert.deepEqual(level.p, [0, 1, 0]);
  });
});

// A side with nothing left to play, on `score` for certain.
const done = (score: number): Heading => ({ mean: score, variance: 0, floor: score });
// The chance a side ends on `score`: a draw with that score for certain.
const endsOn = (side: Heading, score: number) => finalChances(side, done(score))[1];
const normal = (home: Heading, away: Heading) => {
  const p = outcomeProbabilities(home.mean - away.mean, Math.sqrt(home.variance + away.variance));
  return [p.home, p.draw, p.away];
};
const close = (a: number, b: number, tolerance: number) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≠ ${b} ± ${tolerance}`);

describe('live odds from skewed final scores', () => {
  // GW 8: Curt's XI all done on 39; Brage on 40 with Le Fée and Brobbey (Sunderland) still to
  // kick off, 6.5 points expected between them, a full match each, and 2 each to lose at worst.
  const curt = done(39);
  const brage: Heading = { mean: 46.5, variance: 18, floor: 36 };

  it('give a side all done little chance against two attackers who have only to turn up', () => {
    const [win, draw, lose] = finalChances(curt, brage);
    assert.ok(win < 0.005, `Curt ${win}`);
    assert.ok(draw < 0.02, `draw ${draw}`);
    assert.ok(lose > 0.98);
    // Where the normal had him at 3%, as much weight on Brage losing 6 as on gaining 18.
    assert.ok(normal(curt, brage)[0] > 0.025);
    assert.deepEqual(liveOdds(curt, brage, 1.05).prices[2], { dec: 1.01, frac: '1/100' });
  });

  it('keep a lead the other side can’t lose for certain', () => {
    // Ahead by 6 with two players to play, who can lose 4 between them at worst.
    assert.deepEqual(liveOdds(done(39), { mean: 50, variance: 18, floor: 41 }, 1).p, [0, 0, 1]);
    assert.deepEqual(liveOdds({ mean: 50, variance: 18, floor: 41 }, done(39), 1).p, [1, 0, 0]);
    const [win, , lose] = finalChances(done(39), { mean: 50, variance: 18, floor: 41 });
    assert.equal(win, 0);
    close(lose, 1, 1e-12);
    // Ahead by just as much as he can lose: a draw at worst, and not a likely one.
    const [ahead, level, behind] = finalChances({ mean: 47, variance: 9, floor: 39 }, done(39));
    assert.equal(behind, 0);
    assert.ok(level > 0 && level < 0.01 && ahead > 0.99);
  });

  it('settle exactly once nothing is left to play either way', () => {
    assert.deepEqual(finalChances(done(52), done(48)), [1, 0, 0]);
    assert.deepEqual(finalChances(done(48), done(52)), [0, 0, 1]);
    assert.deepEqual(finalChances(done(50), done(50)), [0, 1, 0]);
    assert.deepEqual(liveOdds(done(50), done(50), 1.05).p, [0, 1, 0]);
    // A floor at the mean leaves nothing to come either, whatever the variance says.
    assert.deepEqual(finalChances({ mean: 50, variance: 9, floor: 50 }, done(49)), [1, 0, 0]);
  });

  it('change little with plenty still to play', () => {
    // Two full XIs, 2 to lose at worst each: within a point and a half of the normal.
    for (const lead of [0, 3, 8, 15, 25]) {
      const home: Heading = { mean: 45 + lead, variance: 99, floor: 23 + lead };
      const away: Heading = { mean: 45, variance: 99, floor: 23 };
      const skewed = finalChances(home, away);
      normal(home, away).forEach((p, i) => close(skewed[i], p, 0.015));
    }
    // Without floors, the normal as before.
    assert.deepEqual(
      finalChances({ mean: 50, variance: 90 }, { mean: 45, variance: 90 }),
      normal({ mean: 50, variance: 90 }, { mean: 45, variance: 90 }),
    );
  });

  it('lay each side’s points still to come out with its mean and variance, skewed right above the floor', () => {
    const sides: (Heading & { floor: number })[] = [
      { mean: 46.5, variance: 18, floor: 36 },
      { mean: 3, variance: 9, floor: -2 },
      { mean: 1.5, variance: 2, floor: 0 },
      { mean: 60, variance: 99, floor: 18 },
    ];
    for (const side of sides) {
      const scores = Array.from({ length: 140 }, (_, i) => Math.floor(side.floor) + i);
      const p = scores.map((k) => endsOn(side, k));
      const mean = scores.reduce((t, k, i) => t + k * p[i], 0);
      const variance = scores.reduce((t, k, i) => t + (k - mean) ** 2 * p[i], 0);
      close(
        p.reduce((t, x) => t + x, 0),
        1,
        1e-6,
      );
      // Each whole score has the gamma's chance within half a point of it, near enough.
      const [shape, scale] = [(side.mean - side.floor) ** 2 / side.variance, side.variance / (side.mean - side.floor)];
      const below = (x: number) => lowerGamma(shape, Math.max(0, x - side.floor) / scale);
      scores.forEach((k, i) => close(p[i], below(k + 0.5) - below(k - 0.5), 3e-3));
      close(mean, side.mean, 0.03); // rounding to whole points moves it a little
      close(variance, side.variance + 1 / 12, 0.1); // whole points on top of the gamma's spread
      // Nothing below the floor; more below the mean than above it, and a longer way up.
      assert.ok(endsOn(side, Math.floor(side.floor) - 1) < 1e-12);
      const underMean = scores.reduce((t, k, i) => t + (k < side.mean ? p[i] : 0), 0);
      assert.ok(underMean > 0.5, `${underMean}`);
    }
    // Little to come and the floor near: most likely nothing more, now and then a lot.
    const late: Heading = { mean: 0.6, variance: 2, floor: 0 };
    assert.ok(endsOn(late, 0) > 0.7 && endsOn(late, 5) > 0.005);
    assert.ok(endsOn(late, -1) < 1e-12);
  });

  it('count a draw as both on the same whole points', () => {
    // One side on 40 for certain, the other's gamma above 37: the draw is its chance between 39.5 and 40.5.
    const side: Heading = { mean: 41, variance: 6, floor: 37 };
    const [shape, scale] = [16 / 6, 6 / 4];
    const between = lowerGamma(shape, 3.5 / scale) - lowerGamma(shape, 2.5 / scale);
    close(finalChances(side, done(40))[1], between, 2e-3);
    // Level in expectation, both still to play: a draw is likelier the less there is to come.
    const late = finalChances({ mean: 40, variance: 4, floor: 36 }, { mean: 40, variance: 4, floor: 36 });
    const early = finalChances({ mean: 40, variance: 60, floor: 18 }, { mean: 40, variance: 60, floor: 18 });
    assert.ok(late[1] > early[1] && early[1] > 0.02);
    close(late[0], late[2], 1e-12);
  });

  it('swap with the sides', () => {
    const pairs: [Heading, Heading][] = [
      [curt, brage],
      [
        { mean: 52, variance: 30, floor: 40 },
        { mean: 47, variance: 12, floor: 41 },
      ],
      [{ mean: 20.3, variance: 0.5, floor: 19 }, done(20)],
    ];
    for (const [a, b] of pairs) {
      const [win, draw, lose] = finalChances(a, b);
      const swapped = finalChances(b, a);
      close(swapped[0], lose, 1e-12);
      close(swapped[1], draw, 1e-12);
      close(swapped[2], win, 1e-12);
    }
  });

  it('rise with the lead', () => {
    const away: Heading = { mean: 45, variance: 27, floor: 39 };
    let last = [0, 0, 1];
    for (let lead = -12; lead <= 12; lead += 0.5) {
      const p = finalChances({ mean: 45 + lead, variance: 18, floor: 41 + lead }, away);
      assert.ok(p[0] >= last[0] && p[2] <= last[2], `at ${lead}`);
      last = p;
    }
    // And with the points so far for the side all done.
    const chances = [36, 38, 40, 42, 44].map((score) => finalChances(done(score), brage)[0]);
    chances.slice(1).forEach((p, i) => assert.ok(p > chances[i]));
  });
});

describe('drops laid over the gamma', () => {
  // A grid's chances by score, in tenths of a point.
  const cells = (g: Grid) => Object.fromEntries([...g.p].flatMap((p, i) => (p ? [[g.start + i, p]] : [])));
  const nearly = (a: Record<string, number>, b: Record<string, number>) => {
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());
    for (const k of Object.keys(a)) close(a[k], b[k], 1e-12);
  };
  const momentsOf = (g: Grid) => {
    const mean = [...g.p].reduce((t, p, i) => t + p * (g.start + i) * 0.1, 0);
    return [mean, [...g.p].reduce((t, p, i) => t + p * ((g.start + i) * 0.1 - mean) ** 2, 0)];
  };

  it('take a drop’s chances as they are, one outcome at most of each', () => {
    nearly(cells(dropsOf([[{ points: -3, chance: 0.01 }]])), { '-30': 0.01, 0: 0.99 });
    // A yellow card or a red, not both.
    const card: Jump = [
      { points: -1, chance: 0.2 },
      { points: -3, chance: 0.01 },
    ];
    nearly(cells(dropsOf([card])), { '-30': 0.01, '-10': 0.2, 0: 0.79 });
    // Drops in tenths, as a clean sheet shared by a defender who may not be on is.
    nearly(cells(dropsOf([[{ points: -3.44, chance: 0.5 }]])), { '-34': 0.5, 0: 0.5 });
    nearly(cells(dropsOf([])), { 0: 1 });
  });

  it('add two players’ drops up, each independent of the other', () => {
    const red: Jump = [{ points: -3, chance: 0.1 }];
    const own: Jump = [{ points: -2, chance: 0.2 }];
    nearly(cells(dropsOf([red, own])), { '-50': 0.02, '-30': 0.08, '-20': 0.18, 0: 0.72 });
    nearly(cells(dropsOf([own, red])), cells(dropsOf([red, own])));
    // Two the same: none, one or both.
    nearly(cells(dropsOf([red, red])), { '-60': 0.01, '-30': 0.18, 0: 0.81 });
    close(jumpsMean([red, own]), -0.3 - 0.4, 1e-12);
  });

  it('leave out what can’t matter early in a gameweek, and keep the rest whole', () => {
    // Two full XIs and their benches still to play: 30 players' cards and own goals.
    const all = Array.from({ length: 30 }, () => rareDrops(1, {}, 'yet to play')).flat();
    const g = dropsOf(all);
    close(
      [...g.p].reduce((t, p) => t + p, 0),
      1,
      1e-12,
    );
    assert.ok([...g.p].every((p) => p === 0 || p > 1e-9));
    close(momentsOf(g)[0], jumpsMean(all), 1e-6);
    assert.ok(g.p.length < 300, `${g.p.length}`);
  });

  it('leave the side’s mean and variance as the projection has them', () => {
    const sides: Heading[] = [
      { mean: 47.98, variance: 15.87, floor: 43, jumps: [...rareDrops(1), ...rareDrops(0.75, {}, 'yet to play')] },
      { mean: 9, variance: 12, floor: 8.5, jumps: [...rareDrops(0.4), [{ points: -7, chance: 0.2 }]] },
      { mean: 60, variance: 99, floor: 40, jumps: Array.from({ length: 11 }, () => rareDrops(1, {}, 'yet to play')).flat() },
    ];
    for (const side of sides) {
      const [mean, variance] = momentsOf(finalScore(side));
      close(mean, side.mean, 0.01);
      close(variance, side.variance, 0.02);
      // None of it below where the drops can take the floor.
      const worst = side.floor! + side.jumps!.reduce((t, j) => t + Math.min(...j.map((o) => o.points)), 0);
      assert.ok(finalScore(side).start * 0.1 >= worst - 0.05);
    }
  });

  it('settle exactly once nothing is left but a drop', () => {
    // On 40 with a 1% chance of a red card's 3 off, say, and nothing else.
    const side: Heading = { mean: 40 - 0.03, variance: 0.03 * 0.97 * 9, floor: 40, jumps: [[{ points: -3, chance: 0.01 }]] };
    const p37 = finalChances(side, done(37));
    close(p37[1], 0.01, 1e-12);
    close(p37[0], 0.99, 1e-12);
    const p39 = finalChances(side, done(39));
    close(p39[0], 0.99, 1e-12);
    close(p39[2], 0.01, 1e-12);
    // And with no chance of any, as if there were none.
    assert.deepEqual(finalChances({ ...done(40), jumps: [[{ points: -3, chance: 0 }]] }, done(39)), [1, 0, 0]);
  });

  it('give a side all done next to nothing against one ahead by 4 that only drops can catch', () => {
    // Curt done on 39; Brage on 43, Le Fée on the pitch and Brobbey on Sunderland's bench, with
    // FPL's expected points (see the live projection's tests).
    const brage: Heading = { mean: 45.96, variance: 15.67, floor: 43, jumps: [...rareDrops(1), ...rareDrops(0.75, {}, 'yet to play')] };
    const [win, draw, lose] = finalChances(done(39), brage);
    assert.ok(win < 1e-4 && draw < 1e-4 && lose > 0.9998, `${win} ${draw}`);
    assert.ok(win > 0 && draw > 0); // not impossible: a red card and an own goal
    assert.deepEqual(liveOdds(done(39), brage, 1.05).prices[1], { dec: 5000, frac: '5000/1' });
    // Where the floor at the worst case had the draw at 1 in 150 or so.
    const worstCase = finalChances(done(39), { mean: 45.96, variance: 15.67, floor: 38 });
    assert.ok(worstCase[1] > 0.005 && worstCase[1] > 100 * draw, `${worstCase[1]}`);
  });

  it('change little with plenty still to play', () => {
    const xi = (n: number) => Array.from({ length: n }, () => rareDrops(1, {}, 'yet to play')).flat();
    for (const lead of [0, 4, 10, 20]) {
      const plain = finalChances({ mean: 45 + lead, variance: 99, floor: 25 + lead }, { mean: 45, variance: 99, floor: 25 });
      const dropping = finalChances(
        { mean: 45 + lead, variance: 99, floor: 25 + lead, jumps: xi(11) },
        { mean: 45, variance: 99, floor: 25, jumps: xi(11) },
      );
      plain.forEach((p, i) => close(dropping[i], p, 0.005));
    }
  });

  it('swap with the sides, and are left out without floors', () => {
    const a: Heading = { mean: 44, variance: 8, floor: 41, jumps: rareDrops(0.5) };
    const b: Heading = { mean: 42, variance: 12, floor: 38, jumps: [...rareDrops(1, {}, 'booked'), [{ points: -4, chance: 0.3 }]] };
    const [win, draw, lose] = finalChances(a, b);
    const swapped = finalChances(b, a);
    close(swapped[0], lose, 1e-12);
    close(swapped[1], draw, 1e-12);
    close(swapped[2], win, 1e-12);
    // The normal, from the mean and variance, which have the drops in.
    const { floor: _a, ...normalA } = a;
    const { floor: _b, ...normalB } = b;
    assert.deepEqual(finalChances(normalA, normalB), normal(a, b));
  });
});

describe('the gamma function', () => {
  it('has its logarithm right', () => {
    close(lnGamma(1), 0, 1e-12);
    close(lnGamma(5), Math.log(24), 1e-12);
    close(lnGamma(0.5), Math.log(Math.sqrt(Math.PI)), 1e-12);
    close(lnGamma(0.1), Math.log(9.513507698668732), 1e-12);
    close(lnGamma(101), 363.73937555556347, 1e-9);
  });
  it('has the lower incomplete one right, by its series and its continued fraction', () => {
    for (const x of [0.01, 0.5, 2, 7, 30]) close(lowerGamma(1, x), 1 - Math.exp(-x), 1e-12);
    for (const x of [0.5, 3, 10]) close(lowerGamma(2, x), 1 - Math.exp(-x) * (1 + x), 1e-12);
    close(lowerGamma(0.5, 2), 0.9544997361036416, 1e-10); // erf(√2)
    assert.equal(lowerGamma(3, 0), 0);
    assert.equal(lowerGamma(3, -1), 0);
    close(lowerGamma(50, 500), 1, 1e-12);
  });
});
