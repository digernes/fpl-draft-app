import { drawIntoNothing } from './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { forgetRelayed, IN_PLAY_POLL_MS, recordsOf, refreshInPlay } from '../src/app/in-play-records.ts';
import { D, LIVE_URL, setData, setSeasons, state } from '../src/app/state.ts';
import type { InPlayRecord, Match } from '../src/shared/data.ts';
import { annVBobLive } from './fixtures/match.ts';

drawIntoNothing();

// GW 3 under way: Ann v Bob, with two records from the builds in data.json; the relay has
// recorded every minute since.
const built: InPlayRecord[] = [
  [1080, 700, 200, 11, 2],
  [1240, 650, 250, 11, 4],
];
const relayed: InPlayRecord[] = [
  [1242, 640, 260, 11, 4],
  [1250, 600, 300, 11, 6],
  [1260, 550, 350, 11, 7],
];
const game = () => D.matches.find((m) => m.gw === 3)!;
const PATH = `${LIVE_URL}/in-play/2026-27/3`;
let clock = Date.parse('2026-08-29T14:30:00Z');

/** The relay answering `answer` for the records, counting what it was asked; anything else a redraw asks for never comes. */
function relay(answer: () => Response | Promise<Response> = () => Response.json({ '1-2': relayed })) {
  const calls: unknown[][] = [];
  mock.method(globalThis, 'fetch', (url: string, init?: RequestInit) => {
    if (url !== PATH) return new Promise(() => {});
    calls.push([url, init]);
    return (async () => answer())();
  });
  return { count: () => calls.length, calls };
}
const settle = () => new Promise((done) => setImmediate(done));

beforeEach(() => {
  forgetRelayed();
  const d = annVBobLive();
  d.matches.find((m) => m.gw === 3)!.inPlay = built;
  setData(d);
  setSeasons([]);
  state.season = null;
  state.route = { page: 'match', tab: 'facts', gw: 3, home: 1, away: 2 };
  clock += 10 * IN_PLAY_POLL_MS; // each test starts long after the last one asked
  mock.method(Date, 'now', () => clock);
});
afterEach(() => mock.restoreAll());

describe('the win chance’s records while the gameweek is played', () => {
  it('are data.json’s until the relay answers, then the relay’s laid over them', async () => {
    const asked = relay();
    assert.equal(recordsOf(game()), built);
    await settle();
    assert.deepEqual(recordsOf(game()), [built[0], ...relayed]);
    assert.equal(asked.count(), 1);
    assert.deepEqual(asked.calls[0][1], { cache: 'no-store' });
  });

  it('ask the relay at most once a minute, the first time they’re wanted and with the live poll after that', async () => {
    const asked = relay();
    recordsOf(game());
    await settle();
    recordsOf(game());
    await refreshInPlay();
    assert.equal(asked.count(), 1);
    clock += IN_PLAY_POLL_MS;
    await refreshInPlay();
    recordsOf(game());
    assert.equal(asked.count(), 2);
  });

  it('keep the relay’s latest as they grow', async () => {
    relay();
    await refreshInPlay();
    mock.restoreAll();
    mock.method(Date, 'now', () => clock);
    const more: InPlayRecord = [1261, 500, 400, 11, 9];
    relay(() => Response.json({ '1-2': [...relayed, more] }));
    clock += IN_PLAY_POLL_MS;
    await refreshInPlay();
    assert.deepEqual(recordsOf(game()), [built[0], ...relayed, more]);
  });

  it('are asked for only on a head-to-head’s page of the gameweek being played', async () => {
    const asked = relay();
    for (const route of [
      { page: 'home', tab: '' },
      { page: 'match', tab: 'facts', gw: 2, home: 1, away: 2 },
    ] as const) {
      state.route = { ...route };
      await refreshInPlay();
    }
    assert.equal(asked.count(), 0);
    // Nor for another gameweek's match, which has data.json's.
    const earlier: Match = { ...game(), gw: 2, inPlay: built };
    assert.equal(recordsOf(earlier), built);
    assert.equal(asked.count(), 0);
  });

  it('are data.json’s alone once the gameweek is over, or in an archive', async () => {
    const asked = relay();
    game().finished = true;
    assert.equal(recordsOf(game()), built);
    game().finished = false;
    setSeasons([{ season: '2026/27', file: 'seasons/2026-27.json', current: false } as never]);
    state.season = '2026-27';
    assert.equal(recordsOf(game()), built);
    await refreshInPlay();
    assert.equal(asked.count(), 0);
  });

  it('are data.json’s, without an error, while the relay fails, and asked for again a minute on', async () => {
    const answers = [
      () => new Response('Not found', { status: 404 }),
      () => new Response('<html>'),
      () => Response.json({ '1-2': 'nope' }),
      () => {
        throw new TypeError('Failed to fetch');
      },
    ];
    for (const answer of answers) {
      mock.restoreAll();
      mock.method(Date, 'now', () => clock);
      const asked = relay(answer);
      assert.equal(recordsOf(game()), built);
      await settle();
      assert.equal(recordsOf(game()), built, String(answer));
      assert.equal(asked.count(), 1);
      clock += IN_PLAY_POLL_MS;
    }
  });

  it('are another season’s or gameweek’s no more once data.json has moved on', async () => {
    relay();
    await refreshInPlay();
    D.meta.season = '2027/28';
    mock.restoreAll();
    mock.method(globalThis, 'fetch', () => new Promise(() => {})); // the new season's never come
    assert.equal(recordsOf(game()), built);
  });
});
