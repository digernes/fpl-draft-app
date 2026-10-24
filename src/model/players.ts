// What each player brings and how much he is likely to play. His rates: the goals and
// FPL assists he can expect per xG his club makes while he is on the pitch (from his
// share of its xG and xA), his defensive actions and cards per 90, and a goalkeeper's
// saves against the league's line, each pulled towards his position's average by a
// prior worth a few matches, or his shares towards his own last season's at the same club
// (last-season.ts); his bonus is in bonus.ts. His minutes: what he played in
// his club's last few matches, each one a scenario, recent ones weighing more and the
// ones he missed less, so a regular starter, a rotation risk and someone out of the side
// all come through.

import type { Position } from '../shared/data.ts';
import type { Appearance, ClubMatch, History, ModelPlayer } from './history.ts';
import type { Counts, Rates } from './points.ts';

export interface PlayerOptions {
  /** How much of his club's xG (while he's on) his shares start from at his position's average. */
  sharePrior: Record<Position, number>;
  /** How much the goals and assists he got count next to his xG and xA (0: xG and xA only). */
  actual: number;
  /** How many 90s the per-90 rates start from at the position's average. */
  ratePrior: number;
  /** How many saves a goalkeeper's saves start from at the league's line. */
  savesPrior: number;
  /** An appearance `halfLife` gameweeks before the one forecast counts half. */
  halfLife: number;
  /** The club's last `matches` matches make the minutes scenarios, each `decay` times the weight of the one after it. */
  matches: number;
  decay: number;
  /** How much a match he missed counts next to one he played: often it was an injury or a ban, which his flag now says is over. */
  missed: number;
  /**
   * How far a part of a match he played might go either way next time, in minutes: one
   * who came off at 62 might go at 52 or 72, which decides an hour's two points and a
   * clean sheet. Only those it could take across the hour (0: just as he played them).
   */
  spread: number;
  /** The chance a player doesn't play at all, whatever his recent minutes say (a knock, a rest). */
  absent: number;
  /**
   * FPL's chance of playing, to this power: a flagged player plays a little less often
   * than his flag says (0.75 becomes 0.70, 0.5 becomes 0.42). A guess, until the flags
   * kept at each deadline (data.json's `flags`) can test it.
   */
  flagPower: number;
}

/** How xG and xA become FPL's goals and assists, by position, the league's line for saves, and its penalties. */
export interface Conversion {
  finishing: Record<Position, number>;
  assists: Record<Position, number>;
  saves: Counts['saves'];
  penalties: Counts['penalties'];
}

/** His goals and FPL assists per xG his club makes while he is on the pitch. */
export type Shares = Pick<Rates, 'goalShare' | 'assistShare'>;

/** A player's whole season at one club, which the next one's shares start from (last-season.ts). */
export interface SeasonTotals {
  pos: Position;
  minutes: number;
  xg: number;
  xa: number;
  goals: number;
  assists: number;
  /** His club's xG while he was on the pitch. */
  clubXg: number;
  /** His place in his club's penalty order at the end of it (1 takes them). */
  penalties: number | null;
}

interface Totals {
  minutes: number;
  xg: number;
  xa: number;
  goals: number;
  assists: number;
  defcon: number;
  saves: number;
  yellow: number;
  /** His club's xG and xG conceded while he was on the pitch. */
  clubXg: number;
  clubXga: number;
}

const empty = (): Totals => ({
  minutes: 0,
  xg: 0,
  xa: 0,
  goals: 0,
  assists: 0,
  defcon: 0,
  saves: 0,
  yellow: 0,
  clubXg: 0,
  clubXga: 0,
});

