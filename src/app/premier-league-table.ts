// The real Premier League's table, and its places that lead somewhere, which the draft
// league's parallel table shares.

import type { ClubRow, PlMatch } from '../shared/data.ts';
import { clubCell } from './components.ts';
import { esc, signed } from './format.ts';
import { href } from './router.ts';
import { D } from './state.ts';
import { dataTable, FORM_WIDTH, legendItems, numCol, posCol, resultOf, type Column } from './table.ts';

// The Premier League's places that lead somewhere, and their colours.
export const PL_LEGEND: [string, string][] = [
  ['var(--qual-top)', 'Champions League'],
  ['var(--qual-europe)', 'Europa League'],
  ['var(--qual-bottom)', 'Relegation'],
];

export const plZone = (rank: number) =>
  rank <= 4 ? 'var(--qual-top)' : rank === 5 ? 'var(--qual-europe)' : rank >= 18 ? 'var(--qual-bottom)' : null;

type ClubTableRow = { type: 'club' } & ClubRow;

// The real Premier League table, as fotmob.com's, with each club's last five results.
export function premierLeagueTable() {
  const rows: ClubTableRow[] = D.tables.premierLeague.map((c) => ({ type: 'club', ...c }));
  const cols: Column<ClubTableRow>[] = [
    posCol,
    {
      label: '',
      w: 'minmax(0,1fr)',
      cls: 'c-team',
      cell: (r) => `<a class="club-link" href="${href.pl('players', r.club)}">${clubCell(r.club)}</a>`,
    },
    numCol('PL', (r) => r.played),
    numCol('W', (r) => r.won, 'sm'),
    numCol('D', (r) => r.drawn, 'sm'),
    numCol('L', (r) => r.lost, 'sm'),
    { label: '+/-', w: '52px', from: 'md', cell: (r) => `${r.gf}-${r.ga}` },
    { label: 'GD', w: '32px', cell: (r) => signed(r.gf - r.ga) },
    { label: 'PTS', w: '30px', cls: 'c-pts', cell: (r) => r.pts },
    { label: 'Form', w: FORM_WIDTH, from: 'lg', cls: 'c-form', cell: (r) => clubForm(r.club) },
  ];
  return dataTable(cols, rows, { qual: (r) => plZone(r.rank) }) + `<div class="legend">${legendItems(PL_LEGEND)}</div>`;
}

function clubForm(club: number) {
  const last = (D.plMatches ?? []).filter((m) => m.done && m.score && (m.home === club || m.away === club)).slice(-5);
  return `<span class="form">${last.map((m) => formPill(m, club)).join('')}</span>`;
}

function formPill(m: PlMatch, club: number) {
  const [gf, ga] = m.home === club ? m.score! : [m.score![1], m.score![0]];
  const res = resultOf(gf, ga);
  const tip = `GW ${m.gw}: ${D.clubs[m.home]?.short} ${m.score![0]}-${m.score![1]} ${D.clubs[m.away]?.short}`;
  return `<a class="pill ${res}" href="${href.plMatch(m.id)}" data-tip="${esc(tip)}">${res}</a>`;
}
