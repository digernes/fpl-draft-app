import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Season } from '../src/build/season.ts';
import {
  buildPointsTable,
  buildResults,
  buildSeasonStats,
  buildTables,
  premierLeagueTable,
  premierLeagueTwins,
  tally,
} from '../src/build/tables.ts';
import type { ClubRow, Lineup, Match, OverallRow } from '../src/shared/data.ts';
import type { Fixture } from '../src/shared/fpl-api.ts';
import { winDrawWin } from '../src/shared/odds.ts';
import { match } from './fixtures/league.ts';

const scoring = { h2h_win: 3, h2h_draw: 1, h2h_lose: 0 };
const ids = [1, 2, 3, 4];

// Two gameweeks played: 1 beats 2 while 3 and 4 draw, then 1 beats 3 and 4 thrashes 2.
// Gameweek 3 is still to come.
const matches = (): Match[] => [
  match(1, 1, 2, 60, 50),
  match(1, 3, 4, 40, 40),
  match(2, 1, 3, 55, 45),
  match(2, 2, 4, 30, 70),
  { gw: 3, home: 1, away: 4, homePts: null, awayPts: null, started: false, finished: false },
  { gw: 3, home: 2, away: 3, homePts: null, awayPts: null, started: false, finished: false },
];

// Each lineup scores its match's points, with expected points 5 below them (so the spread
// of actual against expected is 5, above its floor of 4), and bench points of its manager's id.
const lineups: Record<number, Record<number, Lineup>> = {};
for (const m of matches().filter((x) => x.finished))
  for (const [id, pts] of [
    [m.home, m.homePts],
    [m.away, m.awayPts],
  ] as [number, number][])
    (lineups[id] ??= {})[m.gw] = {
      pts,
      adj: pts,
      dgw: 0,
      benchPts: id,
      xi: [id * 10, id * 10 + 1],
      bench: [id * 10 + 2],
      subs: [],
      xpf: pts - 5,
    };
const lineup = (id: number, gw: number) => lineups[id]?.[gw];

// Official standings by league entry (11-14 for managers 1-4).
const standing = (le: number, rank: number, won: number, drawn: number, lost: number, pf: number, pa: number) => ({
  league_entry: le,
  rank,
  last_rank: rank,
  matches_won: won,
  matches_drawn: drawn,
  matches_lost: lost,
  points_for: pf,
  points_against: pa,
  total: 3 * won + drawn,
});
const points: Record<number, number> = { 10: 10, 11: 1, 20: 7, 21: 0, 30: 3, 31: 3, 40: 2, 41: 9 };
const season = {
  details: {
    standings: [
      standing(13, 3, 0, 1, 1, 85, 95),
      standing(11, 1, 2, 0, 0, 115, 95),
      standing(14, 2, 1, 1, 0, 110, 70),
      standing(12, 4, 0, 0, 2, 80, 130),
    ],
  },
  finishedGws: [1, 2],
  scoring,
  pointsIn: (pid: number, gw: number) => (points[pid] ?? 0) * gw,
} as unknown as Season;
const entryByLeagueEntry = new Map([
  [11, 1],
  [12, 2],
  [13, 3],
  [14, 4],
]);

describe('results', () => {
  it('gives each manager his finished matches from his side', () => {
    const results = buildResults(ids, matches());
    assert.deepEqual(results[1], [
      { gw: 1, opp: 2, pf: 60, pa: 50, res: 'W' },
      { gw: 2, opp: 3, pf: 55, pa: 45, res: 'W' },
    ]);
    assert.deepEqual(
      results[3].map((r) => r.res),
      ['D', 'L'],
    );
    assert.deepEqual(
      results[4].map((r) => [r.opp, r.pf, r.pa]),
      [
        [3, 40, 40],
        [2, 70, 30],
      ],
    );
  });

  it('adds up wins, draws, losses, points scored and table points', () => {
    const results = buildResults(ids, matches());
    assert.deepEqual(tally(results[4], scoring), { played: 2, won: 1, drawn: 1, lost: 0, pf: 110, pa: 70, pts: 4 });
    assert.deepEqual(tally([], scoring), { played: 0, won: 0, drawn: 0, lost: 0, pf: 0, pa: 0, pts: 0 });
  });
});

