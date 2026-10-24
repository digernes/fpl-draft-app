// Data tables (fotmob-style grid with container-query column hiding) and the table views.

import type { ClubRow, FormRow, LuckRow, Match, OverallRow, PointsRow, Simulation, XgRow } from '../shared/data.ts';
import {
  avatar,
  clubCell,
  formPills,
  infoButton,
  managerCell,
  markedHeader,
  PRIZE_MARKS,
  rankDelta,
  seg,
  simCell,
  withDiff,
} from './components.ts';
import { esc, ordinal, plural, signed, sum } from './format.ts';
import { first, isLive } from './lookups.ts';
import { href } from './router.ts';
import { D, state } from './state.ts';

type Breakpoint = 'xs' | 'sm' | 'md' | 'lg';
type Width = string | Record<Breakpoint, string>;
type Cell = string | number | undefined;

export interface Column<R> {
  label: string;
  w: Width;
  cls?: string;
  from?: Breakpoint;
  until?: Breakpoint;
  tip?: string;
  cell: (row: R) => Cell;
}

/** What a row needs for its key: a manager id, or a club in the merged table. */
interface Keyed {
  type?: string;
  id?: number;
  club?: number;
}

const BREAKPOINTS: Breakpoint[] = ['xs', 'sm', 'md', 'lg']; // <380, ≥380, ≥550, ≥768px of table width

// Column widths are plain values or one per breakpoint. They are resolved here rather
// than with CSS variables, because a var() inside --cols-* would resolve on the table,
// not on the row where the container query applies.
const rowKey = (row: Keyed) => (row.type === 'club' ? `club-${row.club}` : `m-${row.id}`);

interface TableOptions<R> {
  rowClass?: (row: R) => string;
  qual?: (row: R) => string | null | undefined;
  full?: boolean;
}

// `full` shows every desktop column whatever the width (narrow-only columns aside), in a
// box that scrolls sideways, like fotmob.com's Full table on a phone.
export function dataTable<R extends Keyed>(
  cols: Column<R>[],
  rows: R[],
  { rowClass = () => '', qual = () => null, full = false }: TableOptions<R> = {},
) {
  let minWidth = 0;
  if (full) {
    cols = cols.filter((c) => !c.until);
    // The desktop widths, except that on a phone, where the table scrolls, the position
    // keeps the narrow table's (controls.css sets --pos-w).
    const phone = (c: Column<R>) => (typeof c.w === 'object' ? (c.cls === 'c-pos' ? c.w.xs : c.w.lg) : c.w);
    // Wide enough for that: fixed columns, 12px gaps, 24px end padding and ~100px for the
    // manager column (avatar and first name: phones leave the team name out); never under
    // 560px so the form pills get desktop gaps.
    minWidth = Math.max(560, sum(cols.map((c) => (/^\d+px$/.test(phone(c)) ? parseInt(phone(c), 10) : 100))) + 12 * (cols.length - 1) + 24);
    cols = cols.map((c) => ({
      ...c,
      from: 'xs',
      w: typeof c.w === 'object' ? (c.cls === 'c-pos' ? `var(--pos-w, ${c.w.lg})` : c.w.lg) : c.w,
    }));
  }
  const visible = (col: Column<R>, bp: Breakpoint) => {
    const i = BREAKPOINTS.indexOf(bp);
    return BREAKPOINTS.indexOf(col.from ?? 'xs') <= i && i <= BREAKPOINTS.indexOf(col.until ?? 'lg');
  };
  const width = (col: Column<R>, bp: Breakpoint) => (typeof col.w === 'object' ? col.w[bp] : col.w);
  const templates = BREAKPOINTS.map(
    (bp) =>
      `--cols-${bp}:${cols
        .filter((c) => visible(c, bp))
        .map((c) => width(c, bp))
        .join(' ')}`,
  ).join(';');
  const cell = (col: Column<R>, content: Cell) =>
    `<div class="tc ${col.cls ?? ''} from-${col.from ?? 'xs'}${col.until ? ` until-${col.until}` : ''}">${content}</div>`;
  const head = cols.map((col) => cell(col, col.tip ? `<span data-tip="${esc(col.tip)}">${col.label}</span>` : col.label)).join('');
  const body = rows
    .map((row) => {
      const q = qual(row);
      // A manager's row opens their team's page; the team the visitor follows stands out.
      const open = row.type !== 'club' && row.id != null ? ` data-action="manager" data-value="${row.id}"` : '';
      const mine = row.type !== 'club' && row.id != null && row.id === state.myTeam ? ' mine' : '';
      return `<div class="trow ${rowClass(row)}${mine}${q ? ' qual' : ''}" data-key="${rowKey(row)}"${open}${q ? ` style="--qual:${q}"` : ''}>${cols.map((col) => cell(col, col.cell(row))).join('')}</div>`;
    })
    .join('');
  const table = `<div class="ftable${full ? ' full' : ''}" style="${templates}${full ? `;min-width:${minWidth}px` : ''}"><div class="trow thead">${head}</div>${body}</div>`;
  return full ? `<div class="table-scroll">${table}</div>` : table;
}

