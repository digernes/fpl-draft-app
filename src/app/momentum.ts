// How a head-to-head score built up through its gameweek: Premier League match by match,
// in kick-off order, the points each XI took from it. In place of fotmob.com's momentum.
// Each automatic substitute comes in when his substitution is made, as the commentary times
// it (commentary.ts), while the gameweek is played and once it's over alike: with what he'd
// scored by then, in that match's step, and the rest as he earns it. Only one it can't time
// comes in with a step of its own after the last match, where FPL makes them. A match
// being played (or over since the last build) comes from the live feed, as the score does,
// rather than waiting for the build's lines of it. With the gameweek's stats file, each
// match's step also has the beats within it: the points as they came in, minute by minute,
// from the match's moments (the commentary's), the full time's aside.

import type { Data, Lineup, Match, PlMatch, PlStats } from '../shared/data.ts';
import { autoSubsMade, happenings, type Happening } from './commentary.ts';
import { roundLines, type LiveRound } from './match-lines.ts';

export interface Step {
  /** The match, or none for the automatic substitutions after the last one. */
  match?: PlMatch;
  /** The points each side's XI took from it, and the score after it. */
  gained: [number, number];
  score: [number, number];
  /** Who scored them: [player, points, side]. */
  scorers: [pid: number, pts: number, side: 0 | 1][];
  /** The points as they came in through the match, in order, when its moments are known. */
  beats?: Beat[];
  /** The automatic substitutes who come in with it. */
  subsIn?: number[];
}

/** Something in a match that changed the head-to-head's score, or an automatic substitute coming in. */
export interface Beat {
  /** Its minute in the match, stoppage time added on (47 in the first half is 45+2), and as it shows (45+2’, KO). */
  clock: number;
  minute: string;
  kind: Happening['kind'];
  /** Who got what in it: [player, points, side, what he did]. An automatic substitute's has him ('Came in') and his starter. */
  players: [pid: number, pts: number, side: 0 | 1, what: string][];
  gained: [number, number];
}

/** Where an automatic substitute comes in: when, and the match whose step has it. */
interface Made {
  at: number;
  step: PlMatch;
}

/** The steps so far, or nothing when the gameweek's Premier League matches aren't in the data. */
export function momentum(data: Data, m: Match, lineups: [Lineup, Lineup], now?: LiveRound, stats?: PlStats): Step[] {
  const round = (data.plMatches ?? []).filter((pm) => pm.gw === m.gw);
  const byMatch = roundLines(data, m.gw, now);
  const sides = lineups.map((l) => new Set(l.xi));
  const subs = new Set(lineups.flatMap((l) => l.subs ?? []));
  const played = round.filter((pm) => byMatch.has(pm.id));
  const done = (pm: PlMatch) => now?.feed.fixtures.find((f) => f.id === pm.id)?.done ?? pm.done;
  const atEnd = m.finished || (round.length > 0 && round.every(done));
  const made = subs.size ? madeIn(data, m, lineups, played, now, stats) : new Map<number, Made>();
  // The step a player's points from a match count in: the match's own; for an automatic
  // substitute, the one he comes in with until he has, and none before his substitution is
  // made, or once it's all over, should it never be timed, the end's (null).
  const stepOf = (pid: number, pm: PlMatch): PlMatch | null | undefined => {
    if (!subs.has(pid)) return pm;
    const sub = made.get(pid);
    if (!sub) return atEnd ? null : undefined;
    return Date.parse(pm.ko ?? '') >= sub.at ? pm : sub.step;
  };
  const counted = played.flatMap((pm) =>
    byMatch
      .get(pm.id)!
      .flat()
      .map((line) => ({ line, step: stepOf(line[0], pm) })),
  );
  const scored = (step: PlMatch | null): Step['scorers'] => {
    const by = new Map<number, number>();
    for (const { line, step: s } of counted) if (s === step) by.set(line[0], (by.get(line[0]) ?? 0) + line[2]);
    return [...by].flatMap(([pid, pts]) => {
      const side = sides[0].has(pid) ? 0 : sides[1].has(pid) ? 1 : -1;
      return side < 0 || !pts ? [] : [[pid, pts, side as 0 | 1]];
    });
  };
  const beats = stats ? beatsIn(data, stats, m, lineups, now, made) : new Map<number, Beat[]>();
  const steps: Omit<Step, 'gained' | 'score'>[] = played.map((pm) => {
    const subsIn = [...made].filter(([, x]) => x.step === pm).map(([pid]) => pid);
    return {
      match: pm,
      scorers: scored(pm),
      ...(stats?.moments?.[pm.id] ? { beats: beats.get(pm.id) ?? [] } : {}),
      ...(subsIn.length ? { subsIn } : {}),
    };
  });
  if (atEnd && [...subs].some((pid) => !made.has(pid))) steps.push({ scorers: scored(null) });
  const score: [number, number] = [0, 0];
  return steps.map((step) => {
    const gainedBy = (side: 0 | 1) => step.scorers.filter((s) => s[2] === side).reduce((t, s) => t + s[1], 0);
    const gained: [number, number] = [gainedBy(0), gainedBy(1)];
    score[0] += gained[0];
    score[1] += gained[1];
    return { ...step, gained, score: [...score] as [number, number], scorers: step.scorers.sort((a, b) => b[1] - a[1]) };
  });
}

