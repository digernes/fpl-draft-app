// Live scoring shared by the page, the build and the Cloudflare Worker: a slim copy of
// the FPL live feed (with what each player did), provisional bonus, and provisional
// automatic substitutions.

import type { Formation, PlMoment, PlStats, Position, XpParts } from './data.ts';
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

const DEFAULT_FORMATION: Formation = { DEF: 3, MID: 2, FWD: 1 };

const legal = (lineup: number[], info: PlayerInfo, formation: Formation) =>
  Object.entries(formation).every(([pos, min]) => lineup.filter((id) => info(id).pos === pos).length >= min);

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

// The FPL live feed is ~450 KB; this keeps what live scores need (~25 KB).
// elements: { id: [points, minutes] } for anyone with either; events for anyone who
// did something; fixtures keep the BPS list only while their bonus has not been
// awarded yet.
export function slimLive(raw: Partial<LiveFeed>): SlimLive {
  const elements: SlimLive['elements'] = {};
  const events: Record<string, PlayerEvents> = {};
  const over = new Set((raw.fixtures ?? []).filter((f) => f.finished || f.finished_provisional).map((f) => f.id));
  // FPL's fixture minutes stay at 0 while a match is on; its players' minutes don't.
  const clock = new Map<number, number>();
  for (const el of Object.values(raw.elements ?? {}))
    for (const { fixture, min } of minutesIn(el)) if (min > (clock.get(fixture) ?? 0)) clock.set(fixture, min);
  const gone = new Map<number, [number, number][]>();
  for (const [id, el] of Object.entries(raw.elements ?? {})) {
    const { total_points: points, minutes } = el.stats;
    if (points || minutes) elements[id] = [points, minutes];
    const did = playerEvents(el, over, clock);
    if (did) events[id] = did;
    // A starter short of a match still on is off the pitch. Only when he started all his
    // matches, since FPL counts starts for the gameweek, not the match.
    const played = minutesIn(el).filter((m) => m.min > 0);
    if ((el.stats.starts ?? 0) < played.length) continue;
    for (const m of played)
      if (!over.has(m.fixture) && short(m, over, clock)) gone.set(m.fixture, [...(gone.get(m.fixture) ?? []), [Number(id), m.min]]);
  }
  const fixtures = (raw.fixtures ?? []).map((f): SlimFixture => {
    const stat = (name: string) => f.stats?.find((s) => s.s === name);
    const bonus = stat('bonus');
    const bonusIn = Boolean(f.finished || (bonus && bonus.h.length + bonus.a.length));
    const bps = stat('bps');
    return {
      id: f.id,
      h: f.team_h,
      a: f.team_a,
      started: Boolean(f.started),
      done: Boolean(f.finished || f.finished_provisional),
      ...(f.kickoff_time ? { ko: f.kickoff_time } : {}),
      ...(f.started && !(f.finished || f.finished_provisional)
        ? {
            min: Math.max(f.minutes ?? 0, clock.get(f.id) ?? 0),
            ...(gone.has(f.id) ? { off: gone.get(f.id) } : {}),
          }
        : {}),
      ...(f.started ? { score: [f.team_h_score ?? 0, f.team_a_score ?? 0] as [number, number] } : {}),
      ...(f.started && !bonusIn && bps ? { bps: [...bps.h, ...bps.a].map((b): [number, number] => [b.element, b.value]) } : {}),
    };
  });
  return { elements, events, fixtures };
}

type FeedElement = LiveFeed['elements'][string];

const minutesIn = ({ explain = [] }: FeedElement) =>
  explain.map(([stats, fixture]) => ({ fixture, min: stats.find((x) => x.stat === 'minutes')?.value ?? 0 }));

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