// The position gets 24px after its padding (8/16/24px), enough for "20" in DM Sans.
export const posCol: Column<{ rank: number }> = {
  label: '#',
  w: { xs: '32px', sm: '40px', md: '40px', lg: '48px' },
  cls: 'c-pos',
  cell: (r) => r.rank,
};
// Five 24px pills with 6px gaps, or 12px gaps from 550px.
const FORM_WIDTH = { xs: '144px', sm: '144px', md: '168px', lg: '168px' };
export const managerCol: Column<{ id: number }> = { label: '', w: 'minmax(0,1fr)', cls: 'c-team', cell: (r) => managerCell(r.id) };
const numCol = <R>(label: string, value: (row: R) => Cell, from?: Breakpoint, extra: Partial<Column<R>> = {}): Column<R> => ({
  label,
  w: '27px',
  from,
  cell: value,
  ...extra,
});

interface LiveMatch {
  pf: number;
  pa: number;
  match: Match;
}

// The match being played, as it stands; it opens the match.
function livePill(live: LiveMatch | undefined) {
  if (!live) return '';
  const res = live.pf > live.pa ? 'W' : live.pf < live.pa ? 'L' : 'D';
  return `<a class="livep ${res}" href="${href.match(live.match)}">${live.pf}-${live.pa}</a>`;
}

// The next opponent, a link to that match.
function nextLink(r: StandingRow) {
  if (!r.next) return '';
  const m = D.matches.find((x) => x.gw === r.next!.gw && (x.home === r.id || x.away === r.id));
  return m ? `<a href="${href.match(m)}">${avatar(r.next.opp)}</a>` : avatar(r.next.opp);
}

export interface TableFromRow {
  id: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  pf: number;
  pa: number;
  pts: number;
  rank: number;
  liveMatch?: LiveMatch;
}

type StandingRow = (OverallRow | FormRow) & { liveMatch?: LiveMatch };

// The table as it would stand if every live score ended as it is now (fotmob.com's
// live table): finished matches plus the ones being played.
function liveStandings(): StandingRow[] {
  const official = new Map(D.tables.overall.map((r) => [r.id, r]));
  return tableFrom(D.matches.filter((x) => x.started)).map((r) => ({ ...official.get(r.id)!, ...r }));
}

// Standings from a set of matches, ranked like the real table: points, then points scored.
export function tableFrom(matches: Match[]): TableFromRow[] {
  const { win, draw, loss } = D.meta.scoring;
  const rows = new Map<number, Omit<TableFromRow, 'rank'>>(
    D.managers.map((m) => [m.id, { id: m.id, played: 0, won: 0, drawn: 0, lost: 0, pf: 0, pa: 0, pts: 0 }]),
  );
  for (const m of matches) {
    const sides = [
      [m.home, m.homePts, m.awayPts],
      [m.away, m.awayPts, m.homePts],
    ] as [number, number, number][];
    for (const [id, pf, pa] of sides) {
      const r = rows.get(id);
      if (!r) continue;
      r.played++;
      r.pf += pf;
      r.pa += pa;
      if (pf > pa) [r.won, r.pts] = [r.won + 1, r.pts + win];
      else if (pf === pa) [r.drawn, r.pts] = [r.drawn + 1, r.pts + draw];
      else [r.lost, r.pts] = [r.lost + 1, r.pts + loss];
      if (!m.finished) r.liveMatch = { pf, pa, match: m };
    }
  }
  return [...rows.values()].sort((a, b) => b.pts - a.pts || b.pf - a.pf).map((r, i) => ({ ...r, rank: i + 1 }));
}

