import './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { claimsCard, movesCard, tradesCard } from '../src/app/pages/team-transfers.ts';
import { setData, state } from '../src/app/state.ts';
import type { Data, Move } from '../src/shared/data.ts';
import { listRows } from './fixtures/html.ts';
import { season } from './fixtures/league.ts';

const move = (
  type: Move['type'],
  manager: number,
  inId: number,
  out: number,
  gw: number,
  scored?: [number, number],
  partner?: number,
): Move => ({
  type,
  manager,
  ...(partner ? { partner } : {}),
  in: inId,
  out,
  gw,
  at: new Date(Date.now() - (4 - gw) * 7 * 864e5).toISOString(),
  ...(scored ? { inPts: scored[0], outPts: scored[1], net: scored[0] - scored[1], banked: scored[0] } : {}),
});

// Newest first, as data.json has them: in GW 3 Ann traded Saka to Bob for Palmer, not yet
// scored; in GW 2 she signed Gabriel for White, 4 points to 0 since. Her claim for Watkins in
// GW 2 lost out to Cy, and one for Isak in GW 1 was void; she turned down Cy's offer of Salah.
function data(): Data {
  const d = season();
  d.transfers.moves = [
    move('trade', 1, 13, 12, 3, undefined, 2),
    move('trade', 2, 12, 13, 3, undefined, 1),
    move('free', 1, 18, 19, 2, [4, 0]),
  ];
  d.transfers.claims = [
    { manager: 1, in: 16, out: 19, gw: 1, priority: null, outcome: 'void', winner: null },
    { manager: 1, in: 17, out: 19, gw: 2, priority: 2, outcome: 'lost', winner: 3 },
    { manager: 3, in: 17, out: 16, gw: 2, priority: 1, outcome: 'won', winner: 3 },
  ];
  d.transfers.trades = [
    { gw: 3, offeredBy: 1, offeredTo: 2, state: 'p', at: '2026-08-29T10:00:00Z', items: [{ gives: 12, gets: 13 }] },
    { gw: 2, offeredBy: 3, offeredTo: 1, state: 'r', at: '2026-08-21T10:00:00Z', items: [{ gives: 14, gets: 11 }] },
    { gw: 2, offeredBy: 3, offeredTo: 2, state: 'x', at: '2026-08-20T10:00:00Z', items: [{ gives: 14, gets: 15 }] },
  ];
  return d;
}

beforeEach(() => {
  setData(data());
  state.moves = 'all';
});

describe('a team’s transfers', () => {
  it('lists every move, the player in first with the points since less the player out’s', () => {
    const html = movesCard(1);
    assert.match(html, /<div class="card-sub">2 moves<\/div>/);
    assert.deepEqual(
      listRows(html).map((r) => r.replace(/ · [^·]* ago| · last week/, '')),
      ['Palmer For Saka · Trade with Bob · GW 3', 'Gabriel For White · Free agent · GW 2 +4'],
    );
    assert.match(html, /<span data-tip="Points since by the player in, less the player out">\+4<\/span>/);
  });

  it('leads with the player in or the player out, with his own points since', () => {
    state.moves = 'in';
    assert.match(listRows(movesCard(1))[1], /^Gabriel In, for White · Free agent · GW 2 · .* 4$/);
    assert.match(movesCard(1), /data-tip="Points since by Gabriel">4</);
    state.moves = 'out';
    assert.match(listRows(movesCard(1))[1], /^White Out, for Gabriel · Free agent · GW 2 · .* 0$/);
    assert.match(movesCard(1), /data-action="moves" data-value="out" aria-pressed="true"/);
  });

  it('says so when the team hasn’t moved', () => {
    assert.match(movesCard(3), /No transfers yet/);
    assert.match(movesCard(3), /<div class="card-sub">0 moves<\/div>/);
  });
});

describe('a team’s waiver claims', () => {
  it('lists the claims, the latest first, with how each came out and who won one lost', () => {
    const html = claimsCard(1);
    assert.match(html, /<div class="card-sub">0 of 2 won<\/div>/);
    assert.deepEqual(listRows(html), ['Watkins For White · GW 2 · priority 2 Lost to Cy', 'Isak For White · GW 1 Void']);
    assert.match(html, /data-tip="Another manager with better waiver priority got him">Lost to Cy</);
    assert.match(claimsCard(3), /<span class="tag tag-won">Won<\/span>/);
  });

  it('is left out for a team that hasn’t claimed', () => {
    assert.equal(claimsCard(2), '');
  });
});

describe('a team’s trades', () => {
  it('lists the offers made and received, what the team gets and gives, and how each ended', () => {
    assert.deepEqual(listRows(tradesCard(1)), [
      'BO Offered to Bob Gets Palmer · gives Saka · GW 3 Processed',
      'CY Offer from Cy Gets Salah · gives Raya · GW 2 Rejected',
    ]);
  });

  it('shows a state it doesn’t know as it is, and is left out without trades', () => {
    assert.match(listRows(tradesCard(2)).at(-1)!, /Gets Salah · gives Haaland · GW 2 x$/);
    const d = data();
    d.transfers.trades = [];
    setData(d);
    assert.equal(tradesCard(1), '');
  });
});
