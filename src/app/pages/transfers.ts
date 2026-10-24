// The Transfer center, as fotmob.com's: every player who has moved, from whom to whom,
// newest first, with the trade offers under them; and on the left a filter for the team
// and the kind of move, the season's numbers and the waiver order. On a phone the filter
// is in a sheet behind a button, and the numbers and the order are left out. The home
// page's recent transfers card leads here.

import type { Move } from '../../shared/data.ts';
import { onAction } from '../actions.ts';
import { feed, feedRow, MOVE_TYPES } from '../cards.ts';
import { avatar, card, crest, empty, listRow, photo, seg, sheet, tile } from '../components.ts';
import { ago, esc, fmtShortDay, plural } from '../format.ts';
import { slidersSvg, starSvg, swapSvg } from '../icons.ts';
import { club, first, player } from '../lookups.ts';
import { renderView, type PageView } from '../render.ts';
import { href } from '../router.ts';
import { D, state } from '../state.ts';
import { tradesCard, waiverOrderCard } from '../views/transfers.ts';

onAction('log', (value) => {
  state.logManager = value;
  renderView();
});
onAction('move-type', (value) => {
  state.moveType = value;
  renderView();
});
onAction('move-gw', (value) => {
  state.moveGw = value;
  renderView();
});
onAction('move-pos', (value) => {
  state.movePos = value;
  renderView();
});

/** A player who moved: from a team (or free agency) to a team (or back to it). */
interface Movement {
  move: Move;
  pid: number;
  from: number | null;
  to: number | null;
}

// Each waiver or free-agent move is two movements, the player in and the player out; a
// trade's each leg is already a move of its own, so it counts once.
function movements(): Movement[] {
  return D.transfers.moves.flatMap((mv): Movement[] =>
    mv.type === 'trade'
      ? [{ move: mv, pid: mv.in, from: mv.partner ?? null, to: mv.manager }]
      : [
          { move: mv, pid: mv.in, from: null, to: mv.manager },
          { move: mv, pid: mv.out, from: mv.manager, to: null },
        ],
  );
}

// How big a name: his place in the league's draft or among the season's scorers, whichever
// is higher. The top 50 make a top transfer.
const BIG_NAMES = 50;
function stature() {
  const scorers = Object.entries(D.players)
    .filter(([, p]) => p.total > 0)
    .sort(([, a], [, b]) => b.total - a.total);
  const byPoints = new Map(scorers.map(([pid], i) => [Number(pid), i + 1]));
  const byPick = new Map(D.draft.picks.map((p) => [p.player, p.overall]));
  return (pid: number) => Math.min(byPoints.get(pid) ?? Infinity, byPick.get(pid) ?? Infinity);
}

export function pageTransfers(): PageView {
  const all = movements();
  const team = Number(state.logManager) || null;
  // In: to the team (or any, for all of them); out: from it.
  const into = (x: Movement) => (team ? x.to === team : x.to !== null);
  const outOf = (x: Movement) => (team ? x.from === team : x.from !== null);
  const shown = all.filter(
    (x) =>
      ((state.moves !== 'out' && into(x)) || (state.moves !== 'in' && outOf(x))) &&
      (state.moveType === 'all' || x.move.type === state.moveType) &&
      (state.moveGw === 'all' || x.move.gw === Number(state.moveGw)) &&
      (state.movePos === 'all' || player(x.pid)?.pos === state.movePos),
  );
  return {
    title: 'Transfer center',
    header: {
      logo: `<span class="tc-logo">${swapSvg}</span>`,
      title: 'Transfer center',
      sub: `${plural(D.transfers.moves.filter((mv) => mv.type !== 'trade').length + D.transfers.trades.filter((t) => t.state === 'p').length, 'move')} this season${D.meta.nextWaivers ? ` · next waivers ${fmtShortDay.format(new Date(D.meta.nextWaivers))}` : ''}`,
      side: `<button type="button" class="tc-edit" data-action="sheet-open" data-value="tc-sheet">Filter${slidersSvg}</button>`,
      cls: 'tc-header',
    },
    body: `<div class="cols-side">
      <div class="col tc-side">${card({ title: 'Filter', body: filters() })}${numbersCard()}${waiverOrderCard()}</div>
      <div class="col">${card({ title: 'All transfers', sub: plural(shown.length, 'player'), body: shown.length ? byGameweek(shown) : empty('No transfers like that yet') })}${tradesCard()}</div>
    </div>${sheet('tc-sheet', 'Filter', filters(), `Show ${plural(shown.length, 'player')}`)}`,
  };
}

