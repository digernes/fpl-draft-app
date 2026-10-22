import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import worker from '../worker/index.ts';
import { buildDue } from '../worker/timer.ts';

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
});
