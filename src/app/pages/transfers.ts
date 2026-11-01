// The Transfer center, as fotmob.com's: every move, newest first, as the game makes it (the
// player a team let go and the one it brought in, a trade once for both sides), and if asked
// the waiver claims that failed, with the trade offers under them; and on the left a filter
// for the team and the kind of move, the season's numbers and the waiver order. On a phone
// the filter is in a sheet behind a button, and the numbers and the order are left out. The
// home page's recent transfers card leads here.

import type { Claim, Move } from '../../shared/data.ts';
import { onAction } from '../actions.ts';
import { feed, feedRow, MOVE_TYPES } from '../cards.ts';
import { avatar, card, empty, listRow, photo, seg, sheet, tile } from '../components.ts';
import { ago, esc, fmtShortDay, plural } from '../format.ts';
import { slidersSvg, starSvg, swapSvg } from '../icons.ts';
import { first, mgr, player } from '../lookups.ts';
import { renderView, type PageView } from '../render.ts';
import { href } from '../router.ts';
import { D, state } from '../state.ts';
import { tradesCard, waiverOrderCard } from '../views/transfers.ts';
import { CLAIM_OUTCOMES } from './team-transfers.ts';

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
onAction('move-failed', (value) => {
  state.moveFailed = value;
  renderView();
});

/** A move as the game makes it: a team's players in and out (one each, but for a trade); or a waiver claim that failed. */
interface Deal {
  move: Move;
  ins: number[];
  outs: number[];
  failed?: Claim;
}

// The waiver claims lost to a better priority or void, as the moves they would have been.
const failedOf = (team: number | null): Deal[] =>
  D.transfers.claims
    .filter((c) => c.outcome !== 'won' && (!team || c.manager === team))
    .map((c) => ({
      move: { type: 'waiver', manager: c.manager, in: c.in, out: c.out, gw: c.gw, at: '' },
      ins: [c.in],
      outs: [c.out],
      failed: c,
    }));

// A waiver or free-agent move is a deal of its own. A trade is a move for each side per
// player swapped, which make one deal: as a team's side for that team, else as the side
// that offered it, which the build lists first.
function dealsOf(team: number | null): Deal[] {
  const deals: Deal[] = [];
  const trades = new Map<string, Deal>();
  for (const mv of D.transfers.moves) {
    if (team && mv.manager !== team) continue;
    if (mv.type !== 'trade') {
      deals.push({ move: mv, ins: [mv.in], outs: [mv.out] });
      continue;
    }
    const key = `${mv.at} ${Math.min(mv.manager, mv.partner!)} ${Math.max(mv.manager, mv.partner!)}`;
    const deal = trades.get(key);
    if (!deal) {
      trades.set(key, { move: mv, ins: [mv.in], outs: [mv.out] });
      deals.push(trades.get(key)!);
    } else if (deal.move.manager === mv.manager) {
      deal.ins.push(mv.in);
      deal.outs.push(mv.out);
    }
  }
  return deals;
}

/** A player who moved: from a team (or free agency) to a team (or back to it). */
interface Movement {
  move: Move;
  pid: number;
  from: number | null;
  to: number | null;
}

// For the top transfers: each waiver or free-agent move is two movements, the player in and
// the player out; a trade's each leg is already a move of its own, so it counts once.
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
  const team = Number(state.logManager) || null;
  // Each gameweek's failed claims after its moves (the sort keeps the order within one).
  const all = state.moveFailed === 'show' ? [...dealsOf(team), ...failedOf(team)].sort((a, b) => b.move.gw - a.move.gw) : dealsOf(team);
  const shown = all.filter(
    ({ move, ins, outs }) =>
      (state.moveType === 'all' || move.type === state.moveType) &&
      (state.moveGw === 'all' || move.gw === Number(state.moveGw)) &&
      (state.movePos === 'all' || [...ins, ...outs].some((pid) => player(pid)?.pos === state.movePos)),
  );
  return {
    title: 'Transfer center',
    header: {
      logo: `<span class="tc-logo">${swapSvg}</span>`,
      title: 'Transfer center',
      sub: `${plural(dealsOf(null).length, 'move')} this season${D.meta.nextWaivers ? ` · next waivers ${fmtShortDay.format(new Date(D.meta.nextWaivers))}` : ''}`,
      side: `<button type="button" class="tc-edit" data-action="sheet-open" data-value="tc-sheet">Filter${slidersSvg}</button>`,
      cls: 'tc-header',
    },
    body: `<div class="cols-side">
      <div class="col tc-side">${card({ title: 'Filter', body: filters() })}${numbersCard()}${waiverOrderCard()}</div>
      <div class="col">${card({ title: 'All transfers', sub: counted(shown), body: shown.length ? byGameweek(shown) : empty('No transfers like that yet') })}${tradesCard()}</div>
    </div>${sheet('tc-sheet', 'Filter', filters(), `Show ${counted(shown)}`)}`,
  };
}

