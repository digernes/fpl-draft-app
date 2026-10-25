import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MIN_SCORE_SPREAD, ODDS_OVERROUND } from '../src/build/config.ts';
import { oddsModel, priceMatches } from '../src/build/odds.ts';
import { readSeason } from '../src/build/season.ts';
import type { Data, Match, Position } from '../src/shared/data.ts';
import { build, fetched, MANAGERS, typeOf } from './fixtures/build-league.ts';

const close = (a: number, b: number, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${a} is not ${b}`);
const mean = (xs: number[]) => xs.reduce((t, x) => t + x, 0) / xs.length;
const POS: (Position | undefined)[] = [undefined, 'GKP', 'DEF', 'MID', 'FWD'];

describe('the odds model', () => {
  const { season, model, tables } = build();
  const scores = Object.values(tables.scoresByGw).flatMap((s) => s.map((x) => x.pts));

  it('uses the site’s own expected points once a gameweek has been played', () => {
    assert.equal(model.fromFpl, false);
    assert.ok(model.parts && model.partsNow);
    assert.ok(model.expected(13) > 0);
    assert.equal(model.parts(13)?.length, 11);
    assert.equal(model.fplExpected(13), 2); // FPL's own, its ep_next, kept beside the site's
    assert.equal(model.fplNow(13), 3);
  });

  it('projects every gameweek left whose fixtures are out, and prices the next three', () => {
    assert.deepEqual(model.projectedGws, [4, 5, 6]);
    assert.deepEqual(model.priced, [4, 5, 6]);
    assert.equal(model.ahead.length, 2); // the two after the next, for the page
    assert.deepEqual(
      model.upcoming.map((u) => u.gw),
      [4, 5, 6],
    );
    assert.equal(model.upcoming[0].points(13), model.expected(13));
  });

  it('picks each manager’s best legal XI from today’s squad', () => {
    for (const gw of model.projectedGws)
      for (const id of MANAGERS) {
        const { ids, pts } = model.projections[gw][id];
        assert.equal(ids.length, 11);
        assert.ok(ids.every((pid) => season.ownerNow.get(pid) === id));
        const count = (pos: Position) => ids.filter((pid) => POS[typeOf(pid)] === pos).length;
        assert.equal(count('GKP'), 1);
        assert.ok(count('DEF') >= 3 && count('MID') >= 2 && count('FWD') >= 1);
        assert.ok(pts > 0);
      }
    // The injured don't make it into the next gameweek's XI.
    assert.ok(!model.projections[4][102].ids.includes(20));
  });

  it('spreads scores around the league’s average', () => {
    close(model.leagueMean, mean(scores));
    assert.ok(model.sigma >= MIN_SCORE_SPREAD);
    assert.equal(model.spreadFor(4), model.sigma);
    close(model.spreadFor(5), model.sigma * 1.1);
    assert.equal(model.hasProjections, true);
  });

  it('puts the managers’ expected scores, on average, at the league’s average, in every gameweek', () => {
    for (const gw of [3, 4, 5, 6]) close(mean(MANAGERS.map((id) => model.expectedScore(id, gw))), model.leagueMean);
    // The one being played gets each side's average over the gameweeks projected.
    close(model.expectedScore(101, 3), mean([4, 5, 6].map((gw) => model.expectedScore(101, gw))));
  });

  it('works out what it would have said before a gameweek played before odds were kept', () => {
    // Before the first there is nothing to go on but the average.
    const first = model.before(1);
    assert.equal(first(101), model.leagueMean);
    assert.equal(first(102), model.leagueMean);
    // Before the second, the first gameweek's scores and the model on it.
    const second = model.before(2);
    close(mean(MANAGERS.map((id) => second(id))), mean(tables.scoresByGw[1].map((s) => s.pts)));
    assert.notEqual(second(101), second(102));
  });
});

describe('the odds model before a gameweek has been played', () => {
  it('stands in FPL’s expected points for the site’s', () => {
    const season = readSeason(fetched({ preseason: true }));
    const model = oddsModel(season, MANAGERS, {});
    assert.equal(model.fromFpl, true);
    assert.equal(model.parts, undefined);
    assert.equal(model.expected(13), 2); // its ep_next
    assert.equal(model.expectedNow(13), 3); // its ep_this
    assert.deepEqual(model.ahead, []);
    assert.deepEqual(model.upcoming, []);
    assert.equal(model.leagueMean, 50); // no scores yet
    assert.equal(model.sigma, MIN_SCORE_SPREAD);
    assert.equal(model.hasProjections, true);
    assert.deepEqual(model.projectedGws, [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(model.priced, [1, 2, 3]);
  });

  it('falls back on form times the chance of playing without the main game’s bootstrap, and prices everyone level', () => {
    const season = readSeason(fetched({ preseason: true, noFplBoot: true }));
    const model = oddsModel(season, MANAGERS, {});
    assert.equal(model.expected(1), 1.5); // form 1.5, no doubt
    assert.equal(model.expected(21), 0.375); // form 0.5, 75%
    assert.equal(model.expected(20), 0); // injured
    assert.equal(model.expected(999), 0); // nobody
    assert.equal(model.fplNow(21), 0.375);
    assert.equal(model.hasProjections, false);
    assert.equal(model.expectedScore(101, 4), 50);
  });
});

describe('pricing the matches', () => {
  it('prices the next three gameweeks’ matches, with the projected XIs, the probabilities adding up to one', () => {
    const { matches } = build();
    const upcoming = matches.filter((m) => !m.started);
    assert.equal(upcoming.length, 6);
    for (const m of upcoming) {
      const odds = m.odds!;
      close(odds.p[0] + odds.p[1] + odds.p[2], 1, 0.002);
      assert.equal(odds.xi?.length, 2);
      assert.equal(odds.afterwards, undefined);
      // The overround: the prices' implied chances add up to a little over one, rounded down onto the ladder.
      const book = odds.prices.reduce((t, p) => t + 1 / p.dec, 0);
      assert.ok(book > 1 && book < ODDS_OVERROUND + 0.05, `book of ${book}`);
      // The favourite has the shorter price.
      if (odds.p[0] > odds.p[2]) assert.ok(odds.prices[0].dec <= odds.prices[2].dec);
      assert.equal(Math.sign(odds.expected[0] - odds.expected[1]), Math.sign(odds.p[0] - odds.p[2]));
    }
  });

  it('gives a match that started before odds were kept what the model would have said then', () => {
    const { matches, model } = build();
    const started = matches.filter((m) => m.started);
    assert.ok(started.every((m) => m.odds?.afterwards === true && !m.odds.xi));
    const [first] = started;
    assert.deepEqual(first.odds?.expected, [Math.round(model.leagueMean * 10) / 10, Math.round(model.leagueMean * 10) / 10]);
  });

  it('keeps the odds the last build gave a match before it started, without its XIs', () => {
    const kept = { p: [0.6, 0.02, 0.38], prices: [], expected: [55, 50], xi: [[1], [2]] };
    const previous = { matches: [{ gw: 3, home: 101, away: 104, odds: kept }] } as unknown as Partial<Data>;
    const { matches } = build({}, previous);
    const m = matches.find((x) => x.gw === 3 && x.home === 101)!;
    assert.deepEqual(m.odds, { p: [0.6, 0.02, 0.38], prices: [], expected: [55, 50] });
    assert.equal(matches.find((x) => x.gw === 3 && x.home === 102)?.odds?.afterwards, true);
  });

  it('leaves the matches before the next gameweek and after the three priced alone', () => {
    const { season, model } = build();
    const later: Match = { gw: 7, home: 101, away: 102, homePts: null, awayPts: null, started: false, finished: false };
    const earlier: Match = { ...later, gw: 3 };
    priceMatches([later, earlier], model, season.nextGw, null);
    assert.equal(later.odds, undefined);
    assert.equal(earlier.odds, undefined);
  });
});
