import { drawIntoNothing } from './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { applyLatestLive } from '../src/app/live-scores.ts';
import { liveXp, namedIn, nextXp } from '../src/app/lookups.ts';
import { inPlayOdds, projectionOf } from '../src/app/match-odds.ts';
import { live, setData, setLive, state } from '../src/app/state.ts';
import type { Data, InPlayRecord } from '../src/shared/data.ts';
import {
  inPlayOddsIn,
  liveExpectedIn,
  liveXpIn,
  namedInGw,
  nextXpOf,
  playerInfoIn,
  projectionIn,
  mergeRecords,
  NEAR,
  parseRecords,
  recordKey,
  recordsNow,
  scoreLive,
} from '../src/shared/in-play.ts';
import { liveProjection, type Expected } from '../src/shared/live-projection.ts';
import { namedFrom, scoreLineup, type SlimLive } from '../src/shared/live.ts';
import { liveOdds } from '../src/shared/odds.ts';
import { annVBobLive, gw3Stats } from './fixtures/match.ts';

// The page's stats file never comes: its live odds go without one.
drawIntoNothing();
globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;

const feedOf = (d: Data): SlimLive => d.live!;
const stats = gw3Stats();
const statsOf = (fixture: number) => stats.matches[fixture];

// The live odds as the page worked them out before they were shared: each lineup scored with
// the formations' named players, and projected with the expected points by the setting.
function asBefore(d: Data, fpl: boolean, withStats: boolean) {
  const info = (pid: number) => d.players[pid] ?? { pos: undefined, club: undefined };
  const teams = new Map((d.plMatches ?? []).flatMap((x) => (x.gw === 3 && x.formations ? [[x.id, x.formations] as const] : [])));
  const named = namedFrom((fixture) => teams.get(fixture));
  const xp = (pid: number) =>
    (fpl ? d.live?.fplEp?.[pid] : undefined) ?? d.live?.ep[pid] ?? (fpl ? (d.players[pid].fpl ?? d.players[pid].ep) : d.players[pid].ep);
  const expected: Expected = {
    points: (pid) => (d.players[pid] ? xp(pid) : 0),
    parts: fpl ? undefined : (pid) => d.live?.parts?.[pid],
    cleanSheet: d.live?.cleanSheet,
    named,
    rules: d.meta.rules,
    stats: withStats ? statsOf : () => undefined,
  };
  const project = (id: number) =>
    liveProjection(
      scoreLineup(d.lineups[id][3].picks!, feedOf(d), info, d.meta.formation, named),
      feedOf(d),
      info,
      expected,
      d.meta.formation,
    );
  return liveOdds(project(1), project(2), d.meta.oddsOverround);
}

const both = (d: Data) => [scoreLive(d, 1, 3, feedOf(d))!, scoreLive(d, 2, 3, feedOf(d))!] as const;

describe('the live odds, shared by the page and the build', () => {
  it('are what the page worked out before, with the site’s expected points or FPL’s, and the stats file', () => {
    const d = annVBobLive();
    for (const fpl of [false, true]) {
      assert.deepEqual(inPlayOddsIn(d, [...both(d)], feedOf(d), liveExpectedIn(d, 3, fpl, statsOf)), asBefore(d, fpl, true));
      assert.deepEqual(inPlayOddsIn(d, [...both(d)], feedOf(d), liveExpectedIn(d, 3, fpl)), asBefore(d, fpl, false));
    }
    // FPL's expected points make Bob likelier to win (Haaland 8 rather than 6), and the stats count.
    const p = (fpl: boolean, s = true) => inPlayOddsIn(d, [...both(d)], feedOf(d), liveExpectedIn(d, 3, fpl, s ? statsOf : undefined)).p;
    assert.ok(p(true)[2] > p(false)[2]);
    assert.notDeepEqual(p(false), p(false, false));
  });

  it('score a lineup live from its picks, as FPL would, and none without them', () => {
    const d = annVBobLive();
    assert.equal(scoreLive(d, 1, 3, feedOf(d))!.pts, 11); // Raya 2, Saka 9
    assert.equal(scoreLive(d, 2, 3, feedOf(d))!.pts, 7); // Palmer 2, Haaland 2 so far and 3 bonus as it stands
    assert.equal(scoreLive(d, 3, 3, feedOf(d)), undefined);
    assert.equal(scoreLive(d, 1, 2, feedOf(d)), undefined); // a finished week has no picks
  });

  it('project a lineup with the league’s formation', () => {
    const d = annVBobLive();
    const [, bob] = both(d);
    const expected = liveExpectedIn(d, 3, false);
    assert.deepEqual(
      projectionIn(d, bob, feedOf(d), expected),
      liveProjection(bob, feedOf(d), playerInfoIn(d), expected, d.meta.formation),
    );
  });

  it('take each player’s expected points by the setting: FPL’s at the deadline, else the site’s, else his next', () => {
    const d = annVBobLive();
    assert.equal(liveXpIn(d, 15, false), 6);
    assert.equal(liveXpIn(d, 15, true), 8);
    delete d.live!.fplEp![15];
    assert.equal(liveXpIn(d, 15, true), 6);
    d.players[19].ep = 1.5;
    assert.equal(liveXpIn(d, 19, false), 1.5); // not in a lineup
    d.players[19].fpl = 2.5;
    assert.equal(liveXpIn(d, 19, true), 2.5);
    assert.equal(nextXpOf(d.players[19], false), 1.5);
    // Nobody the data has is expected to score nothing, not undefined.
    assert.equal(liveExpectedIn(d, 3, false).points(999), 0);
    assert.equal(liveExpectedIn(d, 3, true).parts, undefined);
    assert.deepEqual(liveExpectedIn(d, 3, false).parts!(15), d.live!.parts![15]);
  });

  it('know who each club named, by the gameweek', () => {
    const d = annVBobLive();
    const named = namedInGw(d.plMatches, 3);
    assert.equal(named(15, 31), 'xi');
    assert.equal(named(17, 31), 'bench');
    assert.equal(named(13, 31), 'out');
    assert.equal(named(15, 30), undefined); // no formations for that match
    assert.equal(namedInGw(d.plMatches, 2)(15, 31), undefined);
    assert.equal(namedInGw(undefined, 3)(15, 31), undefined);
    assert.deepEqual(playerInfoIn(d)(999), { pos: undefined, club: undefined });
  });
});

