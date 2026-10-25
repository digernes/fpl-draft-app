import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import {
  buildEvents,
  buildLineups,
  buildManagers,
  buildMatches,
  buildUnderlying,
  lineupOf,
  patchLiveScores,
  underlyingIn,
} from '../src/build/lineups.ts';
import { readSeason } from '../src/build/season.ts';
import type { PlFormation } from '../src/shared/data.ts';
import { DGW_PENALTY } from '../src/build/config.ts';
import { clubOf, fetched } from './fixtures/build-league.ts';

const season = readSeason(fetched());
const { managers, managerIds, entryByLeagueEntry } = buildManagers(season);

describe('managers', () => {
  it('shows only first names, with a surname’s initial where two share one, and leaves out the place nobody took', () => {
    assert.deepEqual(
      managers.map((m) => m.first),
      ['Ola N.', 'Kari', 'Ola H.', 'Per'],
    );
    assert.deepEqual(managers[1], { id: 102, first: 'Kari', initials: 'T2', team: 'Team 2', waiverPick: 1 });
    assert.deepEqual(managerIds, [101, 102, 103, 104]);
    assert.equal(entryByLeagueEntry.get(13), 103);
    assert.equal(entryByLeagueEntry.has(15), false);
    assert.ok(!JSON.stringify(managers).includes('Nordmann'));
  });
});

describe('matches', () => {
  const matches = buildMatches(season, entryByLeagueEntry);

  it('lists the head-to-heads by gameweek, by entry, with scores only once they have started', () => {
    assert.equal(matches.length, 12);
    assert.ok(matches.every((m, i) => i === 0 || matches[i - 1].gw <= m.gw));
    const [first] = matches;
    assert.deepEqual([first.gw, first.home, first.away, first.started, first.finished], [1, 101, 102, true, true]);
    assert.equal(typeof first.homePts, 'number');
    const live = matches.filter((m) => m.started && !m.finished);
    assert.deepEqual(
      live.map((m) => m.gw),
      [3, 3],
    );
    const later = matches.filter((m) => m.gw > 3);
    assert.ok(later.every((m) => m.homePts === null && m.awayPts === null && !m.started));
  });
});

