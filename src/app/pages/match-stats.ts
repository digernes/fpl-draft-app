// A head-to-head's Stats tab, as fotmob.com's: what both XIs did and where their points came
// from, side by side in groups (before kick-off what the odds make of it and each side's
// season so far), and the top of it in short for the match page's right column.

import { PL_STATS, type Lineup, type Match, type OverallRow, type PlStats, type Result } from '../../shared/data.ts';
import type { PlayerEvents } from '../../shared/live.ts';
import { card } from '../components.ts';
import { esc, figure, ordinal, pct, sum } from '../format.ts';
import { gwBonus, gwEvents, player, slotOf } from '../lookups.ts';
import { linesIn } from '../pl.ts';
import { gwUnderlying, pointsFrom, statsFor } from '../stats-files.ts';
import { D, live } from '../state.ts';

type Totals = Record<string, number>;
type Add = (key: string, n?: number) => void;
type Lines = ReturnType<typeof linesIn>;

const COUNTED = ['goals', 'assists', 'cleanSheet', 'defcon', 'pensSaved', 'pensMissed', 'ownGoals', 'yellow', 'red'];
// What FPL counts of each player beyond what scores, match by match in the gameweek's stats file.
const FILED = ['saves', 'tackles', 'clearances_blocks_interceptions', 'recoveries', 'bps', 'threat', 'creativity'] as const;

// What an XI did: its players' gameweek from the real matches they played in (with the
// live relay's minutes and counts while it's on), their underlying numbers once it's
// over, and once the gameweek's stats file is in, what FPL counts beyond the points and
// where the points came from.
function xiTotals(m: Match, l: Lineup, file: PlStats | null): Totals {
  const t: Totals = {};
  const add: Add = (key, n = 0) => (t[key] = (t[key] ?? 0) + n);
  for (const pid of l.xi) addPlayer(add, pid, m.gw, file);
  add('bench', l.benchPts);
  add('subs', l.subs.length);
  add('pts:dgw', l.adj - l.pts);
  return t;
}

function addPlayer(add: Add, pid: number, gw: number, file: PlStats | null) {
  const lines = linesIn(pid, gw);
  const ev = eventsIn(pid, gw, lines);
  const minutes = live?.gw === gw ? (live.feed.elements[pid]?.[1] ?? 0) : sum(lines.map(({ line }) => line[1]));
  add('minutes', minutes);
  add('played', minutes > 0 ? 1 : 0);
  add('starts', lines.some(({ line }) => line[3]) ? 1 : 0);
  add('hour', lines.some(({ line }) => line[1] >= 60) ? 1 : 0);
  add('bonus', gwBonus(pid, gw)); // provisional while it's on, as in the score
  for (const key of COUNTED) add(key, ev[key]);
  addUnderlying(add, pid, gw);
  if (file) addFiled(add, pid, gw, lines, file);
}

function eventsIn(pid: number, gw: number, lines: Lines): Totals {
  const fromMatches: Totals = {};
  for (const { m: pm } of lines)
    for (const [key, n] of Object.entries(pm.events?.[pid] ?? {})) fromMatches[key] = (fromMatches[key] ?? 0) + n;
  return { ...fromMatches, ...((gwEvents(pid, gw) ?? {}) as PlayerEvents) };
}

function addUnderlying(add: Add, pid: number, gw: number) {
  const u = gwUnderlying(pid, gw);
  if (!u) return;
  add('xg', u[0]);
  add('xa', u[1]);
  add('xp', u[2]);
  add('xcs', u[3] ?? 0);
  if (['GKP', 'DEF'].includes(player(pid).pos)) add('xgc', u[4] ?? 0);
}

function addFiled(add: Add, pid: number, gw: number, lines: Lines, file: PlStats) {
  for (const { m: pm } of lines) {
    const cells = file.matches[pm.id]?.[pid];
    for (const name of FILED) add(name, Number(cells?.[PL_STATS.indexOf(name)] ?? 0));
  }
  for (const [source, pts] of Object.entries(pointsFrom(pid, gw) ?? {})) if (source !== 'bonus') add(`pts:${source}`, pts);
}

