import './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { recentVisits, recordVisit, visitHref, type Visit } from '../src/app/recent.ts';
import type { Route } from '../src/app/router.ts';

// This device's storage, kept between the visits of a test.
let stored = new Map<string, string>();
beforeEach(() => {
  stored = new Map();
  Object.assign(globalThis, {
    localStorage: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) },
  });
});

const player = (id: number): Route => ({ page: 'player', tab: '', id });
const team = (id: number): Route => ({ page: 'team', tab: 'overview', id });
const links = () => recentVisits().map(visitHref);

describe('the pages opened last', () => {
  it('keeps the players, teams and matches opened, the latest first, whichever tab they were on', () => {
    recordVisit(player(14));
    recordVisit(team(2));
    recordVisit({ page: 'match', tab: 'lineup', gw: 3, home: 1, away: 2 });
    recordVisit({ page: 'pl-match', tab: 'player-stats', id: 64 });
    assert.deepEqual(links(), ['#/premier-league/match/64', '#/match/3/1-2', '#/team/2', '#/player/14']);
  });

  it('leaves out the other pages', () => {
    recordVisit({ page: 'home', tab: '' });
    recordVisit({ page: 'league', tab: 'table' });
    recordVisit({ page: 'transfers', tab: '' });
    assert.deepEqual(recentVisits(), []);
  });

  it('moves a page opened again to the top, once', () => {
    recordVisit(player(14));
    recordVisit(player(15));
    recordVisit(player(14));
    assert.deepEqual(links(), ['#/player/14', '#/player/15']);
  });

  it('keeps the last six of each kind, the two leagues’ matches as one', () => {
    for (let id = 1; id <= 8; id++) recordVisit(player(id));
    recordVisit(team(1));
    for (let id = 1; id <= 4; id++) recordVisit({ page: 'pl-match', tab: 'facts', id });
    for (let gw = 1; gw <= 4; gw++) recordVisit({ page: 'match', tab: 'facts', gw, home: 1, away: 2 });
    const visits: Visit[] = recentVisits();
    assert.deepEqual(
      visits.filter((v) => v.page === 'player').map((v) => v.id),
      [8, 7, 6, 5, 4, 3],
    );
    assert.equal(visits.filter((v) => v.page === 'team').length, 1);
    assert.deepEqual(visits.filter((v) => v.page === 'match' || v.page === 'pl-match').map(visitHref), [
      '#/match/4/1-2',
      '#/match/3/1-2',
      '#/match/2/1-2',
      '#/match/1/1-2',
      '#/premier-league/match/4',
      '#/premier-league/match/3',
    ]);
  });

  it('starts again when what was kept can’t be read', () => {
    stored.set('draft.recent', '{not json');
    assert.deepEqual(recentVisits(), []);
    stored.set('draft.recent', '{"page":"player"}');
    assert.deepEqual(recentVisits(), []);
    recordVisit(player(3));
    assert.deepEqual(links(), ['#/player/3']);
  });
});
