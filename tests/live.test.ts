import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { buildLiveData } from '../src/build/lineups.ts';
import type { Season } from '../src/build/season.ts';
import type { Data, Position, XpParts } from '../src/shared/data.ts';
import {
  liveProjection,
  provisionalBonus,
  scoreLineup,
  playerState,
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
    assert.deepEqual(scored.off, [2]);
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
    assert.deepEqual(slim.fixtures[0], { id: 9, h: 1, a: 2, started: true, done: false, min: 55, score: [1, 0], bps: [[5, 30]] });
    assert.equal(slim.fixtures[1].bps, undefined);
  });

  it('takes the minute from the players, since FPL leaves the match’s at 0 while it is on', () => {
    const slim = slimLive({
      elements: {
        5: {
          stats: { total_points: 1, minutes: 23, goals_scored: 0, assists: 0, clean_sheets: 0, goals_conceded: 0 },
          explain: [[[{ stat: 'minutes', value: 23 }], 9]],
        },
      },
      fixtures: [
        {
          id: 9,
          team_h: 1,
          team_a: 2,
          started: true,
          finished: false,
          finished_provisional: false,
          team_h_score: 0,
          team_a_score: 0,
          minutes: 0,
        },
      ],
    });
    assert.equal(slim.fixtures[0].min, 23);
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
      3: { on: 1, onAt: 63, min: 27 },
      4: { red: 1 },
      7: { on: 1, onAt: 60, min: 120 },
    });
  });

  it('sees a starter go off while his match is on, from the minutes of those still on', () => {
    const stats = { total_points: 2, minutes: 61, goals_scored: 0, assists: 0, clean_sheets: 0, goals_conceded: 0, starts: 1 };
    const minutes = (value: number): [{ stat: string; value: number }[], number][] => [[[{ stat: 'minutes', value }], 10]];
    const slim = slimLive({
      elements: {
        11: { stats, explain: minutes(61) }, // still on
        12: { stats: { ...stats, minutes: 52 }, explain: minutes(52) }, // taken off
        13: { stats: { ...stats, minutes: 9, starts: 0 }, explain: minutes(9) }, // came on for him
        14: { stats: { ...stats, minutes: 40, red_cards: 1 }, explain: minutes(40) }, // sent off
      },
      fixtures: [
        {
          id: 10,
          team_h: 1,
          team_a: 2,
          started: true,
          finished: false,
          finished_provisional: false,
          team_h_score: 0,
          team_a_score: 0,
          minutes: 0,
        },
      ],
    });
    assert.deepEqual(slim.fixtures[0].off, [
      [12, 52],
      [14, 40],
    ]);
    assert.deepEqual(slim.events, { 12: { off: 1, min: 52 }, 13: { on: 1, onAt: 52, min: 9 }, 14: { red: 1 } });
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
    assert.deepEqual(playerState(feed, 99, 1), { state: 'done' });
    assert.deepEqual(playerState(feed, 99, 4), { state: 'live', min: 60 });
    assert.deepEqual(playerState(feed, 99, 6), { state: 'due', ko: '2026-10-25T14:00:00Z', opp: 5, home: false });
    assert.deepEqual(playerState(feed, 99, 7), { state: 'due', ko: '2026-10-27T19:30:00Z', opp: 9, home: false });
    assert.deepEqual(playerState(feed, 99, 10), { state: 'blank' });
  });
  it('counts how much of the gameweek is left', () => {
    assert.equal(shareToCome(feed, 99, 1), 0);
    assert.ok(Math.abs(shareToCome(feed, 99, 3) - 1 / 3) < 1e-12);
    assert.equal(shareToCome(feed, 99, 5), 1);
    assert.equal(shareToCome(feed, 99, 7), 0.5);
    assert.equal(shareToCome(feed, 99, 10), 0);
  });
  it('has nothing more to come from a player taken off', () => {
    const on: SlimLive = { ...feed, fixtures: feed.fixtures.map((f) => (f.id === 2 ? { ...f, off: [[42, 59]] } : f)) };
    assert.deepEqual(playerState(on, 42, 3), { state: 'off', min: 59 });
    assert.deepEqual(playerState(on, 43, 3), { state: 'live', min: 60 });
    assert.equal(shareToCome(on, 42, 3), 0);
    const scored = { xi: [42], bench: [], subs: [], off: [], pts: 3, points: () => 3 };
    assert.equal(liveProjection(scored, on, () => ({ pos: 'MID' as const, club: 3 }), { points: () => 6 }).mean, 3);
  });
  // The share of a match's goals still to come with half an hour left: they come more
  // often late on, so it's 7/18 rather than a third.
  const lastHalfHour = 7 / 18;

  it('projects the final score from what is left', () => {
    // 3 is on the pitch an hour into his match and 5 is still to kick off; 1's match is
    // over without him, with nobody on the bench to come on.
    const on: SlimLive = { ...feed, elements: { 3: [2, 60] } };
    const info = (id: number) => ({ pos: 'MID' as const, club: id });
    const scored = { xi: [1, 3, 5], bench: [], subs: [], off: [], pts: 20, points: () => 0 };
    // FPL's expected points come whole: a share of them for what's left of his match.
    const { mean, variance } = liveProjection(scored, on, info, { points: () => 6 });
    assert.ok(Math.abs(mean - (20 + 6 * lastHalfHour + 6)) < 1e-9);
    assert.ok(Math.abs(variance - (lastHalfHour + 1) * 9) < 1e-9);
  });

  it('works out appearance points, clean sheets and bonus from where the match stands', () => {
    // A defender 60 minutes into a goalless match with 9 points (2 for playing, 4 for the
    // clean sheet FPL shows from 60 minutes and 3 provisional bonus). He's expected to
    // play 81 minutes (and play at all 95% of the time) for 4.9 points: 1.9 for playing,
    // 1.6 for a clean sheet, 0.6 bonus and 0.8 from the rest.
    const live: SlimLive = {
      elements: { 9: [6, 60] },
      fixtures: [{ id: 1, h: 9, a: 10, started: true, done: false, min: 60, score: [0, 0], bps: [[9, 30]] }],
    };
    const info = () => ({ pos: 'DEF' as const, club: 9 });
    const parts: XpParts = [81, 1.9, 0.4, 0, 0.3, 1.6, -0.4, 0.6, 0, 0.6, -0.1];
    const expected = { points: () => 4.9, parts: () => parts, cleanSheet: { DEF: 4 } };
    const scored = { xi: [9], bench: [], subs: [], off: [], pts: 9, points: () => 9 };
    const onFor = 90 * lastHalfHour * (81 / 0.95 / 90); // the time he's likely to stay on, weighted by when goals come
    const keepsIt = (1.6 / 4 / 0.95) ** (onFor / 90);
    // Nothing more for playing; the rest at his rate a minute; the clean sheet kept with
    // that chance instead of counted on top of the 4 in; the bonus a third of the way back
    // from 3 to his 0.6 / 0.95.
    const rest = (0.8 / 81) * onFor + 4 * (keepsIt - 1) + (0.6 / 0.95 - 3) / 3;
    assert.ok(Math.abs(liveProjection(scored, live, info, expected).mean - (9 + rest)) < 1e-9);
    // Once a goal goes in, the clean sheet is gone from the points and from the projection.
    const behind = { ...live, fixtures: [{ ...live.fixtures[0], score: [0, 1] as [number, number] }] };
    const after = (0.8 / 81) * onFor + (0.6 / 0.95 - 3) / 3;
    assert.ok(Math.abs(liveProjection({ ...scored, pts: 5 }, behind, info, expected).mean - (5 + after)) < 1e-9);
  });

  it('counts the bench player who will come on for a starter who won’t play', () => {
    const info = (id: number) => ({ pos: (id === 9 ? 'GKP' : 'MID') as Position, club: id, status: id === 6 ? 'i' : 'a' });
    // 1's match is over without him and 6 is injured; 9 is the bench goalkeeper, so 5 (still
    // to play) and 3 (on the pitch an hour in) come on.
    const on: SlimLive = { ...feed, elements: { 3: [0, 60] } };
    const scored = { xi: [1, 6], bench: [9, 5, 3], subs: [], off: [], pts: 10, points: () => 0 };
    const { mean } = liveProjection(scored, on, info, { points: () => 6 }, { DEF: 0, MID: 0, FWD: 0 });
    assert.ok(Math.abs(mean - (10 + 6 + 6 * lastHalfHour)) < 1e-9);
  });

  it('counts the bench player by the chance a starter doesn’t come on', () => {
    // Club 5 has named 5 among its substitutes and club 6 has named 8 to start; 4 has no
    // minutes an hour into his match. A substitute comes on two times in three for 1.3
    // points; the bench player next in line comes on for him the other time.
    const info = (id: number) => ({ pos: 'MID' as const, club: id === 8 ? 6 : id === 4 ? 3 : id });
    const named = (id: number) => (id === 5 ? 'bench' : id === 8 ? 'xi' : undefined);
    const expected = { points: () => 6, named };
    const free = { DEF: 0, MID: 0, FWD: 0 };
    const sub = 0.65 * 1.3;
    const before = liveProjection({ xi: [5], bench: [8], subs: [], off: [], pts: 0, points: () => 0 }, feed, info, expected, free);
    assert.ok(Math.abs(before.mean - (sub + 0.35 * 6)) < 1e-9);
    const during = liveProjection({ xi: [4], bench: [8], subs: [], off: [], pts: 0, points: () => 0 }, feed, info, expected, free);
    assert.ok(Math.abs(during.mean - (sub + 0.35 * 6)) < 1e-9);
    // Left out of his club's squad, he won't play: the bench player counts in full.
    const out = liveProjection(
      { xi: [5], bench: [8], subs: [], off: [], pts: 0, points: () => 0 },
      feed,
      info,
      { ...expected, named: (id: number) => (id === 5 ? 'out' : 'xi') },
      free,
    );
    assert.ok(Math.abs(out.mean - 6) < 1e-9);
  });

  it('keeps a double gameweek’s first clean sheet', () => {
    // Club 7's first match is over, with a clean sheet in his 6 points; half his gameweek's
    // expected points are still to come in the second.
    const on: SlimLive = { ...feed, elements: { 70: [6, 90] } };
    const info = () => ({ pos: 'DEF' as const, club: 7 });
    const parts: XpParts = [170, 3.8, 0.4, 0, 0.4, 2.4, -0.6, 0.8, 0, 0.8, -0.2];
    const expected = { points: () => 7.8, parts: () => parts, cleanSheet: { DEF: 4 } };
    const { mean } = liveProjection({ xi: [70], bench: [], subs: [], off: [], pts: 6, points: () => 6 }, on, info, expected);
    assert.ok(Math.abs(mean - (6 + 7.8 / 2)) < 1e-9);
  });
});

