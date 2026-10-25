import './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { href } from '../src/app/router.ts';
import { setData, setLive, state } from '../src/app/state.ts';
import { awardsCard, gwPrizeCard, roundCard, tableCard, viewOverview } from '../src/app/views/overview.ts';
import type { Data, OverallRow, TopGameweek } from '../src/shared/data.ts';
import { cardTitled, text } from './fixtures/html.ts';
import { lineup, match, squads } from './fixtures/league.ts';

const row = (id: number, rank: number, pts: number, pf: number): OverallRow => ({
  id,
  rank,
  lastRank: null,
  played: 2,
  won: 0,
  drawn: 0,
  lost: 0,
  pf,
  pa: 0,
  pts,
  form: [],
  next: undefined,
});

const top = (id: number, gw: number, pts: number, rank: number, opp: number, oppPts: number, dgw = 0): TopGameweek => ({
  id,
  gw,
  pts,
  dgw,
  adj: pts - 4 * dgw,
  rank,
  guaranteed: false,
  opp,
  oppPts,
  star: null,
});

// After GW 2: Cy top on points scored, then Ann, then Bob. Cy's 60 against Bob in GW 2 is the
// season's best gameweek, ahead of Ann's 50 against Bob in GW 1.
function data(): Data {
  const d = squads();
  d.meta.dgwPenalty = 4;
  d.tables = { overall: [row(3, 1, 4, 90), row(1, 2, 4, 80), row(2, 3, 0, 85)] } as Data['tables'];
  d.topGameweeks = [top(3, 2, 60, 1, 2, 45), top(1, 1, 50, 2, 2, 40), top(2, 2, 45, 3, 3, 60)];
  d.meta.months = [{ name: 'August', from: 1, to: 2 }];
  d.plMatches = [];
  return d;
}

// The next round's head-to-heads, still to come.
const due = (gw: number, home: number, away: number) => ({
  ...match(gw, home, away, 0, 0, false),
  homePts: null,
  awayPts: null,
  started: false,
});

beforeEach(() => {
  setData(data());
  setLive(null);
  Object.assign(state, { myTeam: null, tableMode: 'short', tableView: 'overall' });
});

const titles = (html: string) =>
  [...html.matchAll(/<h2 class="card-title">([^<]+)<\/h2>|<span class="rc-title">([^<]+)<\/span>/g)].map((m) => m[1] ?? m[2]);

describe('the draft league’s overview', () => {
  it('puts the table and the last gameweek’s review beside the round, the prizes, the transfers and the original squads', () => {
    const [left, right] = viewOverview().split('<div class="col">').slice(1);
    assert.deepEqual(titles(left), ['Table', 'Gameweek 2 review']);
    assert.deepEqual(titles(right), ['Gameweek 4', 'Highest scoring GW', 'Manager of the Month', 'Recent transfers', 'Original squad']);
  });

  it('leaves the review out before any gameweek has finished, and Manager of the Month before the months are known', () => {
    const d = data();
    d.meta.lastFinishedGw = 0;
    delete d.meta.months;
    setData(d);
    const html = viewOverview();
    assert.doesNotMatch(html, /review/);
    assert.doesNotMatch(html, /Manager of the Month/);
  });

  it('ranks the original squads on the draft picks kept, then their share of the points', () => {
    const squadsCard = cardTitled(viewOverview(), 'Original squad');
    assert.match(text(squadsCard), /Ann 2\/2 Bob 2\/2 Cy 1\/2/);
    assert.ok(squadsCard.includes(`href="${href.league('draft')}"`));
  });
});

describe('the round card', () => {
  it('shows the next gameweek before it starts, with a way to all the fixtures', () => {
    const d = data();
    d.matches.push(due(4, 1, 3));
    setData(d);
    const html = roundCard();
    assert.match(html, /<h2 class="card-title">Gameweek 4<\/h2>/);
    assert.match(html, /Deadline /);
    assert.ok(html.includes(`href="${href.match({ gw: 4, home: 1, away: 3 })}"`));
    assert.ok(html.includes(`href="${href.league('fixtures', 4)}"`));
  });

  it('shows the gameweek being played while it is', () => {
    const d = data();
    d.matches.push(match(3, 1, 2, 10, 12, false), due(4, 1, 3));
    setData(d);
    const html = roundCard();
    assert.match(html, /<h2 class="card-title">Gameweek 3<\/h2>/);
    assert.ok(html.includes(`href="${href.match({ gw: 3, home: 1, away: 2 })}"`));
    assert.ok(!html.includes(`href="${href.match({ gw: 4, home: 1, away: 3 })}"`));
  });

  it('says so when a gameweek has no matches', () => {
    assert.match(roundCard(9), /No matches this gameweek/);
  });
});

