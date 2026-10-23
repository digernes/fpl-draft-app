// Cards and rows used on more than one tab.

import type { Move, Retention, TopGameweek, Trade } from '../shared/data.ts';
import { avatar, card, crest, listRow, photo, tag, type Footer } from './components.ts';
import { ago, esc, maxOf, ordinal, pct, priceText, signed, sum } from './format.ts';
import { arrowSvg, swapSvg, triangleSvg } from './icons.ts';
import { first, gwPoints, lineupFor, player, slotOf, type Played } from './lookups.ts';
import { D } from './state.ts';
import { tableFrom } from './table.ts';

export const resultText = (g: TopGameweek) => {
  const oppPts = g.oppPts as number;
  return g.opp ? `${g.pts > oppPts ? 'Won' : g.pts < oppPts ? 'Lost' : 'Drew'} ${g.pts}-${g.oppPts} vs ${first(g.opp)}` : '';
};

export type FeedItem =
  { at: string; gw: number; move: Move; trade?: undefined } | { at: string; gw: number; trade: Trade; move?: undefined };

export function feed(): FeedItem[] {
  const singles = D.transfers.moves.filter((mv) => mv.type !== 'trade').map((mv) => ({ at: mv.at, gw: mv.gw, move: mv }));
  const trades = D.transfers.trades.filter((t) => t.state === 'p').map((t) => ({ at: t.at, gw: t.gw, trade: t }));
  return [...singles, ...trades].sort((a, b) => b.at.localeCompare(a.at));
}

export const MOVE_TYPES = { waiver: 'Waiver', free: 'Free agent', trade: 'Trade' };

export function feedRow(item: FeedItem) {
  if (item.trade) {
    const t = item.trade;
    const names = (ids: number[]) => ids.map((pid) => esc(player(pid).name)).join(', ');
    return listRow({
      lead: `<span class="swap-icon">${swapSvg}</span>`,
      title: `${first(t.offeredBy)} ⇄ ${first(t.offeredTo)}`,
      meta: `${first(t.offeredBy)} gets ${names(t.items.map((i) => i.gets))} · ${first(t.offeredTo)} gets ${names(t.items.map((i) => i.gives))} · ${ago(t.at)}`,
      value: tag('Trade'),
    });
  }
  const mv = item.move;
  const pin = player(mv.in);
  const net =
    mv.net != null
      ? ` · <span data-tip="Points since: ${esc(pin.name)} ${mv.inPts}, ${esc(player(mv.out).name)} ${mv.outPts}">${signed(mv.net)} net</span>`
      : '';
  return listRow({
    lead: photo(mv.in),
    title: `<span class="arrow-in" aria-label="In">${arrowSvg}</span>${esc(pin.name)} ${crest(pin.club, 14)}`,
    meta: `<span class="arrow-out" aria-label="Out">${arrowSvg}</span>${esc(player(mv.out).name)} · ${MOVE_TYPES[mv.type]} · ${ago(mv.at)}${net}`,
    value: avatar(mv.manager, 24),
  });
}

export function squadStrip(r: Retention) {
  const dots = Array.from({ length: r.size }, (_, i) => `<i class="${i < r.kept.length ? `on m${slotOf(r.id)}` : ''}"></i>`).join('');
  return `<span class="strip" data-tip="${r.kept.length} of ${r.size} draft picks still in the squad">${dots}</span>`;
}

// --- Gameweek review ----------------------------------------------------------------

