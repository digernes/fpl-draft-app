// The Transfers tab is the feed of moves, with the waiver order and trade offers. The
// transfer stats (the market at a glance, per-manager numbers and awards) live on the
// Stats tab, under Transfers.

import type { TransferSummary } from '../../shared/data.ts';
import { feed, feedRow, type FeedItem } from '../cards.ts';
import { avatar, card, chip, crest, empty, listRow, photo, tag } from '../components.ts';
import { ago, esc, plural, signed, sum } from '../format.ts';
import { swapSvg } from '../icons.ts';
import { first, mgr, player } from '../lookups.ts';
import { D, state } from '../state.ts';
import { dataTable, managerCol, posCol, type Column } from '../table.ts';

export function viewTransfers() {
  return `<div class="cols">
    <div class="col">${transferLogCard()}</div>
    <div class="col">${waiverOrderCard()}${tradesCard()}</div>
  </div>`;
}

export function transferStats() {
  const t = D.transfers;
  const count = (type: string) => t.moves.filter((mv) => mv.type === type).length;
  const busiest = t.byGw.reduce((a, b) => (b.waiver + b.free + b.trade > a.waiver + a.free + a.trade ? b : a), t.byGw[0]);
  const tiles: [string, string | number, string][] = [
    ['Waivers won', count('waiver'), `${t.claims.length} claims in total`],
    ['Free agents signed', count('free'), 'First come, first served'],
    ['Trades', t.trades.filter((x) => x.state === 'p').length, plural(t.trades.length, 'offer')],
    ['Claims lost', t.claims.filter((c) => c.outcome === 'lost').length, 'Another manager had better waiver priority'],
    ['Busiest gameweek', busiest ? `GW ${busiest.gw}` : '–', busiest ? plural(busiest.waiver + busiest.free + busiest.trade, 'move') : ''],
  ];
  const tileHtml = tiles
    .map(
      ([label, value, meta]) =>
        `<div class="tile"><div class="tile-label">${label}</div><div class="tile-value">${value}</div><div class="tile-meta">${meta}</div></div>`,
    )
    .join('');
  return `${card({ title: 'Transfer market', body: `<div class="tiles">${tileHtml}</div>` })}
  <div class="cols">
    <div class="col">${transferTableCard()}${movesByGwCard()}${bestPickupsCard()}${regretsCard()}</div>
    <div class="col">${awardsCard()}${contestedCard()}${hotPotatoesCard()}</div>
  </div>`;
}

type SummaryRow = TransferSummary & { rank: number };

function transferTableCard() {
  const rows = [...D.transfers.summary].sort((a, b) => b.moves - a.moves || b.net - a.net).map((s, i) => ({ ...s, rank: i + 1 }));
  const cols: Column<SummaryRow>[] = [
    posCol,
    managerCol,
    { label: 'Moves', w: '46px', cls: 'c-pts', tip: 'Waivers, free agents and trade legs', cell: (r) => r.moves },
    { label: 'Waivers', w: '56px', from: 'sm', tip: 'Waivers won / claims made', cell: (r) => `${r.waivers}/${r.claims}` },
    { label: 'Lost', w: '36px', from: 'md', tip: 'Claims lost to a manager with better waiver priority', cell: (r) => r.lost },
    { label: 'FA', w: '30px', from: 'md', tip: 'Free-agent signings', cell: (r) => r.free },
    { label: 'Trades', w: '46px', from: 'lg', cell: (r) => r.trades },
    {
      label: 'Net',
      w: '44px',
      tip: 'Points by players in minus players out, since each move',
      cell: (r) => (r.moves ? signed(r.net) : '–'),
    },
    {
      label: 'Best move',
      w: '112px',
      from: 'lg',
      cls: 'c-left',
      cell: (r) => (r.best ? `${esc(player(r.best.in).name)} <span class="muted">${signed(r.best.net)}</span>` : '–'),
    },
  ];
  return card({ title: 'Transfers by manager', body: dataTable(cols, rows) });
}

