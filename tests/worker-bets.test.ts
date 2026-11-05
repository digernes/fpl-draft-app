import { drawIntoNothing } from './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { ALLOWANCE, oddsNow, type Bet, type Board, type Me } from '../src/shared/bets.ts';
import type { Data } from '../src/shared/data.ts';
import { Book } from '../worker/bets.ts';
import { slimFeed } from '../worker/feed.ts';
import worker from '../worker/index.ts';
import { NOW, rawFeed } from './fixtures/live-feed.ts';
import { annVBobLive } from './fixtures/match.ts';

drawIntoNothing();

const SITE = 'https://site.example';
const BEFORE = Date.parse('2026-09-01T12:00:00Z'); // GW 4's deadline is three days on

// annVBobLive(): GW 3 being played (Ann v Bob), and GW 4's Cy v Ann priced before its deadline.
function site(): Data {
  const d = annVBobLive();
  d.gameweeks[3].deadline = '2026-09-04T17:30:00Z';
  const price = (dec: number) => ({ dec, frac: '1/1' });
  d.matches.push({
    gw: 4,
    home: 3,
    away: 1,
    homePts: null,
    awayPts: null,
    started: false,
    finished: false,
    odds: { p: [0.5, 0.05, 0.45], prices: [price(1.9), price(17), price(2.1)], expected: [45, 44] },
  });
  return d;
}

// The site and FPL's live feed as fetch answers them.
let siteData: Data;
function upstream() {
  return mock.method(globalThis, 'fetch', async (url: string) => {
    const u = String(url);
    if (u.startsWith(SITE)) return Response.json(siteData);
    if (u.startsWith('https://draft.premierleague.com/api/event/3/live')) return Response.json(rawFeed());
    return new Response('Forbidden', { status: 403 });
  });
}

// A SQLite-backed object's database, as Node's own SQLite runs it.
function sqlStorage(): SqlStorage {
  const db = new DatabaseSync(':memory:');
  return {
    exec<T>(query: string, ...bindings: unknown[]) {
      const rows = db.prepare(query).all(...(bindings as (string | number | null)[])) as T[];
      return {
        toArray: () => rows,
        one: () => {
          if (rows.length !== 1) throw new Error(`Expected one row, got ${rows.length}`);
          return rows[0];
        },
      };
    },
  };
}

// The relay with one book, its clock set by `clock`.
let book: Book;
let clock = BEFORE;
let sql: SqlStorage;
const env = {
  SITE_URL: SITE,
  BETS: {
    idFromName: (name: string) => ({ toString: () => name }),
    get: () => ({ fetch: (input: string | Request, init?: RequestInit) => book.fetch(new Request(input, init)) }),
  } as DurableObjectNamespace,
};

async function call(path: string, body?: object, token?: string) {
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await worker.fetch(
    new Request(`https://relay.example${path}`, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined, headers }),
    env,
    { waitUntil() {} },
  );
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> & Partial<Me & Board> };
}

const signup = async (name = 'Ola', pin = '123456') => (await call('/bets/signup', { name, pin })).body as { token: string; me: Me };
const slip = (more: object = {}) => ({ gw: 4, home: 3, away: 1, pick: 0, stake: 100, price: 1.9, ...more });

beforeEach(() => {
  siteData = site();
  clock = BEFORE;
  sql = sqlStorage();
  book = new Book({ storage: { sql } }, env);
  book.now = () => clock;
  upstream();
});
afterEach(() => mock.restoreAll());

