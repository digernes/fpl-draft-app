// Data tables: a fotmob-style grid with container-query column hiding, the columns
// most tables share, and the rows sliding to their new places when a table reorders.

import type { Result } from '../shared/data.ts';
import { managerCell } from './components.ts';
import { esc, sum } from './format.ts';
import { state } from './state.ts';

export type Breakpoint = 'xs' | 'sm' | 'md' | 'lg';
type Width = string | Record<Breakpoint, string>;
export type Cell = string | number | undefined;

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
export interface Keyed {
  type?: string;
  id?: number;
  club?: number;
}

const BREAKPOINTS: Breakpoint[] = ['xs', 'sm', 'md', 'lg']; // <380, ≥380, ≥550, ≥768px of table width

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
  const { shown, minWidth } = full ? fullColumns(cols) : { shown: cols, minWidth: 0 };
  const head = shown.map((col) => tableCell(col, col.tip ? `<span data-tip="${esc(col.tip)}">${col.label}</span>` : col.label)).join('');
  const body = rows.map((row) => tableRow(row, shown, qual(row), rowClass(row))).join('');
  const table = `<div class="ftable${full ? ' full' : ''}" style="${gridTemplates(shown)}${full ? `;min-width:${minWidth}px` : ''}"><div class="trow thead">${head}</div>${body}</div>`;
  return full ? `<div class="table-scroll">${table}</div>` : table;
}

function fullColumns<R>(cols: Column<R>[]): { shown: Column<R>[]; minWidth: number } {
  const kept = cols.filter((c) => !c.until);
  // The desktop widths, except that on a phone, where the table scrolls, the position
  // keeps the narrow table's (controls.css sets --pos-w).
  const phone = (c: Column<R>) => (typeof c.w === 'object' ? (c.cls === 'c-pos' ? c.w.xs : c.w.lg) : c.w);
  // Wide enough for that: fixed columns, 12px gaps, 24px end padding and ~100px for the
  // manager column (avatar and first name: phones leave the team name out); never under
  // 560px so the form pills get desktop gaps.
  const minWidth = Math.max(
    560,
    sum(kept.map((c) => (/^\d+px$/.test(phone(c)) ? parseInt(phone(c), 10) : 100))) + 12 * (kept.length - 1) + 24,
  );
  const desktop = (c: Column<R>) => (typeof c.w === 'object' ? (c.cls === 'c-pos' ? `var(--pos-w, ${c.w.lg})` : c.w.lg) : c.w);
  return { minWidth, shown: kept.map((c): Column<R> => ({ ...c, from: 'xs', w: desktop(c) })) };
}

// Column widths are plain values or one per breakpoint. They are resolved here rather
// than with CSS variables, because a var() inside --cols-* would resolve on the table,
// not on the row where the container query applies.
function gridTemplates<R>(cols: Column<R>[]) {
  const visible = (col: Column<R>, bp: Breakpoint) => {
    const i = BREAKPOINTS.indexOf(bp);
    return BREAKPOINTS.indexOf(col.from ?? 'xs') <= i && i <= BREAKPOINTS.indexOf(col.until ?? 'lg');
  };
  const width = (col: Column<R>, bp: Breakpoint) => (typeof col.w === 'object' ? col.w[bp] : col.w);
  return BREAKPOINTS.map(
    (bp) =>
      `--cols-${bp}:${cols
        .filter((c) => visible(c, bp))
        .map((c) => width(c, bp))
        .join(' ')}`,
  ).join(';');
}

const tableCell = <R>(col: Column<R>, content: Cell) =>
  `<div class="tc ${col.cls ?? ''} from-${col.from ?? 'xs'}${col.until ? ` until-${col.until}` : ''}">${content}</div>`;

// A manager's row opens their team's page; the team the visitor follows stands out.
function tableRow<R extends Keyed>(row: R, cols: Column<R>[], q: string | null | undefined, cls: string) {
  const manager = row.type !== 'club' && row.id != null;
  const open = manager ? ` data-action="manager" data-value="${row.id}"` : '';
  const mine = manager && row.id === state.myTeam ? ' mine' : '';
  return `<div class="trow ${cls}${mine}${q ? ' qual' : ''}" data-key="${rowKey(row)}"${open}${q ? ` style="--qual:${q}"` : ''}>${cols.map((col) => tableCell(col, col.cell(row))).join('')}</div>`;
}

// The position gets 24px after its padding (8/16/24px), enough for "20" in DM Sans.
export const posCol: Column<{ rank: number }> = {
  label: '#',
  w: { xs: '32px', sm: '40px', md: '40px', lg: '48px' },
  cls: 'c-pos',
  cell: (r) => r.rank,
};
// Five 24px pills with 6px gaps, or 12px gaps from 550px.
export const FORM_WIDTH = { xs: '144px', sm: '144px', md: '168px', lg: '168px' };
export const managerCol: Column<{ id: number }> = { label: '', w: 'minmax(0,1fr)', cls: 'c-team', cell: (r) => managerCell(r.id) };
export const numCol = <R>(label: string, value: (row: R) => Cell, from?: Breakpoint, extra: Partial<Column<R>> = {}): Column<R> => ({
  label,
  w: '27px',
  from,
  cell: value,
  ...extra,
});

export const resultOf = (pf: number, pa: number): Result => (pf > pa ? 'W' : pf < pa ? 'L' : 'D');

export const legendItems = (legend: [string, string][]) =>
  legend.map(([color, label]) => `<span class="legend-item"><i style="background:${color}"></i>${label}</span>`).join('');

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
