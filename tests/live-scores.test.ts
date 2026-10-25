import { drawIntoNothing } from './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { applyLatestLive, loadData, loadSeasons, pollLive, pollTransfers, refresh, scheduleRefresh } from '../src/app/live-scores.ts';
import { D, live, LIVE_URL, seasons, setData, setLive, setSeasons, state } from '../src/app/state.ts';
import type { Data, LiveData, SeasonEntry } from '../src/shared/data.ts';
import type { SlimLive } from '../src/shared/live.ts';
import type { SlimTransfers } from '../src/shared/transfers.ts';
import { lineup, match, player, squads } from './fixtures/league.ts';

// GW 3 is being played. Arsenal beat Chelsea, the bonus still to be awarded: Saka has 8 points
// and the most BPS, Gabriel 6 and Palmer 2, Isak came on for half an hour; Raya didn't play,
// so Ramsdale, on Ann's bench, comes on for him. Man City v Liverpool is still to come.
const FILLERS = [21, 22, 23, 24, 25, 26, 27, 28, 29];

function feed(): LiveData {
  return {
    gw: 3,
    ep: {},
    elements: { 12: [8, 90], 18: [6, 90], 13: [2, 90], 11: [0, 0], 30: [2, 90], 16: [2, 30] },
    fixtures: [
      {
        id: 10,
        h: 1,
        a: 2,
        started: true,
        done: true,
        score: [2, 0],
        bps: [
          [12, 40],
          [18, 30],
          [13, 20],
        ],
      },
      { id: 11, h: 4, a: 3, started: false, done: false },
    ],
  };
}

function data(): Data {
  const d = squads();
  d.meta.formation = { DEF: 3, MID: 1, FWD: 0 };
  d.meta.dgwPenalty = 4;
  d.players[30] = player('Ramsdale', 'GKP', 1, 10, 1);
  for (const pid of FILLERS) d.players[pid] = player(`Filler ${pid}`, 'DEF', 3, 0);
  d.gameweeks[2].doubles = [4]; // Man City play twice
  // Ann: Raya, Saka and the rest, with Ramsdale and Gabriel on the bench; Bob: Palmer and
  // Haaland and the rest, with Isak on the bench. Cy's lineup is in already.
  const picks = (xi: number[], bench: number[]) => ({ ...lineup([...xi, ...FILLERS], bench), picks: [...xi, ...FILLERS, ...bench] });
  d.lineups = {
    1: { 3: picks([11, 12], [30, 18]) },
    2: { 3: picks([13, 15], [16]) },
    3: { 3: lineup([14], [17], 20) },
  };
  d.matches.push({ ...match(3, 1, 2, 0, 0, false) });
  d.live = feed();
  return d;
}

const liveMatch = () => D.matches.find((m) => m.gw === 3)!;

beforeEach(() => {
  setData(data());
  setLive(null);
  setSeasons([]);
  state.season = null;
});

afterEach(() => {
  setSeasons([]);
  state.season = null;
});

