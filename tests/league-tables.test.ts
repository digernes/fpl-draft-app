// The draft league's table while a gameweek is played and once its matches are all over.

import './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { standingsTable } from '../src/app/league-tables.ts';
import { setData, setLive } from '../src/app/state.ts';
import type { Data, LiveData } from '../src/shared/data.ts';
import { match, season } from './fixtures/league.ts';

// GW 3 with Ann v Bob under way, or every Premier League match over when `over`.
function gw3(over: boolean): Data {
  const d = season();
  d.matches.push(match(3, 1, 2, 10, 12, false));
  d.live = {
    gw: 3,
    elements: {},
    fixtures: [
      { id: 1, h: 1, a: 2, started: true, done: true },
      { id: 2, h: 3, a: 4, started: true, done: over },
    ],
  } as unknown as LiveData;
  return d;
}

beforeEach(() => setLive(null));

describe('the league table', () => {
  it('has a live column while the gameweek’s matches are being played', () => {
    setData(gw3(false));
    const html = standingsTable('overall');
    assert.match(html, />Live</);
    assert.doesNotMatch(html, /provisional/);
  });

  it('drops it once they’re all over, and says the points are provisional', () => {
    setData(gw3(true));
    const html = standingsTable('overall');
    assert.doesNotMatch(html, />Live</);
    assert.match(html, /<div class="table-note">With gameweek 3’s provisional points<\/div>/);
  });

  it('has neither between gameweeks', () => {
    setData(season());
    const html = standingsTable('overall');
    assert.doesNotMatch(html, />Live<|table-note/);
  });
});
