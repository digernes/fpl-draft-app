import './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';

import { runAction } from '../src/app/actions.ts';
import { seasonRows, seasonStatsCard } from '../src/app/pl-stats.ts';
import { setData, state } from '../src/app/state.ts';
import { PL_STATS, type PlSeasonStats } from '../src/shared/data.ts';
import { text } from './fixtures/html.ts';
import { squads } from './fixtures/league.ts';

// Everyone in the small league has played: 90 minutes each, and nothing else.
const file: PlSeasonStats = {
  players: Object.fromEntries([11, 12, 13, 14, 15, 16, 17, 18, 19].map((pid) => [pid, [90, ...PL_STATS.map(() => 0)]])),
};

// The card asks for stats/season.json and draws itself again once it's in: the file comes
// at once, and the redraw has nothing to draw into.
const nothing: unknown = new Proxy(function () {}, {
  get: (_t, key) => (key === Symbol.toPrimitive ? () => '' : key === 'then' ? undefined : nothing),
  apply: () => nothing,
});
before(async () => {
  Object.assign(globalThis, {
    document: nothing,
    window: nothing,
    matchMedia: () => ({ matches: false }),
    HTMLSelectElement: class {},
    HTMLDialogElement: class {},
    fetch: async () => ({ ok: true, json: async () => file }),
  });
  setData(squads());
  state.route = { page: 'pl', tab: 'players' };
  seasonStatsCard();
  await new Promise((resolve) => setImmediate(resolve));
});

beforeEach(() => {
  setData(squads());
  Object.assign(state, { playersPos: 'all', playersOwner: 'all', playersAll: false });
});

// Who's in the table, by name, in the file's order.
const names = (clubId?: number) => seasonRows(file, clubId).map((r) => squads().players[r.pid].name);
// A chip's click, as chrome.ts runs it.
const tap = (value: string) => runAction({ dataset: { action: 'players-owner', value } } as unknown as HTMLElement);

describe('the Premier League’s player stats', () => {
  it('has everyone, a manager’s players or the free agents alone', () => {
    assert.equal(names().length, 9);
    state.playersOwner = '1';
    assert.deepEqual(names(), ['Raya', 'Saka', 'Gabriel']);
    state.playersOwner = 'free';
    assert.deepEqual(names(), ['Isak', 'White']);
  });

  it('puts whose players with the club and the position', () => {
    state.playersOwner = '1';
    state.playersPos = 'DEF';
    assert.deepEqual(names(), ['Gabriel']);
    state.playersPos = 'all';
    assert.deepEqual(names(2), []);
    state.playersOwner = '2';
    assert.deepEqual(names(2), ['Palmer']);
  });

  it('goes back to everyone when the chosen chip is tapped again', () => {
    tap('3');
    assert.equal(state.playersOwner, '3');
    tap('free');
    assert.equal(state.playersOwner, 'free');
    tap('free');
    assert.equal(state.playersOwner, 'all');
  });

  it('offers everyone, the free agents and each manager by first name, the chosen one pressed', () => {
    state.playersOwner = '2';
    const html = seasonStatsCard();
    const chips = [
      ...html.matchAll(
        /<button type="button" class="chip" data-action="players-owner" data-value="([^"]+)" aria-pressed="(\w+)"[^>]*>(.*?)<\/button>/g,
      ),
    ];
    // Once over the table, once in the sheet.
    assert.equal(chips.length, 10);
    assert.deepEqual(
      chips
        .slice(0, 5)
        .map(([, value, pressed, label]) => `${value} ${pressed} ${label.includes('class="av ') ? 'avatar ' : ''}${text(label)}`),
      ['all false All players', 'free false Free agents', '1 false avatar Ann', '2 true avatar Bob', '3 false avatar Cy'],
    );
    assert.match(html, /<div class="card-sub">2 players this season<\/div>/);
    assert.match(html, /Filter · 1/);
  });
});