// fotmob.com's Edit card (or sheet, on a phone): which team, the players in or out (of it,
// or of any), when, which kind of move and which position. In or out is the team page's
// switch (its `moves` action), so both agree.
function filters() {
  const options = [
    `<option value="all"${state.logManager === 'all' ? ' selected' : ''}>All teams</option>`,
    ...D.managers.map(
      (m) => `<option value="${m.id}"${state.logManager === String(m.id) ? ' selected' : ''}>${esc(m.first)} · ${esc(m.team)}</option>`,
    ),
  ].join('');
  const kinds = seg(
    'move-type',
    [
      ['all', 'All'],
      ['waiver', 'Waivers'],
      ['free', 'Free agents'],
      ['trade', 'Trades'],
    ],
    state.moveType,
  );
  const direction = seg(
    'moves',
    [
      ['all', 'All'],
      ['in', 'In'],
      ['out', 'Out'],
    ],
    state.moves,
  );
  const gws = [...new Set(D.transfers.moves.map((mv) => mv.gw))].sort((a, b) => b - a);
  const timeframe = [
    `<option value="all"${state.moveGw === 'all' ? ' selected' : ''}>All</option>`,
    ...gws.map((gw) => `<option value="${gw}"${state.moveGw === String(gw) ? ' selected' : ''}>Gameweek ${gw}</option>`),
  ].join('');
  const positions = seg(
    'move-pos',
    [
      ['all', 'All'],
      ['GKP', 'GK'],
      ['DEF', 'DEF'],
      ['MID', 'MID'],
      ['FWD', 'FWD'],
    ],
    state.movePos,
  );
  return `<div class="tc-filter">
      <label class="tc-label">Team<span class="tc-select"><select data-action="log" aria-label="Team">${options}</select></span></label>
      <div class="tc-label">Direction</div>${direction}
      <label class="tc-label">Timeframe<span class="tc-select"><select data-action="move-gw" aria-label="Timeframe">${timeframe}</select></span></label>
      <div class="tc-label">Kind of move</div>${kinds}
      <div class="tc-label">Position</div>${positions}
    </div>`;
}

// The season's market in four numbers.
function numbersCard() {
  const t = D.transfers;
  const count = (type: string) => t.moves.filter((mv) => mv.type === type).length;
  const tiles = [
    tile('Waivers won', count('waiver'), plural(t.claims.length, 'claim')),
    tile('Free agents', count('free'), 'First come, first served'),
    tile('Trades', t.trades.filter((x) => x.state === 'p').length, plural(t.trades.length, 'offer')),
    tile('Claims lost', t.claims.filter((c) => c.outcome === 'lost').length, 'To better priority'),
  ];
  return card({
    title: 'This season',
    body: `<div class="tiles">${tiles.join('')}</div>`,
    footer: { href: href.league('transfer-stats'), label: 'Transfer stats' },
  });
}

// A team, or where a player came from or went: off waivers, or free agency.
const sidePill = (id: number | null, nobody = 'Free agent') =>
  id
    ? `<a class="tc-pill" href="${href.team(id)}">${avatar(id, 20)}<span>${first(id)}</span></a>`
    : `<span class="tc-pill free">${nobody}</span>`;

