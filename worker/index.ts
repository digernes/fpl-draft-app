// Cloudflare Worker that relays the FPL Draft API's live parts to the page. Browsers
// can't call the FPL API directly (no CORS), so this fetches it, slims it down and adds
// CORS headers. It answers only two things, so it can't be used as a general proxy:
//
//   /live/<gameweek>   live scores, slimmed from ~450 KB to a few KB
//   /transfers         this league's moves, trades and owners, between builds
//
// It also starts the data build on a timer (timer.ts). Deploy with `npx wrangler deploy`
// from this folder.

import type { z } from 'zod';

import { ElementStatus, LiveFeed, Trades, Transactions } from '../src/shared/fpl-api.ts';
import { slimLive } from '../src/shared/live.ts';
import { slimTransfers } from '../src/shared/transfers.ts';
import { buildDue, startBuild, type TimerEnv } from './timer.ts';

const API = 'https://draft.premierleague.com/api';
const LIVE_SECONDS = 20; // everyone watching shares one fetch per 20 seconds
const TRANSFER_SECONDS = 60;
const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

interface Env extends TimerEnv {
  /** The one league /transfers answers for (wrangler.toml). */
  LEAGUE_ID?: string;
}

class Upstream extends Error {}

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (!buildDue(new Date(controller.scheduledTime))) return;
    ctx.waitUntil(
      startBuild(env).then((res) => {
        if (res && !res.ok) console.error(`GitHub answered ${res.status} when starting the build`);
      }),
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
        body = { gw: Number(gw), ...slimLive(await get(`event/${gw}/live`, LiveFeed)) };
      } else {
        const league = Number(env.LEAGUE_ID ?? 23793);
        const [tx, trades, status] = await Promise.all([
          get(`draft/league/${league}/transactions`, Transactions),
          get(`draft/league/${league}/trades`, Trades),
          get(`league/${league}/element-status`, ElementStatus),
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
