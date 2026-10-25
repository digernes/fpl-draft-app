// Live scoring shared by the page, the build and the Cloudflare Worker: a slim copy of
// the FPL live feed (with what each player did), provisional bonus, and provisional
// automatic substitutions.

import type { Formation, PlFormation, PlMoment, PlStats, Position } from './data.ts';
import type { LiveFeed } from './fpl-api.ts';

export interface SlimFixture {
  id: number;
  h: number;
  a: number;
  started: boolean;
  done: boolean;
  /** Kick-off time. */
  ko?: string;
  /** Minutes played, while the match is on. */
  min?: number;
  /** The score, once it has kicked off. */
  score?: [number, number];
  /** [element, minutes] for the starters no longer on the pitch (taken off or sent off), while the match is on. */
  off?: [number, number][];
  /** [element, BPS] while the bonus is still to be awarded. */
  bps?: [number, number][];
}

export interface SlimLive {
  /** element id → [points, minutes] */
  elements: Record<string, [number, number]>;
  /** element id → what he did, for anyone who did something. Missing from older feeds. */
  events?: Record<string, PlayerEvents>;
  fixtures: SlimFixture[];
  /**
   * From the relay only: the matches being played or just over, which the gameweek's stats
   * file has (as of the last build) or not yet. Everyone's stats in each, as that file's,
   * and its moments from the match centre, by player codes rather than ids.
   */
  matches?: PlStats['matches'];
  moments?: Record<string, PlMoment[]>;
}

/** What a player did in a gameweek, for the icons around his photo. Counts are left out when 0. */
export interface PlayerEvents {
  goals?: number;
  assists?: number;
  ownGoals?: number;
  yellow?: number;
  red?: number;
  pensSaved?: number;
  pensMissed?: number;
  /** Bonus points awarded (the provisional bonus is worked out from the BPS instead). */
  bonus?: number;
  /** Came on as a substitute, or was taken off. */
  on?: number;
  off?: number;
  /** The minute he came on: his match's minute less his own. */
  onAt?: number;
  /** Minutes played, for a substitution's tooltip. */
  min?: number;
  /** In a Premier League match's events only: a clean sheet that scored, saves (FPL lists them once they score), and a defensive contribution that reached FPL's threshold. */
  cleanSheet?: number;
  saves?: number;
  defcon?: number;
}

/** `status` is FPL's: a(vailable), d(oubtful), i(njured), s(uspended), u(navailable), n(ot eligible). */
export type PlayerInfo = (id: number) => { pos: Position | undefined; club: number | undefined; status?: string };

/** Once his club has named its team for a fixture: in its XI, on its bench or neither. */
export type Named = (id: number, fixture: number) => 'xi' | 'bench' | 'out' | undefined;

/** Who each club named, from the fixtures' formations where the Premier League has them (home's and away's). */
export function namedFrom(formations: (fixture: number) => readonly [PlFormation, PlFormation] | undefined): Named {
  return (id, fixture) => {
    const sides = formations(fixture);
    if (!sides) return undefined;
    if (sides.some((side) => side.lines.some((line) => line.includes(id)))) return 'xi';
    return sides.some((side) => side.subs.includes(id)) ? 'bench' : 'out';
  };
}

export const DEFAULT_FORMATION: Formation = { DEF: 3, MID: 2, FWD: 1 };

const legal = (lineup: number[], info: PlayerInfo, formation: Formation) =>
  Object.entries(formation).every(([pos, min]) => lineup.filter((id) => info(id).pos === pos).length >= min);

// Whether a bench player can come on for a starter: a goalkeeper only for a goalkeeper, and
// only keeping the formation legal.
export const canReplace = (starter: number, candidate: number, xi: number[], info: PlayerInfo, formation: Formation) =>
  (info(candidate).pos === 'GKP') === (info(starter).pos === 'GKP') &&
  legal(
    xi.map((id) => (id === starter ? candidate : id)),
    info,
    formation,
  );

