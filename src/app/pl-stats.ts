// A Premier League match's player stats, as fotmob.com's at the bottom of a match's Stats
// tab: everyone who played, with FPL's numbers for him in that match, a category at a
// time, sorted by any column. They come from stats/<gw>.json (see PlStats), asked for the
// first time they're wanted and again after each new data.json, with the live relay's
// matches over it while the gameweek is played; and each player's underlying numbers in a
// gameweek, worked out from them while it's on.

import { PL_STATS, type PlMoment, type PlStat, type PlStats, type Underlying } from '../shared/data.ts';
import type { SlimLive } from '../shared/live.ts';
import { packUnderlying, underlyingOf } from '../shared/underlying.ts';
import { onAction } from './actions.ts';
import { card, chip, crest, empty, photo } from './components.ts';
import { esc, fmtTime } from './format.ts';
import { sortSvg } from './icons.ts';
import { isArchive, player, seasonEntry } from './lookups.ts';
import { ownerPill } from './pitch.ts';
import { renderView } from './render.ts';
import { href } from './router.ts';
import { D, live, state } from './state.ts';

/** A player in the match, with what the page knows of him without the file: his side's club, minutes, points and owner. */
export interface StatsRow {
  pid: number;
  club: number;
  min: number;
  pts: number;
  owner: number | null;
  benched?: boolean;
  /** A substitute who hasn't come on: nothing but noughts, at the bottom whatever the sort. */
  unused?: boolean;
}

type Cells = (number | null)[] | undefined;

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

