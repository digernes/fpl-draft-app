// A head-to-head's commentary, as fotmob.com's: what happened to either side's players in
// the gameweek's Premier League matches, from each kick-off to its full time, with the
// points each thing was worth and the score it left. The goals, cards and substitutions
// and their minutes are the match centre's (PlStats' moments); the hour played is from the
// minutes; and what FPL hands out at the end (clean sheets, saves, defensive contributions,
// bonus, and anything else in a player's points) comes at full time, so the score ends on
// the real one. A match being played comes from the live feed and the relay's moments, as
// the score does (match-lines.ts). A pure function of the data, for the tests. The momentum
// walks through each match by the same moments (`happenings`), with the clean sheets as
// FPL's live scores count them, and while the gameweek is played brings each automatic
// substitute in when the commentary does (`autoSubsMade`).

import {
  PL_STATS,
  type Data,
  type Lineup,
  type Match,
  type PlLine,
  type PlMatch,
  type PlMoment,
  type PlStat,
  type PlStats,
  type Position,
} from '../shared/data.ts';
import { roundLines, type LiveRound } from './match-lines.ts';
import { withFplAssists } from '../shared/match-stats.ts';

export interface Entry {
  /** For the order: its match's kick-off plus its minute (and a quarter of an hour at half-time). */
  at: number;
  /** As fotmob.com shows it: 41’, 45+2’, or HT and FT. */
  minute: string;
  match: PlMatch;
  kind: 'kickoff' | 'goal' | 'own' | 'yellow' | 'red' | 'sub' | 'hour' | 'halftime' | 'fulltime' | 'autosub';
  /** The match's score after it, for a goal and at half-time and full time. */
  matchScore?: [number, number];
  players: EntryPlayer[];
  /** The head-to-head's score after it. */
  score: [number, number];
}

export interface EntryPlayer {
  pid: number;
  /** Home (0) or away (1) in the head-to-head. */
  side: 0 | 1;
  /** On his manager's bench, where his points don't count. */
  bench: boolean;
  pts: number;
  /** What he did, when an entry has more than one thing (full time's clean sheets and bonus). */
  what?: string;
  /** For a substitution: the player he came on for, or who came on for him. */
  other?: number;
}

/** An entry before the head-to-head's score is put to it. */
export type Happening = Omit<Entry, 'score'>;
type Draft = Happening;

interface Owner {
  side: 0 | 1;
  bench: boolean;
}

/** A time in the gameweek, as `at`, and the match and minute it shows. */
export interface When {
  at: number;
  match: PlMatch;
  minute: string;
}

/** The gameweek as the commentary reads it: its matches as they stand, FPL's rules, and whose players are whose. */
interface Round {
  data: Data;
  stats: PlStats;
  gw: number;
  byMatch: Map<number, [PlLine[], PlLine[]]>;
  isDone: (pm: PlMatch) => boolean;
  rule: (key: string) => number;
  pos: (pid: number) => Position;
  ours: Map<number, Owner>;
  /** His side, if he's one of ours and shown: the benches' players only with `bench`. */
  shown: (pid: number) => Owner | undefined;
  /** Clean sheets as FPL's live scores count them, rather than at full time. */
  liveSheets: boolean;
}

/** A Premier League match on its way through the commentary. */
interface Play {
  r: Round;
  pm: PlMatch;
  lines: PlLine[];
  moments: PlMoment[];
  home: Set<number>;
  ko: number;
  stat: (pid: number, name: PlStat) => number;
  /** When each player came on and went off, as `at`. */
  on: Map<number, number>;
  off: Map<number, number>;
  /** What's been put down to each player, so full time can hand out the rest of his points. */
  given: Map<number, number>;
  /** Each keeper's and defender's goals conceded so far. */
  conceded: Map<number, number>;
  /** The goals' entries, by `at`, for a clean sheet lost to one. */
  goals: Map<number, Draft>;
  score: [number, number];
  entries: Draft[];
}

