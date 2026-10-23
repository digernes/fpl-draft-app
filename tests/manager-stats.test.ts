import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { closeCalls, gameIn, nemesis, pointsByPosition, rivalries } from '../src/app/manager-stats.ts';
import type { Data, Lineup, Match, Player, Position } from '../src/shared/data.ts';

const player = (pos: Position, pts: number[]): Player => ({
  name: 'P',
  full: 'P',
  pos,
  club: 1,
  code: 1,
  total: 0,
  pts,
  owner: null,
  status: 'a',
  ep: 0,
});
const match = (gw: number, home: number, away: number, homePts: number, awayPts: number, finished = true): Match => ({
  gw,
  home,
  away,
  homePts,
  awayPts,
  started: true,
  finished,
});
const xi = (...ids: number[]) => ({ xi: ids }) as Lineup;

// Manager 10 beats 20, draws with 30, loses to 20, and is playing 30 again live; 40
// hasn't met them. Players 1xx are 10's, 2xx 20's, 3xx 30's.
function data(): Data {
  return {
    meta: { firstGw: 1, scoring: { win: 3, draw: 1, loss: 0 } },
    managers: [10, 20, 30, 40].map((id) => ({ id })),
    matches: [match(1, 10, 20, 50, 40), match(2, 30, 10, 45, 45), match(3, 20, 10, 60, 30), match(4, 10, 30, 10, 90, false)],
    lineups: {
      10: { 1: xi(101, 102), 2: xi(101, 102), 3: xi(101), 4: xi(101) },
      20: { 1: xi(201, 202), 3: xi(201) },
      30: { 2: xi(301), 4: xi(302) },
    },
    players: {
      101: player('MID', [30, 25, 30, 5]),
      102: player('FWD', [20, 20, 0, 0]),
      201: player('DEF', [8, 0, 12, 0]),
      202: player('MID', [15, 0, 0, 0]),
      301: player('FWD', [0, 20, 0, 0]),
      302: player('FWD', [0, 0, 0, 90]), // only in the match still being played
    },
  } as unknown as Data;
}

describe('manager stats', () => {
  it('ranks opponents by points per match, then points difference, with the unplayed last', () => {
    const rows = rivalries(data(), 10);
    assert.deepEqual(
      rows.map((r) => [r.opp, r.played, r.won, r.drawn, r.lost, r.pf, r.pa, r.pts]),
      [
        [20, 2, 1, 0, 1, 80, 100, 3],
        [30, 1, 0, 1, 0, 45, 45, 1],
        [40, 0, 0, 0, 0, 0, 0, 0],
      ],
    );
  });

  it('breaks a points-per-match tie on points difference per match', () => {
    const d = data();
    d.matches = [match(1, 10, 20, 50, 48), match(2, 10, 30, 70, 40)];
    assert.deepEqual(
      rivalries(d, 10).map((r) => r.opp),
      [30, 20, 40],
    );
  });

  it('finds the opposing player with the most points against them, from finished matches only', () => {
    // 201 has 20 in two matches and 301 has 20 in one: the one-match haul wins the tie.
    // 302's 90 is in the live match, so it doesn't count yet.
    assert.deepEqual(nemesis(data(), 10), { player: 301, pts: 20, matches: 1, owners: [30] });
    assert.deepEqual(nemesis(data(), 40), null);
  });

  it('finds the best losing score and the worst winning score', () => {
    assert.deepEqual(closeCalls(data(), 10), {
      bestDefeat: { gw: 3, opp: 20, pf: 30, pa: 60 },
      worstWin: { gw: 1, opp: 20, pf: 50, pa: 40 },
    });
    assert.deepEqual(closeCalls(data(), 30), { bestDefeat: null, worstWin: null });
  });

  it('splits the XI’s points by position', () => {
    assert.deepEqual(pointsByPosition(data(), 10), { GKP: 0, DEF: 0, MID: 85, FWD: 40 });
  });

  it('gives a finished match from either side', () => {
    assert.deepEqual(gameIn(data(), 10, 2), { gw: 2, opp: 30, pf: 45, pa: 45 });
    assert.deepEqual(gameIn(data(), 20, 3), { gw: 3, opp: 10, pf: 60, pa: 30 });
    assert.equal(gameIn(data(), 10, 4), undefined);
  });
});
