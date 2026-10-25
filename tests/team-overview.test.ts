import './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { fixturesCard, formCard, lineupCard, nextMatchCard, rivalsCard } from '../src/app/pages/team-overview.ts';
import { href } from '../src/app/router.ts';
import { setData, setLive, state } from '../src/app/state.ts';
import type { Data, Match, Odds } from '../src/shared/data.ts';
import { cardTitled, listRows, text, tiles } from './fixtures/html.ts';
import { lineup, match, player, season } from './fixtures/league.ts';

// The stats files never come in.
Object.assign(globalThis, { fetch: () => new Promise(() => {}) });

const due = (gw: number, home: number, away: number, odds?: Odds): Match => ({
  ...match(gw, home, away, 0, 0, false),
  homePts: null,
  awayPts: null,
  started: false,
  ...(odds ? { odds } : {}),
});
const price = (dec: number) => ({ dec, frac: `${Math.round((dec - 1) * 10)}/10` });
const odds: Odds = { p: [0.55, 0.2, 0.25], prices: [price(1.8), price(5), price(4)], expected: [52, 47] };

// After GW 2 (see season()), with Ann at home to Cy in GW 4 and the odds on it.
function data(): Data {
  const d = season();
  d.matches.push(due(4, 1, 3, odds));
  return d;
}

beforeEach(() => {
  setData(data());
  setLive(null);
  Object.assign(state, { myTeam: null, lineupView: 'last', lineupStat: '', due: '', odds: 'decimal' });
});

