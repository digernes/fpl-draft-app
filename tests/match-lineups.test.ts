import './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { matchLineups, projectedLineups, stateLabel } from '../src/app/match-lineups.ts';
import { setData, setLive, state, type LiveLineup } from '../src/app/state.ts';
import type { Data, LiveData, Match, Odds } from '../src/shared/data.ts';
import type { SlimLive } from '../src/shared/live.ts';
import { lineup, match, player, squads } from './fixtures/league.ts';

// The stats files never come in, so the underlying-number chips stay away.
Object.assign(globalThis, { fetch: () => new Promise(() => {}) });

// GW 3, Ann v Bob, under way. Arsenal lead Chelsea 1-0 after 55 minutes, Saka scoring, with
// Gabriel still on Arsenal's bench; Man City have beaten Liverpool, Haaland with 8 points;
// Spurs v Fulham, with Son, is still to kick off.
const feed = (): SlimLive => ({
  elements: { 12: [7, 55], 11: [2, 55], 13: [2, 55], 15: [8, 90] },
  events: { 12: { goals: 1 } },
  fixtures: [
    { id: 10, h: 1, a: 2, started: true, done: false, min: 55, score: [1, 0] },
    { id: 11, h: 3, a: 4, started: true, done: true, score: [0, 2] },
    { id: 12, h: 5, a: 6, started: false, done: false, ko: '2026-08-29T16:30:00Z' },
  ],
});
const ep = { 11: 3, 12: 5.2, 13: 4.5, 15: 6, 18: 2, 20: 4 };

function start(slim = feed(), more: Partial<LiveData> = {}, lineups: Record<number, LiveLineup> = {}) {
  const d: Data = squads();
  d.clubs[5] = { name: 'Spurs', short: 'TOT', logo: '', kit: null };
  d.clubs[6] = { name: 'Fulham', short: 'FUL', logo: '', kit: null };
  d.players[20] = player('Son', 'MID', 5, 30, 2);
  d.matches.push(match(3, 1, 2, 0, 0, false));
  d.lineups = { 1: { 3: lineup([11, 12], [18]) }, 2: { 3: lineup([13, 15, 20]) } };
  d.live = { gw: 3, ep, ...slim, ...more } as LiveData;
  setData(d);
  setLive({ gw: 3, feed: slim, lineups, points: (pid) => slim.elements[pid]?.[0] ?? 0, bonus: () => 0 });
  return matchLineups(d.matches.at(-1)!);
}

// A player's face on the pitch or his row on a bench.
const face = (html: string, pid: number) => html.split(`href="#/player/${pid}"`)[1].split('</a>')[0];
const pill = (html: string) => html.match(/<span class="ptsp[^"]*"[^>]*>[^<]*<\/span>/)?.[0] ?? '';

beforeEach(() => {
  state.due = '';
  state.lineupStat = '';
  state.xp = 'site';
});

