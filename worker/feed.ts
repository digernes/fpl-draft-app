// The FPL Draft API as the Worker reads it, and the slim live feed it makes of a gameweek's:
// what /live/<gw> relays (index.ts) and what the recorder works the live odds out from
// (in-play.ts), so both see the same.

import type { z } from 'zod';

import { LiveFeed } from '../src/shared/fpl-api.ts';
import { slimLive, type SlimLive } from '../src/shared/live.ts';
import { matchRows, playedIn } from '../src/shared/match-stats.ts';

export const API = 'https://draft.premierleague.com/api';
export const LIVE_SECONDS = 20; // everyone watching, and the recorder, share one fetch per 20 seconds
// A match is passed on from kick-off to full time, and on until this long after kick-off,
// time enough for a build after full time to have it in the gameweek's stats file. (The
// Draft feed's `finished` waits for the whole gameweek.)
export const RECENT_MS = 150 * 60 * 1000;

/** FPL didn't answer, or not as expected. */
export class Upstream extends Error {}

/** An FPL Draft API path, parsed with its schema, through Cloudflare's cache for `seconds`. */
export async function fplGet<S extends z.ZodType>(path: string, schema: S, seconds: number): Promise<z.infer<S>> {
  const res = await fetch(`${API}/${path}`, { cf: { cacheTtl: seconds, cacheEverything: true } });
  if (!res.ok) throw new Upstream(`FPL answered ${res.status}`);
  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) throw new Upstream('FPL answered with an unexpected shape');
  return parsed.data;
}

/** The matches being played or just over (kicked off, and not over or within RECENT_MS of kick-off). */
export const recentFixtures = (feed: z.infer<typeof LiveFeed>, now: number) =>
  feed.fixtures.filter((f) => f.started && (!f.finished_provisional || now - Date.parse(f.kickoff_time ?? '') < RECENT_MS));

/** A gameweek's live feed slimmed, with everyone's stats in the matches being played or just over (`matches`). */
export function slimFeed(feed: z.infer<typeof LiveFeed>, now: number): SlimLive & Required<Pick<SlimLive, 'matches'>> {
  const matches = Object.fromEntries(recentFixtures(feed, now).map((f) => [f.id, matchRows(feed, f.id, playedIn(feed, f.id))]));
  return { ...slimLive(feed), matches };
}

/** A gameweek's live feed from FPL, slimmed (slimFeed). */
export const liveFeed = async (gw: number, now: number) => slimFeed(await fplGet(`event/${gw}/live`, LiveFeed, LIVE_SECONDS), now);
