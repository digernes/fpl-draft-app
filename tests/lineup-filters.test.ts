import './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { bestOfMatch, dueShows, lineupFilters, showsEvents, statBadge, xpTip } from '../src/app/lineup-filters.ts';
import { setData, setLive, state } from '../src/app/state.ts';
import { bobVCy } from './fixtures/match.ts';

// The stats files never come in: GW 2's underlying numbers are in data.json.
Object.assign(globalThis, { fetch: () => new Promise(() => {}) });

beforeEach(() => {
  setData(bobVCy());
  setLive(null);
  Object.assign(state, { lineupStat: '', due: '' });
});

const chips = (html: string) =>
  [...html.matchAll(/data-action="([\w-]+)" data-value="(\w+)" aria-pressed="(\w+)"/g)].map(
    ([, action, value, on]) => `${action}:${value}${on === 'true' ? '*' : ''}`,
  );

describe('the lineup filters', () => {
  it('offer the underlying numbers once a gameweek is over, the one chosen pressed', () => {
    state.lineupStat = 'xg';
    assert.deepEqual(chips(lineupFilters(2, false)), ['lineup-stat:xp', 'lineup-stat:xg*', 'lineup-stat:xa', 'lineup-stat:xcs']);
    assert.equal(lineupFilters(1, false), ''); // no underlying numbers for GW 1
  });

  it('offer Projected too while players are still to play, chosen by default before a gameweek', () => {
    assert.deepEqual(chips(lineupFilters(4, true)), ['due:ko*']);
    assert.equal(dueShows(4), 'xp');
    assert.equal(dueShows(3), 'ko');
    state.due = 'xp';
    assert.equal(dueShows(3), 'xp');
  });

  it('swap the points for the number chosen, the icons kept for xP alone', () => {
    assert.equal(statBadge(13, 2), undefined);
    state.lineupStat = 'xg';
    assert.equal(statBadge(13, 2), '<span class="ptsp xp" data-tip="0.45 expected goals">0.45</span>');
    assert.equal(showsEvents(2), false);
    state.lineupStat = 'xa';
    assert.equal(statBadge(14, 2), '<span class="ptsp xp" data-tip="0.35 expected assists">0.35</span>');
    state.lineupStat = 'xcs';
    assert.equal(statBadge(14, 2), ''); // a clean sheet scores nothing for a midfielder here
    state.lineupStat = 'xp';
    assert.equal(showsEvents(2), true);
    assert.match(statBadge(13, 2)!, /^<span class="ptsp p1" data-tip="5.8 xP · 7 points scored" data-tip-rows="[^"]*">5.8<\/span>$/);
    assert.match(statBadge(14, 2, true)!, /^<span class="ptsp top" data-tip="9.4 xP · 13 points scored · the match’s best"/);
    assert.equal(statBadge(16, 2), ''); // Isak, on a bench, has none
  });

  it('take xP apart into what the chances were worth and what stays as scored', () => {
    // Palmer's 0.45 xG and 0.1 xA, worth 2.25 and 0.3 points; the rest of his 5.8 as scored.
    const rows = xpTip([13], 2)
      .match(/data-tip-rows="([^"]*)"/)![1]
      .split('\n');
    assert.deepEqual(rows, ['Goals · 0.45 xG\t2.3', 'Assists · 0.10 xA\t0.3', 'As scored\t3.3']);
    const both = xpTip([13, 15], 2);
    assert.match(both, /data-tip="8.9 xP · 9 points scored"/);
  });

  it('pick the match’s best by xP while that’s chosen, else by points', () => {
    assert.deepEqual([...bestOfMatch([13, 15, 14, 17], 2)], [14]);
    state.lineupStat = 'xp';
    assert.deepEqual([...bestOfMatch([13, 15, 17], 2)], [13]);
  });
});
