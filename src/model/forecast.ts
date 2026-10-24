// Expected points for a gameweek, from what has been played before it: how strong each
// club is (teams.ts), what share of its attack each player has and how much he is likely
// to play (players.ts), both starting from last season's (last-season.ts), what earns
// bonus (bonus.ts), and FPL's scoring over the minutes he might get (points.ts).
// README.md in this folder explains the model and how it tests against FPL's own.

import type { Position } from '../shared/data.ts';
import type { LiveFeed } from '../shared/fpl-api.ts';
import { fitBonus, type BonusOptions } from './bonus.ts';
import { readHistory, type History, type ModelPlayer } from './history.ts';
import { startingPoint, type LastSeason } from './last-season.ts';
import { minutesScenarios, playerRates, standIns, type Plan, type PlayerOptions, type StandInOptions } from './players.ts';
import { matchParts, PARTS, readScoring, type Counts, type Parts } from './points.ts';
import { fitTeams, type TeamOptions } from './teams.ts';

export interface ModelOptions {
  teams: Omit<TeamOptions, 'atGw'>;
  players: PlayerOptions;
  standIns: StandInOptions;
  counts: Counts;
  /** Goals per xG by position: defenders' chances (headers, mostly) convert below theirs season after season. */
  finishing: Record<Position, number>;
  /** FPL assists per xA by position over whole seasons, which this season's start from with a prior worth `prior` xA. */
  assists: { perXa: Record<Position, number>; prior: number };
  bonus: BonusOptions;
  /** How much of last season's club ratings this season's start from (a club promoted since starts from the league average). */
  lastSeason: { clubs: number };
}

export const DEFAULT_OPTIONS: ModelOptions = {
  teams: { halfLife: 10, prior: 6, home: 0.15, homePrior: 20, goals: 0.15 },
  players: {
    sharePrior: { GKP: 700, DEF: 15, MID: 6, FWD: 15 },
    actual: 0.15,
    ratePrior: 10,
    savesPrior: 10,
    halfLife: 10,
    matches: 10,
    decay: 0.7,
    missed: 0.7,
    absent: 0.035,
    flagPower: 1.25,
  },
  standIns: { start: { GKP: 90, DEF: 85, MID: 80, FWD: 78 }, share: 1, unseen: 0.2, likeness: 10 },
  counts: { goals: 10, defcon: 6, saves: { base: 1.41, perXga: 0.99 }, penalties: { perMatch: 0.12, scored: 0.79, saved: 0.15 } },
  finishing: { GKP: 1, DEF: 0.85, MID: 1, FWD: 1 },
  assists: { perXa: { GKP: 1.37, DEF: 1.29, MID: 1.33, FWD: 2.11 }, prior: 10 },
  bonus: { prior: 10, ridge: 20 },
  lastSeason: { clubs: 0.8 },
};

export interface ModelInput {
  /** The Draft bootstrap's `settings.scoring`. */
  scoring: Record<string, unknown>;
  players: Map<number, ModelPlayer>;
  /** Live feeds of finished gameweeks; only those before the one forecast are used. */
  feeds: Record<number, LiveFeed>;
  /** Last season, which shares and club ratings start from; without it, they start from the averages. */
  last?: LastSeason;
}

export interface Forecast {
  /** Expected points, their parts and expected minutes, for every player whose club plays. */
  points: Map<number, number>;
  parts: Map<number, Parts>;
  minutes: Map<number, number>;
}

