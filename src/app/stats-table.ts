// The table of player stats in a match's and the season's cards (pl-stats.ts): everyone's
// FPL numbers, a category at a time, sorted by any column.

import { PL_STATS, type PlStat } from '../shared/data.ts';
import { UNDERLYING_TIPS } from '../shared/underlying.ts';
import { onAction } from './actions.ts';
import { chip, crest, photo, tenths, xpTip } from './components.ts';
import { esc, sum } from './format.ts';
import { sortSvg } from './icons.ts';
import { modelParts, opponents, player } from './lookups.ts';
import { ownerPill } from './pitch.ts';
import { renderView } from './render.ts';
import { href } from './router.ts';
import { state } from './state.ts';
import type { Cells } from './stats-files.ts';

/** A player in the match, with what the page knows of him without the file: his side's club, minutes, points and owner. */
export interface StatsRow {
  pid: number;
  club: number;
  min: number;
  pts: number;
  owner: number | null;
  benched?: boolean;
  /** The match's gameweek, for the owner's pill to lead to his head-to-head in it. */
  gw?: number;
  /** A substitute who hasn't come on: nothing but noughts, at the bottom whatever the sort. */
  unused?: boolean;
  /** His xP and xCS (shared/underlying.ts), where they're known: no xCS where a clean sheet scores nothing for him. */
  xp?: number | null;
  xcs?: number | null;
  /** The site's projections for the gameweeks to come (PlSeasonStats' `projected`): each one's points, then over them all the rest. */
  ahead?: { points: number[]; minutes: number; goals: number; assists: number; cleanSheet: number; defcon: number; bonus: number };
}

interface Column {
  label: string;
  tip?: string;
  /** Decimal places. */
  digits?: number;
  /** What it sorts by. */
  value: (r: StatsRow, cells: Cells) => number | null;
  /** What it shows, when that's more than the value: two stats in one column. */
  text?: (r: StatsRow, cells: Cells) => string | null;
  /** A goalkeeper's stat: on a tie (the noughts, mostly) the keepers come first. */
  keepers?: boolean;
  /** Why it has none for him, when it's for a reason of its own rather than the table's. */
  why?: (r: StatsRow) => string | undefined;
}

const at = (name: PlStat) => (_: StatsRow, cells: Cells) => (cells ? cells[PL_STATS.indexOf(name)] : null);

// Two stats in one column, as "1 + 0", sorted by their sum.
function pair(label: string, a: PlStat, b: PlStat, digits = 0, tip?: string): Column {
  const both = (r: StatsRow, cells: Cells) => {
    const [x, y] = [at(a)(r, cells), at(b)(r, cells)];
    return x === null || y === null ? null : [x, y];
  };
  const shown = (v: number) => (v && digits ? v.toFixed(digits) : String(v));
  return {
    label,
    tip,
    value: (r, cells) => both(r, cells)?.reduce((t, v) => t + v) ?? null,
    text: (r, cells) => both(r, cells)?.map(shown).join(' + ') ?? null,
  };
}

