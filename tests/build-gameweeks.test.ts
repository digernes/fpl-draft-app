import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DGW_PENALTY } from '../src/build/config.ts';
import { buildGameweekList, buildGameweeks, buildRecords } from '../src/build/gameweeks.ts';
import type { Season } from '../src/build/season.ts';
import type { Lineup, Match, SeasonStat } from '../src/shared/data.ts';
import { match } from './fixtures/league.ts';

// Three managers over five gameweeks: 1 and 2 score well, 3 badly. 1's first week had a
// starter playing twice. Each XI is two players, 10× the manager's id and one more, the
// first scoring more; the bench scores the gameweek.
const scores: Record<number, number[]> = {
  1: [80, 75, 70, 65, 60],
  2: [78, 72, 70, 50, 44],
  3: [30, 35, 20, 25, 42],
};
const lineup = (id: number, gw: number): Lineup | undefined => {
  const pts = scores[id]?.[gw - 1];
  if (pts === undefined) return undefined;
  const dgw = id === 1 && gw === 1 ? 1 : 0;
  return { pts, adj: pts - DGW_PENALTY * dgw, dgw, benchPts: gw * id, xi: [id * 10, id * 10 + 1], bench: [], subs: [], xpf: 0 };
};
const season = {
  finishedGws: [1, 2, 3, 4, 5],
  pointsIn: (pid: number, gw: number) => (pid % 10 === 0 ? 8 : 3) + gw,
} as unknown as Season;
const ids = [1, 2, 3];
// 2 has a bye in gameweek 5.
const matches: Match[] = [
  match(1, 1, 2, 80, 78),
  match(2, 1, 3, 75, 35),
  match(3, 2, 3, 70, 20),
  match(4, 1, 2, 65, 50),
  match(5, 1, 3, 60, 42),
  { gw: 6, home: 2, away: 1, homePts: null, awayPts: null, started: false, finished: false },
];

describe('the top gameweeks', () => {
  const { candidates, topGameweeks, worstGameweeks } = buildGameweeks(season, ids, matches, lineup);

  it('ranks every week on its score less the double-gameweek penalty, sharing a place only within a week', () => {
    assert.equal(candidates.length, 15);
    assert.deepEqual(
      candidates.slice(0, 7).map((c) => [c.id, c.gw, c.adj, c.rank]),
      [
        [2, 1, 78, 1],
        [1, 1, 76, 2],
        [1, 2, 75, 3],
        [2, 2, 72, 4],
        [1, 3, 70, 5],
        [2, 3, 70, 5],
        [1, 4, 65, 7],
      ],
    );
  });

  it('keeps ten, with every manager’s best among them even if it ranks lower', () => {
    assert.equal(topGameweeks.length, 10);
    // 3's best is 11th, so it takes the place of 2's 44 in gameweek 5.
    const third = topGameweeks.at(-1)!;
    assert.deepEqual([third.id, third.gw, third.rank, third.guaranteed], [3, 5, 11, true]);
    assert.ok(topGameweeks.slice(0, -1).every((g) => !g.guaranteed && g.rank <= 10));
    assert.ok(!topGameweeks.some((g) => g.id === 2 && g.gw === 5));
  });

  it('names the opponent, his score and the star of each top week', () => {
    const [best] = topGameweeks;
    assert.deepEqual([best.opp, best.oppPts], [1, 80]);
    assert.deepEqual(best.star, { player: 20, pts: 9 });
    const away = topGameweeks.find((g) => g.id === 3 && g.gw === 5)!;
    assert.deepEqual([away.opp, away.oppPts], [1, 60]);
  });

  it('lists the five lowest scores', () => {
    assert.deepEqual(
      worstGameweeks.map((c) => [c.id, c.gw, c.pts]),
      [
        [3, 3, 20],
        [3, 4, 25],
        [3, 1, 30],
        [3, 2, 35],
        [3, 5, 42],
      ],
    );
  });
});