export function forecast(input: ModelInput, gw: number, fixtures: { team_h: number; team_a: number }[], o = DEFAULT_OPTIONS): Forecast {
  const feeds = Object.fromEntries(Object.entries(input.feeds).filter(([g]) => Number(g) < gw));
  const history = readHistory(feeds, input.players);
  const conversion = { finishing: o.finishing, saves: o.counts.saves, penalties: o.counts.penalties };
  const start =
    input.last && startingPoint(input.last, o.players, { ...conversion, assists: o.assists.perXa }, o.teams, o.lastSeason.clubs);
  const teams = fitTeams(history.matches, { atGw: gw, ...o.teams, centre: start });
  const scoring = readScoring(input.scoring);
  const assists = assistFactors(history, input.players, o.assists);
  const bonus = fitBonus(history, input.players, gw, o.players.halfLife, scoring.defconLimit, o.bonus);
  const rates = new Map(
    [...playerRates(history, input.players, o.players, gw, { ...conversion, assists }, start?.shares)].map(([pid, r]) => [
      pid,
      { ...r, bonus90: bonus.own.get(pid) ?? 0 },
    ]),
  );
  const scenarios = minutesScenarios(history, o.players);

  // FPL's chance of playing scales him, and the minutes it takes away go to his stand-ins
  // (players.ts).
  const flag = (p: ModelPlayer) => (p.chance == null ? 1 : (p.chance / 100) ** o.players.flagPower);
  const plans = new Map<number, Plan>();
  for (const [pid, p] of input.players)
    if (fixtures.some((f) => f.team_h === p.club || f.team_a === p.club))
      plans.set(pid, { scenarios: scenarios(pid, p.club), chance: flag(p) });
  const starts = standIns(input.players, plans, rates, o.standIns);
  // Each player's minutes scenarios for a match, with a stand-in's chance of starting, and
  // `absent`: the chance that even an unflagged regular misses out.
  const minutesFor = new Map(
    [...plans].map(([pid, plan]) => {
      const q = starts.get(pid) ?? 0;
      const start = o.standIns.start[input.players.get(pid)!.pos];
      const options = q
        ? [...plan.scenarios.map((s) => ({ ...s, weight: (1 - q) * s.weight })), { minutes: start, weight: q }]
        : plan.scenarios;
      return [pid, { options, chance: plan.chance * (1 - o.players.absent) }];
    }),
  );
  const onPitch = (pid: number) => {
    const m = minutesFor.get(pid)!;
    return Math.min(1, (m.chance * m.options.reduce((t, s) => t + s.weight * s.minutes, 0)) / 90);
  };
  // Penalties: a club's go to its takers in FPL's order, each when nobody ahead of him is
  // on the pitch. How many it wins follows its attack, from the xG it can expect.
  const order = (pid: number) => input.players.get(pid)!.penalties ?? Infinity;
  const first = new Map<number, number>();
  const nobodyYet = new Map<number, number>();
  for (const pid of [...plans.keys()].filter((id) => input.players.get(id)!.penalties).sort((a, b) => order(a) - order(b))) {
    const club = input.players.get(pid)!.club;
    const left = nobodyYet.get(club) ?? 1;
    first.set(pid, left);
    nobodyYet.set(club, left * (1 - onPitch(pid)));
  }
  const expectedXg = fixtures.flatMap((f) => [teams.rate(f.team_h, f.team_a, true), teams.rate(f.team_a, f.team_h, false)]);
  const averageXg = expectedXg.reduce((t, x) => t + x, 0) / Math.max(1, expectedXg.length);
  const penaltiesAt = (xg: number) => (o.counts.penalties.perMatch * xg) / averageXg;

  const points = new Map<number, number>();
  const parts = new Map<number, Parts>();
  const minutes = new Map<number, number>();
  // Each match's bonus, player by player, for sharing out below.
  const bonusIn = fixtures.map(() => new Map<number, number>());
  for (const [pid] of plans) {
    const p = input.players.get(pid)!;
    const r = rates.get(pid)!;
    const { options, chance } = minutesFor.get(pid)!;
    const mine = Object.fromEntries(PARTS.map((part) => [part, 0])) as Parts;
    let mins = 0;
    for (const [i, f] of fixtures.entries()) {
      if (f.team_h !== p.club && f.team_a !== p.club) continue;
      const home = f.team_h === p.club;
      const opp = home ? f.team_a : f.team_h;
      const xg = teams.rate(p.club, opp, home);
      const xga = teams.rate(opp, p.club, !home);
      const match = { xg, xga, penalties: { for: penaltiesAt(xg), against: penaltiesAt(xga), first: first.get(pid) ?? 0 } };
      for (const s of options) {
        const got = matchParts(p.pos, scoring, r, s.minutes, match, o.counts, bonus.rates[p.pos]);
        for (const part of PARTS) mine[part] += chance * s.weight * got[part];
        bonusIn[i].set(pid, (bonusIn[i].get(pid) ?? 0) + chance * s.weight * got.bonus);
        mins += chance * s.weight * s.minutes;
      }
    }
    parts.set(pid, mine);
    minutes.set(pid, mins);
  }
  // A match hands out the same bonus whoever plays in it (3, 2 and 1, and more for ties),
  // so its players share the season's average per match, each in proportion to his.
  const given = Object.values(feeds).reduce((t, feed) => t + Object.values(feed.elements).reduce((s, e) => s + (e.stats.bonus ?? 0), 0), 0);
  const played = Object.values(feeds).reduce((t, feed) => t + feed.fixtures.filter((f) => f.finished || f.finished_provisional).length, 0);
  for (const expected of bonusIn) {
    const total = [...expected.values()].reduce((t, b) => t + b, 0);
    const scale = total > 0 ? given / Math.max(1, played) / total : 0;
    for (const [pid, b] of expected) parts.get(pid)!.bonus += (scale - 1) * b;
  }
  for (const [pid, mine] of parts)
    points.set(
      pid,
      PARTS.reduce((t, part) => t + mine[part], 0),
    );
  return { points, parts, minutes };
}

// FPL gives more assists than Opta's xA expects (rebounds, deflections, penalties won),
// and many more to forwards, who win the penalties and have the shots that get saved.
// This season's numbers start from whole seasons' by position.
function assistFactors(h: History, players: Map<number, ModelPlayer>, o: ModelOptions['assists']): Record<Position, number> {
  const sums = new Map<Position, { assists: number; xa: number }>();
  for (const a of h.appearances) {
    const pos = players.get(a.pid)?.pos;
    if (!pos) continue;
    const t = sums.get(pos) ?? { assists: 0, xa: 0 };
    sums.set(pos, { assists: t.assists + a.assists, xa: t.xa + a.xa });
  }
  const factor = (pos: Position) => {
    const t = sums.get(pos) ?? { assists: 0, xa: 0 };
    return (t.assists + o.prior * o.perXa[pos]) / (t.xa + o.prior);
  };
  return { GKP: factor('GKP'), DEF: factor('DEF'), MID: factor('MID'), FWD: factor('FWD') };
}