interface RowOptions {
  digits?: number;
  percent?: boolean;
  /** Fewer is better, as with cards: the lower gets the pill. */
  lower?: boolean;
  tip?: string;
  format?: (v: number) => string;
}

// fotmob.com's stat rows: each side's value either side of the label, the better of them
// in a pill of that side's colour.
function statRow(m: Match, label: string, [home, away]: [number, number], { digits = 0, percent, lower, tip, format }: RowOptions = {}) {
  const fixed = (v: number) =>
    Math.abs(v) < 0.5 * 10 ** -digits ? (0).toFixed(digits) : `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`;
  const show = format ?? (percent ? pct : fixed);
  const better = (a: number, b: number) => (lower ? a < b : a > b);
  const value = (v: number, id: number, best: boolean) => `<span class="xg-value${best ? ` better m${slotOf(id)}` : ''}">${show(v)}</span>`;
  return `<div class="xg-row">${value(home, m.home, better(home, away))}<span class="xg-label"${tip ? ` data-tip="${esc(tip)}"` : ''}>${label}</span>${value(away, m.away, better(away, home))}</div>`;
}

// fotmob.com's possession bar, for the points: each side's share of them in its colour.
function shareBar(m: Match, label: string, [home, away]: [number, number]) {
  const [h, a] = [Math.max(home, 0), Math.max(away, 0)];
  const share = h + a ? h / (h + a) : 0.5;
  const side = (id: number, v: number, s: number) => `<span class="m${slotOf(id)}" style="--share: ${s.toFixed(3)}">${figure(v)}</span>`;
  return `<div class="st-share"><span class="xg-label">${label}</span><div class="st-bar">${side(m.home, home, share)}${side(m.away, away, 1 - share)}</div></div>`;
}

const pointsBar = (m: Match) => shareBar(m, 'Points', [m.homePts ?? 0, m.awayPts ?? 0]);

const XP_TIP = 'Each XI with goals, assists and clean sheets swapped for what the xG, xA and xGC were worth';

// Once the gameweek is over the build's, which counts the automatic substitutes; while it's
// on, the XIs' so far from the matches' live stats.
const xpRow = (m: Match, rows?: Rows) =>
  m.xg
    ? statRow(m, 'Expected points (xP)', m.xg.xp, { digits: 1, tip: XP_TIP })
    : !m.finished && rows?.whenAny('Expected points (xP)', 'xp', { digits: 1, tip: `${XP_TIP}, in the matches played so far` });

interface StatGroup {
  html: string;
  /** In rows, for sharing the groups out between two columns. */
  size: number;
}

// A heading over its rows, as fotmob.com's; none without rows.
function group(title: string, rows: (string | false | null | undefined)[], lead = ''): StatGroup | null {
  const shown = rows.filter((r): r is string => Boolean(r));
  if (!shown.length) return null;
  return {
    html: `<div class="st-group"><h3 class="st-head">${title}</h3>${lead}${shown.join('')}</div>`,
    size: shown.length + (lead ? 3 : 1),
  };
}

// fotmob.com's Stats tab: one card, its first two groups side by side once it's wide enough
// and the rest in two columns under them, split where the two come out most even.
function statsLayout(groups: (StatGroup | null)[]) {
  const [first, second, ...rest] = groups.filter((g): g is StatGroup => g !== null);
  const cell = (gs: (StatGroup | undefined)[]) => {
    const html = gs.flatMap((g) => (g ? [g.html] : [])).join('');
    return html ? `<div class="st-cell">${html}</div>` : '';
  };
  const sizes = rest.map((g) => g.size);
  const gap = (k: number) => Math.abs(sum(sizes) - 2 * sum(sizes.slice(0, k)));
  let split = 0;
  for (let k = 1; k <= rest.length; k++) if (gap(k) <= gap(split)) split = k;
  const top = `<div class="st-row">${cell([first])}${cell([second])}</div>`;
  return rest.length ? `${top}<div class="st-row">${cell(rest.slice(0, split))}${cell(rest.slice(split))}</div>` : top;
}

