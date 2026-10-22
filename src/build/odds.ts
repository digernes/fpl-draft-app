// Odds for upcoming matches, and the model behind them: each manager's expected score
// from recent form and (next gameweek only) their best projected XI, a normal spread
// around it, and prices rounded down onto the UK fractional ladder.

import type { Data, Match, MatchResult, Odds, Price } from '../shared/data.ts';
import { FORM_WEIGHT, FRACTIONS, MIN_SCORE_SPREAD, ODDS_GAMEWEEKS, ODDS_OVERROUND, POSITIONS, PROJECTION_WEIGHT } from './config.ts';
import type { Season } from './season.ts';
import type { Results } from './tables.ts';
import { round, sum } from './util.ts';

export type OddsModel = ReturnType<typeof oddsModel>;

export function oddsModel(season: Season, managerIds: number[], results: Results, scoresByGw: Record<string, { pts: number }[]>) {
  const { elements, ownerNow, fplBoot, boot, nextGw } = season;
  const epByCode = new Map((fplBoot?.elements ?? []).map((el) => [el.code, Number(el.ep_next)]));
  const expected = (pid: number) => {
    const el = elements.get(pid);
    if (!el) return 0;
    const ep = epByCode.get(el.code);
    if (Number.isFinite(ep)) return ep as number;
    const chance = el.chance_of_playing_next_round ?? (el.status === 'a' ? 100 : 0);
    return (Number(el.form) || 0) * (chance / 100);
  };
  const projections = Object.fromEntries(
    managerIds.map((id) => {
      const squad = [...ownerNow].filter(([, owner]) => owner === id).map(([pid]) => pid);
      return [id, bestXi(squad, expected, (pid) => elements.get(pid)?.element_type, boot.settings.squad)];
    }),
  );

  const allScores = Object.values(scoresByGw)
    .flat()
    .map((s) => s.pts);
  const leagueMean = allScores.length ? sum(allScores) / allScores.length : 50;
  const ratings: Record<number, number> = Object.fromEntries(managerIds.map((id) => [id, rating(results[id], leagueMean)]));
  const residuals = managerIds.flatMap((id) => results[id].map((r) => r.pf - ratings[id]));
  const sigma = Math.max(MIN_SCORE_SPREAD, residuals.length > 4 ? Math.sqrt(sum(residuals.map((r) => r * r)) / residuals.length) : 0);
  const meanProjection = sum(managerIds.map((id) => projections[id].pts)) / managerIds.length;
  const hasProjections = epByCode.size > 0 && meanProjection > 0;

  const expectedScore = (id: number, gw: number) =>
    leagueMean +
    FORM_WEIGHT * (ratings[id] - leagueMean) +
    (gw === nextGw && hasProjections ? PROJECTION_WEIGHT * (projections[id].pts - meanProjection) : 0);
  const spreadFor = (gw: number) => sigma * (gw === nextGw ? 1 : 1.1);

  return { expected, projections, leagueMean, sigma, hasProjections, expectedScore, spreadFor };
}