describe('the tables', () => {
  const build = () => {
    const ms = matches();
    return { ms, ...buildTables(season, ids, entryByLeagueEntry, ms, buildResults(ids, ms), lineup) };
  };

  it('takes the official table from the standings, in rank order, with each manager’s form and next match', () => {
    const { overall } = build();
    assert.deepEqual(
      overall.map((r) => [r.id, r.rank, r.played, r.pts]),
      [
        [1, 1, 2, 6],
        [4, 2, 2, 4],
        [3, 3, 2, 1],
        [2, 4, 2, 0],
      ],
    );
    const first = overall[0];
    assert.equal(first.pf, 115);
    assert.equal(first.lastRank, 1);
    assert.deepEqual(
      first.form.map((r) => r.res),
      ['W', 'W'],
    );
    assert.deepEqual(first.next, { gw: 3, opp: 4, live: false });
  });

  it('leaves out a standing for a place nobody has taken', () => {
    const ms = matches();
    const empty = standing(15, 5, 0, 0, 0, 0, 0);
    const withEmpty = { ...season, details: { standings: [...season.details.standings, empty] } } as unknown as Season;
    const { overall } = buildTables(withEmpty, ids, entryByLeagueEntry, ms, buildResults(ids, ms), lineup);
    assert.deepEqual(
      overall.map((r) => r.id),
      [1, 4, 3, 2],
    );
  });

  it('ranks the form table on the last few gameweeks’ points, then points scored', () => {
    const { form } = build();
    assert.deepEqual(
      form.map((r) => [r.id, r.rank, r.pts, r.pf]),
      [
        [1, 1, 6, 115],
        [4, 2, 4, 110],
        [3, 3, 1, 85],
        [2, 4, 0, 80],
      ],
    );
  });

  it('plays every week against each of the other teams for the luck table, a share of a match each', () => {
    // Gameweek 1: 1 60, 2 50, 3 40, 4 40; gameweek 2: 4 70, 1 55, 3 45, 2 30.
    const { luck } = build();
    assert.deepEqual(
      luck.map((r) => [r.id, r.rank, r.won, r.drawn, r.lost, r.avgPts, r.pts, r.luck]),
      [
        [1, 1, 5, 0, 1, 5, 6, 1], // all three beaten, then two of three
        [4, 2, 3, 1, 2, 3.3, 4, 0.7], // a draw with 3 the first week (a third of a point), all three beaten the second
        [2, 3, 2, 0, 4, 2, 0, -2],
        [3, 4, 1, 1, 4, 1.3, 1, -0.3],
      ],
    );
    // Points above each week's average (47.5, then 50), all season.
    assert.deepEqual(
      luck.map((r) => r.above),
      [17.5, 12.5, -17.5, -12.5],
    );
  });

  it('keeps each gameweek’s scores for the odds', () => {
    const { scoresByGw } = build();
    assert.deepEqual(scoresByGw[1], [
      { id: 1, pts: 60 },
      { id: 2, pts: 50 },
      { id: 3, pts: 40 },
      { id: 4, pts: 40 },
    ]);
    assert.equal(scoresByGw[2].length, 4);
  });

  it('decides every played match on expected points for the xG table, and keeps them on the match', () => {
    const { xg, ms } = build();
    // Every score is 5 above its expected one, so the spread is 5.
    const first = ms[0];
    const p = winDrawWin(55, 45, 5);
    assert.deepEqual(first.xg?.xp, [55, 45]);
    assert.ok(Math.abs(first.xg!.xPts[0] - (3 * p.home + p.draw)) < 0.005);
    for (const m of ms.filter((x) => x.finished)) {
      // Three points are shared out, less one for each draw: 3 - P(draw) in all.
      const [h, a] = m.xg!.xPts;
      const d = winDrawWin(m.xg!.xp[0], m.xg!.xp[1], 5).draw;
      assert.ok(Math.abs(h + a - (3 - d)) < 0.01);
    }
    const row = (id: number) => xg.find((r) => r.id === id)!;
    assert.deepEqual([row(1).played, row(1).pf, row(1).pa, row(1).xpf, row(1).xpa], [2, 115, 95, 105, 85]);
    assert.equal(row(1).pts, 6);
    assert.equal(row(1).tableRank, 1);
    assert.equal(xg[0].id, 1); // the most expected table points
    assert.ok(xg.every((r, i) => i === 0 || xg[i - 1].xPts >= r.xPts));
    // The unplayed matches get nothing.
    assert.equal(ms[4].xg, undefined);
  });

  it('leaves a match out of the xG table when a side has no lineup', () => {
    const ms = matches();
    const without = (id: number, gw: number) => (id === 2 && gw === 2 ? undefined : lineup(id, gw));
    const { xg } = buildTables(season, ids, entryByLeagueEntry, ms, buildResults(ids, ms), without);
    assert.equal(xg.find((r) => r.id === 2)!.played, 1);
    assert.equal(xg.find((r) => r.id === 4)!.played, 1);
    assert.equal(ms[3].xg, undefined);
  });
});

