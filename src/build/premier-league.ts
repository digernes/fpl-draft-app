// The real Premier League, match by match: the whole season's fixtures, and for each one
// that has kicked off its score and who played, for how long and for how many FPL points,
// and what each of them did; and, from the Premier League's own match centre, both
// formations once the lineups are out. The Premier League pages show it, and the draft
// pages use it for a match's momentum and a player's match log. Everyone's full FPL stats
// in each match go in a file per gameweek instead (buildPlStats).

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { type ById, type Data, type PlFormation, type PlLine, type PlMatch, type PlMoment, type PlStats } from '../shared/data.ts';
import { PlEvents, PlLineups, type Fixture, type LiveFeed } from '../shared/fpl-api.ts';
import type { PlayerEvents } from '../shared/live.ts';
import { matchRows, momentsOf } from '../shared/match-stats.ts';
import { fetchOptional } from './api.ts';
import type { Season } from './season.ts';
import { mapPool, sum } from './util.ts';

type FeedFixture = LiveFeed['fixtures'][number];
type FeedElement = LiveFeed['elements'][string];
type Formations = Map<number, [PlFormation, PlFormation]>;

const MATCH_CENTRE = 'https://sdp-prem-prod.premier-league-prod.pulselive.com/api/v1/matches';
const LINEUPS_OUT = 2 * 60 * 60 * 1000; // they're announced an hour or so before kick-off

// A match's formations come once, when its lineups are out (from two hours before kick-off
// on), and are kept from the last build after that, so a build asks only for the matches
// about to start or under way without them.
export async function fetchFormations(season: Season, previous: Partial<Data> | null, cacheDir: string | null): Promise<Formations> {
  const kept: Formations = new Map((previous?.plMatches ?? []).flatMap((m) => (m.formations ? [[m.id, m.formations] as const] : [])));
  const teamByCode = new Map(season.boot.teams.map((t) => [t.code, t.id]));
  const elementByCode = new Map([...season.elements.values()].map((el) => [el.code, el.id]));
  const soon = Date.now() + LINEUPS_OUT;
  const wanted = [
    ...season.gws.flatMap((gw) => season.live[gw]?.fixtures ?? []),
    ...season.events.filter((e) => e.id > season.currentGw).flatMap((e) => season.fixturesIn(e.id)),
  ].filter((f) => f.code && !kept.has(f.id) && (f.started || (f.kickoff_time && new Date(f.kickoff_time).getTime() < soon)));
  await mapPool(wanted, 4, async (f) => {
    const teams = await fetchOptional(`${MATCH_CENTRE}/${f.code}/lineups`, PlLineups, cacheDir);
    const side = (club: number) => teams?.find((t) => teamByCode.get(Number(t.teamId)) === club);
    const [home, away] = [side(f.team_h), side(f.team_a)];
    if (!home?.lineup.length || !away?.lineup.length) return;
    const ids = (codes: string[]) => codes.flatMap((c) => elementByCode.get(Number(c)) ?? []);
    const formation = (t: typeof home): PlFormation => ({
      shape: t.formation ?? '',
      lines: t.lineup.map(ids).filter((line) => line.length),
      subs: ids(t.subs ?? []),
    });
    kept.set(f.id, [formation(home), formation(away)]);
  });
  return kept;
}

/** A match's moments, and whether they were asked for after full time. */
export type Moments = Map<number, { list: PlMoment[]; final: boolean }>;

// What happened in each match and when, from the match centre: asked for at every build
// while a match is on and once after full time, then kept from the last build's stats
// files (`kept`).
export async function fetchMoments(season: Season, kept: Moments, cacheDir: string | null): Promise<Moments> {
  const out: Moments = new Map();
  const elementByCode = new Map([...season.elements.values()].map((el) => [el.code, el.id]));
  const pid = (code: string | null | undefined) => (code ? elementByCode.get(Number(code)) : undefined);
  const fixtures = season.gws.flatMap((gw) => season.live[gw]?.fixtures ?? []).filter((f) => f.started && f.code);
  await mapPool(fixtures, 4, async (f) => {
    const had = kept.get(f.id);
    // A match whose events won't read keeps the ones it had, rather than stopping the build.
    const events = had?.final
      ? null
      : await fetchOptional(`${MATCH_CENTRE}/${f.code}/events`, PlEvents, cacheDir).catch((err: unknown) => {
          console.warn(`! Skipping the events of match ${f.id}: ${err instanceof Error ? err.message.split('\n')[0] : err}`);
          return null;
        });
    if (!events) {
      if (had) out.set(f.id, had);
      return;
    }
    out.set(f.id, { list: momentsOf(events, pid), final: Boolean(f.finished || f.finished_provisional) });
  });
  return out;
}

/** The moments the last build's stats files kept. */
export async function readMoments(dir: string): Promise<Moments> {
  const kept: Moments = new Map();
  for (const file of (await readdir(dir).catch(() => [] as string[])).filter((f) => /^\d+\.json$/.test(f))) {
    const stats = await readFile(path.join(dir, file), 'utf8').then(
      (text) => JSON.parse(text) as PlStats,
      () => null,
    );
    for (const [id, list] of Object.entries(stats?.moments ?? {}))
      kept.set(Number(id), { list, final: stats?.final?.includes(Number(id)) ?? false });
  }
  return kept;
}

