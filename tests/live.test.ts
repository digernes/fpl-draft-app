import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import type { Position } from '../src/shared/data.ts';
import {
  clubState,
  liveProjection,
  provisionalBonus,
  scoreLineup,
  shareToCome,
  slimLive,
  type SlimFixture,
  type SlimLive,
} from '../src/shared/live.ts';

interface Replay {
  players: Record<string, { pos: Position; club: number }>;
  weeks: { gw: number; feed: SlimLive; lineups: { order: number[]; official: number; subs: number[] }[] }[];
}
const replay: Replay = JSON.parse(readFileSync(new URL('fixtures/replay.json', import.meta.url), 'utf8'));

describe('scoreLineup against the real season', () => {
  const info = (id: number) => replay.players[id];
  for (const { gw, feed, lineups } of replay.weeks) {
    it(`reproduces GW${gw}'s official scores and auto-subs`, () => {
      for (const { order, official, subs } of lineups) {
        const scored = scoreLineup(order, feed, info);
        assert.equal(scored.pts, official);
        assert.deepEqual([...scored.subs].sort(), [...subs].sort());
      }
    });
  }
});

describe('provisionalBonus', () => {
  const bonus = (bps: [number, number][]) => Object.fromEntries(provisionalBonus([{ id: 1, h: 1, a: 2, started: true, done: false, bps }]));
  it('gives 3, 2 and 1 to the top three', () => {
    assert.deepEqual(
      bonus([
        [1, 40],
        [2, 30],
        [3, 20],
        [4, 10],
      ]),
      { 1: 3, 2: 2, 3: 1 },
    );
  });
  it('shares a place on a tie and pushes the next one down', () => {
    assert.deepEqual(
      bonus([
        [1, 40],
        [2, 40],
        [3, 20],
        [4, 10],
      ]),
      { 1: 3, 2: 3, 3: 1 },
    );
    assert.deepEqual(
      bonus([
        [1, 40],
        [2, 30],
        [3, 30],
        [4, 10],
      ]),
      { 1: 3, 2: 2, 3: 2 },
    );
    assert.deepEqual(
      bonus([
        [1, 40],
        [2, 30],
        [3, 20],
        [4, 20],
      ]),
      { 1: 3, 2: 2, 3: 1, 4: 1 },
    );
    assert.deepEqual(
      bonus([
        [1, 40],
        [2, 40],
        [3, 40],
        [4, 10],
      ]),
      { 1: 3, 2: 3, 3: 3 },
    );
  });
  it('skips fixtures whose bonus is in', () => {
    assert.equal(provisionalBonus([{ id: 1, h: 1, a: 2, started: true, done: true }]).size, 0);
  });
});

describe('scoreLineup live', () => {
  // Club 1 has finished, club 2 is still to play. Players 1-15: GKP, 4 DEF, 4 MID, 2 FWD, then the bench GKP, DEF, MID, FWD.
  const positions: Position[] = ['GKP', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'FWD', 'FWD', 'GKP', 'DEF', 'MID', 'FWD'];
  const clubs: Record<number, number> = {};
  const info = (id: number) => ({ pos: positions[id - 1], club: clubs[id] ?? 1 });
  const order = positions.map((_, i) => i + 1);
  const fixtures: SlimFixture[] = [
    { id: 1, h: 1, a: 3, started: true, done: true },
    { id: 2, h: 2, a: 4, started: false, done: false },
  ];
  const feedWith = (elements: SlimLive['elements']): SlimLive => ({ elements, fixtures });
  const everyonePlayed = Object.fromEntries(order.map((id) => [id, [2, 90] as [number, number]]));

  it('adds up the starting XI', () => {
    assert.equal(scoreLineup(order, feedWith(everyonePlayed), info).pts, 22);
  });

  it('brings on the first bench player who played and keeps the formation', () => {
    const { [2]: _, ...rest } = everyonePlayed; // a defender didn't play
    const midfielderFirst = [...order.slice(0, 11), 12, 14, 13, 15];
    const scored = scoreLineup(midfielderFirst, feedWith(rest), info, { DEF: 4, MID: 2, FWD: 1 });
    assert.deepEqual(scored.subs, [13]); // the midfielder ahead of him would leave three defenders
    assert.ok(scored.xi.includes(13) && scored.bench.includes(2));
  });

  it('only swaps goalkeeper for goalkeeper', () => {
    const { [1]: _, ...rest } = everyonePlayed;
    assert.deepEqual(scoreLineup(order, feedWith(rest), info).subs, [12]);
  });

  it('waits for a bench player whose match is still to come', () => {
    clubs[13] = 2;
    const { [2]: _a, [13]: _b, ...rest } = everyonePlayed;
    const scored = scoreLineup(order, feedWith(rest), info);
    assert.deepEqual(scored.subs, []);
    delete clubs[13];
  });

  it('does not sub a starter whose match is still to come', () => {
    clubs[2] = 2;
    const { [2]: _, ...rest } = everyonePlayed;
    assert.deepEqual(scoreLineup(order, feedWith(rest), info).subs, []);
    delete clubs[2];
  });

  it('adds provisional bonus', () => {
    const live: SlimLive = {
      elements: everyonePlayed,
      fixtures: [
        {
          id: 3,
          h: 1,
          a: 3,
          started: true,
          done: false,
          bps: [
            [10, 50],
            [11, 40],
            [3, 30],
          ],
        },
      ],
    };
    assert.equal(scoreLineup(order, live, info).pts, 22 + 3 + 2 + 1);
  });
});

