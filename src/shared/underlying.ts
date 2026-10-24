// Expected ("underlying") points, in the spirit of FotMob's xG: the returns that swing on
// finishing (goals, assists, clean sheets, goals conceded) swapped for what a player's xG,
// xA and xGC were worth. Minutes, bonus, saves, cards and defensive contributions stay as
// scored. xCS, the expected clean sheets, is only there for positions where a clean sheet
// scores. The build works them out for finished gameweeks, the page for the one being played,
// and both keep the parts that stay as scored, for the tooltips that take xP apart.

import type { PlStat, Position, Underlying } from './data.ts';

/** A gameweek's FPL stats, as its live feed has them. */
export interface UnderlyingStats {
  minutes: number;
  total_points: number;
  expected_goals?: number | string | null;
  expected_assists?: number | string | null;
  expected_goals_conceded?: number | string | null;
}

/** What xP and xCS are, in the page's words, for their tips. */
export const UNDERLYING_TIPS = {
  xp: 'Points, but from xG, xA and xCS instead of goals, assists and clean sheets',
  xcs: 'Expected clean sheets, from the xG conceded',
};

/** FPL's points for each of a player's stats, by its names for them: as its live feed explains them, or as `scoredIn` works them out. */
export type Scored = Record<string, number>;

/** The parts of xP that stay as FPL scored them, in its tooltip's order: `other` is anything FPL scores that isn't named here. */
export const AS_SCORED = ['playing', 'penalties', 'defcon', 'saves', 'bonus', 'cards', 'ownGoals', 'other'] as const;
const PART_OF: Record<string, (typeof AS_SCORED)[number]> = {
  minutes: 'playing',
  penalties_saved: 'penalties',
  penalties_missed: 'penalties',
  defensive_contribution: 'defcon',
  saves: 'saves',
  bonus: 'bonus',
  yellow_cards: 'cards',
  red_cards: 'cards',
  own_goals: 'ownGoals',
};
// The ones xP swaps for what was expected.
const SWAPPED = ['goals_scored', 'assists', 'clean_sheets', 'goals_conceded'];

const total = (xs: number[]) => xs.reduce((t, x) => t + x, 0);
const ruleOf = (rules: Record<string, unknown>) => (key: string) => {
  const value = rules[key];
  return typeof value === 'number' ? value : 0;
};

/** What his xG, xA, xCS and xGC were worth: the points xP has instead of those for his goals, assists, clean sheets and goals conceded. */
export function expectedPoints(
  x: { xg: number; xa: number; xcs?: number; xgc?: number },
  rules: Record<string, unknown>,
  pos: Position | undefined,
) {
  const rule = ruleOf(rules);
  return {
    goals: rule(`goals_scored_${pos}`) * x.xg,
    assists: rule('assists') * x.xa,
    cleanSheet: rule(`clean_sheets_${pos}`) * (x.xcs ?? 0),
    conceded: (rule(`goals_conceded_${pos}`) * (x.xgc ?? 0)) / rule('concede_limit'), // per `concede_limit` goals
  };
}

/**
 * `rules`: FPL's scoring; `fixtures`: how many matches his club had that gameweek; `scored`:
 * FPL's points for each of his stats. Without xG (an older feed), just his minutes and points.
 */
export function underlyingOf(
  s: UnderlyingStats,
  rules: Record<string, unknown>,
  pos: Position | undefined,
  fixtures: number,
  scored: Scored,
) {
  if (s.expected_goals == null) return { minutes: s.minutes, xp: s.total_points };
  const rule = ruleOf(rules);
  const fullGames = Math.min(fixtures, Math.floor(s.minutes / rule('long_play_limit')));
  const xg = Number(s.expected_goals);
  const xa = Number(s.expected_assists);
  const xgc = Number(s.expected_goals_conceded);
  const xcs = fullGames * Math.exp(-xgc / fixtures); // the chance of a clean sheet, per full game
  const asScored = AS_SCORED.map(() => 0);
  for (const [stat, points] of Object.entries(scored))
    if (!SWAPPED.includes(stat)) asScored[AS_SCORED.indexOf(PART_OF[stat] ?? 'other')] += points;
  // Whatever his points have that the stats leave out, so that the parts add up to them.
  asScored[AS_SCORED.indexOf('other')] += s.total_points - total(SWAPPED.map((stat) => scored[stat] ?? 0)) - total(asScored);
  const expected = expectedPoints({ xg, xa, xcs, xgc }, rules, pos);
  return {
    minutes: s.minutes,
    xg,
    xa,
    xcs: rule(`clean_sheets_${pos}`) ? xcs : undefined,
    xgc,
    xp: total(Object.values(expected)) + total(asScored),
    asScored,
  };
}

/** FPL's points for each of his stats in one match, worked out from them as FPL scores: for a match being played, which the page has no explanation of. */
export function scoredIn(
  stat: (name: PlStat) => number,
  minutes: number,
  rules: Record<string, unknown>,
  pos: Position | undefined,
): Scored {
  const rule = ruleOf(rules);
  const defcon = rule(`defensive_contribution_limit_${pos}`);
  return {
    minutes: minutes >= rule('long_play_limit') ? rule('long_play') : minutes > 0 ? rule('short_play') : 0,
    goals_scored: rule(`goals_scored_${pos}`) * stat('goals_scored'),
    assists: rule('assists') * stat('assists'),
    clean_sheets: rule(`clean_sheets_${pos}`) * stat('clean_sheets'),
    goals_conceded: rule(`goals_conceded_${pos}`) * Math.floor(stat('goals_conceded') / rule('concede_limit')),
    defensive_contribution: defcon && stat('defensive_contribution') >= defcon ? rule(`defensive_contribution_${pos}`) : 0,
    saves: rule('saves') * Math.floor(stat('saves') / rule('saves_limit')),
    penalties_saved: rule('penalties_saved') * stat('penalties_saved'),
    penalties_missed: rule('penalties_missed') * stat('penalties_missed'),
    yellow_cards: rule('yellow_cards') * stat('yellow_cards'),
    red_cards: rule('red_cards') * stat('red_cards'),
    own_goals: rule('own_goals') * stat('own_goals'),
    bonus: rule('bonus') * stat('bonus'),
  };
}

const round = (x: number, digits: number) => Math.round(x * 10 ** digits) / 10 ** digits;

/** As data.json keeps them, for a player who got on the pitch: rounded, and xCS and xGC only where a clean sheet scores. */
export function packUnderlying(u: ReturnType<typeof underlyingOf> | undefined): Underlying | undefined {
  if (!u?.minutes || u.xg === undefined) return undefined;
  return [round(u.xg, 2), round(u.xa, 2), round(u.xp, 1), ...(u.xcs === undefined ? [] : [round(u.xcs, 2), round(u.xgc, 2)])] as Underlying;
}

/** The parts that stay as scored, as data.json keeps them beside those: without the noughts at the end. */
export function packAsScored(u: ReturnType<typeof underlyingOf> | undefined): number[] | undefined {
  if (!packUnderlying(u) || !u?.asScored) return undefined;
  const parts = [...u.asScored];
  while (parts.length && parts[parts.length - 1] === 0) parts.pop();
  return parts;
}
