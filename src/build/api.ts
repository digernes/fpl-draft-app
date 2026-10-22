// Fetching from the FPL APIs: retries, an optional on-disk cache for local runs, and a
// Zod parse of every response, so a change on FPL's side stops the build with a clear
// message instead of quietly writing wrong numbers.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'zod';

import * as api from '../shared/fpl-api.ts';
import { mapPool, range } from './util.ts';

const DRAFT_API = 'https://draft.premierleague.com/api';
const FPL_API = 'https://fantasy.premierleague.com/api';

export interface Fetched {
  details: api.LeagueDetails;
  boot: api.Bootstrap;
  game: api.Game;
  transactions: api.Transaction[];
  trades: api.Trade[];
  choices: api.DraftChoice[];
  /** player → manager who owns him now */
  ownerNow: Map<number, number>;
  /** The main FPL game's bootstrap, for next-gameweek projections; null if it failed. */
  fplBoot: api.FplBootstrap | null;
  /** Live feed by gameweek, for every gameweek so far. */
  live: Record<number, api.LiveFeed>;
  /** Picks by entry, then gameweek. */
  picks: Record<number, Record<number, api.EntryPicks>>;
}

export async function fetchLeague(leagueId: number, cacheDir: string | null): Promise<Fetched> {
  if (cacheDir) await mkdir(cacheDir, { recursive: true });
  const get = <S extends z.ZodType>(url: string, schema: S) => getJSON(url, schema, cacheDir);
  const getOptional = <S extends z.ZodType>(url: string, schema: S) => getJSON(url, schema, cacheDir, { optional: true });

  const [details, boot, game, txRes, tradeRes, choiceRes, statusRes, fplBoot] = await Promise.all([
    get(`${DRAFT_API}/league/${leagueId}/details`, api.LeagueDetails),
    get(`${DRAFT_API}/bootstrap-static`, api.Bootstrap),
    get(`${DRAFT_API}/game`, api.Game),
    get(`${DRAFT_API}/draft/league/${leagueId}/transactions`, api.Transactions),
    get(`${DRAFT_API}/draft/league/${leagueId}/trades`, api.Trades),
    get(`${DRAFT_API}/draft/${leagueId}/choices`, api.DraftChoices),
    get(`${DRAFT_API}/league/${leagueId}/element-status`, api.ElementStatus),
    getOptional(`${FPL_API}/bootstrap-static/`, api.FplBootstrap),
  ]);

  const { league } = details;
  const currentGw = Math.min(game.current_event ?? 0, league.stop_event);
  const gws = range(league.start_event, currentGw);

  const live: Fetched['live'] = {};
  await mapPool(gws, 4, async (gw) => {
    live[gw] = await get(`${DRAFT_API}/event/${gw}/live`, api.LiveFeed);
  });
  const entries = details.league_entries.flatMap((e) => (e.entry_id ? [e.entry_id] : []));
  const picks: Fetched['picks'] = {};
  await mapPool(
    entries.flatMap((entry) => gws.map((gw) => [entry, gw] as const)),
    6,
    async ([entry, gw]) => {
      const res = await getOptional(`${DRAFT_API}/entry/${entry}/event/${gw}`, api.EntryPicks);
      if (res) (picks[entry] ??= {})[gw] = res;
    },
  );

  return {
    details,
    boot,
    game,
    transactions: txRes.transactions,
    trades: tradeRes.trades,
    choices: choiceRes.choices,
    ownerNow: new Map(statusRes.element_status.flatMap((s) => (s.owner ? [[s.element, s.owner] as const] : []))),
    fplBoot,
    live,
    picks,
  };
}

async function getJSON<S extends z.ZodType>(url: string, schema: S, cacheDir: string | null): Promise<z.infer<S>>;
async function getJSON<S extends z.ZodType>(
  url: string,
  schema: S,
  cacheDir: string | null,
  options: { optional: true },
): Promise<z.infer<S> | null>;
async function getJSON<S extends z.ZodType>(
  url: string,
  schema: S,
  cacheDir: string | null,
  { optional = false } = {},
): Promise<z.infer<S> | null> {
  const json = await fetchJSON(url, cacheDir, optional);
  if (json === null) return null;
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5).map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Unexpected response from ${url}:\n${issues.join('\n')}`);
  }
  return parsed.data;
}

async function fetchJSON(url: string, cacheDir: string | null, optional: boolean): Promise<unknown> {
  const cacheFile = cacheDir && path.join(cacheDir, `${url.replace(/^https:\/\//, '').replace(/\W+/g, '_')}.json`);
  if (cacheFile) {
    const cached = await readFile(cacheFile, 'utf8').catch(() => null);
    if (cached) return JSON.parse(cached);
  }
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const json: unknown = await res.json();
        if (cacheFile) await writeFile(cacheFile, JSON.stringify(json));
        return json;
      }
      lastError = new Error(`HTTP ${res.status} for ${url}`);
      if (res.status !== 429 && res.status < 500) break; // a 4xx will not get better
    } catch (err) {
      lastError = err;
    }
    if (attempt < 4) await new Promise((r) => setTimeout(r, attempt * 1500));
  }
  if (optional) {
    console.warn(`! Skipping ${url}: ${lastError instanceof Error ? lastError.message : lastError}`);
    return null;
  }
  throw lastError;
}
