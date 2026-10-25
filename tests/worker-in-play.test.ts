import { drawIntoNothing } from './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { applyLatestLive } from '../src/app/live-scores.ts';
import { inPlayOdds } from '../src/app/match-odds.ts';
import { setData, setLive, state } from '../src/app/state.ts';
import type { InPlayRecord } from '../src/shared/data.ts';
import { recordsNow } from '../src/shared/in-play.ts';
import { slimFeed } from '../worker/feed.ts';
import { forgetLookups, InPlay, parseInPlayPath, playingNow, recordMinute, seasonAt, type InPlayEnv } from '../worker/in-play.ts';
import { annVBobLive } from './fixtures/match.ts';

// The page's stats file never comes: its live odds read the relay's matches instead.
drawIntoNothing();

// GW 3 (deadline 17:30 on Friday 28 August): Arsenal beat Chelsea at 11:30 on the Saturday,
// and Liverpool v Man City kicked off at 14:00, Haaland half an hour in with his tackles and
// clearances. Ann (Raya, Saka) v Bob (Palmer, Haaland), see annVBobLive().
const KICK_OFF = Date.parse('2026-08-29T14:00:00Z');
const NOW = KICK_OFF + 30 * 60_000;
const MINUTES = 1260; // since the deadline
const SITE = 'https://site.example';
const zero = { assists: 0, clean_sheets: 0, goals_conceded: 0 };
const played = (fixture: number, minutes: number, points: number) => [[[{ stat: 'minutes', value: minutes, points }], fixture]];

/** FPL's live feed for GW 3 at NOW, with Haaland's points and minutes as `haaland`. */
function rawFeed(haaland: [number, number] = [2, 30]) {
  return {
    elements: {
      11: { stats: { total_points: 2, minutes: 90, goals_scored: 0, ...zero }, explain: played(30, 90, 2) },
      12: { stats: { total_points: 9, minutes: 90, goals_scored: 1, ...zero }, explain: played(30, 90, 2) },
      13: { stats: { total_points: 2, minutes: 90, goals_scored: 0, ...zero }, explain: played(30, 90, 2) },
      18: { stats: { total_points: 1, minutes: 90, goals_scored: 0, ...zero }, explain: played(30, 90, 2) },
      15: {
        stats: {
          total_points: haaland[0],
          minutes: haaland[1],
          goals_scored: 0,
          ...zero,
          tackles: 2,
          clearances_blocks_interceptions: 4,
          bps: 12,
        },
        explain: played(31, haaland[1], 1),
      },
    },
    fixtures: [
      fixture(30, 1, 2, '2026-08-29T11:30:00Z', { finished_provisional: true, team_h_score: 2, team_a_score: 0 }),
      fixture(31, 3, 4, '2026-08-29T14:00:00Z', { stats: [{ s: 'bps', h: [], a: [{ element: 15, value: 12 }] }] }),
    ],
  };
}

function fixture(id: number, h: number, a: number, ko: string, rest: object = {}) {
  return {
    id,
    team_h: h,
    team_a: a,
    started: true,
    finished: false,
    finished_provisional: false,
    team_h_score: 0,
    team_a_score: 0,
    kickoff_time: ko,
    stats: [],
    ...rest,
  };
}

const GAME = { current_event: 3, current_event_finished: false, next_event: 4 };
const FIXTURES = [
  { id: 30, kickoff_time: '2026-08-29T11:30:00Z' },
  { id: 31, kickoff_time: '2026-08-29T14:00:00Z' },
  { id: 32, kickoff_time: null },
];

/** FPL and the site as fetch answers them, each answer counted by what was asked. */
function upstream(answers: { game?: unknown; fixtures?: unknown; live?: unknown; site?: unknown; fail?: string } = {}) {
  const asked: string[] = [];
  const fetch = mock.method(globalThis, 'fetch', async (url: string) => {
    const u = String(url);
    asked.push(u);
    const kind = u.endsWith('/api/game')
      ? 'game'
      : u.includes('/fixtures/')
        ? 'fixtures'
        : u.includes('/live')
          ? 'live'
          : u.startsWith(SITE)
            ? 'site'
            : 'other';
    if (answers.fail === kind) return new Response('busy', { status: 503 });
    const body = { game: GAME, fixtures: FIXTURES, live: rawFeed(), site: annVBobLive(), ...answers }[kind as 'game'];
    return Response.json(body ?? null);
  });
  return { fetch, asked, count: (part: string) => asked.filter((u) => u.includes(part)).length };
}