const minuteText = (min: number, half: 1 | 2) => {
  const end = half === 1 ? 45 : 90;
  return min > end ? `${end}+${min - end}’` : `${min}’`;
};
const timeOf = (ko: number, min: number, half: 1 | 2) => ko + (min + (half === 2 ? 15 : 0)) * 60_000;
const isGoal = (kind: PlMoment[2]) => kind === 'goal' || kind === 'pen' || kind === 'own';
// The side a goal counts for: the scorer's, or for an own goal the other one.
const countsForHome = (home: Set<number>, [, , kind, pid]: PlMoment) => home.has(pid) !== (kind === 'own');

/** The latest first. With `bench`, the benches' players too, whose points don't count; `now`, while the gameweek is played. */
export function commentary(
  data: Data,
  stats: PlStats,
  m: Match,
  lineups: [Lineup, Lineup],
  { bench = false, now }: { bench?: boolean; now?: LiveRound } = {},
): Entry[] {
  const r = roundOf(data, stats, m.gw, lineups, { bench, liveSheets: false, now });
  const entries = roundEntries(r);
  addAutoSubs(r, lineups, entries);
  // Without the benches, the moments a substitute had before coming in go too.
  if (!bench) for (const e of entries) e.players = e.players.filter((p) => !p.bench);
  return withScores(entries);
}

/**
 * What the XIs' players did in each of the gameweek's matches, as the commentary has it but
 * without the score, in no order: for the momentum, with a clean sheet coming at a player's
 * hour while his side has conceded none, and going at the first goal against it while he's
 * on, as FPL's live scores count them. With `autoSubs`, the automatic substitutions too, as
 * the commentary has them, each substitute's moments from before his on the bench.
 */
export function happenings(
  data: Data,
  stats: PlStats,
  m: Match,
  lineups: [Lineup, Lineup],
  { now, autoSubs = false }: { now?: LiveRound; autoSubs?: boolean } = {},
): Happening[] {
  const r = roundOf(data, stats, m.gw, lineups, { bench: false, liveSheets: true, now });
  const entries = roundEntries(r);
  if (autoSubs) addAutoSubs(r, lineups, entries);
  return entries;
}

/** When the commentary has each of the lineups' automatic substitutions made, by substitute: those it has a time for. */
export function autoSubsMade(
  data: Data,
  m: Match,
  lineups: [Lineup, Lineup],
  { now, stats }: { now?: LiveRound; stats?: PlStats } = {},
): Map<number, When> {
  const r = roundOf(data, stats ?? { gw: m.gw, matches: {} }, m.gw, lineups, { bench: false, liveSheets: true, now });
  const made = new Map<number, When>();
  for (const l of lineups)
    (l.subs ?? []).forEach((sub, i) => {
      const when = madeAt(r, sub, l.off?.[i]);
      if (when) made.set(sub, when);
    });
  return made;
}

const roundEntries = (r: Round) =>
  (r.data.plMatches ?? []).filter((x) => x.gw === r.gw && r.byMatch.has(x.id) && x.ko).flatMap((pm) => matchEntries(r, pm));

function roundOf(
  data: Data,
  stats: PlStats,
  gw: number,
  lineups: [Lineup, Lineup],
  { bench, liveSheets, now }: { bench: boolean; liveSheets: boolean; now?: LiveRound },
): Round {
  const rules = data.meta.rules ?? {};
  const ours = owners(lineups);
  return {
    data,
    stats,
    gw,
    byMatch: roundLines(data, gw, now),
    isDone: (pm) => Boolean(now?.feed.fixtures.find((f) => f.id === pm.id)?.done ?? pm.done),
    rule: (key) => rules[key] ?? 0,
    pos: (pid) => data.players[pid]?.pos ?? 'MID',
    ours,
    shown: (pid) => {
      const o = ours.get(pid);
      return o && (bench || !o.bench) ? o : undefined;
    },
    liveSheets,
  };
}

