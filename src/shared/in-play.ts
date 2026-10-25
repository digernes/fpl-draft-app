// A head-to-head's in-play odds while its gameweek is played, from data.json and a live
// feed: each lineup scored live (provisional bonus and auto-subs), where its score is heading
// (live-projection.ts) and the chances from the two. The page shows them as the live odds, and
// the relay's Worker (every minute, worker/in-play.ts) and the build (at each build,
// src/build/in-play.ts) record them, so all of them work them out here, and keep the records
// the same way.

import type { Data, InPlayRecord, Match, Player } from './data.ts';
import { liveProjection, type Expected } from './live-projection.ts';
import { namedFrom, scoreLineup, type Named, type PlayerInfo, type Scored, type SlimLive } from './live.ts';
import { liveOdds } from './odds.ts';

/** What of data.json the live odds read. */
export type InPlayData = Pick<Data, 'players' | 'live' | 'meta' | 'plMatches' | 'lineups'>;

const UNKNOWN = { pos: undefined, club: undefined };

/** Each player's position, club and FPL status, as live scoring asks for them. */
export const playerInfoIn =
  (d: Pick<Data, 'players'>): PlayerInfo =>
  (pid) =>
    d.players[pid] ?? UNKNOWN;

/** Who each club named for its matches in a gameweek, where the Premier League has the teams. */
export function namedInGw(plMatches: Data['plMatches'], gw: number): Named {
  const teams = new Map((plMatches ?? []).flatMap((x) => (x.gw === gw && x.formations ? [[x.id, x.formations] as const] : [])));
  return namedFrom((fixture) => teams.get(fixture));
}

/** A player's expected points for the next gameweek: the site's, or with `fpl` FPL's form where data.json has it. */
export const nextXpOf = (p: Player, fpl: boolean) => (fpl ? (p.fpl ?? p.ep) : p.ep);

/** His expected points for the gameweek being played, as they were before it, the site's or with `fpl` FPL's. */
export const liveXpIn = (d: Pick<Data, 'players' | 'live'>, pid: number, fpl: boolean) =>
  (fpl ? d.live?.fplEp?.[pid] : undefined) ?? d.live?.ep[pid] ?? nextXpOf(d.players[pid], fpl);

/**
 * What a live projection expects of each player: his expected points (the site's, or with
 * `fpl` FPL's), taken apart when they're the site's, who his club has named, and the stats of
 * the matches being played, for the defensive contributions made so far.
 */
export function liveExpectedIn(d: InPlayData, gw: number, fpl: boolean, stats?: Expected['stats']): Expected {
  return {
    points: (pid) => (d.players[pid] ? liveXpIn(d, pid, fpl) : 0),
    parts: fpl ? undefined : (pid) => d.live?.parts?.[pid],
    cleanSheet: d.live?.cleanSheet,
    named: namedInGw(d.plMatches, gw),
    rules: d.meta.rules,
    stats,
  };
}

/** A manager's lineup in a gameweek scored live from a feed, as FPL would with the auto-subs it can be sure of; none without its picks. */
export function scoreLive(d: InPlayData, id: number, gw: number, feed: SlimLive): Scored | undefined {
  const picks = d.lineups[id]?.[gw]?.picks;
  return picks ? scoreLineup(picks, feed, playerInfoIn(d), d.meta.formation, namedInGw(d.plMatches, gw)) : undefined;
}

/** Where a live lineup's score is heading (liveProjection), with the league's formation. */
export const projectionIn = (d: InPlayData, scored: Scored, feed: SlimLive, expected: Expected) =>
  liveProjection(scored, feed, playerInfoIn(d), expected, d.meta.formation);

/** The live odds between two lineups scored live: home win, draw and away win, and their prices. */
export const inPlayOddsIn = (d: InPlayData, [home, away]: [Scored, Scored], feed: SlimLive, expected: Expected) =>
  liveOdds(projectionIn(d, home, feed, expected), projectionIn(d, away, feed, expected), d.meta.oddsOverround);

// --- Recording them ------------------------------------------------------------------

/** What of data.json recording the live odds reads: the matches and the deadlines too. */
export type RecordData = InPlayData & Pick<Data, 'matches' | 'gameweeks'>;

