import './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { setData, state } from '../src/app/state.ts';
import { viewDraft } from '../src/app/views/draft.ts';
import { cardTitled, text } from './fixtures/html.ts';
import { squads } from './fixtures/league.ts';

beforeEach(() => {
  setData(squads());
  state.openSquad = null;
});

const values = (html: string) => [...html.matchAll(/<span class="lrow-value[^"]*">(\d+)<\/span>/g)].map((m) => Number(m[1]));

describe('the draft tab’s original squads', () => {
  it('puts the teams that kept the most of their draft first, the share of their points breaking a tie', () => {
    const squadsCard = cardTitled(viewDraft(), 'Original squad');
    assert.deepEqual(
      [...squadsCard.matchAll(/data-action="squad" data-value="(\d)"/g)].map((m) => Number(m[1])),
      [1, 2, 3],
    );
    assert.match(text(squadsCard), /Cy Cy United 1 \/2 75% of points$/);
    assert.match(squadsCard, /Ann’s &#38; Co/);
  });

  it('opens only the squad asked for, with who is still there, who has gone and who has come in', () => {
    assert.doesNotMatch(viewDraft(), /squad-detail/);
    state.openSquad = '3';
    const html = viewDraft();
    assert.equal(html.match(/squad-detail/g)?.length, 1);
    assert.match(html, /data-value="3" aria-expanded="true"/);
    assert.match(html, /data-value="1" aria-expanded="false"/);
    const detail = text(html.split('squad-detail')[1].split('</div>\n      </div>')[0]);
    assert.match(detail, /Still there · 1 Salah 70 Gone · 1 Isak 12 FA Signed since · 1 Watkins 25/);
  });

  it('says who has a player the team has let go now', () => {
    const d = squads();
    d.players[16].owner = 2;
    d.draft.retention[0].gone[0].owner = 2;
    setData(d);
    state.openSquad = '3';
    const gone = viewDraft().split('Gone · 1')[1].split('Signed since')[0];
    assert.match(gone, /aria-label="Bob"/);
    assert.doesNotMatch(gone, /Free agent now/);
  });

  it('charts the draft picks kept gameweek by gameweek up to now, and not the gameweeks to come', () => {
    const cy = viewDraft().split('data-value="3"')[1];
    const tips = [...cy.matchAll(/data-tip="((?:GW \d|Now)[^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(tips.slice(0, 4), ['GW 1: 2 of 2', 'GW 2: 1 of 2', 'GW 3: 1 of 2', 'Now: 1 of 2']);
    assert.ok(!tips.includes('GW 4: 1 of 2'));
  });
});

describe('the draft board', () => {
  it('lays the picks out round by round, in the first round’s order', () => {
    const board = cardTitled(viewDraft(), 'Draft board');
    assert.deepEqual(
      [...board.matchAll(/<span class="db-name">(\w+)<\/span>/g)].map((m) => m[1]),
      ['Ann', 'Bob', 'Cy'],
    );
    const rounds = board.split('<span class="db-round">').slice(1);
    assert.deepEqual(
      rounds.map((r) => [...r.matchAll(/<span class="db-player">(\w+)<\/span>/g)].map((m) => m[1])),
      [
        ['Saka', 'Palmer', 'Salah'],
        ['Raya', 'Haaland', 'Isak'],
      ],
    );
  });

  it('greys out a pick since let go, says where he is now, and marks an auto-pick', () => {
    const d = squads();
    d.players[15].owner = 3; // Haaland, now Cy’s
    d.draft.retention[1].kept = [13];
    setData(d);
    const board = cardTitled(viewDraft(), 'Draft board');
    assert.match(board, /class="db-cell pos-FWD gone" href="#\/player\/16" data-tip="#4 · Isak · 12 pts · free agent now"/);
    assert.match(board, /data-tip="#5 · Haaland · 80 pts · now with Cy"/);
    assert.match(board, /data-tip="#6 · Raya · 30 pts · auto-pick"/);
    assert.match(board, /class="db-cell pos-MID" href="#\/player\/12"/);
  });

  it('is left out when there was no draft', () => {
    const d = squads();
    d.draft.picks = [];
    setData(d);
    const html = viewDraft();
    assert.equal(cardTitled(html, 'Draft board'), '');
    assert.notEqual(cardTitled(html, 'Original squad'), '');
  });
});

describe('the draft’s steals, busts and hauls', () => {
  it('finds the steals among the second half’s picks, the most points first', () => {
    const steals = cardTitled(viewDraft(), 'Steals');
    assert.match(text(steals), /Haaland Round 2, pick 5 · Bob 80 Raya Round 2, pick 6 · Ann 30 Isak Round 2, pick 4 · Cy 12/);
    assert.match(steals, /<span class="lrow-value top">80<\/span>/);
  });

  it('finds the busts among the first three rounds, the fewest points first, with none picked out', () => {
    const busts = cardTitled(viewDraft(), 'Busts');
    assert.deepEqual(values(busts), [12, 30, 40, 55, 70, 80]);
    assert.doesNotMatch(busts, /lrow-value top/);
  });

  it('ranks every team’s draft haul, kept or not', () => {
    const haul = cardTitled(viewDraft(), 'Draft haul');
    assert.deepEqual(values(haul), [135, 82, 70]);
    assert.deepEqual(
      [...haul.matchAll(/href="#\/team\/(\d)"/g)].map((m) => Number(m[1])),
      [2, 3, 1],
    );
  });
});