// fotmob.com's transfer rows: from, to, the player, how and when.
function table(list: Movement[]) {
  const rows = list.map(({ move, pid, from, to }) => {
    const p = player(pid);
    const other = pid === move.in ? move.out : move.in;
    const how =
      move.type === 'trade'
        ? `Trade, for ${esc(player(other)?.name ?? '?')}`
        : `${MOVE_TYPES[move.type]}, ${pid === move.in ? 'for' : 'dropped for'} ${esc(player(other)?.name ?? '?')}`;
    return `<div class="tc-row">
      <span class="tc-move">${sidePill(from, move.type === 'waiver' ? 'Waivers' : 'Free agent')}<span class="tc-arrow">→</span>${sidePill(to)}</span>
      <a class="tc-player" href="${href.player(pid)}">${photo(pid, 32)}<span class="tc-name"><span>${esc(p?.name ?? '?')}</span><span class="tc-meta">${crest(p?.club, 12)} ${esc(club(p?.club)?.short ?? '')} · ${p?.pos ?? ''}</span></span></a>
      <span class="tc-how">${how}</span>
      <span class="tc-when" data-tip="${esc(ago(move.at))}">GW ${move.gw}</span>
    </div>`;
  });
  return `<div class="tc-table"><div class="tc-row tc-head"><span>From → To</span><span>Player</span><span>Move</span><span>When</span></div>${rows.join('')}</div>`;
}

function byGameweek(list: Movement[]) {
  const groups: { gw: number; list: Movement[] }[] = [];
  for (const x of list) {
    if (groups.at(-1)?.gw !== x.move.gw) groups.push({ gw: x.move.gw, list: [] });
    groups.at(-1)!.list.push(x);
  }
  return groups
    .map(
      (g) =>
        `<div class="date-head"><span>Gameweek ${g.gw}</span><span class="muted">${plural(g.list.length, 'player')}</span></div>${table(g.list)}`,
    )
    .join('');
}

// The home page's card: this gameweek's biggest names on the move first (up to four), then
// the latest of the other moves.
export function recentTransfersCard() {
  const items = feed();
  if (!items.length)
    return card({
      title: 'Recent transfers',
      body: empty('No transfers yet'),
      footer: { href: href.transfers(), label: 'Transfer center' },
    });
  const gw = items[0].gw;
  const rank = stature();
  const top = movements()
    .filter((x) => x.move.gw === gw && rank(x.pid) <= BIG_NAMES)
    .sort((a, b) => rank(a.pid) - rank(b.pid))
    .slice(0, 4);
  const topRows = top.map(({ move, pid, from, to }) =>
    listRow({
      lead: `<a href="${href.player(pid)}">${photo(pid, 40)}</a>`,
      title: `<a href="${href.player(pid)}">${esc(player(pid).name)}</a> <span class="top-move" data-tip-head="Top transfer" data-tip="Drafted in the top 50, or a top-50 scorer">${starSvg(true)}</span>`,
      meta: `${from ? first(from) : move.type === 'waiver' ? 'Waivers' : 'Free agent'} → ${to ? first(to) : 'free agent'} · ${move.type === 'trade' ? 'trade' : MOVE_TYPES[move.type].toLowerCase()}`,
      value: `<span class="muted">${player(pid).total} pts</span>`,
    }),
  );
  // A move or trade already shown with its top transfer isn't shown again.
  const shown = new Set(top.map((x) => x.pid));
  const rest = items.filter((item) =>
    item.trade
      ? !item.trade.items.some((i) => shown.has(i.gives) || shown.has(i.gets))
      : !shown.has(item.move!.in) && !shown.has(item.move!.out),
  );
  return card({
    title: 'Recent transfers',
    sub: `Gameweek ${gw}`,
    body: `<div class="list">${topRows.join('')}${rest
      .slice(0, 5 - topRows.length)
      .map(feedRow)
      .join('')}</div>`,
    footer: { href: href.transfers(), label: 'Transfer center' },
  });
}