describe('applying the live feed', () => {
  it('re-scores each lineup with its picks, bringing a bench player on for a starter who didn’t play', () => {
    applyLatestLive();
    assert.equal(live?.gw, 3);
    const ann = live!.lineups[1];
    assert.deepEqual([ann.subs, ann.off], [[30], [11]]);
    assert.ok(ann.xi.includes(30) && !ann.xi.includes(11));
    assert.deepEqual(ann.bench, [11, 18]);
    // Saka's 8 and 3 provisional bonus, and Ramsdale's 2; Gabriel's 8 on the bench don't count.
    assert.equal(ann.pts, 13);
    assert.equal(ann.benchPts, 8);
  });

  it('adds the provisional bonus to the points, and says how much of them it is', () => {
    applyLatestLive();
    assert.deepEqual(
      [12, 18, 13].map((pid) => [live!.points(pid), live!.bonus(pid)]),
      [
        [11, 3],
        [8, 2],
        [3, 1],
      ],
    );
  });

  it('puts the new scores in the head-to-heads being played, and leaves the finished ones alone', () => {
    applyLatestLive();
    assert.deepEqual([liveMatch().homePts, liveMatch().awayPts], [13, 3]);
    assert.deepEqual(
      D.matches.filter((m) => m.gw < 3).map((m) => [m.homePts, m.awayPts]),
      [
        [50, 40],
        [30, 30],
        [45, 60],
      ],
    );
  });

  it('takes the penalty off for each starter whose club plays twice', () => {
    applyLatestLive();
    const bob = live!.lineups[2];
    assert.equal(bob.dgw, 1);
    assert.equal(bob.adj, bob.pts - 4);
    assert.equal(live!.lineups[1].dgw, 0);
  });

  it('keeps a lineup without picks out of the live scores', () => {
    applyLatestLive();
    assert.equal(live!.lineups[3], undefined);
  });

  it('brings a bench player on for a starter his club has left out, before his match is played', () => {
    applyLatestLive();
    assert.deepEqual(live!.lineups[2].subs, []);
    const d = data();
    d.plMatches = [
      {
        id: 11,
        gw: 3,
        home: 4,
        away: 3,
        ko: '2026-08-30T15:30:00Z',
        formations: [
          { shape: '4-4-2', lines: [[40]], subs: [41] },
          { shape: '4-4-2', lines: [[14, ...FILLERS]], subs: [] },
        ],
      },
    ];
    setData(d);
    applyLatestLive();
    const bob = live!.lineups[2];
    assert.deepEqual([bob.subs, bob.off], [[16], [15]]);
    assert.equal(bob.pts, 5); // Palmer's 3 and Isak's 2
  });

  it('takes the relay’s feed for the gameweek over the one data.json came with', () => {
    const relay: SlimLive = { ...feed(), elements: { ...feed().elements, 12: [15, 90] } };
    setLive({ gw: 3, feed: relay, lineups: {}, points: () => 0, bonus: () => 0 });
    applyLatestLive();
    assert.equal(live!.feed, relay);
    assert.equal(liveMatch().homePts, 20);
  });

  it('ignores a relay feed from another gameweek', () => {
    setLive({ gw: 2, feed: { elements: {}, fixtures: [] }, lineups: {}, points: () => 0, bonus: () => 0 });
    applyLatestLive();
    assert.equal(live!.gw, 3);
    assert.equal(liveMatch().homePts, 13);
  });

  it('changes nothing without a feed for the gameweek being played', () => {
    const d = data();
    d.live = { ...feed(), gw: 2 };
    setData(d);
    applyLatestLive();
    assert.equal(live, null);
    assert.deepEqual([liveMatch().homePts, liveMatch().awayPts], [0, 0]);
  });

  it('has nothing live in an archived season', () => {
    setLive({ gw: 3, feed: feed(), lineups: {}, points: () => 0, bonus: () => 0 });
    setSeasons([{ season: '2025/26', name: 'Last season', file: 'seasons/2025-26/data.json' }]);
    state.season = '2025-26';
    applyLatestLive();
    assert.equal(live, null);
    assert.deepEqual([liveMatch().homePts, liveMatch().awayPts], [0, 0]);
  });
});

// --- Asking for data.json and the relay ------------------------------------------------------

// What the page asked for, and what it's answered: a path's JSON, a failed request where
// `answers` has an Error, and a 404 for anything else.
const requests: string[] = [];
let answers: Record<string, unknown> = {};
const page: Record<string, unknown> = { hidden: false };
drawIntoNothing(page);
Object.assign(globalThis, {
  fetch: async (url: string) => {
    requests.push(url);
    const path = url.replace(LIVE_URL, 'relay:').replace(/\?.*$/, '');
    const answer = answers[path];
    if (answer instanceof Error) throw answer;
    return answer === undefined ? { ok: false, status: 404 } : { ok: true, json: async () => structuredClone(answer) };
  },
});
const asked = () => requests.map((url) => url.replace(LIVE_URL, 'relay:').replace(/\?.*$/, ''));
// Lets the requests the page made answer, and what it does with the answers happen.
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};

const LAST: SeasonEntry = { season: '2025/26', name: 'Last season', file: 'seasons/2025-26/data.json' };
const THIS: SeasonEntry = { season: '2026/27', name: 'This season', file: 'data.json', current: true };

// The page's clock, a day on for each test, so data.json is never just loaded; timers run
// on it, at the test's say.
let clock = Date.now();
function startClock() {
  clock += 864e5;
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: clock });
}

// Once what a test started has finished, an archived season stops every poll and the
// refresh, and the clock is the real one again.
async function stopPolling() {
  await settle();
  setSeasons([LAST, THIS]);
  state.season = '2025-26';
  await pollLive();
  await pollTransfers();
  scheduleRefresh();
  mock.timers.reset();
}
const at = (stamp: string): Data => ({ ...data(), meta: { ...data().meta, generatedAt: stamp } });

