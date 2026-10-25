// Cloudflare Worker that relays the FPL Draft API's live parts to the page. Browsers
// can't call the FPL API directly (no CORS), so this fetches it, slims it down and adds
// CORS headers. It answers only these, so it can't be used as a general proxy:
//
//   /live/<gameweek>         live scores, slimmed from ~450 KB to a few KB, with everyone's
//                            stats in the matches being played and their moments from the
//                            Premier League's match centre, so the page needn't wait for a build
//   /transfers               this league's moves, trades and owners, between builds
//   /poll/…                  a head-to-head's Who will win? votes, and a vote (poll.ts)
//   /in-play/<season>/<gw>   each head-to-head's live win chance, recorded every minute while
//                            the gameweek's matches are on (in-play.ts)
//
// Its timer fires every minute: it records the win chance when a match is on (in-play.ts)
// and starts the data build on its own cadence and after transfers (timer.ts). Deploy with
// `npx wrangler deploy` from this folder.

import type { z } from 'zod';

import type { PlMoment } from '../src/shared/data.ts';
import { ElementStatus, LiveFeed, PlEvents, Trades, Transactions } from '../src/shared/fpl-api.ts';
import { momentsOf } from '../src/shared/match-stats.ts';
import { slimTransfers } from '../src/shared/transfers.ts';
import { fplGet, LIVE_SECONDS, recentFixtures, slimFeed, Upstream } from './feed.ts';
import { parseInPlayPath, recordMinute, type InPlayEnv } from './in-play.ts';
import { pollRoute, type PollEnv } from './poll.ts';
import { buildDue, buildFiring, ownersMoved, startBuild, type TimerEnv } from './timer.ts';

const MATCH_CENTRE = 'https://sdp-prem-prod.premier-league-prod.pulselive.com/api/v1/matches';
const TRANSFER_SECONDS = 60;
const IN_PLAY_SECONDS = 30; // a minute's record, give or take
const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// The Durable Object classes, which Cloudflare finds among the main module's exports.
export { Poll } from './poll.ts';
export { InPlay } from './in-play.ts';

interface Env extends TimerEnv, PollEnv, InPlayEnv {
  /** The one league /transfers answers for (wrangler.toml). */
  LEAGUE_ID?: string;
}

const league = (env: Env) => Number(env.LEAGUE_ID ?? 23793);

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const at = new Date(controller.scheduledTime);
    ctx.waitUntil(recordMinute(env, at.getTime()));
    if (!buildFiring(at)) return;
    const due = buildDue(at);
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
    if (url.pathname.startsWith('/poll/')) return pollRoute(request, env, url.pathname, HEADERS);
    const gw = url.pathname.match(/^\/live\/([1-9]|[12]\d|3[0-8])$/)?.[1];
    const inPlay = parseInPlayPath(url.pathname);
    const route = gw ? 'live' : url.pathname === '/transfers' ? 'transfers' : inPlay && env.IN_PLAY ? 'in-play' : null;
    if (request.method !== 'GET' || !route) return new Response('Not found', { status: 404, headers: HEADERS });

    const cache = globalThis.caches?.default;
    const key = new Request(`${url.origin}${url.pathname}`);
    const cached = await cache?.match(key);
    if (cached) return cached;

    const seconds = route === 'live' ? LIVE_SECONDS : route === 'transfers' ? TRANSFER_SECONDS : IN_PLAY_SECONDS;
    let body: object;
    try {
      if (route === 'live') {
        const now = Date.now();
        const feed = await fplGet(`event/${gw}/live`, LiveFeed, seconds);
        body = { at: new Date(now).toISOString(), gw: Number(gw), ...slimFeed(feed, now), moments: await momentsNow(feed, now) };
      } else if (route === 'transfers') {
        const id = league(env);
        const [tx, trades, status] = await Promise.all([
          fplGet(`draft/league/${id}/transactions`, Transactions, seconds),
          fplGet(`draft/league/${id}/trades`, Trades, seconds),
          fplGet(`league/${id}/element-status`, ElementStatus, seconds),
        ]);
        body = { at: new Date().toISOString(), ...slimTransfers(tx.transactions, trades.trades, status.element_status) };
      } else {
        // The records alone, by head-to-head, as the gameweek's object keeps them.
        const stub = env.IN_PLAY!.get(env.IN_PLAY!.idFromName(`${inPlay!.season}:${inPlay!.gw}`));
        const res = await stub.fetch(`https://in-play/records`);
        if (!res.ok) return new Response('The records can’t be read just now', { status: 503, headers: HEADERS });
        body = (await res.json()) as object;
      }
    } catch (err) {
      if (!(err instanceof Upstream)) throw err;
      return new Response(err.message, { status: 502, headers: HEADERS });
    }

    const response = new Response(JSON.stringify(body), {
      headers: { ...HEADERS, 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${seconds}` },
    });
    if (cache) ctx.waitUntil(cache.put(key, response.clone()));
    return response;
  },
};

// The moments of the matches being played or just over. A match whose moments won't come
// goes without them rather than holding up the scores.
async function momentsNow(feed: z.infer<typeof LiveFeed>, now: number) {
  const moments = await Promise.all(recentFixtures(feed, now).map(async (f) => [f.id, f.code ? await momentsAt(f.code) : null] as const));
  return Object.fromEntries(moments.filter(([, list]) => list));
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