export const COLUMNS: Record<string, Column> = {
  points: { label: 'Points', tip: 'FPL points', value: (r) => r.pts },
  minutes: { label: 'Minutes played', value: (r) => r.min },
  goals: { label: 'Goals', value: at('goals_scored') },
  assists: { label: 'Assists', value: at('assists') },
  xg: { label: 'xG', tip: 'Expected goals', digits: 2, value: at('expected_goals') },
  xa: { label: 'xA', tip: 'Expected assists', digits: 2, value: at('expected_assists') },
  xp: { label: 'xP', tip: UNDERLYING_TIPS.xp, digits: 1, value: (r) => r.xp ?? null },
  xcs: {
    label: 'xCS',
    tip: UNDERLYING_TIPS.xcs,
    digits: 2,
    value: (r) => r.xcs ?? null,
    why: (r) => (r.xp == null ? undefined : 'A clean sheet scores nothing for him'),
  },
  // The Projected category's, over the gameweeks to come (each one's points after the total: gwColumn).
  aheadTotal: {
    label: 'Total',
    tip: 'Projected points over the gameweeks shown',
    digits: 1,
    value: (r) => (r.ahead ? sum(r.ahead.points) : null),
  },
  aheadMinutes: { label: 'Minutes', tip: 'Projected minutes over the gameweeks shown', value: (r) => r.ahead?.minutes ?? null },
  aheadGoals: {
    label: 'Goals',
    tip: 'Projected goals over the gameweeks shown, his penalties too',
    digits: 2,
    value: (r) => r.ahead?.goals ?? null,
  },
  aheadAssists: {
    label: 'Assists',
    tip: 'Projected assists over the gameweeks shown, as FPL counts them',
    digits: 2,
    value: (r) => r.ahead?.assists ?? null,
  },
  aheadCleanSheet: {
    label: 'Clean sheet points',
    tip: 'Projected points from clean sheets over the gameweeks shown',
    digits: 1,
    value: (r) => r.ahead?.cleanSheet ?? null,
  },
  aheadDefcon: {
    label: 'Defcon points',
    tip: 'Projected points from defensive contributions over the gameweeks shown',
    digits: 1,
    value: (r) => r.ahead?.defcon ?? null,
  },
  aheadBonus: { label: 'Bonus', tip: 'Projected bonus points over the gameweeks shown', digits: 1, value: (r) => r.ahead?.bonus ?? null },
  goalsAssists: pair('Goals + assists', 'goals_scored', 'assists'),
  xgXa: pair('xG + xA', 'expected_goals', 'expected_assists', 2, 'Expected goals and expected assists'),
  defcon: {
    label: 'Defensive contributions',
    tip: 'Clearances, blocks, interceptions and tackles, and for a midfielder or forward his recoveries too',
    value: at('defensive_contribution'),
  },
  cbi: { label: 'Clearances, blocks and interceptions', value: at('clearances_blocks_interceptions') },
  tackles: { label: 'Tackles', value: at('tackles') },
  recoveries: { label: 'Recoveries', value: at('recoveries') },
  cleanSheet: { label: 'Clean sheet', tip: 'FPL’s: no goal conceded in his 60 minutes or more', value: at('clean_sheets') },
  conceded: { label: 'Goals conceded', tip: 'While he was on the pitch', value: at('goals_conceded') },
  xgc: { label: 'xGC', tip: 'Expected goals conceded while he was on the pitch', digits: 2, value: at('expected_goals_conceded') },
  ownGoals: { label: 'Own goals', value: at('own_goals') },
  saves: { label: 'Saves', value: at('saves'), keepers: true },
  pensSaved: { label: 'Penalties saved', value: at('penalties_saved'), keepers: true },
  pensMissed: { label: 'Penalties missed', value: at('penalties_missed') },
  yellow: { label: 'Yellow cards', value: at('yellow_cards') },
  red: { label: 'Red cards', value: at('red_cards') },
  bonus: { label: 'Bonus', value: at('bonus') },
  bps: { label: 'BPS', tip: 'FPL’s bonus points system, whose top three get the bonus', value: at('bps') },
  ict: { label: 'ICT index', tip: 'FPL’s influence, creativity and threat together', digits: 1, value: at('ict_index') },
  influence: { label: 'Influence', digits: 1, value: at('influence') },
  creativity: { label: 'Creativity', digits: 1, value: at('creativity') },
  threat: { label: 'Threat', digits: 1, value: at('threat') },
};

// One of the Projected category's gameweeks: his expected points in it, the site's model's,
// with who against in the tip, taken apart as an xP pill's where data.json has the parts
// (players in a squad, for the first few gameweeks: modelParts).
const gwColumn = (gw: number, i: number): Column => ({
  label: `GW ${gw}`,
  tip: `Projected points in gameweek ${gw}`,
  digits: 1,
  value: (r) => r.ahead?.points[i] ?? null,
  text: (r) => {
    const v = r.ahead?.points[i] ?? 0;
    return `<span${projectedTip(r, gw, v)}>${v ? v.toFixed(1) : '0'}</span>`;
  },
});

// Without the parts, his xP heads the tip as it would theirs.
function projectedTip(r: StatsRow, gw: number, xp: number) {
  const against = opponents(r.club, gw);
  if (!against) return ' data-tip="No match"';
  const parts = modelParts(r.pid, gw);
  return parts ? xpTip(xp, parts, against) : ` data-tip-head="${tenths(xp)} xP" data-tip="${esc(against)}"`;
}