const COLUMNS: Record<string, Column> = {
  points: { label: 'Points', tip: 'FPL points', value: (r) => r.pts },
  minutes: { label: 'Minutes played', value: (r) => r.min },
  goals: { label: 'Goals', value: at('goals_scored') },
  assists: { label: 'Assists', value: at('assists') },
  xg: { label: 'xG', tip: 'Expected goals', digits: 2, value: at('expected_goals') },
  xa: { label: 'xA', tip: 'Expected assists', digits: 2, value: at('expected_assists') },
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

const CATEGORIES: { id: string; label: string; columns: string[]; who?: (pid: number) => boolean }[] = [
  { id: 'top', label: 'Top stats', columns: ['points', 'minutes', 'goalsAssists', 'xgXa', 'defcon', 'bps', 'saves'] },
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

onAction('stats-category', (value) => {
  state.statsCategory = value;
  renderView();
});
// The sorted column again turns it round; another sorts by that one, highest first.
onAction('stats-sort', (value) => {
  if (state.statsSort === value) state.statsAsc = !state.statsAsc;
  else [state.statsSort, state.statsAsc] = [value, false];
  renderView();
});

const files = new Map<string, { version: string; stats?: PlStats; failed?: boolean }>();

// Beside data.json, or a finished season's beside its archive.
function statsFile(gw: number) {
  const archive = isArchive() ? seasonEntry()?.file.replace(/\.json$/, '') : null;
  return archive ? `${archive}/stats/${gw}.json` : `stats/${gw}.json`;
}

/**
 * The gameweek's stats file once it's in. Each new data.json comes with a new one, which
 * is asked for then, the last one showing meanwhile. While the gameweek is played, the
 * relay's matches go over it, as fresh as the scores.
 */
export function statsFor(gw: number): PlStats | 'loading' | 'missing' {
  const file = fileFor(gw);
  const feed = live?.gw === gw && !isArchive() ? live.feed : null;
  if (!feed?.matches || file === 'loading') return file;
  const stats = file === 'missing' ? undefined : file;
  if (merged?.feed !== feed || merged.file !== stats) merged = { feed, file: stats, stats: withLive(gw, stats, feed, idsByCode()) };
  return merged.stats;
}

// The merge stays the same until the feed or the file changes.
let merged: { feed: SlimLive; file: PlStats | undefined; stats: PlStats } | null = null;
let codes: { players: typeof D.players; ids: Map<number, number> } | null = null;
const idsByCode = () => {
  if (codes?.players !== D.players)
    codes = { players: D.players, ids: new Map(Object.entries(D.players).map(([pid, p]) => [p.code, Number(pid)])) };
  return codes.ids;
};

/** A gameweek's stats (its file's, if it has one) with the relay's matches over them: their stats, and their moments with FPL's codes for players made ids. */
export function withLive(gw: number, file: PlStats | undefined, feed: SlimLive, ids: Map<number, number>): PlStats {
  const moments = Object.fromEntries(
    Object.entries(feed.moments ?? {}).map(([fixture, list]) => [
      fixture,
      list.flatMap(([min, half, kind, code, other]): PlMoment[] => {
        const [pid, with_] = [ids.get(code), other === undefined ? undefined : ids.get(other)];
        if (pid === undefined || (kind === 'sub' && with_ === undefined)) return [];
        return [with_ === undefined ? [min, half, kind, pid] : [min, half, kind, pid, with_]];
      }),
    ]),
  );
  return { ...file, gw, matches: { ...file?.matches, ...feed.matches }, moments: { ...file?.moments, ...moments } };
}

/**
 * A player's xG, xA, xP and xCS in a gameweek: data.json's once it's over, and while it's
 * played worked out the same way from his match's stats so far (shared/underlying.ts),
 * for one who has played in only one match that week.
 */
export function gwUnderlying(pid: number, gw: number): Underlying | undefined {
  if (D.underlying?.[gw] || gw !== D.meta.currentGw || isArchive()) return D.underlying?.[gw]?.[pid];
  const stats = statsFor(gw);
  if (typeof stats !== 'object') return undefined;
  const rows = Object.values(stats.matches).flatMap((byPid) => (byPid[pid] ? [byPid[pid]] : []));
  const at = (stat: PlStat) => (rows.length === 1 ? rows[0][PL_STATS.indexOf(stat)] : null);
  if (at('expected_goals') == null) return undefined;
  const n = (stat: PlStat) => Number(at(stat) ?? 0);
  const feed = live?.gw === gw ? live.feed : D.live?.gw === gw ? D.live : null;
  const [points, minutes] = feed?.elements[pid] ?? [0, 0];
  const s = {
    minutes,
    total_points: points,
    goals_scored: n('goals_scored'),
    assists: n('assists'),
    clean_sheets: n('clean_sheets'),
    goals_conceded: n('goals_conceded'),
    expected_goals: n('expected_goals'),
    expected_assists: n('expected_assists'),
    expected_goals_conceded: n('expected_goals_conceded'),
  };
  return packUnderlying(underlyingOf(s, D.meta.rules ?? {}, player(pid)?.pos, 1));
}

// The file alone.
function fileFor(gw: number): PlStats | 'loading' | 'missing' {
  const file = statsFile(gw);
  const version = D.meta.generatedAt ?? '';
  const had = files.get(file);
  if (had?.version !== version) {
    files.set(file, { version, stats: had?.stats });
    fetch(`${file}?v=${encodeURIComponent(version)}`)
      .then((res) => (res.ok ? (res.json() as Promise<PlStats>) : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(
        (stats) => files.set(file, { version, stats }),
        () => files.set(file, { version, stats: had?.stats, failed: true }),
      )
      .finally(() => renderView());
  }
  const now = files.get(file)!;
  return now.stats ?? (now.failed ? 'missing' : 'loading');
}

const noughts = PL_STATS.map(() => 0);
const shown = (key: string, r: StatsRow, cells: Cells, v: number) => {
  const { digits, text } = COLUMNS[key];
  return text ? (text(r, cells) ?? '') : v && digits ? v.toFixed(digits) : String(v);
};
const nameOf = (r: StatsRow) => {
  const name = player(r.pid)?.name ?? '?';
  return r.owner ? ownerPill(r.owner, r.benched, name) : `<span class="ps-name">${esc(name)}</span>`;
};
const photoOf = (r: StatsRow, size: number) => `<span class="ps-photo">${photo(r.pid, size)}${crest(r.club, 14)}</span>`;

/** The card, for a match that has kicked off (`rows` empty before then); `live` while it's on, when only the points and minutes are up to the minute. */
export function playerStatsCard(gw: number, match: number, rows: StatsRow[], live = false) {
  const title = 'Player stats';
  if (!rows.length) return card({ title, body: empty('They come in once the match kicks off') });
  const file = statsFor(gw);
  if (file === 'loading') return card({ title, body: empty('Loading…') });
  if (file === 'missing') return card({ title, body: empty('Not in yet: they come with the next update') });
  const cells = file.matches[match] ?? {};
  const category = CATEGORIES.find((c) => c.id === state.statsCategory) ?? CATEGORIES[0];
  const sortKey = category.columns.includes(state.statsSort) ? state.statsSort : category.columns[0];
  const asc = sortKey === state.statsSort && state.statsAsc;
  const cellsOf = (r: StatsRow) => cells[r.pid] ?? (r.unused ? noughts : undefined);
  const value = (r: StatsRow, key: string) => COLUMNS[key].value(r, cellsOf(r));
  const sorted = rows
    .filter((r) => !category.who || category.who(r.pid))
    .sort((a, b) => {
      if (a.unused || b.unused) return Number(Boolean(a.unused)) - Number(Boolean(b.unused));
      const [x, y] = [value(a, sortKey), value(b, sortKey)];
      if (x === null || y === null) return Number(x === null) - Number(y === null); // the unknown last, either way
      const keeper = (r: StatsRow) => Number(player(r.pid)?.pos === 'GKP');
      return (asc ? x - y : y - x) || (COLUMNS[sortKey].keepers ? keeper(b) - keeper(a) : 0) || b.min - a.min || b.pts - a.pts;
    });
  const head = category.columns
    .map((key) => {
      const c = COLUMNS[key];
      const on = key === sortKey;
      return `<th${on ? ` aria-sort="${asc ? 'ascending' : 'descending'}"` : ''}><button type="button" class="ps-sort${on ? ' on' : ''}" data-action="stats-sort" data-value="${key}"${c.tip ? ` data-tip="${esc(c.tip)}"` : ''}><span>${c.label}</span>${on ? sortSvg(asc) : ''}</button></th>`;
    })
    .join('');
  const cell = (r: StatsRow, key: string) => {
    const v = value(r, key);
    if (v !== null) return `<td>${shown(key, r, cellsOf(r), v)}</td>`;
    const why = cells[r.pid]
      ? 'FPL gives it only for the whole gameweek, and he played twice in it'
      : 'Not in yet: it comes with the next update';
    return `<td><span class="muted" data-tip="${why}">–</span></td>`;
  };
  const body = sorted
    .map(
      (r) =>
        `<tr${r.unused ? ' class="unused" data-tip="An unused substitute"' : ''}><td class="ps-player"><a href="${href.player(r.pid)}">${photoOf(r, 24)}${nameOf(r)}</a></td>${category.columns.map((key) => cell(r, key)).join('')}</tr>`,
    )
    .join('');
  const asOf = D.meta.generatedAt ? fmtTime.format(new Date(D.meta.generatedAt)) : '';
  return card({
    title,
    sub: live && asOf ? `Points and minutes as they stand, the rest as of ${asOf}` : '',
    body: `<div class="filter-bar ps-cats">${CATEGORIES.map((c) => chip(c.label, 'stats-category', c.id, c === category)).join('')}</div>
      <div class="ps-scroll"><table class="ps-table"><thead><tr><th class="ps-player">Player</th>${head}</tr></thead><tbody>${body}</tbody></table></div>`,
  });
}

// The Facts tab's taste of them, above the lineups: who led the way on each of a few, as
// fotmob.com's top stats lead to its Stats tab.
const LEADS: [key: string, label: string][] = [
  ['points', 'Most points'],
  ['goalsAssists', 'Most goals and assists'],
  ['xgXa', 'Most xG and xA'],
  ['bps', 'Top of the BPS'],
  ['defcon', 'Most defensive contributions'],
  ['saves', 'Most saves'],
];

/** For a match that has kicked off; `all` is the link to the Player stats tab. */
export function playerLeadsCard(gw: number, match: number, rows: StatsRow[], all: string) {
  const played = rows.filter((r) => !r.unused);
  if (!played.length) return '';
  const title = 'Player stats';
  const footer = { href: all, label: 'All player stats' };
  const file = statsFor(gw);
  if (file === 'loading') return card({ title, body: empty('Loading…'), footer });
  if (file === 'missing') return card({ title, body: empty('Not in yet: they come with the next update'), footer });
  const cells = file.matches[match] ?? {};
  const items = LEADS.flatMap(([key, label]) => {
    const best = played
      .map((r) => ({ r, v: COLUMNS[key].value(r, cells[r.pid]) }))
      .filter((x): x is { r: StatsRow; v: number } => x.v !== null && x.v > 0)
      .sort((a, b) => b.v - a.v || b.r.pts - a.r.pts)[0];
    if (!best) return [];
    const { r, v } = best;
    return [
      `<a class="ps-lead" href="${href.player(r.pid)}"><span class="ps-lead-label">${label}</span><span class="ps-lead-who">${photoOf(r, 24)}${nameOf(r)}<span class="ps-lead-value">${shown(key, r, cells[r.pid], v)}</span></span></a>`,
    ];
  });
  return items.length ? card({ title, body: `<div class="ps-leads">${items.join('')}</div>`, footer }) : '';
}
