// Each club's attack and defence, from the xG in its matches. A Poisson model: a club's
// expected goals against an opponent are exp(base + home + its attack − the opponent's
// defence). Recent matches count for more, and every rating is pulled towards the
// league average by a prior worth `prior` xG, which matters most early in a season (or
// towards last season's, for a club that was in the league then).

import type { ClubMatch } from './history.ts';

export interface TeamOptions {
  /** The gameweek being forecast: a match `halfLife` gameweeks before it counts half. */
  atGw: number;
  halfLife: number;
  /** How much xG of average matches each club's ratings start from. */
  prior: number;
  /** Home advantage on the log scale, and how much xG of matches it starts from. */
  home: number;
  homePrior: number;
  /** How much the goals scored count next to the xG (0: xG only). */
  goals: number;
  /** Where each club's ratings start instead of the league average: last season's (last-season.ts). */
  centre?: { attack: Map<number, number>; defence: Map<number, number> };
}

export interface Teams {
  /** The xG `club` can expect against `opp`. */
  rate(club: number, opp: number, home: boolean): number;
  attack: Map<number, number>;
  defence: Map<number, number>;
  home: number;
}

export function fitTeams(matches: ClubMatch[], o: TeamOptions): Teams {
  const rows = matches.map((m) => ({ ...m, y: (1 - o.goals) * m.xg + o.goals * m.goals, w: 0.5 ** ((o.atGw - m.gw) / o.halfLife) }));
  const attack = new Map<number, number>();
  const defence = new Map<number, number>();
  let base = Math.log(1.4); // roughly a club's goals per match, until the first step
  let home = o.home;
  const rate = (club: number, opp: number, atHome: boolean) =>
    Math.exp(base + (atHome ? home : 0) + (attack.get(club) ?? 0) - (defence.get(opp) ?? 0));

  // Newton steps on one group of parameters at a time; a few dozen rounds settle it.
  const step = (subset: typeof rows, sign: number, current: number, prior: number, centre = 0) => {
    let gradient = -prior * (current - centre);
    let curvature = prior;
    for (const r of subset) {
      const lambda = rate(r.club, r.opp, r.home);
      gradient += sign * r.w * (r.y - lambda);
      curvature += r.w * lambda;
    }
    return curvature > 0 ? current + gradient / curvature : current;
  };
  const clubs = [...new Set(rows.flatMap((r) => [r.club, r.opp]))];
  const attacking = new Map(clubs.map((c) => [c, rows.filter((r) => r.club === c)]));
  const defending = new Map(clubs.map((c) => [c, rows.filter((r) => r.opp === c)]));
  const atHome = rows.filter((r) => r.home);
  for (let round = 0; round < 60; round++) {
    base = step(rows, 1, base, 0);
    home = step(atHome, 1, home, o.homePrior, o.home);
    for (const c of clubs) attack.set(c, step(attacking.get(c)!, 1, attack.get(c) ?? 0, o.prior, o.centre?.attack.get(c)));
    for (const c of clubs) defence.set(c, step(defending.get(c)!, -1, defence.get(c) ?? 0, o.prior, o.centre?.defence.get(c)));
  }
  return { rate, attack, defence, home };
}
