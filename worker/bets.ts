// Betting fake money on the head-to-heads (shared/bets.ts has the rules): one Durable Object,
// the book, keeps everyone's account and bets in its SQLite database, prices every bet from
// the site's data.json (and while a gameweek is played, the relay's live feed), and settles
// them once data.json has the match finished.
//
//   POST /bets/signup  {"name", "pin"}      → { token, me }   a new account
//   POST /bets/login   {"name", "pin"}      → { token, me }   on another device
//   POST /bets/logout                        the device's token forgotten
//   GET  /bets/me                           → Me              the account's bets and the team it follows
//   POST /bets/team    {"team": id | null}  → Me              the team it follows, from any device
//   POST /bets/bet     Slip                 → { bet, me }     or 409 { error, prices? }
//   GET  /bets/board                        → Board           the leaderboard, everyone's bets once their deadline
//                                                              has passed, and how many bets each open gameweek has
//
// The account's own calls carry `Authorization: Bearer <token>`. An account is a name, which
// everyone sees on the leaderboard, and a six-digit PIN, of which only a salted PBKDF2 hash
// is kept; a token is kept as its SHA-256. Five wrong PINs lock a name for a quarter of an hour.

import {
  ALLOWANCE,
  begun,
  countsOf,
  leadersOf,
  leftIn,
  NAME,
  NAME_RULE,
  oddsNow,
  payoutOf,
  PIN,
  resultOf,
  seasonSlug,
  type Bet,
  type BetData,
  type Board,
  type Me,
  type Outcome,
  type Slip,
} from '../src/shared/bets.ts';
import { liveFeed, Upstream } from './feed.ts';
import { Site } from './site.ts';

export interface BetsEnv {
  /** The book's Durable Object (wrangler.toml). */
  BETS?: DurableObjectNamespace;
  /** The deployed site, whose data.json has the matches, their odds and their results. */
  SITE_URL?: string;
}

const MAX_BODY = 300; // bytes: a bet is about 80
const ITERATIONS = 100_000; // PBKDF2's, the most Workers' crypto allows
const TRIES = 5;
const LOCK_MS = 15 * 60 * 1000;
const SIGNUPS_AN_HOUR = 30; // far beyond this league's visitors, and it bounds what a script can do
const SESSIONS = 10; // devices an account stays signed in on
const FEED = 60;
const ROUTES = /^\/bets\/(signup|login|logout|me|team|bet|board)$/;

/** The relay's side: checks the address and the size, and hands the request to the book. */
export async function betsRoute(request: Request, env: BetsEnv, path: string, cors: Record<string, string>): Promise<Response> {
  const headers = { ...cors, 'Cache-Control': 'no-store' };
  if (!ROUTES.test(path) || !env.BETS) return new Response('Not found', { status: 404, headers });
  if (Number(request.headers.get('Content-Length') ?? 0) > MAX_BODY) return new Response('Too large', { status: 413, headers });
  const body = request.method === 'POST' ? await request.text() : undefined;
  if (body && body.length > MAX_BODY) return new Response('Too large', { status: 413, headers });
  const stub = env.BETS.get(env.BETS.idFromName('book'));
  const auth = request.headers.get('Authorization');
  const res = await stub.fetch(`https://book${path}`, { method: request.method, body, headers: auth ? { Authorization: auth } : {} });
  return new Response(res.body, { status: res.status, headers: { ...headers, 'Content-Type': 'application/json' } });
}

type Row = Record<string, string | number | null>;
type BetRow = {
  id: number;
  name: string;
  season: string;
  gw: number;
  home: number;
  away: number;
  pick: number;
  stake: number;
  price: number;
  at: number;
  live_home: number | null;
  live_away: number | null;
  result: number | null;
  payout: number | null;
};

const fail = (status: number, error: string, more: object = {}) => Response.json({ error, ...more }, { status });

const hex = (bytes: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
const random = (n: number) => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (text: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

async function pinHash(pin: string, salt: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bytes = new Uint8Array(salt.match(/../g)!.map((h) => parseInt(h, 16)));
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: bytes, iterations: ITERATIONS }, key, 256));
}

