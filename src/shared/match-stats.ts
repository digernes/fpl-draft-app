// What a Premier League match's pages need of it beyond the score: each player's FPL stats
// in it, from FPL's live feed, and its moments (goals, cards and substitutions, with their
// minutes) from the Premier League's match centre. The build writes them into each
// gameweek's stats file; the live relay passes on those of the matches being played.

import { PL_STATS, type ById, type PlMoment, type PlStat } from './data.ts';
import type { LiveFeed, PlEvents } from './fpl-api.ts';

// The stats FPL's fixtures list player by player, all a match has of a player who played
// twice that gameweek: the rest are the gameweek's.
const BY_MATCH = new Set<PlStat>([
  'goals_scored',
  'assists',
  'own_goals',
  'penalties_saved',
  'penalties_missed',
  'yellow_cards',
  'red_cards',
  'saves',
  'bonus',
  'bps',
  'defensive_contribution',
]);

const round2 = (x: number) => Math.round(x * 100) / 100;
const playedFixtures = (el: LiveFeed['elements'][string] | undefined) =>
  (el?.explain ?? []).filter(([stats]) => stats.some((x) => x.stat === 'minutes' && x.value > 0)).map(([, fixture]) => fixture);

/** Everyone with minutes in a match. */
export const playedIn = (feed: LiveFeed, fixture: number) =>
  Object.entries(feed.elements).flatMap(([id, el]) => (playedFixtures(el).includes(fixture) ? [Number(id)] : []));

/** Each player's FPL stats in a match, in PL_STATS order: his gameweek's, or for one who played twice that week only those the match lists of him (null for the rest). */
export function matchRows(feed: LiveFeed, fixture: number, pids: Iterable<number>): ById<(number | null)[]> {
  const f = feed.fixtures.find((x) => x.id === fixture);
  const listed = (stat: string, pid: number) => {
    const s = f?.stats?.find((x) => x.s === stat);
    return [...(s?.h ?? []), ...(s?.a ?? [])].find((x) => x.element === pid)?.value ?? 0;
  };
  const rows: ById<(number | null)[]> = {};
  for (const pid of pids) {
    const el = feed.elements[pid];
    const twice = playedFixtures(el).length > 1;
    rows[pid] = PL_STATS.map((stat) => (!twice ? round2(Number(el?.stats[stat] ?? 0)) : BY_MATCH.has(stat) ? listed(stat, pid) : null));
  }
  return rows;
}

const KINDS: Record<string, PlMoment[2]> = {
  Goal: 'goal',
  Penalty: 'pen',
  Own: 'own',
  Yellow: 'yellow',
  SecondYellow: 'second',
  StraightRed: 'red',
};

/** A match's moments from the match centre's events, in the order they happened: its players by `idOf` their codes (FPL's too), those it can't place left out. */
export function momentsOf(events: PlEvents, idOf: (code: string | null | undefined) => number | undefined): PlMoment[] {
  const list: PlMoment[] = [];
  const at = (m: { period: string; time: string }) => {
    const [base, extra = '0'] = m.time.split('+');
    return [Number(base) + Number(extra), m.period === 'FirstHalf' ? 1 : 2] as const;
  };
  for (const side of [events.homeTeam, events.awayTeam]) {
    for (const g of side.goals ?? []) {
      const [scorer, assister] = [idOf(g.playerId), idOf(g.assistPlayerId)];
      const [min, half] = at(g);
      if (scorer)
        list.push(assister ? [min, half, KINDS[g.goalType] ?? 'goal', scorer, assister] : [min, half, KINDS[g.goalType] ?? 'goal', scorer]);
    }
    for (const c of side.cards ?? []) {
      const who = idOf(c.playerId);
      if (who && KINDS[c.type]) list.push([...at(c), KINDS[c.type], who]);
    }
    for (const s of side.subs ?? []) {
      const [on, off] = [idOf(s.playerOnId), idOf(s.playerOffId)];
      if (on && off) list.push([...at(s), 'sub', on, off]);
    }
  }
  return list.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

/**
 * A match's moments with FPL's assister given to a goal the match centre names none for:
 * where a side has one such goal and its players one FPL assist no goal accounts for, it's
 * his. FPL hands assists out more freely, as for a rebound off a save.
 */
export function withFplAssists(moments: PlMoment[], sides: [number[], number[]], assists: (pid: number) => number): PlMoment[] {
  const out = [...moments];
  for (const side of sides) {
    const ours = new Set(side);
    const goals = out.flatMap((mo, i) => ((mo[2] === 'goal' || mo[2] === 'pen') && ours.has(mo[3]) ? [i] : []));
    const bare = goals.filter((i) => out[i][4] === undefined);
    if (bare.length !== 1) continue;
    const named = new Map<number, number>();
    for (const i of goals) {
      const by = out[i][4];
      if (by !== undefined) named.set(by, (named.get(by) ?? 0) + 1);
    }
    const spare = side.map((pid) => [pid, assists(pid) - (named.get(pid) ?? 0)] as const).filter(([, n]) => n > 0);
    const [min, half, kind, scorer] = out[bare[0]];
    if (spare.length === 1 && spare[0][1] === 1 && spare[0][0] !== scorer) out[bare[0]] = [min, half, kind, scorer, spare[0][0]];
  }
  return out;
}
