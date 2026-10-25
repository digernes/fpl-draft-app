import './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { clubFixtures, opponents } from '../src/app/lookups.ts';
import { setData, state } from '../src/app/state.ts';
import { statsTable, type StatsRow } from '../src/app/stats-table.ts';
import type { Data, PlMatch, XpParts } from '../src/shared/data.ts';
import { squads } from './fixtures/league.ts';

const plMatch = (gw: number, home: number, away: number, ko: string | null = null): PlMatch => ({
  id: gw * 100 + home,
  gw,
  home,
  away,
  ko,
});

// Saka's (Arsenal) next gameweek is GW 4, which data.json lists the fixtures of; GW 5 and 6
// are only in the season's matches, GW 6 a double for Arsenal and a blank for Man City.
function data(): Data {
  const d = squads();
  d.gameweeks[3].fixtures = [[1, 2, '2026-09-12T14:00:00Z']];
  d.gameweeks.push({ id: 5, deadline: '', finished: false, doubles: [] }, { id: 6, deadline: '', finished: false, doubles: [1] });
  d.plMatches = [plMatch(4, 1, 2), plMatch(4, 3, 4), plMatch(5, 4, 1, '2026-09-19T14:00:00Z'), plMatch(6, 1, 3), plMatch(6, 2, 1)];
  return d;
}

const parts = (minutes: number, goals: number, bonus: number): XpParts => [minutes, 2, goals, 0, 0.04, 0, 0, 0, 0, bonus, -0.1];

beforeEach(() => setData(data()));

describe('clubFixtures', () => {
  it('keeps data.json’s fixtures for the gameweeks it lists', () => {
    assert.deepEqual(clubFixtures(1, 4), [[1, 2, '2026-09-12T14:00:00Z']]);
    // Listed without Man City: the season's matches don't add theirs back.
    assert.equal(opponents(4, 4), '');
  });

  it('finds the later gameweeks’ in the season’s matches, a double and a blank too', () => {
    assert.deepEqual(clubFixtures(1, 5), [[4, 1, '2026-09-19T14:00:00Z']]);
    assert.equal(opponents(1, 5), 'Man City (A)');
    assert.equal(opponents(1, 6), 'Liverpool (H), Chelsea (A)');
    assert.equal(opponents(4, 6), '');
  });
});

describe('the Projected columns', () => {
  const row = (pid: number, club: number, points: number[]): StatsRow => ({
    pid,
    club,
    min: 0,
    pts: 0,
    owner: null,
    ahead: { points, minutes: 0, goals: 0, assists: 0, cleanSheet: 0, defcon: 0, bonus: 0 },
  });
  const cells = (pid: number, club: number, points: number[]) => {
    state.statsCategory = 'projected';
    const { html } = statsTable(
      [row(pid, club, points)],
      () => undefined,
      () => '',
      { season: true, gws: [4, 5, 6] },
    );
    return [...html.matchAll(/<td>(<span[^]*?<\/span>)<\/td>/g)].map((m) => m[1]);
  };

  it('take the points apart as an xP pill’s tip, his expected minutes and who against first', () => {
    const d = data();
    d.players[12].parts = parts(84.6, 1.5, 0.6);
    d.players[12].ahead = [{ ep: 3.1, parts: parts(80, 0.9, 0.3) }];
    setData(d);
    const [gw4, gw5] = cells(12, 1, [4.1, 3.1, 7]);
    assert.equal(
      gw4,
      '<span data-tip="4.1 xP · 85 avg mins\nChelsea (H)" data-tip-rows="Playing\t2.0\nGoals\t1.5\nBonus\t0.6\nCards\t−0.1">4.1</span>',
    );
    assert.match(gw5, /^<span data-tip="3\.1 xP · 80 avg mins\nMan City \(A\)" data-tip-rows="Playing\t2\.0\nGoals\t0\.9\n/);
  });

  it('take them apart as the site’s whatever the setting, the columns being the site’s alone', () => {
    const d = data();
    d.players[12].parts = parts(84.6, 1.5, 0.6);
    setData(d);
    state.xp = 'fpl';
    try {
      assert.match(cells(12, 1, [4.1, 3.1, 7])[0], /data-tip-rows="Playing/);
    } finally {
      state.xp = 'model';
    }
  });

  it('name every opponent where data.json has no parts, with his xP over them', () => {
    const [gw4, gw5, gw6] = cells(19, 1, [2.2, 2.5, 4.8]);
    assert.equal(gw4, '<span data-tip-head="2.2 xP" data-tip="Chelsea (H)">2.2</span>');
    assert.equal(gw5, '<span data-tip-head="2.5 xP" data-tip="Man City (A)">2.5</span>');
    assert.equal(gw6, '<span data-tip-head="4.8 xP" data-tip="Liverpool (H), Chelsea (A)">4.8</span>');
  });

  it('say so in a blank gameweek', () => {
    assert.equal(cells(15, 4, [5, 6, 0])[2], '<span data-tip="No match">0</span>');
  });
});