export interface Scored {
  xi: number[];
  bench: number[];
  /** Bench players brought on. */
  subs: number[];
  /** The starters they came on for, in the same order. */
  off: number[];
  pts: number;
  points: (id: number) => number;
}

// A player's points (provisional bonus aside) and minutes in the feed.
export const pointsOf = (feed: SlimLive, id: number) => Number(feed.elements[id]?.[0]) || 0;
export const minutesOf = (feed: SlimLive, id: number) => Number(feed.elements[id]?.[1]) || 0;

// A club's fixtures in the gameweek: none in a blank, two in a double.
export const clubFixtures = (feed: SlimLive, club: number | undefined) => feed.fixtures.filter((f) => f.h === club || f.a === club);

export const isOn = (f: SlimFixture) => f.started && !f.done;

// The FPL live feed is ~450 KB; this keeps what live scores need (~25 KB).
// elements: { id: [points, minutes] } for anyone with either; events for anyone who
// did something; fixtures keep the BPS list only while their bonus has not been
// awarded yet.
export function slimLive(raw: Partial<LiveFeed>): SlimLive {
  const players = Object.entries(raw.elements ?? {});
  const over = new Set((raw.fixtures ?? []).filter(isOver).map((f) => f.id));
  const clock = matchClock(players.map(([, el]) => el));
  const elements: SlimLive['elements'] = {};
  const events: Record<string, PlayerEvents> = {};
  const gone = new Map<number, [number, number][]>();
  for (const [id, el] of players) {
    const { total_points: points, minutes } = el.stats;
    if (points || minutes) elements[id] = [points, minutes];
    const did = playerEvents(el, over, clock);
    if (did) events[id] = did;
    for (const m of offThePitch(el, over, clock)) gone.set(m.fixture, [...(gone.get(m.fixture) ?? []), [Number(id), m.min]]);
  }
  const fixtures = (raw.fixtures ?? []).map((f) => slimFixture(f, clock, gone.get(f.id)));
  return { elements, events, fixtures };
}

type FeedElement = LiveFeed['elements'][string];
type FeedFixture = LiveFeed['fixtures'][number];

const isOver = (f: FeedFixture) => Boolean(f.finished || f.finished_provisional);

// FPL's fixture minutes stay at 0 while a match is on; its players' minutes don't.
function matchClock(players: FeedElement[]): Map<number, number> {
  const clock = new Map<number, number>();
  for (const el of players) for (const { fixture, min } of minutesIn(el)) if (min > (clock.get(fixture) ?? 0)) clock.set(fixture, min);
  return clock;
}

// The matches still on that he's no longer on the pitch in. A starter short of one is off,
// only when he started all his matches (FPL counts starts for the gameweek, not the match);
// and one sent off is off at once, starter or not, rather than once his minutes fall behind.
function offThePitch(el: FeedElement, over: Set<number>, clock: Map<number, number>) {
  const played = minutesIn(el).filter((m) => m.min > 0);
  const started = (el.stats.starts ?? 0) >= played.length;
  const sentOff = sentOffIn(el);
  return played.filter((m) => !over.has(m.fixture)).filter((m) => sentOff.has(m.fixture) || (started && short(m, over, clock)));
}

function slimFixture(f: FeedFixture, clock: Map<number, number>, off: [number, number][] | undefined): SlimFixture {
  return {
    id: f.id,
    h: f.team_h,
    a: f.team_a,
    started: Boolean(f.started),
    done: isOver(f),
    ...(f.kickoff_time ? { ko: f.kickoff_time } : {}),
    ...(f.started ? kickedOff(f, clock, off) : {}),
  };
}

// What a match has once it has kicked off: while it's on, its minute and who has gone off;
// the score; and the BPS while the bonus is still to be awarded.
function kickedOff(f: FeedFixture, clock: Map<number, number>, off: [number, number][] | undefined) {
  return {
    ...(isOver(f) ? {} : { min: Math.max(f.minutes ?? 0, clock.get(f.id) ?? 0), ...(off ? { off } : {}) }),
    score: [f.team_h_score ?? 0, f.team_a_score ?? 0] as [number, number],
    ...pendingBps(f),
  };
}