// Both XIs' totals as rows, a stat at a time; `whenAny` leaves out one neither side has any of.
function rowsFor(m: Match, h: Totals, a: Totals) {
  const v = (key: string): [number, number] => [h[key] ?? 0, a[key] ?? 0];
  const row = (label: string, key: string, options?: RowOptions) => statRow(m, label, v(key), options);
  const whenAny = (label: string, key: string, options?: RowOptions) => v(key).some((n) => n !== 0) && row(label, key, options);
  return { v, row, whenAny };
}

type Rows = ReturnType<typeof rowsFor>;

// The Stats tab's top stats in short, for the right column, as fotmob.com's Facts tab has them.
export function sideStats(m: Match, l: [Lineup, Lineup]) {
  const totals = rowsFor(m, xiTotals(m, l[0], null), xiTotals(m, l[1], null));
  const rows = [xpRow(m, totals), totals.row('Goals', 'goals'), totals.row('Assists', 'assists')];
  return `<div class="st-cell">${pointsBar(m)}${rows.filter(Boolean).join('')}</div>`;
}

export function statsTab(m: Match, l: [Lineup, Lineup] | null) {
  if (!m.started || !l) return card({ cls: 'st-card', body: statsLayout(beforeGroups(m)) });
  const loaded = statsFor(m.gw);
  const file = typeof loaded === 'object' ? loaded : null;
  const rows = rowsFor(m, xiTotals(m, l[0], file), xiTotals(m, l[1], file));
  const groups = [
    topStats(m, rows, file),
    file && pointsFromGroup(rows),
    m.finished && expectedGroup(m, rows),
    attackGroup(rows),
    defenceGroup(rows, file),
    minutesGroup(rows),
    disciplineGroup(rows),
  ];
  return card({ cls: 'st-card', body: statsLayout(groups.map((g) => g || null)) });
}

function topStats(m: Match, rows: Rows, file: PlStats | null) {
  const { row } = rows;
  return group(
    'Top stats',
    [
      xpRow(m, rows),
      m.odds && statRow(m, 'Projected before the deadline', m.odds.expected, { tip: 'The model’s score at the deadline' }),
      row('Goals', 'goals'),
      row('Assists', 'assists'),
      row('Bonus points', 'bonus'),
      file && row('BPS', 'bps', { tip: 'FPL’s bonus points system, whose top three in each match get the bonus' }),
      row('Points on the bench', 'bench'),
    ],
    pointsBar(m),
  );
}

function expectedGroup(m: Match, { v, row }: Rows) {
  return group('Expected', [
    xpRow(m),
    row('Expected goals (xG)', 'xg', { digits: 2 }),
    row('Expected assists (xA)', 'xa', { digits: 2 }),
    statRow(m, 'xG + xA', [v('xg')[0] + v('xa')[0], v('xg')[1] + v('xa')[1]], { digits: 2 }),
    row('Expected clean sheets (xCS)', 'xcs', { digits: 2 }),
    row('xG conceded (xGC)', 'xgc', { digits: 2, lower: true, tip: 'By the goalkeepers and defenders in the XI, while they played' }),
  ]);
}

function pointsFromGroup({ row, whenAny }: Rows) {
  return group('Where the points came from', [
    row('Playing', 'pts:minutes', { tip: 'A point for playing, and another for 60 minutes or more' }),
    row('Goals', 'pts:goals_scored'),
    row('Assists', 'pts:assists'),
    row('Clean sheets', 'pts:clean_sheets'),
    whenAny('Goals conceded', 'pts:goals_conceded'),
    row('Defensive contributions', 'pts:defensive_contribution'),
    whenAny('Saves', 'pts:saves'),
    whenAny('Penalties', 'pts:penalties', { tip: 'Saved, or missed' }),
    row('Bonus', 'bonus'),
    whenAny('Cards', 'pts:cards'),
    whenAny('Own goals', 'pts:own_goals'),
    whenAny('Other', 'pts:other', { tip: 'What the stats of each match don’t account for: FPL gives some for a whole double gameweek' }),
    whenAny('Double gameweek penalty', 'pts:dgw', { tip: `${D.meta.dgwPenalty} points off for each player in the XI with two matches` }),
  ]);
}