describe('the page’s live odds', () => {
  beforeEach(() => {
    setData(annVBobLive());
    applyLatestLive();
    state.xp = 'model';
  });

  it('are the shared live odds, by the cog’s setting', () => {
    const d = annVBobLive();
    const m = d.matches.at(-1)!;
    assert.deepEqual(inPlayOdds(m), inPlayOddsIn(d, [...both(d)], feedOf(d), liveExpectedIn(d, 3, false)));
    assert.deepEqual(inPlayOdds(m), asBefore(d, false, false));
    state.xp = 'fpl';
    assert.deepEqual(inPlayOdds(m), asBefore(d, true, false));
    assert.equal(projectionOf(live!.lineups[2], 3).mean, projectionIn(d, both(d)[1], feedOf(d), liveExpectedIn(d, 3, true)).mean);
  });

  it('read the expected points and the named players through the shared lookups', () => {
    assert.equal(liveXp(15), 6);
    assert.equal(nextXp(15), 0);
    state.xp = 'fpl';
    assert.equal(liveXp(15), 8);
    assert.equal(namedIn(3)(17, 31), 'bench');
    setLive(null);
  });
});

describe('the records of the live odds, from two recorders', () => {
  const at = (minutes: number, home: number, away = 300, score: [number, number] = [10, 10]): InPlayRecord => [
    minutes,
    home,
    away,
    ...score,
  ];

  it('are the build’s own as they are without the Worker’s, and the Worker’s without the build’s', () => {
    const own = [at(1, 400), at(30, 400)];
    assert.equal(mergeRecords(own, undefined), own);
    assert.equal(mergeRecords(own, []), own);
    assert.equal(mergeRecords(undefined, undefined), undefined);
    assert.deepEqual(mergeRecords(undefined, [at(5, 400), at(6, 420)]), [at(5, 400), at(6, 420)]);
  });

  it('take the Worker’s within NEAR minutes of the build’s, in time order', () => {
    // The build's at 20 and 31 within NEAR of the Worker's at 30; at 41 not.
    const own = [at(0, 100), at(20, 300), at(31, 400), at(20 + 2 * NEAR + 1, 500)];
    const finer = [at(20 + NEAR, 350), at(15, 320)];
    assert.deepEqual(mergeRecords(own, finer), [at(0, 100), at(15, 320), at(30, 350), at(41, 500)]);
  });

  it('are thinned as a recorder thins them', () => {
    // The Worker's minute after minute without a move: only the first and the latest stay.
    const finer = [at(40, 400), at(41, 401), at(42, 402), at(43, 403)];
    assert.deepEqual(mergeRecords([at(0, 100)], finer), [at(0, 100), at(40, 400), at(43, 403)]);
  });

  it('are read from the relay only as they should be', () => {
    const good = { '11-22': [at(5, 400, 300)], '33-44': [] };
    assert.deepEqual(parseRecords(good), good);
    assert.deepEqual(parseRecords({}), {});
    for (const bad of [
      null,
      [],
      'records',
      { '11-22': 'x' },
      { eleven: [at(5, 400)] },
      { '11-22': [[5, 400, 300, 10]] },
      { '11-22': [[5, 700, 400, 10, 10]] }, // more than certain
      { '11-22': [[5, -1, 400, 10, 10]] },
      { '11-22': [[5, 0.5, 400, 10, 10]] },
    ])
      assert.equal(parseRecords(bad), null, JSON.stringify(bad));
  });

  it('are worked out only from the deadline on, for the gameweek of the live feed', () => {
    const d = annVBobLive();
    const deadline = Date.parse(d.gameweeks[2].deadline);
    assert.deepEqual(recordsNow(d, d.live!, deadline - 60_000), {});
    assert.deepEqual(Object.keys(recordsNow(d, d.live!, deadline)), ['1-2']);
    assert.equal(recordKey({ home: 1, away: 2 }), '1-2');
    const none = annVBobLive();
    delete none.live;
    assert.deepEqual(recordsNow(none, d.live!, deadline), {});
  });
});