describe('the book’s accounts', () => {
  it('signs up a name and a PIN, keeping only a salted hash of the PIN', async () => {
    const { token, me } = await signup();
    assert.match(token, /^[0-9a-f]{64}$/);
    assert.deepEqual(me, { name: 'Ola', team: null, bets: [] });
    const [user] = sql.exec<Record<string, string>>('SELECT * FROM users').toArray();
    assert.equal(user.name, 'Ola');
    assert.ok(!JSON.stringify(user).includes('123456'));
    assert.match(user.hash, /^[0-9a-f]{64}$/);
    // Nor the token itself.
    assert.ok(!JSON.stringify(sql.exec('SELECT * FROM sessions').toArray()).includes(token));
  });

  it('turns away a name that’s taken, whatever its case, and names and PINs that don’t fit', async () => {
    await signup('Ola');
    assert.deepEqual(await call('/bets/signup', { name: 'OLA', pin: '654321' }), { status: 409, body: { error: 'That name is taken' } });
    assert.equal((await call('/bets/signup', { name: 'O', pin: '123456' })).status, 400);
    assert.equal((await call('/bets/signup', { name: 'Ola Nordmann', pin: '123456' })).status, 400);
    assert.deepEqual((await call('/bets/signup', { name: 'Kari', pin: '1234' })).body, { error: 'A PIN is six digits' });
  });

  it('signs in on another device with the same name and PIN, any case', async () => {
    await signup('Ola', '123456');
    const { status, body } = await call('/bets/login', { name: 'ola', pin: '123456' });
    assert.equal(status, 200);
    assert.equal((body.me as Me).name, 'Ola');
    assert.deepEqual(await call('/bets/login', { name: 'Ola', pin: '000000' }), { status: 401, body: { error: 'Wrong name or PIN' } });
    assert.deepEqual(await call('/bets/login', { name: 'Nobody', pin: '123456' }), { status: 401, body: { error: 'Wrong name or PIN' } });
  });

  it('locks a name for a quarter of an hour after five wrong PINs', async () => {
    await signup('Ola', '123456');
    for (let i = 0; i < 5; i++) assert.equal((await call('/bets/login', { name: 'Ola', pin: '000000' })).status, 401);
    assert.deepEqual(await call('/bets/login', { name: 'Ola', pin: '123456' }), {
      status: 429,
      body: { error: 'Too many wrong PINs: try again in 15 minutes' },
    });
    clock += 15 * 60_000;
    assert.equal((await call('/bets/login', { name: 'Ola', pin: '123456' })).status, 200);
  });

  it('wants a token for the account’s own calls, and forgets one at sign-out', async () => {
    const { token } = await signup();
    assert.equal((await call('/bets/me')).status, 401);
    assert.equal((await call('/bets/me', undefined, 'f'.repeat(64))).status, 401);
    assert.equal((await call('/bets/me', undefined, token)).status, 200);
    assert.equal((await call('/bets/logout', {}, token)).status, 200);
    assert.equal((await call('/bets/me', undefined, token)).status, 401);
  });

  it('keeps the team the account follows, for its other devices', async () => {
    const { token } = await signup('Ola', '123456');
    assert.deepEqual((await call('/bets/team', { team: 3 }, token)).body, { name: 'Ola', team: 3, bets: [] });
    const other = (await call('/bets/login', { name: 'Ola', pin: '123456' })).body as { token: string; me: Me };
    assert.equal(other.me.team, 3);
    assert.equal(((await call('/bets/team', { team: null }, other.token)).body as Me).team, null);
    assert.equal((await call('/bets/team', { team: 'Ann' }, token)).status, 400);
    assert.equal((await call('/bets/team', { team: 3 })).status, 401);
  });

  it('keeps an account signed in on its last ten devices', async () => {
    const { token } = await signup('Ola', '123456');
    for (let i = 1; i <= 10; i++) {
      clock += 1000;
      await call('/bets/login', { name: 'Ola', pin: '123456' });
    }
    assert.equal((await call('/bets/me', undefined, token)).status, 401);
    assert.equal(sql.exec('SELECT * FROM sessions').toArray().length, 10);
  });
});