function owners(lineups: [Lineup, Lineup]) {
  const ours = new Map<number, Owner>();
  lineups.forEach((l, side) => {
    for (const pid of l.xi) ours.set(pid, { side: side as 0 | 1, bench: false });
    for (const pid of l.bench) ours.set(pid, { side: side as 0 | 1, bench: true });
  });
  return ours;
}

// The head-to-head's score after each, counting the XIs only.
function withScores(entries: Draft[]): Entry[] {
  entries.sort((a, b) => a.at - b.at);
  const running: [number, number] = [0, 0];
  return entries
    .map((e) => {
      for (const p of e.players) if (!p.bench) running[p.side] += p.pts;
      return { ...e, score: [...running] as [number, number] };
    })
    .reverse();
}

// A Premier League match's moments, those of either side's players.
function matchEntries(r: Round, pm: PlMatch): Draft[] {
  const sides = r.byMatch.get(pm.id)!;
  const lines = sides.flat();
  if (!lines.some(([pid]) => r.shown(pid))) return [];
  const p = play(r, pm, sides, lines);
  kickOff(p);
  for (const moment of p.moments) MOMENTS[moment[2]](p, moment);
  hours(p);
  const done = r.isDone(pm);
  if (done || p.moments.some(([, half]) => half === 2)) halfTime(p);
  if (done) fullTime(p);
  return p.entries;
}

function play(r: Round, pm: PlMatch, sides: [PlLine[], PlLine[]], lines: PlLine[]): Play {
  const ko = Date.parse(pm.ko!);
  const ids = sides.map((side) => side.map(([pid]) => pid)) as [number[], number[]];
  const moments = withFplAssists(r.stats.moments?.[pm.id] ?? [], ids, (pid) => pm.events?.[pid]?.assists ?? 0);
  const cells = r.stats.matches[pm.id] ?? {};
  return {
    r,
    pm,
    lines,
    moments,
    home: new Set(ids[0]),
    ko,
    stat: (pid, name) => cells[pid]?.[PL_STATS.indexOf(name)] ?? 0,
    ...stints(lines, moments, ko),
    given: new Map(),
    conceded: new Map(),
    goals: new Map(),
    score: [0, 0],
    entries: [],
  };
}

// On the pitch from kick-off (or coming on) until going off or a red card.
function stints(lines: PlLine[], moments: PlMoment[], ko: number) {
  const on = new Map<number, number>();
  const off = new Map<number, number>();
  for (const [pid, , , started] of lines) if (started) on.set(pid, ko);
  for (const [min, half, kind, pid, other] of moments) {
    const t = timeOf(ko, min, half);
    if (kind === 'sub') on.set(pid, t);
    if (kind === 'sub' && other) off.set(other, t);
    if (kind === 'red' || kind === 'second') off.set(pid, t);
  }
  return { on, off };
}

const playing = (p: Play, pid: number, t: number) => (p.on.get(pid) ?? Infinity) <= t && t < (p.off.get(pid) ?? Infinity);

function player(p: Play, pid: number, pts: number, more: Partial<EntryPlayer> = {}): EntryPlayer {
  p.given.set(pid, (p.given.get(pid) ?? 0) + pts);
  const { side, bench } = p.r.ours.get(pid)!;
  return { pid, side, bench, pts, ...more };
}

function add(p: Play, e: Omit<Draft, 'match'>) {
  if (e.players.length) p.entries.push({ ...e, match: p.pm });
}

function kickOff(p: Play) {
  const starters = p.lines.filter(([pid, , , started]) => started && p.r.shown(pid));
  add(p, { at: p.ko, minute: 'KO', kind: 'kickoff', players: starters.map(([pid]) => player(p, pid, p.r.rule('short_play'))) });
}

