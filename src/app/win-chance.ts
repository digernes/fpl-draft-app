// Each side's chance of winning a head-to-head as its gameweek went, for the momentum card's
// other view: after any of its steps (momentum.ts), or at any moment within them, from the
// score then and what each XI still had to play, as the live odds see a lineup before its
// matches kick off. And where a moment of the gameweek falls among its kick-off slots, for
// the live odds recorded through it.

import type { Lineup, PlMatch } from '../shared/data.ts';
import { PLAYER_POINTS_SD, stillToPlay } from '../shared/live-projection.ts';
import { jumpsMean, liveOdds, type Heading, type Jump } from '../shared/odds.ts';
import type { Step } from './momentum.ts';

/** Home win, draw and away win. */
export type Chances = [number, number, number];

/** What the chances are worked out from, besides the steps. */
export interface Outlook {
  /** The gameweek's Premier League matches. */
  round: PlMatch[];
  /** Home's lineup and away's. */
  lineups: [Lineup, Lineup];
  clubOf: (pid: number) => number | undefined;
  /** A player's expected points for the gameweek before it started, on his side. */
  expected: (pid: number, side: 0 | 1) => number;
  /** His points in the gameweek: an automatic substitute's, known once his matches are over. */
  points: (pid: number) => number;
}

/** How much of a match had been played, from 0 to 1. */
export type Progress = (pm: PlMatch) => number;

/** After the steps played so far (the momentum's, in any order). */
export const chanceAfter = (played: Step[], o: Outlook): Chances => liveOdds(...headingAfter(played, o), 1).p;

/** Where each side's score was heading after the steps played so far, as chanceAfter sees it. */
export function headingAfter(played: Step[], o: Outlook): [Heading, Heading] {
  const done = new Set(played.flatMap((s) => (s.match ? [s.match.id] : [])));
  const score: [number, number] = [0, 1].map((side) => played.reduce((t, s) => t + s.gained[side], 0)) as [number, number];
  return headingAt(
    score,
    (pm) => (done.has(pm.id) ? 1 : 0),
    o,
    played.some((s) => !s.match),
  );
}

// At any moment: the score then and, for each of the XI, the share of his expected points
// from what was left of his club's matches (by the minute), with the live odds' spread for
// that share of his gameweek, their floor (he keeps what he has) and his cards and an own
// goal as their own chances for what was left of each of his matches. An automatic
// substitute counts as the starter he came on for until that starter's matches are over,
// and from then as himself: his points once his own are over too, which come in at the end
// with the step of their own (`subsIn`). With nothing left to play it's the win, the draw
// or the defeat.
export const chanceAt = (score: [number, number], progress: Progress, o: Outlook, subsIn = false): Chances =>
  liveOdds(...headingAt(score, progress, o, subsIn), 1).p;

/** Where each side's score was heading at a moment, as chanceAt sees it. */
export function headingAt(score: [number, number], progress: Progress, o: Outlook, subsIn = false): [Heading, Heading] {
  const fixturesOf = (pid: number) => {
    const club = o.clubOf(pid);
    return o.round.filter((pm) => pm.home === club || pm.away === club);
  };
  // How much of his gameweek was left, a match's worth each in a double gameweek.
  const left = (pid: number) => {
    const fixtures = fixturesOf(pid);
    return fixtures.length ? fixtures.reduce((t, pm) => t + 1 - progress(pm), 0) / fixtures.length : 0;
  };
  const [home, away] = o.lineups.map((lineup, i) => {
    const side = i as 0 | 1;
    let mean = score[side];
    let variance = 0;
    let floor = score[side];
    const jumps: Jump[] = [];
    const toCome = (pid: number) => {
      const share = left(pid);
      mean += share * o.expected(pid, side);
      variance += share * PLAYER_POINTS_SD ** 2;
      // Each match not yet over: its floor and drops for what was left of it, one not yet started with its point for playing.
      for (const pm of fixturesOf(pid)) {
        const still = stillToPlay(1 - progress(pm), undefined, progress(pm) === 0 ? 'yet to play' : undefined);
        floor += still.floor;
        jumps.push(...still.jumps);
      }
    };
    // A substitute's points are in the score once the substitutions are.
    const asSubstitute = (pid: number, starter: number | undefined) => {
      if (starter !== undefined && left(starter) > 0) toCome(starter);
      else if (left(pid) > 0) toCome(pid);
      else {
        mean += o.points(pid);
        floor += o.points(pid);
      }
    };
    for (const pid of lineup.xi) {
      const sub = lineup.subs.indexOf(pid);
      if (sub < 0) toCome(pid);
      else if (!subsIn) asSubstitute(pid, lineup.off?.[sub]);
    }
    return { mean, variance, floor: Math.min(floor, mean - jumpsMean(jumps)), jumps };
  });
  return [home, away];
}

/** Where a moment of the gameweek falls among its kick-off slots (see playingTime). */
export interface PlayingTime {
  /** The last slot to have kicked off by then. */
  slot: number;
  /** How far into its 90 minutes its matches had got, from 0 to 90. */
  minute: number;
  /** In play, at half-time, or after its matches (and on until the next slot's kick-off). */
  phase: 'play' | 'half-time' | 'after';
}

// A match as the clock sees it: 45 minutes and 2 of stoppage time, 15 of half-time, then 45
// and about 5 of stoppage time.
const FIRST_HALF_ENDS = 47;
const SECOND_HALF_STARTS = 62;
const FULL_TIME = 112;

/**
 * Where a moment (ms) falls among the slots' kick-offs (in order; none for one still to be
 * set): the last slot to have kicked off before it, and the minute its matches had reached,
 * from the time since their kick-off with half-time taken out. Up to 45 minutes it's that,
 * through first-half stoppage time and half-time 45, then less the 17 minutes those took, up
 * to 90; from then until the next slot's kick-off, its end. Before the first kick-off, none.
 */
export function playingTime(at: number, kickOffs: (string | null)[]): PlayingTime | undefined {
  const slot = kickOffs.findLastIndex((ko) => ko !== null && Date.parse(ko) < at);
  if (slot < 0) return undefined;
  const elapsed = (at - Date.parse(kickOffs[slot]!)) / 60_000;
  const minute = elapsed < SECOND_HALF_STARTS ? Math.min(45, elapsed) : Math.min(90, elapsed - (SECOND_HALF_STARTS - 45));
  const phase = elapsed >= FULL_TIME ? 'after' : elapsed >= FIRST_HALF_ENDS && elapsed < SECOND_HALF_STARTS ? 'half-time' : 'play';
  return { slot, minute, phase };
}