describe('a head-to-head’s lineups while its gameweek is played', () => {
  it('shows points so far, and kick-offs for those still to play, by default', () => {
    const html = start();
    assert.match(pill(face(html, 12)), /^<span class="ptsp p2" data-tip="7 points so far · \d+\.\d projected[^"]*"/);
    assert.match(face(html, 12), /<i class="live-dot"><\/i>55'/);
    assert.match(face(html, 20), /<span class="ptsp ko"/);
    assert.match(html, /data-action="due" data-value="xp" aria-pressed="false" >Projected</);
  });

  it('with Projected, shows where the points of those on the pitch are heading, in the pill of those still to play', () => {
    state.due = 'xp';
    const html = start();
    const saka = face(html, 12);
    const [, heading, toCome] =
      pill(saka).match(
        /^<span class="ptsp xp live" data-tip="(\d+\.\d) projected · 7 points so far" data-tip-rows="([^"]*)">\1<\/span>$/,
      ) ?? [];
    assert.ok(Number(heading) > 7, heading);
    // What's still to come under a heading of its own: FPL's expected points come whole.
    assert.match(toCome, /^Still to come\nExpected points\t\d\.\d$/);
    // The pill's live class (its green figure) and his minute under his name tell him from one still to kick off.
    assert.match(saka, /<i class="live-dot"><\/i>55'/);
    assert.match(pill(face(html, 20)), /^<span class="ptsp xp" data-tip="4\.0 expected points \(not played yet\)">4\.0<\/span>$/);
    assert.doesNotMatch(face(html, 20), /live-dot/);
    assert.match(html, /data-action="due" data-value="ko" aria-pressed="true" >Projected</);
  });

  it('with Projected, keeps the points of one whose match is over, and of one waiting on his club’s bench', () => {
    state.due = 'xp';
    const html = start();
    assert.match(pill(face(html, 15)), /^<span class="ptsp p2"[^>]*>8<\/span>$/);
    assert.match(pill(face(html, 18)), /^<span class="ptsp p0"[^>]*>0<\/span>$/);
    assert.doesNotMatch(face(html, 18), /live-dot/);
  });

  it('offers Projected while a match is still being played after the last has kicked off, and not once all are over', () => {
    const slim = feed();
    slim.fixtures[2] = { ...slim.fixtures[2], started: true, min: 5, score: [0, 0] };
    state.due = 'xp';
    const html = start(slim);
    assert.match(html, /aria-pressed="true" >Projected</);
    assert.match(pill(face(html, 12)), /^<span class="ptsp xp live" data-tip="\d+\.\d projected · 7 points so far"/);
    slim.fixtures = slim.fixtures.map((f) => ({ ...f, done: true, min: undefined }));
    assert.doesNotMatch(start(slim), /Projected/);
  });

  it('with Projected, takes apart what’s still to come as the model’s parts have it', () => {
    state.due = 'xp';
    // Saka's 5.2: 1.9 for playing, 1.5 for goals, 0.8 for assists, 0.4 for a clean sheet, 0.6 bonus and the rest.
    const model: Partial<LiveData> = { parts: { 12: [80, 1.9, 1.5, 0, 0.8, 0.4, 0, 0.1, 0, 0.6, -0.1] }, cleanSheet: { MID: 1 } };
    const html = start(feed(), model);
    const tip = pill(face(html, 12)).match(/data-tip-rows="([^"]*)"/)?.[1] ?? '';
    const rows = tip.split('\n');
    assert.equal(rows[0], 'Still to come');
    // Arsenal have conceded no goal yet: his hour, goals, assists, the clean sheet and bonus, those worth a tenth.
    assert.deepEqual(
      rows.slice(1).map((row) => row.split('\t')[0]),
      ['Playing', 'Goals', 'Assists', 'Clean sheet', 'Bonus'],
    );
    for (const row of rows.slice(1)) assert.match(row, /\t\d\.\d$/);
    // Adding up to the projection less his 7 so far.
    const projected = Number(pill(face(html, 12)).match(/data-tip="(\d+\.\d) projected/)?.[1]);
    const toCome = rows.slice(1).reduce((t, row) => t + Number(row.split('\t')[1]), 0);
    assert.ok(Math.abs(7 + toCome - projected) < 0.25, `${toCome} ${projected}`);
    // In his points' tip without Projected, the same under his points so far.
    state.due = '';
    assert.match(
      pill(face(start(feed(), model), 12)),
      new RegExp(`data-tip="7 points so far · \\d+\\.\\d projected" data-tip-rows="${tip}"`),
    );
  });
});

describe('the XI’s total while its gameweek is played', () => {
  const scored = (xi: number[], pts: number): LiveLineup => ({ ...lineup(xi, [], pts), subs: [], off: [], points: () => 0 });
  const totals = (html: string) =>
    [...html.matchAll(/<span class="mp-total" data-tip="([^"]*)">([^<]*)<\/span>/g)].map(([, tip, n]) => `${n} · ${tip}`);

  it('is the points so far, or with Projected where the score is heading, as the live odds see it', () => {
    const lineups = { 1: scored([11, 12], 9), 2: scored([13, 15, 20], 0) };
    assert.deepEqual(totals(start(feed(), {}, lineups)), ['9 · Points', '10 · Points']);
    state.due = 'xp';
    const [ann, bob] = totals(start(feed(), {}, lineups));
    assert.match(ann, /^\d+\.\d · 9 so far \+ \d\.\d to come, as the live odds see it$/);
    assert.match(bob, /^\d+\.\d · Projected, as the live odds see it$/); // nothing so far by its live lineup
  });
});

describe('a player’s match state by his name', () => {
  it('says whether he’s on the pitch, off, done, without a match or when he kicks off', () => {
    assert.match(stateLabel({ state: 'live', min: 0, on: true }), /data-tip="Playing now"><i class="live-dot"><\/i>1'/);
    assert.match(stateLabel({ state: 'live', min: 30, on: false }), /data-tip="His match is on, without him on the pitch">30'/);
    assert.match(stateLabel({ state: 'off', min: 61 }), /data-tip="Off after 61 minutes">61'/);
    assert.match(stateLabel({ state: 'done' }), />FT</);
    assert.match(stateLabel({ state: 'blank' }), /data-tip="No match this gameweek">–</);
    assert.match(stateLabel({ state: 'due', ko: undefined, opp: 2, home: true }), /data-tip="Kick-off to be set, Chelsea \(H\)">TBC</);
    // Today's kick-off by its time alone, another day's with the day.
    const today = new Date();
    today.setHours(20, 0, 0, 0);
    assert.match(
      stateLabel({ state: 'due', ko: today.toISOString(), opp: 2, home: false }),
      /data-tip="Today [^",]+, Chelsea \(A\)">[^<]+</,
    );
    assert.match(stateLabel({ state: 'due', ko: '2026-08-29T16:30:00Z', opp: 2, home: true }), /<span class="ko-day">\w+<\/span> [^<]+</);
  });
});

describe('the projected lineups before the deadline', () => {
  // GW 4, Ann v Bob: Arsenal at home to Chelsea, Man City's kick-off against Spurs still to
  // be set, and Liverpool without a match. Saka is doubtful.
  function due(): Match {
    const d: Data = squads();
    d.clubs[5] = { name: 'Spurs', short: 'TOT', logo: '', kit: null };
    d.gameweeks[3].fixtures = [
      [1, 2, '2026-09-05T14:00:00Z'],
      [4, 5, null],
    ];
    const xp: Record<number, number> = { 11: 3.1, 12: 5.4, 18: 4.2, 13: 6.3, 15: 7.7, 16: 2.2 };
    for (const [pid, ep] of Object.entries(xp)) Object.assign(d.players[pid], { ep, fpl: ep / 2 });
    Object.assign(d.players[12], { status: 'd', news: 'Knock - 75% chance of playing' });
    Object.assign(d.players[19], { owner: 2, club: 3 }); // White, now Bob's and at Liverpool
    d.meta.xiLimits = { GKP: [0, 1], DEF: [0, 5], MID: [0, 5], FWD: [0, 3] };
    d.players[18].parts = [85, 1.9, 0.3, 0, 0.2, 1.4, -0.3, 0.6, 0, 0.3, -0.2];
    const m: Match = { ...match(4, 1, 2, 0, 0, false), homePts: null, awayPts: null, started: false };
    m.odds = {
      p: [0.4, 0.2, 0.4],
      prices: [0, 1, 2].map(() => ({ dec: 2.5, frac: '6/4' })) as Odds['prices'],
      expected: [12.7, 14],
      xi: [
        [11, 12, 18],
        [13, 15],
      ],
    };
    d.matches.push(m);
    setData(d);
    return m;
  }
  const faces = (html: string) => [...html.matchAll(/href="#\/player\/(\d+)"/g)].map(([, pid]) => Number(pid));

  it('shows each side’s XI with its expected points, taken apart where the model has them', () => {
    const html = projectedLineups(due());
    assert.match(html, /data-tip="Best legal XI by expected points">12\.7 xP</); // Ann's: 3.1 + 5.4 + 4.2
    assert.match(html, /<span class="ptsp xp" data-tip="4\.2 xP · 85 avg mins\nChelsea \(H\)" data-tip-rows="Playing\t1\.9/);
    assert.match(html, /data-tip="5\.4 expected points">5\.4</);
    assert.match(html, /<span class="pp-flag" data-tip="Knock - 75% chance of playing">!<\/span>/);
    // The rest of each squad on its bench: White on Bob's.
    assert.deepEqual(faces(html).sort(), [11, 12, 13, 15, 18, 19]);
  });

  it('shows when each kicks off instead, without Projected', () => {
    state.due = 'ko';
    const html = projectedLineups(due());
    assert.match(html, /<span class="ptsp ko" data-tip="\w+ [^",]+, Chelsea \(H\)">/);
    assert.match(html, /<span class="ptsp ko" data-tip="Kick-off to be set, Spurs \(H\)">TBC</);
    assert.match(html, /<span class="ptsp ko" data-tip="No match this gameweek">–</); // White's Liverpool
    assert.doesNotMatch(html, /xP</);
  });

  it('picks the XI again by FPL’s expected points when the cog asks for those: a squad short of eleven has none', () => {
    state.xp = 'fpl';
    const html = projectedLineups(due());
    assert.match(html, /data-tip="Best legal XI by expected points">0\.0 xP</);
    assert.deepEqual(faces(html).sort(), [11, 12, 13, 15, 18, 19]); // all of them on the benches
  });

  it('has nothing to show without the odds’ XIs', () => {
    const m = due();
    assert.equal(projectedLineups({ ...m, odds: undefined }), '');
  });
});