describe('the book’s bets', () => {
  it('takes a bet before the deadline at the pre-match odds', async () => {
    const { token } = await signup();
    const { status, body } = await call('/bets/bet', slip(), token);
    assert.equal(status, 200);
    const bet = body.bet as Bet;
    assert.deepEqual(
      { ...bet, id: 0 },
      { id: 0, name: 'Ola', season: '2026-27', gw: 4, home: 3, away: 1, pick: 0, stake: 100, price: 1.9, at: BEFORE },
    );
    assert.deepEqual((body.me as Me).bets, [bet]);
  });

  it('sends the slip back when the odds have shortened, and takes better ones', async () => {
    const { token } = await signup();
    assert.deepEqual(await call('/bets/bet', slip({ price: 2 }), token), {
      status: 409,
      body: { error: 'The odds have moved to 1.90', prices: [1.9, 17, 2.1] },
    });
    const { body } = await call('/bets/bet', slip({ pick: 2, price: 2 }), token);
    assert.equal((body.bet as Bet).price, 2.1);
  });

  it('takes no more than the gameweek’s allowance', async () => {
    const { token } = await signup();
    assert.equal((await call('/bets/bet', slip({ stake: 600 }), token)).status, 200);
    assert.deepEqual(await call('/bets/bet', slip({ stake: 401 }), token), {
      status: 409,
      body: { error: `Only ${ALLOWANCE - 600} left to stake in gameweek 4` },
    });
    assert.equal((await call('/bets/bet', slip({ stake: 400, pick: 1, price: 17 }), token)).status, 200);
    assert.equal((await call('/bets/bet', slip({ stake: 1001 }), token)).status, 400);
    assert.equal((await call('/bets/bet', slip({ stake: 1.5 }), token)).status, 400);
  });

  it('takes a live bet at the live odds it works out itself, with the score then', async () => {
    const { token } = await signup();
    clock = NOW;
    const feed = slimFeed(rawFeed() as never, NOW);
    const m = siteData.matches.find((x) => x.gw === 3)!;
    const odds = oddsNow(siteData, m, NOW, feed, (f) => feed.matches[f]);
    assert.ok(typeof odds === 'object' && odds.live);
    const { status, body } = await call('/bets/bet', { gw: 3, home: 1, away: 2, pick: 2, stake: 50, price: odds.prices[2] }, token);
    assert.equal(status, 200);
    assert.equal((body.bet as Bet).price, odds.prices[2]);
    assert.deepEqual((body.bet as Bet).live, odds.live);
  });

  it('turns a bet away once the deadline has passed and before the gameweek’s build is in', async () => {
    const { token } = await signup();
    clock = Date.parse('2026-09-04T18:00:00Z');
    assert.deepEqual(await call('/bets/bet', slip(), token), {
      status: 409,
      body: { error: 'Live betting opens once the gameweek’s first data build is in' },
    });
    assert.deepEqual((await call('/bets/bet', slip({ home: 2 }), token)).body, { error: 'No such match' });
  });

  it('settles a bet once data.json has the match finished, and ranks the winners', async () => {
    const ola = await signup('Ola');
    const kari = await signup('Kari', '654321');
    await call('/bets/bet', slip({ stake: 200 }), ola.token); // Cy to win at 1.90
    await call('/bets/bet', slip({ stake: 300, pick: 2, price: 2.1 }), kari.token); // Ann to win at 2.10
    // Before the deadline nobody sees anyone's picks: only how many have bet.
    assert.deepEqual((await call('/bets/board')).body, { leaders: [], feed: [], counts: [{ gw: 4, players: 2, bets: 2, staked: 500 }] });
    // Cy beat Ann; the site's copy is asked again five minutes on.
    Object.assign(siteData.matches.at(-1)!, { started: true, finished: true, homePts: 55, awayPts: 40 });
    clock += 5 * 60_000;
    const board = (await call('/bets/board')).body as Board;
    assert.deepEqual(board.leaders, [
      { name: 'Ola', profit: 180, gws: 1, bets: 1, won: 1 },
      { name: 'Kari', profit: -300, gws: 1, bets: 1, won: 0 },
    ]);
    assert.deepEqual(
      board.feed.map((b) => [b.name, b.result, b.payout]),
      [
        ['Kari', 0, 0],
        ['Ola', 0, 380],
      ],
    );
    const mine = (await call('/bets/me', undefined, ola.token)).body as Me;
    assert.equal(mine.bets[0].payout, 380);
    // A finished match takes no more.
    assert.deepEqual((await call('/bets/bet', slip(), ola.token)).body, { error: 'This match is over' });
  });
});

describe('the book’s feed', () => {
  it('shows everyone’s bets once their deadline has passed, open or settled', async () => {
    const ola = await signup('Ola');
    await call('/bets/bet', slip({ stake: 200 }), ola.token);
    assert.deepEqual(((await call('/bets/board')).body as Board).feed, []);
    // GW 4's deadline passes; the site's copy is asked again.
    clock = Date.parse('2026-09-04T17:31:00Z');
    const board = (await call('/bets/board')).body as Board;
    assert.deepEqual(
      board.feed.map((b) => [b.name, b.gw, b.stake, b.payout]),
      [['Ola', 4, 200, undefined]],
    );
    assert.deepEqual(board.leaders, []);
  });

  it('puts the latest placed or settled first', async () => {
    const ola = await signup('Ola');
    await call('/bets/bet', slip({ stake: 100 }), ola.token);
    clock += 60_000;
    await call('/bets/bet', slip({ stake: 50, pick: 2, price: 2.1 }), ola.token);
    clock = Date.parse('2026-09-04T17:31:00Z');
    assert.deepEqual(
      ((await call('/bets/board')).body as Board).feed.map((b) => b.stake),
      [50, 100],
    );
  });
});

describe('the relay’s bets route', () => {
  it('answers only the book’s routes, with CORS that lets a token through', async () => {
    assert.equal((await call('/bets/nothing')).status, 404);
    const res = await worker.fetch(new Request('https://relay.example/bets/board', { method: 'OPTIONS' }), env, { waitUntil() {} });
    assert.match(res.headers.get('access-control-allow-headers') ?? '', /Authorization/);
    const board = await worker.fetch(new Request('https://relay.example/bets/board'), env, { waitUntil() {} });
    assert.equal(board.headers.get('access-control-allow-origin'), '*');
    assert.equal(board.headers.get('cache-control'), 'no-store');
  });

  it('turns away a body that’s too large', async () => {
    assert.equal((await call('/bets/signup', { name: 'Ola', pin: '123456', pad: 'x'.repeat(400) })).status, 413);
  });
});