const standingsCols = (): Column<StandingRow>[] => {
  const formMode = state.tableMode === 'form';
  const liveCol: Column<StandingRow> = {
    label: 'Live',
    w: '52px',
    tip: 'This gameweek’s score so far',
    cell: (r) => livePill(r.liveMatch),
  };
  return [
    posCol,
    managerCol,
    ...(state.tableView === 'overall' && isLive() ? [liveCol] : []),
    numCol('PL', (r) => r.played, formMode ? 'md' : 'xs'),
    numCol('W', (r) => r.won, 'lg'),
    numCol('D', (r) => r.drawn, 'lg'),
    numCol('L', (r) => r.lost, 'lg'),
    { label: '+/-', w: '64px', from: formMode ? 'md' : 'sm', tip: 'Points scored – conceded', cell: (r) => `${r.pf}-${r.pa}` },
    { label: 'GD', w: '36px', from: formMode ? 'md' : 'xs', tip: 'Points difference', cell: (r) => signed(r.pf - r.pa) },
    { label: 'PTS', w: '30px', cls: 'c-pts', cell: (r) => r.pts },
    { label: 'Form', w: FORM_WIDTH, from: formMode ? 'xs' : 'md', cls: 'c-form', cell: (r) => formPills(r.form) },
    { label: 'Next', w: '28px', from: 'lg', cell: nextLink },
  ];
};

// Phones: Short (the columns that fit), Form (pills instead of numbers, standings only)
// or Full (the desktop table, scrolling sideways).
const hasFormMode = (viewId: string) => ['overall', 'form'].includes(viewId);
export function tableModeToggle(viewId: string, cls = '') {
  const options: [string, string][] = [
    ['short', 'Short'],
    ...(hasFormMode(viewId) ? [['form', 'Form'] as [string, string]] : []),
    ['full', 'Full'],
  ];
  const current = state.tableMode === 'form' && !hasFormMode(viewId) ? 'short' : state.tableMode;
  return `<div class="narrow-only ${cls}">${seg('table-mode', options, current)}</div>`;
}

// The simulation's formula with this season's numbers, for the (i) by the legend.
function simulationFormula() {
  const m = D.simulation.model;
  // Every gameweek left has its own unless FPL's fixtures for the later ones were missing.
  const weeks =
    m.projected > D.meta.lastGw - D.meta.nextGw
      ? 'each gameweek’s own'
      : m.projected === 1
        ? 'the next gameweek’s, and the same after'
        : `each of the next ${m.projected} gameweeks’ own, then their average`;
  return [
    'Each simulated week, a manager scores:',
    `league average (${m.leagueAverage})`,
    m.projected ? `+ how far their projected XI sits from the average one (${weeks})` : null,
    `+ their level for this run (typically ±${m.levelSpread} a week)`,
    `+ that week’s randomness (typically ±${m.spread}, ±${m.laterSpread} after next week)`,
    '',
    'A projected XI is the best one their squad can field, by the site’s expected points. Higher score wins 3 points, level scores draw. Equal points split on points scored.',
  ]
    .filter((line) => line !== null)
    .join('\n');
}

type SimRow = Simulation['rows'][number];

function simulationCols(): Column<SimRow>[] {
  const positions = D.simulation.rows[0]?.positions.length ?? 0;
  return [
    posCol,
    managerCol,
    { label: 'PTS', w: '44px', cls: 'c-pts', tip: 'Average final points across the simulations', cell: (r) => Math.round(r.pts) },
    ...Array.from({ length: positions }, (_, i): Column<SimRow> => ({
      label: markedHeader(ordinal(i + 1), PRIZE_MARKS[i + 1] ?? (i === positions - 1 ? 'var(--qual-bottom)' : null)),
      w: '44px',
      from: 'md',
      tip: `How often they finish ${ordinal(i + 1)}`,
      cell: (r) => simCell(r.positions[i]),
    })),
    // Narrow tables get the three that matter instead of the full grid.
    {
      label: markedHeader('1st', 'var(--qual-top)'),
      w: '48px',
      until: 'sm',
      tip: 'How often they win the league',
      cell: (r) => simCell(r.positions[0]),
    },
    {
      label: 'Top 2',
      w: '52px',
      until: 'sm',
      tip: 'How often they finish in the prize places',
      cell: (r) => simCell(r.positions[0] + r.positions[1]),
    },
    {
      label: markedHeader('Last', 'var(--qual-bottom)'),
      w: '48px',
      until: 'sm',
      tip: 'How often they finish last',
      cell: (r) => simCell(r.positions.at(-1) as number),
    },
  ];
}

