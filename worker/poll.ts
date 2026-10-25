// Who will win? before a head-to-head: its votes, kept by one Durable Object per match
// (named <season>:<gw>:<home>-<away>), which holds the count for each choice and each
// voter's choice, so a second vote from the same visitor doesn't count again. A voter is
// a random id the page makes and keeps; nothing else about them is stored.
//
//   GET  /poll/<season>/<gw>/<home>-<away>   { votes: [home, draw, away] }
//   POST /poll/<season>/<gw>/<home>-<away>   {"voter": "…", "choice": "home" | "draw" | "away"}
//                                            → { votes, choice }: the choice that counted
//
// Voting closes at the gameweek's deadline, as the deployed site's data.json has it: the
// match has to be in it, in its season, and the object keeps the deadline it found there.

import { z } from 'zod';

import { CHOICES, parsePollPath, type Choice, type Votes } from '../src/shared/poll.ts';

export interface PollEnv {
  /** The polls' Durable Objects (wrangler.toml). */
  POLLS?: DurableObjectNamespace;
  /** The deployed site, whose data.json has the matches and their deadlines. */
  SITE_URL?: string;
}

const MAX_BODY = 200; // bytes: a vote is about 70
const MAX_VOTES = 10_000; // a match's; far beyond this league's visitors, and it bounds what a script can stuff in
const RECHECK_MS = 60 * 60 * 1000; // a deadline FPL moves reaches a poll within the hour
const VOTER = /^[A-Za-z0-9-]{16,64}$/;

/** The relay's side of a poll: checks the address and the vote, and hands them to the match's object. */
export async function pollRoute(request: Request, env: PollEnv, path: string, cors: Record<string, string>): Promise<Response> {
  const reply = (body: BodyInit | null, status: number, type = 'text/plain') =>
    new Response(body, { status, headers: { ...cors, 'Content-Type': type, 'Cache-Control': 'no-store' } });
  const key = parsePollPath(path);
  if (!key || !env.POLLS) return reply('Not found', 404);
  const stub = env.POLLS.get(env.POLLS.idFromName(`${key.season}:${key.gw}:${key.home}-${key.away}`));
  const inner = `https://poll${path}`;

  if (request.method === 'GET') {
    const res = await stub.fetch(inner);
    return reply(res.body, res.status, 'application/json');
  }
  if (request.method !== 'POST') return reply('Not found', 404);
  if (Number(request.headers.get('Content-Length') ?? 0) > MAX_BODY) return reply('Too large', 413);
  const text = await request.text();
  if (text.length > MAX_BODY) return reply('Too large', 413);
  const vote = parseVote(text);
  if (!vote) return reply('Expected {"voter": "…", "choice": "home" | "draw" | "away"}', 400);
  const res = await stub.fetch(inner, { method: 'POST', body: JSON.stringify(vote) });
  return reply(res.body, res.status, res.headers.get('Content-Type') ?? 'text/plain');
}

function parseVote(text: string): { voter: string; choice: Choice } | null {
  try {
    const { voter, choice } = JSON.parse(text) as Record<string, unknown>;
    return typeof voter === 'string' && VOTER.test(voter) && CHOICES.includes(choice as Choice)
      ? { voter, choice: choice as Choice }
      : null;
  } catch {
    return null;
  }
}

// What the site's data.json says of the match: only what the deadline check needs.
const SiteData = z.object({
  meta: z.object({ season: z.string() }),
  gameweeks: z.array(z.object({ id: z.number(), deadline: z.string() })),
  matches: z.array(z.object({ gw: z.number(), home: z.number(), away: z.number() })),
});

type Key = NonNullable<ReturnType<typeof parsePollPath>>;

/** The gameweek's deadline in ms, if the site's data.json has the match; 'unknown' if it hasn't, 'unavailable' if it can't be read. */
export async function siteDeadline(env: PollEnv, key: Key): Promise<number | 'unknown' | 'unavailable'> {
  if (!env.SITE_URL) return 'unavailable';
  try {
    const res = await fetch(`${env.SITE_URL}/data.json`, { cf: { cacheTtl: 300, cacheEverything: true } });
    const parsed = res.ok ? SiteData.safeParse(await res.json()) : null;
    if (!parsed?.success) return 'unavailable';
    const { meta, gameweeks, matches } = parsed.data;
    const known =
      meta.season.replace('/', '-') === key.season && matches.some((m) => m.gw === key.gw && m.home === key.home && m.away === key.away);
    if (!known) return 'unknown';
    const at = Date.parse(gameweeks.find((g) => g.id === key.gw)?.deadline ?? '');
    return Number.isFinite(at) ? at : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

const json = (body: object, status = 200) => Response.json(body, { status });

/** One match's poll. Its storage: `votes` ([home, draw, away]), `deadline` ({ at, checked }) and `voter:<id>` (the choice). */
export class Poll {
  storage: DurableObjectStorage;
  env: PollEnv;

  constructor(state: DurableObjectState, env: PollEnv) {
    this.storage = state.storage;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return json({ votes: await this.votes() });
    const key = parsePollPath(new URL(request.url).pathname);
    if (!key) return new Response('Not found', { status: 404 });
    const { voter, choice } = (await request.json()) as { voter: string; choice: Choice };

    // Before reading the votes: the lookup waits on the network, when other votes can come in.
    const deadline = await this.deadline(key);
    if (deadline === 'unknown') return new Response('No such match', { status: 404 });
    if (deadline === 'unavailable') return new Response('Can’t check the deadline just now', { status: 503 });
    const votes = await this.votes();
    if (Date.now() >= deadline) return json({ votes }, 403);
    const earlier = await this.storage.get<Choice>(`voter:${voter}`);
    if (earlier) return json({ votes, choice: earlier });
    if (votes[0] + votes[1] + votes[2] >= MAX_VOTES) return json({ votes }, 429);

    votes[CHOICES.indexOf(choice)]++;
    await this.storage.put({ votes, [`voter:${voter}`]: choice });
    return json({ votes, choice });
  }

  private async votes(): Promise<Votes> {
    return (await this.storage.get<Votes>('votes')) ?? [0, 0, 0];
  }

  // The deadline found last time, looked up again after an hour while it's still ahead.
  private async deadline(key: Key): Promise<number | 'unknown' | 'unavailable'> {
    const known = await this.storage.get<{ at: number; checked: number }>('deadline');
    const now = Date.now();
    if (known && (known.at <= now || now - known.checked < RECHECK_MS)) return known.at;
    const found = await siteDeadline(this.env, key);
    if (typeof found !== 'number') return known?.at ?? found;
    await this.storage.put({ deadline: { at: found, checked: now } });
    return found;
  }
}
