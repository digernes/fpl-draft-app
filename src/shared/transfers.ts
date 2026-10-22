// Transfers between builds: the relay passes on the league's moves, trades and owners
// in this slim form, and the page merges anything new into data.json's feed, so a
// waiver, free-agent signing or trade shows up within a couple of minutes instead of
// at the next scheduled build.

import type { Data, Move, Trade } from './data.ts';
import type { Trade as ApiTrade, Transaction } from './fpl-api.ts';

export interface SlimTransfers {
  /** Accepted waivers and free-agent signings, as FPL lists them. */
  moves: { type: 'waiver' | 'free'; manager: number; in: number; out: number; gw: number; added: string; order: number }[];
  /** Every trade offer, in data.json's shape, newest first. */
  trades: Trade[];
  /** player → manager who owns him now */
  owners: Record<string, number>;
}

export function slimTransfers(
  transactions: Transaction[],
  trades: ApiTrade[],
  status: { element: number; owner: number | null }[],
): SlimTransfers {
  return {
    moves: transactions
      .filter((t) => t.result === 'a')
      .map((t) => ({
        type: t.kind === 'w' ? 'waiver' : 'free',
        manager: t.entry,
        in: t.element_in,
        out: t.element_out,
        gw: t.event,
        added: t.added,
        order: t.index ?? 0,
      })),
    // The same mapping as the build's trade log.
    trades: trades
      .map((tr) => ({
        gw: tr.event,
        offeredBy: tr.offered_entry,
        offeredTo: tr.received_entry,
        state: tr.state,
        at: tr.response_time ?? tr.offer_time,
        items: tr.tradeitem_set.map((it) => ({ gives: it.element_out, gets: it.element_in })),
      }))
      .sort((a, b) => b.at.localeCompare(a.at)),
    owners: Object.fromEntries(status.flatMap((s) => (s.owner ? [[s.element, s.owner]] : []))),
  };
}

const moveKey = (mv: Pick<Move, 'type' | 'manager' | 'in' | 'out' | 'gw'>) => `${mv.type}:${mv.manager}:${mv.in}:${mv.out}:${mv.gw}`;

// Adds what data.json doesn't have yet. Moves get no points-since until the next build
// works them out; players FPL added after the build are left for it too. Returns
// whether anything changed.
export function mergeTransfers(data: Data, slim: SlimTransfers): boolean {
  const known = new Set(data.transfers.moves.map(moveKey));
  const added: Move[] = slim.moves
    .filter((mv) => !known.has(moveKey(mv)) && data.players[mv.in] && data.players[mv.out])
    .map((mv) => ({
      type: mv.type,
      manager: mv.manager,
      in: mv.in,
      out: mv.out,
      gw: mv.gw,
      // Waivers are dated by their waiver run, as in the build.
      at: (mv.type === 'waiver' && mv.gw === data.meta.nextGw && data.meta.nextWaivers) || mv.added,
      order: mv.order,
    }));
  if (added.length) {
    data.transfers.moves = [...data.transfers.moves, ...added].sort((a, b) => b.at.localeCompare(a.at) || (b.order ?? 0) - (a.order ?? 0));
  }

  const trades = slim.trades.filter((t) => t.items.every((it) => data.players[it.gives] && data.players[it.gets]));
  const tradesChanged = JSON.stringify(trades) !== JSON.stringify(data.transfers.trades);
  if (tradesChanged) data.transfers.trades = trades;

  let ownersChanged = false;
  if (Object.keys(slim.owners).length) {
    for (const [pid, p] of Object.entries(data.players)) {
      const owner = slim.owners[pid] ?? null;
      if (p.owner !== owner) {
        p.owner = owner;
        ownersChanged = true;
      }
    }
  }
  return added.length > 0 || tradesChanged || ownersChanged;
}
