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

type Sides = [PlLine[], PlLine[]];
type Built = Map<number, [minutes: number, points: number]>;

/** The lines of each of the gameweek's matches that has them, home's then away's, by match id. */
export function roundLines(data: Data, gw: number, now?: LiveRound): Map<number, Sides> {
  const round = (data.plMatches ?? []).filter((pm) => pm.gw === gw);
  const fromFeed = (pm: PlMatch) => readsFeed(pm, now);
  const latest = latestFromFeed(round.filter(fromFeed));
  const built = builtSoFar(round.filter((x) => !fromFeed(x)));
  const lines = new Map<number, Sides>();
  for (const pm of round) {
    if (fromFeed(pm)) lines.set(pm.id, feedSides(data, pm, now!, latest, built));
    else if (pm.lineups) lines.set(pm.id, pm.lineups);
  }
  return lines;
}

function readsFeed(pm: PlMatch, now: LiveRound | undefined): boolean {
  const fixture = now?.feed.fixtures.find((f) => f.id === pm.id);
  return Boolean(fixture?.started && (!pm.lineups || !fixture.done));
}

// Each club's latest match from the feed.
function latestFromFeed(matches: PlMatch[]): Map<number, PlMatch> {
  const latest = new Map<number, PlMatch>();
  for (const pm of matches) for (const club of [pm.home, pm.away]) latest.set(club, pm);
  return latest;
}

// What the build has of each player (a double gameweek's first match), which his gameweek's
// points and minutes go beyond.
function builtSoFar(matches: PlMatch[]): Built {
  const built: Built = new Map();
  for (const [pid, minutes, pts] of matches.flatMap((pm) => (pm.lineups ?? []).flat())) {
    const [m, p] = built.get(pid) ?? [0, 0];
    built.set(pid, [m + minutes, p + pts]);
  }
  return built;
}

function feedSides(data: Data, pm: PlMatch, now: LiveRound, latest: Map<number, PlMatch>, built: Built): Sides {
  const sides: Sides = [[], []];
  const started = starterTest(pm, now.feed);
  for (const [id, [, minutes]] of Object.entries(now.feed.elements)) {
    const pid = Number(id);
    const club = data.players[pid]?.club;
    if (!minutes || club === undefined || latest.get(club) !== pm) continue;
    const side = club === pm.home ? 0 : 1;
    const [before, earned] = built.get(pid) ?? [0, 0];
    if (minutes <= before) continue; // a double gameweek's first match only
    sides[side].push([pid, minutes - before, now.points(pid) - earned, started(side, pid) ? 1 : 0]);
  }
  return sides;
}

// Who started: the Premier League's teams once they're out, else whoever didn't come on.
function starterTest(pm: PlMatch, feed: SlimLive): (side: 0 | 1, pid: number) => boolean {
  const starters = pm.formations?.map((f) => new Set(f.lines.flat()));
  return starters ? (side, pid) => starters[side].has(pid) : (_, pid) => !feed.events?.[pid]?.on;
}