function pendingBps(f: FeedFixture): Pick<SlimFixture, 'bps'> {
  const stat = (name: string) => f.stats?.find((s) => s.s === name);
  const bonus = stat('bonus');
  const bps = stat('bps');
  const awarded = f.finished || (bonus && bonus.h.length + bonus.a.length);
  return awarded || !bps ? {} : { bps: [...bps.h, ...bps.a].map((b): [number, number] => [b.element, b.value]) };
}

const minutesIn = ({ explain = [] }: FeedElement) =>
  explain.map(([stats, fixture]) => ({ fixture, min: stats.find((x) => x.stat === 'minutes')?.value ?? 0 }));

// The matches he was sent off in, as FPL explains his points.
const sentOffIn = ({ explain = [] }: FeedElement) =>
  new Set(explain.flatMap(([stats, fixture]) => (stats.some((x) => x.stat === 'red_cards' && x.value > 0) ? [fixture] : [])));

// A match's minute: 90 once it is over, or while it's on the most anyone has played.
const minuteOf = (fixture: number, over: Set<number>, clock: Map<number, number>) => (over.has(fixture) ? 90 : (clock.get(fixture) ?? 0));

// Short of a match: under 90 minutes in one that is over, or, while it's on, more than a
// minute behind the players still on the pitch, who all have its minute.
const short = (m: { fixture: number; min: number }, over: Set<number>, clock: Map<number, number>) =>
  m.min > 0 && m.min < minuteOf(m.fixture, over, clock) - (over.has(m.fixture) ? 0 : 1);

// FPL doesn't list substitutions, so they come from the minutes in each match: a
// player who played in more matches than he started came on, and a starter short of a
// match went off, unless he was sent off.
function playerEvents(el: FeedElement, over: Set<number>, clock: Map<number, number>): PlayerEvents | undefined {
  const { stats: s } = el;
  const minutes = minutesIn(el);
  const played = minutes.filter((m) => m.min > 0).length;
  const on = s.starts === undefined ? 0 : Math.max(0, played - s.starts);
  const off = s.starts === undefined ? 0 : Math.max(0, minutes.filter((m) => short(m, over, clock)).length - on - (s.red_cards ?? 0));
  const counts: PlayerEvents = {
    goals: s.goals_scored,
    assists: s.assists,
    ownGoals: s.own_goals,
    yellow: s.yellow_cards,
    red: s.red_cards,
    pensSaved: s.penalties_saved,
    pensMissed: s.penalties_missed,
    bonus: s.bonus,
    on,
    off,
    onAt: on ? Math.max(...minutes.filter((m) => m.min > 0).map((m) => minuteOf(m.fixture, over, clock) - m.min)) : 0,
    min: on || off ? s.minutes : 0,
  };
  const did = Object.entries(counts).filter(([, n]) => n);
  return did.length ? Object.fromEntries(did) : undefined;
}

// Bonus as it stands for fixtures still waiting for it: the top three BPS get 3, 2
// and 1, ties share a place, and a tie pushes the next place down (FPL's rule).
export function provisionalBonus(fixtures: SlimFixture[]): Map<number, number> {
  const bonus = new Map<number, number>();
  for (const f of fixtures) {
    if (!f.bps?.length) continue;
    const ranked = [...f.bps].sort((a, b) => b[1] - a[1]);
    let place = 1;
    for (let i = 0; i < ranked.length && place <= 3;) {
      let j = i;
      while (j < ranked.length && ranked[j][1] === ranked[i][1]) j++;
      for (let k = i; k < j; k++) bonus.set(Number(ranked[k][0]), (bonus.get(Number(ranked[k][0])) ?? 0) + 4 - place);
      place += j - i;
      i = j;
    }
  }
  return bonus;
}

