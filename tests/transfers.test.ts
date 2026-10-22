import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Data, Player } from '../src/shared/data.ts';
import { mergeTransfers, slimTransfers, type SlimTransfers } from '../src/shared/transfers.ts';

const player = (owner: number | null): Player => ({
  name: 'P',
  full: 'P',
  pos: 'MID',
  club: 1,
  code: 1,
  total: 0,
  owner,
  status: 'a',
  ep: 0,
});

// Just the parts of data.json the merge touches.
function data(): Data {
  return {
    meta: { nextGw: 8, nextWaivers: '2026-10-22T18:30:00Z' },
    players: { 1: player(10), 2: player(null), 3: player(20), 4: player(null) },
    transfers: {
      moves: [{ type: 'free', manager: 10, in: 1, out: 4, gw: 7, at: '2026-10-15T09:00:00Z', order: 0 }],
      trades: [],
    },
  } as unknown as Data;
}

const slim = (extra: Partial<SlimTransfers> = {}): SlimTransfers => ({
  moves: [
    { type: 'free', manager: 10, in: 1, out: 4, gw: 7, added: '2026-10-15T09:00:00Z', order: 0 },
    { type: 'waiver', manager: 20, in: 2, out: 3, gw: 8, added: '2026-10-21T10:00:00Z', order: 3 },
  ],
  trades: [],
  owners: { 1: 10, 2: 20 },
  ...extra,
});

describe('mergeTransfers', () => {
  it('adds new moves, newest first, with waivers dated by their run', () => {
    const d = data();
    assert.equal(mergeTransfers(d, slim()), true);
    assert.deepEqual(
      d.transfers.moves.map((m) => [m.type, m.in, m.at]),
      [
        ['waiver', 2, '2026-10-22T18:30:00Z'],
        ['free', 1, '2026-10-15T09:00:00Z'],
      ],
    );
  });

  it('updates who owns whom', () => {
    const d = data();
    mergeTransfers(d, slim());
    assert.deepEqual(
      Object.values(d.players).map((p) => p.owner),
      [10, 20, null, null],
    );
  });

  it('changes nothing the second time', () => {
    const d = data();
    mergeTransfers(d, slim());
    assert.equal(mergeTransfers(d, slim()), false);
    assert.equal(d.transfers.moves.length, 2);
  });

  it('leaves players the build has not seen yet to the build', () => {
    const d = data();
    mergeTransfers(d, slim({ moves: [{ type: 'free', manager: 10, in: 99, out: 1, gw: 8, added: '2026-10-22T10:00:00Z', order: 0 }] }));
    assert.equal(d.transfers.moves.length, 1);
  });
});

describe('slimTransfers', () => {
  it('keeps accepted moves, every trade and the owners', () => {
    const tx = (result: string, kind = 'w') => ({
      entry: 10,
      element_in: 2,
      element_out: 3,
      event: 8,
      kind,
      result,
      added: '2026-10-21T10:00:00Z',
      index: 1,
      priority: 1,
    });
    const s = slimTransfers(
      [tx('a'), tx('di'), tx('a', 'f')],
      [
        {
          event: 8,
          offered_entry: 10,
          received_entry: 20,
          offer_time: '2026-10-20T10:00:00Z',
          response_time: null,
          state: 'o',
          tradeitem_set: [{ element_in: 1, element_out: 2 }],
        },
      ],
      [
        { element: 1, owner: 10 },
        { element: 2, owner: null },
      ],
    );
    assert.deepEqual(
      s.moves.map((m) => m.type),
      ['waiver', 'free'],
    );
    assert.deepEqual(s.trades[0], {
      gw: 8,
      offeredBy: 10,
      offeredTo: 20,
      state: 'o',
      at: '2026-10-20T10:00:00Z',
      items: [{ gives: 2, gets: 1 }],
    });
    assert.deepEqual(s.owners, { 1: 10 });
  });
});
