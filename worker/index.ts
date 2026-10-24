// Cloudflare Worker that relays the FPL Draft API's live parts to the page. Browsers
// can't call the FPL API directly (no CORS), so this fetches it, slims it down and adds
// CORS headers. It answers only two things, so it can't be used as a general proxy:
//
//   /live/<gameweek>   live scores, slimmed from ~450 KB to a few KB, with everyone's
//                      stats in the matches being played and their moments from the
//                      Premier League's match centre, so the page needn't wait for a build
//   /transfers         this league's moves, trades and owners, between builds
//
// It also starts the data build on a timer and after transfers (timer.ts). Deploy with
// `npx wrangler deploy` from this folder.

import type { z } from 'zod';

import type { PlMoment } from '../src/shared/data.ts';
import { ElementStatus, LiveFeed, PlEvents, Trades, Transactions } from '../src/shared/fpl-api.ts';
import { slimLive } from '../src/shared/live.ts';
import { matchRows, momentsOf, playedIn } from '../src/shared/match-stats.ts';
import { slimTransfers } from '../src/shared/transfers.ts';
import { buildDue, ownersMoved, startBuild, type TimerEnv } from './timer.ts';

const API = 'https://draft.premierleague.com/api';
const MATCH_CENTRE = 'https://sdp-prem-prod.premier-league-prod.pulselive.com/api/v1/matches';
const LIVE_SECONDS = 20; // everyone watching shares one fetch per 20 seconds
// A match is passed on from kick-off to full time, and on until this long after kick-off,
// time enough for a build after full time to have it in the gameweek's stats file. (The
// Draft feed's `finished` waits for the whole gameweek.)
const RECENT_MS = 150 * 60 * 1000;
const TRANSFER_SECONDS = 60;
const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

interface Env extends TimerEnv {
  /** The one league /transfers answers for (wrangler.toml). */
  LEAGUE_ID?: string;
}

const league = (env: Env) => Number(env.LEAGUE_ID ?? 23793);

class Upstream extends Error {}

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const due = buildDue(new Date(controller.scheduledTime));
    ctx.waitUntil(
      (async () => {
        if (!due && !(await ownersMoved(env, league(env)))) return;
        const res = await startBuild(env);
        if (res && !res.ok) console.error(`GitHub answered ${res.status} when starting the build`);
      })(),
    );
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { headers: HEADERS });
    const url = new URL(request.url);
    const gw = url.pathname.match(/^\/live\/([1-9]|[12]\d|3[0-8])$/)?.[1];
    const route = gw ? 'live' : url.pathname === '/transfers' ? 'transfers' : null;
    if (request.method !== 'GET' || !route) return new Response('Not found', { status: 404, headers: HEADERS });

    const cache = globalThis.caches?.default;
    const key = new Request(`${url.origin}${url.pathname}`);
    const cached = await cache?.match(key);
    if (cached) return cached;

    const seconds = route === 'live' ? LIVE_SECONDS : TRANSFER_SECONDS;
    const get = async <S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S>> => {
      const res = await fetch(`${API}/${path}`, { cf: { cacheTtl: seconds, cacheEverything: true } });
      if (!res.ok) throw new Upstream(`FPL answered ${res.status}`);
      const parsed = schema.safeParse(await res.json());
      if (!parsed.success) throw new Upstream('FPL answered with an unexpected shape');
      return parsed.data;
    };

    let body: object;
    try {
      if (route === 'live') {
        const feed = await get(`event/${gw}/live`, LiveFeed);
        body = { gw: Number(gw), ...slimLive(feed), ...(await matchesNow(feed)) };
      } else {
        const id = league(env);
        const [tx, trades, status] = await Promise.all([
          get(`draft/league/${id}/transactions`, Transactions),
          get(`draft/league/${id}/trades`, Trades),
          get(`league/${id}/element-status`, ElementStatus),
        ]);
        body = slimTransfers(tx.transactions, trades.trades, status.element_status);
      }
    } catch (err) {
      if (!(err instanceof Upstream)) throw err;
      return new Response(err.message, { status: 502, headers: HEADERS });
    }

    const response = new Response(JSON.stringify({ at: new Date().toISOString(), ...body }), {
      headers: { ...HEADERS, 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${seconds}` },
    });
    if (cache) ctx.waitUntil(cache.put(key, response.clone()));
    return response;
  },
};

// The matches being played or just over: everyone's stats in each, and its moments. A
// match whose moments won't come goes without them rather than holding up the scores.
async function matchesNow(feed: z.infer<typeof LiveFeed>, now = Date.now()) {
  const recent = feed.fixtures.filter((f) => f.started && (!f.finished_provisional || now - Date.parse(f.kickoff_time ?? '') < RECENT_MS));
  const matches = Object.fromEntries(recent.map((f) => [f.id, matchRows(feed, f.id, playedIn(feed, f.id))]));
  const moments = await Promise.all(recent.map(async (f) => [f.id, f.code ? await momentsAt(f.code) : null] as const));
  return { matches, moments: Object.fromEntries(moments.filter(([, list]) => list)) };
}

// Its players by their codes, as the match centre has them: the page knows their ids.
async function momentsAt(code: number): Promise<PlMoment[] | null> {
  try {
    const res = await fetch(`${MATCH_CENTRE}/${code}/events`, { cf: { cacheTtl: LIVE_SECONDS, cacheEverything: true } });
    const parsed = res.ok ? PlEvents.safeParse(await res.json()) : null;
    return parsed?.success ? momentsOf(parsed.data, (c) => (c ? Number(c) : undefined)) : null;
  } catch {
    return null;
  }
}