describe('the table card', () => {
  it('has the switch and the legend on the overview, ranked as the table has it', () => {
    const html = tableCard();
    assert.match(html, /<h2 class="card-title">Table<\/h2>/);
    assert.match(html, /1st prize/);
    assert.ok(html.indexOf('Cy United') < html.indexOf('Ann’s &#38; Co'));
    assert.ok(html.indexOf('Ann’s &#38; Co') < html.indexOf('Bob FC'));
  });

  it('calls the front page’s table live while a gameweek is played, without the legend', () => {
    assert.match(tableCard({ compact: true }), /<h2 class="card-title">Table<\/h2>/);
    const d = data();
    d.matches.push(match(3, 1, 2, 10, 12, false));
    setData(d);
    const html = tableCard({ compact: true });
    assert.match(html, /<h2 class="card-title">Live table<\/h2>/);
    assert.doesNotMatch(html, /1st prize/);
  });

  it('keeps the front page’s table to the Short columns whatever the phones’ table mode, so it fits its column', () => {
    state.tableMode = 'full';
    assert.match(tableCard(), /class="table-scroll"/);
    assert.doesNotMatch(tableCard({ compact: true }), /table-scroll|ftable full/);
    state.tableMode = 'form';
    assert.match(tableCard(), /c-form from-xs/);
    assert.doesNotMatch(tableCard({ compact: true }), /c-form from-xs/);
  });

  it('shows how each match being played stands on the front page, whichever of the league’s tables was picked last', () => {
    const d = data();
    d.matches.push(match(3, 1, 2, 10, 12, false));
    setData(d);
    state.tableView = 'xg';
    const html = tableCard({ compact: true });
    assert.match(html, /class="live-res W"/);
    assert.match(html, /class="live-res L"/);
  });
});

describe('Manager of the Month', () => {
  function months() {
    const d = data();
    d.meta.months = [
      { name: 'August', from: 1, to: 2 },
      { name: 'September', from: 3, to: 3 },
    ];
    return d;
  }

  it('is left out until a month’s first match has started', () => {
    setData(months());
    assert.match(awardsCard(), /August/);
    assert.doesNotMatch(awardsCard(), /September/);
    const d = months();
    d.matches = [];
    setData(d);
    assert.equal(awardsCard(), '');
  });

  it('names the month’s leader so far, with the months before under it', () => {
    const d = months();
    d.matches.push(match(3, 1, 2, 10, 12, false));
    setData(d);
    const html = awardsCard();
    assert.match(html, /<div class="card-sub">GW 3<\/div>/);
    assert.match(html, /<div class="prize-label">September so far<\/div>/);
    assert.match(html, /<div class="prize-name"><a href="#\/team\/2">Bob<\/a><\/div>/);
    assert.match(html, /W1 D0 L0 · 12 points scored/);
    // Cy edged August on points scored, both on four table points.
    assert.match(text(html), /Earlier 1 month August Cy · GW 1–2 · 90 points scored 4 pts$/);
  });

  it('drops “so far” once the month’s gameweeks are all over', () => {
    setData(months());
    assert.match(awardsCard(), /<div class="prize-label">August<\/div>/);
  });
});

describe('the highest scoring gameweek', () => {
  it('is up for grabs until a gameweek has finished', () => {
    const d = data();
    d.topGameweeks = [];
    setData(d);
    assert.match(gwPrizeCard(), /Up for grabs once the first gameweek finishes/);
  });

  it('names its holder, the result leading to the match it was scored in, and the closest after', () => {
    const html = gwPrizeCard();
    assert.match(html, /<div class="prize-label">Current holder<\/div>/);
    assert.match(html, /<a href="#\/team\/3">Cy<\/a> <span class="muted">GW 2<\/span>/);
    assert.ok(html.includes(`<a href="${href.match({ gw: 2, home: 2, away: 3 })}">Won 60-45 vs Bob</a>`));
    const closest = html.split('Closest')[1];
    assert.match(text(closest), /2 Ann GW 1 Won 50-40 vs Bob 50 3 Bob GW 2 Lost 45-60 vs Cy 45/);
  });

  it('takes the double gameweek’s penalty off a score, and shows it', () => {
    const d = data();
    d.topGameweeks[0] = top(3, 2, 64, 1, 2, 45, 1);
    setData(d);
    assert.match(gwPrizeCard(), /<span class="prize-adj" data-tip="1 double-gameweek player × −4">64 − 4<\/span>/);
  });

  it('calls holders on the same score joint holders, and the holder after the last gameweek the winner', () => {
    const d = data();
    d.topGameweeks[1] = top(1, 1, 60, 1, 2, 40);
    setData(d);
    assert.equal(gwPrizeCard().match(/Joint holders/g)?.length, 2);
    const over = data();
    over.gameweeks.forEach((g) => (g.finished = true));
    setData(over);
    assert.match(gwPrizeCard(), /<div class="prize-label">Winner<\/div>/);
  });

  it('warns of a team beating the record in the gameweek being played, but not one only equalling it', () => {
    const d = data();
    d.matches.push(match(3, 1, 2, 61, 60, false));
    d.lineups = { 1: { 3: lineup([12], [], 61) }, 2: { 3: lineup([13], [], 60) } };
    setData(d);
    const html = gwPrizeCard();
    assert.match(text(html), /Ann is on 61 in GW 3, live/);
    assert.doesNotMatch(html, /Bob is on/);
  });
});