// Prices every match in the next ODDS_GAMEWEEKS gameweeks. A started match keeps the
// odds the last build before its deadline gave it (from `previous`, the last data.json).
export function priceMatches(
  matches: Match[],
  managerIds: number[],
  results: Results,
  model: OddsModel,
  nextGw: number,
  previous: Partial<Data> | null,
) {
  const { leagueMean, sigma, hasProjections, expectedScore, spreadFor, projections } = model;
  const priced = (muHome: number, muAway: number, spread: number): Odds => {
    const p = winDrawWin(muHome, muAway, spread);
    return {
      p: [round(p.home, 3), round(p.draw, 3), round(p.away, 3)],
      prices: [price(p.home), price(p.draw), price(p.away)],
      expected: [round(muHome, 1), round(muAway, 1)],
    };
  };
  // A match that started before odds were kept gets what the model would have said
  // with only the results before that gameweek: form, no projections.
  const formBefore = (gw: number) => {
    const before = (id: number) => results[id].filter((r) => r.gw < gw);
    const scores = managerIds.flatMap((id) => before(id).map((r) => r.pf));
    const mean = scores.length ? sum(scores) / scores.length : leagueMean;
    return (id: number) => mean + FORM_WEIGHT * (rating(before(id), mean) - mean);
  };
  const keptOdds = new Map((previous?.matches ?? []).flatMap((m) => (m.odds ? [[`${m.gw}:${m.home}:${m.away}`, m.odds] as const] : [])));
  for (const m of matches) {
    if (m.started) {
      // Pre-match odds: frozen at the last build before the deadline.
      const kept = keptOdds.get(`${m.gw}:${m.home}:${m.away}`);
      if (kept) {
        const { xi: _xi, ...odds } = kept;
        m.odds = odds;
      } else {
        const mu = formBefore(m.gw);
        m.odds = { ...priced(mu(m.home), mu(m.away), sigma), afterwards: true };
      }
      continue;
    }
    if (m.gw < nextGw || m.gw >= nextGw + ODDS_GAMEWEEKS) continue;
    m.odds = priced(expectedScore(m.home, m.gw), expectedScore(m.away, m.gw), spreadFor(m.gw));
    if (m.gw === nextGw && hasProjections) m.odds.xi = [projections[m.home].ids, projections[m.away].ids];
  }
}

// Best legal XI by expected points, honouring the league's formation limits.
export function bestXi(
  squad: number[],
  expected: (pid: number) => number,
  positionOf: (pid: number) => number | undefined,
  rules: Season['boot']['settings']['squad'],
): { ids: number[]; pts: number } {
  const byPos: Record<number, number[]> = { 1: [], 2: [], 3: [], 4: [] };
  for (const pid of squad) byPos[positionOf(pid) ?? 0]?.push(pid);
  for (const list of Object.values(byPos)) list.sort((a, b) => expected(b) - expected(a));
  const limits = [1, 2, 3, 4].map((t) => {
    const key = POSITIONS[t];
    return [rules[`min_play_${key}`], Math.min(rules[`max_play_${key}`], byPos[t].length)];
  });
  let best = { ids: [] as number[], pts: 0 };
  const choose = (t: number, counts: number[]) => {
    if (t === 4) {
      if (sum(counts) !== rules.play) return;
      const ids = counts.flatMap((n, i) => byPos[i + 1].slice(0, n));
      const pts = sum(ids.map(expected));
      if (pts > best.pts) best = { ids, pts };
      return;
    }
    for (let n = limits[t][0]; n <= limits[t][1]; n++) choose(t + 1, [...counts, n]);
  };
  choose(0, []);
  return { ids: best.ids, pts: round(best.pts, 1) };
}

// Recency-weighted average score, shrunk towards the league mean early in the season.
export function rating(results: MatchResult[], leagueMean: number, decay = 0.85, prior = 2): number {
  let weighted = prior * leagueMean;
  let weights = prior;
  results.forEach((r, i) => {
    const w = decay ** (results.length - 1 - i);
    weighted += w * r.pf;
    weights += w;
  });
  return weighted / weights;
}

// Both scores ~ Normal(mu, sigma); a draw is the two landing on the same integer.
export function winDrawWin(muHome: number, muAway: number, sigma: number) {
  const spread = Math.SQRT2 * sigma;
  const diff = muHome - muAway;
  const home = 1 - normalCdf((0.5 - diff) / spread);
  const away = normalCdf((-0.5 - diff) / spread);
  return { home, draw: 1 - home - away, away };
}

export function normalCdf(x: number): number {
  // Abramowitz & Stegun 7.1.26
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-z * z);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

export function price(probability: number): Price {
  const fair = 1 / (probability * ODDS_OVERROUND);
  let [num, den] = FRACTIONS[0];
  for (const [n, d] of FRACTIONS) if (1 + n / d <= fair + 1e-9) [num, den] = [n, d];
  return { dec: round(1 + num / den, 2), frac: `${num}/${den}` };
}
