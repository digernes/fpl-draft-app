import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { forgetLookups } from '../worker/in-play.ts';
import worker, { Poll } from '../worker/index.ts';
import { buildDue, buildFiring } from '../worker/timer.ts';

const ctx = { waitUntil() {} };
const call = (path: string, method = 'GET') => worker.fetch(new Request(`https://relay.example${path}`, { method }), {}, ctx);
const feed = {
  elements: {
    5: { stats: { total_points: 6, minutes: 90, goals_scored: 1, assists: 0, clean_sheets: 0, goals_conceded: 0 }, explain: [] },
  },
  fixtures: [
    { id: 1, team_h: 1, team_a: 2, started: true, finished: true, finished_provisional: true, team_h_score: 1, team_a_score: 0, stats: [] },
  ],
};

describe('live relay', () => {
  afterEach(() => mock.restoreAll());

  it('answers /live/<gw> with the slim feed and CORS', async () => {
    const upstream = mock.method(globalThis, 'fetch', async () => Response.json(feed));
    const res = await call('/live/7');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    const body = await res.json();
    assert.equal(body.gw, 7);
    assert.deepEqual(body.elements, { 5: [6, 90] });
    assert.equal(upstream.mock.calls[0].arguments[0], 'https://draft.premierleague.com/api/event/7/live');
  });

  // A match on: player 7 has played half an hour of it and scored, with his xG.
  const playing = {
    elements: {
      ...feed.elements,
      7: {
        stats: { total_points: 7, minutes: 30, goals_scored: 1, assists: 0, clean_sheets: 0, goals_conceded: 0, expected_goals: '0.45' },
        explain: [[[{ stat: 'minutes', value: 30 }], 2]],
      },
    },
    fixtures: [
      ...feed.fixtures,
      {
        id: 2,
        code: 999,
        team_h: 3,
        team_a: 4,
        started: true,
        finished: false,
        finished_provisional: false,
        team_h_score: 1,
        team_a_score: 0,
        stats: [],
      },
    ],
  };
  const events = {
    homeTeam: { goals: [{ period: 'FirstHalf', time: '12', goalType: 'Goal', playerId: '1007', assistPlayerId: null }] },
    awayTeam: {},
  };

  it('adds the stats and moments of the matches being played, its players by their codes', async () => {
    const upstream = mock.method(globalThis, 'fetch', async (url: string) => Response.json(url.includes('pulselive') ? events : playing));
    const body = await (await call('/live/7')).json();
    assert.deepEqual(Object.keys(body.matches), ['2']); // not the match long over
    assert.equal(body.matches[2][7][2], 0.45); // PL_STATS' expected_goals
    assert.deepEqual(body.moments, { 2: [[12, 1, 'goal', 1007]] });
    assert.ok(upstream.mock.calls.some((c) => String(c.arguments[0]).endsWith('/matches/999/events')));
  });

  it('still relays the scores when the match centre fails', async () => {
    mock.method(globalThis, 'fetch', async (url: string) =>
      url.includes('pulselive') ? new Response('busy', { status: 503 }) : Response.json(playing),
    );
    const res = await call('/live/7');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.moments, {});
    assert.ok(body.matches[2][7]);
  });

  it('only relays gameweeks 1 to 38', async () => {
    mock.method(globalThis, 'fetch', async () => Response.json(feed));
    for (const path of ['/live/0', '/live/39', '/live/7/x', '/api/entry/1', '/']) assert.equal((await call(path)).status, 404, path);
    assert.equal((await call('/live/7', 'POST')).status, 404);
    assert.equal((await call('/live/7', 'OPTIONS')).status, 200);
  });

  it('refuses a feed that changed shape', async () => {
    mock.method(globalThis, 'fetch', async () => Response.json({ elements: [] }));
    assert.equal((await call('/live/7')).status, 502);
  });

  it('passes on an upstream error', async () => {
    mock.method(globalThis, 'fetch', async () => new Response('busy', { status: 503 }));
    assert.equal((await call('/live/7')).status, 502);
  });

  it("relays this league's transfers", async () => {
    const answers: Record<string, unknown> = {
      transactions: { transactions: [] },
      trades: { trades: [] },
      'element-status': { element_status: [{ element: 5, owner: 10 }] },
    };
    const upstream = mock.method(globalThis, 'fetch', async (url: string) => Response.json(answers[url.split('/').at(-1)!]));
    const res = await call('/transfers');
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).owners, { 5: 10 });
    assert.ok(upstream.mock.calls.every((c) => String(c.arguments[0]).includes('/23793/')));
  });
});

