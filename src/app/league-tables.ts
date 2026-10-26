// The draft league's table views (overall, form, xG, luck, simulated, total points and the
// Premier League parallel), rendered with their legends and notes, and the phones' mode toggle.

import type { ClubRow, LuckRow, OverallRow, PointsRow, XgRow } from '../shared/data.ts';
import { clubCell, formPills, infoButton, managerCell, rankDelta, seg, withDiff } from './components.ts';
import { plural, signed } from './format.ts';
import { first, isLive, isSettling } from './lookups.ts';
import { PL_LEGEND, plZone } from './premier-league-table.ts';
import { simulationCols, simulationFormula, type SimRow } from './simulation-table.ts';
import { liveDot, livePill, liveStandings, nextLink, type StandingRow } from './standings.ts';
import { D, state } from './state.ts';
import { dataTable, FORM_WIDTH, legendItems, managerCol, numCol, posCol, type Column, type Keyed } from './table.ts';

// `live`: a column for the matches being played, the overall table's while a gameweek is
// played, whichever view the Table tab shows (the front page's and a team's tables are overall).
const standingsCols = ({ compact = false }: TableExtras, live: boolean): Column<StandingRow>[] => {
  const formMode = state.tableMode === 'form' && !compact;
  const liveCol: Column<StandingRow> = compact
    ? { label: '', w: '16px', cell: (r) => liveDot(r.id, r.liveMatch) }
    : { label: 'Live', w: '52px', tip: 'This gameweek’s score so far', cell: (r) => livePill(r.liveMatch) };
  return [
    posCol,
    managerCol,
    ...(live ? [liveCol] : []),
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

interface TableView<R> {
  label: string;
  rows: () => R[];
  cols: (extras: TableExtras) => Column<R>[];
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
  /**
   * The front page's narrow column: the Short columns whatever the phones' table mode (the
   * Full table's 560px and the Form pills don't fit beside the round), no legend or notes, and
   * while a gameweek is played a dot for how each team's match stands rather than its score.
   */
  compact?: boolean;
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
    cols: (extras) => standingsCols(extras, isLive() && !isSettling()),
    note: () => (isSettling() ? `With gameweek ${D.meta.currentGw}’s provisional points` : ''),
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
    cols: (extras) => standingsCols(extras, false),
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
      numCol('PL', (r) => r.played, 'sm', { tip: 'Weeks played' }),
      numCol('W', (r) => r.won, 'md', { tip: 'Wins against every other team’s score, week by week' }),
      numCol('D', (r) => r.drawn, 'md', { tip: 'Draws against every other team’s score, week by week' }),
      numCol('L', (r) => r.lost, 'md', { tip: 'Defeats against every other team’s score, week by week' }),
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
        tip: 'Points if you’d played every other team every week, a match against each worth its share of the week. The small number is your real points minus these.',
        cell: (r) => withDiff(Math.round(r.avgPts), r.luck, `${r.avgPts} against everyone, ${r.pts} in the real table`),
      },
    ],
    note: () =>
      'Every week played against each of the other teams, a share of the week each: beating five of seven is five sevenths of a win. The small number is your real points minus these, green when the fixture list helped you.',
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
    qual: (r) => (r.type !== 'club' ? null : plZone(r.rank)),
    legend: [...PL_LEGEND, ['var(--featured-key)', 'Draft manager']],
    note: () => 'The real Premier League table with each manager dropped in on their H2H points',
  }),
};

function parallelRows(): ParallelRow[] {
  const clubs = D.tables.premierLeague.map((c) => ({ type: 'club' as const, ...c }));
  const people = D.tables.overall.map((r) => ({ type: 'manager' as const, ...r, wouldBe: D.plTwins.find((t) => t.id === r.id)?.wouldBe }));
  return [...clubs, ...people].sort((a, b) => b.pts - a.pts || (a.type === b.type ? a.rank - b.rank : a.type === 'club' ? -1 : 1));
}

/** One of the table views. */
export function standingsTable(viewId: string, extras: TableExtras = {}) {
  return TABLE_VIEWS[viewId].render(extras);
}

function renderTable<R extends Keyed>(view: TableView<R>, extras: TableExtras) {
  const { highlight = [], compact = false } = extras;
  const rows = view.rows();
  const table = dataTable(view.cols(extras), rows, {
    rowClass: (r) => `${view.rowClass?.(r) ?? ''}${r.type !== 'club' && highlight.includes(r.id!) ? ' featured' : ''}`,
    qual: (r) => view.qual?.(r, rows),
    full: state.tableMode === 'full' && !compact,
  });
  if (compact) return table;
  const info = view.info ? infoButton(view.info(), 'How this is worked out') : '';
  const legend = view.legend || info ? `<div class="legend">${legendItems(view.legend ?? [])}${info}</div>` : '';
  const note = view.note?.() ? `<div class="table-note">${view.note()}</div>` : '';
  return table + legend + note;
}