describe('loading the seasons', () => {
  beforeEach(() => {
    requests.length = 0;
    answers = { 'seasons/index.json': { seasons: [LAST, THIS] } };
  });

  afterEach(() => {
    (globalThis as { location: { href: string } }).location.href = 'http://localhost/';
  });

  it('lists the seasons, and opens an archived one the address asks for', async () => {
    (globalThis as { location: { href: string } }).location.href = 'http://localhost/?season=2025-26';
    await loadSeasons();
    assert.deepEqual(seasons, [LAST, THIS]);
    assert.equal(state.season, '2025-26');
  });

  it('opens the current season when the address asks for it or for one it doesn’t know', async () => {
    (globalThis as { location: { href: string } }).location.href = 'http://localhost/?season=2026-27';
    await loadSeasons();
    assert.equal(state.season, null);
    (globalThis as { location: { href: string } }).location.href = 'http://localhost/?season=1999-00';
    await loadSeasons();
    assert.equal(state.season, null);
  });

  it('has just the current season when there’s no archive yet, or it can’t be had', async () => {
    answers = {};
    await loadSeasons();
    assert.deepEqual(seasons, []);
    answers = { 'seasons/index.json': new Error('offline') };
    await loadSeasons();
    assert.deepEqual(seasons, []);
  });
});

describe('loading data.json', () => {
  beforeEach(() => {
    requests.length = 0;
    answers = { 'data.json': at('2026-08-29T12:00:00Z'), 'seasons/2025-26/data.json': at('2026-05-25T18:00:00Z') };
    setData(at('2026-08-29T11:50:00Z'));
  });

  it('says whether it has changed since the last build', async () => {
    assert.equal(await loadData(), true);
    assert.equal(D.meta.generatedAt, '2026-08-29T12:00:00Z');
    assert.equal(await loadData(), false);
    assert.deepEqual(asked(), ['data.json', 'data.json']);
  });

  it('loads the archived season being viewed', async () => {
    setSeasons([LAST, THIS]);
    state.season = '2025-26';
    await loadData();
    assert.deepEqual(asked(), ['seasons/2025-26/data.json']);
    assert.equal(D.meta.generatedAt, '2026-05-25T18:00:00Z');
  });

  it('fails when data.json can’t be had, keeping what the page has', async () => {
    answers = {};
    await assert.rejects(loadData(), /HTTP 404/);
    assert.equal(D.meta.generatedAt, '2026-08-29T11:50:00Z');
  });
});

