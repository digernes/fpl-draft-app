// Expected ("underlying") points, in the spirit of FotMob's xG: the returns that swing on
// finishing (goals, assists, clean sheets, goals conceded) swapped for what a player's xG,
// xA and xGC were worth. Minutes, bonus, saves, cards and defensive contributions stay as
// scored. xCS, the expected clean sheets, is only there for positions where a clean sheet
// scores. The build works them out for finished gameweeks, the page for the one being played.

import type { Position, Underlying } from './data.ts';

/** A gameweek's FPL stats, as its live feed has them. */
export interface UnderlyingStats {
  minutes: number;
  total_points: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
  goals_conceded: number;
  expected_goals?: number | string | null;
  expected_assists?: number | string | null;
  expected_goals_conceded?: number | string | null;
}

/** `rules`: FPL's scoring; `fixtures`: how many matches his club had that gameweek. Without xG (an older feed), just his minutes and points. */
export function underlyingOf(s: UnderlyingStats, rules: Record<string, unknown>, pos: Position | undefined, fixtures: number) {
  const rule = (key: string) => {
    const value = rules[key];
    return typeof value === 'number' ? value : 0;
  };
  if (s.expected_goals == null) return { minutes: s.minutes, xp: s.total_points };
  const goal = rule(`goals_scored_${pos}`);
  const cleanSheet = rule(`clean_sheets_${pos}`);
  const conceded = rule(`goals_conceded_${pos}`); // per `concede_limit` goals
  const fullGames = Math.min(fixtures, Math.floor(s.minutes / rule('long_play_limit')));
  const xConceded = Number(s.expected_goals_conceded);
  const actual =
    goal * s.goals_scored +
    rule('assists') * s.assists +
    cleanSheet * s.clean_sheets +
    conceded * Math.floor(s.goals_conceded / rule('concede_limit'));
  const xg = Number(s.expected_goals);
  const xa = Number(s.expected_assists);
  const xcs = fullGames * Math.exp(-xConceded / fixtures); // the chance of a clean sheet, per full game
  const expected = goal * xg + rule('assists') * xa + cleanSheet * xcs + (conceded * xConceded) / rule('concede_limit');
  return { minutes: s.minutes, xg, xa, xcs: cleanSheet ? xcs : undefined, xgc: xConceded, xp: s.total_points - actual + expected };
}

const round = (x: number, digits: number) => Math.round(x * 10 ** digits) / 10 ** digits;

/** As data.json keeps them, for a player who got on the pitch: rounded, and xCS and xGC only where a clean sheet scores. */
export function packUnderlying(u: ReturnType<typeof underlyingOf> | undefined): Underlying | undefined {
  if (!u?.minutes || u.xg === undefined) return undefined;
  return [round(u.xg, 2), round(u.xa, 2), round(u.xp, 1), ...(u.xcs === undefined ? [] : [round(u.xcs, 2), round(u.xgc, 2)])] as Underlying;
}