// Each automatic substitute made so far, when the commentary has the substitution made and in
// that match's step. One the live scores have made ahead of a kick-off still to come that his
// starter isn't in the squad for (the teams are out an hour before) comes in where play has
// got, in the latest match played, so the curve ends on the live score.
function madeIn(data: Data, m: Match, lineups: [Lineup, Lineup], played: PlMatch[], now?: LiveRound, stats?: PlStats) {
  const made = new Map<number, Made>();
  const latest = played.at(-1);
  for (const [pid, when] of autoSubsMade(data, m, lineups, { now, stats })) {
    const step = played.includes(when.match) ? when.match : latest;
    if (step) made.set(pid, { at: when.at, step });
  }
  return made;
}

// The commentary's moments that moved the score, match by match, in order, full time's aside,
// which the match's step has. Each automatic substitute made (`made`) comes in with his own
// beat, his moments from before it on the bench, and counts from then on.
function beatsIn(data: Data, stats: PlStats, m: Match, lineups: [Lineup, Lineup], now: LiveRound | undefined, made: Map<number, Made>) {
  const subs = new Set(lineups.flatMap((l) => l.subs ?? []));
  const counts = (p: Happening['players'][number]) => !p.bench && (!subs.has(p.pid) || made.has(p.pid));
  const entries = happenings(data, stats, m, lineups, { now, autoSubs: true }).flatMap((e) => {
    if (e.kind !== 'autosub') return [e];
    const sub = made.get(e.players[0].pid);
    if (!sub) return [];
    // One made ahead of a kick-off to come: as late in his step as play has got.
    return [sub.step === e.match ? e : { ...e, match: sub.step, at: Number.MAX_SAFE_INTEGER }];
  });
  const byMatch = new Map<number, Beat[]>();
  const sorted = entries.filter((e) => e.kind !== 'fulltime').sort((a, b) => a.at - b.at);
  for (const e of sorted) {
    const players = e.kind === 'autosub' ? e.players : e.players.filter((p) => counts(p) && p.pts);
    const gained: [number, number] = [0, 0];
    for (const p of players) gained[p.side] += p.pts;
    if (!gained[0] && !gained[1] && e.kind !== 'autosub') continue;
    const beat: Beat = {
      clock: clockOf(e),
      minute: e.minute,
      kind: e.kind,
      players: players.map((p) => [p.pid, p.pts, p.side, p.what ?? e.kind]),
      gained,
    };
    byMatch.set(e.match.id, [...(byMatch.get(e.match.id) ?? []), beat]);
  }
  return byMatch;
}

// The minutes played by then: the commentary's times have a quarter of an hour for half-time.
function clockOf(e: Happening) {
  const min = (e.at - Date.parse(e.match.ko!)) / 60_000;
  return Math.round(min >= 60 ? min - 15 : min);
}