// How many moves, and failed claims when shown.
function counted(list: Deal[]) {
  const failed = list.filter((d) => d.failed).length;
  return `${plural(list.length - failed, 'move')}${failed ? ` · ${failed} failed` : ''}`;
}

// fotmob.com's Edit card (or sheet, on a phone): which team, when, which kind of move, which
// position (of the player in or out), and whether to show the waiver claims that failed.
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
  const failed = seg(
    'move-failed',
    [
      ['hide', 'Hide'],
      ['show', 'Show'],
    ],
    state.moveFailed,
  );
  return `<div class="tc-filter">
      <label class="tc-label">Team<span class="tc-select"><select data-action="log" aria-label="Team">${options}</select></span></label>
      <label class="tc-label">Timeframe<span class="tc-select"><select data-action="move-gw" aria-label="Timeframe">${timeframe}</select></span></label>
      <div class="tc-label">Kind of move</div>${kinds}
      <div class="tc-label">Position</div>${positions}
      <div class="tc-label">Failed claims</div>${failed}
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

const playerPill = (pid: number) =>
  `<a class="tc-pill" href="${href.player(pid)}">${photo(pid, 28)}<span>${esc(player(pid)?.name ?? '?')}</span></a>`;

const teamLink = (id: number) => `<a href="${href.team(id)}">${first(id)}</a>`;

// The team that made a move, or both sides of a trade, a line each, the one whose from → to it is first.
function teamCell(mv: Move) {
  if (mv.type === 'trade')
    return `<span class="tc-team"><span class="stack">${avatar(mv.manager, 32)}${avatar(mv.partner, 32)}</span><span class="tc-name"><span>${teamLink(mv.manager)}</span><span>⇄ ${teamLink(mv.partner!)}</span></span></span>`;
  return `<span class="tc-team">${avatar(mv.manager, 32)}<span class="tc-name"><span>${teamLink(mv.manager)}</span><span class="tc-meta">${esc(mgr(mv.manager)?.team ?? '')}</span></span></span>`;
}

// fotmob.com's transfer rows, a move each: the team that made it, from → to (the player out,
// then the player in, a line for each pair a trade swapped), how and when. A failed claim's
// is faded, with what became of it as its move.
function table(list: Deal[]) {
  const rows = list.map(({ move: mv, ins, outs, failed }) => {
    const swaps = ins.map(
      (pid, i) => `<span class="tc-move">${playerPill(outs[i])}<span class="tc-arrow">→</span>${playerPill(pid)}</span>`,
    );
    const when = failed
      ? `<span class="tc-when">GW ${mv.gw}</span>`
      : `<span class="tc-when" data-tip="${esc(ago(mv.at))}">GW ${mv.gw}</span>`;
    return `<div class="tc-row${failed ? ' failed' : ''}">
      ${teamCell(mv)}
      <span class="tc-swaps">${swaps.join('')}</span>
      ${failed ? claimHow(failed) : `<span class="tc-how">${MOVE_TYPES[mv.type]}</span>`}
      ${when}
    </div>`;
  });
  return `<div class="tc-table"><div class="tc-row tc-head"><span>Team</span><span>From → To</span><span>Move</span><span>When</span></div>${rows.join('')}</div>`;
}

// A failed claim's move: lost, and to whom, or void, why in its tip.
function claimHow(c: Claim) {
  const [label, tip] = CLAIM_OUTCOMES[c.outcome];
  const to = c.outcome === 'lost' && c.winner ? ` to ${first(c.winner)}` : '';
  return `<span class="tc-how" data-tip="${esc(tip)}">Claim ${label.toLowerCase()}${to}</span>`;
}

function byGameweek(list: Deal[]) {
  const groups: { gw: number; list: Deal[] }[] = [];
  for (const deal of list) {
    if (groups.at(-1)?.gw !== deal.move.gw) groups.push({ gw: deal.move.gw, list: [] });
    groups.at(-1)!.list.push(deal);
  }
  return groups
    .map((g) => `<div class="date-head"><span>Gameweek ${g.gw}</span><span class="muted">${counted(g.list)}</span></div>${table(g.list)}`)
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