function goal(p: Play, moment: PlMoment) {
  const { r } = p;
  const [min, half, kind, pid, other] = moment;
  const t = timeOf(p.ko, min, half);
  const forHome = countsForHome(p.home, moment);
  p.score[forHome ? 0 : 1]++;
  const players: EntryPlayer[] = [];
  if (r.shown(pid))
    players.push(
      kind === 'own'
        ? player(p, pid, r.rule('own_goals'), { what: 'Own goal' })
        : player(p, pid, r.rule(`goals_scored_${r.pos(pid)}`), { what: 'Goal' }),
    );
  if (other && r.shown(other) && p.stat(other, 'assists') > 0) players.push(player(p, other, r.rule('assists'), { what: 'Assist' }));
  players.push(...concededPoints(p, forHome, t));
  const e: Draft = {
    at: t,
    minute: minuteText(min, half),
    kind: kind === 'own' ? 'own' : 'goal',
    match: p.pm,
    matchScore: [...p.score],
    players,
  };
  p.goals.set(t, e);
  add(p, e);
}

// Every so many goals conceded while he's on the pitch cost a keeper or a defender a point.
function concededPoints(p: Play, forHome: boolean, t: number): EntryPlayer[] {
  const { r } = p;
  const conceding = (def: number) => r.shown(def) && p.home.has(def) !== forHome && playing(p, def, t);
  const players: EntryPlayer[] = [];
  for (const [def] of p.lines) {
    const pts = r.rule(`goals_conceded_${r.pos(def)}`);
    if (!pts || !conceding(def)) continue;
    const n = (p.conceded.get(def) ?? 0) + 1;
    p.conceded.set(def, n);
    if (n % (r.rule('concede_limit') || 2) === 0) players.push(player(p, def, pts, { what: 'Goals conceded' }));
  }
  return players;
}

function card(kind: 'yellow' | 'red', pts: (rule: Round['rule']) => number, what?: string) {
  return (p: Play, [min, half, , pid]: PlMoment) => {
    if (!p.r.shown(pid)) return;
    add(p, { at: timeOf(p.ko, min, half), minute: minuteText(min, half), kind, players: [player(p, pid, pts(p.r.rule), { what })] });
  };
}

function substitution(p: Play, [min, half, , pid, other]: PlMoment) {
  const { r } = p;
  const players = [
    ...(r.shown(pid) ? [player(p, pid, r.rule('short_play'), { what: 'On', other })] : []),
    ...(other && r.shown(other) ? [player(p, other, 0, { what: 'Off', other: pid })] : []),
  ];
  add(p, { at: timeOf(p.ko, min, half), minute: minuteText(min, half), kind: 'sub', players });
}

// A red card's points include the yellow's, so a second yellow adds the difference.
const MOMENTS: Record<PlMoment[2], (p: Play, moment: PlMoment) => void> = {
  goal,
  pen: goal,
  own: goal,
  yellow: card('yellow', (rule) => rule('yellow_cards')),
  second: card('red', (rule) => rule('red_cards') - rule('yellow_cards'), 'Second yellow'),
  red: card('red', (rule) => rule('red_cards')),
  sub: substitution,
};

// An hour played: FPL's second appearance point, and for the momentum a clean sheet with it.
function hours(p: Play) {
  const { r, ko } = p;
  const hour = r.rule('long_play_limit') || 60;
  const byTime = new Map<number, EntryPlayer[]>();
  for (const [pid, min] of p.lines) {
    if (!r.shown(pid) || min < hour) continue;
    const on = p.on.get(pid) ?? ko;
    // Half-time comes in between for one on in the first half.
    const t = on + hour * 60_000 + (on < ko + 60 * 60_000 ? 15 * 60_000 : 0);
    const players = [player(p, pid, r.rule('long_play') - r.rule('short_play'))];
    if (r.liveSheets) players.push(...cleanSheet(p, pid, t));
    byTime.set(t, [...(byTime.get(t) ?? []), ...players]);
  }
  for (const [t, players] of byTime) add(p, { at: t, minute: `${Math.round((t - ko) / 60_000) - 15}’`, kind: 'hour', players });
}

