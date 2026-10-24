// FPL's scoring applied to one match: what a player can expect from a given number of
// minutes against a given opponent. Goals and assists come from his share of his club's
// expected goals; clean sheets, goals conceded and saves from the goals his club can
// expect to concede; the defensive contribution from the chance his tackles, clearances,
// blocks and interceptions (and recoveries, outside defence) reach FPL's threshold; bonus
// from what all of those earn in it. Goals and defensive actions vary more from match to
// match than a Poisson allows, so they are negative binomials.

import type { Position } from '../shared/data.ts';
import type { BonusRates } from './bonus.ts';

export interface Scoring {
  goal: Record<Position, number>;
  cleanSheet: Record<Position, number>;
  /** Per `concedeLimit` goals conceded. */
  conceded: Record<Position, number>;
  concedeLimit: number;
  assist: number;
  shortPlay: number;
  longPlay: number;
  longPlayLimit: number;
  /** Per `savesLimit` saves. */
  saves: number;
  savesLimit: number;
  defcon: Record<Position, number>;
  defconLimit: Record<Position, number>;
  yellow: number;
  penaltySaved: number;
  penaltyMissed: number;
}

const POSITIONS: Position[] = ['GKP', 'DEF', 'MID', 'FWD'];

/** From the Draft bootstrap's `settings.scoring`, which names each rule (goals_scored_DEF and so on). */
export function readScoring(rules: Record<string, unknown>): Scoring {
  const rule = (key: string) => (typeof rules[key] === 'number' ? (rules[key] as number) : 0);
  const byPosition = (key: string) => Object.fromEntries(POSITIONS.map((pos) => [pos, rule(`${key}_${pos}`)])) as Record<Position, number>;
  return {
    goal: byPosition('goals_scored'),
    cleanSheet: byPosition('clean_sheets'),
    conceded: byPosition('goals_conceded'),
    concedeLimit: rule('concede_limit') || 2,
    assist: rule('assists'),
    shortPlay: rule('short_play'),
    longPlay: rule('long_play'),
    longPlayLimit: rule('long_play_limit') || 60,
    saves: rule('saves'),
    savesLimit: rule('saves_limit') || 3,
    defcon: byPosition('defensive_contribution'),
    defconLimit: byPosition('defensive_contribution_limit'),
    yellow: rule('yellow_cards'),
    penaltySaved: rule('penalties_saved'),
    penaltyMissed: rule('penalties_missed'),
  };
}

/** What a player brings per match, from players.ts. */
export interface Rates {
  /** His goals and FPL assists per xG his club makes while he is on the pitch. */
  goalShare: number;
  assistShare: number;
  defcon90: number;
  /** A goalkeeper's saves against the league's line (`Counts.saves`): 1 is average. */
  savesFactor: number;
  /** His bonus per 90 beyond what his goals, assists and the rest earn at his position (bonus.ts). */
  bonus90: number;
  yellow90: number;
}

export interface Match {
  /** The xG his club can expect, and the xG it can expect to concede, over 90 minutes. */
  xg: number;
  xga: number;
  /**
   * The penalties his club and its opponent can expect, and the chance he takes his
   * club's: that nobody ahead of him in FPL's order is on the pitch (0 when he isn't on it).
   */
  penalties?: { for: number; against: number; first: number };
}

export const PARTS = [
  'appearance',
  'goals',
  'penalties',
  'assists',
  'cleanSheet',
  'conceded',
  'defcon',
  'saves',
  'bonus',
  'cards',
] as const;
export type Parts = Record<(typeof PARTS)[number], number>;

/**
 * How the counts behave: how spread out goals and defensive actions are, as negative
 * binomial sizes (Infinity: Poisson), a goalkeeper's saves per 90 as
 * `base + perXga × the xG his club concedes`, and penalties: a club's per match at an
 * average attack, and the shares scored (a penalty's xG) and saved.
 */
export interface Counts {
  goals: number;
  defcon: number;
  saves: { base: number; perXga: number };
  penalties: { perMatch: number; scored: number; saved: number };
}

export function matchParts(pos: Position, s: Scoring, r: Rates, minutes: number, m: Match, counts: Counts, b: BonusRates): Parts {
  const share = minutes / 90;
  const against = m.xga * share;
  const long = minutes >= s.longPlayLimit;
  if (minutes <= 0) return Object.fromEntries(PARTS.map((part) => [part, 0])) as Parts;
  // What he can expect to do: his goals and assists, the penalties he takes, the chances of
  // a clean sheet and a defensive contribution, and a goalkeeper's saves.
  const goals = r.goalShare * m.xg * share;
  const assists = r.assistShare * m.xg * share;
  const taken = share * (m.penalties?.first ?? 0) * (m.penalties?.for ?? 0);
  const cleanSheet = long ? chances(against, counts.goals)[0] : 0;
  const defcon = s.defconLimit[pos] ? atLeast(r.defcon90 * share, counts.defcon, s.defconLimit[pos]) : 0;
  const saves = pos === 'GKP' ? r.savesFactor * (counts.saves.base * share + counts.saves.perXga * against) : 0;
  return {
    appearance: long ? s.longPlay : s.shortPlay,
    goals: s.goal[pos] * goals,
    // A penalty he takes: the goal when it goes in, the deduction when it doesn't; for a
    // goalkeeper, the penalties he saves.
    penalties:
      taken * (counts.penalties.scored * s.goal[pos] + (1 - counts.penalties.scored) * s.penaltyMissed) +
      (pos === 'GKP' ? share * (m.penalties?.against ?? 0) * counts.penalties.saved * s.penaltySaved : 0),
    assists: s.assist * assists,
    cleanSheet: s.cleanSheet[pos] * cleanSheet,
    conceded: s.conceded[pos] * floorMean(against, s.concedeLimit, counts.goals),
    defcon: s.defcon[pos] * defcon,
    saves: pos === 'GKP' ? s.saves * floorMean(saves, s.savesLimit) : 0,
    // What those earn in bonus at his position, and his own beyond them (bonus.ts).
    bonus: Math.max(
      0,
      b.per90 * share +
        b.goal * (goals + taken * counts.penalties.scored) +
        b.assist * assists +
        b.cleanSheet * cleanSheet +
        b.defcon * defcon +
        (b.saves * saves) / 3 +
        r.bonus90 * share,
    ),
    cards: s.yellow * r.yellow90 * share,
  };
}

// Chances of 0, 1, 2… for a count with this mean: a negative binomial of this size
// (smaller is more spread out), or a Poisson when the size is infinite.
export function chances(mean: number, size: number): number[] {
  const top = Math.ceil(mean + 12 * Math.sqrt(mean * (1 + mean / size)) + 20);
  const out: number[] = [];
  const poisson = !Number.isFinite(size);
  const q = poisson ? 0 : size / (size + mean);
  let p = poisson ? Math.exp(-mean) : q ** size;
  for (let x = 0; x <= top; x++) {
    out.push(p);
    p *= poisson ? mean / (x + 1) : ((x + size) / (x + 1)) * (1 - q);
  }
  return out;
}

/** E[floor(X / k)]: the goals-conceded deduction and the saves points. */
export function floorMean(mean: number, k: number, size = Infinity): number {
  if (mean <= 0) return 0;
  return chances(mean, size).reduce((t, p, x) => t + Math.floor(x / k) * p, 0);
}

/** P(X ≥ limit): the defensive contribution. */
export function atLeast(mean: number, size: number, limit: number): number {
  if (mean <= 0) return 0;
  return Math.max(
    0,
    1 -
      chances(mean, size)
        .slice(0, limit)
        .reduce((t, p) => t + p, 0),
  );
}
