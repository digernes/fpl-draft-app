// The Premier League's player stats files: stats/<gw>.json (see PlStats) and stats/season.json,
// asked for the first time they're wanted and again after each new data.json, with the live
// relay's matches over a gameweek's while it's played; and what's read from them: where a
// player's points came from, his BPS, and his underlying numbers in a gameweek, worked out
// from them while it's on.

import { PL_STATS, type PlMoment, type PlSeasonStats, type PlStat, type PlStats, type Underlying } from '../shared/data.ts';
import type { ToCome } from '../shared/live-projection.ts';
import type { SlimLive } from '../shared/live.ts';
import { packAsScored, packUnderlying, scoredIn, underlyingOf } from '../shared/underlying.ts';
import { sum } from './format.ts';
import { gwBonus, gwPoints, isArchive, player, seasonEntry } from './lookups.ts';
import { linesIn } from './pl.ts';
import { renderView } from './render.ts';
import { D, live } from './state.ts';

export type Cells = (number | null)[] | undefined;

const files = new Map<string, { version: string; stats?: unknown; failed?: boolean }>();

// Beside data.json, or a finished season's beside its archive.
function statsFile(name: string) {
  const archive = isArchive() ? seasonEntry()?.file.replace(/\.json$/, '') : null;
  return archive ? `${archive}/stats/${name}.json` : `stats/${name}.json`;
}

/**
 * The gameweek's stats file once it's in. Each new data.json comes with a new one, which
 * is asked for then, the last one showing meanwhile. While the gameweek is played, the
 * relay's matches go over it, as fresh as the scores.
 */
export function statsFor(gw: number): PlStats | 'loading' | 'missing' {
  const file = fileFor(gw);
  const feed = live?.gw === gw && !isArchive() ? live.feed : null;
  if (!feed?.matches || file === 'loading') return file;
  const stats = file === 'missing' ? undefined : file;
  if (merged?.feed !== feed || merged.file !== stats) merged = { feed, file: stats, stats: withLive(gw, stats, feed, idsByCode()) };
  return merged.stats;
}

// The points FPL scores a match for (shared/underlying.ts), in the order they're told, a few put together.
const POINT_SOURCES: [key: string, label: string][] = [
  ['minutes', 'Playing'],
  ['goals_scored', 'Goals'],
  ['assists', 'Assists'],
  ['clean_sheets', 'Clean sheet'],
  ['goals_conceded', 'Goals conceded'],
  ['defensive_contribution', 'Defensive contribution'],
  ['saves', 'Saves'],
  ['penalties', 'Penalties'],
  ['bonus', 'Bonus'],
  ['cards', 'Cards'],
  ['own_goals', 'Own goals'],
  ['other', 'Other'],
];
const PUT_TOGETHER: Record<string, string> = {
  yellow_cards: 'cards',
  red_cards: 'cards',
  penalties_saved: 'penalties',
  penalties_missed: 'penalties',
};

/**
 * Where a player's points in a gameweek (or one of its matches) came from, once its stats
 * file is in: each match as FPL scores it, the bonus as it stands (provisional while it's
 * on), and under other what the stats don't account for, as FPL gives some of a double
 * gameweek's only for the whole week.
 */
export function pointsFrom(pid: number, gw: number, match?: number): Record<string, number> | undefined {
  const file = statsFor(gw);
  if (typeof file !== 'object') return undefined;
  const all = linesIn(pid, gw);
  const lines = all.filter(({ m }) => match === undefined || m.id === match);
  const from: Record<string, number> = { bonus: match === undefined ? gwBonus(pid, gw) : (lines[0]?.m.events?.[pid]?.bonus ?? 0) };
  // While it's played, his minutes from the live feed, as his points are: data.json's lines
  // are as old as its build. The feed has them for the gameweek, so only with one match.
  const liveMinutes = live?.gw === gw && all.length === 1 ? live.feed.elements[pid]?.[1] : undefined;
  for (const { m, line } of lines) {
    const cells = file.matches[m.id]?.[pid];
    if (cells) addScored(from, pid, cells, liveMinutes ?? line[1]);
  }
  const points = match === undefined ? gwPoints(pid, gw) : sum(lines.map(({ line }) => line[2]));
  from.other = points - sum(Object.values(from));
  return from;
}

// What FPL scores him for in one match, the bonus aside: that's the gameweek's, or the match's as it stands.
function addScored(from: Record<string, number>, pid: number, cells: (number | null)[], minutes: number) {
  const stat = (name: PlStat) => Number(cells[PL_STATS.indexOf(name)] ?? 0);
  for (const [name, pts] of Object.entries(scoredIn(stat, minutes, D.meta.rules ?? {}, player(pid)?.pos))) {
    if (name === 'bonus') continue;
    const key = PUT_TOGETHER[name] ?? name;
    from[key] = (from[key] ?? 0) + pts;
  }
}

/** The same as rows for a tip, those that scored anything. */
export const pointsRows = (from: Record<string, number> | undefined): [string, number][] =>
  from ? POINT_SOURCES.flatMap(([key, label]): [string, number][] => (from[key] ? [[label, from[key]]] : [])) : [];

// What's still to come by the same sources, and a substitute's chance of coming on, or expected points that come whole.
const TO_COME_SOURCES: [key: string, label: string][] = [...POINT_SOURCES, ['coming_on', 'Coming on'], ['expected', 'Expected points']];