// A clean sheet at his hour if none has gone in against his side since he came on, gone
// again at the first that does while he's still on.
function cleanSheet(p: Play, pid: number, hour: number): EntryPlayer[] {
  const pts = p.r.rule(`clean_sheets_${p.r.pos(pid)}`);
  const against = p.moments
    .filter((mo) => isGoal(mo[2]) && countsForHome(p.home, mo) !== p.home.has(pid))
    .map(([min, half]) => timeOf(p.ko, min, half))
    .filter((t) => playing(p, pid, t));
  if (!pts || against.some((t) => t <= hour)) return [];
  const goal = p.goals.get(Math.min(...against));
  if (goal) {
    if (!goal.players.length) p.entries.push(goal);
    goal.players.push(player(p, pid, -pts, { what: 'Clean sheet lost' }));
  }
  return [player(p, pid, pts, { what: 'Clean sheet' })];
}

function halfTime(p: Play) {
  const firstHalf = p.moments.filter(([, half]) => half === 1).map(([min]) => min);
  p.entries.push({
    at: timeOf(p.ko, Math.max(45, ...firstHalf), 1) + 30_000,
    minute: 'HT',
    kind: 'halftime',
    match: p.pm,
    matchScore: halfTimeScore(p.moments, p.home),
    players: [],
  });
}

function halfTimeScore(moments: PlMoment[], home: Set<number>): [number, number] {
  const score: [number, number] = [0, 0];
  for (const moment of moments.filter(([, half, kind]) => half === 1 && isGoal(kind))) score[countsForHome(home, moment) ? 0 : 1]++;
  return score;
}

// Full time: what FPL hands out at the end, and whatever else is in a player's points.
function fullTime(p: Play) {
  const players = p.lines.filter(([pid]) => p.r.shown(pid)).flatMap((line) => awards(p, line));
  p.entries.push({ at: endOf(p.r.stats, p.pm), minute: 'FT', kind: 'fulltime', match: p.pm, matchScore: p.pm.score, players });
}

function awards(p: Play, [pid, , pts]: PlLine): EntryPlayer[] {
  const { rule } = p.r;
  const stat = (name: PlStat) => p.stat(pid, name);
  const pos = p.r.pos(pid);
  const limit = rule(`defensive_contribution_limit_${pos}`);
  // Less what his hour put down to him already, when that counts the clean sheets live.
  const live = p.entries.flatMap((e) => e.players.filter((x) => x.pid === pid && x.what?.startsWith('Clean sheet')));
  const values: [string, number][] = [
    ['Clean sheet', stat('clean_sheets') * rule(`clean_sheets_${pos}`) - live.reduce((t, x) => t + x.pts, 0)],
    ['Saves', Math.floor(stat('saves') / (rule('saves_limit') || 3)) * rule('saves')],
    ['Penalty saved', stat('penalties_saved') * rule('penalties_saved')],
    ['Penalty missed', stat('penalties_missed') * rule('penalties_missed')],
    ['Defensive contribution', limit && stat('defensive_contribution') >= limit ? rule(`defensive_contribution_${pos}`) : 0],
    ['Bonus', stat('bonus') * (rule('bonus') || 1)],
  ];
  const awarded = values.filter(([, value]) => value).map(([what, value]) => player(p, pid, value, { what }));
  // Once those are put down to him, so this is what's left.
  const other = pts - (p.given.get(pid) ?? 0);
  return other ? [...awarded, player(p, pid, other, { what: 'Other points' })] : awarded;
}

// An automatic substitute was on the bench until the substitution was made: once his
// starter was sure not to play, or once he'd come on himself if that was later. Until
// then what he did doesn't count (and shows only with the benches), and then all of it
// comes in at once.
function addAutoSubs(r: Round, lineups: [Lineup, Lineup], entries: Draft[]) {
  for (const [side, l] of lineups.entries())
    (l.subs ?? []).forEach((sub, i) => {
      const e = autoSub(r, entries, side as 0 | 1, sub, l.off?.[i]);
      if (e) entries.push(e);
    });
}

