// A small league for the page’s tests: three managers in GW 3, their next deadline a day off;
// the same league with its clubs, players and draft, for the pages that show them; and that
// with a season's tables, records and lineups after GW 2.

import type {
  Club,
  ClubRow,
  Data,
  DraftPick,
  Lineup,
  Match,
  MatchResult,
  OverallRow,
  Player,
  Position,
  TransferSummary,
} from '../../src/shared/data.ts';

export const match = (gw: number, home: number, away: number, homePts: number, awayPts: number, finished = true): Match => ({
  gw,
  home,
  away,
  homePts,
  awayPts,
  started: true,
  finished,
});

export function league(): Data {
  // Half a minute over, for the countdowns to read whole minutes however long the test takes.
  const at = (hours: number) => new Date(Date.now() + hours * 36e5 + 30e3).toISOString();
  return {
    meta: {
      season: '2026/27',
      firstGw: 1,
      currentGw: 3,
      nextGw: 4,
      lastFinishedGw: 2,
      scoring: { win: 3, draw: 1, loss: 0 },
      nextDeadline: at(25),
      nextWaivers: at(1.5),
    },
    managers: [
      { id: 1, first: 'Ann', team: 'Ann’s & Co' },
      { id: 2, first: 'Bob', team: 'Bob FC' },
      { id: 3, first: 'Cy', team: 'Cy United' },
    ],
    players: {},
    lineups: {},
    gameweeks: [],
    matches: [match(1, 1, 2, 50, 40), match(1, 3, 1, 30, 30), match(2, 2, 3, 45, 60)],
    transfers: { moves: [], claims: [], trades: [], waiverOrder: [3, 1, 2] },
  } as unknown as Data;
}

export const player = (name: string, pos: Position, club: number, total: number, owner: number | null = null): Player => ({
  name,
  full: name,
  pos,
  club,
  code: 0,
  total,
  owner,
  status: 'a',
  ep: 0,
});

export const lineup = (xi: number[], bench: number[] = [], pts = 0): Lineup => ({
  pts,
  adj: pts,
  dgw: 0,
  benchPts: 0,
  xi,
  bench,
  subs: [],
  xpf: 0,
});

const club = (name: string, short: string): Club => ({ name, short, logo: '', kit: null });

const pick = (overall: number, round: number, manager: number, pid: number, auto = false): DraftPick => ({
  overall,
  round,
  pick: overall,
  manager,
  player: pid,
  auto,
});

/**
 * Ann drafted Saka and Raya (an auto-pick), Bob Palmer and Haaland, Cy Salah and Isak,
 * whom Cy has since dropped for Watkins; Ann has signed Gabriel, and White is free.
 */
export function squads(): Data {
  const d = league();
  d.clubs = { 1: club('Arsenal', 'ARS'), 2: club('Chelsea', 'CHE'), 3: club('Liverpool', 'LIV'), 4: club('Man City', 'MCI') };
  d.players = {
    11: player('Raya', 'GKP', 1, 30, 1),
    12: player('Saka', 'MID', 1, 40, 1),
    13: player('Palmer', 'MID', 2, 55, 2),
    14: player('Salah', 'MID', 3, 70, 3),
    15: player('Haaland', 'FWD', 4, 80, 2),
    16: player('Isak', 'FWD', 2, 12),
    17: player('Watkins', 'FWD', 3, 25, 3),
    18: player('Gabriel', 'DEF', 1, 20, 1),
    19: player('White', 'DEF', 1, 8),
  };
  const deadline = (gw: number) => new Date(Date.UTC(2026, 7, 10 + 7 * gw, 10)).toISOString();
  d.gameweeks = [1, 2, 3, 4].map((id) => ({ id, deadline: deadline(id), finished: id < 3, doubles: [] }));
  d.draft = {
    picks: [pick(1, 1, 1, 12), pick(2, 1, 2, 13), pick(3, 1, 3, 14), pick(4, 2, 3, 16), pick(5, 2, 2, 15), pick(6, 2, 1, 11, true)],
    retention: [
      {
        id: 3,
        size: 2,
        kept: [14],
        gone: [{ player: 16, owner: null }],
        newcomers: [17],
        byGw: [2, 1, 1],
        originalShare: 0.75,
        originalXiPts: 70,
        draftHaul: 82,
      },
      { id: 2, size: 2, kept: [13, 15], gone: [], newcomers: [], byGw: [2, 2, 2], originalShare: 0.9, originalXiPts: 120, draftHaul: 135 },
      { id: 1, size: 2, kept: [12, 11], gone: [], newcomers: [18], byGw: [2, 2, 2], originalShare: 1, originalXiPts: 70, draftHaul: 70 },
    ],
  };
  return d;
}

