// The expected-points model's club ratings before the next gameweek, and the season's
// xG they come from, for the Premier League's Team stats.

import type { Forecast } from '../model/forecast.ts';
import type { ById, ClubStrength } from '../shared/data.ts';
import { round } from './util.ts';

export function buildClubStrength({ teams, matches }: Pick<Forecast, 'teams' | 'matches'>, gw: number, size: number): ClubStrength {
  const ratings: ById<[number, number]> = {};
  for (const [club, attack] of teams.attack) ratings[club] = [round(attack, 3), round(teams.defence.get(club) ?? 0, 3)];
  const season: ById<[number, number, number]> = {};
  for (const m of matches) {
    const [played, xg, xga] = season[m.club] ?? [0, 0, 0];
    season[m.club] = [played + 1, xg + m.xg, xga + m.xga];
  }
  for (const [club, [played, xg, xga]] of Object.entries(season)) season[Number(club)] = [played, round(xg, 2), round(xga, 2)];
  return { gw, base: round(teams.base, 3), home: round(teams.home, 3), ratings, size, season };
}
