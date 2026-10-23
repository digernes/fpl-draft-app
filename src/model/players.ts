// What each player brings and how much he is likely to play. His rates: the goals and
// FPL assists he can expect per xG his club makes while he is on the pitch (from his
// share of its xG and xA), his defensive actions, bonus and cards per 90, and a
// goalkeeper's saves against the league's line, each pulled towards his position's
// average by a prior worth a few matches. His minutes: what he played in his club's last
// few matches, each one a scenario, recent ones weighing more and the ones he missed
// less, so a regular starter, a rotation risk and someone out of the side all come through.

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
  /** The chance a player doesn't play at all, whatever his recent minutes say (a knock, a rest). */
  absent: number;
  /**
   * FPL's chance of playing, to this power: a flagged player plays a little less often
   * than his flag says (0.75 becomes 0.70, 0.5 becomes 0.42). A guess, until the flags
   * kept at each deadline (data.json's `flags`) can test it.
   */
  flagPower: number;
}

/** How xG and xA become FPL's goals and assists, by position, and the league's line for saves. */
export interface Conversion {
  finishing: Record<Position, number>;
  assists: Record<Position, number>;
  saves: Counts['saves'];
}

interface Totals {
  minutes: number;
  xg: number;
  xa: number;
  goals: number;
  assists: number;
  defcon: number;
  saves: number;
  bonus: number;
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
  bonus: 0,
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
): Map<number, Rates> {
  const match = new Map(h.matches.map((m) => [`${m.fixture}:${m.club}`, m]));
  const byPlayer = new Map<number, Totals>();
  const byPosition = new Map<Position, Totals>();
  const add = (t: Totals, a: Appearance, m: ClubMatch, w: number) => {
    t.minutes += w * a.minutes;
    t.xg += w * a.xg;
    t.xa += w * a.xa;
    t.goals += w * a.goals;
    t.assists += w * a.assists;
    t.defcon += w * a.defcon;
    t.saves += w * a.saves;
    t.bonus += w * a.bonus;
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

  const ratio = (top: number, bottom: number) => (bottom > 0 ? top / bottom : 0);
  const rates = new Map<number, Rates>();
  for (const [pid, { pos }] of players) {
    const t = byPlayer.get(pid) ?? empty();
    const avg = byPosition.get(pos) ?? empty();
    // Goals and FPL assists he can expect per xG of his club's, from his xG and xA (and
    // a little from the goals and assists themselves).
    const goals = (x: Totals) => (1 - o.actual) * c.finishing[pos] * x.xg + o.actual * x.goals;
    const assists = (x: Totals) => (1 - o.actual) * c.assists[pos] * x.xa + o.actual * x.assists;
    const share = (mine: number, theirs: number) => (mine + o.sharePrior[pos] * ratio(theirs, avg.clubXg)) / (t.clubXg + o.sharePrior[pos]);
    const per90 = (mine: number, theirs: number) => (mine + o.ratePrior * ratio(theirs, avg.minutes / 90)) / (t.minutes / 90 + o.ratePrior);
    const line = (c.saves.base * t.minutes) / 90 + c.saves.perXga * t.clubXga;
    rates.set(pid, {
      goalShare: share(goals(t), goals(avg)),
      assistShare: share(assists(t), assists(avg)),
      defcon90: per90(t.defcon, avg.defcon),
      savesFactor: (t.saves + o.savesPrior) / (line + o.savesPrior),
      bonus90: per90(t.bonus, avg.bonus),
      yellow90: per90(t.yellow, avg.yellow),
    });
  }
  return rates;
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
    return minutes.map((x, i) => ({ minutes: x, weight: total > 0 ? weights[i] / total : 1 / minutes.length }));
  };
}

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
