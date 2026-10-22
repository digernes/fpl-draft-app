// Cloudflare Worker that relays the FPL Draft live feed to the page. Browsers can't
// call the FPL API directly (no CORS), so this fetches it, slims it from ~450 KB to a
// few KB and adds CORS headers. It only answers /live/<gameweek>, so it can't be used
// as a general proxy. Deploy with `npx wrangler deploy` from this folder.

import { LiveFeed } from '../src/shared/fpl-api.ts';
import { slimLive } from '../src/shared/live.ts';

const UPSTREAM = 'https://draft.premierleague.com/api/event';
const CACHE_SECONDS = 20; // everyone watching shares one fetch per 20 seconds
const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export default {
  async fetch(request: Request, _env: unknown, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { headers: HEADERS });
    const url = new URL(request.url);
    const gw = url.pathname.match(/^\/live\/([1-9]|[12]\d|3[0-8])$/)?.[1];
    if (request.method !== 'GET' || !gw) return new Response('Not found', { status: 404, headers: HEADERS });

    const cache = globalThis.caches?.default;
    const key = new Request(`${url.origin}/live/${gw}`);
    const cached = await cache?.match(key);
    if (cached) return cached;

    const upstream = await fetch(`${UPSTREAM}/${gw}/live`, {
      cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
    });
    if (!upstream.ok) return new Response(`FPL answered ${upstream.status}`, { status: 502, headers: HEADERS });
    const feed = LiveFeed.safeParse(await upstream.json());
    if (!feed.success) return new Response('FPL answered with an unexpected shape', { status: 502, headers: HEADERS });
    const response = new Response(JSON.stringify({ gw: Number(gw), at: new Date().toISOString(), ...slimLive(feed.data) }), {
      headers: { ...HEADERS, 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${CACHE_SECONDS}` },
    });
    if (cache) ctx.waitUntil(cache.put(key, response.clone()));
    return response;
  },
};
