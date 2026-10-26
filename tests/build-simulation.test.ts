import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SIM_RUNS, SIM_SKILL_SPREAD } from '../src/build/config.ts';
import type { OddsModel } from '../src/build/odds.ts';
import type { Season } from '../src/build/season.ts';
import { simulate } from '../src/build/simulation.ts';
import type { Match, OverallRow } from '../src/shared/data.ts';
import { build } from './fixtures/build-league.ts';

const sum = (xs: number[]) => xs.reduce((t, x) => t + x, 0);

describe('the season simulation', () => {
  const { simulation, model, tables, matches } = build();

  it('gives every manager a finishing position in every run', () => {
    assert.equal(simulation.runs, SIM_RUNS);
    for (const row of simulation.rows) {
      assert.equal(row.positions.length, 4);
      assert.ok(Math.abs(sum(row.positions) - 1) < 0.001, `${row.id}'s chances add up to ${sum(row.positions)}`);
    }
    for (let place = 0; place < 4; place++) assert.ok(Math.abs(sum(simulation.rows.map((r) => r.positions[place])) - 1) < 0.001);
  });

  it('ranks the managers on their average points at the end', () => {
    assert.deepEqual(
      simulation.rows.map((r) => r.rank),
      [1, 2, 3, 4],
    );
    assert.ok(simulation.rows.every((r, i) => i === 0 || simulation.rows[i - 1].pts >= r.pts));
    // Everyone ends with at least the points he has, and the leaders are likelier to win it.
    for (const row of simulation.rows) assert.ok(row.pts >= tables.overall.find((o) => o.id === row.id)!.pts);
    const leader = simulation.rows.find((r) => r.id === tables.overall[0].id)!;
    const last = simulation.rows.find((r) => r.id === tables.overall[3].id)!;
    assert.ok(leader.positions[0] > last.positions[0]);
  });

  it('shares out three points a match left, less one a draw, on average', () => {
    const left = matches.filter((m) => !m.finished).length;
    const now = sum(tables.overall.map((r) => r.pts));
    const after = sum(simulation.rows.map((r) => r.pts));
    assert.ok(after > now + 2.5 * left && after <= now + 3 * left + 0.2, `${after} from ${now} with ${left} matches left`);
  });

  it('plays the gameweek being played from scratch, and says what its numbers are', () => {
    assert.equal(simulation.gameweeksLeft, 4);
    assert.deepEqual(simulation.model, {
      leagueAverage: Math.round(model.leagueMean * 10) / 10,
      projected: 3,
      weight: [1, 0.9, 0.5],
      levelSpread: SIM_SKILL_SPREAD,
      spread: Math.round(model.sigma * 10) / 10,
      laterSpread: Math.round(model.sigma * 1.1 * 10) / 10,
    });
  });

  it('comes out the same every time, being seeded', () => {
    assert.deepEqual(build().simulation, simulation);
  });
});

describe('the season simulation with made-up odds', () => {
  const season = { scoring: { h2h_win: 3, h2h_draw: 1, h2h_lose: 0 }, nextGw: 9 } as unknown as Season;
  const row = (id: number, pts: number, pf: number) => ({ id, pts, pf }) as OverallRow;
  const model = (expected: Record<number, number>) =>
    ({
      expectedScore: (id: number) => expected[id],
      spreadFor: () => 12,
      leagueMean: 50,
      sigma: 12,
      hasProjections: false,
      projectedGws: [],
    }) as unknown as OddsModel;
  const fixture = (gw: number, home: number, away: number): Match => ({
    gw,
    home,
    away,
    homePts: null,
    awayPts: null,
    started: false,
    finished: false,
  });

  it('is certain once every match is over, splitting a tie on points by points scored', () => {
    const done: Match = { ...fixture(8, 1, 2), homePts: 40, awayPts: 30, started: true, finished: true };
    const sim = simulate(season, [1, 2, 3], [done], [row(1, 9, 400), row(2, 9, 420), row(3, 3, 500)], model({}));
    assert.equal(sim.gameweeksLeft, 0);
    assert.deepEqual(
      sim.rows.map((r) => [r.id, r.pts, r.positions]),
      [
        [1, 9, [0, 1, 0]],
        [2, 9, [1, 0, 0]],
        [3, 3, [0, 0, 1]],
      ],
    );
    assert.equal(sim.model.projected, 0);
  });

  it('nearly always crowns the manager expected to score far more', () => {
    const matches = [fixture(9, 1, 2), fixture(9, 3, 4), fixture(10, 1, 3), fixture(10, 2, 4), fixture(11, 1, 4), fixture(11, 2, 3)];
    const sim = simulate(
      season,
      [1, 2, 3, 4],
      matches,
      [row(1, 0, 0), row(2, 0, 0), row(3, 0, 0), row(4, 0, 0)],
      model({ 1: 90, 2: 50, 3: 50, 4: 50 }),
    );
    assert.equal(sim.gameweeksLeft, 3);
    const first = sim.rows[0];
    assert.equal(first.id, 1);
    assert.ok(first.positions[0] > 0.9);
    assert.ok(first.pts > 8.5 && first.pts <= 9);
    // The other three are alike, so each comes second about a third of the time.
    for (const r of sim.rows.slice(1)) assert.ok(Math.abs(r.positions[1] - 1 / 3) < 0.05);
  });
});