// Cloudflare's Durable Objects as the Worker uses them: one InPlay per name, with its storage in a Map.
function namespace(env: InPlayEnv) {
  const objects = new Map<string, InPlay>();
  const stored = new Map<string, Map<string, unknown>>();
  const asked: string[] = [];
  const ns: DurableObjectNamespace = {
    idFromName: (name: string) => ({ toString: () => name }),
    get: (id) => ({
      fetch: (input: string | Request, init?: RequestInit) => {
        const name = id.toString();
        asked.push(name);
        if (!objects.has(name)) {
          const data = new Map<string, unknown>();
          stored.set(name, data);
          const storage = {
            get: async <T>(key: string) => structuredClone(data.get(key)) as T | undefined,
            put: async (entries: Record<string, unknown>) => Object.entries(entries).forEach(([k, v]) => data.set(k, structuredClone(v))),
          };
          objects.set(name, new InPlay({ storage }, { ...env, IN_PLAY: ns }));
        }
        return objects.get(name)!.fetch(new Request(input, init));
      },
    }),
  };
  return { ns, asked, records: (name: string) => stored.get(name)?.get('records') as Record<string, InPlayRecord[]> | undefined };
}

// The live odds as the page's code works them out from the relay's slim feed of the same moment.
const shared = (raw = rawFeed(), now = NOW) => {
  const feed = slimFeed(raw as never, now);
  return recordsNow(annVBobLive(), feed, now, (f) => feed.matches[f]);
};

describe('the in-play route and season', () => {
  it('reads a gameweek’s address', () => {
    assert.deepEqual(parseInPlayPath('/in-play/2026-27/9'), { season: '2026-27', gw: 9 });
    for (const bad of ['/in-play/2026-27/39', '/in-play/26-27/9', '/in-play/2026-27/9/x', '/in-play/2026-27', '/in-play/2026/27/9'])
      assert.equal(parseInPlayPath(bad), null, bad);
  });

  it('places a moment in its season, from August to the end of May', () => {
    assert.equal(seasonAt(Date.parse('2026-08-14T19:00:00Z')), '2026-27');
    assert.equal(seasonAt(Date.parse('2026-12-31T23:59:00Z')), '2026-27');
    assert.equal(seasonAt(Date.parse('2027-05-23T15:00:00Z')), '2026-27');
    assert.equal(seasonAt(Date.parse('2099-07-01T00:00:00Z')), '2099-00');
  });
});

describe('the timer’s look at what’s on', () => {
  beforeEach(() => forgetLookups());
  afterEach(() => mock.restoreAll());

  it('finds the gameweek being played from kick-off until two and a half hours after', async () => {
    upstream();
    assert.equal(await playingNow(Date.parse('2026-08-29T11:29:00Z')), null); // before the first
    assert.deepEqual(await playingNow(Date.parse('2026-08-29T11:30:00Z')), { season: '2026-27', gw: 3 });
    assert.deepEqual(await playingNow(NOW), { season: '2026-27', gw: 3 });
    assert.deepEqual(await playingNow(KICK_OFF + 149 * 60_000), { season: '2026-27', gw: 3 });
    assert.equal(await playingNow(KICK_OFF + 150 * 60_000), null);
  });

  it('asks FPL’s game state every five minutes and the fixtures every ten, a few hundred bytes and a few KB', async () => {
    const { count } = upstream();
    for (let minute = 0; minute < 30; minute++) await playingNow(NOW + minute * 60_000);
    assert.equal(count('/api/game'), 6);
    assert.equal(count('/fixtures/?event=3'), 3);
  });

  it('finds nothing on once the gameweek is finished, or before one has begun, without asking for fixtures', async () => {
    const { count } = upstream({ game: { ...GAME, current_event_finished: true } });
    assert.equal(await playingNow(NOW), null);
    forgetLookups();
    upstream({ game: { ...GAME, current_event: null } });
    assert.equal(await playingNow(NOW), null);
    assert.equal(count('/fixtures/'), 0);
  });

  it('finds nothing on when FPL can’t be asked or answers oddly', async () => {
    for (const answers of [{ fail: 'game' }, { fail: 'fixtures' }, { game: { current_event: '3' } }, { fixtures: { fixtures: [] } }]) {
      forgetLookups();
      mock.restoreAll();
      upstream(answers);
      assert.equal(await playingNow(NOW), null, JSON.stringify(answers));
    }
    forgetLookups();
    mock.method(globalThis, 'fetch', async () => {
      throw new Error('offline');
    });
    assert.equal(await playingNow(NOW), null);
  });
});