function movesByGwCard() {
  const data = D.transfers.byGw;
  if (!data.length) return '';
  const totals = data.map((d) => d.waiver + d.free + d.trade);
  const max = Math.max(1, ...totals);
  const bars = data
    .map((d, i) => {
      const tip = `GW ${d.gw}: ${plural(d.waiver, 'waiver')}, ${plural(d.free, 'free agent')}, ${plural(d.trade, 'trade')}`;
      return `<div class="bar-col" data-tip="${esc(tip)}"><div class="bar-track"><span class="bar-value">${totals[i]}</span><span class="bar" style="--share:${(totals[i] / max).toFixed(3)}"></span></div><span class="bar-label">${d.gw}</span></div>`;
    })
    .join('');
  return card({ title: 'Moves per gameweek', sub: 'Waivers, free agents and trades', body: `<div class="bars">${bars}</div>` });
}

function transferLogCard() {
  const items = feed().filter((item) => {
    if (state.logManager === 'all') return true;
    const id = Number(state.logManager);
    return item.move ? item.move.manager === id : item.trade.offeredBy === id || item.trade.offeredTo === id;
  });
  const chips = [
    chip('All', 'log', 'all', state.logManager === 'all'),
    ...D.managers.map((m) => chip(esc(m.first), 'log', m.id, state.logManager === String(m.id))),
  ].join('');
  const groups: { gw: number; items: FeedItem[] }[] = [];
  for (const item of items) {
    if (groups.at(-1)?.gw !== item.gw) groups.push({ gw: item.gw, items: [] });
    groups.at(-1)!.items.push(item);
  }
  const body = groups.length
    ? groups
        .map(
          (g) =>
            `<div class="date-head"><span>Gameweek ${g.gw}</span><span class="muted">${plural(g.items.length, 'move')}</span></div><div class="list">${g.items.map(feedRow).join('')}</div>`,
        )
        .join('')
    : empty('No transfers');
  return card({ title: 'Transfer log', body: `<div class="filter-bar">${chips}</div>${body}` });
}

function awardsCard() {
  const s = D.transfers.summary;
  const pick = (score: (x: TransferSummary) => number) => s.reduce((a, b) => (score(b) > score(a) ? b : a), s[0]);
  const keeper = D.draft.retention.reduce((a, b) => (b.kept.length > a.kept.length ? b : a), D.draft.retention[0]);
  const awards: [string, TransferSummary, (x: TransferSummary) => string][] = [
    ['Most active', pick((x) => x.moves), (x) => plural(x.moves, 'move')],
    ['Waiver wire king', pick((x) => x.waivers), (x) => `${plural(x.waivers, 'waiver')} won`],
    ['Unluckiest at the wire', pick((x) => x.lost), (x) => `${plural(x.lost, 'claim')} lost on waiver priority`],
    ['Sharpest eye', pick((x) => x.net), (x) => `${signed(x.net)} net from moves`],
    ['Set and forget', pick((x) => -x.moves), (x) => (x.moves ? plural(x.moves, 'move') : 'Not a single move')],
  ];
  const rows = awards.map(([title, winner, meta]) =>
    listRow({ lead: avatar(winner.id, 32), title: `${title}`, meta: `${first(winner.id)} · ${meta(winner)}` }),
  );
  if (keeper)
    rows.push(
      listRow({
        lead: avatar(keeper.id, 32),
        title: 'Loyal to the draft',
        meta: `${first(keeper.id)} · ${keeper.kept.length} of ${keeper.size} picks kept`,
      }),
    );
  return card({ title: 'Awards', body: `<div class="list">${rows.join('')}</div>` });
}

function bestPickupsCard() {
  const rows = D.transfers.bestPickups.map((mv, i) =>
    listRow({
      lead: photo(mv.in),
      title: `${esc(player(mv.in).name)} ${crest(player(mv.in).club, 14)}`,
      meta: `${first(mv.manager)} · GW ${mv.gw} · for ${esc(player(mv.out).name)} · ${mv.banked} pts banked`,
      value: signed(mv.net),
      top: i === 0,
    }),
  );
  return card({
    title: 'Best pickups',
    sub: 'Points since, minus the player dropped',
    body: rows.length ? `<div class="list">${rows.join('')}</div>` : empty('Nothing scored yet'),
  });
}

function regretsCard() {
  const rows = D.transfers.regrets.map((mv, i) =>
    listRow({
      lead: photo(mv.out),
      title: `${esc(player(mv.out).name)} ${crest(player(mv.out).club, 14)}`,
      meta: `Dropped by ${first(mv.manager)} · GW ${mv.gw} · for ${esc(player(mv.in).name)}`,
      value: mv.outPts,
      top: i === 0,
    }),
  );
  return card({
    title: 'The ones that got away',
    sub: 'Points scored since being dropped',
    body: rows.length ? `<div class="list">${rows.join('')}</div>` : empty('Nothing scored yet'),
  });
}

