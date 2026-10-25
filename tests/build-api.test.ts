import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it, type TestContext } from 'node:test';

import { fetchLeague, fetchOptional } from '../src/build/api.ts';
import { Game } from '../src/shared/fpl-api.ts';
import { fetched, LEAGUE_ID, responses } from './fixtures/build-league.ts';

type Reply = unknown | ((url: string) => Response | Promise<Response>);

// Stands in for the network: each URL gets its response, as JSON, or a 404.
function stubFetch(t: TestContext, replies: Record<string, Reply>) {
  return t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = String(input);
    const reply = replies[url];
    if (typeof reply === 'function') return reply(url);
    return reply === undefined ? new Response('Not found', { status: 404 }) : Response.json(reply);
  });
}

// Lets the retries' waits pass at once: tick the mocked clock until the promise settles.
async function settled<T>(t: TestContext, promise: Promise<T>): Promise<T> {
  let done = false;
  promise.then(
    () => (done = true),
    () => (done = true),
  );
  while (!done) {
    await new Promise((r) => setImmediate(r));
    t.mock.timers.tick(10_000);
  }
  return promise;
}

const dirs: string[] = [];
after(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

describe('fetching the league', () => {
  it('asks for everything the build needs and parses each response', async (t) => {
    const replies = responses();
    const fetch = stubFetch(t, replies);
    const league = await fetchLeague(LEAGUE_ID, null);
    assert.deepEqual(league, fetched());
    assert.equal(fetch.mock.callCount(), Object.keys(replies).length);
    assert.deepEqual(Object.keys(league.live), ['1', '2', '3']);
    assert.equal(league.ownerNow.get(63), 101);
    assert.equal(league.ownerNow.has(61), false);
  });

  it('keeps the raw responses in the cache, and reads them back instead of asking again', async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), 'build-api-'));
    dirs.push(dir);
    const cache = path.join(dir, 'cache');
    const replies = responses();
    stubFetch(t, replies);
    const first = await fetchLeague(LEAGUE_ID, cache);
    const files = await readdir(cache);
    assert.equal(files.length, Object.keys(replies).length);
    assert.ok(files.includes('draft_premierleague_com_api_bootstrap_static.json'));
    const offline = stubFetch(t, {});
    assert.deepEqual(await fetchLeague(LEAGUE_ID, cache), first);
    assert.equal(offline.mock.callCount(), 0);
  });

  it('goes on without the main game’s bootstrap or a manager’s missing week, and says so', async (t) => {
    const replies = responses();
    delete replies['https://fantasy.premierleague.com/api/bootstrap-static/'];
    delete replies['https://draft.premierleague.com/api/entry/102/event/2'];
    const fetch = stubFetch(t, replies);
    const warn = t.mock.method(console, 'warn', () => {});
    const league = await fetchLeague(LEAGUE_ID, null);
    assert.equal(league.fplBoot, null);
    assert.deepEqual(Object.keys(league.picks[102]), ['1', '3']);
    assert.equal(warn.mock.callCount(), 2);
    assert.match(String(warn.mock.calls[0].arguments[0]), /^! Skipping https:\/\/.+: HTTP 404 for /);
    // A 404 won't get better, so neither is asked for twice.
    assert.equal(fetch.mock.callCount(), Object.keys(replies).length + 2);
  });

  it('stops the build when a response it needs is missing', async (t) => {
    const replies = responses();
    delete replies['https://draft.premierleague.com/api/game'];
    stubFetch(t, replies);
    await assert.rejects(fetchLeague(LEAGUE_ID, null), /HTTP 404 for https:\/\/draft.premierleague.com\/api\/game/);
  });

  it('stops the build with the fields that changed when FPL changes a response’s shape', async (t) => {
    const replies = responses();
    replies['https://draft.premierleague.com/api/game'] = { current_event: 'three', next_event: 4 };
    stubFetch(t, replies);
    await assert.rejects(fetchLeague(LEAGUE_ID, null), (err: Error) => {
      assert.match(err.message, /^Unexpected response from https:\/\/draft.premierleague.com\/api\/game:\n/);
      assert.match(err.message, /\n {2}current_event: /);
      assert.match(err.message, /\n {2}current_event_finished: /);
      return true;
    });
  });
});

describe('fetching a response that may fail', () => {
  const url = 'https://draft.premierleague.com/api/game';
  const game = { current_event: 3, current_event_finished: false, next_event: 4 };

  it('tries again after a server error, a rate limit or a dropped connection', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const answers = [
      () => new Response('', { status: 503 }),
      () => new Response('', { status: 429 }),
      () => Promise.reject(new TypeError('fetch failed')),
      () => Response.json(game),
    ];
    let tries = 0;
    const fetch = stubFetch(t, { [url]: () => answers[tries++]() });
    assert.deepEqual(await settled(t, fetchOptional(url, Game, null)), game);
    assert.equal(fetch.mock.callCount(), 4);
  });

  it('gives up after four tries, with nothing and a warning', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const fetch = stubFetch(t, { [url]: () => new Response('', { status: 500 }) });
    const warn = t.mock.method(console, 'warn', () => {});
    assert.equal(await settled(t, fetchOptional(url, Game, null)), null);
    assert.equal(fetch.mock.callCount(), 4);
    assert.equal(warn.mock.calls[0].arguments[0], `! Skipping ${url}: HTTP 500 for ${url}`);
  });

  it('passes on a dropped connection’s own error when it gives up on a response it needs', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const replies = responses();
    stubFetch(t, { ...replies, [url]: () => Promise.reject(new TypeError('fetch failed')) });
    await assert.rejects(settled(t, fetchLeague(LEAGUE_ID, null)), /fetch failed/);
  });
});
