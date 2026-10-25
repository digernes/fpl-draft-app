import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { buildLiveData } from '../src/build/lineups.ts';
import type { Season } from '../src/build/season.ts';
import { PL_STATS, type Data, type Position, type XpParts } from '../src/shared/data.ts';
import { liveProjection, playerProjection, type Expected } from '../src/shared/live-projection.ts';
import { provisionalBonus, scoreLineup, playerState, shareToCome, slimLive, type SlimFixture, type SlimLive } from '../src/shared/live.ts';

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

  it('subs a starter left out of the squad for his match still to come', () => {
    clubs[2] = 2;
    const { [2]: _, ...rest } = everyonePlayed;
    const named = (id: number) => (id === 2 ? 'out' : 'xi');
    const scored = scoreLineup(order, feedWith(rest), info, undefined, named);
    assert.deepEqual([scored.subs, scored.off], [[13], [2]]);
    assert.equal(scored.pts, 22);
    // On the bench he might still come on, so the substitution waits for full time.
    assert.deepEqual(scoreLineup(order, feedWith(rest), info, undefined, (id) => (id === 2 ? 'bench' : 'xi')).subs, []);
    delete clubs[2];
  });

  it('passes over a bench player left out of the squad, rather than wait for him', () => {
    clubs[13] = 2;
    const { [2]: _a, [13]: _b, ...rest } = everyonePlayed;
    const scored = scoreLineup(order, feedWith(rest), info, undefined, (id) => (id === 13 ? 'out' : 'xi'));
    assert.deepEqual(scored.subs, [14]);
    delete clubs[13];
  });

  it('subs a double gameweek starter only once he is out of both matches', () => {
    clubs[2] = 2;
    const { [2]: _, ...rest } = everyonePlayed;
    const twice: SlimLive = { elements: rest, fixtures: [...fixtures, { id: 3, h: 5, a: 2, started: true, done: true }] };
    assert.deepEqual(scoreLineup(order, twice, info, undefined, () => undefined).subs, []); // fixture 2's teams aren't out
    assert.deepEqual(scoreLineup(order, twice, info, undefined, (id, f) => (id === 2 && f === 2 ? 'out' : undefined)).subs, [13]);
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

  it('has one sent off off the pitch at once, a substitute too, before his minutes fall behind', () => {
    const stats = {
      total_points: -1,
      minutes: 61,
      goals_scored: 0,
      assists: 0,
      clean_sheets: 0,
      goals_conceded: 0,
      starts: 1,
      red_cards: 1,
    };
    const sentOff = (value: number): [{ stat: string; value: number }[], number][] => [
      [
        [
          { stat: 'minutes', value },
          { stat: 'red_cards', value: 1 },
        ],
        10,
      ],
    ];
    const slim = slimLive({
      elements: {
        11: { stats: { ...stats, red_cards: 0, total_points: 2 }, explain: [[[{ stat: 'minutes', value: 61 }], 10]] }, // still on
        12: { stats, explain: sentOff(61) }, // a starter, sent off this minute
        13: { stats: { ...stats, minutes: 9, starts: 0 }, explain: sentOff(9) }, // a substitute, sent off
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
      [12, 61],
      [13, 9],
    ]);
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
    assert.deepEqual(playerState(feed, 99, 4), { state: 'live', min: 60, on: false });
    assert.deepEqual(playerState({ ...feed, elements: { 99: [2, 60] } }, 99, 4), { state: 'live', min: 60, on: true });
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
    assert.deepEqual(playerState(on, 43, 3), { state: 'live', min: 60, on: false });
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

  // A defender expected to play 81 minutes (and to play at all 95% of the time) for 4.9
  // points: 1.9 for playing, 1.6 for a clean sheet, 0.6 bonus and 0.8 from the rest.
  const defender: XpParts = [81, 1.9, 0.4, 0, 0.3, 1.6, -0.4, 0.6, 0, 0.6, -0.1];
  const asExpected = { points: () => 4.9, parts: () => defender, cleanSheet: { DEF: 4 } };
  const alone = (pts: number) => ({ xi: [9], bench: [], subs: [], off: [], pts, points: () => pts });

  it('works out appearance points, clean sheets and bonus from where the match stands', () => {
    // 60 minutes into a goalless match with 9 points: 2 for playing, 4 for the clean sheet
    // FPL shows from 60 minutes and 3 provisional bonus, with nobody else in the BPS race.
    const live: SlimLive = {
      elements: { 9: [6, 60] },
      fixtures: [{ id: 1, h: 9, a: 10, started: true, done: false, min: 60, score: [0, 0], bps: [[9, 30]] }],
    };
    const info = () => ({ pos: 'DEF' as const, club: 9 });
    const onFor = 90 * lastHalfHour * (81 / 0.95 / 90); // the time he's likely to stay on, weighted by when goals come
    const keepsIt = (1.6 / 4 / 0.95) ** lastHalfHour;
    // Nothing more for playing; the rest at his rate a minute; the clean sheet kept with
    // that chance instead of counted on top of the 4 in; the 3 bonus his, and for the time
    // left a nudge towards his usual 0.6 / 0.95 from a fair share of a match's 6.
    const rest = (0.8 / 81) * onFor + 4 * (keepsIt - 1) + lastHalfHour * (0.6 / 0.95 - 6 / 22);
    assert.ok(Math.abs(liveProjection(alone(9), live, info, asExpected).mean - (9 + rest)) < 1e-9);
    // Once a goal goes in, the clean sheet is gone from the points and from the projection.
    const behind = { ...live, fixtures: [{ ...live.fixtures[0], score: [0, 1] as [number, number] }] };
    const after = (0.8 / 81) * onFor + lastHalfHour * (0.6 / 0.95 - 6 / 22);
    assert.ok(Math.abs(liveProjection(alone(5), behind, info, asExpected).mean - (5 + after)) < 1e-9);
  });

  it('starts at kick-off where his expected points left him, and doesn’t jump at 60 minutes', () => {
    const info = () => ({ pos: 'DEF' as const, club: 9 });
    const expected = { ...asExpected, named: () => 'xi' as const };
    const at = (min: number, played: number, pts: number, started = true) =>
      liveProjection(
        alone(pts),
        {
          elements: played ? { 9: [pts, played] } : {},
          fixtures: [{ id: 1, h: 9, a: 10, started, done: false, min, score: [0, 0] }],
        },
        info,
        expected,
      ).mean;
    const before = at(0, 0, 0, false);
    assert.ok(Math.abs(before - 4.9 / 0.95) < 1e-9); // named to start: his expected points if he plays
    assert.ok(Math.abs(at(1, 0, 0) - before) < 0.05); // before the feed has his minutes
    assert.ok(Math.abs(at(2, 1, 1) - before) < 0.05);
    assert.ok(Math.abs(at(60, 60, 6) - at(59, 59, 1)) < 0.05); // FPL's hour and clean sheet in his points
  });

  it('projects one player as it does a lineup of him alone', () => {
    const live: SlimLive = {
      elements: { 9: [6, 60] },
      fixtures: [
        {
          id: 1,
          h: 9,
          a: 10,
          started: true,
          done: false,
          min: 60,
          score: [0, 0],
          bps: [
            [9, 30],
            [5, 28],
          ],
        },
      ],
    };
    const info = () => ({ pos: 'DEF' as const, club: 9 });
    const pts = 6 + 3; // and his 3 provisional bonus
    assert.ok(Math.abs(playerProjection(9, live, info, asExpected) - liveProjection(alone(pts), live, info, asExpected).mean) < 1e-9);
  });

  it('takes the bonus from the BPS race, a narrow lead less safe than a wide one', () => {
    // 70 minutes in: 9 leads the BPS, by 2 or by 20, and has 3 bonus as it stands.
    const info = (id: number) => ({ pos: 'DEF' as const, club: id === 9 ? 9 : 10 });
    const match = (bps: [number, number][], off?: [number, number][]): SlimLive => ({
      elements: { 9: [9, 70] },
      fixtures: [{ id: 1, h: 9, a: 10, started: true, done: false, min: 70, score: [1, 1], bps, ...(off ? { off } : {}) }],
    });
    const race = (lead: number) =>
      [
        [9, 28 + lead],
        [5, 28],
        [6, 27],
        [7, 26],
      ] as [number, number][];
    const [narrow, wide] = [2, 20].map((lead) => liveProjection(alone(9), match(race(lead)), info, asExpected).mean);
    assert.ok(wide - narrow > 0.5);
    // Once FPL has put its live bonus in the points, the relay's stats for the match run the same race.
    const cells = (bps: number, bonus: number) => PL_STATS.map((s) => (s === 'bps' ? bps : s === 'bonus' ? bonus : 0));
    const fromStats: SlimLive = {
      ...match([]),
      fixtures: [{ ...match([]).fixtures[0], bps: undefined }],
      matches: { 1: { 9: cells(30, 3), 5: cells(28, 2), 6: cells(27, 1), 7: cells(26, 0) } },
    };
    assert.ok(Math.abs(liveProjection(alone(9), fromStats, info, asExpected).mean - narrow) < 1e-9);
    // Gone off, he can still be caught: some of his 3 goes, and nothing else is to come.
    const gone = liveProjection(alone(9), match(race(2), [[9, 65]]), info, asExpected).mean;
    assert.ok(gone < 9 && gone > 8);
  });

  it('spreads a clean sheet at stake over all of its club’s players on the pitch', () => {
    // Two defenders 80 minutes into goalless matches, on 3 and 2 provisional bonus: one goal
    // against costs either his clean sheet and his bonus with it.
    const parts: XpParts = [81, 1.9, 0.4, 0, 0.3, 1.6, -0.4, 0.6, 0, 0.6, -0.1];
    const expected = { points: () => 4.9, parts: () => parts, cleanSheet: { DEF: 4 } };
    const match = (id: number, h: number, bps: [number, number][]): SlimFixture => ({
      id,
      h,
      a: h + 1,
      started: true,
      done: false,
      min: 80,
      score: [0, 0],
      bps,
    });
    const elements: SlimLive['elements'] = { 1: [9, 80], 2: [8, 80] };
    const together: SlimLive = {
      elements,
      fixtures: [
        match(1, 9, [
          [1, 30],
          [2, 25],
        ]),
      ],
    };
    const apart: SlimLive = {
      elements,
      fixtures: [
        match(1, 9, [[1, 30]]),
        match(2, 11, [
          [3, 30],
          [2, 25],
        ]),
      ],
    };
    const spread = (feed: SlimLive, club: (id: number) => number) =>
      liveProjection(
        { xi: [1, 2], bench: [], subs: [], off: [], pts: 17, points: () => 0 },
        feed,
        (id) => ({ pos: 'DEF', club: club(id) }),
        expected,
      ).variance;
    const share = (1 - 80 / 90) * (1 + 80 / 90 / 4);
    const keepsIt = (1.6 / 4 / 0.95) ** share;
    const bet = keepsIt * (1 - keepsIt);
    // Both in one club's defence: the 4 + 3 and the 4 + 2 go on the same goal.
    assert.ok(Math.abs(spread(together, () => 9) - (2 * share * 9 + bet * (7 + 6) ** 2)) < 1e-9);
    // At two clubs, two bets.
    assert.ok(Math.abs(spread(apart, (id) => (id === 2 ? 11 : 9)) - (2 * share * 9 + bet * (7 ** 2 + 6 ** 2))) < 1e-9);
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
    // minutes an hour into his match, without the teams. A midfielder on his club's bench
    // comes on three times in five, any substitute two in three, for 1.3 points; the bench
    // player next in line comes on for him the other time.
    const info = (id: number) => ({ pos: 'MID' as const, club: id === 8 ? 6 : id === 4 ? 3 : id });
    const named = (id: number) => (id === 5 ? 'bench' : id === 8 ? 'xi' : undefined);
    const expected = { points: () => 6, named };
    const free = { DEF: 0, MID: 0, FWD: 0 };
    const before = liveProjection({ xi: [5], bench: [8], subs: [], off: [], pts: 0, points: () => 0 }, feed, info, expected, free);
    assert.ok(Math.abs(before.mean - (0.6 * 1.3 + 0.4 * 6)) < 1e-9);
    const during = liveProjection({ xi: [4], bench: [8], subs: [], off: [], pts: 0, points: () => 0 }, feed, info, expected, free);
    assert.ok(Math.abs(during.mean - (0.65 * 1.3 + 0.35 * 6)) < 1e-9);
    // Left out of his club's squad, he won't play: the bench player counts in full.
    const out = liveProjection(
      { xi: [5], bench: [8], subs: [], off: [], pts: 0, points: () => 0 },
      feed,
      info,
      { ...expected, named: (id: number) => (id === 5 ? 'out' : 'xi') },
      free,
    );
    assert.ok(Math.abs(out.mean - 6) < 1e-9);
    assert.equal(playerProjection(5, feed, info, { ...expected, named: () => 'out' }), 0);
  });

  it('counts a keeper on his club’s bench as all but sure not to play', () => {
    // 5 is a keeper his club has named among its substitutes, and 8 the bench keeper his
    // club has named to start, with FPL's expected points (no parts to take apart).
    const info = (id: number) => ({ pos: 'GKP' as const, club: id === 8 ? 6 : 5 });
    const named = (id: number) => (id === 5 ? 'bench' : 'xi');
    const scored = { xi: [5], bench: [8], subs: [], off: [], pts: 0, points: () => 0 };
    const { mean } = liveProjection(scored, feed, info, { points: () => 3, named }, { DEF: 0, MID: 0, FWD: 0 });
    assert.ok(Math.abs(mean - (0.02 * 1.3 + 0.98 * 3)) < 1e-9);
  });

  it('plays a named starter as a starter, whatever his expected minutes', () => {
    // A midfielder in and out of the side: 33 expected minutes and 1.0 for playing, so he
    // plays about two times in three, often from the bench. Named to start, he plays 75
    // minutes, reaches the hour 86% of the time, and keeps a clean sheet as often over it.
    const parts: XpParts = [33, 1, 0.5, 0, 0.3, 0.2, 0, 0.1, 0, 0.2, -0.1];
    const info = () => ({ pos: 'MID' as const, club: 9 });
    const plays = 0.5 ** 0.6;
    const hour = 1 / plays - 1;
    const longer = 75 / (33 / plays);
    const starter = (longer * (2.2 - 1 - 0.2)) / plays + 1.86 + (0.2 / plays) * (0.86 / hour);
    const at = (named: 'xi' | undefined, min: number, played: number, pts: number, started = true) =>
      liveProjection(
        alone(pts),
        {
          elements: played ? { 9: [pts, played] } : {},
          fixtures: [{ id: 1, h: 9, a: 10, started, done: false, min, score: [0, 0] }],
        },
        info,
        { points: () => 2.2, parts: () => parts, cleanSheet: { MID: 1 }, named: () => named },
      ).mean;
    assert.ok(Math.abs(at(undefined, 0, 0, 0, false) - 2.2) < 1e-9); // until the teams are out, his expected points
    const before = at('xi', 0, 0, 0, false);
    assert.ok(Math.abs(before - starter) < 1e-9);
    assert.ok(starter > 2.2 / plays + 1); // more than his expected points given he plays, which count his cameos
    // And so it goes on from kick-off: no jump when it starts, or at the hour when FPL adds
    // his second point for playing and his clean sheet.
    assert.ok(Math.abs(at('xi', 1, 0, 0) - before) < 0.05);
    assert.ok(Math.abs(at('xi', 60, 60, 3) - at('xi', 59, 59, 1)) < 0.05);
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

  describe('defensive contributions', () => {
    // The defender above, named to start: 2 points once he makes 10 in a match, 0.6
    // expected of them. A keeper has no threshold.
    const rules = {
      defensive_contribution_limit_GKP: 0,
      defensive_contribution_GKP: 0,
      defensive_contribution_limit_DEF: 10,
      defensive_contribution_DEF: 2,
    };
    const info = (id: number) => ({ pos: (id === 1 ? 'GKP' : 'DEF') as Position, club: 9 });
    const cells = (made: number | null) => PL_STATS.map((s) => (s === 'defensive_contribution' ? made : 0));
    const feedAt = (id: number, min: number, pts: number): SlimLive => ({
      elements: min ? { [id]: [pts, min] } : {},
      fixtures: [{ id: 1, h: 9, a: 10, started: true, done: false, min, score: [0, 0] }],
    });
    const asStarter = { ...asExpected, named: () => 'xi' as const };
    const at = (min: number, made: number | null | undefined, { id = 9, pts = 1, expected = { ...asStarter, rules } as Expected } = {}) =>
      playerProjection(
        id,
        feedAt(id, min, pts),
        info,
        made === undefined ? expected : { ...expected, stats: () => ({ [id]: cells(made) }) },
      );
    // As if none were to come: the same defender without his expected part for them.
    const without: XpParts = [...defender];
    without[7] = 0;
    const none = (min: number, pts = 1) =>
      at(min, undefined, { pts, expected: { ...asStarter, rules, points: () => 4.3, parts: () => without } });
    const toCome = (min: number, made: number, pts = 1) => at(min, made, { pts }) - none(min, pts);

    it('has nothing more to come once he has reached the threshold', () => {
      assert.ok(Math.abs(toCome(45, 10, 3)) < 1e-9); // the 2 are in his points
      assert.ok(Math.abs(toCome(45, 13, 3)) < 1e-9);
    });

    it('gives the chance of reaching it from those he has made in the time left', () => {
      // 9 of 10 at half-time: one more is all but sure.
      assert.ok(toCome(45, 9) > 1.9 && toCome(45, 9) < 2);
      // None by then: hardly any chance.
      assert.ok(toCome(45, 0) < 0.05);
      // More made, more likely; less time left, less likely.
      assert.ok(toCome(30, 6) > toCome(30, 3));
      assert.ok(toCome(80, 6) < toCome(30, 6));
      // His expected part spread over the minutes left, as without his count, gives him far less.
      assert.ok(at(45, undefined) - none(45) < toCome(45, 9) / 5);
    });

    it('starts at kick-off where his expected points left him', () => {
      assert.ok(Math.abs(at(0, 0) - at(0, undefined)) < 1e-9);
      assert.ok(Math.abs(toCome(0, 0) - 0.6 / 0.95) < 1e-9); // his expected part, as a starter who plays for sure
    });

    it('leaves a keeper, and a match without stats, as they were', () => {
      assert.equal(at(45, 3, { id: 1 }), at(45, undefined, { id: 1 }));
      assert.equal(at(45, undefined), at(45, undefined, { expected: asStarter }));
      assert.equal(at(45, null), at(45, undefined)); // played twice that gameweek: FPL counts his for the week
      // Without the page's, the relay's stats count.
      const relay = (made: number) =>
        playerProjection(9, { ...feedAt(9, 45, 1), matches: { 1: { 9: cells(made) } } }, info, { ...asStarter, rules });
      assert.ok(Math.abs(relay(9) - relay(0) - (at(45, 9) - at(45, 0))) < 1e-9);
    });
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