// `season`: the season's columns, where they differ from a match's: one match's goals and
// assists fit in one column, and a season's want one each. `upcoming`: the gameweeks to
// come, so the season's alone, while it has projections for them (a column each first).
interface Category {
  id: string;
  label: string;
  columns: string[];
  season?: string[];
  upcoming?: true;
  who?: (pid: number) => boolean;
}

const CATEGORIES: Category[] = [
  {
    id: 'top',
    label: 'Top stats',
    columns: ['points', 'minutes', 'goalsAssists', 'xgXa', 'defcon', 'bps', 'saves'],
    season: ['points', 'minutes', 'goals', 'assists', 'xg', 'xa', 'defcon', 'bps', 'saves'],
  },
  { id: 'expected', label: 'Expected', columns: ['xp', 'points', 'xg', 'xa', 'xcs', 'xgc'] },
  {
    id: 'projected',
    label: 'Projected',
    columns: ['aheadTotal', 'aheadMinutes', 'aheadGoals', 'aheadAssists', 'aheadCleanSheet', 'aheadDefcon', 'aheadBonus'],
    upcoming: true,
  },
  { id: 'attack', label: 'Attack', columns: ['goals', 'assists', 'xg', 'xa', 'threat', 'creativity', 'pensMissed'] },
  { id: 'defence', label: 'Defence', columns: ['defcon', 'cbi', 'tackles', 'recoveries', 'cleanSheet', 'conceded', 'xgc', 'ownGoals'] },
  {
    id: 'goalkeeping',
    label: 'Goalkeeping',
    columns: ['saves', 'pensSaved', 'cleanSheet', 'conceded', 'xgc'],
    who: (pid) => player(pid)?.pos === 'GKP',
  },
  { id: 'fpl', label: 'FPL', columns: ['points', 'minutes', 'bonus', 'bps', 'ict', 'influence', 'creativity', 'threat', 'yellow', 'red'] },
];

// Each category opens on its first column, its headline.
onAction('stats-category', (value) => {
  [state.statsCategory, state.statsSort, state.statsAsc] = [value, '', false];
  renderView();
});
// The sorted column again turns it round; another sorts by that one, highest first.
onAction('stats-sort', (value) => {
  if (state.statsSort === value) state.statsAsc = !state.statsAsc;
  else [state.statsSort, state.statsAsc] = [value, false];
  renderView();
});

export const shown = ({ digits, text }: Column, r: StatsRow, cells: Cells, v: number) =>
  text ? (text(r, cells) ?? '') : v && digits ? v.toFixed(digits) : String(v);
export const nameOf = (r: StatsRow) => {
  const name = player(r.pid)?.name ?? '?';
  return r.owner ? ownerPill(r.owner, r.benched, name, { gw: r.gw }) : `<span class="ps-name">${esc(name)}</span>`;
};
export const photoOf = (r: StatsRow, size: number) => `<span class="ps-photo">${photo(r.pid, size)}${crest(r.club, 14)}</span>`;

