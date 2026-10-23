// Live scoring shared by the page, the build and the Cloudflare Worker: a slim copy of
// the FPL live feed (with what each player did), provisional bonus, and provisional
// automatic substitutions.

import type { Formation, Position } from './data.ts';
import type { LiveFeed } from './fpl-api.ts';

export interface SlimFixture {
  id: number;
  h: number;
  a: number;
  started: boolean;
  done: boolean;
  /** Kick-off time. */
  ko?: string;
  /** Minutes played and the score, while the match is on. */
  min?: number;
  score?: [number, number];
  /** [element, BPS] while the bonus is still to be awarded. */
  bps?: [number, number][];
}

export interface SlimLive {
  /** element id → [points, minutes] */
  elements: Record<string, [number, number]>;
  /** element id → what he did, for anyone who did something. Missing from older feeds. */
  events?: Record<string, PlayerEvents>;
  fixtures: SlimFixture[];
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
  /** Minutes played, for a substitution's tooltip. */
  min?: number;
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
  for (const [id, el] of Object.entries(raw.elements ?? {})) {
    const { total_points: points, minutes } = el.stats;
    if (points || minutes) elements[id] = [points, minutes];
    const did = playerEvents(el, over);
    if (did) events[id] = did;
  }
  // FPL's fixture minutes stay at 0 while a match is on; its players' minutes don't.
  const clock = new Map<number, number>();
  for (const el of Object.values(raw.elements ?? {}))
    for (const [stats, fixture] of el.explain ?? []) {
      const minutes = stats.find((x) => x.stat === 'minutes')?.value ?? 0;
      if (minutes > (clock.get(fixture) ?? 0)) clock.set(fixture, minutes);
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
        ? { min: Math.max(f.minutes ?? 0, clock.get(f.id) ?? 0), score: [f.team_h_score ?? 0, f.team_a_score ?? 0] as [number, number] }
        : {}),
      ...(f.started && !bonusIn && bps ? { bps: [...bps.h, ...bps.a].map((b): [number, number] => [b.element, b.value]) } : {}),
    };
  });
  return { elements, events, fixtures };
}

// FPL doesn't list substitutions, so they come from the minutes in each match: a
// player who played in more matches than he started came on, and a starter short of
// 90 minutes in a match that is over went off, unless he was sent off. While a match
// is on, nobody has 90 minutes yet, so going off waits for the final whistle.
function playerEvents({ stats: s, explain = [] }: LiveFeed['elements'][string], over: Set<number>): PlayerEvents | undefined {
  const minutes = explain.map(([stats, fixture]) => ({ fixture, min: stats.find((x) => x.stat === 'minutes')?.value ?? 0 }));
  const played = minutes.filter((m) => m.min > 0).length;
  const on = s.starts === undefined ? 0 : Math.max(0, played - s.starts);
  const short = minutes.filter((m) => m.min > 0 && m.min < 90 && over.has(m.fixture)).length;
  const off = s.starts === undefined ? 0 : Math.max(0, short - on - (s.red_cards ?? 0));
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
      break;
    }
  }
  return { xi, bench, subs, pts: xi.reduce((total, id) => total + points(id), 0), points };
}

// --- Who is still to play ------------------------------------------------------

export type PlayerState =
  | { state: 'live'; min: number } // his club's match is on
  | { state: 'done' } // all his club's matches are over
  | { state: 'due'; ko?: string } // still to kick off (the next one, in a double gameweek)
  | { state: 'blank' }; // his club has no match this gameweek

export function clubState(feed: SlimLive, club: number | undefined): PlayerState {
  const fixtures = feed.fixtures.filter((f) => f.h === club || f.a === club);
  if (!fixtures.length) return { state: 'blank' };
  const playing = fixtures.find((f) => f.started && !f.done);
  if (playing) return { state: 'live', min: playing.min ?? 0 };
  const next = fixtures.filter((f) => !f.started).sort((a, b) => (a.ko ?? '').localeCompare(b.ko ?? ''))[0];
  return next ? { state: 'due', ko: next.ko } : { state: 'done' };
}