describe('recording a minute', () => {
  beforeEach(() => forgetLookups());
  afterEach(() => mock.restoreAll());

  it('has the gameweek’s object record the shared live odds of each head-to-head being played', async () => {
    upstream();
    const objects = namespace({ SITE_URL: SITE });
    await recordMinute({ SITE_URL: SITE, IN_PLAY: objects.ns }, NOW);
    assert.deepEqual(objects.asked, ['2026-27:3']);
    const record = shared()['1-2'];
    assert.deepEqual(objects.records('2026-27:3'), { '1-2': [record] });
    assert.equal(record[0], MINUTES);
    assert.deepEqual(record.slice(3), [11, 7]);
  });

  it('records the live odds the page shows for the same data.json and feed', async () => {
    upstream();
    const objects = namespace({ SITE_URL: SITE });
    await recordMinute({ SITE_URL: SITE, IN_PLAY: objects.ns }, NOW);
    const [minutes, home, away, homePts, awayPts] = objects.records('2026-27:3')!['1-2'][0];
    // The page with the relay's feed, as its live poll has it.
    const d = annVBobLive();
    d.live = { ...d.live!, ...slimFeed(rawFeed() as never, NOW) };
    setData(d);
    setLive(null);
    applyLatestLive();
    state.xp = 'model';
    const { p } = inPlayOdds(d.matches.at(-1)!)!;
    assert.deepEqual([minutes, home, away, homePts, awayPts], [MINUTES, Math.round(p[0] * 1000), Math.round(p[2] * 1000), 11, 7]);
  });

  it('asks no object anything while nothing is on, or without the binding', async () => {
    const { count } = upstream();
    const objects = namespace({ SITE_URL: SITE });
    await recordMinute({ SITE_URL: SITE, IN_PLAY: objects.ns }, KICK_OFF + 200 * 60_000);
    await recordMinute({ SITE_URL: SITE }, NOW);
    assert.deepEqual(objects.asked, []);
    assert.equal(count(SITE), 0);
  });

  it('adds minute by minute, thinned as the build thins them, and keeps each gameweek apart', async () => {
    upstream();
    const objects = namespace({ SITE_URL: SITE });
    const env = { SITE_URL: SITE, IN_PLAY: objects.ns };
    await recordMinute(env, NOW);
    await recordMinute(env, NOW + 60_000); // as it was: nothing new
    assert.equal(objects.records('2026-27:3')!['1-2'].length, 1);
    // Haaland scores: a move, in a place of its own.
    mock.restoreAll();
    upstream({ live: rawFeed([8, 31]) });
    await recordMinute(env, NOW + 2 * 60_000);
    const records = objects.records('2026-27:3')!['1-2'];
    assert.deepEqual(records, [shared()['1-2'], shared(rawFeed([8, 31]), NOW + 2 * 60_000)['1-2']]);
    assert.deepEqual(records[1].slice(3), [11, 13]);
    // Another gameweek's object starts its own.
    mock.restoreAll();
    const gw4 = annVBobLive();
    gw4.live!.gw = 4;
    gw4.gameweeks[3].deadline = gw4.gameweeks[2].deadline;
    gw4.matches.at(-1)!.gw = 4;
    gw4.lineups[1][4] = gw4.lineups[1][3];
    gw4.lineups[2][4] = gw4.lineups[2][3];
    upstream({ game: { ...GAME, current_event: 4 }, site: gw4 });
    forgetLookups();
    const later = NOW + 10 * 60_000; // past the object's five minutes with the last data.json
    await recordMinute(env, later);
    assert.deepEqual(objects.asked.at(-1), '2026-27:4');
    assert.equal(objects.records('2026-27:4')!['1-2'].length, 1);
    assert.equal(objects.records('2026-27:3')!['1-2'].length, 2);
  });

  it('reads data.json once in five minutes', async () => {
    const { count } = upstream();
    const objects = namespace({ SITE_URL: SITE });
    for (let minute = 0; minute < 10; minute++) await recordMinute({ SITE_URL: SITE, IN_PLAY: objects.ns }, NOW + minute * 60_000);
    assert.equal(count(`${SITE}/data.json`), 2);
    assert.equal(count('/event/3/live'), 10);
  });

  it('records nothing until data.json has caught up with the gameweek, in its season', async () => {
    const behind = annVBobLive();
    behind.live!.gw = 2;
    upstream({ site: behind });
    const objects = namespace({ SITE_URL: SITE });
    await recordMinute({ SITE_URL: SITE, IN_PLAY: objects.ns }, NOW);
    assert.equal(objects.records('2026-27:3'), undefined);

    mock.restoreAll();
    const lastSeason = annVBobLive();
    lastSeason.meta.season = '2025/26';
    upstream({ site: lastSeason });
    const others = namespace({ SITE_URL: SITE });
    await recordMinute({ SITE_URL: SITE, IN_PLAY: others.ns }, NOW);
    assert.equal(others.records('2026-27:3'), undefined);
  });

  it('records nothing, and says so, when FPL or the site can’t be read', async () => {
    for (const answers of [{ fail: 'live' }, { live: { elements: [] } }, { fail: 'site' }, { site: { nothing: true } }]) {
      mock.restoreAll();
      const errors = mock.method(console, 'error', () => {});
      upstream(answers);
      forgetLookups();
      const objects = namespace({ SITE_URL: SITE });
      await recordMinute({ SITE_URL: SITE, IN_PLAY: objects.ns }, NOW);
      assert.equal(objects.records('2026-27:3'), undefined, JSON.stringify(answers));
      assert.match(String(errors.mock.calls[0]?.arguments[0]), /record for 2026-27:3 failed: 503/);
    }
    const objects = namespace({});
    upstream();
    await recordMinute({ IN_PLAY: objects.ns }, NOW); // no site to read
    assert.equal(objects.records('2026-27:3'), undefined);
  });

  it('asks the site no more often when it fails', async () => {
    const { count } = upstream({ fail: 'site' });
    mock.method(console, 'error', () => {});
    const objects = namespace({ SITE_URL: SITE });
    for (let minute = 0; minute < 10; minute++) await recordMinute({ SITE_URL: SITE, IN_PLAY: objects.ns }, NOW + minute * 60_000);
    assert.equal(count(`${SITE}/data.json`), 2);
    assert.equal(count('/event/3/live'), 0);
  });

  it('keeps the last data.json it read when the site stops answering', async () => {
    upstream();
    const objects = namespace({ SITE_URL: SITE });
    const env = { SITE_URL: SITE, IN_PLAY: objects.ns };
    await recordMinute(env, NOW);
    mock.restoreAll();
    upstream({ fail: 'site', live: rawFeed([8, 31]) });
    forgetLookups();
    await recordMinute(env, NOW + 6 * 60_000);
    assert.equal(objects.records('2026-27:3')!['1-2'].length, 2);
  });

  it('answers a read with the records, and refuses a record it can’t place', async () => {
    upstream();
    const objects = namespace({ SITE_URL: SITE });
    await recordMinute({ SITE_URL: SITE, IN_PLAY: objects.ns }, NOW);
    const stub = objects.ns.get(objects.ns.idFromName('2026-27:3'));
    assert.deepEqual(await (await stub.fetch('https://in-play/records')).json(), { '1-2': [shared()['1-2']] });
    for (const [path, body] of [
      ['/record/2026-27/39', { now: NOW }],
      ['/record/2026-27/3', { now: 'soon' }],
      ['/record/2026-27/3', 'nope'],
    ] as const) {
      const res = await stub.fetch(`https://in-play${path}`, {
        method: 'POST',
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });
      assert.equal(res.status, 404, `${path} ${JSON.stringify(body)}`);
    }
    // A fresh object reads as none.
    assert.deepEqual(await (await objects.ns.get(objects.ns.idFromName('2026-27:5')).fetch('https://in-play/records')).json(), {});
  });
});
