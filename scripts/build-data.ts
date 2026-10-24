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
// Beside data.json go public/stats/<gw>.json, everyone's stats in each of a gameweek's
// matches. A finished season is frozen into public/seasons/<2026-27>.json automatically,
// its stats into public/seasons/<2026-27>/stats/, with a summary for the next season's
// model to start from in public/seasons/model/, and public/seasons/index.json lists every
// season the page can show.

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
import { readSummary, summariseSeason, writeSummary } from '../src/build/last-season.ts';
import {
  buildClubs,
  buildMeta,
  buildPlayers,
  readPrevious,
  seasonName,
  seasonSlug,
  writeIfChanged,
  writeSeasonIndex,
} from '../src/build/output.ts';
import {
  buildPlMatches,
  buildPlSeasonStats,
  buildPlStats,
  fetchFormations,
  fetchMoments,
  readMoments,
} from '../src/build/premier-league.ts';
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
const fetched = await fetchLeague(LEAGUE_ID, CACHE_DIR);
// Last season's summary, which the model's shares and club ratings start from.
const season = readSeason(fetched, await readSummary(SEASONS_DIR, seasonName(fetched.boot.events.data, 1)));
// The real matches' formations, from the Premier League's match centre (once per match).
const formations = await fetchFormations(season, previous, CACHE_DIR);

const { managers, managerIds, entryByLeagueEntry } = buildManagers(season);
const matches = buildMatches(season, entryByLeagueEntry);
const lineups = buildLineups(season, matches, formations);
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
  ...buildUnderlying(season, lineups),
  plMatches: buildPlMatches(season, formations),
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

// Everyone's stats in each match and what happened in it when, a file per gameweek, which
// the Premier League's player stats and a match's commentary load when they're opened, and
// the season's so far, for its Players tab.
// Moments asked for after full time stay as the last build's files had them (on the live
// site, the deploy downloads them first).
const STATS_DIR = path.join(path.dirname(OUT_FILE), 'stats');
const moments = await fetchMoments(season, await readMoments(STATS_DIR), CACHE_DIR);
const plStats = buildPlStats(season, data.plMatches ?? [], moments);
const plSeason = buildPlSeasonStats(season, model.upcoming);
const writeStats = async (dir: string) => {
  await mkdir(dir, { recursive: true });
  for (const s of plStats) await writeIfChanged(path.join(dir, `${s.gw}.json`), s);
  await writeIfChanged(path.join(dir, 'season.json'), plSeason);
};
await writeStats(STATS_DIR);

await mkdir(SEASONS_DIR, { recursive: true });
const seasonOver = season.events.length > 0 && season.events.every((e) => e.finished);
if (seasonOver || args.archive) {
  const archive = path.join(SEASONS_DIR, `${seasonSlug(data.meta.season)}.json`);
  if (await writeIfChanged(archive, data)) console.log(`Archived ${data.meta.season} to ${archive}.`);
  await writeStats(path.join(SEASONS_DIR, seasonSlug(data.meta.season), 'stats'));
  if (await writeSummary(SEASONS_DIR, summariseSeason(season, data.meta.season)))
    console.log(`Summed up ${data.meta.season} for next season's model.`);
}
await writeSeasonIndex(SEASONS_DIR, OUT_FILE, data.meta);
