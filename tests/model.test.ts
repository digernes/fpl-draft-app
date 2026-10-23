import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { LiveFeed } from '../src/shared/fpl-api.ts';
import { deadlineFlags, laterChance } from '../src/build/expected.ts';
import type { Season } from '../src/build/season.ts';
import { DEFAULT_OPTIONS, forecast } from '../src/model/forecast.ts';
import type { Data } from '../src/shared/data.ts';
import type { ClubMatch, ModelPlayer } from '../src/model/history.ts';
import { atLeast, chances, floorMean, readScoring } from '../src/model/points.ts';
import { fitTeams } from '../src/model/teams.ts';

const close = (a: number, b: number, tolerance = 1e-6) => assert.ok(Math.abs(a - b) < tolerance, `${a} is not ${b}`);

describe('model counts', () => {
  it('spreads a Poisson and a negative binomial with the right mean', () => {
    const mean = (p: number[]) => p.reduce((t, q, x) => t + q * x, 0);
    close(
      chances(1.4, Infinity).reduce((t, p) => t + p, 0),
      1,
    );
    close(mean(chances(1.4, Infinity)), 1.4);
    close(mean(chances(1.4, 5)), 1.4);
    assert.ok(chances(1.4, 5)[0] > chances(1.4, Infinity)[0]); // more spread: more blanks
  });

  it('works out the per-k points and the chance of a threshold', () => {
    // Poisson(2): floor(X/2) = 1 for 2–3, 2 for 4–5…
    const p = chances(2, Infinity);
    close(
      floorMean(2, 2),
      p.reduce((t, q, x) => t + Math.floor(x / 2) * q, 0),
    );
    close(
      atLeast(10, 8, 10),
      1 -
        chances(10, 8)
          .slice(0, 10)
          .reduce((t, q) => t + q, 0),
    );
    assert.equal(atLeast(0, 8, 10), 0);
  });

  it('reads the scoring rules by position', () => {
    const s = readScoring({
      goals_scored_DEF: 6,
      goals_scored_FWD: 4,
      assists: 3,
      defensive_contribution_limit_MID: 12,
      long_play_limit: 60,
    });
    assert.equal(s.goal.DEF, 6);
    assert.equal(s.goal.GKP, 0);
    assert.equal(s.defconLimit.MID, 12);
    assert.equal(s.concedeLimit, 2); // FPL's when unset
  });
});

describe('team strength', () => {
  it('rates the club that makes more chances higher, and the one that allows fewer', () => {
    const matches: ClubMatch[] = [];
    for (let gw = 1; gw <= 6; gw++)
      for (const [club, opp] of [
        [1, 2],
        [2, 3],
        [3, 1],
      ]) {
        const home = gw % 2 === 0;
        matches.push({ gw, fixture: gw * 10 + club, club, opp, home, xg: club === 1 ? 2.5 : 1, xga: 1, goals: 1 });
        matches.push({ gw, fixture: gw * 10 + club, club: opp, opp: club, home: !home, xg: opp === 2 ? 0.5 : 1, xga: 1, goals: 1 });
      }
    const teams = fitTeams(matches, { atGw: 7, halfLife: 10, prior: 1, home: 0, homePrior: 1e6, goals: 0 });
    assert.ok(teams.rate(1, 3, true) > teams.rate(3, 1, true));
    assert.ok(teams.rate(2, 3, true) < teams.rate(3, 2, true));
  });
});