describe('lineups', () => {
  const matches = buildMatches(season, entryByLeagueEntry);
  const lineups = buildLineups(season, matches);

  it('takes a finished week as FPL sent it, auto-subs made, scored as the head-to-head was', () => {
    const l = lineups[101][1];
    // Player 9 never got on, so 12 came on for him.
    assert.equal(l.xi.length, 11);
    assert.ok(l.xi.includes(12) && !l.xi.includes(9));
    assert.ok(l.bench.includes(9));
    assert.deepEqual(l.subs, [12]);
    assert.deepEqual(l.off, [9]);
    assert.equal(l.pts, matches[0].homePts);
    assert.equal(
      l.pts,
      l.xi.reduce((t, pid) => t + season.pointsIn(pid, 1), 0),
    );
    assert.equal(
      l.benchPts,
      l.bench.reduce((t, pid) => t + season.pointsIn(pid, 1), 0),
    );
    assert.equal(l.picks, undefined); // nothing to re-score
    // Without auto-subs, no list of who went off.
    const all = Object.values(lineups).flatMap((byGw) => Object.values(byGw));
    assert.ok(all.some((x) => !x.subs.length));
    assert.ok(all.every((x) => (x.off?.length ?? 0) === x.subs.length && x.off?.length !== 0));
  });

  it('knocks points off for each starter whose club plays twice', () => {
    const l = lineups[101][2];
    const twice = l.xi.filter((pid) => [1, 3].includes(clubOf(pid))).length;
    assert.equal(l.dgw, twice);
    assert.ok(twice > 0);
    assert.equal(l.adj, l.pts - DGW_PENALTY * twice);
    assert.equal(lineups[101][1].adj, lineups[101][1].pts);
  });

  it('scores the week being played as the page does, with its auto-subs, and keeps the picks for the page to re-score', () => {
    const l = lineups[103][3];
    // 36's match is over without him, so the first defender on the bench who has played comes on.
    assert.ok(!l.xi.includes(36) && l.xi.includes(37));
    assert.deepEqual(l.subs, [37]);
    assert.deepEqual(l.off, [36]);
    assert.equal(l.picks?.length, 15);
    assert.equal(l.picks?.[4], 36);
    assert.ok(l.pts >= l.xi.reduce((t, pid) => t + season.pointsIn(pid, 3), 0)); // with provisional bonus
  });

  it('only brings someone on in the week being played once his club has left the starter out, where the formations are known', () => {
    // 18 hasn't played in a match still going on: he could yet come on.
    assert.ok(lineups[102][3].xi.includes(18));
    const side = (lines: number[][], subs: number[]): PlFormation => ({ shape: '4-4-2', lines, subs });
    const formations = new Map([[302, [side([[29]], []), side([[19]], [22])] as [PlFormation, PlFormation]]]);
    const named = buildLineups(season, buildMatches(season, entryByLeagueEntry), formations)[102][3];
    assert.ok(!named.xi.includes(18) && named.xi.includes(22));
    assert.deepEqual(named.off, [18]);
  });

  it('adds up the XI’s expected points', () => {
    const l = lineups[104][2];
    const xp = l.xi.reduce((t, pid) => t + (underlyingIn(season, pid, 2)?.xp ?? 0), 0);
    assert.equal(l.xpf, Math.round(xp * 10) / 10);
    assert.ok(l.xpf > 0);
  });

  it('warns when a finished lineup does not add up to its head-to-head score', () => {
    const warn = mock.method(console, 'warn', () => {});
    try {
      const off = buildMatches(season, entryByLeagueEntry);
      off[0].homePts = (off[0].homePts as number) + 1;
      const l = buildLineups(season, off);
      assert.equal(l[101][1].pts, off[0].homePts); // the head-to-head score stands
      assert.equal(warn.mock.callCount(), 1);
      assert.match(String(warn.mock.calls[0].arguments[0]), /1 lineups do not add up/);
    } finally {
      warn.mock.restore();
    }
  });

  it('looks a lineup up by manager and gameweek', () => {
    const lineup = lineupOf(lineups);
    assert.equal(lineup(101, 1), lineups[101][1]);
    assert.equal(lineup(101, 9), undefined);
    assert.equal(lineup(999, 1), undefined);
  });

  it('puts the live score on a match still being played, and leaves the others', () => {
    const ms = buildMatches(season, entryByLeagueEntry);
    const before = ms.map((m) => [m.homePts, m.awayPts]);
    ms[4].homePts = 0;
    patchLiveScores(ms, lineupOf(lineups));
    assert.equal(ms[4].homePts, lineups[101][3].pts);
    assert.equal(ms[4].awayPts, lineups[104][3].pts);
    assert.deepEqual([ms[0].homePts, ms[0].awayPts], before[0]);
    assert.deepEqual([ms[8].homePts, ms[8].awayPts], [null, null]);
  });
});

describe('what the lineups’ players did', () => {
  const lineups = buildLineups(season, buildMatches(season, entryByLeagueEntry));

  it('lists the goals, assists, cards and substitutions of everyone in a lineup, gameweek by gameweek', () => {
    const events = buildEvents(season, lineups);
    assert.deepEqual(Object.keys(events), ['1', '2', '3']);
    assert.deepEqual(events[1][13], { goals: 1, assists: 1, bonus: 2 });
    assert.deepEqual(events[1][1], { yellow: 1 });
    assert.deepEqual(events[1][11], { on: 1, onAt: 60, min: 30 });
    // Only those who did something, in id order.
    const ids = Object.keys(events[1]).map(Number);
    assert.deepEqual(
      ids,
      [...ids].sort((a, b) => a - b),
    );
    assert.equal(events[1][9], undefined);
  });

  it('gives each lineup player who got on his xG, xA and expected points in the finished weeks, and the points that stay as scored', () => {
    const { underlying, asScored } = buildUnderlying(season, lineups);
    assert.deepEqual(Object.keys(underlying), ['1', '2']);
    assert.deepEqual(underlying[1][13].slice(0, 2), [0.55, 0.4]);
    assert.equal(underlying[1][9], undefined); // never got on
    assert.equal(underlying[1][1].length, 5); // a goalkeeper's clean sheet counts, so xCS and xGC too
    assert.deepEqual(asScored[1][13], [2, 0, 0, 0, 2]); // playing, penalties, defensive actions, saves, bonus
  });

  it('works out a player’s underlying numbers across both of a double gameweek’s matches', () => {
    // Player 4 (club 1) played both of gameweek 2's matches.
    const u = underlyingIn(season, 4, 2)!;
    assert.equal(u.minutes, 180);
    assert.equal(u.xg, 0.1);
    assert.ok(u.xcs !== undefined && u.xcs > 0 && u.xcs < 2);
    assert.equal(underlyingIn(season, 4, 5), undefined);
  });
});