interface TableView<R> {
  label: string;
  rows: () => R[];
  cols: () => Column<R>[];
  qual?: (row: R, rows: R[]) => string | null;
  rowClass?: (row: R) => string;
  legend?: [string, string][];
  info?: () => string;
  note?: () => string;
}

// Each view's rows have their own shape, so the table only leaves here rendered.
interface TableExtras {
  /** Teams to pick out (a team's page, a match's). */
  highlight?: number[];
  /** The legend and notes under the table; a sidebar leaves them out. */
  legend?: boolean;
}

interface RenderedView {
  label: string;
  render: (extras: TableExtras) => string;
}

const tableView = <R extends Keyed>(view: TableView<R>): RenderedView => ({
  label: view.label,
  render: (highlight) => renderTable(view, highlight),
});

type ParallelRow = ({ type: 'club' } & ClubRow) | ({ type: 'manager'; wouldBe: number | undefined } & OverallRow);

export const TABLE_VIEWS: Record<string, RenderedView> = {
  overall: tableView<StandingRow>({
    label: 'All',
    rows: () => (isLive() ? liveStandings() : D.tables.overall),
    cols: standingsCols,
    qual: (r, rows) =>
      r.rank === 1 ? 'var(--qual-top)' : r.rank === 2 ? 'var(--qual-europe)' : r.rank === rows.length ? 'var(--qual-bottom)' : null,
    legend: [
      ['var(--qual-top)', '1st prize'],
      ['var(--qual-europe)', '2nd prize'],
      ['var(--qual-bottom)', 'Penalty to be decided'],
    ],
  }),
  form: tableView<StandingRow>({
    label: 'Form',
    rows: () => D.tables.form,
    cols: standingsCols,
    note: () => `Table over the last ${D.meta.formLength} gameweeks`,
  }),
  xg: tableView<XgRow>({
    label: 'xG',
    rows: () => D.tables.xg,
    cols: () => [
      posCol,
      { label: '', w: '40px', from: 'md', cell: rankDelta },
      managerCol,
      numCol('PL', (r) => r.played, 'sm'),
      {
        label: 'xPF',
        w: '72px',
        from: 'sm',
        tip: 'Expected points for: your XIs with goals, assists and clean sheets swapped for what the xG, xA and xGC were worth',
        cell: (r) => withDiff(Math.round(r.xpf), r.pf - r.xpf, `${r.xpf} expected, ${r.pf} scored`),
      },
      {
        label: 'xPA',
        w: '72px',
        from: 'md',
        tip: 'Expected points against: the same for your opponents, in their games against you',
        cell: (r) => withDiff(Math.round(r.xpa), r.pa - r.xpa, `${r.xpa} expected, ${r.pa} conceded`, { lowerIsGood: true }),
      },
      {
        label: 'xPTS',
        w: '60px',
        cls: 'c-pts',
        tip: 'Table points both sides’ expected scores would have earned',
        cell: (r) => withDiff(Math.round(r.xPts), r.pts - r.xPts, `${r.xPts} expected, ${r.pts} actual`),
      },
    ],
    note: () =>
      'Like FotMob’s xG table: goals, assists and clean sheets are swapped for their expected values. The small numbers are actual minus expected, green when it went your way.',
  }),
  luck: tableView<LuckRow>({
    label: 'Luck',
    rows: () => D.tables.luck,
    cols: () => [
      posCol,
      { label: '', w: '40px', from: 'md', cell: rankDelta },
      managerCol,
      numCol('PL', (r) => r.played, 'sm'),
      numCol('W', (r) => r.won, 'md', { tip: 'Weeks above the league average' }),
      numCol('D', (r) => r.drawn, 'md', { tip: 'Weeks exactly on the league average' }),
      numCol('L', (r) => r.lost, 'md', { tip: 'Weeks below the league average' }),
      {
        label: '+/-',
        w: '48px',
        from: 'sm',
        tip: 'Points scored above the league average, all season',
        cell: (r) => signed(Math.round(r.above)),
      },
      {
        label: 'PTS',
        w: '60px',
        cls: 'c-pts',
        tip: 'Points if you’d played the league average every week. The small number is your real points minus these.',
        cell: (r) => withDiff(r.avgPts, r.luck, `${r.avgPts} against the average, ${r.pts} in the real table`),
      },
    ],
    note: () =>
      'Every week played against the league average: score above it for a win. The small number is your real points minus these, green when the fixture list helped you.',
  }),
  sim: tableView<SimRow>({
    label: 'Simulated',
    rows: () => D.simulation.rows,
    cols: simulationCols,
    legend: [
      ['var(--qual-top)', '1st prize'],
      ['var(--qual-europe)', '2nd prize'],
      ['var(--qual-bottom)', 'Penalty to be decided'],
    ],
    info: simulationFormula,
    note: () =>
      D.simulation.gameweeksLeft
        ? `The rest of the season played ${D.simulation.runs.toLocaleString()} times: ${plural(D.simulation.gameweeksLeft, 'gameweek')} to go. Each week’s scores are drawn around each side’s projected XI, the same way the odds are made, and ties on points go to points scored.`
        : 'The season is over, so these are the final positions.',
  }),
  points: tableView<PointsRow>({
    label: 'Total points',
    rows: () => D.tables.points,
    cols: () => [
      posCol,
      managerCol,
      { label: 'Avg', w: '40px', from: 'sm', tip: 'Average gameweek score', cell: (r) => r.avg },
      { label: 'High', w: '36px', from: 'md', cell: (r) => r.high },
      { label: 'Low', w: '36px', from: 'md', cell: (r) => r.low },
      { label: 'Bench', w: '44px', from: 'lg', tip: 'Points left on the bench', cell: (r) => r.bench },
      { label: 'PTS', w: '40px', cls: 'c-pts', tip: 'Total fantasy points', cell: (r) => r.total },
    ],
    note: () => 'Ranked on fantasy points scored, as if this were a classic league',
  }),
  parallel: tableView<ParallelRow>({
    label: 'PL parallel',
    rows: parallelRows,
    cols: () => [
      {
        ...posCol,
        cell: (r) => (r.type === 'club' ? r.rank : `<span class="muted" data-tip="Where ${first(r.id)} would sit">${r.wouldBe}</span>`),
      },
      { label: '', w: 'minmax(0,1fr)', cls: 'c-team', cell: (r) => (r.type === 'club' ? clubCell(r.club) : managerCell(r.id)) },
      numCol('PL', (r) => r.played),
      numCol('W', (r) => r.won, 'lg'),
      numCol('D', (r) => r.drawn, 'lg'),
      numCol('L', (r) => r.lost, 'lg'),
      { label: '+/-', w: '52px', from: 'sm', cell: (r) => (r.type === 'club' ? `${r.gf}-${r.ga}` : '–') },
      { label: 'GD', w: '32px', cell: (r) => (r.type === 'club' ? signed(r.gf - r.ga) : '–') },
      { label: 'PTS', w: '30px', cls: 'c-pts', cell: (r) => r.pts },
    ],
    rowClass: (r) => (r.type === 'manager' ? 'featured' : ''),
    qual: (r) =>
      r.type !== 'club'
        ? null
        : r.rank <= 4
          ? 'var(--qual-top)'
          : r.rank === 5
            ? 'var(--qual-europe)'
            : r.rank >= 18
              ? 'var(--qual-bottom)'
              : null,
    legend: [
      ['var(--qual-top)', 'Champions League'],
      ['var(--qual-europe)', 'Europa League'],
      ['var(--qual-bottom)', 'Relegation'],
      ['var(--featured-key)', 'Draft manager'],
    ],
    note: () => 'The real Premier League table with each manager dropped in on their H2H points',
  }),
};

