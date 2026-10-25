// A draft team's Transfers tab, as fotmob.com's: every move in or out, the waiver claims and
// the trades.

import type { Move } from '../../shared/data.ts';
import { MOVE_TYPES } from '../cards.ts';
import { avatar, card, crest, empty, listRow, photo, seg, tag } from '../components.ts';
import { ago, esc, plural, signed } from '../format.ts';
import { first, player } from '../lookups.ts';
import { href } from '../router.ts';
import { D, state } from '../state.ts';
import { TRADE_STATES } from '../views/transfers.ts';

// As fotmob.com's Transfers tab: every move, or the players in or out, newest first.
export function movesCard(id: number) {
  const moves = D.transfers.moves.filter((mv) => mv.manager === id);
  const dir = state.moves;
  const filter = seg(
    'moves',
    [
      ['all', 'All'],
      ['in', 'In'],
      ['out', 'Out'],
    ],
    dir,
  );
  const rows = moves.map((mv) => moveRow(mv, MOVE_VIEWS[dir as keyof typeof MOVE_VIEWS]));
  return card({
    title: 'Transfers',
    sub: plural(moves.length, 'move'),
    action: filter,
    body: rows.length ? `<div class="list">${rows.join('')}</div>` : empty('No transfers yet'),
  });
}

// What a move's row leads with under each filter, and which of its points since it shows.
const MOVE_VIEWS = {
  all: {
    main: 'in',
    other: 'out',
    since: 'net',
    verb: 'For',
    tip: () => 'Points since by the player in, less the player out',
    show: signed,
  },
  in: { main: 'in', other: 'out', since: 'inPts', verb: 'In, for', tip: (name: string) => `Points since by ${name}`, show: String },
  out: { main: 'out', other: 'in', since: 'outPts', verb: 'Out, for', tip: (name: string) => `Points since by ${name}`, show: String },
} as const;

function moveRow(mv: Move, view: (typeof MOVE_VIEWS)[keyof typeof MOVE_VIEWS]) {
  const main = mv[view.main];
  const other = mv[view.other];
  const since = mv[view.since];
  const p = player(main);
  const how = mv.type === 'trade' ? `Trade with ${first(mv.partner)}` : MOVE_TYPES[mv.type];
  return listRow({
    lead: `<a href="${href.player(main)}">${photo(main)}</a>`,
    title: `<a href="${href.player(main)}">${esc(p.name)}</a> ${crest(p.club, 14)}`,
    meta: `${view.verb} <a href="${href.player(other)}">${esc(player(other).name)}</a> · ${how} · GW ${mv.gw} · ${ago(mv.at)}`,
    value: since == null ? '' : `<span data-tip="${view.tip(esc(p.name))}">${view.show(since)}</span>`,
  });
}

const OUTCOMES = {
  won: ['Won', ''],
  lost: ['Lost', 'Another manager with better waiver priority got him'],
  void: ['Void', 'The player in or out was gone by the time it came up'],
};

export function claimsCard(id: number) {
  const claims = D.transfers.claims.filter((c) => c.manager === id).sort((a, b) => b.gw - a.gw);
  if (!claims.length) return '';
  const rows = claims.map((c) => {
    const [label, tip] = OUTCOMES[c.outcome];
    const lostTo = c.outcome === 'lost' && c.winner ? ` to ${first(c.winner)}` : '';
    return listRow({
      lead: `<a href="${href.player(c.in)}">${photo(c.in)}</a>`,
      title: `<a href="${href.player(c.in)}">${esc(player(c.in).name)}</a>`,
      meta: `For <a href="${href.player(c.out)}">${esc(player(c.out).name)}</a> · GW ${c.gw}${c.priority ? ` · priority ${c.priority}` : ''}`,
      value: tag(`${label}${lostTo}`, tip, c.outcome === 'won' ? 'tag-won' : ''),
    });
  });
  return card({
    title: 'Waiver claims',
    sub: `${claims.filter((c) => c.outcome === 'won').length} of ${claims.length} won`,
    body: `<div class="list">${rows.join('')}</div>`,
  });
}

export function tradesCard(id: number) {
  const trades = D.transfers.trades.filter((t) => t.offeredBy === id || t.offeredTo === id);
  if (!trades.length) return '';
  const names = (ids: number[]) => ids.map((pid) => `<a href="${href.player(pid)}">${esc(player(pid).name)}</a>`).join(', ');
  const rows = trades.map((t) => {
    const other = t.offeredBy === id ? t.offeredTo : t.offeredBy;
    const gets = t.offeredBy === id ? t.items.map((i) => i.gets) : t.items.map((i) => i.gives);
    const gives = t.offeredBy === id ? t.items.map((i) => i.gives) : t.items.map((i) => i.gets);
    return listRow({
      lead: avatar(other, 32),
      title: `${t.offeredBy === id ? 'Offered to' : 'Offer from'} ${first(other)}`,
      meta: `Gets ${names(gets)} · gives ${names(gives)} · GW ${t.gw}`,
      value: tag(TRADE_STATES[t.state] ?? t.state),
    });
  });
  return card({ title: 'Trades', body: `<div class="list">${rows.join('')}</div>` });
}
