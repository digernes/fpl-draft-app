// A Premier League match's player stats, as fotmob.com's at the bottom of a match's Stats
// tab: everyone who played, with FPL's numbers for him in that match, a category at a
// time, sorted by any column; and the same for the whole season on the Premier League's
// page. They come from stats/<gw>.json (see PlStats) and stats/season.json, asked for the
// first time they're wanted and again after each new data.json, with the live relay's
// matches over a gameweek's while it's played; and each player's underlying numbers in a
// gameweek, worked out from them while it's on.

import { PL_STATS, type PlMoment, type PlSeasonStats, type PlStat, type PlStats, type Underlying } from '../shared/data.ts';
import type { SlimLive } from '../shared/live.ts';
import { packAsScored, packUnderlying, scoredIn, underlyingOf, UNDERLYING_TIPS } from '../shared/underlying.ts';
import { onAction } from './actions.ts';
import { card, chip, crest, empty, photo, seg, sheet } from './components.ts';
import { esc, plural, sum } from './format.ts';
import { slidersSvg, sortSvg } from './icons.ts';
import { gwBonus, gwPoints, isArchive, opponents, player, seasonEntry } from './lookups.ts';
import { linesIn } from './pl.ts';
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

const COLUMNS: Record<string, Column> = {
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
// and who against in the tip.
const gwColumn = (gw: number, i: number): Column => ({
  label: `GW ${gw}`,
  tip: `Projected points in gameweek ${gw}`,
  digits: 1,
  value: (r) => r.ahead?.points[i] ?? null,
  text: (r) => {
    const v = r.ahead?.points[i] ?? 0;
    return `<span data-tip="${esc(opponents(r.club, gw) || 'No match')}">${v ? v.toFixed(1) : '0'}</span>`;
  },
});

// `season`: the season's columns, where they differ from a match's: one match's goals and
// assists fit in one column, and a season's want one each. `upcoming`: the gameweeks to
// come, so the season's alone, while it has projections for them (a column each first).
const CATEGORIES: {
  id: string;
  label: string;
  columns: string[];
  season?: string[];
  upcoming?: true;
  who?: (pid: number) => boolean;
}[] = [
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
onAction('players-pos', (value) => {
  state.playersPos = value;
  renderView();
});
onAction('players-free', (value) => {
  state.playersFree = value === 'on';
  renderView();
});
onAction('players-all', () => {
  state.playersAll = true;
  renderView();
});

const files = new Map<string, { version: string; stats?: unknown; failed?: boolean }>();

// Beside data.json, or a finished season's beside its archive.
function statsFile(name: string) {
  const archive = isArchive() ? seasonEntry()?.file.replace(/\.json$/, '') : null;
  return archive ? `${archive}/stats/${name}.json` : `stats/${name}.json`;
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

// The points FPL scores a match for (shared/underlying.ts), in the order they're told, a few put together.
const POINT_SOURCES: [key: string, label: string][] = [
  ['minutes', 'Playing'],
  ['goals_scored', 'Goals'],
  ['assists', 'Assists'],
  ['clean_sheets', 'Clean sheet'],
  ['goals_conceded', 'Goals conceded'],
  ['defensive_contribution', 'Defensive contribution'],
  ['saves', 'Saves'],
  ['penalties', 'Penalties'],
  ['bonus', 'Bonus'],
  ['cards', 'Cards'],
  ['own_goals', 'Own goals'],
  ['other', 'Other'],
];
const PUT_TOGETHER: Record<string, string> = {
  yellow_cards: 'cards',
  red_cards: 'cards',
  penalties_saved: 'penalties',
  penalties_missed: 'penalties',
};

/**
 * Where a player's points in a gameweek (or one of its matches) came from, once its stats
 * file is in: each match as FPL scores it, the bonus as it stands (provisional while it's
 * on), and under other what the stats don't account for, as FPL gives some of a double
 * gameweek's only for the whole week.
 */
export function pointsFrom(pid: number, gw: number, match?: number): Record<string, number> | undefined {
  const file = statsFor(gw);
  if (typeof file !== 'object') return undefined;
  const lines = linesIn(pid, gw).filter(({ m }) => match === undefined || m.id === match);
  const from: Record<string, number> = { bonus: match === undefined ? gwBonus(pid, gw) : (lines[0]?.m.events?.[pid]?.bonus ?? 0) };
  for (const { m, line } of lines) {
    const cells = file.matches[m.id]?.[pid];
    if (!cells) continue;
    const stat = (name: PlStat) => Number(cells[PL_STATS.indexOf(name)] ?? 0);
    for (const [name, pts] of Object.entries(scoredIn(stat, line[1], D.meta.rules ?? {}, player(pid)?.pos)))
      if (name !== 'bonus') from[PUT_TOGETHER[name] ?? name] = (from[PUT_TOGETHER[name] ?? name] ?? 0) + pts;
  }
  const points = match === undefined ? gwPoints(pid, gw) : sum(lines.map(({ line }) => line[2]));
  from.other = points - sum(Object.values(from));
  return from;
}

/** The same as rows for a tip, those that scored anything. */
export const pointsRows = (from: Record<string, number> | undefined): [string, number][] =>
  from ? POINT_SOURCES.flatMap(([key, label]): [string, number][] => (from[key] ? [[label, from[key]]] : [])) : [];

/** A player's BPS in a gameweek (or one of its matches), once its stats file is in: FPL's measure of his game, to tell apart those level on points. */
export function bpsIn(pid: number, gw: number, match?: number): number | undefined {
  const file = statsFor(gw);
  if (typeof file !== 'object') return undefined;
  const values = Object.entries(file.matches).flatMap(([id, rows]) =>
    match === undefined || Number(id) === match ? [rows[pid]?.[PL_STATS.indexOf('bps')]] : [],
  );
  return values.some((v) => v != null) ? values.reduce<number>((t, v) => t + (v ?? 0), 0) : undefined;
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
export const gwUnderlying = (pid: number, gw: number): Underlying | undefined =>
  settled(gw) ? D.underlying?.[gw]?.[pid] : packUnderlying(liveUnderlying(pid, gw));

/** The points in his xP that stay as scored, for its tooltip, likewise. */
export const gwAsScored = (pid: number, gw: number): number[] | undefined =>
  settled(gw) ? D.asScored?.[gw]?.[pid] : packAsScored(liveUnderlying(pid, gw));

const settled = (gw: number) => Boolean(D.underlying?.[gw]) || gw !== D.meta.currentGw || isArchive();

function liveUnderlying(pid: number, gw: number) {
  const stats = statsFor(gw);
  if (typeof stats !== 'object') return undefined;
  const rows = Object.values(stats.matches).flatMap((byPid) => (byPid[pid] ? [byPid[pid]] : []));
  const feed = live?.gw === gw ? live.feed : D.live?.gw === gw ? D.live : null;
  const [points, minutes] = feed?.elements[pid] ?? [0, 0];
  return rows.length === 1 ? matchUnderlying(pid, rows[0], minutes, points) : undefined;
}

// His underlying numbers in one match: from his stats in it, and his minutes and points.
function matchUnderlying(pid: number, cells: Cells, minutes: number, points: number) {
  const at = (stat: PlStat) => cells?.[PL_STATS.indexOf(stat)];
  if (at('expected_goals') == null) return undefined;
  const n = (stat: PlStat) => Number(at(stat) ?? 0);
  const s = {
    minutes,
    total_points: points,
    expected_goals: n('expected_goals'),
    expected_assists: n('expected_assists'),
    expected_goals_conceded: n('expected_goals_conceded'),
  };
  const [rules, pos] = [D.meta.rules ?? {}, player(pid)?.pos];
  return underlyingOf(s, rules, pos, 1, scoredIn(n, minutes, rules, pos));
}

// A gameweek's file alone.
const fileFor = (gw: number) => load<PlStats>(String(gw));

/** stats/season.json: everyone's season so far, for the Premier League's Player stats tab. */
const seasonFile = () => load<PlSeasonStats>('season');

function load<T>(name: string): T | 'loading' | 'missing' {
  const file = statsFile(name);
  const version = D.meta.generatedAt ?? '';
  const had = files.get(file);
  if (had?.version !== version) {
    files.set(file, { version, stats: had?.stats });
    fetch(`${file}?v=${encodeURIComponent(version)}`)
      .then((res) => (res.ok ? (res.json() as Promise<T>) : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(
        (stats) => files.set(file, { version, stats }),
        () => files.set(file, { version, stats: had?.stats, failed: true }),
      )
      .finally(() => renderView());
  }
  const now = files.get(file)!;
  return (now.stats as T | undefined) ?? (now.failed ? 'missing' : 'loading');
}

const noughts = PL_STATS.map(() => 0);
const shown = ({ digits, text }: Column, r: StatsRow, cells: Cells, v: number) =>
  text ? (text(r, cells) ?? '') : v && digits ? v.toFixed(digits) : String(v);
const nameOf = (r: StatsRow) => {
  const name = player(r.pid)?.name ?? '?';
  return r.owner ? ownerPill(r.owner, r.benched, name, { gw: r.gw }) : `<span class="ps-name">${esc(name)}</span>`;
};
const photoOf = (r: StatsRow, size: number) => `<span class="ps-photo">${photo(r.pid, size)}${crest(r.club, 14)}</span>`;

/** The card, for a match that has kicked off (`rows` empty before then). */
export function playerStatsCard(gw: number, match: number, rows: StatsRow[]) {
  const title = 'Player stats';
  if (!rows.length) return card({ title, body: empty('They come in once the match kicks off') });
  const file = statsFor(gw);
  if (file === 'loading') return card({ title, body: empty('Loading…') });
  if (file === 'missing') return card({ title, body: empty('Not in yet: they come with the next update') });
  const cells = file.matches[match] ?? {};
  const why = (r: StatsRow) =>
    cells[r.pid] ? 'FPL gives it only for the whole gameweek, and he played twice in it' : 'Not in yet: it comes with the next update';
  const cellsOf = (r: StatsRow) => cells[r.pid] ?? (r.unused ? noughts : undefined);
  const withExpected = rows.map((r) => {
    const u = matchUnderlying(r.pid, cellsOf(r), r.min, r.pts);
    return { ...r, xp: u?.xp ?? null, xcs: u?.xcs ?? null };
  });
  return card({ title, body: statsTable(withExpected, cellsOf, why).html, cls: 'ps-card' });
}

/** The Premier League's Player stats tab: everyone who has played this season, as the match's, of one club (the address has it), by position, and the free agents alone if wanted. */
export function seasonStatsCard(clubId?: number) {
  const title = 'Player stats';
  const file = seasonFile();
  if (file === 'loading') return card({ title, body: empty('Loading…') });
  if (file === 'missing') return card({ title, body: empty('Not in yet: they come with the next update') });
  const rows = Object.entries(file.players).flatMap(([id, row]): StatsRow[] => {
    const p = player(Number(id));
    const out = (clubId !== undefined && p?.club !== clubId) || (state.playersPos !== 'all' && p?.pos !== state.playersPos);
    if (!p || out || (state.playersFree && p.owner !== null)) return [];
    const [xp = null, xcs = null] = row.slice(1 + PL_STATS.length);
    return [{ pid: Number(id), club: p.club, min: row[0] ?? 0, pts: p.total, owner: p.owner, xp, xcs, ahead: aheadOf(file, id) }];
  });
  const { html, count } = statsTable(
    rows,
    (r) => file.players[r.pid]?.slice(1),
    () => '',
    {
      season: true,
      limit: state.playersAll ? Infinity : SHOWN,
      gws: file.projected?.gws,
    },
  );
  const positions = seg(
    'players-pos',
    [
      ['all', 'All'],
      ['GKP', 'GK'],
      ['DEF', 'DEF'],
      ['MID', 'MID'],
      ['FWD', 'FWD'],
    ],
    state.playersPos,
  );
  const clubs = Object.entries(D.clubs).sort(([, a], [, b]) => a.name.localeCompare(b.name));
  const picker = (cls = '') =>
    `<span class="tc-select${cls}"><select data-action="go" aria-label="Club">${[
      `<option value="${href.pl('players')}">All clubs</option>`,
      ...clubs.map(
        ([id, c]) => `<option value="${href.pl('players', Number(id))}"${Number(id) === clubId ? ' selected' : ''}>${esc(c.name)}</option>`,
      ),
    ].join('')}</select></span>`;
  // On one column, as the Transfer center's: the filters in a sheet behind a pill at the
  // card's top right, saying how many are on, and the categories left on the card.
  const on = Number(clubId !== undefined) + Number(state.playersPos !== 'all') + Number(state.playersFree);
  const pill = `<button type="button" class="tc-edit" data-action="sheet-open" data-value="ps-sheet">Filter${on ? ` · ${on}` : ''}${slidersSvg}</button>`;
  const who = seg(
    'players-free',
    [
      ['off', 'All'],
      ['on', 'Free agents'],
    ],
    state.playersFree ? 'on' : 'off',
  );
  const form = `<div class="tc-filter">
      <label class="tc-label">Club${picker()}</label>
      <div class="tc-label">Position</div>${positions}
      <div class="tc-label">Players</div>${who}
    </div>`;
  return card({
    title,
    sub: `${count} ${count === 1 ? 'player' : 'players'} this season`,
    action: pill,
    body: `<div class="filter-bar ps-filters">${picker(' ps-club')}${positions}${chip('Free agents', 'players-free', state.playersFree ? 'off' : 'on', state.playersFree)}</div>${html}${sheet('ps-sheet', 'Filter', form, `Show ${plural(count, 'player')}`)}`,
    footer:
      count > SHOWN && !state.playersAll
        ? { href: href.pl('players', clubId), label: `Show all ${count}`, attrs: 'data-action="players-all"' }
        : null,
    cls: 'ps-card',
  });
}

const SHOWN = 50; // the season's table, until all are asked for

// His projections from the season's file: each gameweek's points, then the rest.
function aheadOf(file: PlSeasonStats, id: string): StatsRow['ahead'] {
  const [n, row] = [file.projected?.gws.length ?? 0, file.projected?.players[id]];
  if (!row) return undefined;
  const [minutes, goals, assists, cleanSheet, defcon, bonus] = row.slice(n);
  return { points: row.slice(0, n), minutes, goals, assists, cleanSheet, defcon, bonus };
}

// A category's columns (the season's, for the `season`), sorted by the chosen one, the
// unknown last either way: each player with his photo and name, in his owner's colours if
// he has one. `why` says why a number is missing; `limit` keeps to the first so many; `gws`
// are the gameweeks the season's file projects.
function statsTable(
  rows: StatsRow[],
  cellsOf: (r: StatsRow) => Cells,
  why: (r: StatsRow) => string,
  { season = false, limit = Infinity, gws = [] as number[] } = {},
) {
  const offered = CATEGORIES.filter((c) => !c.upcoming || (season && gws.length > 0));
  const category = offered.find((c) => c.id === state.statsCategory) ?? offered[0];
  const ahead = category.upcoming ? gws : [];
  const cols: Record<string, Column> = {
    ...COLUMNS,
    aheadTotal: { ...COLUMNS.aheadTotal, label: `Next ${ahead.length}`, tip: `Projected points over the next ${ahead.length} gameweeks` },
    ...Object.fromEntries(ahead.map((gw, i) => [`gw${gw}`, gwColumn(gw, i)])),
  };
  const base = (season && category.season) || category.columns;
  // The gameweeks to come, a column each, after their total.
  const columns = ahead.length ? [base[0], ...ahead.map((gw) => `gw${gw}`), ...base.slice(1)] : base;
  const sortKey = columns.includes(state.statsSort) ? state.statsSort : columns[0];
  const asc = sortKey === state.statsSort && state.statsAsc;
  const value = (r: StatsRow, key: string) => cols[key].value(r, cellsOf(r));
  const sorted = rows
    .filter((r) => !category.who || category.who(r.pid))
    .sort((a, b) => {
      if (a.unused || b.unused) return Number(Boolean(a.unused)) - Number(Boolean(b.unused));
      const [x, y] = [value(a, sortKey), value(b, sortKey)];
      if (x === null || y === null) return Number(x === null) - Number(y === null);
      const keeper = (r: StatsRow) => Number(player(r.pid)?.pos === 'GKP');
      return (asc ? x - y : y - x) || (cols[sortKey].keepers ? keeper(b) - keeper(a) : 0) || b.min - a.min || b.pts - a.pts;
    });
  const head = columns
    .map((key) => {
      const c = cols[key];
      const on = key === sortKey;
      return `<th${on ? ` aria-sort="${asc ? 'ascending' : 'descending'}"` : ''}><button type="button" class="ps-sort${on ? ' on' : ''}" data-action="stats-sort" data-value="${key}"${c.tip ? ` data-tip="${esc(c.tip)}"` : ''}><span>${c.label}</span>${on ? sortSvg(asc) : ''}</button></th>`;
    })
    .join('');
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
      `<a class="ps-lead" href="${href.player(r.pid)}"><span class="ps-lead-label">${label}</span><span class="ps-lead-who">${photoOf(r, 24)}${nameOf(r)}<span class="ps-lead-value">${shown(COLUMNS[key], r, cells[r.pid], v)}</span></span></a>`,
    ];
  });
  return items.length ? card({ title, body: `<div class="ps-leads">${items.join('')}</div>`, footer }) : '';
}
