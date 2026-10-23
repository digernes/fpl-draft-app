#!/usr/bin/env node
// Builds public/data.json for the FotMob Draft League page.
//
// Everything comes from the public FPL Draft API (no login needed), plus the main
// FPL game's bootstrap, whose expected points stand in for the site's own (src/model)
// until a gameweek has been played. Node 24+ (it runs the TypeScript directly). The
// pieces live in src/build/.
//
//   node scripts/build-data.ts                         league 23793 -> public/data.json
//   node scripts/build-data.ts --league 12345 --out public/data.json
//   node scripts/build-data.ts --cache .cache          reuse raw API responses (local dev)
//   node scripts/build-data.ts --archive               freeze the season into seasons/ now
//
// A finished season is frozen into public/seasons/<2026-27>.json automatically, and
// public/seasons/index.json lists every season the page can show.

import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import type { Data } from '../src/shared/data.ts';
import { fetchLeague } from '../src/build/api.ts';
import { buildDraft } from '../src/build/draft.ts';
import { buildGameweeks, buildRecords } from '../src/build/gameweeks.ts';
import {
  buildEvents,
  buildLineups,
  buildLiveData,
  buildUnderlying,
  buildManagers,
  buildMatches,
  lineupOf,
  patchLiveScores,
} from '../src/build/lineups.ts';
import { deadlineFlags } from '../src/build/expected.ts';
import { oddsModel, priceMatches } from '../src/build/odds.ts';
import { buildClubs, buildMeta, buildPlayers, readPrevious, seasonSlug, writeIfChanged, writeSeasonIndex } from '../src/build/output.ts';
import { readSeason } from '../src/build/season.ts';
import { simulate } from '../src/build/simulation.ts';
import {
  buildPointsTable,
  buildResults,
  buildSeasonStats,
  buildTables,
  premierLeagueTable,
  premierLeagueTwins,
} from '../src/build/tables.ts';
import { buildTransfers } from '../src/build/transfers.ts';
import { parseArgs } from '../src/build/util.ts';

const args = parseArgs(process.argv.slice(2));
const arg = (name: string) => (typeof args[name] === 'string' ? args[name] : undefined);
const LEAGUE_ID = Number(arg('league') ?? process.env.LEAGUE_ID ?? 23793);
const OUT_FILE = arg('out') ?? 'public/data.json';
const CACHE_DIR = arg('cache') ?? null;
const SEASONS_DIR = path.join(path.dirname(OUT_FILE), 'seasons');

// The last build's output: started matches keep the odds it priced them at, and the
// gameweek being played FPL's expected points as they were at the deadline, while it
// is FPL's that are in use.
const previous = await readPrevious(OUT_FILE);
const season = readSeason(await fetchLeague(LEAGUE_ID, CACHE_DIR));

const { managers, managerIds, entryByLeagueEntry } = buildManagers(season);
const matches = buildMatches(season, entryByLeagueEntry);
const lineups = buildLineups(season, matches);
const lineup = lineupOf(lineups);
patchLiveScores(matches, lineup);

const results = buildResults(managerIds, matches);
const { overall, form, luck, xg, scoresByGw } = buildTables(season, managerIds, entryByLeagueEntry, matches, results, lineup);
const seasonStats = buildSeasonStats(season, managerIds, results, lineup);
const plTable = premierLeagueTable(
  season.gws.flatMap((gw) => season.live[gw].fixtures),
  season.boot.teams,
);
const { candidates, topGameweeks, worstGameweeks } = buildGameweeks(season, managerIds, matches, lineup);
const records = buildRecords(season, managerIds, matches, candidates, seasonStats, lineup);
const waiverOrder = [...managers].sort((a, b) => a.waiverPick - b.waiverPick).map((m) => m.id);
const transfers = buildTransfers(season, managerIds, waiverOrder, lineup);
const draft = buildDraft(season, managerIds, lineup);
const model = oddsModel(season, managerIds, scoresByGw);
priceMatches(matches, model, season.nextGw, previous);
const simulation = simulate(season, managerIds, matches, overall, model);

const data: Data = {
  meta: buildMeta(season, LEAGUE_ID, model.hasProjections),
  managers,
  clubs: buildClubs(season),
  gameweeks: season.events.map((e) => {
    const fixtures = season.boot.fixtures?.[e.id];
    return {
      id: e.id,
      deadline: e.deadline_time,
      finished: e.finished,
      doubles: season.doubleClubs[e.id] ?? [],
      ...(fixtures ? { fixtures: fixtures.map((f): [number, number, string | null] => [f.team_h, f.team_a, f.kickoff_time ?? null]) } : {}),
    };
  }),
  matches,
  tables: { overall, form, xg, luck, points: buildPointsTable(seasonStats), premierLeague: plTable },
  simulation,
  plTwins: premierLeagueTwins(overall, plTable),
  lineups,
  events: buildEvents(season, lineups),
  underlying: buildUnderlying(season, lineups),
  flags: deadlineFlags(season, previous),
  live: buildLiveData(
    season,
    lineups,
    { now: model.expectedNow, fromFpl: model.fromFpl, fplNow: model.fplNow, parts: model.partsNow },
    previous,
  ),
  topGameweeks,
  worstGameweeks,
  seasonStats,
  records,
  transfers,
  draft,
  players: buildPlayers(
    season,
    draft.picks.map((p) => p.player),
    lineups,
    model.expected,
    model.fromFpl ? undefined : model.fplExpected,
    model.parts,
    model.ahead,
  ),
};

const { currentGw, game } = season;
if (await writeIfChanged(OUT_FILE, data)) {
  console.log(
    `Wrote ${OUT_FILE}: ${managers.length} managers, GW${currentGw}${game.current_event_finished ? ' (finished)' : ' (live)'}, ` +
      `${transfers.moves.length} moves, ${Object.keys(data.players).length} players${model.hasProjections ? '' : ', no projections'}.`,
  );
} else {
  console.log(`No changes for GW${currentGw}; ${OUT_FILE} left as is.`);
}

await mkdir(SEASONS_DIR, { recursive: true });
const seasonOver = season.events.length > 0 && season.events.every((e) => e.finished);
if (seasonOver || args.archive) {
  const archive = path.join(SEASONS_DIR, `${seasonSlug(data.meta.season)}.json`);
  if (await writeIfChanged(archive, data)) console.log(`Archived ${data.meta.season} to ${archive}.`);
}
await writeSeasonIndex(SEASONS_DIR, OUT_FILE, data.meta);