describe('season stats', () => {
  const stats = () => buildSeasonStats(season, ids, buildResults(ids, matches()), lineup);

  it('sums each manager’s points, best and worst week, bench points and best player', () => {
    const s = stats().find((x) => x.id === 1)!;
    assert.equal(s.total, 115);
    assert.equal(s.avg, 57.5);
    assert.deepEqual(s.high, { pts: 60, gw: 1 });
    assert.deepEqual(s.low, { pts: 55, gw: 2 });
    assert.equal(s.bench, 2); // 1 a week
    // Player 10 scores 10 a gameweek times the gameweek, and 11 1 times it.
    assert.deepEqual(s.mvp, { player: 10, pts: 30 });
    assert.deepEqual(s.streak, { bestWin: 2, current: 'W2' });
  });

  it('has nothing for a manager without a lineup', () => {
    const [s] = buildSeasonStats(season, [9], { 9: [] }, lineup);
    assert.deepEqual(s, { id: 9, total: 0, avg: 0, high: null, low: null, bench: 0, mvp: null, streak: { bestWin: 0, current: null } });
  });

  it('ranks the points table on total points', () => {
    const table = buildPointsTable(stats());
    assert.deepEqual(
      table.map((r) => [r.rank, r.id, r.total, r.high, r.low]),
      [
        [1, 1, 115, 60, 55],
        [2, 4, 110, 70, 40],
        [3, 3, 85, 45, 40],
        [4, 2, 80, 50, 30],
      ],
    );
  });
});

describe('the Premier League table', () => {
  const fixture = (team_h: number, team_a: number, h: number | null, a: number | null, finished = true, provisional = false): Fixture => ({
    id: team_h * 10 + team_a,
    team_h,
    team_a,
    started: true,
    finished,
    finished_provisional: provisional,
    team_h_score: h,
    team_a_score: a,
  });
  const teams = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];

  it('rebuilds the table from the finished fixtures, provisional ones too', () => {
    const table = premierLeagueTable(
      [
        fixture(1, 2, 2, 0),
        fixture(3, 4, 1, 1),
        fixture(2, 3, 3, 1, false, true), // over, the bonus still to be confirmed
        fixture(4, 1, 0, 0, false), // being played
        fixture(1, 3, null, null), // no score yet
      ],
      teams,
    );
    assert.deepEqual(table[0], { club: 1, played: 1, won: 1, drawn: 0, lost: 0, gf: 2, ga: 0, pts: 3, rank: 1 });
    const row = (club: number) => table.find((r) => r.club === club)!;
    assert.deepEqual([row(2).played, row(2).won, row(2).lost, row(2).gf, row(2).ga, row(2).pts], [2, 1, 1, 3, 3, 3]);
    assert.deepEqual([row(4).played, row(4).drawn, row(4).pts], [1, 1, 1]);
    assert.equal(row(3).played, 2);
  });

  it('splits clubs level on points by goal difference, then goals scored', () => {
    const table = premierLeagueTable([fixture(1, 2, 1, 0), fixture(3, 4, 3, 2), fixture(2, 4, 4, 0)], teams);
    // 1, 2 and 3 have 3 points: 2 by goal difference +3, then 3 (+1, three scored) and 1 (+1, one).
    assert.deepEqual(
      table.map((r) => r.club),
      [2, 3, 1, 4],
    );
    assert.deepEqual(
      table.map((r) => r.rank),
      [1, 2, 3, 4],
    );
  });

  it('pairs each manager with the club on his points, sharing out clubs among managers level on points', () => {
    const club = (id: number, pts: number, rank: number): ClubRow => ({
      club: id,
      played: 2,
      won: 0,
      drawn: 0,
      lost: 0,
      gf: 0,
      ga: 0,
      pts,
      rank,
    });
    const plTable = [club(7, 6, 1), club(8, 4, 2), club(9, 4, 3), club(10, 1, 4)];
    const row = (id: number, pts: number) => ({ id, pts }) as OverallRow;
    const twins = premierLeagueTwins([row(1, 6), row(2, 4), row(3, 4), row(4, 3), row(5, 0)], plTable);
    assert.deepEqual(twins[0], { id: 1, club: 7, also: [], exact: true, wouldBe: 1 });
    assert.deepEqual(twins[1], { id: 2, club: 8, also: [9], exact: true, wouldBe: 2 });
    assert.deepEqual(twins[2], { id: 3, club: 9, also: [8], exact: true, wouldBe: 2 });
    // 3 points: the nearest are the clubs on 4, a point off.
    assert.deepEqual(twins[3], { id: 4, club: 8, also: [9], exact: false, wouldBe: 4 });
    assert.deepEqual(twins[4], { id: 5, club: 10, also: [], exact: false, wouldBe: 5 });
  });
});
