// Live scoring shared by the page, the build and the Cloudflare Worker: a slim copy of
// the FPL live feed, provisional bonus, and provisional automatic substitutions.

import type { Formation, Position } from './data.ts';
import type { LiveFeed } from './fpl-api.ts';

export interface SlimFixture {
  id: number;
  h: number;
  a: number;
  started: boolean;
  done: boolean;
  /** [element, BPS] while the bonus is still to be awarded. */
  bps?: [number, number][];
}

export interface SlimLive {
  /** element id → [points, minutes] */
  elements: Record<string, [number, number]>;
  fixtures: SlimFixture[];
}

export type PlayerInfo = (id: number) => { pos: Position | undefined; club: number | undefined };

export interface Scored {
  xi: number[];
  bench: number[];
  /** Bench players brought on. */
  subs: number[];
  pts: number;
  points: (id: number) => number;
}

// The FPL live feed is ~450 KB; this keeps what live scores need (~20 KB).
// elements: { id: [points, minutes] } for anyone with either; fixtures keep the BPS
// list only while their bonus has not been awarded yet.
export function slimLive(raw: Partial<LiveFeed>): SlimLive {
  const elements: SlimLive['elements'] = {};
  for (const [id, el] of Object.entries(raw.elements ?? {})) {
    const { total_points: points, minutes } = el.stats;
    if (points || minutes) elements[id] = [points, minutes];
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
      ...(f.started && !bonusIn && bps ? { bps: [...bps.h, ...bps.a].map((b): [number, number] => [b.element, b.value]) } : {}),
    };
  });
  return { elements, fixtures };
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
export function scoreLineup(order: number[], feed: SlimLive, info: PlayerInfo, formation: Formation = { DEF: 3, MID: 2, FWD: 1 }): Scored {
  const bonus = provisionalBonus(feed.fixtures);
  const points = (id: number) => (Number(feed.elements[id]?.[0]) || 0) + (bonus.get(id) ?? 0);
  const played = (id: number) => (Number(feed.elements[id]?.[1]) || 0) > 0;
  const clubDone = new Map<number, boolean>();
  for (const f of feed.fixtures) for (const club of [f.h, f.a]) clubDone.set(club, (clubDone.get(club) ?? true) && f.done);
  const done = (id: number) => clubDone.get(info(id).club as number) ?? true; // no fixture at all: a blank, so done

  const xi = order.slice(0, 11);
  const bench = order.slice(11);
  const subs: number[] = [];
  const legal = (lineup: number[]) =>
    Object.entries(formation).every(([pos, min]) => lineup.filter((id) => info(id).pos === pos).length >= min);
  for (const starter of [...xi]) {
    if (played(starter) || !done(starter)) continue;
    const goalkeeper = info(starter).pos === 'GKP';
    for (const candidate of bench) {
      if ((info(candidate).pos === 'GKP') !== goalkeeper) continue;
      if (!legal(xi.map((id) => (id === starter ? candidate : id)))) continue;
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
