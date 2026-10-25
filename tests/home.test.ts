import './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { pageHome } from '../src/app/pages/home.ts';
import { href } from '../src/app/router.ts';
import { setData, setLive, setSeasons, state } from '../src/app/state.ts';
import type { Data, Match } from '../src/shared/data.ts';
import { cardTitles, text } from './fixtures/html.ts';
import { match, season } from './fixtures/league.ts';

const due = (gw: number, home: number, away: number): Match => ({
  ...match(gw, home, away, 0, 0, false),
  homePts: null,
  awayPts: null,
  started: false,
});

// After GW 2 (see season()), with GW 4's head-to-heads and Arsenal v Liverpool to come.
function data(): Data {
  const d = season();
  d.matches.push(due(4, 1, 2), due(4, 3, 1));
  d.plMatches = [
    { id: 7, gw: 2, home: 1, away: 2, ko: '2026-08-22T14:00:00Z', score: [2, 1], done: true },
    { id: 9, gw: 4, home: 1, away: 3, ko: '2026-09-12T14:00:00Z' },
  ];
  return d;
}

beforeEach(() => {
  setData(data());
  setLive(null);
  Object.assign(state, { myTeam: null, tableMode: 'short', tableView: 'overall' });
});

afterEach(() => {
  setSeasons([]);
  state.season = null;
});

const home = (gw?: number) => pageHome({ page: 'home', tab: '', ...(gw === undefined ? {} : { gw }) }).body;
const column = (html: string, cls: string) => html.split(`<${cls === 'front-main' ? 'div' : 'aside'} class="${cls}">`)[1];
const groups = (html: string) =>
  [...html.matchAll(/<span class="group-name">([^<]+)<\/span><span class="group-note">(.*?)<\/span>/g)].map(
    (m) => `${m[1]}: ${text(m[2])}`,
  );

describe('the home page', () => {
  it('has the round in the middle: the draft league’s head-to-heads, then the Premier League’s matches', () => {
    const html = home();
    assert.match(html, /<option value="#\/round\/4" selected>Current \(GW 4\)<\/option>/);
    assert.deepEqual(groups(column(html, 'front-main')), ['Office League: Gameweek 4', 'Premier League: Round 4']);
    assert.ok(html.includes(`href="${href.match({ gw: 4, home: 3, away: 1 })}"`));
    assert.ok(html.includes(`href="${href.plMatch(9)}"`));
  });

  it('goes to the round asked for, within the season, and leaves the Premier League out of a round without its matches', () => {
    assert.deepEqual(groups(home(2)), ['Office League: Gameweek 2', 'Premier League: Round 2']);
    assert.match(home(2), /<span class="score">45 - 60<\/span>/);
    assert.deepEqual(groups(home(3)), ['Office League: Gameweek 3']);
    assert.match(home(3), /No matches this gameweek/);
    assert.match(home(40), /<option value="#\/round\/4" selected>/);
  });

  it('marks the round under way, and offers the odds format while its matches show odds', () => {
    const d = data();
    d.matches.push(match(3, 1, 2, 10, 12, false));
    const price = { dec: 2, frac: '1/1' };
    d.matches[0].odds = { p: [0.4, 0.2, 0.4], prices: [price, price, price], expected: [40, 40] };
    setData(d);
    assert.match(home(3), /<span class="group-note"><i class="live-dot" data-tip="Under way"><\/i>Gameweek 3<\/span>/);
    assert.match(home(3), /data-action="odds" data-value="decimal"/);
    assert.doesNotMatch(home(4), /data-action="odds"/);
    // Over, its odds are no longer shown.
    assert.doesNotMatch(home(1), /data-action="odds"/);
  });

  it('has the deadline, the table, the prize, the recent transfers on the right, and the leagues and the prize on the left', () => {
    const html = home();
    assert.deepEqual(cardTitles(column(html, 'front-right').split('<aside')[0]), ['Table', 'Highest scoring GW', 'Recent transfers']);
    assert.match(column(html, 'front-right'), /<div class="front-narrow"><section class="card /);
    assert.deepEqual(cardTitles(column(html, 'front-left')), ['Leagues', 'Highest scoring GW']);
  });
});

describe('the next deadline', () => {
  const deadline = (html: string) => text(html.split('<div class="deadline">')[1]?.split('</section>')[0] ?? '');

  it('counts down to the waivers while they come first', () => {
    assert.match(deadline(home()), /^Next deadline 1h 30m Waivers for gameweek 4 · /);
    assert.match(home(), /data-tip="Waivers for gameweek 4: [^\n"]+\nGameweek 4: [^"]+"/);
  });

  it('then to the gameweek’s, and says when both have passed', () => {
    const d = data();
    d.meta.nextWaivers = new Date(Date.now() - 6e4).toISOString();
    setData(d);
    assert.match(deadline(home()), /^Next deadline 1d 1h Gameweek 4 · /);
    d.meta.nextDeadline = new Date(Date.now() - 6e4).toISOString();
    setData(d);
    assert.match(deadline(home()), /^Next deadline Passed Gameweek 4 · /);
  });

  it('counts down to the gameweek alone without waivers, and is left out without a deadline or in an archive', () => {
    const d = data();
    d.meta.nextWaivers = null;
    setData(d);
    assert.match(deadline(home()), /^Next deadline 1d 1h Gameweek 4 · /);
    d.meta.nextDeadline = null;
    setData(d);
    assert.equal(deadline(home()), '');
    setData(data());
    setSeasons([{ season: '2026/27', name: 'Office League', file: 'seasons/2026-27/data.json' }]);
    state.season = '2026-27';
    assert.equal(deadline(home()), '');
  });
});

describe('the leagues on the home page', () => {
  const leagues = () => column(home(), 'front-left').split('</section>')[0];

  it('leads to both leagues and to all the teams, with how to follow one', () => {
    const html = leagues();
    assert.ok(html.includes(`href="${href.league()}"`));
    assert.ok(html.includes(`href="${href.pl()}"`));
    assert.match(text(html), /All teams Follow your team from its page to keep it here\.$/);
  });

  it('keeps the team followed, with its manager, place and points', () => {
    state.myTeam = 1;
    assert.match(text(leagues()), /Your team AN Ann’s &#38; Co Ann · 2nd 4$/);
    const d = data();
    d.tables.overall = [];
    setData(d);
    assert.match(text(leagues()), /Your team AN Ann’s &#38; Co Ann$/);
  });

  it('forgets a followed team that isn’t in the league', () => {
    state.myTeam = 99;
    assert.match(text(leagues()), /All teams/);
  });
});
