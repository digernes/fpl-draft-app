import { drawIntoNothing } from './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';

import { setData, setLive, type LiveState } from '../src/app/state.ts';
import {
  bpsIn,
  gwAsScored,
  gwUnderlying,
  matchUnderlying,
  pointsFrom,
  pointsRows,
  statsFor,
  toComeRows,
  withLive,
} from '../src/app/stats-files.ts';
import { PL_STATS, type Data } from '../src/shared/data.ts';
import type { SlimLive } from '../src/shared/live.ts';
import { bobVCy, cells, statsFile } from './fixtures/match.ts';

// GW 2's stats file comes at once and GW 1's isn't there; the others never answer.
before(async () => {
  drawIntoNothing();
  Object.assign(globalThis, {
    fetch: (url: string) =>
      url.startsWith('stats/2.json')
        ? Promise.resolve({ ok: true, json: async () => statsFile() })
        : url.startsWith('stats/1.json')
          ? Promise.resolve({ ok: false, status: 404 })
          : new Promise(() => {}),
  });
  setData(bobVCy());
  statsFor(1);
  statsFor(2);
  await new Promise((resolve) => setImmediate(resolve));
});

// bobVCy() with GW 2 still being played: Gabriel (code 1800) on for Arsenal in a third match,
// 22, with an xG of 0.3, which only the relay has.
function playing(): { d: Data; feed: SlimLive } {
  const d = bobVCy();
  d.meta.currentGw = 2;
  delete d.underlying;
  Object.assign(d.players[18], { code: 1800 });
  Object.assign(d.players[13], { code: 1300 });
  const feed: SlimLive = {
    elements: { 18: [2, 70] },
    fixtures: [],
    matches: { 22: { 18: cells({ expected_goals: 0.3, expected_assists: 0.1, bps: 12 }) } },
    moments: {
      22: [
        [12, 1, 'goal', 1800],
        [60, 2, 'sub', 1300, 1800],
        [61, 2, 'sub', 1800, 4242], // with someone not in the game: left out
        [70, 2, 'yellow', 4242], // not in the game either
      ],
    },
  };
  return { d, feed };
}

beforeEach(() => {
  setData(bobVCy());
  setLive(null);
});

describe('the stats files', () => {
  it('has a gameweek’s file once it’s in, and says when it isn’t there or still to come', () => {
    assert.equal(typeof statsFor(2), 'object');
    assert.equal(statsFor(1), 'missing');
    assert.equal(statsFor(4), 'loading');
  });

  it('takes a player’s points apart by where they came from', () => {
    // Salah: a goal and an assist for Liverpool, and 3 bonus.
    assert.deepEqual(pointsRows(pointsFrom(14, 2)), [
      ['Playing', 2],
      ['Goals', 5],
      ['Assists', 3],
      ['Bonus', 3],
    ]);
    // In one of the gameweek's matches, and nothing without a file.
    assert.deepEqual(pointsFrom(14, 2, 21), { bonus: 0, other: 0 });
    assert.equal(pointsFrom(14, 1), undefined);
  });

  it('gives a player’s BPS in a gameweek or one of its matches, while there are any', () => {
    assert.equal(bpsIn(14, 2), 38);
    assert.equal(bpsIn(14, 2, 20), 38);
    assert.equal(bpsIn(14, 2, 21), undefined);
    assert.equal(bpsIn(19, 2), undefined);
    assert.equal(bpsIn(14, 1), undefined);
  });

  it('lays the relay’s matches over the file while the gameweek is played, its moments by player ids', () => {
    const { d, feed } = playing();
    setData(d);
    setLive({ gw: 2, feed, lineups: {}, points: () => 0, bonus: () => 0 });
    const stats = statsFor(2);
    assert.ok(typeof stats === 'object');
    assert.deepEqual(Object.keys(stats.matches), ['20', '21', '22']);
    assert.deepEqual(stats.moments![22], [
      [12, 1, 'goal', 18],
      [60, 2, 'sub', 13, 18],
    ]);
    assert.deepEqual(stats.moments![20], statsFile().moments![20]); // the file's own kept
    assert.equal(statsFor(2), stats); // worked out once for the same feed and file
    assert.equal(bpsIn(18, 2), 12);
  });

  it('merges the relay’s matches into nothing when there is no file', () => {
    const { feed } = playing();
    const merged = withLive(2, undefined, { ...feed, moments: undefined }, new Map());
    assert.deepEqual(merged, { gw: 2, matches: feed.matches, moments: {} });
  });

  it('works out a player’s underlying numbers while his gameweek is played, from his one match so far', () => {
    const { d, feed } = playing();
    setData(d);
    setLive({ gw: 2, feed, lineups: {}, points: () => 0, bonus: () => 0 });
    const [xg, xa, xp] = gwUnderlying(18, 2)!;
    assert.deepEqual([xg, xa], [0.3, 0.1]);
    assert.ok(xp > 0);
    assert.ok(Array.isArray(gwAsScored(18, 2)));
    // Isak, in the file's match but without minutes in the feed: none.
    assert.equal(gwUnderlying(16, 2), undefined);
    // Once the gameweek is over, data.json's.
    setData(bobVCy());
    assert.deepEqual(gwUnderlying(13, 2), [0.45, 0.1, 5.8]);
  });

  it('has no underlying numbers from a match without his xG', () => {
    const noXg = cells({ goals_scored: 1 }).map((v, i) => (PL_STATS[i] === 'expected_goals' ? null : v));
    assert.equal(matchUnderlying(14, noXg, 90, 7), undefined);
    assert.equal(matchUnderlying(14, undefined, 90, 7), undefined);
  });

  it('lists what a live projection has still to come by where it would come from', () => {
    assert.deepEqual(toComeRows({ minutes: 0.9, goals_scored: 0.62, defensive_contribution: 1.2, bonus: 0.04 }), [
      ['Playing', 0.9],
      ['Goals', 0.62],
      ['Defensive contribution', 1.2],
    ]);
  });
});

// GW 2 being played, Watkins (17) on 5 points after `minutes`.
function watkinsOn(minutes: number) {
  const feed = { elements: { 17: [5, minutes] }, fixtures: [] } as unknown as SlimLive;
  setLive({ gw: 2, feed, lineups: {}, points: () => 5, bonus: () => 0 } as unknown as LiveState);
}

// data.json's line for him from an earlier build: half an hour in.
function builtAt(minutes: number): Data {
  const d = bobVCy();
  const line = d.plMatches!.flatMap((m) => m.lineups ?? []).flatMap((side) => side.filter(([pid]) => pid === 17))[0];
  line[1] = minutes;
  return d;
}

describe('where a player’s points came from, while his gameweek is played', () => {
  beforeEach(() => {
    setData(bobVCy());
    setLive(null);
  });

  it('takes a match apart as FPL scores it: playing, the goal, the card', () => {
    // 75 minutes, a forward's goal and a yellow card.
    assert.deepEqual(
      Object.entries(pointsFrom(17, 2)!).filter(([, n]) => n),
      [
        ['minutes', 2],
        ['goals_scored', 4],
        ['cards', -1],
      ],
    );
  });

  it('takes his minutes from the live feed while the gameweek is played, not from the last build’s lines', () => {
    setData(builtAt(29));
    watkinsOn(82);
    const from = pointsFrom(17, 2)!;
    assert.equal(from.minutes, 2, 'the hour is in');
    assert.equal(from.other, 0, 'nothing left unaccounted for');
  });

  it('keeps to the lines when the gameweek isn’t the one being played', () => {
    setData(builtAt(29));
    assert.equal(pointsFrom(17, 2)!.minutes, 1);
  });
});