export function playerRates(
  h: History,
  players: Map<number, ModelPlayer>,
  o: PlayerOptions,
  atGw: number,
  c: Conversion,
  /** Shares to start from instead of the position's average: last season's (last-season.ts). */
  from?: Map<number, Shares>,
): Map<number, Omit<Rates, 'bonus90'>> {
  const match = new Map(h.matches.map((m) => [`${m.fixture}:${m.club}`, m]));
  const byPlayer = new Map<number, Totals>();
  const byPosition = new Map<Position, Totals>();
  const penalty = (a: Appearance) => (players.get(a.pid)?.penalties === 1 ? penaltiesIn(c, a.minutes) : 0);
  const add = (t: Totals, a: Appearance, m: ClubMatch, w: number) => {
    t.minutes += w * a.minutes;
    t.xg += w * (a.xg - penalty(a));
    t.xa += w * a.xa;
    t.goals += w * (a.goals - penalty(a));
    t.assists += w * a.assists;
    t.defcon += w * a.defcon;
    t.saves += w * a.saves;
    t.yellow += w * a.yellow;
    t.clubXg += (w * m.xg * a.minutes) / 90;
    t.clubXga += (w * m.xga * a.minutes) / 90;
  };
  for (const a of h.appearances) {
    const m = match.get(`${a.fixture}:${a.club}`);
    const pos = players.get(a.pid)?.pos;
    if (!m || !pos) continue;
    const w = 0.5 ** ((atGw - a.gw) / o.halfLife);
    if (!byPlayer.has(a.pid)) byPlayer.set(a.pid, empty());
    if (!byPosition.has(pos)) byPosition.set(pos, empty());
    add(byPlayer.get(a.pid)!, a, m, w);
    add(byPosition.get(pos)!, a, m, w);
  }

  const shares = sharesOf(byPlayer, byPosition, players, o, c, from);
  const rates = new Map<number, Omit<Rates, 'bonus90'>>();
  for (const [pid, { pos }] of players) {
    const t = byPlayer.get(pid) ?? empty();
    const avg = byPosition.get(pos) ?? empty();
    const per90 = (mine: number, theirs: number) => (mine + o.ratePrior * ratio(theirs, avg.minutes / 90)) / (t.minutes / 90 + o.ratePrior);
    const line = (c.saves.base * t.minutes) / 90 + c.saves.perXga * t.clubXga;
    rates.set(pid, {
      ...shares.get(pid)!,
      defcon90: per90(t.defcon, avg.defcon),
      savesFactor: (t.saves + o.savesPrior) / (line + o.savesPrior),
      yellow90: per90(t.yellow, avg.yellow),
    });
  }
  return rates;
}

/** Shares from whole seasons' totals: last season's, which this season's start from. */
export function seasonShares(totals: Map<number, SeasonTotals>, o: PlayerOptions, c: Conversion): Map<number, Shares> {
  const byPlayer = new Map<number, Totals>();
  const byPosition = new Map<Position, Totals>();
  for (const [pid, s] of totals) {
    const penalties = s.penalties === 1 ? penaltiesIn(c, s.minutes) : 0;
    const t = {
      ...empty(),
      minutes: s.minutes,
      xg: s.xg - penalties,
      xa: s.xa,
      goals: s.goals - penalties,
      assists: s.assists,
      clubXg: s.clubXg,
    };
    byPlayer.set(pid, t);
    const avg = byPosition.get(s.pos) ?? empty();
    for (const key of ['minutes', 'xg', 'xa', 'goals', 'assists', 'clubXg'] as const) avg[key] += t[key];
    byPosition.set(s.pos, avg);
  }
  return sharesOf(byPlayer, byPosition, totals, o, c);
}

const ratio = (top: number, bottom: number) => (bottom > 0 ? top / bottom : 0);

// A first-choice penalty taker's xG and goals include his club's penalties, which are a
// part of their own (points.ts), so his share leaves out the ones he could expect.
const penaltiesIn = (c: Conversion, minutes: number) => (c.penalties.perMatch * c.penalties.scored * minutes) / 90;

// Goals and FPL assists he can expect per xG of his club's, from his xG and xA (and a
// little from the goals and assists themselves), pulled towards his position's average,
// or towards a share he starts from (his last season's).
function sharesOf(
  byPlayer: Map<number, Totals>,
  byPosition: Map<Position, Totals>,
  players: Map<number, { pos: Position }>,
  o: PlayerOptions,
  c: Conversion,
  from?: Map<number, Shares>,
): Map<number, Shares> {
  const shares = new Map<number, Shares>();
  for (const [pid, { pos }] of players) {
    const t = byPlayer.get(pid) ?? empty();
    const avg = byPosition.get(pos) ?? empty();
    const goals = (x: Totals) => (1 - o.actual) * c.finishing[pos] * x.xg + o.actual * x.goals;
    const assists = (x: Totals) => (1 - o.actual) * c.assists[pos] * x.xa + o.actual * x.assists;
    const share = (mine: number, centre: number) => (Math.max(0, mine) + o.sharePrior[pos] * centre) / (t.clubXg + o.sharePrior[pos]);
    const start = from?.get(pid);
    shares.set(pid, {
      goalShare: share(goals(t), start?.goalShare ?? ratio(goals(avg), avg.clubXg)),
      assistShare: share(assists(t), start?.assistShare ?? ratio(assists(avg), avg.clubXg)),
    });
  }
  return shares;
}

export interface Scenario {
  minutes: number;
  weight: number;
}