const result = (gw: number, opp: number, pf: number, pa: number): MatchResult => ({
  gw,
  opp,
  pf,
  pa,
  res: pf > pa ? 'W' : pf < pa ? 'L' : 'D',
});

const overallRow = (id: number, rank: number, form: MatchResult[]): OverallRow => {
  const count = (res: string) => form.filter((f) => f.res === res).length;
  return {
    id,
    rank,
    lastRank: rank,
    played: form.length,
    won: count('W'),
    drawn: count('D'),
    lost: count('L'),
    pf: form.reduce((t, f) => t + f.pf, 0),
    pa: form.reduce((t, f) => t + f.pa, 0),
    pts: 3 * count('W') + count('D'),
    form,
    next: undefined,
  };
};

const clubRow = (club: number, rank: number, won: number, drawn: number, lost: number, gf: number, ga: number): ClubRow => ({
  club,
  played: won + drawn + lost,
  won,
  drawn,
  lost,
  gf,
  ga,
  pts: 3 * won + drawn,
  rank,
});

const score = (id: number, gw: number, pts: number, rank: number) => ({ id, gw, pts, dgw: 0, adj: pts, rank });

const decided = (gw: number, winner: number, loser: number, winPts: number, losePts: number) => ({
  gw,
  winner,
  loser,
  winPts,
  losePts,
  margin: winPts - losePts,
});

const summary = (id: number): TransferSummary => ({
  id,
  moves: 0,
  waivers: 0,
  free: 0,
  trades: 0,
  claims: 0,
  lost: 0,
  void: 0,
  net: 0,
  banked: 0,
  best: null,
  worst: null,
});

/**
 * squads() after GW 2, with what the league’s tabs and the team pages read of a season: each
 * player’s points gameweek by gameweek and each team’s lineups, the tables, the simulation,
 * the records and the season’s stats. GW 1: Ann beat Bob 50-40 and drew 30-30 with Cy; GW 2:
 * Cy beat Bob 60-45. Cy tops the table on points scored, Ann is second and Bob last. Ann has
 * Raya and Saka in her XI both weeks with Gabriel on the bench; Bob Palmer and Haaland; Cy
 * Salah, with Isak on the bench, and Watkins up front in GW 2. Nobody has made a move.
 */