// A manager's live score from their picks (`order`: positions 1–15). A starter who
// got no minutes once all his club's fixtures are over makes way for the first bench
// player who did play and keeps the formation legal; a goalkeeper only for the bench
// goalkeeper. A bench player whose match is still to come holds the queue, as FPL
// would wait for him. `info(id)` gives { pos, club }; `formation` the minimum numbers.
export function scoreLineup(order: number[], feed: SlimLive, info: PlayerInfo, formation = DEFAULT_FORMATION): Scored {
  const bonus = provisionalBonus(feed.fixtures);
  const points = (id: number) => (Number(feed.elements[id]?.[0]) || 0) + (bonus.get(id) ?? 0);
  const played = (id: number) => (Number(feed.elements[id]?.[1]) || 0) > 0;
  const clubDone = new Map<number, boolean>();
  for (const f of feed.fixtures) for (const club of [f.h, f.a]) clubDone.set(club, (clubDone.get(club) ?? true) && f.done);
  const done = (id: number) => clubDone.get(info(id).club as number) ?? true; // no fixture at all: a blank, so done

  const xi = order.slice(0, 11);
  const bench = order.slice(11);
  const subs: number[] = [];
  const off: number[] = [];
  for (const starter of [...xi]) {
    if (played(starter) || !done(starter)) continue;
    const goalkeeper = info(starter).pos === 'GKP';
    for (const candidate of bench) {
      if ((info(candidate).pos === 'GKP') !== goalkeeper) continue;
      if (
        !legal(
          xi.map((id) => (id === starter ? candidate : id)),
          info,
          formation,
        )
      )
        continue;
      if (!played(candidate)) {
        if (done(candidate)) continue; // didn't play either: skip him
        break; // might still play: wait, like FPL does
      }
      xi.splice(xi.indexOf(starter), 1, candidate);
      bench.splice(bench.indexOf(candidate), 1, starter);
      subs.push(candidate);
      off.push(starter);
      break;
    }
  }
  return { xi, bench, subs, off, pts: xi.reduce((total, id) => total + points(id), 0), points };
}

// --- Who is still to play ------------------------------------------------------

export type PlayerState =
  | { state: 'live'; min: number } // his club's match is on, and he's on the pitch or the bench
  | { state: 'off'; min: number } // taken off or sent off in a match still on, after `min` minutes
  | { state: 'done' } // all his club's matches are over
  | { state: 'due'; ko?: string; opp: number; home: boolean } // still to kick off (the next one, in a double gameweek)
  | { state: 'blank' }; // his club has no match this gameweek

const offIn = (f: SlimFixture, id: number) => f.off?.find(([pid]) => pid === id);

export function playerState(feed: SlimLive, id: number, club: number | undefined): PlayerState {
  const fixtures = feed.fixtures.filter((f) => f.h === club || f.a === club);
  if (!fixtures.length) return { state: 'blank' };
  const playing = fixtures.find((f) => f.started && !f.done);
  const off = playing && offIn(playing, id);
  if (playing && !off) return { state: 'live', min: playing.min ?? 0 };
  const next = fixtures.filter((f) => !f.started).sort((a, b) => (a.ko ?? '').localeCompare(b.ko ?? ''))[0];
  if (next) return { state: 'due', ko: next.ko, opp: next.h === club ? next.a : next.h, home: next.h === club };
  return off ? { state: 'off', min: off[1] } : { state: 'done' };
}

// How much of a player's gameweek is still to come: 1 before kick-off, falling to 0 at
// full time (or once he's off), split evenly over a double gameweek's two matches.
export function shareToCome(feed: SlimLive, id: number, club: number | undefined): number {
  const fixtures = feed.fixtures.filter((f) => f.h === club || f.a === club);
  if (!fixtures.length) return 0;
  const left = (f: SlimFixture) => (f.done || offIn(f, id) ? 0 : f.started ? Math.max(0, 1 - (f.min ?? 0) / 90) : 1);
  return fixtures.reduce((total, f) => total + left(f), 0) / fixtures.length;
}

/** Spread of one player's points over a full gameweek, for the live odds. */
export const PLAYER_POINTS_SD = 3;

const RULED_OUT = new Set(['i', 's', 'u', 'n']);

/** What a projection knows of each player's gameweek. */
export interface Expected {
  /** His expected points for the whole gameweek. */
  points: (id: number) => number;
  /** Those taken apart, when the site's model gave them: his minutes, and his appearance, clean-sheet and bonus points among them. */
  parts?: (id: number) => XpParts | undefined;
  /** Points for a clean sheet, by position. */
  cleanSheet?: Partial<Record<Position, number>>;
  /** Once his club has named its team for a fixture: in its XI, on its bench or neither. */
  named?: (id: number, fixture: number) => 'xi' | 'bench' | 'out' | undefined;
}

