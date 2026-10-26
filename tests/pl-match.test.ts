import './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { pagePlMatch } from '../src/app/pages/pl-match.ts';
import { href, type Route } from '../src/app/router.ts';
import { setData, setLive, state } from '../src/app/state.ts';
import type { Data, PlMatch } from '../src/shared/data.ts';
import type { SlimLive } from '../src/shared/live.ts';
import { cardTitled, text } from './fixtures/html.ts';
import { lineup, squads } from './fixtures/league.ts';

// The stats files never come in: the Player stats cards wait for them.
Object.assign(globalThis, { fetch: () => new Promise(() => {}) });

// GW 2: Arsenal beat Chelsea 2-1, Saka scoring twice and Palmer once; Gabriel came on for the
// last half hour and Isak went off after an hour. Liverpool and Man City drew 0-0. GW 4:
// Arsenal v Liverpool, still to come.
const played: PlMatch = {
  id: 7,
  gw: 2,
  home: 1,
  away: 2,
  ko: '2026-08-22T14:00:00Z',
  score: [2, 1],
  done: true,
  lineups: [
    [
      [12, 90, 13, 1],
      [11, 90, 6, 1],
      [18, 30, 2, 0],
    ],
    [
      [13, 90, 5, 1],
      [16, 60, 1, 1],
    ],
  ],
  events: { 12: { goals: 2, bonus: 3 }, 13: { goals: 1 } },
};
const draw: PlMatch = { id: 8, gw: 2, home: 3, away: 4, ko: '2026-08-22T16:30:00Z', score: [0, 0], done: true };
const toCome: PlMatch = { id: 9, gw: 4, home: 1, away: 3, ko: '2026-09-12T14:00:00Z' };

function data(): Data {
  const d = squads();
  d.plMatches = [played, draw, toCome];
  // In GW 2 Ann started Saka and Raya with Gabriel on the bench, Bob started Palmer, and Cy had Isak on the bench.
  d.lineups = { 1: { 2: lineup([12, 11], [18]) }, 2: { 2: lineup([13]) }, 3: { 2: lineup([14], [16]) } };
  return d;
}

const page = (id: number, tab: Route['tab'] = 'facts') => pagePlMatch({ page: 'pl-match', tab, id });

beforeEach(() => {
  setData(data());
  setLive(null);
  state.myTeam = null;
});

