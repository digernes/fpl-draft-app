// Transfer stats: every move with what it has been worth since, waiver claims won and
// lost, the most contested players, and each manager's summary.

import type { Claim, Move, ScoredMove, TransferSummary, Transfers } from '../shared/data.ts';
import type { lineupOf } from './lineups.ts';
import type { Season } from './season.ts';
import { countBy, groupBy, maxBy, range, sum } from './util.ts';

type LineupOf = ReturnType<typeof lineupOf>;

export function buildTransfers(season: Season, managerIds: number[], waiverOrder: number[], lineup: LineupOf): Transfers {
  const { transactions, trades, events, finishedGws, lastFinishedGw, pointsIn, ownerNow, elements, gws, league, currentGw, game } = season;
  const pointsSince = (id: number, gw: number) => sum(finishedGws.filter((g) => g >= gw).map((g) => pointsIn(id, g)));
  const bankedSince = (entry: number, id: number, gw: number) =>
    sum(finishedGws.filter((g) => g >= gw && lineup(entry, g)?.xi.includes(id)).map((g) => pointsIn(id, g)));
  const squadAt = (entry: number, gw: number) => {
    const l = lineup(entry, gw);
    return l ? new Set([...l.xi, ...l.bench]) : null;
  };

  const moves: Move[] = [];
  for (const t of transactions) {
    if (t.result !== 'a') continue;
    const waiver = t.kind === 'w';
    const at = (waiver && events.find((e) => e.id === t.event)?.waivers_time) || t.added;
    moves.push({
      type: waiver ? 'waiver' : 'free',
      manager: t.entry,
      in: t.element_in,
      out: t.element_out,
      gw: t.event,
      at,
      order: t.index ?? 0,
    });
  }
  for (const tr of trades.filter((x) => x.state === 'p')) {
    const at = tr.response_time ?? tr.offer_time;
    for (const item of tr.tradeitem_set) {
      moves.push({
        type: 'trade',
        manager: tr.offered_entry,
        partner: tr.received_entry,
        in: item.element_in,
        out: item.element_out,
        gw: tr.event,
        at,
      });
      moves.push({
        type: 'trade',
        manager: tr.received_entry,
        partner: tr.offered_entry,
        in: item.element_out,
        out: item.element_in,
        gw: tr.event,
        at,
      });
    }
  }
  for (const mv of moves) {
    if (mv.gw > lastFinishedGw) continue; // nothing scored yet
    mv.inPts = pointsSince(mv.in, mv.gw);
    mv.outPts = pointsSince(mv.out, mv.gw);
    mv.net = mv.inPts - mv.outPts;
    mv.banked = bankedSince(mv.manager, mv.in, mv.gw);
  }
  moves.sort((a, b) => b.at.localeCompare(a.at) || (b.order ?? 0) - (a.order ?? 0));

  // Waiver result codes: "a" won, "di" the player in was already gone (claimed by a
  // higher priority, or by your own earlier claim), "do" the player out was already gone.
  const waiverClaims = transactions.filter((t) => t.kind === 'w');
  const wonBy = new Map(waiverClaims.filter((t) => t.result === 'a').map((t) => [`${t.event}:${t.element_in}`, t.entry]));
  const claims: Claim[] = waiverClaims.map((t) => {
    const winner = wonBy.get(`${t.event}:${t.element_in}`) ?? null;
    const outcome = t.result === 'a' ? 'won' : t.result === 'di' && winner && winner !== t.entry ? 'lost' : 'void';
    return { manager: t.entry, in: t.element_in, out: t.element_out, gw: t.event, priority: t.priority, outcome, winner };
  });

  const contested = Object.values(groupBy(claims, (c) => `${c.gw}:${c.in}`))
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

  const ownersOf = new Map<number, Set<number>>();
  const addOwner = (pid: number, owner: number) => (ownersOf.get(pid) ?? ownersOf.set(pid, new Set()).get(pid)!).add(owner);
  for (const id of managerIds) {
    for (const gw of gws) for (const pid of squadAt(id, gw) ?? []) addOwner(pid, id);
  }
  for (const [pid, owner] of ownerNow) addOwner(pid, owner);
  const hotPotatoes = [...ownersOf]
    .filter(([, owners]) => owners.size > 1)
    .map(([player, owners]) => ({
      player,
      owners: [...owners],
      moves: moves.filter((mv) => mv.in === player && mv.type !== 'trade').length,
    }))
    .sort((a, b) => b.owners.length - a.owners.length || b.moves - a.moves)
    .slice(0, 6);

  const dropCounts = countBy(
    moves.filter((mv) => mv.type !== 'trade'),
    (mv) => mv.out,
  );
  const mostDropped = Object.entries(dropCounts)
    .map(([player, times]) => ({ player: Number(player), times }))
    .sort((a, b) => b.times - a.times || (elements.get(b.player)?.total_points ?? 0) - (elements.get(a.player)?.total_points ?? 0))
    .slice(0, 5);

  const isScored = (mv: Move): mv is ScoredMove => mv.net != null;
  const scoredMoves = moves.filter(isScored).filter((mv) => mv.type !== 'trade');
  const bestPickups = [...scoredMoves].sort((a, b) => b.net - a.net || b.banked - a.banked).slice(0, 6);
  const regrets = [...scoredMoves].sort((a, b) => b.outPts - a.outPts || a.net - b.net).slice(0, 6);

  const byGw = range(league.start_event, Math.max(currentGw, game.next_event ?? 0, 1)).map((gw) => ({
    gw,
    waiver: moves.filter((mv) => mv.gw === gw && mv.type === 'waiver').length,
    free: moves.filter((mv) => mv.gw === gw && mv.type === 'free').length,
    trade: trades.filter((tr) => tr.state === 'p' && tr.event === gw).length,
  }));

  const summary: TransferSummary[] = managerIds.map((id) => {
    const mine = moves.filter((mv) => mv.manager === id);
    const myClaims = claims.filter((c) => c.manager === id);
    const scored = mine.filter(isScored);
    return {
      id,
      moves: mine.length,
      waivers: mine.filter((mv) => mv.type === 'waiver').length,
      free: mine.filter((mv) => mv.type === 'free').length,
      trades: trades.filter((tr) => tr.state === 'p' && (tr.offered_entry === id || tr.received_entry === id)).length,
      claims: myClaims.length,
      lost: myClaims.filter((c) => c.outcome === 'lost').length,
      void: myClaims.filter((c) => c.outcome === 'void').length,
      net: sum(scored.map((mv) => mv.net)),
      banked: sum(scored.map((mv) => mv.banked)),
      best: maxBy(scored, (mv) => mv.net),
      worst: maxBy(scored, (mv) => -mv.net),
    };
  });

  const tradeLog = trades
    .map((tr) => ({
      gw: tr.event,
      offeredBy: tr.offered_entry,
      offeredTo: tr.received_entry,
      state: tr.state,
      at: tr.response_time ?? tr.offer_time,
      items: tr.tradeitem_set.map((it) => ({ gives: it.element_out, gets: it.element_in })),
    }))
    .sort((a, b) => b.at.localeCompare(a.at));

  return {
    moves,
    claims,
    summary,
    contested,
    hotPotatoes,
    mostDropped,
    bestPickups,
    regrets,
    byGw,
    trades: tradeLog,
    waiverOrder,
  };
}
