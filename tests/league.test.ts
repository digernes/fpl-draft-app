import './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { pageLeague } from '../src/app/pages/league.ts';
import type { Route } from '../src/app/router.ts';
import { setData, setLive, setSeasons, state } from '../src/app/state.ts';
import { cardTitles } from './fixtures/html.ts';
import { season } from './fixtures/league.ts';

const page = (tab: Route['tab'], gw?: number) => pageLeague({ page: 'league', tab, ...(gw ? { gw } : {}) });

beforeEach(() => {
  const d = season();
  d.meta.months = [{ name: 'August', from: 1, to: 2 }];
  d.plMatches = [];
  setData(d);
  setLive(null);
  Object.assign(state, { myTeam: null, tableView: 'overall', tableMode: 'short' });
});

afterEach(() => {
  setSeasons([]);
  state.season = null;
});

describe('the draft league’s page', () => {
  it('heads every tab with the league, its managers, the season and the tabs', () => {
    const { title, header } = page('overview');
    assert.equal(title, 'Draft league');
    assert.equal(header!.title, 'Office League');
    assert.equal(header!.sub, 'Premier League Draft · 3 managers');
    assert.match(header!.side!, /<span class="season-chip">2026\/2027<\/span>/);
    assert.deepEqual(
      header!.tabs!.map((t) => `${t.label} ${t.href}`),
      [
        'Overview #/league',
        'Table #/league/table',
        'Fixtures #/league/fixtures',
        'Stats #/league/stats',
        'Transfer stats #/league/transfer-stats',
        'Draft #/league/draft',
      ],
    );
    assert.equal(header!.tab, 'overview');
  });

  it('calls an archived season’s standings final', () => {
    setSeasons([{ season: '2026/27', name: 'Office League', file: 'seasons/2026-27/data.json' }]);
    state.season = '2026-27';
    assert.equal(page('table').header!.sub, 'Premier League Draft · 3 managers · final standings');
  });

  it('shows each tab’s view, named after it', () => {
    assert.equal(page('table').title, 'Table');
    assert.deepEqual(cardTitles(page('table').body), ['Parallel Premier League', 'Luck']);
    assert.equal(page('fixtures', 2).title, 'Fixtures');
    assert.match(page('fixtures', 2).body, /<option value="#\/league\/fixtures\/2" selected>/);
    assert.deepEqual(cardTitles(page('stats').body).slice(0, 2), ['Season records', 'Top gameweeks']);
    assert.equal(cardTitles(page('transfer-stats').body)[0], 'Transfer market');
    assert.equal(page('draft').title, 'Draft');
    assert.match(page('draft').body, /Saka/);
  });
});
