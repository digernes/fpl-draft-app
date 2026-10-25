// GW 2's head-to-head, Bob v Cy (bobVCy()), while the gameweek is played, for the momentum's
// automatic substitutes: CHE v LIV over at 14:00, MCI v ARS at 16:30 as each test has it, and
// EVE v FUL at 19:00 still to come. Bob picked Palmer, Haaland and Isak (on the bench), Cy
// Salah and Watkins alone, and the league plays any formation.

import type { Data, LiveData, PlLine, PlMatch, PlMoment, PlStats } from '../../src/shared/data.ts';
import type { SlimFixture } from '../../src/shared/live.ts';
import { player } from './league.ts';
import { cells, statsFile, bobVCy } from './match.ts';

const MCI_V_ARS = '2026-08-22T16:30:00Z';
const FILLERS = [21, 22, 23, 24, 25, 26, 27, 28, 29];

/** How far MCI v ARS has got: over, being played (50 minutes in) or still to come; and whether the teams are out. */
export interface Setup {
  mciVArs: 'over' | 'live' | 'due';
  /** The Premier League's teams for it, Haaland left out. */
  teams?: boolean;
  /** Haaland starting it (with a goal after 20 minutes), on Bob's bench, and Isak, in his XI, not getting on at Chelsea. */
  haalandPlays?: boolean;
}

export function liveRound({ mciVArs, teams = false, haalandPlays = false }: Setup): Data {
  const d = bobVCy();
  d.meta.currentGw = 2;
  d.meta.formation = { DEF: 0, MID: 0, FWD: 0 };
  d.gameweeks[1].finished = false;
  d.clubs = { ...d.clubs, 5: { name: 'Everton', short: 'EVE', logo: '', kit: null }, 6: { name: 'Fulham', short: 'FUL', logo: '', kit: null } };
  const m = d.matches.find((x) => x.gw === 2)!;
  m.finished = false;
  // The rest of Bob's XI, Everton's, so his bench is twelfth.
  for (const pid of FILLERS) d.players[pid] = player(`Filler ${pid}`, 'DEF', 5, 0);
  Object.assign(d.lineups[2][2], { picks: haalandPlays ? [13, 16, ...FILLERS, 15] : [13, 15, ...FILLERS, 16] });
  Object.assign(d.lineups[3][2], { bench: [], benchPts: 0, picks: [14, 17] });
  const [cheVLiv, mciVArsMatch] = d.plMatches!;
  if (haalandPlays) cheVLiv.lineups![0] = [[13, 90, 7, 1]];
  const arsenal: PlLine[] = [[12, mciVArs === 'over' ? 90 : 50, 3, 1]];
  const haaland: PlLine[] = haalandPlays ? [[15, 50, 6, 1]] : [];
  Object.assign(mciVArsMatch, {
    done: mciVArs === 'over' ? true : undefined,
    score: mciVArs === 'due' ? undefined : [haalandPlays ? 1 : 0, 0],
    lineups: mciVArs === 'over' ? [haaland, arsenal] : undefined,
    formations: teams
      ? [
          { shape: '4-4-2', lines: [[99]], subs: [] },
          { shape: '4-4-2', lines: [[12]], subs: [] },
        ]
      : undefined,
  } satisfies Partial<PlMatch>);
  d.plMatches!.push({ id: 22, gw: 2, home: 5, away: 6, ko: '2026-08-22T19:00:00Z' });
  const fixture: SlimFixture =
    mciVArs === 'due'
      ? { id: 21, h: 4, a: 1, started: false, done: false, ko: MCI_V_ARS }
      : { id: 21, h: 4, a: 1, started: true, done: mciVArs === 'over', ko: MCI_V_ARS, score: mciVArsMatch.score, ...(mciVArs === 'live' ? { min: 50 } : {}) };
  d.live = {
    gw: 2,
    ep: { 13: 5, 14: 6, 15: 6, 16: 3, 17: 4 },
    elements: {
      13: [7, 90],
      14: [13, 90],
      17: [5, 75],
      ...(haalandPlays ? { 15: [6, 50] } : { 16: [5, 60] }),
      ...(mciVArs === 'due' ? {} : { 12: [3, mciVArs === 'over' ? 90 : 50] }),
    },
    fixtures: [
      { id: 20, h: 2, a: 3, started: true, done: true, ko: '2026-08-22T14:00:00Z', score: [1, 2] },
      fixture,
      { id: 22, h: 5, a: 6, started: false, done: false, ko: '2026-08-22T19:00:00Z' },
    ],
  } as LiveData;
  return d;
}

/** The gameweek's stats file: MCI v ARS's moments known too (Haaland's goal, if he plays). */
export function liveStats({ haalandPlays = false }: Partial<Setup> = {}): PlStats {
  const stats = statsFile();
  stats.moments![21] = haalandPlays ? ([[20, 1, 'goal', 15]] as PlMoment[]) : [];
  if (haalandPlays) stats.matches[21][15] = cells({ goals_scored: 1 });
  return stats;
}
