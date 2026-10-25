// A finished head-to-head with its gameweek's Premier League matches, the numbers under
// them and its stats file, for a match's pages.

import { PL_STATS, type Data, type LiveData, type Match, type PlStat, type PlStats } from '../../src/shared/data.ts';
import { lineup, season } from './league.ts';

/** FPL's points for what a player does, as the Draft game's settings name them: enough for the tests' matches. */
export const RULES = {
  long_play_limit: 60,
  long_play: 2,
  short_play: 1,
  goals_scored_MID: 5,
  goals_scored_FWD: 4,
  assists: 3,
  yellow_cards: -1,
  concede_limit: 2,
  saves_limit: 3,
};

/** A player's row in a stats file, from the stats he has. */
export const cells = (stats: Partial<Record<PlStat, number>>) => PL_STATS.map((name) => stats[name] ?? 0);

/** GW 2's stats file: what FPL counted of each of them beyond the points. */
export const statsFile = (): PlStats => ({
  gw: 2,
  matches: {
    20: {
      13: cells({ goals_scored: 1, bps: 25, threat: 30, creativity: 12.5, tackles: 2, recoveries: 4, clearances_blocks_interceptions: 1 }),
      16: cells({ bps: 6 }),
      14: cells({ goals_scored: 1, assists: 1, bonus: 3, bps: 38, threat: 44, creativity: 31, recoveries: 3 }),
      17: cells({ goals_scored: 1, yellow_cards: 1, bps: 15, threat: 22 }),
    },
    21: { 15: cells({ bps: 8, threat: 20, tackles: 1 }), 12: cells({ bps: 9 }) },
  },
  moments: {
    20: [
      [23, 1, 'goal', 14],
      [41, 1, 'goal', 13],
      [52, 2, 'yellow', 17],
      [67, 2, 'goal', 17, 14],
    ],
  },
});

/**
 * season() with GW 2's head-to-head between Bob and Cy taken apart: Chelsea lost 1-2 at home
 * to Liverpool, Palmer scoring for Chelsea, and Salah (who made the other) and Watkins (booked,
 * and off after 75 minutes) for Liverpool; Isak played an hour for Chelsea on Cy's bench.
 * Man City and Arsenal drew 0-0, Haaland and Saka playing throughout. Bob fielded Palmer and
 * Haaland, Cy Salah and Watkins.
 */
export function bobVCy(): Data {
  const d = season();
  d.meta.rules = RULES;
  Object.assign(d.players[13], { pts: [8, 7, 0] });
  Object.assign(d.players[14], { pts: [12, 13, 4] });
  Object.assign(d.players[17], { pts: [0, 5, 2] });
  const events = { 13: { goals: 1 }, 14: { goals: 1, assists: 1, bonus: 3 }, 17: { goals: 1, yellow: 1 } };
  d.events = { 2: events };
  d.plMatches = [
    {
      id: 20,
      gw: 2,
      home: 2,
      away: 3,
      ko: '2026-08-22T14:00:00Z',
      score: [1, 2],
      done: true,
      lineups: [
        [
          [13, 90, 7, 1],
          [16, 60, 5, 1],
        ],
        [
          [14, 90, 13, 1],
          [17, 75, 5, 1],
        ],
      ],
      events,
    },
    {
      id: 21,
      gw: 2,
      home: 4,
      away: 1,
      ko: '2026-08-22T16:30:00Z',
      score: [0, 0],
      done: true,
      lineups: [[[15, 90, 2, 1]], [[12, 90, 3, 1]]],
    },
  ];
  d.underlying = { 2: { 13: [0.45, 0.1, 5.8], 15: [0.62, 0.05, 3.1], 14: [0.8, 0.35, 9.4], 17: [0.5, 0.12, 4.4] } };
  d.lineups[2][2] = lineup([13, 15], [], 9);
  d.lineups[3][2] = { ...lineup([14, 17], [16], 18), benchPts: 5 };
  const m = d.matches.find((x) => x.gw === 2)!;
  Object.assign(m, {
    homePts: 9,
    awayPts: 18,
    xg: { xp: [8.9, 13.8], xPts: [0, 3] },
    odds: {
      p: [0.3, 0.2, 0.5],
      prices: [
        { dec: 3.2, frac: '11/5' },
        { dec: 4.8, frac: '19/5' },
        { dec: 1.9, frac: '9/10' },
      ],
      expected: [44.2, 51.7],
    },
  } satisfies Partial<Match>);
  return d;
}

/**
 * season() with GW 3 under way: Ann (Raya, Saka) v Bob (Palmer, Haaland). Arsenal have
 * beaten Chelsea 2-0; Liverpool v Man City is half an hour in, Haaland named to start and
 * top of the BPS, with defensive contributions in the gameweek's stats file (gw3Stats). The site's expected points are taken apart for Haaland, and FPL's are
 * there too.
 */
export function annVBobLive(): Data {
  const d = season();
  d.meta.rules = { ...RULES, defensive_contribution_limit_FWD: 12, defensive_contribution_FWD: 2 };
  d.gameweeks[2].deadline = '2026-08-28T17:30:00Z';
  d.matches.push({ gw: 3, home: 1, away: 2, homePts: 11, awayPts: 7, started: true, finished: false });
  const picks = (xi: number[], bench: number[]) => ({ ...lineup(xi, bench), picks: [...xi, ...bench] });
  d.lineups[1][3] = picks([11, 12], []);
  d.lineups[2][3] = picks([13, 15], []);
  const formation = (lines: number[][], subs: number[] = []) => ({ shape: '4-4-2', lines, subs });
  d.plMatches = [
    { id: 30, gw: 3, home: 1, away: 2, ko: '2026-08-29T11:30:00Z', score: [2, 0], done: true },
    { id: 31, gw: 3, home: 3, away: 4, ko: '2026-08-29T14:00:00Z', score: [0, 0], formations: [formation([[14]], [17]), formation([[15]])] },
  ];
  d.live = {
    gw: 3,
    ep: { 11: 3, 12: 5, 13: 4, 15: 6, 16: 2, 18: 3 },
    parts: { 15: [80, 1.9, 2.4, 0.3, 0.6, 0, 0, 0.1, 0, 0.7, 0] },
    cleanSheet: { GKP: 4, DEF: 4, MID: 1, FWD: 0 },
    fplEp: { 11: 2, 12: 7, 13: 3, 15: 8, 16: 1, 18: 2 },
    elements: { 11: [2, 90], 12: [9, 90], 13: [2, 90], 18: [1, 90], 15: [2, 30] },
    fixtures: [
      { id: 30, h: 1, a: 2, started: true, done: true, ko: '2026-08-29T11:30:00Z', score: [2, 0] },
      { id: 31, h: 3, a: 4, started: true, done: false, ko: '2026-08-29T14:00:00Z', min: 30, score: [0, 0], bps: [[15, 12]] },
    ],
  } as LiveData;
  return d;
}

/** GW 3's stats file while Liverpool v Man City is played: Haaland's tackles, clearances and the like. */
export const gw3Stats = (): PlStats => ({
  gw: 3,
  matches: { 31: { 15: cells({ tackles: 2, clearances_blocks_interceptions: 4, bps: 12 }) } },
});
