import './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { originalCard, positionCard, squadCard } from '../src/app/pages/team-squad.ts';
import { setData, setLive, setSeasons, state } from '../src/app/state.ts';
import type { Data } from '../src/shared/data.ts';
import { text } from './fixtures/html.ts';
import { lineup, season } from './fixtures/league.ts';

// The stats files never come in.
Object.assign(globalThis, { fetch: () => new Promise(() => {}) });

// After GW 2 (see season()), in GW 3: Ann has Raya and Saka in her XI and Gabriel on the bench
// again, and has signed White since its deadline; Raya is doubtful. Cy has Salah and Watkins,
// Isak gone back to the free agents.
function data(): Data {
  const d = season();
  d.lineups[1][3] = lineup([11, 12], [18], 6);
  d.lineups[3][3] = lineup([14, 17], [], 6);
  d.players[19].owner = 1;
  d.players[11] = { ...d.players[11], status: 'd', news: 'Knock - 75% chance of playing' };
  Object.assign(d.players[11], { ep: 3.2 });
  Object.assign(d.players[12], { ep: 5.6 });
  Object.assign(d.players[18], { ep: 4.1 });
  return d;
}

beforeEach(() => {
  setData(data());
  setLive(null);
  Object.assign(state, { squadScope: 'now', squadSort: 'lineup', xp: 'model', season: null });
});

afterEach(() => {
  setSeasons([]);
  state.season = null;
});

// The squad's rows as a reader sees them: the player, his note and the columns.
const rows = (html: string) =>
  [...html.matchAll(/<a class="sq-row([^"]*)" href="#\/player\/\d+">([\s\S]*?)<\/a>/g)].map((m) => `${text(m[2])}${m[1]}`);
const heads = (html: string) => [...html.matchAll(/<div class="sq-head">(.*?)<\/div>/g)].map((m) => text(m[1]));

