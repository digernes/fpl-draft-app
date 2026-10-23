// Expected points for a gameweek, from what has been played before it: how strong each
// club is (teams.ts), what share of its attack each player has and how much he is likely
// to play (players.ts), and FPL's scoring over the minutes he might get (points.ts).
// README.md in this folder explains the model and how it tests against FPL's own.

import type { Position } from '../shared/data.ts';
import type { LiveFeed } from '../shared/fpl-api.ts';
import { readHistory, type History, type ModelPlayer } from './history.ts';
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
}

export const DEFAULT_OPTIONS: ModelOptions = {
  teams: { halfLife: 10, prior: 6, home: 0.15, homePrior: 20, goals: 0.15 },
  players: {
    sharePrior: { GKP: 700, DEF: 15, MID: 6, FWD: 60 },
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
  counts: { goals: 10, defcon: 6, saves: { base: 1.41, perXga: 0.99 } },
  finishing: { GKP: 1, DEF: 0.85, MID: 1, FWD: 1 },
  assists: { perXa: { GKP: 1.37, DEF: 1.29, MID: 1.33, FWD: 2.11 }, prior: 10 },
};

export interface ModelInput {
  /** The Draft bootstrap's `settings.scoring`. */
  scoring: Record<string, unknown>;
  players: Map<number, ModelPlayer>;
  /** Live feeds of finished gameweeks; only those before the one forecast are used. */
  feeds: Record<number, LiveFeed>;
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
  const teams = fitTeams(history.matches, { atGw: gw, ...o.teams });
  const scoring = readScoring(input.scoring);
  const assists = assistFactors(history, input.players, o.assists);
  const rates = playerRates(history, input.players, o.players, gw, { finishing: o.finishing, assists, saves: o.counts.saves });
  const scenarios = minutesScenarios(history, o.players);

  // FPL's chance of playing scales him, and the minutes it takes away go to his stand-ins
  // (players.ts).
  const flag = (p: ModelPlayer) => (p.chance == null ? 1 : (p.chance / 100) ** o.players.flagPower);
  const plans = new Map<number, Plan>();
  for (const [pid, p] of input.players)
    if (fixtures.some((f) => f.team_h === p.club || f.team_a === p.club))
      plans.set(pid, { scenarios: scenarios(pid, p.club), chance: flag(p) });
  const starts = standIns(input.players, plans, rates, o.standIns);

  const points = new Map<number, number>();
  const parts = new Map<number, Parts>();
  const minutes = new Map<number, number>();
  for (const [pid, plan] of plans) {
    const p = input.players.get(pid)!;
    const r = rates.get(pid)!;
    const q = starts.get(pid) ?? 0;
    const options = q
      ? [...plan.scenarios.map((s) => ({ ...s, weight: (1 - q) * s.weight })), { minutes: o.standIns.start[p.pos], weight: q }]
      : plan.scenarios;
    // `absent`: the chance that even an unflagged regular misses out.
    const chance = plan.chance * (1 - o.players.absent);
    const mine = Object.fromEntries(PARTS.map((part) => [part, 0])) as Parts;
    let mins = 0;
    for (const f of fixtures.filter((x) => x.team_h === p.club || x.team_a === p.club)) {
      const home = f.team_h === p.club;
      const opp = home ? f.team_a : f.team_h;
      const match = { xg: teams.rate(p.club, opp, home), xga: teams.rate(opp, p.club, !home) };
      for (const s of options) {
        const got = matchParts(p.pos, scoring, r, s.minutes, match, o.counts);
        for (const part of PARTS) mine[part] += chance * s.weight * got[part];
        mins += chance * s.weight * s.minutes;
      }
    }
    parts.set(pid, mine);
    points.set(
      pid,
      PARTS.reduce((t, part) => t + mine[part], 0),
    );
    minutes.set(pid, mins);
  }
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