// A player's minutes in his club's last few matches (0 where he didn't play), as
// weighted scenarios for the next one: the latest weigh most, and a miss less than a match he played.
export function minutesScenarios(h: History, o: PlayerOptions): (pid: number, club: number) => Scenario[] {
  const recent = new Map<number, ClubMatch[]>();
  for (const m of [...h.matches].sort((a, b) => b.gw - a.gw || b.fixture - a.fixture)) {
    const list = recent.get(m.club) ?? [];
    if (list.length < o.matches) recent.set(m.club, [...list, m]);
  }
  const played = new Map(h.appearances.map((a) => [`${a.fixture}:${a.pid}`, a.minutes]));
  return (pid, club) => {
    const minutes = (recent.get(club) ?? []).map((m) => played.get(`${m.fixture}:${pid}`) ?? 0);
    const weights = minutes.map((x, i) => o.decay ** i * (x > 0 ? 1 : o.missed));
    const total = weights.reduce((t, w) => t + w, 0);
    return minutes.flatMap((x, i) => {
      const weight = total > 0 ? weights[i] / total : 1 / minutes.length;
      if (!o.spread || x <= 0 || x >= 90 || Math.abs(x - 60) >= 2 * o.spread) return [{ minutes: x, weight }];
      return SPREAD.map(([k, p]) => ({ minutes: Math.min(90, Math.max(1, x + k * o.spread)), weight: weight * p }));
    });
  };
}

// A part of a match, spread over `spread` and twice that either way, roughly a normal's.
const SPREAD = [
  [-2, 0.06],
  [-1, 0.24],
  [0, 0.4],
  [1, 0.24],
  [2, 0.06],
] as const;

export interface StandInOptions {
  /** A starter's usual minutes by position, for a stand-in who gets the start. */
  start: Record<Position, number>;
  /** How much of the minutes a flag takes away go to the stand-ins. */
  share: number;
  /** How much a player who hasn't been in the side lately counts next to one who has. */
  unseen: number;
  /** How alike two roles must be for one player to stand in for the other, in degrees (see `role`). */
  likeness: number;
}

export interface Plan {
  scenarios: Scenario[];
  /** FPL's flag as a chance of playing: 1 without one. */
  chance: number;
}

const attacker = (pos: Position) => pos === 'MID' || pos === 'FWD';

// The minutes FPL's flags take away from a player go to his club's other players who
// could fill his role: most to those with room to play more, who have been in the side
// lately and play the most like him (a winger for a winger, a holding midfielder for a
// holding midfielder). Midfielders and forwards stand in for each other, since FPL's
// line between them doesn't follow the wings. Each stand-in gets his share as a chance
// of starting instead of what his recent matches say.
export function standIns(
  players: Map<number, ModelPlayer>,
  plans: Map<number, Plan>,
  rates: Map<number, Rates>,
  o: StandInOptions,
): Map<number, number> {
  const expected = (s: Scenario[]) => s.reduce((t, x) => t + x.weight * x.minutes, 0);
  // A player's role: how his attacking output (goals and assists per club xG) compares
  // with his defensive actions, each against the league's, as an angle.
  const outfield = [...plans.keys()].filter((pid) => players.get(pid)!.pos !== 'GKP').map((pid) => rates.get(pid)!);
  const mean = (pick: (r: Rates) => number) => outfield.reduce((t, r) => t + pick(r), 0) / Math.max(1, outfield.length) || 1;
  const attack = mean((r) => r.goalShare + r.assistShare);
  const defence = mean((r) => r.defcon90);
  const role = (pid: number) => {
    const r = rates.get(pid)!;
    return (Math.atan2((r.goalShare + r.assistShare) / attack, r.defcon90 / defence) * 180) / Math.PI;
  };
  const alike = (a: number, b: number) => (players.get(a)!.pos === 'GKP' ? 1 : Math.exp(-(((role(a) - role(b)) / o.likeness) ** 2)));
  const fits = (a: ModelPlayer, b: ModelPlayer) => a.club === b.club && (a.pos === b.pos || (attacker(a.pos) && attacker(b.pos)));

  const gained = new Map<number, number>();
  for (const [out, plan] of plans) {
    const vacated = o.share * (1 - plan.chance) * expected(plan.scenarios);
    if (vacated <= 0) continue;
    const p = players.get(out)!;
    const candidates = [...plans]
      .filter(([id, c]) => id !== out && c.chance > 0.5 && fits(p, players.get(id)!))
      .map(([id, { scenarios }]) => {
        const room = Math.max(0, o.start[players.get(id)!.pos] - expected(scenarios));
        const seen = scenarios.reduce((t, s) => t + (s.minutes > 0 ? s.weight : 0), 0);
        return { id, pull: room * (seen + o.unseen) * alike(out, id) };
      });
    const total = candidates.reduce((t, c) => t + c.pull, 0);
    if (total > 0) for (const c of candidates) gained.set(c.id, (gained.get(c.id) ?? 0) + (vacated * c.pull) / total);
  }
  const starts = new Map<number, number>();
  for (const [id, minutes] of gained) {
    const room = o.start[players.get(id)!.pos] - expected(plans.get(id)!.scenarios);
    if (room > 0) starts.set(id, Math.min(1, minutes / room));
  }
  return starts;
}
