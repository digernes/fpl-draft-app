// Who played in each of a gameweek's Premier League matches, for how long, for how many
// FPL points and whether he started: the build's lines (data.json), or for a match being
// played, or over since the last build, the live feed's, as fresh as the scores. The
// momentum and the commentary read them.

import type { Data, PlLine, PlMatch } from '../shared/data.ts';
import type { SlimLive } from '../shared/live.ts';

/** The gameweek being played: the relay's feed, and each player's points in it so far (the provisional bonus in). */
export interface LiveRound {
  feed: SlimLive;
  points: (pid: number) => number;
}

/** The lines of each of the gameweek's matches that has them, home's then away's, by match id. */
export function roundLines(data: Data, gw: number, now?: LiveRound): Map<number, [PlLine[], PlLine[]]> {
  const round = (data.plMatches ?? []).filter((pm) => pm.gw === gw);
  const fixture = (pm: PlMatch) => now?.feed.fixtures.find((f) => f.id === pm.id);
  const fromFeed = (pm: PlMatch) => Boolean(fixture(pm)?.started && (!pm.lineups || !fixture(pm)!.done));
  // Each club's latest match from the feed, and what the build has of each player (a
  // double gameweek's first match), which his gameweek's points and minutes go beyond.
  const latest = new Map<number, PlMatch>();
  for (const pm of round.filter(fromFeed)) for (const club of [pm.home, pm.away]) latest.set(club, pm);
  const built = new Map<number, [minutes: number, points: number]>();
  for (const pm of round.filter((x) => !fromFeed(x)))
    for (const [pid, minutes, pts] of (pm.lineups ?? []).flat()) {
      const [m, p] = built.get(pid) ?? [0, 0];
      built.set(pid, [m + minutes, p + pts]);
    }
  const lines = new Map<number, [PlLine[], PlLine[]]>();
  for (const pm of round) {
    if (!fromFeed(pm)) {
      if (pm.lineups) lines.set(pm.id, pm.lineups);
      continue;
    }
    const sides: [PlLine[], PlLine[]] = [[], []];
    const starters = pm.formations?.map((f) => new Set(f.lines.flat()));
    for (const [id, [, minutes]] of Object.entries(now!.feed.elements)) {
      const pid = Number(id);
      const club = data.players[pid]?.club;
      if (!minutes || club === undefined || latest.get(club) !== pm) continue;
      const side = club === pm.home ? 0 : 1;
      const [before, earned] = built.get(pid) ?? [0, 0];
      if (minutes <= before) continue; // a double gameweek's first match only
      const started = starters ? starters[side].has(pid) : !now!.feed.events?.[pid]?.on;
      sides[side].push([pid, minutes - before, now!.points(pid) - earned, started ? 1 : 0]);
    }
    lines.set(pm.id, sides);
  }
  return lines;
}