describe('a Premier League match that is over', () => {
  it('says so when there is no such match this season', () => {
    const view = page(99);
    assert.equal(view.title, 'Premier League');
    assert.match(view.body, /No such Premier League match this season/);
    assert.equal(view.header, undefined);
  });

  it('names the clubs and the score, with who scored under each side', () => {
    const view = page(7);
    const poster = view.header!.poster!;
    assert.equal(view.title, 'Arsenal v Chelsea');
    assert.match(poster, /<span class="mh-score">2 - 1<\/span><span class="mh-status">Full time<\/span>/);
    assert.ok(poster.includes(`href="${href.pl('fixtures', 2)}"`));
    assert.ok(poster.includes(`<a class="mh-league" href="${href.pl()}">Premier League</a>`), 'the league leads to its page');
    const [home, away] = poster.split('<div class="away">');
    assert.match(text(home.split('<div class="mh-scorers">')[1]), /^Saka ×2$/);
    assert.match(text(away), /^Palmer$/);
  });

  it('puts an own goal under the side it counted for', () => {
    const d = data();
    d.plMatches![0] = { ...played, score: [3, 1], events: { ...played.events, 16: { ownGoals: 1 } } };
    setData(d);
    const [home, away] = page(7).header!.poster!.split('<div class="away">');
    assert.match(text(home.split('<div class="mh-scorers">')[1]), /Saka ×2 Isak \(OG\)/);
    assert.doesNotMatch(text(away), /OG/);
  });

  it('lists the starters, then the substitutes who came on, and picks out the match’s best', () => {
    const lineups = cardTitled(page(7).body, 'Lineups');
    const [starters, subs] = lineups.split('Substitutes');
    assert.match(starters, /Starting XI/);
    for (const name of ['Raya', 'Saka', 'Palmer', 'Isak']) assert.ok(starters.includes(`<span>${name}</span>`), name);
    assert.ok(subs.includes('<span>Gabriel</span>'));
    assert.match(subs, /Came on · played 30 minutes/);
    assert.match(starters, /Taken off after 60 minutes/);
    // Saka's 13 points with his bonus apart, in blue.
    assert.match(starters, /<span class="ptsp top" data-tip="The match’s best">10\+3<\/span>/);
    assert.equal(starters.match(/ptsp top/g)?.length, 1);
  });

  it('says whose squad each player was in that week, and who sat on a bench', () => {
    const lineups = cardTitled(page(7).body, 'Lineups');
    assert.match(lineups, /data-tip="Saka: in Ann’s XI"/);
    assert.match(lineups, /data-tip="Gabriel: on Ann’s bench"/);
    assert.match(lineups, /data-tip="Isak: on Cy’s bench"/);
  });

  it('adds up what each draft team’s XI took from it, best first, with its bench’s points apart', () => {
    const draft = cardTitled(page(7).aside!.html, 'Draft points');
    assert.deepEqual(
      [...draft.matchAll(/<a href="#\/team\/(\d)">/g)].map((m) => Number(m[1])),
      [1, 2, 3],
    );
    assert.deepEqual(
      [...draft.matchAll(/<span class="lrow-value">(\d+)<\/span>/g)].map((m) => Number(m[1])),
      [19, 5, 0],
    );
    assert.match(text(draft), /Saka 13, Raya 6 · bench: Gabriel 2/);
    assert.match(text(draft), /3 teams in gameweek 2/);
    assert.ok(draft.includes(`href="${href.home(2)}"`));
  });

  it('says so when nobody in the league had a player in it', () => {
    const d = data();
    d.plMatches![1] = { ...draw, lineups: [[[19, 90, 1, 1]], [[15, 90, 2, 1]]] };
    setData(d);
    assert.match(cardTitled(page(8).aside!.html, 'Draft points'), /Nobody in the league had a player in it/);
  });

  it('lists each team’s players at either club, those on its bench that week apart, and the teams with nobody in it too', () => {
    const squadsCard = cardTitled(page(7).body, 'Draft players');
    assert.match(text(squadsCard), /Ann Saka, Raya · bench: Gabriel 3 Bob Palmer 1 Cy bench: Isak 1/);
    assert.doesNotMatch(squadsCard, /expected points/);
    assert.match(
      text(cardTitled(page(8).body, 'Draft players')),
      /Cy Salah 1 Ann No players in this match 0 Bob No players in this match 0/,
    );
  });

  it('puts a team with more of its players in its XI ahead of one level on players', () => {
    const d = data();
    d.lineups[2][2] = lineup([], [13]); // Bob's Palmer on the bench
    d.lineups[3][2] = lineup([16]); // Cy's Isak in the XI
    setData(d);
    assert.match(text(cardTitled(page(7).body, 'Draft players')), /Cy Isak 1 Bob bench: Palmer 1/);
  });

  it('keeps the round’s matches beside it, picking out this one', () => {
    const { aside } = page(7);
    assert.equal(aside!.cls, 'cols-match facts');
    assert.match(aside!.html, /<a class="rc-row this" href="#\/premier-league\/match\/7">/);
    assert.match(aside!.html, /<a class="rc-row" href="#\/premier-league\/match\/8">/);
    assert.doesNotMatch(aside!.html, /match\/9/);
  });

  it('leaves the lineups for the Player stats tab, which waits for the stats file', () => {
    const view = page(7, 'player-stats');
    assert.match(cardTitled(view.body, 'Player stats'), /Loading…/);
    assert.equal(cardTitled(view.body, 'Lineups'), '');
    assert.equal(view.aside!.cls, 'cols-match');
    assert.equal(view.header!.tab, 'player-stats');
  });

  it('puts the real formations on the pitch, the substitutes who came on ahead of those who didn’t', () => {
    const d = data();
    d.plMatches![0] = {
      ...played,
      formations: [
        { shape: '4-3-3', lines: [[11], [12]], subs: [19, 18] },
        { shape: '4-4-2', lines: [[13], [16]], subs: [] },
      ],
    };
    setData(d);
    const [pitch, subs] = cardTitled(page(7).body, 'Lineups').split('Substitutes');
    assert.match(pitch, /<span class="mp-form">4-3-3<\/span>/);
    assert.match(pitch, /<a class="pp" href="#\/player\/12"/);
    // Gabriel came on; White sat it out, with no points.
    const [gabriel, white] = subs.split('href="#/player/19"');
    assert.match(gabriel, /href="#\/player\/18"/);
    assert.doesNotMatch(white, /ptsp/);
    // Faded as on the pitch, he alone.
    assert.match(subs, /<a class="mp-sub faded" href="#\/player\/19">/);
    assert.match(subs, /<a class="mp-sub" href="#\/player\/18">/);
  });
});

