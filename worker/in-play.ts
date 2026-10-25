// The live win chance, recorded every minute while a gameweek's Premier League matches are
// played, for the momentum card: one Durable Object per gameweek (named <season>:<gw>) keeps
// each head-to-head's records, and the data build copies them into data.json.
//
//   GET /in-play/<season>/<gw>   { "<home>-<away>": InPlayRecord[] }
//
// The timer fires every minute (index.ts). It asks only FPL Draft's game state, kept a while,
// which gameweek is being played: while one is (current and not finished), it hands the minute
// to the gameweek's object, one request a minute. (FPL's main game, whose fixtures would tell
// the kick-offs, turns Cloudflare's addresses away.) The object reads the relay's own slim live
// feed, which /live shares, and records only while a match is on (from kick-off until RECENT_MS
// after it, as /live has them); in a minute with nothing on it writes nothing. When one is, it
// works out each head-to-head's live odds from the site's data.json (kept five minutes) and the
// feed, with the same code as the page's live odds and the build's records (shared/in-play.ts),
// and keeps them as the build does (withRecord). The object does the work rather than the
// timer, as a Durable Object has 30 seconds of CPU a request where the Free plan gives a timer
// 10 ms.

import type { InPlayRecord } from '../src/shared/data.ts';
import { recordsNow, withRecord, type RecordData } from '../src/shared/in-play.ts';
import { API, liveFeed, Upstream } from './feed.ts';

export interface InPlayEnv {
  /** The gameweeks' Durable Objects (wrangler.toml). */
  IN_PLAY?: DurableObjectNamespace;
  /** The deployed site, whose data.json has the lineups and the expected points. */
  SITE_URL?: string;
}

const GAME = `${API}/game`;
const GAME_MS = 5 * 60 * 1000; // a deadline passing, or the gameweek finishing, reaches the timer within five minutes
const SITE_MS = 5 * 60 * 1000; // data.json changes about every ten minutes while matches are on

/** A gameweek's address among the relay's routes and the Durable Objects: its season's slug ("2026-27") and its number. */
export interface Gameweek {
  season: string;
  gw: number;
}

/** A gameweek's records on the relay: /in-play/<season>/<gw>, if the path is one. */
export function parseInPlayPath(path: string): Gameweek | null {
  const m = path.match(/^\/in-play\/(20\d\d-\d\d)\/([1-9]|[12]\d|3[0-8])$/);
  return m ? { season: m[1], gw: Number(m[2]) } : null;
}

/** The season a moment falls in, as data.json's meta has it but slugged: they start in August, and none runs into July. */
export function seasonAt(at: number): string {
  const date = new Date(at);
  const start = date.getUTCFullYear() - (date.getUTCMonth() < 6 ? 1 : 0);
  return `${start}-${String(start + 1).slice(-2)}`;
}

// What the timer looked up last, in this isolate: it may be a new one next minute, when it
// asks again (a few hundred bytes, through Cloudflare's cache).
let game: { at: number; gw: number | null; finished: boolean } | undefined;

/** Forget what the timer looked up (for the tests). */
export function forgetLookups() {
  game = undefined;
}

// Read without a schema library, which the timer's 10 ms needn't spend on: only what it uses.
async function getJson(url: string, seconds: number): Promise<unknown> {
  const res = await fetch(url, { cf: { cacheTtl: seconds, cacheEverything: true } });
  return res.ok ? res.json() : null;
}

function gameState(body: unknown) {
  const { current_event: gw, current_event_finished: finished } = (body ?? {}) as Record<string, unknown>;
  return (Number.isInteger(gw) || gw === null) && typeof finished === 'boolean' ? { gw: gw as number | null, finished } : null;
}

/**
 * The gameweek being played at `now` (ms), from its deadline until FPL calls it finished, or
 * null: FPL Draft's game state, kept GAME_MS. Whether any of its matches is on is the
 * gameweek's object's to say, from the live feed. None whenever FPL can't be asked.
 */
export async function gameweekNow(now: number): Promise<Gameweek | null> {
  try {
    if (!game || now - game.at >= GAME_MS) {
      const state = gameState(await getJson(GAME, 60));
      if (!state) return null;
      game = { at: now, ...state };
    }
    return game.gw === null || game.finished ? null : { season: seasonAt(now), gw: game.gw };
  } catch {
    return null;
  }
}