// A substitute comes on in about two matches in three, for a point or so, and the later it
// gets the less likely: from half an hour before the end the chance fades. (From the clubs'
// named substitutes this season, those expected to score at all.)
const SUB_ON = 0.65;
const SUB_POINTS = 1.3;
const stillToCome = (minute: number) => Math.min(1, Math.max(0, (90 - minute) / 30)) ** 0.7;

// The chance he plays at all, from his expected appearance points (2 for a regular). As
// this season's players have: one expected to earn 1.5 plays about 86% of the time, and
// even the surest only about 95%.
const playsGiven = (appearance: number) => Math.min(0.95, Math.max(0, appearance / 2) ** 0.6);

// Goals come more often as a match goes on, about 56% of them after half-time: the share
// of a match's goals (and of all that comes of them) still to come at a minute.
const stillToScore = (minute: number) => {
  const gone = Math.min(1, Math.max(0, minute / 90));
  return (1 - gone) * (1 + gone / 4);
};

/** Where a player's gameweek is heading. */
interface Outlook {
  /** What he can still add to his points. */
  add: number;
  /** The chance he doesn't play at all, when the bench player next in line comes on for him. */
  absent: number;
  /** How much of his gameweek is still to come, for the spread. */
  share: number;
}

// One fixture's outlook for a player with `played` minutes so far, from his expected
// points and their parts for it. Before kick-off: those, or once his club has named its
// team, what a starter can expect (his expected points given he plays) or a substitute.
// Once it's on, if he's on the pitch: his goals, assists and the rest at his rate a minute
// for the time he's likely to stay on, the appearance point still to come at 60 minutes,
// the chance of keeping (or still getting) a clean sheet, and the provisional bonus drawn
// towards his expected bonus by the share of the match still to play. If he isn't, the
// chance he still comes on. FPL's own expected points come whole, so without the parts a
// player on the pitch has a share of them.
function fixtureOutlook(
  id: number,
  f: SlimFixture,
  played: number,
  [ep, parts]: [number, XpParts | undefined],
  info: PlayerInfo,
  expected: Expected,
  ctx: { bonus: Map<number, number>; cameOn: boolean },
): Outlook {
  if (f.done || offIn(f, id)) return { add: 0, absent: played > 0 ? 0 : 1, share: 0 };
  const minute = f.started ? (f.min ?? 0) : 0;
  const left = Math.max(0, 90 - minute);
  const plays = parts ? playsGiven(parts[1]) : 1;
  const named = expected.named?.(id, f.id);
  const onPitch = f.started && (played > 0 || (named === 'xi' && minute < 3)); // the feed's minutes lag at kick-off
  if (!f.started || (minute < 3 && !onPitch)) {
    if (named === 'out') return { add: 0, absent: 1, share: 0 };
    if (named === 'bench') return { add: SUB_ON * SUB_POINTS, absent: 1 - SUB_ON, share: SUB_ON };
    if (named === 'xi') return { add: plays > 0 ? ep / plays : ep, absent: 0, share: 1 };
    // Until then a manager has picked him knowing the news, so only FPL's doubt counts.
    return { add: ep, absent: info(id).status === 'd' ? 1 - plays : 0, share: 1 };
  }
  if (!onPitch) {
    if (named === 'out') return { add: 0, absent: 1, share: 0 };
    const comesOn = SUB_ON * stillToCome(minute);
    return { add: comesOn * SUB_POINTS, absent: 1 - comesOn, share: (comesOn * left) / 90 };
  }
  if (!parts) return { add: ep * stillToScore(minute), absent: 0, share: stillToScore(minute) };
  const [minutes, appearance, , , , cleanSheet, , , , bonus] = parts;
  const inMatch = Math.min(played, minute); // a double gameweek's other match aside
  const stays = ctx.cameOn ? 1 : Math.min(1, minutes / Math.max(plays, 0.01) / 90);
  const onFor = 90 * stillToScore(minute) * stays; // the minutes he's likely still on, weighted by when goals come
  let add = minutes > 0 ? ((ep - appearance - cleanSheet - bonus) / minutes) * onFor : 0;
  const need = 60 - inMatch;
  const sixty = need <= 0 ? 1 : need > left ? 0 : (0.85 + 0.12 * plays) ** (need / 15);
  if (need > 0) add += sixty;
  const perCleanSheet = expected.cleanSheet?.[info(id).pos ?? 'FWD'] ?? 0;
  const against = f.score?.[f.h === info(id).club ? 1 : 0] ?? 0;
  if (perCleanSheet > 0 && cleanSheet > 0 && !against) {
    const keepsIt = Math.min(0.95, cleanSheet / perCleanSheet / Math.max(0.3, plays)) ** (onFor / 90);
    add += need <= 0 ? perCleanSheet * (keepsIt - 1) : perCleanSheet * sixty * keepsIt; // FPL shows it from 60 minutes
  }
  add += (left / 90) * (bonus / Math.max(plays, 0.01) - (ctx.bonus.get(id) ?? 0));
  return { add, absent: 0, share: stillToScore(minute) };
}

