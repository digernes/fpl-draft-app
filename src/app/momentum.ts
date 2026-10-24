// How a head-to-head score built up through its gameweek: Premier League match by match,
// in kick-off order, the points each XI took from it. In place of fotmob.com's momentum.
// The automatic substitutes' points come in a step of their own after the gameweek's last
// match, when FPL makes the substitutions. A match being played (or over since the last
// build) comes from the live feed, as the score does, rather than waiting for the build's
// lines of it.

import type { Data, Lineup, Match, PlLine, PlMatch } from '../shared/data.ts';
import { roundLines, type LiveRound } from './match-lines.ts';

export interface Step {
  /** The match, or none for the automatic substitutions after the last one. */
  match?: PlMatch;
  /** The points each side's XI took from it, and the score after it. */
  gained: [number, number];
  score: [number, number];
  /** Who scored them: [player, points, side]. */
  scorers: [pid: number, pts: number, side: 0 | 1][];
}

/** The steps so far, or nothing when the gameweek's Premier League matches aren't in the data. */
export function momentum(data: Data, m: Match, lineups: [Lineup, Lineup], now?: LiveRound): Step[] {
  const round = (data.plMatches ?? []).filter((pm) => pm.gw === m.gw);
  const byMatch = roundLines(data, m.gw, now);
  const sides = lineups.map((l) => new Set(l.xi));
  const subs = new Set(lineups.flatMap((l) => l.subs ?? []));
  const scored = (lines: PlLine[], auto: boolean): Step['scorers'] =>
    lines.flatMap(([pid, , pts]) => {
      const side = sides[0].has(pid) ? 0 : sides[1].has(pid) ? 1 : -1;
      return side < 0 || !pts || subs.has(pid) !== auto ? [] : [[pid, pts, side as 0 | 1]];
    });
  const played = round.filter((pm) => byMatch.has(pm.id));
  const steps: Omit<Step, 'gained' | 'score'>[] = played.map((pm) => ({ match: pm, scorers: scored(byMatch.get(pm.id)!.flat(), false) }));
  const done = (pm: PlMatch) => now?.feed.fixtures.find((f) => f.id === pm.id)?.done ?? pm.done;
  if (subs.size && (m.finished || (round.length > 0 && round.every(done))))
    steps.push({
      scorers: scored(
        played.flatMap((pm) => byMatch.get(pm.id)!.flat()),
        true,
      ),
    });
  const score: [number, number] = [0, 0];
  return steps.map((step) => {
    const gainedBy = (side: 0 | 1) => step.scorers.filter((s) => s[2] === side).reduce((t, s) => t + s[1], 0);
    const gained: [number, number] = [gainedBy(0), gainedBy(1)];
    score[0] += gained[0];
    score[1] += gained[1];
    return { ...step, gained, score: [...score] as [number, number], scorers: step.scorers.sort((a, b) => b[1] - a[1]) };
  });
}