describe('a team’s squad', () => {
  it('groups the squad by position, the XI first, then the bench and the new signings', () => {
    const html = squadCard(1);
    assert.match(html, /<div class="card-sub">4 players · 6 pts in GW 3<\/div>/);
    assert.deepEqual(heads(html), ['Goalkeepers GWs GW3 Proj Total', 'Defenders GWs GW3 Proj Total', 'Midfielders GWs GW3 Proj Total']);
    assert.deepEqual(rows(html), [
      'Raya ! ARS 3 1 3.2 9',
      'Gabriel ARS · Bench 3 3 4.1 0 benched',
      'White ARS · New 0 – 0.0 0',
      'Saka ARS 3 5 5.6 18',
    ]);
    assert.match(html, /<span class="tag tag-flag" data-tip="Knock - 75% chance of playing">!<\/span>/);
    assert.match(html, /data-tip="Joined after the GW 3 deadline, so not in that lineup">New</);
  });

  it('sorts on a column, highest first, the position as a chip, and goes back to the groups from Position or the column', () => {
    state.squadSort = 'total';
    const html = squadCard(1);
    assert.deepEqual(heads(html), ['Position GWs GW3 Proj Total']);
    assert.deepEqual(
      rows(html).map((r) => r.split(' ')[0]),
      ['Saka', 'Raya', 'Gabriel', 'White'],
    );
    assert.match(html, /<span class="pos-tag pos-MID">MID<\/span>/);
    assert.match(
      html,
      /data-action="squad-sort" data-value="lineup" aria-pressed="true" data-tip="Points in Ann’s XI this season · tap again for the lineup order">Total/,
    );
    assert.match(html, /class="sq-label sq-sort" data-action="squad-sort" data-value="lineup"/);
    state.squadSort = 'xp';
    assert.deepEqual(
      rows(squadCard(1)).map((r) => r.split(' ')[0]),
      ['Saka', 'Gabriel', 'Raya', 'White'],
    );
    state.squadSort = 'gw';
    // Out of the GW 3 lineup, White goes last.
    assert.deepEqual(
      rows(squadCard(1)).map((r) => r.split(' ')[0]),
      ['Saka', 'Gabriel', 'Raya', 'White'],
    );
  });

  it('shows everyone ever owned, those let go faded with where they went', () => {
    state.squadScope = 'all';
    const html = squadCard(3);
    assert.match(html, /<div class="card-sub">3 players ever owned · 35 pts in the XI<\/div>/);
    assert.deepEqual(rows(html), ['Salah LIV 3 4 0.0 25', 'Watkins LIV 2 2 0.0 10', 'Isak CHE · Left 2 – – 0 gone']);
    assert.match(html, /<span data-tip="A free agent now">Left<\/span>/);
    const d = data();
    d.players[16].owner = 2;
    setData(d);
    assert.match(squadCard(3), /<span data-tip="Now with Bob">Left<\/span>/);
  });

  it('says what the expected points are for, the site’s or FPL’s', () => {
    assert.match(squadCard(1), /data-tip="Projected points for GW 4 · tap to sort">Proj/);
    state.xp = 'fpl';
    assert.match(squadCard(1), /data-tip="Projected points for GW 4 \(FPL’s form\) · tap to sort">Proj/);
  });

  it('marks a player who came on automatically', () => {
    const d = data();
    d.lineups[1][3] = { ...lineup([18, 12], [11], 6), subs: [18], off: [11] };
    setData(d);
    assert.match(squadCard(1), /<span data-tip="Came on as an automatic substitute in GW 3">Auto-sub<\/span>/);
  });

  it('has no gameweek column before the team’s first lineup, and no expected points in an archive or once the season is over', () => {
    const d = data();
    delete d.lineups[1][3];
    setData(d);
    assert.match(squadCard(1), /<div class="card-sub">4 players<\/div>/);
    assert.deepEqual(heads(squadCard(1))[0], 'Goalkeepers GWs Proj Total');
    d.meta.nextGw = 5;
    setData(d);
    assert.deepEqual(heads(squadCard(1))[0], 'Goalkeepers GWs Total');
    setData(data());
    setSeasons([{ season: '2026/27', name: 'Office League', file: 'seasons/2026-27/data.json' }]);
    state.season = '2026-27';
    assert.deepEqual(heads(squadCard(1))[0], 'Goalkeepers GWs GW3 Total');
  });

  it('says so when the team has nobody', () => {
    const d = data();
    for (const p of Object.values(d.players)) if (p.owner === 2) p.owner = null;
    setData(d);
    assert.match(squadCard(2), /No players yet/);
  });
});

describe('a team’s points by position', () => {
  it('draws the XI’s points from each position against the biggest share', () => {
    // Bob's two matches: Palmer's 8 and 2, and Haaland's 13 and 2.
    const html = positionCard(2);
    assert.match(
      html,
      /data-tip="Midfielders: 10 pts, 40% of the XI’s points"><span class="pos-label">MID<\/span><span class="pos-track"><i class="m2" style="width:66.7%">/,
    );
    assert.match(html, /data-tip="Forwards: 15 pts, 60% of the XI’s points">.*width:100.0%/);
    assert.match(html, /data-tip="Goalkeepers: 0 pts, 0% of the XI’s points"/);
  });

  it('is left out before the team has scored', () => {
    const d = data();
    d.matches = [];
    setData(d);
    assert.equal(positionCard(1), '');
  });
});

describe('a team’s original squad', () => {
  it('has the picks still here, those gone and where to, and who has come in since', () => {
    const html = text(originalCard(3));
    assert.equal(html, 'Original squad Still here · 1 Salah Gone · 1 Isak FA Signed since · 1 Watkins');
    const d = data();
    d.draft.retention[0].gone = [{ player: 16, owner: 2 }];
    setData(d);
    assert.match(text(originalCard(3)), /Gone · 1 Isak BO Signed/);
  });

  it('says when nobody has gone or come, and is left out without the draft', () => {
    assert.equal(text(originalCard(2)), 'Original squad Still here · 2 Palmer Haaland Gone · 0 Nobody, yet Signed since · 0 Nobody');
    const d = data();
    d.draft.retention = [];
    setData(d);
    assert.equal(originalCard(2), '');
  });
});