// FPL fills in threat and creativity only after the gameweek.
function attackGroup({ row, whenAny }: Rows) {
  return group('Attack', [
    row('Goals', 'goals'),
    row('Assists', 'assists'),
    whenAny('Threat', 'threat', { digits: 1, tip: 'FPL’s measure of how likely the players were to score' }),
    whenAny('Creativity', 'creativity', { digits: 1, tip: 'FPL’s measure of the chances the players made for others' }),
  ]);
}

function defenceGroup({ row }: Rows, file: PlStats | null) {
  return group('Defence', [
    row('Clean sheets', 'cleanSheet', { tip: 'Players in the XI who kept one, where it scores' }),
    row('Defensive contributions', 'defcon', {
      tip: 'Players who reached FPL’s threshold of tackles, clearances, blocks and interceptions',
    }),
    file && row('Tackles', 'tackles'),
    file && row('Clearances, blocks and interceptions', 'clearances_blocks_interceptions'),
    file && row('Recoveries', 'recoveries'),
    file && row('Saves', 'saves'),
    row('Penalties saved', 'pensSaved'),
  ]);
}

function minutesGroup({ row }: Rows) {
  return group('Minutes', [
    row('Minutes played', 'minutes'),
    row('Players who played', 'played', { tip: 'Of the eleven, after the automatic substitutions' }),
    row('Starts', 'starts', { tip: 'Players who started their Premier League match' }),
    row('60 minutes or more', 'hour', { tip: 'Players who played an hour or more in a match, for the second point for playing' }),
    row('Automatic substitutions', 'subs', { lower: true }),
  ]);
}

function disciplineGroup({ row }: Rows) {
  return group('Discipline', [
    row('Yellow cards', 'yellow', { lower: true }),
    row('Red cards', 'red', { lower: true }),
    row('Own goals', 'ownGoals', { lower: true }),
    row('Penalties missed', 'pensMissed', { lower: true }),
  ]);
}

// --- Before kick-off ------------------------------------------------------------------------

const TABLE_POINTS: Record<Result, number> = { W: 3, D: 1, L: 0 };
const formPoints = (r: OverallRow) => sum(r.form.map((x) => TABLE_POINTS[x.res]));

// A side's scores in the head-to-heads played this season.
const scoresOf = (id: number) =>
  D.matches.filter((x) => x.finished && (x.home === id || x.away === id)).map((x) => (x.home === id ? x.homePts! : x.awayPts!));
const highest = (id: number) => Math.max(0, ...scoresOf(id));

// Before kick-off: what the odds make of it, and each side's season so far.
function beforeGroups(m: Match) {
  const rows = [m.home, m.away].map((id) => D.tables.overall.find((r) => r.id === id));
  const both = (f: (r: OverallRow) => number) => rows.map((r) => (r ? f(r) : 0)) as [number, number];
  const field = (key: 'rank' | 'pts' | 'won') => both((r) => r[key]);
  const perMatch = (key: 'pf' | 'pa') => both((r) => (r.played ? r[key] / r.played : 0));
  return [
    group('Before the match', [
      m.odds && statRow(m, 'Win chance', [m.odds.p[0], m.odds.p[2]], { percent: true }),
      m.odds &&
        statRow(m, 'Projected points', m.odds.expected, {
          tip: 'The model’s score: the league average, plus how far each side’s best projected XI sits from the average one',
        }),
      statRow(m, 'Table position', field('rank'), { lower: true, format: ordinal }),
      statRow(m, 'Table points', field('pts')),
    ]),
    group('This season', [
      statRow(m, 'Wins', field('won')),
      statRow(m, 'Points a match', perMatch('pf'), { digits: 1 }),
      statRow(m, 'Points against a match', perMatch('pa'), { digits: 1, lower: true }),
      statRow(m, 'Highest score', [highest(m.home), highest(m.away)]),
      statRow(m, 'Form', both(formPoints), { tip: `Table points from the last ${D.meta.formLength} matches` }),
    ]),
  ];
}