export function gameweekReviewCard(gw: number, { limit = Infinity, footer = null as Footer | null } = {}) {
  const games = D.matches.filter((m) => m.gw === gw && m.started) as Played[];
  if (!games.length) return '';
  const live = games.some((m) => !m.finished);
  const scores = games.flatMap((m) => [
    { id: m.home, pts: m.homePts, opp: m.away, oppPts: m.awayPts, over: m.finished },
    { id: m.away, pts: m.awayPts, opp: m.home, oppPts: m.homePts, over: m.finished },
  ]);
  type Score = (typeof scores)[number];
  // A match still being played is led, trailed or level, not won or lost.
  const verdict = (s: Score) => {
    const [ahead, behind, level] = s.over ? ['beat', 'lost to', 'drew with'] : ['leads', 'trails', 'level with'];
    return `${s.pts > s.oppPts ? ahead : s.pts < s.oppPts ? behind : level} ${first(s.opp)} ${s.pts}-${s.oppPts}`;
  };
  const margin = (m: Played) => Math.abs(m.homePts - m.awayPts);
  const winnerOf = (m: Played) => (m.homePts > m.awayPts ? { id: m.home, loser: m.away, side: 0 } : { id: m.away, loser: m.home, side: 2 });
  // The winner (or the leader) first; a draw as it stands, home first.
  const matchText = (m: Played) => {
    if (!margin(m)) return `${first(m.home)} ${m.homePts}-${m.awayPts} ${first(m.away)}`;
    const { id, loser } = winnerOf(m);
    return `${first(id)} ${Math.max(m.homePts, m.awayPts)}-${Math.min(m.homePts, m.awayPts)} ${first(loser)}`;
  };
  const pair = (m: Played) => `<span class="stack">${avatar(m.home, 24)}${avatar(m.away, 24)}</span>`;
  const decided = games.filter((m) => margin(m) > 0);

  const top = maxOf(scores, (s) => s.pts);
  const low = maxOf(scores, (s) => -s.pts);
  const biggest = maxOf(decided, margin);
  const closest = maxOf(games, (m) => -margin(m)); // a draw is as close as it gets
  const star = maxOf(
    D.managers.flatMap((mg) => (lineupFor(mg.id, gw)?.xi ?? []).map((pid) => ({ pid, id: mg.id, pts: gwPoints(pid, gw) }))),
    (x) => x.pts,
  );
  // The winner the pre-match odds liked least, if they were the outsider.
  const upset = maxOf(
    decided
      .filter((m) => m.odds)
      .map((m) => ({ ...winnerOf(m), over: m.finished, p: m.odds!.p[winnerOf(m).side], price: m.odds!.prices[winnerOf(m).side] }))
      .filter((u) => u.p < 0.4),
    (u) => -u.p,
  );
  const before = gw > D.meta.firstGw ? tableFrom(D.matches.filter((m) => m.started && m.gw < gw)) : null;
  const after = tableFrom(D.matches.filter((m) => m.started && m.gw <= gw));
  const movers = before ? after.map((r) => ({ id: r.id, rank: r.rank, change: before.find((b) => b.id === r.id)!.rank - r.rank })) : [];
  const climber = maxOf(
    movers.filter((x) => x.change > 0),
    (x) => x.change,
  );
  const faller = maxOf(
    movers.filter((x) => x.change < 0),
    (x) => -x.change,
  );
  const signing = maxOf(
    D.transfers.moves
      .filter((mv) => mv.gw === gw && player(mv.in))
      .map((mv) => ({ mv, pts: gwPoints(mv.in, gw) }))
      .filter((s) => s.pts > 0),
    (s) => s.pts,
  );
  const bench = maxOf(
    D.managers.map((mg) => ({ id: mg.id, pts: lineupFor(mg.id, gw)?.benchPts ?? 0 })),
    (b) => b.pts,
  );
  const move = (x: { change: number }, tone: string) => `<span class="rank-delta ${tone}">${triangleSvg}${Math.abs(x.change)}</span>`;

  const rows = [
    top && listRow({ lead: avatar(top.id, 32), title: 'Top score', meta: `${first(top.id)} · ${verdict(top)}`, value: top.pts, top: true }),
    star &&
      listRow({
        lead: photo(star.pid),
        title: 'Player of the week',
        meta: `${esc(player(star.pid).name)} ${crest(player(star.pid).club, 14)} · for ${first(star.id)}`,
        value: star.pts,
      }),
    biggest &&
      listRow({
        lead: pair(biggest),
        title: biggest.finished ? 'Biggest win' : 'Biggest lead',
        meta: matchText(biggest),
        value: `+${margin(biggest)}`,
      }),
    upset &&
      listRow({
        lead: avatar(upset.id, 32),
        title: 'Upset',
        meta: `${first(upset.id)} ${upset.over ? 'beat' : 'leads'} ${first(upset.loser)} at ${priceText(upset.price)}`,
        value: pct(upset.p),
      }),
    climber &&
      listRow({
        lead: avatar(climber.id, 32),
        title: 'Climber',
        meta: `${first(climber.id)}, up to ${ordinal(climber.rank)}${live ? ' as it stands' : ''}`,
        value: move(climber, 'good'),
      }),
    faller &&
      listRow({
        lead: avatar(faller.id, 32),
        title: 'Faller',
        meta: `${first(faller.id)}, down to ${ordinal(faller.rank)}${live ? ' as it stands' : ''}`,
        value: move(faller, 'bad'),
      }),
    signing &&
      listRow({
        lead: photo(signing.mv.in),
        title: 'Best new signing',
        meta: `${esc(player(signing.mv.in).name)} · ${MOVE_TYPES[signing.mv.type]} for ${first(signing.mv.manager)}`,
        value: signing.pts,
      }),
    bench && bench.pts > 0 && listRow({ lead: avatar(bench.id, 32), title: 'Left on the bench', meta: first(bench.id), value: bench.pts }),
    closest &&
      closest !== biggest &&
      listRow({
        lead: pair(closest),
        title: 'Closest match',
        meta: matchText(closest),
        value: margin(closest) ? `+${margin(closest)}` : closest.finished ? 'Draw' : 'Level',
      }),
    low && listRow({ lead: avatar(low.id, 32), title: 'Lowest score', meta: `${first(low.id)} · ${verdict(low)}`, value: low.pts }),
  ].filter(Boolean);
  const average = Math.round(sum(scores.map((s) => s.pts)) / scores.length);
  return card({
    title: `Gameweek ${gw} ${live ? 'so far' : 'review'}`,
    sub: `Average score ${average}${live ? ' · live' : ''}`,
    body: `<div class="list">${rows.slice(0, limit).join('')}</div>`,
    footer,
  });
}