export function buildPlMatches(season: Season, formations: Formations = new Map()): PlMatch[] {
  const { gws, live, events, currentGw, fixturesIn, elements } = season;
  const played: PlMatch[] = gws.flatMap((gw) =>
    (live[gw]?.fixtures ?? []).map((f) => fromFeed(f, gw, live[gw], (pid) => elements.get(pid)?.team)),
  );
  const toCome = events
    .filter((e) => e.id > currentGw)
    .flatMap((e) =>
      fixturesIn(e.id).map((f: Fixture): PlMatch => ({ id: f.id, gw: e.id, home: f.team_h, away: f.team_a, ko: f.kickoff_time ?? null })),
    );
  const byKickOff = (a: PlMatch, b: PlMatch) => a.gw - b.gw || (a.ko ?? '~').localeCompare(b.ko ?? '~') || a.id - b.id;
  return [...played, ...toCome].map((m) => (formations.has(m.id) ? { ...m, formations: formations.get(m.id) } : m)).sort(byKickOff);
}

const STARTERS = 11;

export function fromFeed(f: FeedFixture, gw: number, feed: LiveFeed, clubOf: (pid: number) => number | undefined): PlMatch {
  const match: PlMatch = { id: f.id, gw, home: f.team_h, away: f.team_a, ko: f.kickoff_time ?? null };
  if (!f.started) return match;
  const done = f.finished || f.finished_provisional;
  // A player's side: the one the match's BPS list has him on (everyone who plays gets
  // some), or else his club's, which is now's and could be another since a move.
  const side = new Map<number, 0 | 1>();
  for (const s of f.stats ?? []) {
    for (const x of s.h) side.set(x.element, 0);
    for (const x of s.a) side.set(x.element, 1);
  }
  const players = Object.entries(feed.elements).flatMap(([id, el]) => {
    const stats = (el.explain ?? []).filter(([, fixture]) => fixture === f.id).flatMap(([s]) => s);
    const value = (stat: string) => sum(stats.filter((s) => s.stat === stat).map((s) => s.value));
    const scored = (stat: string) => stats.some((s) => s.stat === stat && (s.points ?? 0) > 0);
    const minutes = value('minutes');
    if (!minutes) return [];
    const pid = Number(id);
    return [
      {
        pid,
        minutes,
        value,
        scored,
        el,
        points: sum(stats.map((s) => s.points ?? 0)),
        side: side.get(pid) ?? (clubOf(pid) === f.team_a ? 1 : 0),
      },
    ];
  });
  const lineups: [PlLine[], PlLine[]] = [[], []];
  const events: ById<PlayerEvents> = {};
  for (const team of [0, 1] as const) {
    const mine = players.filter((p) => p.side === team).sort((a, b) => b.minutes - a.minutes);
    // FPL counts starts for the gameweek, not the match, which only matters in a double.
    // Should that not give eleven, the eleven with the most minutes started.
    let starters = new Set(mine.filter((p) => startedIn(p.el, f.id)).map((p) => p.pid));
    if (starters.size !== STARTERS) starters = new Set(mine.slice(0, STARTERS).map((p) => p.pid));
    for (const p of [...mine.filter((x) => starters.has(x.pid)), ...mine.filter((x) => !starters.has(x.pid))]) {
      lineups[team].push([p.pid, p.minutes, p.points, starters.has(p.pid) ? 1 : 0]);
      // Not the substitutions, which the page works out from the minutes.
      const did = Object.entries({
        goals: p.value('goals_scored'),
        assists: p.value('assists'),
        ownGoals: p.value('own_goals'),
        yellow: p.value('yellow_cards'),
        red: p.value('red_cards'),
        pensSaved: p.value('penalties_saved'),
        pensMissed: p.value('penalties_missed'),
        bonus: p.value('bonus'),
        cleanSheet: p.value('clean_sheets'),
        saves: p.value('saves'),
        defcon: p.scored('defensive_contribution') ? 1 : 0,
      } satisfies PlayerEvents).filter(([, n]) => n);
      if (did.length) events[p.pid] = Object.fromEntries(did);
    }
  }
  return {
    ...match,
    score: [f.team_h_score ?? 0, f.team_a_score ?? 0],
    ...(done ? { done: true as const } : {}),
    lineups,
    ...(Object.keys(events).length ? { events } : {}),
  };
}

// Whether he started this match: his gameweek's starts go to his matches with the most minutes.
function startedIn(el: FeedElement, fixture: number) {
  const matches = (el.explain ?? [])
    .map(([stats, id]) => ({ id, minutes: stats.find((s) => s.stat === 'minutes')?.value ?? 0 }))
    .filter((m) => m.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);
  return matches.slice(0, el.stats.starts ?? 0).some((m) => m.id === fixture);
}

/** Everyone's FPL stats in each match that has kicked off, and its moments, a gameweek at a time (see PlStats). */
export function buildPlStats(season: Season, matches: PlMatch[], moments: Moments = new Map()): PlStats[] {
  const byGw = new Map<number, PlStats>();
  for (const m of matches) {
    const feed = season.live[m.gw];
    if (!m.lineups || !feed) continue;
    const gw = byGw.get(m.gw) ?? byGw.set(m.gw, { gw: m.gw, matches: {} }).get(m.gw)!;
    gw.matches[m.id] = matchRows(
      feed,
      m.id,
      m.lineups.flat().map(([pid]) => pid),
    );
    const happened = moments.get(m.id);
    if (happened) {
      (gw.moments ??= {})[m.id] = happened.list;
      if (happened.final) (gw.final ??= []).push(m.id);
    }
  }
  return [...byGw.values()];
}