// A manager's live score from their picks (`order`: positions 1–15). A starter sure not
// to play makes way for the first bench player who did play and keeps the formation
// legal; a goalkeeper only for the bench goalkeeper. Sure: no minutes, and each of his
// club's fixtures over or one he isn't in the squad for, by the teams the Premier League
// has named (`named`), so the substitution comes ahead of FPL's at the end of the
// gameweek. A bench player who may still play holds the queue, as FPL would wait for
// him. `info(id)` gives { pos, club }; `formation` the minimum numbers.
export function scoreLineup(order: number[], feed: SlimLive, info: PlayerInfo, formation = DEFAULT_FORMATION, named?: Named): Scored {
  const bonus = provisionalBonus(feed.fixtures);
  const points = (id: number) => pointsOf(feed, id) + (bonus.get(id) ?? 0);
  const played = (id: number) => minutesOf(feed, id) > 0;
  // With no fixture at all his club has a blank, so his gameweek is over.
  const out = (id: number) => !played(id) && clubFixtures(feed, info(id).club).every((f) => f.done || named?.(id, f.id) === 'out');

  const xi = order.slice(0, 11);
  const bench = order.slice(11);
  const subs: number[] = [];
  const off: number[] = [];
  for (const starter of xi.filter(out)) {
    // The first bench player who fits and may play comes on once he has played.
    const next = bench.find((candidate) => !out(candidate) && canReplace(starter, candidate, xi, info, formation));
    if (next === undefined || !played(next)) continue;
    xi.splice(xi.indexOf(starter), 1, next);
    bench.splice(bench.indexOf(next), 1, starter);
    subs.push(next);
    off.push(starter);
  }
  return { xi, bench, subs, off, pts: xi.reduce((total, id) => total + points(id), 0), points };
}

// --- Who is still to play ------------------------------------------------------

export type PlayerState =
  | { state: 'live'; min: number; on: boolean } // his club's match is on, with him on the pitch or not (yet)
  | { state: 'off'; min: number } // taken off or sent off in a match still on, after `min` minutes
  | { state: 'done' } // all his club's matches are over
  | { state: 'due'; ko?: string; opp: number; home: boolean } // still to kick off (the next one, in a double gameweek)
  | { state: 'blank' }; // his club has no match this gameweek

export const offIn = (f: SlimFixture, id: number) => f.off?.find(([pid]) => pid === id);

// On the pitch in a match being played: in the relay's stats for it, or without them, with
// minutes this gameweek.
function isOnPitch(feed: SlimLive, f: SlimFixture, id: number) {
  const stats = feed.matches?.[f.id];
  return stats ? id in stats : minutesOf(feed, id) > 0;
}

const nextKickOff = (fixtures: SlimFixture[]) =>
  fixtures.filter((f) => !f.started).sort((a, b) => (a.ko ?? '').localeCompare(b.ko ?? ''))[0];

export function playerState(feed: SlimLive, id: number, club: number | undefined): PlayerState {
  const fixtures = clubFixtures(feed, club);
  if (!fixtures.length) return { state: 'blank' };
  const playing = fixtures.find(isOn);
  const off = playing && offIn(playing, id);
  if (playing && !off) return { state: 'live', min: playing.min ?? 0, on: isOnPitch(feed, playing, id) };
  const next = nextKickOff(fixtures);
  if (next) return { state: 'due', ko: next.ko, opp: next.h === club ? next.a : next.h, home: next.h === club };
  return off ? { state: 'off', min: off[1] } : { state: 'done' };
}

// How much of a player's gameweek is still to come: 1 before kick-off, falling to 0 at
// full time (or once he's off), split evenly over a double gameweek's two matches.
export function shareToCome(feed: SlimLive, id: number, club: number | undefined): number {
  const fixtures = clubFixtures(feed, club);
  if (!fixtures.length) return 0;
  const left = (f: SlimFixture) => (f.done || offIn(f, id) ? 0 : f.started ? Math.max(0, 1 - (f.min ?? 0) / 90) : 1);
  return fixtures.reduce((total, f) => total + left(f), 0) / fixtures.length;
}