type ClubTableRow = { type: 'club' } & ClubRow;

// The real Premier League table, as fotmob.com's, with each club's last five results.
export function premierLeagueTable() {
  const rows: ClubTableRow[] = D.tables.premierLeague.map((c) => ({ type: 'club', ...c }));
  const form = (club: number) => {
    const last = (D.plMatches ?? []).filter((m) => m.done && m.score && (m.home === club || m.away === club)).slice(-5);
    return `<span class="form">${last
      .map((m) => {
        const [gf, ga] = m.home === club ? m.score! : [m.score![1], m.score![0]];
        const res = gf > ga ? 'W' : gf < ga ? 'L' : 'D';
        const tip = `GW ${m.gw}: ${D.clubs[m.home]?.short} ${m.score![0]}-${m.score![1]} ${D.clubs[m.away]?.short}`;
        return `<a class="pill ${res}" href="${href.plMatch(m.id)}" data-tip="${esc(tip)}">${res}</a>`;
      })
      .join('')}</span>`;
  };
  const cols: Column<ClubTableRow>[] = [
    posCol,
    { label: '', w: 'minmax(0,1fr)', cls: 'c-team', cell: (r) => clubCell(r.club) },
    numCol('PL', (r) => r.played),
    numCol('W', (r) => r.won, 'sm'),
    numCol('D', (r) => r.drawn, 'sm'),
    numCol('L', (r) => r.lost, 'sm'),
    { label: '+/-', w: '52px', from: 'md', cell: (r) => `${r.gf}-${r.ga}` },
    { label: 'GD', w: '32px', cell: (r) => signed(r.gf - r.ga) },
    { label: 'PTS', w: '30px', cls: 'c-pts', cell: (r) => r.pts },
    { label: 'Form', w: FORM_WIDTH, from: 'lg', cls: 'c-form', cell: (r) => form(r.club) },
  ];
  const qual = (r: ClubTableRow) =>
    r.rank <= 4 ? 'var(--qual-top)' : r.rank === 5 ? 'var(--qual-europe)' : r.rank >= 18 ? 'var(--qual-bottom)' : null;
  const legend = `<div class="legend">${[
    ['var(--qual-top)', 'Champions League'],
    ['var(--qual-europe)', 'Europa League'],
    ['var(--qual-bottom)', 'Relegation'],
  ]
    .map(([color, label]) => `<span class="legend-item"><i style="background:${color}"></i>${label}</span>`)
    .join('')}</div>`;
  return dataTable(cols, rows, { qual }) + legend;
}