// His outlook over the gameweek: each of his club's fixtures, two in a double gameweek with
// his expected points split between them, and he's absent only if he misses them all.
function outlook(id: number, feed: SlimLive, info: PlayerInfo, expected: Expected, bonus: Map<number, number>): Outlook {
  const fixtures = feed.fixtures.filter((f) => f.h === info(id).club || f.a === info(id).club);
  if (!fixtures.length) return { add: 0, absent: 1, share: 0 }; // a blank
  const played = Number(feed.elements[id]?.[1]) || 0;
  const n = fixtures.length;
  const parts = expected.parts?.(id)?.map((v) => v / n) as XpParts | undefined;
  const ctx = { bonus, cameOn: (feed.events?.[id]?.on ?? 0) > 0 };
  const each = fixtures.map((f) => fixtureOutlook(id, f, played, [expected.points(id) / n, parts], info, expected, ctx));
  return {
    add: each.reduce((t, o) => t + o.add, 0),
    absent: played > 0 ? 0 : each.reduce((t, o) => t * o.absent, 1),
    share: each.reduce((t, o) => t + o.share, 0) / n,
  };
}

// Where a lineup's score is heading: the points so far plus what each of the XI can still
// add (fixtureOutlook). A starter sure not to play, with no minutes once his matches are
// over or ruled out by FPL, has the bench player who'd come on for him by scoreLineup's
// rules counted instead, ahead of the auto-sub itself (which waits until that player has
// played); one who may not play has that player counted by the chance he won't.
export function liveProjection(scored: Scored, feed: SlimLive, info: PlayerInfo, expected: Expected, formation = DEFAULT_FORMATION) {
  const bonus = provisionalBonus(feed.fixtures);
  const minutes = (id: number) => Number(feed.elements[id]?.[1]) || 0;
  const outlooks = new Map<number, Outlook>();
  const outlookOf = (id: number) => outlooks.get(id) ?? outlooks.set(id, outlook(id, feed, info, expected, bonus)).get(id)!;
  const out = (id: number) => minutes(id) === 0 && (outlookOf(id).share === 0 || RULED_OUT.has(info(id).status ?? ''));
  const xi = [...scored.xi];
  const free = new Map(scored.bench.map((id) => [id, 1])); // how much of each bench player is still to be called on
  const standIn = (starter: number) => {
    const goalkeeper = info(starter).pos === 'GKP';
    return scored.bench.find(
      (c) =>
        (info(c).pos === 'GKP') === goalkeeper &&
        (free.get(c) ?? 0) > 0 &&
        !out(c) &&
        legal(
          xi.map((x) => (x === starter ? c : x)),
          info,
          formation,
        ),
    );
  };
  // A bench player, should he come on: his points so far and what he can still add.
  const worth = (id: number) => scored.points(id) + outlookOf(id).add;
  let mean = scored.pts;
  let variance = 0;
  for (const starter of scored.xi) {
    const sure = out(starter);
    const o = outlookOf(starter);
    if (!sure) {
      mean += o.add;
      variance += o.share * PLAYER_POINTS_SD ** 2;
    }
    const chance = sure ? 1 : minutes(starter) > 0 ? 0 : o.absent;
    const sub = chance > 0 ? standIn(starter) : undefined;
    if (sub === undefined) continue;
    const called = chance * free.get(sub)!;
    free.set(sub, free.get(sub)! - called);
    if (sure) xi.splice(xi.indexOf(starter), 1, sub);
    mean += called * (worth(sub) - (sure ? scored.points(starter) : 0));
    variance += called * outlookOf(sub).share * PLAYER_POINTS_SD ** 2;
  }
  return { mean, variance };
}
