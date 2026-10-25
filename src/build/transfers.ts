// Transfer stats: every move with what it has been worth since, waiver claims won and
// lost, the most contested players, and each manager's summary.

import type { Claim, Move, ScoredMove, TransferSummary, Transfers } from '../shared/data.ts';
import type { Trade, Transaction } from '../shared/fpl-api.ts';
import { slimTransfers } from '../shared/transfers.ts';
import type { lineupOf } from './lineups.ts';
import type { Season } from './season.ts';
import { countBy, groupBy, maxBy, range, sum } from './util.ts';

type LineupOf = ReturnType<typeof lineupOf>;
type PointsSince = (id: number, gw: number) => number;

export function buildTransfers(season: Season, managerIds: number[], waiverOrder: number[], lineup: LineupOf): Transfers {
  const { transactions, trades, finishedGws, pointsIn } = season;
  const pointsSince: PointsSince = (id, gw) => sum(finishedGws.filter((g) => g >= gw).map((g) => pointsIn(id, g)));

  const moves = [...signings(season), ...tradeMoves(trades)];
  scoreMoves(moves, season, lineup, pointsSince);
  moves.sort((a, b) => b.at.localeCompare(a.at) || (b.order ?? 0) - (a.order ?? 0));
  const claims = waiverClaims(transactions);

  const scoredMoves = moves.filter(isScored).filter((mv) => mv.type !== 'trade');
  return {
    moves,
    claims,
    summary: managerIds.map((id) => managerSummary(id, moves, claims, trades)),
    contested: mostContested(claims, season.lastFinishedGw, pointsSince),
    hotPotatoes: hotPotatoes(season, managerIds, lineup, moves),
    mostDropped: mostDropped(moves, season.elements),
    bestPickups: [...scoredMoves].sort((a, b) => b.net - a.net || b.banked - a.banked).slice(0, 6),
    regrets: [...scoredMoves].sort((a, b) => b.outPts - a.outPts || a.net - b.net).slice(0, 6),
    byGw: movesByGw(season, moves),
    // The relay sends the trade log in the same shape, so the page can swap one for the other.
    trades: slimTransfers([], trades, []).trades,
    waiverOrder,
  };
}

const isScored = (mv: Move): mv is ScoredMove => mv.net != null;

// Accepted waivers and free-agent signings; a waiver is dated by its waiver run.
function signings({ transactions, events }: Season): Move[] {
  return transactions
    .filter((t) => t.result === 'a')
    .map((t) => {
      const waiver = t.kind === 'w';
      const at = (waiver && events.find((e) => e.id === t.event)?.waivers_time) || t.added;
      return {
        type: waiver ? 'waiver' : 'free',
        manager: t.entry,
        in: t.element_in,
        out: t.element_out,
        gw: t.event,
        at,
        order: t.index ?? 0,
      };
    });
}

// An accepted trade is a move for each side, per player swapped.
function tradeMoves(trades: Trade[]): Move[] {
  return trades
    .filter((tr) => tr.state === 'p')
    .flatMap((tr) => {
      const at = tr.response_time ?? tr.offer_time;
      const [a, b] = [tr.offered_entry, tr.received_entry];
      return tr.tradeitem_set.flatMap((item): Move[] => [
        { type: 'trade', manager: a, partner: b, in: item.element_in, out: item.element_out, gw: tr.event, at },
        { type: 'trade', manager: b, partner: a, in: item.element_out, out: item.element_in, gw: tr.event, at },
      ]);
    });
}

// What each move has been worth since: the points of the player in and the player out, and
// those the player in scored in the manager's XI.
function scoreMoves(moves: Move[], season: Season, lineup: LineupOf, pointsSince: PointsSince) {
  const { finishedGws, lastFinishedGw, pointsIn } = season;
  const bankedSince = (entry: number, id: number, gw: number) =>
    sum(finishedGws.filter((g) => g >= gw && lineup(entry, g)?.xi.includes(id)).map((g) => pointsIn(id, g)));
  for (const mv of moves) {
    if (mv.gw > lastFinishedGw) continue; // nothing scored yet
    mv.inPts = pointsSince(mv.in, mv.gw);
    mv.outPts = pointsSince(mv.out, mv.gw);
    mv.net = mv.inPts - mv.outPts;
    mv.banked = bankedSince(mv.manager, mv.in, mv.gw);
  }
}

function waiverClaims(transactions: Transaction[]): Claim[] {
  const claims = transactions.filter((t) => t.kind === 'w');
  const wonBy = new Map(claims.filter((t) => t.result === 'a').map((t) => [`${t.event}:${t.element_in}`, t.entry]));
  return claims.map((t) => {
    const winner = wonBy.get(`${t.event}:${t.element_in}`) ?? null;
    return {
      manager: t.entry,
      in: t.element_in,
      out: t.element_out,
      gw: t.event,
      priority: t.priority,
      outcome: claimOutcome(t, winner),
      winner,
    };
  });
}