describe('forecast', () => {
  // Two clubs, two gameweeks: club 1's striker (1) takes nearly all its chances, its
  // defender (2) plays every minute, and its subs (3, and defender 5) only ever come on late.
  const fixture = (id: number, gw: number) => ({
    id,
    event: gw,
    team_h: 1,
    team_a: 2,
    started: true,
    finished: true,
    finished_provisional: true,
    team_h_score: 1,
    team_a_score: 0,
    stats: [],
  });
  const stats = (minutes: number, xg: number, extra = {}) => ({
    total_points: 0,
    minutes,
    goals_scored: 0,
    assists: 0,
    clean_sheets: 0,
    goals_conceded: 0,
    expected_goals: xg,
    expected_assists: 0,
    expected_goals_conceded: 0.5,
    ...extra,
  });
  const feed = (gw: number): LiveFeed => ({
    fixtures: [fixture(gw, gw)],
    elements: {
      1: { stats: stats(90, 0.9), explain: [[[{ stat: 'minutes', value: 90 }], gw]] },
      2: { stats: stats(90, 0.1, { defensive_contribution: 11 }), explain: [[[{ stat: 'minutes', value: 90 }], gw]] },
      3: { stats: stats(10, 0), explain: [[[{ stat: 'minutes', value: 10 }], gw]] },
      4: { stats: stats(90, 0.4), explain: [[[{ stat: 'minutes', value: 90 }], gw]] },
      5: { stats: stats(10, 0), explain: [[[{ stat: 'minutes', value: 10 }], gw]] },
    },
  });
  const players = new Map<number, ModelPlayer>([
    [1, { club: 1, pos: 'FWD' }],
    [2, { club: 1, pos: 'DEF' }],
    [3, { club: 1, pos: 'MID' }],
    [4, { club: 2, pos: 'FWD' }],
    [5, { club: 1, pos: 'DEF' }],
  ]);
  const scoring = {
    goals_scored_FWD: 4,
    goals_scored_DEF: 6,
    goals_scored_MID: 5,
    clean_sheets_DEF: 4,
    goals_conceded_DEF: -1,
    concede_limit: 2,
    defensive_contribution_DEF: 2,
    defensive_contribution_limit_DEF: 10,
    assists: 3,
    short_play: 1,
    long_play: 2,
    long_play_limit: 60,
  };
  const input = { scoring, players, feeds: { 1: feed(1), 2: feed(2) } };

  const playing = 1 - DEFAULT_OPTIONS.players.absent;

  it('gives the regular starters their minutes and the striker the goals', () => {
    const { points, minutes, parts } = forecast(input, 3, [{ team_h: 2, team_a: 1 }]);
    close(minutes.get(1)!, 90 * playing);
    close(minutes.get(3)!, 10 * playing);
    assert.ok(parts.get(1)!.goals > parts.get(2)!.goals);
    assert.ok(parts.get(2)!.cleanSheet > 0 && parts.get(2)!.defcon > 0);
    assert.ok(points.get(3)! < points.get(1)!);
  });

  it('counts a match he missed less than one he played', () => {
    const missed = { ...feed(2), elements: { ...feed(2).elements, 1: { stats: stats(0, 0), explain: [] } } };
    const { minutes } = forecast({ ...input, feeds: { 1: feed(1), 2: missed } }, 3, [{ team_h: 2, team_a: 1 }]);
    const { decay, missed: weight } = DEFAULT_OPTIONS.players;
    close(minutes.get(1)!, ((90 * decay) / (decay + weight)) * playing);
  });

  it('leaves out clubs without a match, and scales by the chance of playing', () => {
    const flagged = (chance: number) =>
      forecast({ ...input, players: new Map(players).set(1, { club: 1, pos: 'FWD', chance }) }, 3, [{ team_h: 2, team_a: 1 }]).points.get(
        1,
      )!;
    const { points } = forecast(input, 3, [{ team_h: 2, team_a: 1 }]);
    const power = DEFAULT_OPTIONS.players.flagPower;
    close(flagged(75), points.get(1)! * 0.75 ** power);
    close(flagged(50), points.get(1)! * 0.5 ** power);
    assert.equal(flagged(0), 0);
    assert.equal(forecast(input, 3, [{ team_h: 5, team_a: 6 }]).points.size, 0);
  });

  it('hands a flagged player’s minutes to his stand-in', () => {
    const before = forecast(input, 3, [{ team_h: 2, team_a: 1 }]).minutes.get(5)!;
    const injured = new Map(players).set(2, { club: 1, pos: 'DEF', chance: 0 });
    const after = forecast({ ...input, players: injured }, 3, [{ team_h: 2, team_a: 1 }]).minutes.get(5)!;
    close(before, 10 * playing);
    close(after, DEFAULT_OPTIONS.standIns.start.DEF * playing); // the defender who came off the bench starts
  });

  it('only learns from the gameweeks before the one forecast', () => {
    const early = forecast(input, 2, [{ team_h: 2, team_a: 1 }]).minutes;
    const late = forecast({ ...input, feeds: { ...input.feeds, 3: feed(3) } }, 2, [{ team_h: 2, team_a: 1 }]).minutes;
    assert.deepEqual([...early], [...late]);
  });
});

describe('later gameweeks', () => {
  const deadline = Date.UTC(2026, 10, 7, 11); // 7 November
  const player = (status: string, news: string, chance: number | null = 0) => ({ status, news, chance_of_playing_next_round: chance });
  it('clear a doubt, and bring a player back when the news says so in time', () => {
    assert.equal(laterChance(player('d', 'Knock - 75% chance of playing', 75), deadline), null);
    assert.equal(laterChance(player('i', 'Hamstring injury - Expected back 1 Nov'), deadline), null);
    assert.equal(laterChance(player('s', 'Suspended until 08 Nov'), deadline), 0);
    assert.equal(laterChance(player('i', 'Knee injury - Unknown return date'), deadline), 0);
    assert.equal(laterChance(player('u', 'Has joined Al Hilal permanently'), deadline), 0);
  });
  it('read a January return in December as next year’s', () => {
    assert.equal(laterChance(player('i', 'Ankle injury - Expected back 3 Jan'), Date.UTC(2026, 11, 28)), 0);
    assert.equal(laterChance(player('i', 'Ankle injury - Expected back 3 Jan'), Date.UTC(2027, 0, 9)), null);
  });
});

describe('deadline flags', () => {
  const season = (deadline: string) =>
    ({
      nextGw: 9,
      nextEvent: { deadline_time: deadline },
      elements: new Map([
        [1, { id: 1, status: 'd', chance_of_playing_next_round: 50 }],
        [2, { id: 2, status: 'i', chance_of_playing_next_round: null }],
        [3, { id: 3, status: 'a', chance_of_playing_next_round: null }],
        [4, { id: 4, status: 'u', chance_of_playing_next_round: 0 }],
      ]),
    }) as unknown as Season;
  const previous = { flags: { 8: { 5: 75 } } } as unknown as Partial<Data>;
  const now = Date.parse('2026-10-30T12:00:00Z');

  it('writes the coming gameweek’s before its deadline, and keeps the earlier ones', () => {
    assert.deepEqual(deadlineFlags(season('2026-10-31T11:00:00Z'), previous, now), { 8: { 5: 75 }, 9: { 1: 50, 2: 0 } });
  });

  it('leaves them as they were once the deadline has passed', () => {
    assert.deepEqual(deadlineFlags(season('2026-10-30T11:00:00Z'), previous, now), { 8: { 5: 75 } });
  });
});