describe('polls', () => {
  afterEach(() => mock.restoreAll());

  // Cloudflare's Durable Objects as the Worker uses them: one Poll per name, with its storage in a Map.
  function polls(env: { SITE_URL?: string }) {
    const objects = new Map<string, Poll>();
    return {
      idFromName: (name: string) => ({ toString: () => name }),
      get: (id: { toString(): string }) => ({
        fetch: (input: string | Request, init?: RequestInit) => {
          const name = id.toString();
          if (!objects.has(name)) {
            const data = new Map<string, unknown>();
            const storage = {
              get: async <T>(key: string) => structuredClone(data.get(key)) as T | undefined,
              put: async (entries: Record<string, unknown>) => Object.entries(entries).forEach(([k, v]) => data.set(k, structuredClone(v))),
            };
            objects.set(name, new Poll({ storage }, env));
          }
          return objects.get(name)!.fetch(new Request(input, init));
        },
      }),
    };
  }

  const site = 'https://site.example';
  const siteData = {
    meta: { season: '2026/27' },
    gameweeks: [
      { id: 9, deadline: '2026-10-31T11:00:00Z' },
      { id: 8, deadline: '2026-10-23T17:30:00Z' },
    ],
    matches: [
      { gw: 9, home: 11, away: 22 },
      { gw: 8, home: 11, away: 33 },
    ],
  };
  const setup = () => {
    const env = { SITE_URL: site };
    const upstream = mock.method(globalThis, 'fetch', async () => Response.json(siteData));
    mock.method(Date, 'now', () => Date.parse('2026-10-25T12:00:00Z'));
    const fullEnv = { ...env, POLLS: polls(env) };
    const send = (path: string, init?: RequestInit) => worker.fetch(new Request(`https://relay.example${path}`, init), fullEnv, ctx);
    const vote = (path: string, body: unknown) =>
      send(path, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
    return { upstream, send, vote };
  };
  const voter = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
  const other = 'f0e1d2c3-b4a5-4968-8776-655443322110';
  const path = '/poll/2026-27/9/11-22';

  it('counts one vote per visitor, and answers with the counts and CORS', async () => {
    const { send, vote } = setup();
    const empty = await send(path);
    assert.equal(empty.headers.get('access-control-allow-origin'), '*');
    assert.deepEqual(await empty.json(), { votes: [0, 0, 0] });

    assert.deepEqual(await (await vote(path, { voter, choice: 'away' })).json(), { votes: [0, 0, 1], choice: 'away' });
    assert.deepEqual(await (await vote(path, { voter: other, choice: 'draw' })).json(), { votes: [0, 1, 1], choice: 'draw' });
    // A second vote changes nothing, and says which one counted.
    assert.deepEqual(await (await vote(path, { voter, choice: 'home' })).json(), { votes: [0, 1, 1], choice: 'away' });
    assert.deepEqual(await (await send(path)).json(), { votes: [0, 1, 1] });
  });

  it('closes at the deadline in the site’s data.json, and only takes its matches', async () => {
    const { upstream, vote } = setup();
    assert.equal((await vote('/poll/2026-27/8/11-33', { voter, choice: 'home' })).status, 403);
    assert.equal((await vote('/poll/2026-27/9/22-11', { voter, choice: 'home' })).status, 404); // the other way round
    assert.equal((await vote('/poll/2025-26/9/11-22', { voter, choice: 'home' })).status, 404); // last season's
    assert.equal(upstream.mock.calls[0].arguments[0], `${site}/data.json`);
    // The deadline is kept: the second vote doesn't ask again.
    await vote(path, { voter, choice: 'home' });
    const asked = upstream.mock.callCount();
    await vote(path, { voter: other, choice: 'home' });
    assert.equal(upstream.mock.callCount(), asked);
  });

  it('refuses malformed votes and addresses', async () => {
    const { send, vote } = setup();
    for (const body of ['nope', { voter, choice: 'win' }, { voter: 'short', choice: 'home' }, { choice: 'home' }, [voter, 'home']])
      assert.equal((await vote(path, body)).status, 400, JSON.stringify(body));
    assert.equal((await vote(path, { voter, choice: 'home', pad: 'x'.repeat(300) })).status, 413);
    for (const bad of ['/poll/2026-27/39/11-22', '/poll/2026-27/9/11-11', '/poll/26-27/9/11-22', '/poll/2026-27/9/11-22/x', '/poll/'])
      assert.equal((await send(bad)).status, 404, bad);
    assert.equal((await send(path, { method: 'PUT' })).status, 404);
    assert.equal((await send(path, { method: 'OPTIONS' })).headers.get('access-control-allow-methods'), 'GET, POST, OPTIONS');
  });

  it('is not found where the Worker has no polls', async () => {
    assert.equal((await call(path)).status, 404);
  });
});

describe('build timer', () => {
  afterEach(() => mock.restoreAll());
  const at = (iso: string) => new Date(iso);
  const fire = (iso: string, env: object) =>
    new Promise<void>((done) => {
      const waits: Promise<unknown>[] = [];
      worker.scheduled({ scheduledTime: Date.parse(iso) }, env, { waitUntil: (p) => void waits.push(p) });
      Promise.all(waits).then(() => done());
    });

  it('builds every 10 minutes in the match windows and hourly otherwise', () => {
    assert.equal(buildDue(at('2026-10-24T15:40:00Z')), true); // Saturday afternoon
    assert.equal(buildDue(at('2026-10-27T19:20:00Z')), true); // Tuesday evening
    assert.equal(buildDue(at('2026-10-27T09:20:00Z')), false); // Tuesday morning…
    assert.equal(buildDue(at('2026-10-27T09:00:00Z')), true); // …except on the hour
    assert.equal(buildDue(at('2026-10-25T21:30:00Z')), false); // Sunday night
  });

  it('starts the GitHub workflow with the token', async () => {
    const github = mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }));
    await fire('2026-10-24T15:40:00Z', { GITHUB_TOKEN: 'test-token', GITHUB_REPO: 'owner/repo' });
    const [url, init] = github.mock.calls[0].arguments as [string, RequestInit];
    assert.equal(url, 'https://api.github.com/repos/owner/repo/actions/workflows/update.yml/dispatches');
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer test-token');
    assert.deepEqual(JSON.parse(init.body as string), { ref: 'main', inputs: { trigger: 'timer' } });
  });

  it('does nothing without a token, or between builds', async () => {
    const github = mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }));
    await fire('2026-10-24T15:40:00Z', { GITHUB_REPO: 'owner/repo' });
    await fire('2026-10-27T09:20:00Z', { GITHUB_TOKEN: 'test-token', GITHUB_REPO: 'owner/repo' });
    assert.equal(github.mock.callCount(), 0);
  });

  it('builds between times when a transfer has gone through since the last build', async () => {
    const env = { GITHUB_TOKEN: 'test-token', GITHUB_REPO: 'owner/repo', SITE_URL: 'https://site.example' };
    const players = { 1: { owner: 7 }, 2: { owner: null } };
    // FPL's owner for player 2, against the site's null.
    const respond = (owner: number | null) =>
      mock.method(globalThis, 'fetch', async (url: string) =>
        url.includes('element-status')
          ? Response.json({
              element_status: [
                { element: 1, owner: 7 },
                { element: 2, owner },
              ],
            })
          : url.startsWith(env.SITE_URL)
            ? Response.json({ players })
            : new Response(null, { status: 204 }),
      );
    const unchanged = respond(null);
    await fire('2026-10-27T09:20:00Z', env);
    assert.equal(unchanged.mock.callCount(), 2); // the two checks, no build
    mock.restoreAll();
    const signed = respond(9);
    await fire('2026-10-27T09:20:00Z', env);
    assert.equal(signed.mock.callCount(), 3);
    assert.match(signed.mock.calls[2].arguments[0] as string, /dispatches$/);
  });

  // What started a build under the old timer, which fired every 10 minutes.
  const oldTimer = (at: Date) => at.getUTCMinutes() % 10 === 0 && buildDue(at);

  it('keeps its build cadence now that the timer fires every minute', () => {
    const week = Date.parse('2026-10-19T00:00:00Z'); // Monday to Sunday
    let builds = 0;
    for (let minute = 0; minute < 7 * 24 * 60; minute++) {
      const at = new Date(week + minute * 60_000);
      assert.equal(buildFiring(at) && buildDue(at), oldTimer(at), at.toISOString());
      builds += Number(buildFiring(at) && buildDue(at));
    }
    // Hourly, and every 10 minutes in the windows: 4 hours on weekday evenings, 11 on Saturday, 10 on Sunday.
    assert.equal(builds, 7 * 24 + 5 * 4 * 5 + 11 * 5 + 10 * 5);
  });

  it('starts no build, nor looks at transfers, in the minutes between', async () => {
    const env = { GITHUB_TOKEN: 'test-token', GITHUB_REPO: 'owner/repo', SITE_URL: 'https://site.example' };
    const calls = mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }));
    for (const iso of ['2026-10-24T15:41:00Z', '2026-10-24T15:49:00Z', '2026-10-27T09:01:00Z']) await fire(iso, env);
    assert.equal(calls.mock.callCount(), 0);
    await fire('2026-10-24T15:50:00Z', env);
    assert.equal(calls.mock.callCount(), 1);
  });

  it('hands every minute of a gameweek being played to its object, with the build’s firings too, and none once it’s finished', async () => {
    const asked: string[] = [];
    const IN_PLAY = {
      idFromName: (name: string) => ({ toString: () => name }),
      get: (id: { toString(): string }) => ({
        fetch: async (input: string | Request) => {
          asked.push(`${id.toString()} ${String(input)}`);
          return Response.json({ added: 0 });
        },
      }),
    };
    const answer = (finished: boolean) =>
      mock.method(globalThis, 'fetch', async (url: string) =>
        String(url) === 'https://draft.premierleague.com/api/game'
          ? Response.json({ current_event: 9, current_event_finished: finished, next_event: 10 })
          : new Response(null, { status: 403 }),
      );
    const fpl = answer(false);
    // During a match, at a build's firing, and on a Tuesday morning with nothing on: the object decides.
    for (const iso of ['2026-10-24T15:41:00Z', '2026-10-24T15:50:00Z', '2026-10-27T09:01:00Z']) await fire(iso, { IN_PLAY });
    assert.deepEqual(asked, Array(3).fill('2026-27:9 https://in-play/record/2026-27/9'));
    assert.ok(fpl.mock.calls.every((call) => !String(call.arguments[0]).includes('fantasy.premierleague.com')));
    mock.restoreAll();
    forgetLookups();
    answer(true);
    await fire('2026-10-28T09:01:00Z', { IN_PLAY });
    assert.equal(asked.length, 3);
    forgetLookups();
  });
});

