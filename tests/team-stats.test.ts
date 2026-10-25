import './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { benchCard, scorersCard, seasonCard } from '../src/app/pages/team-stats.ts';
import { setData, setLive, type LiveLineup } from '../src/app/state.ts';
import type { Data } from '../src/shared/data.ts';
import { listRows, text, tiles } from './fixtures/html.ts';
import { lineup, season } from './fixtures/league.ts';

// After GW 2 (see season()): Salah scored in both gameweeks and set one up in GW 1, Watkins
// scored in GW 2.
function data(): Data {
  const d = season();
  d.events = { 1: { 14: { goals: 1, assists: 1 } }, 2: { 14: { goals: 1 }, 17: { goals: 1 } } };
  return d;
}

beforeEach(() => {
  setData(data());
  setLive(null);
});

describe('a team’s season', () => {
  it('has the best and worst gameweeks with their results, the top scorer, the bench and the close calls', () => {
    assert.deepEqual(tiles(seasonCard(3)), [
      'Best gameweek: 60 · Won 60-45 vs Bob · GW 2',
      'Worst gameweek: 30 · Drew 30-30 vs Ann · GW 1',
      'Top scorer: Salah · 21 pts in your XI',
      'On the bench: 7 · 4 a week left out',
      'Worst winning score: 60 · Beat Bob 60-45 · GW 2',
      'Longest winning run: 1 · Current run W1',
      'Transfers: 0 · None yet',
    ]);
  });

  it('has the best losing score for a team that has lost, and the net points of its moves', () => {
    const d = data();
    d.transfers.summary[1] = { ...d.transfers.summary[1], moves: 2, net: -3 };
    setData(d);
    const list = tiles(seasonCard(2));
    assert.ok(list.includes('Best losing score: 45 · Lost 45-60 to Cy · GW 2'));
    assert.ok(list.includes('Longest winning run: 0'));
    assert.equal(list.at(-1), 'Transfers: 2 · -3 net points');
  });

  it('gives a gameweek without a finished match just its number, and leaves out the transfers without a summary', () => {
    const d = data();
    d.seasonStats[0].high = { pts: 66, gw: 3 };
    d.transfers.summary = [];
    setData(d);
    const list = tiles(seasonCard(3));
    assert.equal(list[0], 'Best gameweek: 66 · GW 3');
    assert.ok(!list.some((t) => t.startsWith('Transfers')));
  });

  it('is left out before the team has a best and a worst gameweek', () => {
    const d = data();
    d.seasonStats[0].high = null;
    setData(d);
    assert.equal(seasonCard(3), '');
  });
});

describe('a team’s top scorers', () => {
  it('ranks the players on their points in the XI, with their starts, goals and assists', () => {
    assert.deepEqual(listRows(scorersCard(3)), ['1 Salah 2 starts · 2 goals · 1 assist 21', '2 Watkins 1 start · 1 goal · 0 assists 8']);
  });

  it('leaves out those who scored nothing, and says so when nobody has', () => {
    const d = data();
    d.players[17].pts = [0, 0, 0];
    setData(d);
    assert.equal(listRows(scorersCard(3)).length, 1);
    d.lineups = {};
    setData(d);
    assert.match(scorersCard(3), /No points yet/);
  });
});

describe('a team’s bench', () => {
  it('lists the points each player scored on the bench, and counts the automatic substitutions', () => {
    const d = data();
    d.lineups[3][2] = { ...d.lineups[3][2], subs: [17] };
    setData(d);
    const html = benchCard(3);
    assert.match(html, /<div class="card-sub">7 pts on the bench · 1 automatic substitution<\/div>/);
    assert.deepEqual(listRows(html), ['Isak 2 weeks on the bench 7']);
  });

  it('counts the gameweek being played as it stands', () => {
    const live = { ...lineup([14], [17]), subs: [], points: () => 0 } as unknown as LiveLineup;
    setLive({ gw: 3, feed: { elements: {}, fixtures: [] }, lineups: { 3: live }, points: (pid) => (pid === 17 ? 6 : 0), bonus: () => 0 });
    assert.deepEqual(listRows(benchCard(3)), ['Isak 2 weeks on the bench 7', 'Watkins 1 week on the bench 6']);
  });

  it('says so when nothing has been left on the bench', () => {
    const html = benchCard(2);
    assert.equal(text(html), 'Left on the bench 0 pts on the bench · 0 automatic substitutions Nothing on the bench yet');
  });
});