describe('polling the relay', () => {
  // The relay's feed with Man City v Liverpool under way, or not.
  const relayFeed = (on: boolean): SlimLive => ({
    ...feed(),
    elements: { ...feed().elements, 12: [10, 90] },
    fixtures: [feed().fixtures[0], { id: 11, h: 4, a: 3, started: on, done: false }],
  });

  beforeEach(() => {
    startClock();
    requests.length = 0;
    answers = { 'relay:/live/3': relayFeed(true) };
    page.hidden = false;
    state.route = { page: 'player', tab: '', id: 12 };
  });

  afterEach(stopPolling);

  it('puts the relay’s scores in, and asks again every half a minute while a match is on', async () => {
    await pollLive();
    assert.deepEqual(asked(), ['relay:/live/3']);
    assert.equal(live?.feed.elements[12][0], 10);
    assert.equal(liveMatch().homePts, 15); // Saka's 10 and 3 bonus, and Ramsdale's 2
    mock.timers.tick(29_000);
    assert.equal(requests.length, 1);
    mock.timers.tick(1_000);
    await settle();
    assert.equal(requests.length, 2);
  });

  it('asks every five minutes between the gameweek’s match days', async () => {
    answers = { 'relay:/live/3': relayFeed(false) };
    await pollLive();
    mock.timers.tick(30_000);
    assert.equal(requests.length, 1);
    mock.timers.tick(270_000);
    await settle();
    assert.equal(requests.length, 2);
  });

  it('keeps the last scores when the relay fails, and doesn’t ask while the page is hidden', async () => {
    applyLatestLive();
    answers = { 'relay:/live/3': new Error('offline') };
    await pollLive();
    assert.equal(liveMatch().homePts, 13);
    page.hidden = true;
    await pollLive();
    assert.equal(requests.length, 1);
  });

  it('asks for the win chance’s records with it on a head-to-head’s page, once a minute', async () => {
    state.route = { page: 'match', tab: 'facts', gw: 3, home: 1, away: 2 };
    answers['relay:/in-play/2026-27/3'] = { '1-2': [[1260, 500, 300, 15, 2]] };
    // The match's page asks for its stats file and poll too.
    const relayed = () => asked().filter((path) => /^relay:\/(live|in-play)\//.test(path));
    await pollLive();
    assert.deepEqual(relayed(), ['relay:/live/3', 'relay:/in-play/2026-27/3']);
    mock.timers.tick(30_000);
    await settle();
    assert.deepEqual(relayed().slice(2), ['relay:/live/3']);
    mock.timers.tick(30_000);
    await settle();
    assert.deepEqual(relayed().slice(3), ['relay:/live/3', 'relay:/in-play/2026-27/3']);
  });

  it('asks nothing without a gameweek being played, or in an archive', async () => {
    const d = data();
    d.matches = d.matches.filter((m) => m.finished);
    setData(d);
    await pollLive();
    setData(data());
    setSeasons([LAST, THIS]);
    state.season = '2025-26';
    await pollLive();
    assert.deepEqual(requests, []);
  });
});

describe('refreshing data.json', () => {
  beforeEach(() => {
    startClock();
    requests.length = 0;
    answers = { 'data.json': at('2026-08-29T12:00:00Z'), 'relay:/live/3': feed() };
    page.hidden = false;
    state.route = { page: 'player', tab: '', id: 12 };
  });

  afterEach(stopPolling);

  it('reloads it every ten minutes, and with a new build puts the live scores back in and polls the relay', async () => {
    const d = at('2026-08-29T11:50:00Z');
    d.matches = d.matches.filter((m) => m.finished);
    setData(d);
    scheduleRefresh();
    mock.timers.tick(599_000);
    assert.deepEqual(requests, []);
    mock.timers.tick(1_000);
    await settle();
    assert.equal(asked()[0], 'data.json');
    assert.equal(D.meta.generatedAt, '2026-08-29T12:00:00Z');
    assert.equal(live?.gw, 3);
    await settle();
    assert.ok(asked().includes('relay:/live/3'));
  });

  it('reloads it every two minutes while a gameweek is played', async () => {
    setData(at('2026-08-29T11:50:00Z'));
    scheduleRefresh();
    mock.timers.tick(120_000);
    await settle();
    assert.equal(asked()[0], 'data.json');
  });

  it('leaves an archived season alone, and doesn’t reload what it loaded a minute ago', async () => {
    setData(at('2026-08-29T11:50:00Z'));
    setSeasons([LAST, THIS]);
    state.season = '2025-26';
    scheduleRefresh();
    mock.timers.tick(3_600_000);
    await refresh();
    assert.deepEqual(requests, []);
    setSeasons([]);
    state.season = null;
    await refresh();
    await refresh();
    assert.deepEqual(
      asked().filter((path) => path === 'data.json'),
      ['data.json'],
    );
  });
});

describe('polling for transfers', () => {
  // Ann has signed White for Gabriel since the build; FPL's owners say so too, or not yet.
  const slim = (owned: boolean): SlimTransfers => ({
    moves: [{ type: 'free', manager: 1, in: 19, out: 18, gw: 3, added: '2026-08-29T09:00:00Z', order: 0 }],
    trades: [],
    owners: Object.fromEntries(
      Object.entries(data().players).flatMap(([pid, p]) => {
        const owner = owned && pid === '19' ? 1 : owned && pid === '18' ? null : p.owner;
        return owner ? [[pid, owner]] : [];
      }),
    ),
  });

  beforeEach(() => {
    startClock();
    requests.length = 0;
    answers = { 'relay:/transfers': slim(false), 'data.json': at('2026-08-29T12:00:00Z') };
    page.hidden = false;
    state.route = { page: 'player', tab: '', id: 12 };
    setData(at('2026-08-29T11:50:00Z'));
  });

  afterEach(stopPolling);

  it('adds the moves made since the build, and asks again every two minutes', async () => {
    await pollTransfers();
    assert.deepEqual(asked(), ['relay:/transfers']);
    assert.deepEqual(
      D.transfers.moves.map((mv) => [mv.manager, mv.in, mv.out]),
      [[1, 19, 18]],
    );
    mock.timers.tick(120_000);
    await settle();
    assert.deepEqual(asked(), ['relay:/transfers', 'relay:/transfers']);
  });

  it('looks for a new build every two minutes once FPL’s owners are ahead of data.json', async () => {
    answers['relay:/transfers'] = slim(true);
    await pollTransfers();
    assert.equal(D.players[19].owner, 1);
    mock.timers.tick(120_000);
    await settle();
    assert.ok(asked().includes('data.json'), asked().join());
  });

  it('keeps data.json’s moves when the relay fails, and asks nothing in an archive', async () => {
    answers['relay:/transfers'] = new Error('offline');
    await pollTransfers();
    assert.deepEqual(D.transfers.moves, []);
    requests.length = 0;
    setSeasons([LAST, THIS]);
    state.season = '2025-26';
    await pollTransfers();
    assert.deepEqual(requests, []);
  });
});
