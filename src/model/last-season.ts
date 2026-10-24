// Last season, where this season's shares and club ratings start: each player's share of
// his club's attack and each club's attack and defence there, worked out the model's own
// way from a summary of the season (src/build/last-season.ts keeps those). Only a player
// still at the same club starts from his own, and a club promoted since from the league
// average; everyone else starts from the averages, as before there was a last season.

import type { ClubMatch } from './history.ts';
import { seasonShares, type Conversion, type PlayerOptions, type SeasonTotals, type Shares } from './players.ts';
import { fitTeams, type TeamOptions } from './teams.ts';

/** Last season in this season's ids: its players still at their club, and its matches (a club since gone down keeps an id of its own). */
export interface LastSeason {
  players: Map<number, SeasonTotals>;
  matches: ClubMatch[];
}

export interface StartingPoint {
  shares: Map<number, Shares>;
  attack: Map<number, number>;
  defence: Map<number, number>;
}

/**
 * Last season's shares, from its whole season's totals (with the whole-season FPL assists
 * per xA), and its club ratings from all its matches, each counting `clubs` of the way
 * from the league average.
 */
export function startingPoint(
  last: LastSeason,
  players: PlayerOptions,
  c: Conversion,
  teams: Omit<TeamOptions, 'atGw'>,
  clubs: number,
): StartingPoint {
  const fit = fitTeams(last.matches, { ...teams, atGw: 0, halfLife: Infinity });
  const scaled = (ratings: Map<number, number>) => new Map([...ratings].map(([club, x]) => [club, clubs * x]));
  return { shares: seasonShares(last.players, players, c), attack: scaled(fit.attack), defence: scaled(fit.defence) };
}