describe('slimLive', () => {
  it('keeps points and minutes, and the BPS only while the bonus is out', () => {
    const fixture = {
      id: 9,
      team_h: 1,
      team_a: 2,
      finished: false,
      finished_provisional: false,
      team_h_score: 1,
      team_a_score: 0,
      minutes: 55,
    };
    const stat = (s: string, h: [number, number][]) => ({ s, h: h.map(([element, value]) => ({ element, value })), a: [] });
    const slim = slimLive({
      elements: {
        5: { stats: { total_points: 6, minutes: 90, goals_scored: 1, assists: 0, clean_sheets: 0, goals_conceded: 0 } },
        6: { stats: { total_points: 0, minutes: 0, goals_scored: 0, assists: 0, clean_sheets: 0, goals_conceded: 0 } },
      },
      fixtures: [
        { ...fixture, started: true, stats: [stat('bonus', []), stat('bps', [[5, 30]])] },
        { ...fixture, id: 10, started: true, stats: [stat('bonus', [[5, 3]]), stat('bps', [[5, 30]])] },
      ],
    });
    assert.deepEqual(slim.elements, { 5: [6, 90] });
    assert.deepEqual(slim.events, { 5: { goals: 1 } }); // no starts or per-match minutes: no substitutions
    assert.deepEqual(slim.fixtures[0], { id: 9, h: 1, a: 2, started: true, done: false, min: 55, bps: [[5, 30]] });
    assert.equal(slim.fixtures[1].bps, undefined);
  });

  it('says what each player did, with substitutions from the minutes in each match', () => {
    const stats = { total_points: 2, minutes: 90, goals_scored: 0, assists: 0, clean_sheets: 0, goals_conceded: 0, starts: 1 };
    const minutes = (...matches: [number, number][]) =>
      matches.map(([fixture, value]): [{ stat: string; value: number }[], number] => [[{ stat: 'minutes', value }], fixture]);
    const fixture = (id: number, over: boolean) => ({
      id,
      team_h: 1,
      team_a: 2,
      started: true,
      finished: over,
      finished_provisional: over,
      team_h_score: 0,
      team_a_score: 0,
      minutes: over ? 90 : 60,
    });
    const slim = slimLive({
      elements: {
        1: { stats: { ...stats, goals_scored: 2, bonus: 3 }, explain: minutes([9, 90]) },
        2: { stats: { ...stats, minutes: 63, assists: 1, yellow_cards: 1 }, explain: minutes([9, 63]) },
        3: { stats: { ...stats, minutes: 27, starts: 0 }, explain: minutes([9, 27]) },
        4: { stats: { ...stats, minutes: 40, red_cards: 1 }, explain: minutes([9, 40]) }, // sent off, not taken off
        5: { stats: { ...stats, minutes: 55 }, explain: minutes([10, 55]) }, // his match is still on
        6: { stats: { ...stats, minutes: 0, starts: 0 }, explain: minutes([9, 0]) },
        7: { stats: { ...stats, minutes: 120 }, explain: minutes([9, 90], [11, 30]) }, // started one match, came on in the other
      },
      fixtures: [fixture(9, true), fixture(10, false), fixture(11, true)],
    });
    assert.deepEqual(slim.events, {
      1: { goals: 2, bonus: 3 },
      2: { assists: 1, yellow: 1, off: 1, min: 63 },
      3: { on: 1, min: 27 },
      4: { red: 1 },
      7: { on: 1, min: 120 },
    });
  });
});

describe('who is still to play', () => {
  const feed: SlimLive = {
    elements: {},
    fixtures: [
      { id: 1, h: 1, a: 2, started: true, done: true },
      { id: 2, h: 3, a: 4, started: true, done: false, min: 60 },
      { id: 3, h: 5, a: 6, started: false, done: false, ko: '2026-10-25T14:00:00Z' },
      // club 7 plays twice: once done, once to come
      { id: 4, h: 7, a: 8, started: true, done: true },
      { id: 5, h: 9, a: 7, started: false, done: false, ko: '2026-10-27T19:30:00Z' },
    ],
  };
  it('tells live, done, due and blank apart', () => {
    assert.deepEqual(clubState(feed, 1), { state: 'done' });
    assert.deepEqual(clubState(feed, 4), { state: 'live', min: 60 });
    assert.deepEqual(clubState(feed, 6), { state: 'due', ko: '2026-10-25T14:00:00Z' });
    assert.deepEqual(clubState(feed, 7), { state: 'due', ko: '2026-10-27T19:30:00Z' });
    assert.deepEqual(clubState(feed, 10), { state: 'blank' });
  });
  it('counts how much of the gameweek is left', () => {
    assert.equal(shareToCome(feed, 1), 0);
    assert.ok(Math.abs(shareToCome(feed, 3) - 1 / 3) < 1e-12);
    assert.equal(shareToCome(feed, 5), 1);
    assert.equal(shareToCome(feed, 7), 0.5);
    assert.equal(shareToCome(feed, 10), 0);
  });
  it('projects the final score from what is left', () => {
    const info = (id: number) => ({ pos: 'MID' as const, club: id });
    const scored = { xi: [1, 3, 5], bench: [], subs: [], pts: 20, points: () => 0 };
    const { mean, variance } = liveProjection(scored, feed, info, () => 6);
    assert.ok(Math.abs(mean - (20 + 6 / 3 + 6)) < 1e-9);
    assert.ok(Math.abs(variance - (1 / 3 + 1) * 9) < 1e-9);
  });
});
