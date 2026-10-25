import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildLineups, buildManagers, buildMatches, lineupOf } from '../src/build/lineups.ts';
import { readSeason } from '../src/build/season.ts';
import { buildTransfers } from '../src/build/transfers.ts';
import type { Transaction } from '../src/shared/fpl-api.ts';
import { fetched } from './fixtures/build-league.ts';

// The fixture league's moves: 101 wins a waiver for 63 (dropping 12) over 102 in gameweek 2,
// 104's claim for 62 falls through, 101 and 104 swap 14 for 59 the same week, a trade
// between 102 and 103 is turned down, and 103 signs 64 for 45 in gameweek 3, not yet finished.
function transfersOf(more: Transaction[] = []) {
  const f = fetched();
  f.transactions.push(...more);
  const season = readSeason(f);
  const { managerIds, entryByLeagueEntry } = buildManagers(season);
  const lineup = lineupOf(buildLineups(season, buildMatches(season, entryByLeagueEntry)));
  return { season, transfers: buildTransfers(season, managerIds, [102, 104, 101, 103], lineup) };
}

const claim = (entry: number, element_in: number, element_out: number, event: number, result: string, priority: number): Transaction => ({
  entry,
  element_in,
  element_out,
  event,
  kind: 'w',
  result,
  added: `2026-08-${10 + event * 7}T09:00:00Z`,
  index: 10 + priority,
  priority,
});

describe('transfers', () => {
  const { season, transfers } = transfersOf();
  const since = (pid: number, gw: number) => season.finishedGws.filter((g) => g >= gw).reduce((t, g) => t + season.pointsIn(pid, g), 0);

  it('makes a move of every signing that went through, and two of each player traded, most recent first', () => {
    assert.deepEqual(
      transfers.moves.map((mv) => [mv.type, mv.manager, mv.in, mv.out, mv.gw]),
      [
        ['free', 103, 64, 45, 3],
        ['waiver', 101, 63, 12, 2],
        ['trade', 101, 59, 14, 2],
        ['trade', 104, 14, 59, 2],
      ],
    );
    assert.equal(transfers.moves[2].partner, 104);
    assert.equal(transfers.moves[3].partner, 101);
  });

  it('dates a waiver by its waiver run, a free signing when it was made and a trade when it was accepted', () => {
    const [free, waiver, trade] = transfers.moves;
    assert.equal(free.at, '2026-08-27T09:00:00Z');
    assert.equal(waiver.at, season.events.find((e) => e.id === 2)?.waivers_time);
    assert.equal(trade.at, '2026-08-20T12:00:00Z');
  });

  it('scores each move on the points of the players in and out since, and those the player in scored in the XI', () => {
    const lineup = (gw: number) => buildLineups(season, buildMatches(season, buildManagers(season).entryByLeagueEntry))[101][gw];
    const trade = transfers.moves[2];
    assert.equal(trade.inPts, since(59, 2));
    assert.equal(trade.outPts, since(14, 2));
    assert.equal(trade.net, trade.inPts! - trade.outPts!);
    assert.ok(lineup(2).xi.includes(59));
    assert.equal(trade.banked, season.pointsIn(59, 2));
    const waiver = transfers.moves[1];
    assert.ok(!lineup(2).xi.includes(63));
    assert.equal(waiver.banked, 0); // on the bench
    assert.equal(transfers.moves[0].net, undefined); // nothing finished since
  });

  it('sorts out each waiver claim as won, lost to another manager, or void', () => {
    assert.deepEqual(
      transfers.claims.map((c) => [c.manager, c.in, c.outcome, c.winner, c.priority]),
      [
        [101, 63, 'won', 101, 1],
        [102, 63, 'lost', 101, 2],
        [104, 62, 'void', null, 3],
      ],
    );
  });

  it('calls a claim void when the player went to the manager’s own earlier claim', () => {
    const { transfers: t } = transfersOf([claim(101, 63, 13, 2, 'di', 4)]);
    assert.equal(t.claims.at(-1)?.outcome, 'void');
    assert.equal(t.claims.at(-1)?.winner, 101);
  });

  it('sums up each manager’s moves, claims, points gained and best and worst move', () => {
    const [ola, kari, , per] = transfers.summary;
    assert.deepEqual([ola.id, ola.moves, ola.waivers, ola.free, ola.trades, ola.claims, ola.lost, ola.void], [101, 2, 1, 0, 1, 1, 0, 0]);
    assert.equal(ola.net, transfers.moves[1].net! + transfers.moves[2].net!);
    assert.equal(ola.best?.type, 'trade'); // 59 has outscored 14, while 63 hasn’t played
    assert.equal(ola.worst?.type, 'waiver');
    assert.deepEqual([kari.moves, kari.claims, kari.lost, kari.trades, kari.best], [0, 1, 1, 0, null]); // a declined trade doesn't count
    assert.deepEqual([per.trades, per.void], [1, 1]);
  });

  it('lists the players claimed by more than one manager, with what they have scored since', () => {
    assert.deepEqual(transfers.contested, [{ gw: 2, player: 63, claimants: [101, 102], winner: 101, pts: since(63, 2) }]);
    // A claim in a gameweek not yet finished has no points yet.
    const { transfers: t } = transfersOf([claim(102, 62, 27, 3, 'a', 1), claim(104, 62, 60, 3, 'di', 2), claim(103, 62, 33, 3, 'di', 3)]);
    assert.deepEqual(t.contested[0], { gw: 3, player: 62, claimants: [102, 104, 103], winner: 102, pts: null });
  });

  it('finds the players who have been in more than one squad, and those dropped most', () => {
    assert.deepEqual(
      transfers.hotPotatoes.map((h) => [h.player, h.owners.sort(), h.moves]),
      [
        [14, [101, 104], 0],
        [59, [101, 104], 0],
      ],
    );
    assert.deepEqual(
      transfers.mostDropped.map((d) => [d.player, d.times]),
      [
        [12, 1],
        [45, 1],
      ],
    );
  });

  it('ranks the best pickups and the regrets among signings, leaving trades out', () => {
    assert.ok(transfers.bestPickups.every((mv) => mv.type !== 'trade'));
    assert.deepEqual(
      transfers.bestPickups.map((mv) => mv.in),
      [63],
    );
    assert.deepEqual(
      transfers.regrets.map((mv) => mv.out),
      [12],
    );
  });

  it('counts each gameweek’s moves up to the next one', () => {
    assert.deepEqual(transfers.byGw, [
      { gw: 1, waiver: 0, free: 0, trade: 0 },
      { gw: 2, waiver: 1, free: 0, trade: 1 },
      { gw: 3, waiver: 0, free: 1, trade: 0 },
      { gw: 4, waiver: 0, free: 0, trade: 0 },
    ]);
  });

  it('keeps every trade offered, in the relay’s shape, and the waiver order', () => {
    assert.deepEqual(
      transfers.trades.map((t) => [t.gw, t.offeredBy, t.offeredTo, t.state]),
      [
        [3, 102, 103, 'd'],
        [2, 101, 104, 'p'],
      ],
    );
    assert.deepEqual(transfers.trades[1].items, [{ gives: 14, gets: 59 }]);
    assert.deepEqual(transfers.waiverOrder, [102, 104, 101, 103]);
  });
});