// A category's columns (the season's, for the `season`), sorted by the chosen one, the
// unknown last either way: each player with his photo and name, in his owner's colours if
// he has one. `why` says why a number is missing; `limit` keeps to the first so many; `gws`
// are the gameweeks the season's file projects.
export function statsTable(
  rows: StatsRow[],
  cellsOf: (r: StatsRow) => Cells,
  why: (r: StatsRow) => string,
  { season = false, limit = Infinity, gws = [] as number[] } = {},
) {
  const offered = CATEGORIES.filter((c) => !c.upcoming || (season && gws.length > 0));
  const category = offered.find((c) => c.id === state.statsCategory) ?? offered[0];
  const { cols, columns } = categoryColumns(category, season, gws);
  const sortKey = columns.includes(state.statsSort) ? state.statsSort : columns[0];
  const asc = sortKey === state.statsSort && state.statsAsc;
  const value = (r: StatsRow, key: string) => cols[key].value(r, cellsOf(r));
  const sorted = rows
    .filter((r) => !category.who || category.who(r.pid))
    .sort(byColumn((r) => value(r, sortKey), asc, cols[sortKey].keepers));
  const head = columns.map((key) => sortHeading(key, cols[key], key === sortKey, asc)).join('');
  // The headings stay under the top bar in a table of their own, which a header inside a
  // box that scrolls sideways can't (alignHeads in components.ts keeps it level with the
  // rows); the rows' table keeps them too, unseen, for a screen reader.
  const table = (inner: string) =>
    `<table class="ps-table" style="--cols:${columns.length}"><colgroup><col class="ps-col-player">${columns.map(() => '<col>').join('')}</colgroup>${inner}</table>`;
  const labels = columns.map((key) => `<th>${cols[key].label}</th>`).join('');
  const cell = (r: StatsRow, key: string) => {
    const v = value(r, key);
    return v !== null
      ? `<td>${shown(cols[key], r, cellsOf(r), v)}</td>`
      : `<td><span class="muted" data-tip="${cols[key].why?.(r) ?? why(r)}">–</span></td>`;
  };
  const body = sorted
    .slice(0, limit)
    .map(
      (r) =>
        `<tr${r.unused ? ' class="unused" data-tip="An unused substitute"' : ''}><td class="ps-player"><a href="${href.player(r.pid)}">${photoOf(r, 24)}${nameOf(r)}</a></td>${columns.map((key) => cell(r, key)).join('')}</tr>`,
    )
    .join('');
  return {
    count: sorted.length,
    html: `<div class="filter-bar ps-cats">${offered.map((c) => chip(c.label, 'stats-category', c.id, c === category)).join('')}</div>
      <div class="ps-split">
        <div class="ps-head split-head">${table(`<thead><tr><th class="ps-player">Player</th>${head}</tr></thead>`)}</div>
        <div class="ps-scroll split-rows">${table(`<thead class="ps-sr"><tr><th>Player</th>${labels}</tr></thead><tbody>${body}</tbody>`)}</div>
      </div>`,
  };
}

// The Projected category's total is over the gameweeks shown, each with a column of its
// own after it.
function categoryColumns(category: Category, season: boolean, gws: number[]) {
  const ahead = category.upcoming ? gws : [];
  const cols: Record<string, Column> = {
    ...COLUMNS,
    aheadTotal: { ...COLUMNS.aheadTotal, label: `Next ${ahead.length}`, tip: `Projected points over the next ${ahead.length} gameweeks` },
    ...Object.fromEntries(ahead.map((gw, i) => [`gw${gw}`, gwColumn(gw, i)])),
  };
  const base = (season && category.season) || category.columns;
  const columns = ahead.length ? [base[0], ...ahead.map((gw) => `gw${gw}`), ...base.slice(1)] : base;
  return { cols, columns };
}

// The unused substitutes last, and the unknown above them.
function byColumn(value: (r: StatsRow) => number | null, asc: boolean, keepers?: boolean) {
  return (a: StatsRow, b: StatsRow) => {
    if (a.unused || b.unused) return Number(Boolean(a.unused)) - Number(Boolean(b.unused));
    const [x, y] = [value(a), value(b)];
    if (x === null || y === null) return Number(x === null) - Number(y === null);
    return (asc ? x - y : y - x) || tieBreak(a, b, keepers);
  };
}

// The keepers first on a keeper's stat, then more minutes, then more points.
function tieBreak(a: StatsRow, b: StatsRow, keepers?: boolean) {
  const keeper = (r: StatsRow) => Number(player(r.pid)?.pos === 'GKP');
  return (keepers ? keeper(b) - keeper(a) : 0) || b.min - a.min || b.pts - a.pts;
}

function sortHeading(key: string, c: Column, on: boolean, asc: boolean) {
  const sort = on ? ` aria-sort="${asc ? 'ascending' : 'descending'}"` : '';
  const tip = c.tip ? ` data-tip="${esc(c.tip)}"` : '';
  return `<th${sort}><button type="button" class="ps-sort${on ? ' on' : ''}" data-action="stats-sort" data-value="${key}"${tip}><span>${c.label}</span>${on ? sortSvg(asc) : ''}</button></th>`;
}