function contestedCard() {
  const rows = D.transfers.contested.map((c) =>
    listRow({
      lead: photo(c.player),
      title: `${esc(player(c.player).name)} ${crest(player(c.player).club, 14)}`,
      meta: `GW ${c.gw} · won by ${first(c.winner)}${c.pts != null ? ` · ${c.pts} pts since` : ''}`,
      value: `<span class="stack">${c.claimants.map((id) => avatar(id)).join('')}</span>`,
    }),
  );
  return card({
    title: 'Most wanted',
    sub: 'Waiver targets claimed by more than one manager',
    body: rows.length ? `<div class="list">${rows.join('')}</div>` : empty('No contested claims yet'),
  });
}

const TRADE_STATES: Record<string, string> = {
  o: 'Offered',
  a: 'Accepted',
  p: 'Processed',
  r: 'Rejected',
  w: 'Withdrawn',
  v: 'Vetoed',
  i: 'Invalid',
  e: 'Expired',
};

function tradesCard() {
  const trades = D.transfers.trades;
  const names = (ids: number[]) => ids.map((pid) => `${esc(player(pid).name)}`).join(', ');
  const rows = trades.map((t) => {
    const net = (ids: number[], outIds: number[]) => {
      if (t.gw > D.meta.lastFinishedGw) return '';
      const since = (pid: number) => (player(pid).pts ?? []).slice(t.gw - D.meta.firstGw).reduce((a, b) => a + b, 0);
      return ` <span class="muted">(${signed(sum(ids.map(since)) - sum(outIds.map(since)))})</span>`;
    };
    const gets = t.items.map((i) => i.gets);
    const gives = t.items.map((i) => i.gives);
    return `<div class="trade">
      <div class="trade-head">${avatar(t.offeredBy, 24)}<span>${first(t.offeredBy)}</span><span class="swap-icon">${swapSvg}</span>${avatar(t.offeredTo, 24)}<span>${first(t.offeredTo)}</span>${tag(TRADE_STATES[t.state] ?? t.state)}</div>
      <div class="trade-side"><span class="muted">${first(t.offeredBy)} gets</span> ${names(gets)}${net(gets, gives)}</div>
      <div class="trade-side"><span class="muted">${first(t.offeredTo)} gets</span> ${names(gives)}${net(gives, gets)}</div>
      <div class="trade-meta">GW ${t.gw} · ${ago(t.at)}</div>
    </div>`;
  });
  return card({ title: 'Trades', body: rows.length ? rows.join('') : empty('No trades yet') });
}

function waiverOrderCard() {
  const rows = D.transfers.waiverOrder.map((id, i) =>
    listRow({ rank: i + 1, lead: avatar(id, 24), title: first(id), meta: esc(mgr(id)!.team) }),
  );
  return card({ title: 'Waiver order', sub: `For gameweek ${D.meta.nextGw}`, body: `<div class="list">${rows.join('')}</div>` });
}

function hotPotatoesCard() {
  const potatoes = D.transfers.hotPotatoes.map((h) =>
    listRow({
      lead: photo(h.player),
      title: `${esc(player(h.player).name)} ${crest(player(h.player).club, 14)}`,
      meta: `Owned by ${h.owners.map((id) => first(id)).join(', ')}`,
      value: `<span class="stack">${h.owners.map((id) => avatar(id)).join('')}</span>`,
    }),
  );
  const dropped = D.transfers.mostDropped.map((d) =>
    listRow({
      lead: photo(d.player),
      title: `${esc(player(d.player).name)} ${crest(player(d.player).club, 14)}`,
      meta: `${player(d.player).total} pts this season`,
      value: `${d.times}×`,
    }),
  );
  return card({
    title: 'Hot potatoes',
    sub: 'Players who have been passed around',
    body: `${potatoes.length ? `<div class="list">${potatoes.join('')}</div>` : empty('Nobody has changed hands yet')}
      <div class="date-head"><span>Most dropped</span></div><div class="list">${dropped.join('')}</div>`,
  });
}
