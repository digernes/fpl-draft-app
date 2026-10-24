// Players, clubs and the meta block of data.json, and writing it (plus the season
// archive and index) only when something really changed.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { ById, Club, Data, Lineup, Meta, Player, SeasonEntry, SeasonIndex, XpParts } from '../shared/data.ts';
import { DGW_PENALTY, FORM_LENGTH, KIT_COLORS, ODDS_OVERROUND, POSITIONS, SCHEMA } from './config.ts';
import type { Season } from './season.ts';
import { round } from './util.ts';

export function buildPlayers(
  season: Season,
  draftPlayers: number[],
  lineups: ById<ById<Lineup>>,
  expected: (pid: number) => number,
  fpl?: (pid: number) => number,
  parts?: (pid: number) => XpParts | undefined,
  ahead: { points: (pid: number) => number; parts: (pid: number) => XpParts | undefined }[] = [],
): ById<Player> {
  const { elements, ownerNow, transactions, trades, gws, pointsIn } = season;
  // Only players in the league's story get their points gameweek by gameweek.
  const referenced = new Set([
    ...ownerNow.keys(),
    ...draftPlayers,
    ...transactions.flatMap((t) => [t.element_in, t.element_out]),
    ...trades.flatMap((tr) => tr.tradeitem_set.flatMap((it) => [it.element_in, it.element_out])),
    ...Object.values(lineups).flatMap((byGw) => Object.values(byGw).flatMap((l) => [...l.xi, ...l.bench])),
  ]);
  const players: ById<Player> = {};
  for (const el of [...elements.values()].sort((a, b) => a.id - b.id)) {
    const pid = el.id;
    players[pid] = {
      name: el.web_name,
      full: `${el.first_name} ${el.second_name}`,
      pos: POSITIONS[el.element_type],
      club: el.team,
      code: el.code,
      total: el.total_points,
      ...(referenced.has(pid) ? { pts: gws.map((gw) => pointsIn(pid, gw)) } : {}),
      owner: ownerNow.get(pid) ?? null,
      status: el.status,
      ...(el.news ? { news: el.news } : {}),
      ep: round(expected(pid), 1),
      ...(fpl ? { fpl: round(fpl(pid), 1) } : {}),
      ...withParts(ownerNow.has(pid) && round(expected(pid), 1) > 0 ? parts?.(pid) : undefined),
      ...(ownerNow.has(pid) && ahead.length
        ? {
            ahead: ahead.map((a) => ({
              ep: round(a.points(pid), 1),
              ...withParts(round(a.points(pid), 1) > 0 ? a.parts(pid) : undefined),
            })),
          }
        : {}),
    };
  }
  return players;
}

// In tenths, as the tooltip shows them.
const withParts = (parts: XpParts | undefined) => (parts ? { parts: parts.map((v) => round(v, 1)) as XpParts } : {});

export function buildClubs(season: Season): ById<Club> {
  return Object.fromEntries(
    season.boot.teams.map((t) => [
      t.id,
      {
        name: t.name,
        short: t.short_name,
        logo: `https://resources.premierleague.com/premierleague/badges/t${t.code}.svg`,
        kit: KIT_COLORS[t.code] ?? null,
      },
    ]),
  );
}

/** The season of these gameweeks, as "2026/27", from its first deadline; or the one `back` seasons before it. */
export function seasonName(events: { deadline_time: string }[], back = 0): string {
  const start = new Date(events[0]?.deadline_time ?? new Date().toISOString()).getUTCFullYear() - back;
  return `${start}/${String(start + 1).slice(-2)}`;
}

export function buildMeta(season: Season, leagueId: number, hasProjections: boolean): Meta {
  const { league, events, currentGw, game, lastFinishedGw, nextGw, nextEvent, scoring, formation, xiLimits } = season;
  return {
    schema: SCHEMA,
    generatedAt: new Date().toISOString(),
    leagueId,
    name: league.name,
    season: seasonName(events),
    tz: league.draft_tz_show || 'Europe/London',
    firstGw: league.start_event,
    lastGw: league.stop_event,
    currentGw,
    currentGwFinished: game.current_event_finished,
    lastFinishedGw,
    nextGw,
    nextDeadline: nextEvent?.deadline_time ?? null,
    nextWaivers: nextEvent?.waivers_time ?? null,
    nextTrades: nextEvent?.trades_time ?? null,
    scoring: { win: scoring.h2h_win, draw: scoring.h2h_draw, loss: scoring.h2h_lose },
    dgwPenalty: DGW_PENALTY,
    formLength: FORM_LENGTH,
    oddsOverround: ODDS_OVERROUND,
    hasProjections,
    formation,
    xiLimits,
  };
}

/** The last build's output, if there is one. */
export async function readPrevious(file: string): Promise<Partial<Data> | null> {
  return readFile(file, 'utf8').then(
    (text) => JSON.parse(text) as Partial<Data>,
    () => null,
  );
}

// The current season is always data.json; finished ones are frozen copies in seasons/.
export async function writeSeasonIndex(seasonsDir: string, outFile: string, current: Meta): Promise<void> {
  const files = (await readdir(seasonsDir))
    .filter((f) => /^\d{4}-\d{2}\.json$/.test(f))
    .sort()
    .reverse();
  const seasons: SeasonEntry[] = [{ season: current.season, name: current.name, file: path.basename(outFile), current: true }];
  for (const file of files) {
    const { meta } = JSON.parse(await readFile(path.join(seasonsDir, file), 'utf8')) as {
      meta: Partial<Meta> & Pick<Meta, 'season' | 'name'>;
    };
    if (meta.season !== current.season)
      seasons.push({ season: meta.season, name: meta.name, file: `seasons/${file}`, schema: meta.schema ?? 0 });
  }
  await writeIfChanged(path.join(seasonsDir, 'index.json'), { seasons } satisfies SeasonIndex);
}

// Rewrites the file only when something other than the timestamp changed, so the
// scheduled job only commits and deploys real changes.
export async function writeIfChanged(file: string, data: object): Promise<boolean> {
  const comparable = (d: unknown) => {
    const meta = (d as { meta?: object } | null)?.meta;
    return JSON.stringify(meta ? { ...(d as object), meta: { ...meta, generatedAt: null } } : d);
  };
  const previous: unknown = await readFile(file, 'utf8').then(JSON.parse, () => null);
  if (previous && comparable(previous) === comparable(data)) return false;
  await writeFile(file, JSON.stringify(data));
  return true;
}

export function seasonSlug(season: string): string {
  return season.replace('/', '-');
}
