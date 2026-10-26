// The Table tab: every table view, the Premier League twins and luck.

import { avatar, card, chip, crest, listRow } from '../components.ts';
import type { LuckRow } from '../../shared/data.ts';
import { esc, ordinal, pct, plural, signed } from '../format.ts';
import { club, first } from '../lookups.ts';
import { href } from '../router.ts';
import { D, state } from '../state.ts';
import { standingsTable, TABLE_VIEWS, tableModeToggle } from '../league-tables.ts';

export function viewTable() {
  const chips = Object.entries(TABLE_VIEWS)
    .map(([id, v]) => chip(v.label, 'table-view', id, state.tableView === id))
    .join('');
  return `<div class="cols">
    <div class="col">${card({ body: `<div class="filter-bar">${chips}</div>${tableModeToggle(state.tableView, 'table-tools')}${standingsTable(state.tableView)}` })}</div>
    <div class="col">${twinsCard()}${luckCard()}</div>
  </div>`;
}

function twinsCard() {
  const rows = D.plTwins.map((t) => {
    const row = D.tables.overall.find((r) => r.id === t.id)!;
    const twin = D.tables.premierLeague.find((c) => c.club === t.club)!;
    const also = t.also.length ? ` · level with ${t.also.map((c) => esc(club(c).short)).join(', ')}` : '';
    return listRow({
      lead: avatar(t.id, 32),
      title: `${first(t.id)} <span class="muted">${plural(row.pts, 'pt')}</span>`,
      meta: `${t.exact ? '' : 'Closest: '}${esc(club(t.club).name)}, ${ordinal(twin.rank)} with ${twin.pts}${also}`,
      value: crest(t.club, 28),
    });
  });
  return card({
    title: 'Parallel Premier League',
    sub: 'The club sitting on your points',
    body: `<div class="list twins">${rows.join('')}</div>`,
    footer: { href: href.league('table'), label: 'Merged table', attrs: ' data-action="table-view" data-value="parallel"' },
  });
}

function luckCard() {
  const rows = [...D.tables.luck].sort((a, b) => b.luck - a.luck || a.rank - b.rank);
  const meta = (r: LuckRow) =>
    `${r.pts} pts, ${Math.round(r.avgPts)} against everyone · beat ${pct(r.won / (r.won + r.drawn + r.lost || 1))} of the other teams`;
  return card({
    title: 'Luck',
    sub: 'Your real points against what you’d have playing every other team every week',
    body: `<div class="list">${rows
      .map((r) =>
        listRow({
          lead: avatar(r.id, 24),
          title: first(r.id),
          meta: meta(r),
          value: signed(Math.round(r.luck)),
        }),
      )
      .join('')}</div>`,
  });
}
