import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import worker from '../worker/index.ts';

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
});