// The same time whether or not the hashes match from the start.
const same = (a: string, b: string) =>
  a.length === b.length && [...a].reduce((d, c, i) => d | (c.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0;

function toBet(r: BetRow): Bet {
  return {
    id: r.id,
    name: r.name,
    season: r.season,
    gw: r.gw,
    home: r.home,
    away: r.away,
    pick: r.pick as Outcome,
    stake: r.stake,
    price: r.price,
    at: r.at,
    ...(r.live_home !== null && r.live_away !== null ? { live: [r.live_home, r.live_away] as [number, number] } : {}),
    ...(r.result !== null ? { result: r.result as Outcome, payout: r.payout ?? 0 } : {}),
  };
}

function parseCredentials(text: string | undefined): { name: string; pin: string } | null {
  try {
    const { name, pin } = JSON.parse(text ?? '') as Record<string, unknown>;
    return typeof name === 'string' && typeof pin === 'string' ? { name: name.trim(), pin } : null;
  } catch {
    return null;
  }
}

function parseSlip(text: string | undefined): Slip | null {
  try {
    const s = JSON.parse(text ?? '') as Record<string, unknown>;
    const whole = (x: unknown, max: number) => Number.isInteger(x) && (x as number) >= 1 && (x as number) <= max;
    const ok =
      whole(s.gw, 38) &&
      whole(s.home, 1e9) &&
      whole(s.away, 1e9) &&
      [0, 1, 2].includes(s.pick as number) &&
      whole(s.stake, ALLOWANCE) &&
      typeof s.price === 'number' &&
      s.price >= 1;
    return ok ? (s as unknown as Slip) : null;
  } catch {
    return null;
  }
}

const BET_COLUMNS =
  'bets.id, users.name, season, gw, home, away, pick, stake, price, at, live_home, live_away, result, payout FROM bets JOIN users ON users.id = bets.user';

/** The book: its storage is three tables, users, sessions and bets. */
export class Book {
  sql: SqlStorage;
  env: BetsEnv;
  /** The time now, in ms (the tests set their own). */
  now = () => Date.now();
  private site: Site<BetData>;

  constructor(state: SqlDurableObjectState, env: BetsEnv) {
    this.sql = state.storage.sql;
    this.env = env;
    this.site = new Site(env.SITE_URL);
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, key TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, hash TEXT NOT NULL, created INTEGER NOT NULL, fails INTEGER NOT NULL DEFAULT 0, locked INTEGER NOT NULL DEFAULT 0, team INTEGER)',
    );
    this.sql.exec('CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user INTEGER NOT NULL, created INTEGER NOT NULL)');
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS bets (id INTEGER PRIMARY KEY, user INTEGER NOT NULL, season TEXT NOT NULL, gw INTEGER NOT NULL, home INTEGER NOT NULL, away INTEGER NOT NULL, pick INTEGER NOT NULL, stake INTEGER NOT NULL, price REAL NOT NULL, at INTEGER NOT NULL, live_home INTEGER, live_away INTEGER, result INTEGER, payout INTEGER, settled INTEGER)',
    );
    this.sql.exec('CREATE INDEX IF NOT EXISTS bets_by_user ON bets (user, season, gw)');
  }

  async fetch(request: Request): Promise<Response> {
    const route = new URL(request.url).pathname.replace(/^\/bets\//, '');
    const body = request.method === 'POST' ? await request.text() : undefined;
    if (route === 'signup' && body !== undefined) return this.signup(body);
    if (route === 'login' && body !== undefined) return this.login(body);
    if (route === 'board') return Response.json(await this.board());
    const user = await this.userOf(request);
    if (!user) return fail(401, 'Sign in first');
    if (route === 'logout' && body !== undefined) {
      this.sql.exec('DELETE FROM sessions WHERE token = ?', await sha256(this.bearer(request)!));
      return Response.json({});
    }
    if (route === 'me') {
      await this.settle();
      return Response.json(this.me(user));
    }
    if (route === 'team' && body !== undefined) return this.team(user, body);
    if (route === 'bet' && body !== undefined) return this.bet(user, body);
    return fail(404, 'Not found');
  }

  private bearer = (request: Request) => request.headers.get('Authorization')?.match(/^Bearer ([0-9a-f]{64})$/)?.[1];

  private async userOf(request: Request): Promise<number | null> {
    const token = this.bearer(request);
    if (!token) return null;
    const row = this.sql.exec<Row>('SELECT user FROM sessions WHERE token = ?', await sha256(token)).toArray()[0];
    return row ? Number(row.user) : null;
  }

  private me(user: number): Me {
    const { name, team } = this.sql.exec<Row>('SELECT name, team FROM users WHERE id = ?', user).one();
    const bets = this.sql.exec<BetRow>(`SELECT ${BET_COLUMNS} WHERE bets.user = ? ORDER BY bets.id DESC`, user).toArray();
    return { name: String(name), team: team === null ? null : Number(team), bets: bets.map(toBet) };
  }

  // The draft team the account follows, for every device it's signed in on; null for none.
  private team(user: number, body: string): Response {
    let team: unknown;
    try {
      ({ team } = JSON.parse(body) as Record<string, unknown>);
    } catch {
      team = undefined;
    }
    if (team !== null && !(Number.isInteger(team) && (team as number) >= 1 && (team as number) <= 1e9))
      return fail(400, 'Expected {"team": <entry id> | null}');
    this.sql.exec('UPDATE users SET team = ? WHERE id = ?', team, user);
    return Response.json(this.me(user));
  }

  private async session(user: number) {
    const token = random(32);
    this.sql.exec('INSERT INTO sessions (token, user, created) VALUES (?, ?, ?)', await sha256(token), user, this.now());
    // The oldest devices are signed out past SESSIONS.
    this.sql.exec(
      'DELETE FROM sessions WHERE user = ? AND token NOT IN (SELECT token FROM sessions WHERE user = ? ORDER BY created DESC LIMIT ?)',
      user,
      user,
      SESSIONS,
    );
    return Response.json({ token, me: this.me(user) });
  }

  private async signup(body: string): Promise<Response> {
    const c = parseCredentials(body);
    if (!c || !NAME.test(c.name)) return fail(400, `A name is ${NAME_RULE}`);
    if (!PIN.test(c.pin)) return fail(400, 'A PIN is six digits');
    const key = c.name.toLowerCase();
    if (this.sql.exec<Row>('SELECT id FROM users WHERE key = ?', key).toArray().length) return fail(409, 'That name is taken');
    const recent = this.sql.exec<Row>('SELECT COUNT(*) AS n FROM users WHERE created > ?', this.now() - 3600_000).one();
    if (Number(recent.n) >= SIGNUPS_AN_HOUR) return fail(429, 'Too many sign-ups just now: try again in a while');
    const salt = random(16);
    const hash = await pinHash(c.pin, salt);
    // Taken while the PIN was hashed: the unique key says so.
    try {
      this.sql.exec('INSERT INTO users (name, key, salt, hash, created) VALUES (?, ?, ?, ?, ?)', c.name, key, salt, hash, this.now());
    } catch {
      return fail(409, 'That name is taken');
    }
    const id = Number(this.sql.exec<Row>('SELECT id FROM users WHERE key = ?', key).one().id);
    return this.session(id);
  }

  private async login(body: string): Promise<Response> {
    const c = parseCredentials(body);
    const user =
      c && this.sql.exec<Row>('SELECT id, salt, hash, fails, locked FROM users WHERE key = ?', c.name.toLowerCase()).toArray()[0];
    if (!c || !user) return fail(401, 'Wrong name or PIN');
    const now = this.now();
    if (Number(user.locked) > now)
      return fail(429, `Too many wrong PINs: try again in ${Math.ceil((Number(user.locked) - now) / 60_000)} minutes`);
    const right = PIN.test(c.pin) && same(await pinHash(c.pin, String(user.salt)), String(user.hash));
    if (!right) {
      const fails = Number(user.fails) + 1;
      if (fails >= TRIES) this.sql.exec('UPDATE users SET fails = 0, locked = ? WHERE id = ?', now + LOCK_MS, user.id);
      else this.sql.exec('UPDATE users SET fails = ? WHERE id = ?', fails, user.id);
      return fail(401, 'Wrong name or PIN');
    }
    this.sql.exec('UPDATE users SET fails = 0, locked = 0 WHERE id = ?', user.id);
    return this.session(Number(user.id));
  }

  private async bet(user: number, body: string): Promise<Response> {
    const slip = parseSlip(body);
    if (!slip) return fail(400, 'Expected a match, a pick, a stake and a price');
    const now = this.now();
    const site = await this.site.get(now);
    if (!site) return fail(503, 'Can’t read the odds just now');
    this.settleWith(site);
    const m = site.matches.find((x) => x.gw === slip.gw && x.home === slip.home && x.away === slip.away);
    if (!m) return fail(404, 'No such match');
    let feed: Awaited<ReturnType<typeof liveFeed>> | null = null;
    const deadline = Date.parse(site.gameweeks.find((g) => g.id === m.gw)?.deadline ?? '');
    if (now >= deadline && site.live?.gw === m.gw) {
      try {
        feed = await liveFeed(m.gw, now);
      } catch (err) {
        if (!(err instanceof Upstream)) throw err;
        return fail(503, 'Can’t read the live scores just now');
      }
    }
    const odds = oddsNow(site, m, now, feed, (fixture) => feed?.matches[fixture]);
    if (typeof odds === 'string') return fail(409, odds);
    const price = odds.prices[slip.pick];
    // Better odds than the slip showed are taken; worse ones go back to it.
    if (price < slip.price - 1e-9) return fail(409, `The odds have moved to ${price.toFixed(2)}`, { prices: odds.prices });
    // Read again after the waits above, so two bets at once can't overspend.
    const season = seasonSlug(site);
    const mine = this.sql
      .exec<Row>('SELECT season, gw, stake FROM bets WHERE user = ? AND season = ? AND gw = ?', user, season, m.gw)
      .toArray();
    const left = leftIn(mine as { season: string; gw: number; stake: number }[], season, m.gw);
    if (slip.stake > left) return fail(409, `Only ${left} left to stake in gameweek ${m.gw}`);
    this.sql.exec(
      'INSERT INTO bets (user, season, gw, home, away, pick, stake, price, at, live_home, live_away) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      user,
      season,
      m.gw,
      m.home,
      m.away,
      slip.pick,
      slip.stake,
      price,
      now,
      odds.live?.[0] ?? null,
      odds.live?.[1] ?? null,
    );
    const me = this.me(user);
    return Response.json({ bet: me.bets[0], me });
  }

  private async board(): Promise<Board> {
    const now = this.now();
    const site = await this.site.get(now);
    if (site) this.settleWith(site);
    // Placed or settled, whichever is later, first.
    const all = this.sql.exec<BetRow>(`SELECT ${BET_COLUMNS} ORDER BY COALESCE(settled, at) DESC, bets.id DESC`).toArray().map(toBet);
    // Without the site's deadlines, only what's settled is sure to be over its deadline.
    const shown = all.filter((b) => (site ? begun(b, site, now) : b.payout !== undefined));
    return { leaders: leadersOf(all), feed: shown.slice(0, FEED), counts: site ? countsOf(all, site) : [] };
  }

  private async settle() {
    const site = await this.site.get(this.now());
    if (site) this.settleWith(site);
  }

  // Every open bet of the site's season whose match data.json has finished.
  private settleWith(site: BetData) {
    const season = seasonSlug(site);
    const open = this.sql
      .exec<Row>('SELECT id, gw, home, away, pick, stake, price FROM bets WHERE result IS NULL AND season = ?', season)
      .toArray();
    for (const b of open) {
      const m = site.matches.find((x) => x.gw === b.gw && x.home === b.home && x.away === b.away);
      const result = m && resultOf(m);
      if (result === null || result === undefined) continue;
      const payout = result === b.pick ? payoutOf(Number(b.stake), Number(b.price)) : 0;
      this.sql.exec('UPDATE bets SET result = ?, payout = ?, settled = ? WHERE id = ?', result, payout, this.now(), b.id);
    }
  }
}