// Waiver result codes: "a" won, "di" the player in was already gone (claimed by a
// higher priority, or by your own earlier claim), "do" the player out was already gone.
function claimOutcome(t: Transaction, winner: number | null): Claim['outcome'] {
  if (t.result === 'a') return 'won';
  return t.result === 'di' && winner && winner !== t.entry ? 'lost' : 'void';
}

function mostContested(claims: Claim[], lastFinishedGw: number, pointsSince: PointsSince): Transfers['contested'] {
  return Object.values(groupBy(claims, (c) => `${c.gw}:${c.in}`))
    .map((group) => ({
      gw: group[0].gw,
      player: group[0].in,
      claimants: [...new Set(group.map((c) => c.manager))],
      winner: group[0].winner,
      pts: group[0].gw <= lastFinishedGw ? pointsSince(group[0].in, group[0].gw) : null,
    }))
    .filter((g) => g.claimants.length > 1)
    .sort((a, b) => b.claimants.length - a.claimants.length || b.gw - a.gw)
    .slice(0, 8);
}

// Players who have been in more than one squad this season.
function hotPotatoes({ gws, ownerNow }: Season, managerIds: number[], lineup: LineupOf, moves: Move[]): Transfers['hotPotatoes'] {
  const ownersOf = new Map<number, Set<number>>();
  const addOwner = (pid: number, owner: number) => (ownersOf.get(pid) ?? ownersOf.set(pid, new Set()).get(pid)!).add(owner);
  for (const id of managerIds) {
    for (const gw of gws) for (const pid of squadAt(lineup, id, gw)) addOwner(pid, id);
  }
  for (const [pid, owner] of ownerNow) addOwner(pid, owner);
  return [...ownersOf]
    .filter(([, owners]) => owners.size > 1)
    .map(([player, owners]) => ({
      player,
      owners: [...owners],
      moves: moves.filter((mv) => mv.in === player && mv.type !== 'trade').length,
    }))
    .sort((a, b) => b.owners.length - a.owners.length || b.moves - a.moves)
    .slice(0, 6);
}

function squadAt(lineup: LineupOf, entry: number, gw: number): number[] {
  const l = lineup(entry, gw);
  return l ? [...l.xi, ...l.bench] : [];
}

function mostDropped(moves: Move[], elements: Season['elements']): Transfers['mostDropped'] {
  const pointsOf = (player: number) => elements.get(player)?.total_points ?? 0;
  const dropCounts = countBy(
    moves.filter((mv) => mv.type !== 'trade'),
    (mv) => mv.out,
  );
  return Object.entries(dropCounts)
    .map(([player, times]) => ({ player: Number(player), times }))
    .sort((a, b) => b.times - a.times || pointsOf(b.player) - pointsOf(a.player))
    .slice(0, 5);
}

function movesByGw({ league, currentGw, game, trades }: Season, moves: Move[]): Transfers['byGw'] {
  const countIn = (gw: number, type: Move['type']) => moves.filter((mv) => mv.gw === gw && mv.type === type).length;
  return range(league.start_event, Math.max(currentGw, game.next_event ?? 0, 1)).map((gw) => ({
    gw,
    waiver: countIn(gw, 'waiver'),
    free: countIn(gw, 'free'),
    trade: trades.filter((tr) => tr.state === 'p' && tr.event === gw).length,
  }));
}

function managerSummary(id: number, moves: Move[], claims: Claim[], trades: Trade[]): TransferSummary {
  const mine = moves.filter((mv) => mv.manager === id);
  const myClaims = claims.filter((c) => c.manager === id);
  const scored = mine.filter(isScored);
  const isMine = (tr: Trade) => tr.offered_entry === id || tr.received_entry === id;
  return {
    id,
    moves: mine.length,
    waivers: mine.filter((mv) => mv.type === 'waiver').length,
    free: mine.filter((mv) => mv.type === 'free').length,
    trades: trades.filter((tr) => tr.state === 'p' && isMine(tr)).length,
    claims: myClaims.length,
    lost: myClaims.filter((c) => c.outcome === 'lost').length,
    void: myClaims.filter((c) => c.outcome === 'void').length,
    net: sum(scored.map((mv) => mv.net)),
    banked: sum(scored.map((mv) => mv.banked)),
    best: maxBy(scored, (mv) => mv.net),
    worst: maxBy(scored, (mv) => -mv.net),
  };
}