export function season(): Data {
  const d = squads();
  Object.assign(d.meta, {
    name: 'Office League',
    generatedAt: '2026-08-25T12:00:00Z',
    lastGw: 4,
    formLength: 5,
    dgwPenalty: 4,
    oddsOverround: 1.05,
    hasProjections: true,
    formation: { DEF: 3, MID: 2, FWD: 1 },
    xiLimits: { GKP: [1, 1], DEF: [3, 5], MID: [2, 5], FWD: [1, 3] },
  });
  d.managers.forEach((m) => (m.initials = m.first.slice(0, 2).toUpperCase()));
  const pts: Record<number, number[]> = {
    11: [2, 6, 1],
    12: [10, 3, 5],
    13: [8, 2, 0],
    14: [12, 9, 4],
    15: [13, 2, 7],
    16: [2, 5, 0],
    17: [0, 8, 2],
    18: [6, 1, 3],
    19: [1, 0, 0],
  };
  for (const [pid, list] of Object.entries(pts)) d.players[pid].pts = list;
  d.lineups = {
    1: { 1: { ...lineup([11, 12], [18], 12), benchPts: 6 }, 2: { ...lineup([11, 12], [18], 9), benchPts: 1 } },
    2: { 1: lineup([13, 15], [], 21), 2: lineup([13, 15], [], 4) },
    3: { 1: { ...lineup([14], [16], 12), benchPts: 2 }, 2: { ...lineup([14, 17], [16], 17), benchPts: 5 } },
  };
  const cy = overallRow(3, 1, [result(1, 1, 30, 30), result(2, 2, 60, 45)]);
  const ann = overallRow(1, 2, [result(1, 2, 50, 40), result(1, 3, 30, 30)]);
  const bob = overallRow(2, 3, [result(1, 1, 40, 50), result(2, 3, 45, 60)]);
  d.tables = {
    overall: [cy, ann, bob],
    form: [cy, ann, bob],
    xg: [
      { id: 1, played: 2, pf: 80, pa: 70, xpf: 84.4, xpa: 66.1, xPts: 4.6, pts: 4, tableRank: 2, rank: 1 },
      { id: 3, played: 2, pf: 90, pa: 75, xpf: 81.2, xpa: 79.5, xPts: 3.1, pts: 4, tableRank: 1, rank: 2 },
      { id: 2, played: 2, pf: 85, pa: 110, xpf: 88, xpa: 100.3, xPts: 1.2, pts: 0, tableRank: 3, rank: 3 },
    ],
    luck: [
      { id: 3, played: 2, won: 2, drawn: 0, lost: 0, above: 12.5, avgPts: 6, pts: 4, luck: -2, tableRank: 1, rank: 1 },
      { id: 2, played: 2, won: 1, drawn: 0, lost: 1, above: 3, avgPts: 3, pts: 0, luck: -3, tableRank: 3, rank: 2 },
      { id: 1, played: 2, won: 0, drawn: 0, lost: 2, above: -15.5, avgPts: 0, pts: 4, luck: 4, tableRank: 2, rank: 3 },
    ],
    points: [
      { id: 3, total: 29, avg: 14.5, high: 17, low: 12, bench: 7, rank: 1 },
      { id: 2, total: 25, avg: 12.5, high: 21, low: 4, bench: 0, rank: 2 },
      { id: 1, total: 21, avg: 10.5, high: 12, low: 9, bench: 7, rank: 3 },
    ],
    premierLeague: [clubRow(1, 1, 2, 0, 0, 5, 1), clubRow(3, 2, 1, 1, 0, 3, 1), clubRow(4, 3, 0, 1, 1, 1, 3), clubRow(2, 4, 0, 0, 2, 1, 5)],
  };
  d.simulation = {
    runs: 10000,
    gameweeksLeft: 2,
    model: { leagueAverage: 45.2, projected: 2, levelSpread: 3.1, spread: 11.8, laterSpread: 13.4 },
    rows: [
      { id: 3, pts: 7.6, positions: [0.52, 0.3, 0.18], rank: 1 },
      { id: 1, pts: 7.1, positions: [0.4, 0.42, 0.18], rank: 2 },
      { id: 2, pts: 2.2, positions: [0.08, 0.28, 0.64], rank: 3 },
    ],
  };
  // Four points each puts Cy and Ann level with Liverpool, Bob on none closest to Chelsea.
  d.plTwins = [
    { id: 3, club: 3, also: [], exact: true, wouldBe: 2 },
    { id: 1, club: 3, also: [], exact: true, wouldBe: 3 },
    { id: 2, club: 2, also: [], exact: false, wouldBe: 6 },
  ];
  const stat = (id: number, total: number, high: [number, number], low: [number, number], bench: number, mvp: [number, number]) => ({
    id,
    total,
    avg: total / 2,
    high: { pts: high[0], gw: high[1] },
    low: { pts: low[0], gw: low[1] },
    bench,
    mvp: { player: mvp[0], pts: mvp[1] },
    streak: { bestWin: id === 2 ? 0 : 1, current: id === 3 ? 'W1' : null },
  });
  d.seasonStats = [
    stat(3, 90, [60, 2], [30, 1], 7, [14, 21]),
    stat(1, 80, [50, 1], [30, 1], 7, [12, 13]),
    stat(2, 85, [45, 2], [40, 1], 0, [15, 15]),
  ];
  d.records = {
    highest: score(3, 2, 60, 1),
    lowest: score(1, 1, 30, 1),
    biggestWin: decided(2, 3, 2, 60, 45),
    narrowestWin: decided(1, 1, 2, 50, 40),
    unluckiest: decided(2, 3, 2, 60, 45),
    luckiest: decided(1, 1, 2, 50, 40),
    draws: 1,
    benchMax: { id: 1, gw: 1, pts: 6 },
    longestWinRun: d.seasonStats[0],
  };
  d.topGameweeks = [
    { ...score(3, 2, 60, 1), guaranteed: false, opp: 2, oppPts: 45, star: { player: 14, pts: 9 } },
    { ...score(1, 1, 50, 2), guaranteed: false, opp: 2, oppPts: 40, star: { player: 12, pts: 10 } },
    { ...score(2, 2, 45, 3), guaranteed: true, opp: 3, oppPts: 60, star: null },
  ];
  d.worstGameweeks = [score(1, 1, 30, 1), score(3, 1, 30, 2), score(2, 1, 40, 3)];
  Object.assign(d.transfers, {
    summary: [summary(1), summary(2), summary(3)],
    contested: [],
    hotPotatoes: [],
    mostDropped: [],
    bestPickups: [],
    regrets: [],
    byGw: [],
  });
  return d;
}
