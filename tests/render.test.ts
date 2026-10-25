import './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { navItems, pageHtml, seasonChip, statusChips } from '../src/app/render.ts';
import { setData, state } from '../src/app/state.ts';
import type { Data } from '../src/shared/data.ts';
import { league, match } from './fixtures/league.ts';

beforeEach(() => {
  setData(league());
  state.myTeam = null;
});

describe('the top bar’s chips', () => {
  it('counts down to the waivers, then the deadline', () => {
    assert.equal(
      statusChips().replace(/ data-tip="[^"]*"/g, ''),
      '<span class="status-chip">Waivers in <strong>1h 30m</strong></span><span class="status-chip">GW 4 deadline in <strong>1d 1h</strong></span>',
    );
  });

  it('shows the gameweek live in place of the deadline while a match is on', () => {
    const d = league();
    d.matches.push(match(3, 1, 2, 10, 12, false));
    setData(d);
    const chips = statusChips();
    assert.match(chips, /Live · GW 3/);
    assert.doesNotMatch(chips, /deadline in/);
  });

  it('says the gameweek is provisional, not live, once its matches are all over, the deadline back', () => {
    const d = league();
    d.matches.push(match(3, 1, 2, 10, 12, false));
    d.live = { gw: 3, elements: {}, fixtures: [{ id: 1, h: 1, a: 2, started: true, done: true }] } as unknown as Data['live'];
    setData(d);
    const chips = statusChips();
    assert.doesNotMatch(chips, /Live · GW 3/);
    assert.match(chips, /<span class="status-chip" data-tip="[^"]+">GW 3 provisional<\/span>/);
    assert.match(chips, /GW 4 deadline in/);
  });

  it('names the season, with no picker while there’s only the one', () => {
    assert.equal(seasonChip(), '<span class="season-chip">2026/2027</span>');
  });
});

describe('the bars’ links', () => {
  const lit = (hash: Parameters<typeof navItems>[0]) =>
    navItems(hash)
      .filter((i) => i.on)
      .map((i) => i.label);

  it('lights the draft league for its matches too, and the Premier League for its', () => {
    assert.deepEqual(lit({ page: 'match', tab: 'facts', gw: 1, home: 1, away: 2 }), ['Draft league']);
    assert.deepEqual(lit({ page: 'pl-match', tab: 'facts', id: 9 }), ['Premier League']);
  });

  it('puts the followed team in place of all the teams, lit only on its own page', () => {
    assert.deepEqual(lit({ page: 'team', tab: 'overview', id: 2 }), ['Teams']);
    state.myTeam = 2;
    const items = navItems({ page: 'team', tab: 'overview', id: 3 });
    assert.equal(items.at(-1)?.label, 'My team');
    assert.equal(items.at(-1)?.to, '#/team/2');
    assert.deepEqual(lit({ page: 'team', tab: 'overview', id: 2 }), ['My team']);
  });

  it('leaves Home out of the top bar', () => {
    assert.ok(navItems({ page: 'home', tab: '' }).every((i) => i.top !== (i.label === 'Home')));
  });
});

describe('a page’s markup', () => {
  it('puts the header over the body, or at the head of the body’s column beside a right one', () => {
    assert.equal(pageHtml({ body: 'B' }), '<div class="view" id="view">B</div>');
    assert.equal(
      pageHtml({ body: 'B', aside: { html: 'A', cls: 'two' } }),
      '<div class="view" id="view"><div class="cols two"><div class="col">B</div><div class="col">A</div></div></div>',
    );
  });
});
