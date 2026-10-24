// The season played out SIM_RUNS times. Every unfinished match is played with the odds
// model: each score drawn around the manager's expected score with this season's
// spread, plus a per-run offset for how good they really are. Ties on points split on
// points scored, as in the real table. A match still being played starts from scratch.

import type { Match, OverallRow, Simulation } from '../shared/data.ts';
import { SIM_RUNS, SIM_SEED, SIM_SKILL_SPREAD } from './config.ts';
import type { OddsModel } from './odds.ts';
import type { Season } from './season.ts';
import { round } from './util.ts';

export function simulate(season: Season, managerIds: number[], matches: Match[], overall: OverallRow[], model: OddsModel): Simulation {
  const { scoring } = season;
  const { expectedScore, spreadFor } = model;
  const remaining = matches
    .filter((m) => !m.finished)
    .map((m) => ({ ...m, muHome: expectedScore(m.home, m.gw), muAway: expectedScore(m.away, m.gw), spread: spreadFor(m.gw) }));
  const finishCounts: Record<number, number[]> = Object.fromEntries(managerIds.map((id) => [id, new Array(managerIds.length).fill(0)]));
  const pointsTotal: Record<number, number> = Object.fromEntries(managerIds.map((id) => [id, 0]));
  const normal = gaussian(mulberry32(SIM_SEED));
  for (let run = 0; run < SIM_RUNS; run++) {
    const level: Record<number, number> = Object.fromEntries(managerIds.map((id) => [id, normal() * SIM_SKILL_SPREAD]));
    const table = new Map(overall.map((r) => [r.id, { id: r.id, pts: r.pts, pf: r.pf }]));
    for (const m of remaining) {
      const home = table.get(m.home)!;
      const away = table.get(m.away)!;
      const homePts = Math.round(m.muHome + level[m.home] + normal() * m.spread);
      const awayPts = Math.round(m.muAway + level[m.away] + normal() * m.spread);
      home.pf += homePts;
      away.pf += awayPts;
      home.pts += homePts > awayPts ? scoring.h2h_win : homePts === awayPts ? scoring.h2h_draw : scoring.h2h_lose;
      away.pts += awayPts > homePts ? scoring.h2h_win : homePts === awayPts ? scoring.h2h_draw : scoring.h2h_lose;
    }
    [...table.values()]
      .sort((a, b) => b.pts - a.pts || b.pf - a.pf)
      .forEach((row, position) => {
        finishCounts[row.id][position]++;
        pointsTotal[row.id] += row.pts;
      });
  }
  return {
    runs: SIM_RUNS,
    gameweeksLeft: new Set(remaining.map((m) => m.gw)).size,
    // The numbers behind the model, for the formula shown on the page.
    model: {
      leagueAverage: round(model.leagueMean, 1),
      projected: model.hasProjections ? model.projectedGws.length : 0,
      levelSpread: SIM_SKILL_SPREAD,
      spread: round(model.sigma, 1),
      laterSpread: round(spreadFor(season.nextGw + 1), 1),
    },
    rows: managerIds
      .map((id) => ({ id, pts: round(pointsTotal[id] / SIM_RUNS, 1), positions: finishCounts[id].map((n) => round(n / SIM_RUNS, 4)) }))
      .sort((a, b) => b.pts - a.pts)
      .map((row, i) => ({ ...row, rank: i + 1 })),
  };
}

// Small seeded PRNG (mulberry32) and a Box-Muller normal on top of it.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(random: () => number): () => number {
  return () => {
    let u = 0;
    while (u === 0) u = random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
  };
}