describe('the win chance’s records', () => {
  afterEach(() => mock.restoreAll());
  const records = { '11-22': [[1290, 450, 300, 12, 7]] };
  const objects = (answer: () => Response) => {
    const asked: string[] = [];
    return {
      asked,
      ns: {
        idFromName: (name: string) => ({ toString: () => name }),
        get: (id: { toString(): string }) => ({
          fetch: async (_input: string | Request, init?: RequestInit) => {
            asked.push(`${init?.method ?? 'GET'} ${id.toString()}`);
            return answer();
          },
        }),
      },
    };
  };
  const send = (path: string, env: object, method = 'GET') =>
    worker.fetch(new Request(`https://relay.example${path}`, { method }), env, ctx);

  it('answers /in-play/<season>/<gw> with each head-to-head’s records from the gameweek’s object, and CORS', async () => {
    const { ns, asked } = objects(() => Response.json(records));
    const res = await send('/in-play/2026-27/9', { IN_PLAY: ns });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.equal(res.headers.get('content-type'), 'application/json');
    assert.equal(res.headers.get('cache-control'), 'public, max-age=30');
    assert.deepEqual(await res.json(), records);
    assert.deepEqual(asked, ['GET 2026-27:9']);
  });

  it('only reads them, for gameweeks 1 to 38, where the Worker has the objects', async () => {
    const { ns, asked } = objects(() => Response.json(records));
    for (const path of ['/in-play/2026-27/39', '/in-play/26-27/9', '/in-play/2026-27/9/x', '/in-play/2026-27'])
      assert.equal((await send(path, { IN_PLAY: ns })).status, 404, path);
    assert.equal((await send('/in-play/2026-27/9', { IN_PLAY: ns }, 'POST')).status, 404);
    assert.equal((await send('/in-play/2026-27/9', {})).status, 404);
    assert.equal((await send('/in-play/2026-27/9', { IN_PLAY: ns }, 'OPTIONS')).status, 200);
    assert.deepEqual(asked, []);
  });

  it('says so when the object can’t answer', async () => {
    const { ns } = objects(() => new Response('oops', { status: 500 }));
    const res = await send('/in-play/2026-27/9', { IN_PLAY: ns });
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });
});