describe('the season’s records', () => {
  const { candidates } = buildGameweeks(season, ids, matches, lineup);
  const stat = (id: number, bestWin: number) => ({ id, streak: { bestWin, current: null } }) as SeasonStat;
  const records = buildRecords(season, ids, matches, candidates, [stat(1, 4), stat(2, 1), stat(3, 0)], lineup);

  it('finds the highest and lowest scores, on points as scored', () => {
    assert.deepEqual([records.highest?.id, records.highest?.gw, records.highest?.pts], [1, 1, 80]);
    assert.deepEqual([records.lowest?.id, records.lowest?.gw, records.lowest?.pts], [3, 3, 20]);
  });

  it('finds the biggest and narrowest wins, the best losing score and the worst winning one', () => {
    assert.deepEqual(records.biggestWin, { gw: 3, winner: 2, loser: 3, winPts: 70, losePts: 20, margin: 50 });
    assert.deepEqual(records.narrowestWin, { gw: 1, winner: 1, loser: 2, winPts: 80, losePts: 78, margin: 2 });
    assert.equal(records.unluckiest?.losePts, 78);
    assert.deepEqual(records.luckiest, { gw: 5, winner: 1, loser: 3, winPts: 60, losePts: 42, margin: 18 });
    assert.equal(records.draws, 0);
  });

  it('finds the most points left on a bench and the longest winning run', () => {
    assert.deepEqual(records.benchMax, { id: 3, gw: 5, pts: 15 });
    assert.equal(records.longestWinRun?.id, 1);
  });

  it('counts draws apart from wins', () => {
    const drawn = [...matches, match(6, 3, 2, 50, 50)];
    const r = buildRecords(season, ids, drawn, candidates, [], lineup);
    assert.equal(r.draws, 1);
    assert.equal(r.narrowestWin?.margin, 2);
    assert.equal(r.longestWinRun, null);
  });

  it('has nothing to show before a gameweek has finished', () => {
    const r = buildRecords({ ...season, finishedGws: [] } as Season, ids, [], [], [], lineup);
    assert.deepEqual(r, {
      highest: null,
      lowest: null,
      biggestWin: null,
      narrowestWin: null,
      unluckiest: null,
      luckiest: null,
      draws: 0,
      benchMax: null,
      longestWinRun: null,
    });
  });
});

describe('the season’s gameweeks', () => {
  const season = {
    events: [
      { id: 1, deadline_time: '2026-08-21T17:30:00Z', finished: true },
      { id: 2, deadline_time: '2026-08-28T17:30:00Z', finished: true },
      { id: 3, deadline_time: '2026-09-04T17:30:00Z', finished: false },
    ],
    doubleClubs: { 2: [4] },
    boot: { fixtures: { 3: [{ team_h: 1, team_a: 2, kickoff_time: '2026-09-05T14:00:00Z' }] } },
  } as unknown as Season;
  const fplBoot = (checked: boolean[]) => ({ elements: [], events: checked.map((data_checked, i) => ({ id: i + 1, data_checked })) });

  it('lists each with its deadline, whether it’s over, its doubles and a gameweek to come’s fixtures', () => {
    assert.deepEqual(buildGameweekList(season, null), [
      { id: 1, deadline: '2026-08-21T17:30:00Z', finished: true, doubles: [] },
      { id: 2, deadline: '2026-08-28T17:30:00Z', finished: true, doubles: [4] },
      { id: 3, deadline: '2026-09-04T17:30:00Z', finished: false, doubles: [], fixtures: [[1, 2, '2026-09-05T14:00:00Z']] },
    ]);
  });

  it('says whether FPL has checked each one’s stats, from the main game, when it has them', () => {
    const list = buildGameweekList(season, fplBoot([true, false, false]));
    assert.deepEqual(
      list.map((g) => g.checked),
      [true, false, false],
    );
    assert.equal(buildGameweekList(season, { elements: [] })[0].checked, undefined);
  });
});