/** The timer's minute: the gameweek's object records it while a gameweek is played, if a match is on. */
export async function recordMinute(env: InPlayEnv, now: number): Promise<void> {
  if (!env.IN_PLAY) return;
  const on = await gameweekNow(now);
  if (!on) return;
  const stub = env.IN_PLAY.get(env.IN_PLAY.idFromName(`${on.season}:${on.gw}`));
  const res = await stub.fetch(`https://in-play/record/${on.season}/${on.gw}`, { method: 'POST', body: JSON.stringify({ now }) });
  if (!res.ok) console.error(`The in-play record for ${on.season}:${on.gw} failed: ${res.status} ${await res.text()}`);
}

type Records = Record<string, InPlayRecord[]>;

/** What of the site's data.json the records read, as it's built (shared/data.ts). */
type Site = RecordData;

/** A gameweek's records. Its storage: `records`, each head-to-head's by `<home>-<away>`. */
export class InPlay {
  storage: DurableObjectStorage;
  env: InPlayEnv;
  private site: Site | undefined;
  private siteAsked: number | undefined;

  constructor(state: DurableObjectState, env: InPlayEnv) {
    this.storage = state.storage;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return Response.json(await this.records());
    const path = new URL(request.url).pathname.replace(/^\/record/, '/in-play');
    const key = parseInPlayPath(path);
    const { now } = (await request.json().catch(() => ({}))) as { now?: unknown };
    if (!key || typeof now !== 'number' || !Number.isFinite(now)) return new Response('Not found', { status: 404 });
    const added = await this.record(key, now);
    return typeof added === 'string' ? new Response(added, { status: 503 }) : Response.json({ added });
  }

  private async records(): Promise<Records> {
    return (await this.storage.get<Records>('records')) ?? {};
  }

  // The live odds now in each head-to-head being played, added to its records: how many changed.
  // None while no match is on or just over (the feed's `matches`, by recentFixtures), as
  // between match days: then nothing else is read, nor anything written.
  private async record({ season, gw }: Gameweek, now: number): Promise<number | string> {
    let feed: Awaited<ReturnType<typeof liveFeed>>;
    try {
      feed = await liveFeed(gw, now);
    } catch (err) {
      if (!(err instanceof Upstream)) throw err;
      return err.message;
    }
    if (!Object.keys(feed.matches).length) return 0;
    const site = await this.siteData(now);
    if (!site) return 'Can’t read the site’s data.json just now';
    // Until a build has caught up with the gameweek, its data.json can't tell its lineups.
    if (site.meta.season.replace('/', '-') !== season || site.live?.gw !== gw) return 0;
    const latest = recordsNow(site, feed, now, (fixture) => feed.matches[fixture]);
    const records = await this.records();
    let added = 0;
    for (const [match, record] of Object.entries(latest)) {
      const list = withRecord(records[match] ?? [], record);
      if (list !== records[match]) [records[match], added] = [list, added + 1];
    }
    if (added) await this.storage.put({ records });
    return added;
  }

  // The site's data.json, asked for at most every SITE_MS (Cloudflare's cache answers within
  // that, past GitHub Pages' own ten minutes) and kept in memory between the timer's minutes.
  // A failed read waits as long, with the last one read, if any.
  private async siteData(now: number): Promise<Site | undefined> {
    if (!this.env.SITE_URL || (this.siteAsked !== undefined && now - this.siteAsked < SITE_MS)) return this.site;
    this.siteAsked = now;
    try {
      const bucket = Math.floor(now / SITE_MS);
      const res = await fetch(`${this.env.SITE_URL}/data.json?v=${bucket}`, { cf: { cacheTtl: SITE_MS / 1000, cacheEverything: true } });
      const data = res.ok ? ((await res.json()) as Site) : undefined;
      if (data?.meta?.season && Array.isArray(data.matches) && Array.isArray(data.gameweeks)) this.site = data;
    } catch {
      // The last one stands.
    }
    return this.site;
  }
}