describe('buildLiveData', () => {
  const season = {
    currentGw: 8,
    finishedGws: [7],
    live: { 8: { elements: {}, fixtures: [] } },
    boot: { settings: { scoring: { clean_sheets_DEF: 4 } } },
  } as unknown as Season;
  const lineups = { 1: { 8: { picks: [5, 6, 7] } } } as unknown as Parameters<typeof buildLiveData>[1];
  const fplNow = () => 2; // FPL's, after the deadline has cut everyone's form
  const fromFpl = (previous: Partial<Data> | null) => buildLiveData(season, lineups, { now: fplNow, fromFpl: true, fplNow }, previous);
  const fromModel = (previous: Partial<Data> | null) =>
    buildLiveData(
      season,
      lineups,
      { now: () => 4, fromFpl: false, fplNow, parts: () => [80.123, 1.9, 0.6, 0.4, 0.3, 1.2, -0.3, 0.2, 0, 0.2, -0.1] },
      previous,
    );

  it('keeps FPL’s expected points from the last build before the deadline', () => {
    const before = { meta: { nextGw: 8 }, players: { 5: { ep: 6, fpl: 5 }, 6: { ep: 4.5, fpl: 3 } } } as unknown as Partial<Data>;
    assert.deepEqual(fromFpl(before)?.ep, { 5: 6, 6: 4.5, 7: 2 }); // FPL's standing in
    const model = fromModel(before);
    assert.deepEqual(model?.ep, { 5: 4, 6: 4, 7: 4 }); // the site's own, which don't drop
    assert.deepEqual(model?.fplEp, { 5: 5, 6: 3, 7: 2 });
    assert.deepEqual(model?.parts?.[5], [80.12, 1.9, 0.6, 0.4, 0.3, 1.2, -0.3, 0.2, 0, 0.2, -0.1]);
    assert.equal(model?.cleanSheet?.DEF, 4);
  });

  it('keeps them through the gameweek', () => {
    const since = {
      meta: { nextGw: 9 },
      live: { gw: 8, ep: { 5: 6, 6: 4.5, 7: 3 }, fplEp: { 5: 5, 6: 3, 7: 1 } },
      players: { 5: { ep: 1, fpl: 1 } },
    } as unknown as Partial<Data>;
    assert.deepEqual(fromFpl(since)?.ep, { 5: 6, 6: 4.5, 7: 3 });
    assert.deepEqual(fromModel(since)?.fplEp, { 5: 5, 6: 3, 7: 1 });
  });

  it('falls back to FPL’s own without either', () => {
    assert.deepEqual(fromFpl(null)?.ep, { 5: 2, 6: 2, 7: 2 });
  });
});