function autoSub(r: Round, entries: Draft[], side: 0 | 1, sub: number, starter: number | undefined): Draft | null {
  const made = madeAt(r, sub, starter);
  if (!made) return null;
  const cameIn: EntryPlayer = { pid: sub, side, bench: false, pts: benchUntil(entries, sub, made.at), what: 'Came in' };
  const players =
    starter === undefined
      ? [cameIn]
      : [
          { ...cameIn, other: starter },
          { pid: starter, side, bench: false, pts: 0, what: made.why },
        ];
  return { at: made.at + 1, minute: made.minute, kind: 'autosub', match: made.match, players };
}

// Made at the later of the two, in that one's match; with why his starter went out.
function madeAt(r: Round, sub: number, starter: number | undefined) {
  const ended = starter === undefined ? null : outFrom(r, starter);
  const came = firstOn(r, sub);
  const made = ended && (!came || ended.at >= came.at) ? ended : came;
  return made && { at: made.at, match: made.match, minute: made.minute, why: ended?.what ?? 'Didn’t play' };
}

// Puts a substitute's moments from before he came in on the bench, and counts their points.
function benchUntil(entries: Draft[], pid: number, at: number) {
  const his = entries.filter((e) => e.at < at).flatMap((e) => e.players.filter((p) => p.pid === pid));
  for (const p of his) p.bench = true;
  return his.reduce((total, p) => total + p.pts, 0);
}

// When a match ended, as its full time entry has it.
function endOf(stats: PlStats, pm: PlMatch) {
  const last = Math.max(90, ...(stats.moments?.[pm.id] ?? []).filter(([, half]) => half === 2).map(([min]) => min));
  return timeOf(Date.parse(pm.ko ?? ''), last, 2) + 30_000;
}

// When a starter was sure not to play in the gameweek, and in which match: once each of his
// club's matches was over, or kicked off without him in the squad, the last of them. Null
// while he might still play.
function outFrom(r: Round, pid: number) {
  const club = r.data.players[pid]?.club;
  let last: (When & { what: string }) | null = null;
  for (const match of (r.data.plMatches ?? []).filter((pm) => pm.gw === r.gw && (pm.home === club || pm.away === club))) {
    const out = missed(r, match, pid);
    if (!out) return null;
    if (!last || out.at > last.at) last = out;
  }
  return last;
}

function missed(r: Round, match: PlMatch, pid: number) {
  if (r.isDone(match)) return { at: endOf(r.stats, match), match, minute: 'FT', what: 'Didn’t play' };
  if (match.formations && match.ko && !named(match, pid))
    return { at: Date.parse(match.ko), match, minute: 'KO', what: 'Not in the squad' };
  return null;
}

const named = (pm: PlMatch, pid: number) => pm.formations?.some((f) => f.lines.some((line) => line.includes(pid)) || f.subs.includes(pid));

// When a player first came on in the gameweek, in which match and at what minute: its
// kick-off if he started it.
function firstOn(r: Round, pid: number) {
  const times = (r.data.plMatches ?? [])
    .filter((pm) => pm.gw === r.gw && pm.ko)
    .flatMap((match) => cameOn(r, match, pid))
    .sort((a, b) => a.at - b.at);
  return times[0] ?? null;
}

function cameOn(r: Round, match: PlMatch, pid: number): When[] {
  const line = r.byMatch
    .get(match.id)
    ?.flat()
    .find(([id]) => id === pid);
  if (!line) return [];
  const ko = Date.parse(match.ko!);
  if (line[3]) return [{ at: ko, match, minute: 'KO' }];
  const on = (r.stats.moments?.[match.id] ?? []).find(([, , kind, id]) => kind === 'sub' && id === pid);
  return on ? [{ at: timeOf(ko, on[0], on[1]), match, minute: minuteText(on[0], on[1]) }] : [];
}