/** A head-to-head's key among its gameweek's records, as the relay's route has them: `<home>-<away>`. */
export const recordKey = (m: Pick<Match, 'home' | 'away'>) => `${m.home}-${m.away}`;

/**
 * The live odds now, as the page has them with the site's expected points, for each
 * head-to-head being played (started, not finished, in the gameweek of data.json's live
 * feed), by recordKey: from `feed` (data.json's own at a build, the relay's fresher one in
 * the Worker) with the stats of the matches being played, at `now` (ms). None before the
 * gameweek's deadline, or for a match without both lineups' picks.
 */
export function recordsNow(d: RecordData, feed: SlimLive, now: number, stats?: Expected['stats']): Record<string, InPlayRecord> {
  const gw = d.live?.gw;
  const deadline = Date.parse(d.gameweeks.find((g) => g.id === gw)?.deadline ?? '');
  const minutes = Math.round((now - deadline) / 60_000);
  const records: Record<string, InPlayRecord> = {};
  if (gw === undefined || !(minutes >= 0)) return records;
  for (const m of d.matches) {
    if (m.gw !== gw || !m.started || m.finished) continue;
    const [home, away] = [scoreLive(d, m.home, gw, feed), scoreLive(d, m.away, gw, feed)];
    if (!home || !away) continue;
    const { p } = inPlayOddsIn(d, [home, away], feed, liveExpectedIn(d, gw, false, stats));
    records[recordKey(m)] = [minutes, Math.round(p[0] * 1000), Math.round(p[2] * 1000), home.pts, away.pts];
  }
  return records;
}

/** A move, in thousandths of either side's chance, that earns a record its own place rather than the last one's. */
export const MOVE = 5;

const moved = (a: InPlayRecord, b: InPlayRecord) => Math.abs(a[1] - b[1]) >= MOVE || Math.abs(a[2] - b[2]) >= MOVE;

/**
 * The records with a new one: in a place of its own after a move of MOVE thousandths or more
 * since the last record kept for one, else in the latest's place, which was only there for
 * being the latest. Nothing changes when the chances and the score are as they were, so a
 * recorder with nothing new leaves them as they were.
 */
export function withRecord(records: InPlayRecord[], record: InPlayRecord): InPlayRecord[] {
  const last = records.at(-1);
  if (last && last.every((v, i) => i === 0 || v === record[i])) return records;
  const latestOnly = records.length > 1 && !moved(records.at(-2)!, last!);
  return [...(latestOnly ? records.slice(0, -1) : records), record];
}

/** How near, in minutes, one of the Worker's records takes the place of a build's: about the builds' spacing while matches are on. */
export const NEAR = 10;

/**
 * A head-to-head's records from both recorders: the Worker's (`finer`, every minute) and,
 * where it has none within NEAR minutes, the build's (`own`, which fill any gap in the
 * Worker's), in time order and thinned as withRecord thins them. Without the Worker's, the
 * build's as they are.
 */
export function mergeRecords(own: InPlayRecord[] | undefined, finer: InPlayRecord[] | undefined): InPlayRecord[] | undefined {
  if (!finer?.length) return own;
  const near = (r: InPlayRecord) => finer.some((f) => Math.abs(f[0] - r[0]) <= NEAR);
  const all = [...(own ?? []).filter((r) => !near(r)), ...finer].sort((a, b) => a[0] - b[0]);
  return all.reduce<InPlayRecord[]>((records, r) => withRecord(records, r), []);
}

const isRecord = (r: unknown): r is InPlayRecord =>
  Array.isArray(r) && r.length === 5 && r.every((v) => Number.isInteger(v)) && r[1] >= 0 && r[2] >= 0 && r[1] + r[2] <= 1000;

/** A gameweek's records as the relay answers with them (`{ "<home>-<away>": InPlayRecord[] }`), or null for anything else. */
export function parseRecords(body: unknown): Record<string, InPlayRecord[]> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const entries = Object.entries(body);
  const fine = entries.every(([key, list]) => /^\d+-\d+$/.test(key) && Array.isArray(list) && list.every(isRecord));
  return fine ? (Object.fromEntries(entries) as Record<string, InPlayRecord[]>) : null;
}