describe('a team’s form', () => {
  it('shows the last results from the team’s side, each in its result’s colour and a link to the match', () => {
    const html = formCard(2);
    assert.deepEqual(
      [...html.matchAll(/<a class="form-item" href="([^"]+)" data-tip="([^"]+)"><span class="livep (\w)">([^<]+)</g)].map((m) =>
        m.slice(1).join(' '),
      ),
      [
        `${href.match({ gw: 1, home: 1, away: 2 })} GW 1: 40-50 vs Ann L 40-50`,
        `${href.match({ gw: 2, home: 2, away: 3 })} GW 2: 45-60 vs Cy L 45-60`,
      ],
    );
  });

  it('keeps to the last five, and is left out before the team has played', () => {
    const d = data();
    d.matches = [1, 2, 3, 4, 5, 6, 7].map((gw) => match(gw, 1, 2, 40 + gw, 40));
    setData(d);
    assert.deepEqual(
      [...formCard(1).matchAll(/data-tip="GW (\d)/g)].map((m) => Number(m[1])),
      [3, 4, 5, 6, 7],
    );
    d.matches = [];
    setData(d);
    assert.equal(formCard(1), '');
  });
});

describe('a team’s next match', () => {
  it('names both sides, the deadline and the team’s chance of winning before it starts', () => {
    const html = nextMatchCard(1);
    assert.match(html, /<h2 class="card-title">Next match<\/h2><div class="card-sub">Gameweek 4<\/div>/);
    assert.ok(html.includes(`<a class="next-match" href="${href.match({ gw: 4, home: 1, away: 3 })}">`));
    assert.match(html, /<span class="nm-when">Deadline<\/span>/);
    assert.match(html, /<div class="nm-odds">55% to win · 1.80<\/div>/);
    // Cy is away: the away win's chance.
    assert.match(nextMatchCard(3), /<div class="nm-odds">25% to win · 4.00<\/div>/);
  });

  it('shows the score of the match being played, without the odds', () => {
    const d = data();
    d.matches.splice(-1, 0, match(3, 2, 1, 20, 25, false)); // before GW 4’s
    setData(d);
    const html = nextMatchCard(1);
    assert.match(html, /<h2 class="card-title">Ongoing match<\/h2><div class="card-sub">Gameweek 3<\/div>/);
    assert.match(html, /<span class="nm-score">20 - 25<\/span>/);
    assert.doesNotMatch(html, /nm-odds/);
  });

  it('says the deadline is to be confirmed when it isn’t known, and is left out with no match to come', () => {
    const d = data();
    d.matches.push(due(9, 2, 3));
    setData(d);
    assert.match(nextMatchCard(2), /<span class="nm-time">TBC<\/span>/);
    assert.doesNotMatch(nextMatchCard(2), /nm-odds/);
    d.matches = d.matches.filter((m) => m.finished);
    setData(d);
    assert.equal(nextMatchCard(1), '');
  });
});

describe('a team’s fixtures', () => {
  it('lists every match, home or away, with the score from the team’s side or its chance of winning', () => {
    assert.deepEqual(
      [...fixturesCard(1).matchAll(/<a class="fx-row"[^>]*>(.*?)<\/a>/g)].map((m) => text(m[1])),
      ['GW 1 BO Bob (H) 50-40', 'GW 1 CY Cy (A) 30-30', 'GW 4 CY Cy (H) 55%'],
    );
    assert.match(fixturesCard(1), /<span class="livep D">30-30<\/span>/);
    assert.equal(cardTitled(fixturesCard(1), 'Fixtures').includes('card-footer'), false);
  });

  it('shows five around the next match on the overview, with a way to the rest', () => {
    const d = data();
    d.matches = [1, 2, 3, 4, 5, 6, 7, 8].map((gw) => (gw <= 4 ? match(gw, 1, 2, 50, 40) : due(gw, 2, 1)));
    setData(d);
    const html = fixturesCard(1, { limit: 5 });
    assert.deepEqual(
      [...html.matchAll(/<span class="fx-gw">GW (\d)<\/span>/g)].map((m) => Number(m[1])),
      [3, 4, 5, 6, 7],
    );
    assert.match(html, /<a class="card-footer" href="#\/team\/1\/fixtures">All fixtures<\/a>/);
  });

  it('says so when the team has no fixtures', () => {
    const d = data();
    d.matches = [];
    setData(d);
    assert.match(fixturesCard(1), /No fixtures/);
  });
});

describe('a team’s starting XI', () => {
  it('waits for the current gameweek’s lineup', () => {
    const html = lineupCard(1);
    assert.match(html, /No lineup yet/);
    assert.match(html, /data-action="lineup-view" data-value="last" aria-pressed="true">Last match/);
  });

  it('puts the current gameweek’s lineup on a pitch, with its points and formation', () => {
    const d = data();
    d.lineups[1][3] = lineup([11, 18, 12], [19], 4);
    setData(d);
    const html = lineupCard(1);
    assert.match(html, /<div class="card-sub">GW 3 · 4 pts · 1-1-0<\/div>/);
    for (const pid of [11, 18, 12, 19]) assert.ok(html.includes(`href="${href.player(pid)}"`));
    assert.match(html, /<div class="pitch-bench-label">Bench<\/div>/);
  });

  it('marks the automatic substitutions', () => {
    const d = data();
    d.lineups[1][3] = { ...lineup([19, 12], [11], 4), subs: [19], off: [18] };
    setData(d);
    assert.match(lineupCard(1), /Came on for Gabriel, an automatic substitution/);
  });

  it('picks the season’s best XI by the points scored for the team, fading those since let go', () => {
    // Ann's GW 1 XI had eleven: Raya; Gabriel, White and three more defenders; Saka and two more
    // midfielders, and two forwards; White has gone to Bob and Fodder to nobody.
    const d = data();
    const fillers: [number, string, 'DEF' | 'MID' | 'FWD', number][] = [
      [31, 'Def A', 'DEF', 3],
      [32, 'Def B', 'DEF', 2],
      [33, 'Mid A', 'MID', 4],
      [34, 'Mid B', 'MID', 1],
      [35, 'Fwd A', 'FWD', 7],
      [36, 'Fodder', 'FWD', 0],
      [37, 'Def C', 'DEF', 0],
    ];
    for (const [pid, name, pos, pts] of fillers) d.players[pid] = { ...player(name, pos, 2, pts, 1), pts: [pts, 0, 0] };
    d.players[36].owner = null;
    d.players[19].owner = 2;
    d.lineups[1][1] = lineup([11, 18, 19, 31, 32, 37, 12, 33, 34, 35, 36], [], 40);
    setData(d);
    state.lineupView = 'all';
    const html = lineupCard(1);
    // Saka's 13 over both gameweeks, Raya's 8, Fwd A's 7 and Gabriel's 6 lead it; with three midfielders, 5-3-2.
    assert.match(html, /<div class="card-sub">Season’s best · 45 pts · 5-3-2<\/div>/);
    assert.match(html, /data-tip="Saka: 13 pts in 2 starts"/);
    assert.match(html, /<a class="pp faded" href="#\/player\/19" data-tip="White: 1 pt in 1 start · now with Bob">/);
    assert.match(html, /<span class="ptsp top">13<\/span>/);
  });

  it('has no best XI before the team has scored', () => {
    state.lineupView = 'all';
    assert.match(lineupCard(1), /No points yet/);
  });
});

describe('a team’s head to head', () => {
  it('has the best and worst opponents and the nemesis, then a row for each opponent', () => {
    const html = rivalsCard(1);
    assert.deepEqual(tiles(html), [
      'Best opponent: BO Bob · W1 D0 L0 · 50-40',
      'Worst opponent: CY Cy · W0 D1 L0 · 30-30',
      'Nemesis: Haaland · 13 pts against you for Bob',
    ]);
    assert.deepEqual(listRows(html.split('<div class="list">')[1]), ['BO Bob W1 D0 L0 · 50-40 +10', 'CY Cy W0 D1 L0 · 30-30 0']);
  });

  it('counts a nemesis over every match against the team', () => {
    // Saka's 10 for Ann in GW 1 beat Salah's 9 for Cy in GW 2, until Salah's 4 in GW 3 against Bob too.
    assert.match(tiles(rivalsCard(2)).at(-1)!, /^Nemesis: Saka · 10 pts against you for Ann$/);
    const d = data();
    d.matches.push(match(3, 3, 2, 30, 20));
    d.lineups[3][3] = lineup([14]);
    setData(d);
    assert.match(tiles(rivalsCard(2)).at(-1)!, /^Nemesis: Salah · 13 pts against you in 2 matches for Cy$/);
  });

  it('leaves an opponent not yet met at the bottom, and says so before any match is over', () => {
    const d = data();
    d.matches = [match(1, 1, 2, 50, 40)];
    setData(d);
    assert.deepEqual(listRows(rivalsCard(1).split('<div class="list">')[1]), ['BO Bob W1 D0 L0 · 50-40 +10', 'CY Cy Not played yet –']);
    assert.equal(tiles(rivalsCard(1)).length, 1); // no best and worst with one opponent played
    d.matches = [];
    setData(d);
    assert.match(rivalsCard(1), /No finished matches yet/);
  });
});
