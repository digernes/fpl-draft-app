import { drawIntoNothing } from './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { runAction } from '../src/app/actions.ts';
import { followButton, pageTeam } from '../src/app/pages/team.ts';
import { href, type Route } from '../src/app/router.ts';
import { setData, setLive, setSeasons, state } from '../src/app/state.ts';
import { cardTitles } from './fixtures/html.ts';
import { season } from './fixtures/league.ts';

// The stats files never come in.
Object.assign(globalThis, { fetch: () => new Promise(() => {}) });
drawIntoNothing();

const page = (id: number, tab: Route['tab'] = 'overview') => pageTeam({ page: 'team', tab, id });
// A tap on a button with an action, as chrome.ts runs it.
const tap = (action: string, value: string) => runAction({ dataset: { action, value } } as unknown as HTMLElement);

beforeEach(() => {
  setData(season());
  setLive(null);
  Object.assign(state, { myTeam: null, lineupView: 'last', squadScope: 'now', squadSort: 'lineup', moves: 'all' });
  state.route = { page: 'team', tab: 'overview', id: 1 };
});

afterEach(() => {
  setSeasons([]);
  state.season = null;
});

describe('a team’s page', () => {
  it('says so when there is no such team in the league', () => {
    const view = page(9);
    assert.equal(view.title, 'Team');
    assert.match(view.body, /No such team in this league/);
    assert.equal(view.header, undefined);
  });

  it('heads the page with the team, its manager and place, a Follow button and the tabs', () => {
    const { title, header } = page(1);
    assert.equal(title, 'Ann’s & Co');
    assert.equal(header!.title, 'Ann’s &#38; Co');
    assert.equal(header!.sub, 'Ann · 2nd of 3');
    assert.match(header!.side!, /<span>Follow<\/span>/);
    assert.deepEqual(
      header!.tabs!.map((t) => `${t.label} ${t.href}`),
      ['Overview #/team/1', 'Squad #/team/1/squad', 'Fixtures #/team/1/fixtures', 'Transfers #/team/1/transfers', 'Stats #/team/1/stats'],
    );
    assert.equal(page(1, 'squad').title, 'Squad · Ann’s & Co');
  });

  it('leaves the place out before there is a table, and the Follow button out of an archive', () => {
    const d = season();
    d.tables.overall = [];
    setData(d);
    assert.equal(page(1).header!.sub, 'Ann');
    setSeasons([{ season: '2026/27', name: 'Office League', file: 'seasons/2026-27/data.json' }]);
    state.season = '2026-27';
    assert.equal(page(1).header!.side, '');
  });

  it('says Following on the team the visitor follows', () => {
    state.myTeam = 1;
    assert.equal(
      followButton(1).replace(/<svg[\s\S]*<\/svg>/, ''),
      '<button type="button" class="follow on" data-action="follow" data-value="1" aria-pressed="true"><span>Following</span></button>',
    );
    assert.match(followButton(2), /aria-pressed="false"/);
  });

  it('has each tab’s cards', () => {
    assert.deepEqual(cardTitles(page(1).body), ['Team form', 'Table', 'Head to head', 'Starting XI', 'Fixtures']);
    assert.deepEqual(cardTitles(page(1, 'squad').body), ['Squad', 'Points by position', 'Original squad']);
    assert.deepEqual(cardTitles(page(1, 'fixtures').body), ['Fixtures', 'Head to head']);
    assert.deepEqual(cardTitles(page(1, 'transfers').body), ['Transfers']);
    assert.deepEqual(cardTitles(page(1, 'stats').body), ['Season', 'Top scorers', 'Points by position', 'Left on the bench']);
  });

  it('picks the team out in the overview’s table, with a way to the full one', () => {
    const { body } = page(2);
    assert.match(body, /<div class="trow {2}featured qual" data-key="m-2"/);
    assert.match(body, /<div class="trow {2}qual" data-key="m-1"/);
    assert.ok(body.includes(`<a class="card-footer" href="${href.league('table')}">Full table</a>`));
  });

  it('switches the starting XI, the squad’s scope and sort, and the moves shown, from their buttons', () => {
    tap('lineup-view', 'all');
    tap('squad-scope', 'all');
    tap('squad-sort', 'total');
    tap('moves', 'in');
    assert.deepEqual([state.lineupView, state.squadScope, state.squadSort, state.moves], ['all', 'all', 'total', 'in']);
    assert.match(page(1).body, /data-action="lineup-view" data-value="all" aria-pressed="true"/);
  });
});