describe('a Premier League match still to come', () => {
  it('shows the kick-off rather than a score, and no scorers or draft points yet', () => {
    const view = page(9);
    assert.match(view.header!.poster!, /<span class="mh-time">/);
    assert.doesNotMatch(view.header!.poster!, /mh-score|mh-scorers/);
    assert.equal(cardTitled(view.aside!.html, 'Draft points'), '');
    assert.equal(cardTitled(view.body, 'Lineups'), '');
  });

  it('in the next gameweek, adds up each team’s expected points from the players it owns now', () => {
    const d = data();
    Object.assign(d.players[12], { ep: 5.2 });
    Object.assign(d.players[11], { ep: 3.1 });
    Object.assign(d.players[18], { ep: 2 });
    Object.assign(d.players[14], { ep: 6.5 });
    Object.assign(d.players[17], { ep: 4 });
    setData(d);
    const squadsCard = cardTitled(page(9).body, 'Draft players');
    assert.match(squadsCard, /with their expected points/);
    assert.match(
      text(squadsCard),
      /Ann Saka 5\.2, Raya 3\.1, Gabriel 2\.0 10\.3 Cy Salah 6\.5, Watkins 4\.0 10\.5 Bob No players in this match 0/,
    );
  });

  it('puts the named lineups on the pitch before kick-off, with each player’s expected points', () => {
    const d = data();
    Object.assign(d.players[12], { ep: 5.2 });
    d.plMatches![2] = {
      ...toCome,
      formations: [
        { shape: '4-3-3', lines: [[11], [18], [12]], subs: [19] },
        { shape: '4-4-2', lines: [[14], [17]], subs: [] },
      ],
    };
    setData(d);
    const lineups = cardTitled(page(9).body, 'Lineups');
    assert.match(lineups, /4-3-3/);
    assert.match(lineups, /<span class="ptsp xp" data-tip="5\.2 projected points">5\.2<\/span>/);
    assert.doesNotMatch(lineups, /faded/);
  });

  it('says on the Player stats tab that they come once it kicks off', () => {
    assert.match(page(9, 'player-stats').body, /They come in once the match kicks off/);
  });
});

describe('a Premier League match being played', () => {
  // GW 3, Arsenal 1-0 Chelsea after 55 minutes: Saka has scored, Gabriel has come on, White hasn't.
  const feed: SlimLive = {
    elements: { 12: [7, 55], 13: [2, 55], 18: [1, 10], 19: [0, 0] },
    events: { 12: { goals: 1 }, 18: { on: 1 } },
    fixtures: [{ id: 10, h: 1, a: 2, started: true, done: false, min: 55, score: [1, 0] }],
  };
  const playing: PlMatch = { id: 10, gw: 3, home: 1, away: 2, ko: '2026-08-29T14:00:00Z' };

  function on(...more: PlMatch[]) {
    const d = data();
    d.plMatches = [...d.plMatches!, playing, ...more];
    d.lineups[1][3] = lineup([12], [18]);
    d.lineups[2][3] = lineup([13]);
    setData(d);
    setLive({ gw: 3, feed, lineups: {}, points: (pid) => feed.elements[pid]?.[0] ?? 0, bonus: () => 0 });
  }

  it('takes the score, the minute and the lineups from the relay’s feed', () => {
    on();
    const view = page(10);
    assert.match(view.header!.poster!, /<span class="mh-score">1 - 0<\/span>/);
    assert.match(view.header!.poster!, /<span class="status-dot live">55’<\/span>/);
    assert.match(text(view.header!.poster!.split('<div class="mh-scorers">')[1]), /^Saka$/);
    const [starters, subs] = cardTitled(view.body, 'Lineups').split('Substitutes');
    assert.ok(starters.includes('<span>Saka</span>') && starters.includes('<span>Palmer</span>'));
    assert.ok(subs.includes('<span>Gabriel</span>'));
    assert.doesNotMatch(starters + subs, /White/);
    // Nobody is the match's best until it's over.
    assert.doesNotMatch(starters, /ptsp top/);
    assert.match(text(cardTitled(view.aside!.html, 'Draft points')), /Ann Saka 7 · bench: Gabriel 1 7 Bob Palmer 2 2/);
  });

  it('keeps to data.json for a club playing twice in the gameweek, as the feed can’t split its points', () => {
    on({ id: 11, gw: 3, home: 4, away: 1, ko: '2026-09-01T19:00:00Z' });
    const view = page(10);
    assert.match(view.header!.poster!, /<span class="mh-score">1 - 0<\/span>/);
    assert.doesNotMatch(view.header!.poster!, /mh-scorers/);
    assert.equal(cardTitled(view.body, 'Lineups'), '');
    assert.equal(cardTitled(view.aside!.html, 'Draft points'), '');
  });
});