// How much of a player's gameweek is still to come: 1 before kick-off, falling to 0 at
// full time, split evenly over a double gameweek's two matches.
export function shareToCome(feed: SlimLive, club: number | undefined): number {
  const fixtures = feed.fixtures.filter((f) => f.h === club || f.a === club);
  if (!fixtures.length) return 0;
  const left = (f: SlimFixture) => (f.done ? 0 : f.started ? Math.max(0, 1 - (f.min ?? 0) / 90) : 1);
  return fixtures.reduce((total, f) => total + left(f), 0) / fixtures.length;
}

/** Spread of one player's points over a full gameweek, for the live odds. */
export const PLAYER_POINTS_SD = 3;

const RULED_OUT = new Set(['i', 's', 'u', 'n']);

/** What a projection knows of each player's gameweek. */
export interface Expected {
  /** His expected points for the whole gameweek. */
  points: (id: number) => number;
  /** Of those, his appearance and clean-sheet points, when the model gave them. */
  milestones?: (id: number) => [appearance: number, cleanSheet: number] | undefined;
  /** Points for a clean sheet, by position. */
  cleanSheet?: Partial<Record<Position, number>>;
}

// FPL's appearance points: 1 for coming on, 2 from 60 minutes.
const appearance = (minutes: number) => (minutes >= 60 ? 2 : minutes > 0 ? 1 : 0);

// Where a lineup's score is heading: the points so far plus what each scoring player can
// still add. That is his expected points for the share of his gameweek still to come,
// except that FPL hands out appearance points and clean sheets at 1 and 60 minutes,
// which a share would count twice once they're in. So those come from where his match
// stands: the appearance points he has still to reach, and the chance of keeping (or
// still getting) a clean sheet to the end. A starter who won't play, with no minutes
// once his matches are over or ruled out by FPL, counts the bench player who would come
// on for him by scoreLineup's rules instead, ahead of the auto-sub itself (which waits
// until that player has played).
export function liveProjection(scored: Scored, feed: SlimLive, info: PlayerInfo, expected: Expected, formation = DEFAULT_FORMATION) {
  const toCome = (id: number) => shareToCome(feed, info(id).club);
  const minutes = (id: number) => Number(feed.elements[id]?.[1]) || 0;
  const out = (id: number) => !(minutes(id) > 0) && (toCome(id) === 0 || RULED_OUT.has(info(id).status ?? ''));
  const conceded = (club: number | undefined) => {
    const f = feed.fixtures.find((x) => (x.h === club || x.a === club) && x.started && !x.done && x.score);
    return f?.score ? f.score[f.h === club ? 1 : 0] : 0;
  };
  const stillToAdd = (id: number, share: number) => {
    const [play, cleanSheet] = expected.milestones?.(id) ?? [0, 0];
    let add = share * (expected.points(id) - play - cleanSheet) + Math.max(0, play - appearance(minutes(id)));
    const perCleanSheet = expected.cleanSheet?.[info(id).pos ?? 'FWD'] ?? 0;
    if (cleanSheet > 0 && perCleanSheet > 0 && !conceded(info(id).club)) {
      const keep = Math.min(1, cleanSheet / perCleanSheet) ** share; // the chance of no goal in the rest
      add += perCleanSheet * keep - (minutes(id) >= 60 ? perCleanSheet : 0); // FPL shows it from 60 minutes
    }
    return add;
  };
  const xi = [...scored.xi];
  const bench = [...scored.bench];
  let mean = scored.pts;
  let variance = 0;
  for (const starter of scored.xi) {
    let id = starter;
    if (out(starter)) {
      const goalkeeper = info(starter).pos === 'GKP';
      const sub = bench.find(
        (c) =>
          (info(c).pos === 'GKP') === goalkeeper &&
          !out(c) &&
          legal(
            xi.map((x) => (x === starter ? c : x)),
            info,
            formation,
          ),
      );
      if (sub !== undefined) {
        xi.splice(xi.indexOf(starter), 1, sub);
        bench.splice(bench.indexOf(sub), 1);
        mean += scored.points(sub) - scored.points(starter);
        id = sub;
      }
    }
    const share = toCome(id);
    if (share > 0) mean += stillToAdd(id, share);
    variance += share * PLAYER_POINTS_SD ** 2;
  }
  return { mean, variance };
}
