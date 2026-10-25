import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildDraft } from '../src/build/draft.ts';
import { buildLineups, buildManagers, buildMatches, lineupOf } from '../src/build/lineups.ts';
import { readSeason } from '../src/build/season.ts';
import { fetched, MANAGERS } from './fixtures/build-league.ts';

// The fixture league's snake draft: manager 101 took players 1-15, 102 16-30 and so on.
// 101 has since lost 12 (dropped) and 14 (traded to 104) for 63 and 59.
const f = fetched();
f.choices.push({ element: null, entry: 104, index: 61, round: 16, pick: 1, was_auto: false }); // a pick never made
const season = readSeason(f);
const { entryByLeagueEntry } = buildManagers(season);
const lineup = lineupOf(buildLineups(season, buildMatches(season, entryByLeagueEntry)));
const draft = buildDraft(season, MANAGERS, lineup);

describe('the draft', () => {
  it('lists every pick made, in order, snaking back each round', () => {
    assert.equal(draft.picks.length, 60);
    assert.deepEqual(draft.picks.slice(0, 5), [
      { overall: 1, round: 1, pick: 1, manager: 101, player: 1, auto: false },
      { overall: 2, round: 1, pick: 2, manager: 102, player: 16, auto: false },
      { overall: 3, round: 1, pick: 3, manager: 103, player: 31, auto: false },
      { overall: 4, round: 1, pick: 4, manager: 104, player: 46, auto: false },
      { overall: 5, round: 2, pick: 1, manager: 104, player: 47, auto: false },
    ]);
    assert.equal(draft.picks.at(-1)?.auto, true);
  });

  it('follows how much of each original squad is still there', () => {
    const ola = draft.retention.find((r) => r.id === 101)!;
    assert.equal(ola.size, 15);
    assert.equal(ola.kept.length, 13);
    assert.deepEqual(ola.gone, [
      { player: 12, owner: null },
      { player: 14, owner: 104 },
    ]);
    assert.deepEqual(ola.newcomers.sort(), [59, 63]);
    assert.deepEqual(ola.byGw, [15, 13, 13]);
    const kari = draft.retention.find((r) => r.id === 102)!;
    assert.deepEqual([kari.kept.length, kari.gone, kari.newcomers, kari.byGw, kari.originalShare], [15, [], [], [15, 15, 15], 1]);
  });

  it('shares out the XI’s points between the originals and the newcomers', () => {
    const ola = draft.retention.find((r) => r.id === 101)!;
    const xiPoints = (keep: (pid: number) => boolean) => {
      let total = 0;
      for (const gw of season.gws) for (const pid of lineup(101, gw)!.xi.filter(keep)) total += season.pointsIn(pid, gw);
      return total;
    };
    const original = (pid: number) => pid <= 15;
    assert.equal(ola.originalXiPts, xiPoints(original));
    assert.equal(ola.originalShare, Math.round((xiPoints(original) / xiPoints(() => true)) * 1000) / 1000);
    assert.ok(ola.originalShare < 1);
    let haul = 0;
    for (let pid = 1; pid <= 15; pid++) haul += season.elements.get(pid)!.total_points;
    assert.equal(ola.draftHaul, haul);
  });

  it('has nothing for a manager who drafted nobody', () => {
    const [nobody] = buildDraft(season, [999], lineup).retention;
    assert.deepEqual(nobody, {
      id: 999,
      size: 0,
      kept: [],
      gone: [],
      newcomers: [],
      byGw: [0, 0, 0],
      originalShare: 0,
      originalXiPts: 0,
      draftHaul: 0,
    });
  });
});