/** What a live projection has still to come of a player's points (live-projection.ts) as rows for a tip, those worth a tenth when rounded. */
export const toComeRows = (toCome: ToCome | undefined): [string, number][] =>
  toCome
    ? TO_COME_SOURCES.flatMap(([key, label]): [string, number][] => {
        const x = toCome[key as keyof ToCome] ?? 0;
        return Math.abs(x) >= 0.05 ? [[label, x]] : [];
      })
    : [];

/** A player's BPS in a gameweek (or one of its matches), once its stats file is in: FPL's measure of his game, to tell apart those level on points. */
export function bpsIn(pid: number, gw: number, match?: number): number | undefined {
  const file = statsFor(gw);
  if (typeof file !== 'object') return undefined;
  const values = Object.entries(file.matches).flatMap(([id, rows]) =>
    match === undefined || Number(id) === match ? [rows[pid]?.[PL_STATS.indexOf('bps')]] : [],
  );
  return values.some((v) => v != null) ? values.reduce<number>((t, v) => t + (v ?? 0), 0) : undefined;
}

// The merge stays the same until the feed or the file changes.
let merged: { feed: SlimLive; file: PlStats | undefined; stats: PlStats } | null = null;
let codes: { players: typeof D.players; ids: Map<number, number> } | null = null;
const idsByCode = () => {
  if (codes?.players !== D.players)
    codes = { players: D.players, ids: new Map(Object.entries(D.players).map(([pid, p]) => [p.code, Number(pid)])) };
  return codes.ids;
};

/** A gameweek's stats (its file's, if it has one) with the relay's matches over them: their stats, and their moments with FPL's codes for players made ids. */
export function withLive(gw: number, file: PlStats | undefined, feed: SlimLive, ids: Map<number, number>): PlStats {
  const moments = Object.fromEntries(
    Object.entries(feed.moments ?? {}).map(([fixture, list]) => [
      fixture,
      list.flatMap(([min, half, kind, code, other]): PlMoment[] => {
        const [pid, with_] = [ids.get(code), other === undefined ? undefined : ids.get(other)];
        if (pid === undefined || (kind === 'sub' && with_ === undefined)) return [];
        return [with_ === undefined ? [min, half, kind, pid] : [min, half, kind, pid, with_]];
      }),
    ]),
  );
  return { ...file, gw, matches: { ...file?.matches, ...feed.matches }, moments: { ...file?.moments, ...moments } };
}

/**
 * A player's xG, xA, xP and xCS in a gameweek: data.json's once it's over, and while it's
 * played worked out the same way from his match's stats so far (shared/underlying.ts),
 * for one who has played in only one match that week.
 */
export const gwUnderlying = (pid: number, gw: number): Underlying | undefined =>
  settled(gw) ? D.underlying?.[gw]?.[pid] : packUnderlying(liveUnderlying(pid, gw));

/** The points in his xP that stay as scored, for its tooltip, likewise. */
export const gwAsScored = (pid: number, gw: number): number[] | undefined =>
  settled(gw) ? D.asScored?.[gw]?.[pid] : packAsScored(liveUnderlying(pid, gw));

const settled = (gw: number) => Boolean(D.underlying?.[gw]) || gw !== D.meta.currentGw || isArchive();

function liveUnderlying(pid: number, gw: number) {
  const stats = statsFor(gw);
  if (typeof stats !== 'object') return undefined;
  const rows = Object.values(stats.matches).flatMap((byPid) => (byPid[pid] ? [byPid[pid]] : []));
  const feed = live?.gw === gw ? live.feed : D.live?.gw === gw ? D.live : null;
  const [points, minutes] = feed?.elements[pid] ?? [0, 0];
  return rows.length === 1 ? matchUnderlying(pid, rows[0], minutes, points) : undefined;
}

// His underlying numbers in one match: from his stats in it, and his minutes and points.
export function matchUnderlying(pid: number, cells: Cells, minutes: number, points: number) {
  const at = (stat: PlStat) => cells?.[PL_STATS.indexOf(stat)];
  if (at('expected_goals') == null) return undefined;
  const n = (stat: PlStat) => Number(at(stat) ?? 0);
  const s = {
    minutes,
    total_points: points,
    expected_goals: n('expected_goals'),
    expected_assists: n('expected_assists'),
    expected_goals_conceded: n('expected_goals_conceded'),
  };
  const [rules, pos] = [D.meta.rules ?? {}, player(pid)?.pos];
  return underlyingOf(s, rules, pos, 1, scoredIn(n, minutes, rules, pos));
}

// A gameweek's file alone.
const fileFor = (gw: number) => load<PlStats>(String(gw));

/** stats/season.json: everyone's season so far, for the Premier League's Player stats tab. */
export const seasonFile = () => load<PlSeasonStats>('season');

function load<T>(name: string): T | 'loading' | 'missing' {
  const file = statsFile(name);
  const version = D.meta.generatedAt ?? '';
  const had = files.get(file);
  if (had?.version !== version) {
    files.set(file, { version, stats: had?.stats });
    fetch(`${file}?v=${encodeURIComponent(version)}`)
      .then((res) => (res.ok ? (res.json() as Promise<T>) : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(
        (stats) => files.set(file, { version, stats }),
        () => files.set(file, { version, stats: had?.stats, failed: true }),
      )
      .finally(() => renderView());
  }
  const now = files.get(file)!;
  return (now.stats as T | undefined) ?? (now.failed ? 'missing' : 'loading');
}