function parallelRows(): ParallelRow[] {
  const clubs = D.tables.premierLeague.map((c) => ({ type: 'club' as const, ...c }));
  const people = D.tables.overall.map((r) => ({ type: 'manager' as const, ...r, wouldBe: D.plTwins.find((t) => t.id === r.id)?.wouldBe }));
  return [...clubs, ...people].sort((a, b) => b.pts - a.pts || (a.type === b.type ? a.rank - b.rank : a.type === 'club' ? -1 : 1));
}

/** One of the table views. */
export function standingsTable(viewId: string, extras: TableExtras = {}) {
  return TABLE_VIEWS[viewId].render(extras);
}

function renderTable<R extends Keyed>(view: TableView<R>, { highlight = [], legend: withLegend = true }: TableExtras) {
  const rows = view.rows();
  const table = dataTable(view.cols(), rows, {
    rowClass: (r) => `${view.rowClass?.(r) ?? ''}${r.type !== 'club' && highlight.includes(r.id!) ? ' featured' : ''}`,
    qual: (r) => view.qual?.(r, rows),
    full: state.tableMode === 'full',
  });
  if (!withLegend) return table;
  const info = view.info ? infoButton(view.info(), 'How this is worked out') : '';
  const legend =
    view.legend || info
      ? `<div class="legend">${(view.legend ?? []).map(([color, label]) => `<span class="legend-item"><i style="background:${color}"></i>${label}</span>`).join('')}${info}</div>`
      : '';
  const note = view.note ? `<div class="table-note">${view.note()}</div>` : '';
  return table + legend + note;
}

// FotMob's table reorder (its AnimatedList, which replaced FlipMove): rows that stay
// slide from their old spot over 350ms ease-in-out, each 20ms slower than the row
// above; rows that appear or disappear just do so.
export function withRowMoves(render: () => void) {
  const rows = () => [...document.querySelectorAll<HTMLElement>('.ftable .trow[data-key]')];
  const before = new Map(rows().map((row) => [row.dataset.key, row.getBoundingClientRect().top]));
  render();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  rows().forEach((row, i) => {
    const top = before.get(row.dataset.key);
    const dy = top == null ? 0 : top - row.getBoundingClientRect().top;
    if (dy) row.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 350 + i * 20, easing: 'ease-in-out' });
  });
}
