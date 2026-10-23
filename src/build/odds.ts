// Odds for upcoming matches, and the model behind them: each manager's expected score
// from their best projected XI that gameweek (by expected points) against the league's
// average one, a normal spread around it, and prices rounded down onto the UK
// fractional ladder.

import type { Data, Match, Odds, Price } from '../shared/data.ts';
import { bestXi } from '../shared/best-xi.ts';
import { price as sharedPrice, winDrawWin } from '../shared/odds.ts';
import { MIN_SCORE_SPREAD, ODDS_GAMEWEEKS, ODDS_OVERROUND, POSITIONS } from './config.ts';
import { modelBefore, modelExpected } from './expected.ts';
import type { Season } from './season.ts';
import { range, round, sum } from './util.ts';

export type OddsModel = ReturnType<typeof oddsModel>;

export function oddsModel(season: Season, managerIds: number[], scoresByGw: Record<string, { pts: number }[]>) {
  const { elements, ownerNow, fplBoot, boot, nextGw, xiLimits, picks, league } = season;
  // The site's own expected points once a gameweek has been played; FPL's until then.
  const model = modelExpected(season);
  const epByCode = new Map((fplBoot?.elements ?? []).map((el) => [el.code, Number(el.ep_next)]));
  const epNowByCode = new Map((fplBoot?.elements ?? []).map((el) => [el.code, Number(el.ep_this)]));
  const fplExpected = (pid: number) => {
    const el = elements.get(pid);
    if (!el) return 0;
    const ep = epByCode.get(el.code);
    if (Number.isFinite(ep)) return ep as number;
    const chance = el.chance_of_playing_next_round ?? (el.status === 'a' ? 100 : 0);
    return (Number(el.form) || 0) * (chance / 100);
  };
  const expected = model?.next ?? fplExpected;
  const xiOf = (squad: number[], xp: (pid: number) => number) => {
    const xi = bestXi(squad, xp, (pid) => POSITIONS[elements.get(pid)?.element_type ?? 0], xiLimits, boot.settings.squad.play);
    return { ids: xi.ids, pts: round(xi.pts, 1) };
  };
  const squadOf = (id: number) => [...ownerNow].filter(([, owner]) => owner === id).map(([pid]) => pid);

  // Every priced gameweek's projected XIs, from today's squads.
  const priced = range(nextGw, Math.min(nextGw + ODDS_GAMEWEEKS - 1, league.stop_event));
  const projections: Record<number, Record<number, { ids: number[]; pts: number }>> = Object.fromEntries(
    priced.map((gw) => {
      const xp = gw === nextGw ? expected : (model?.at(gw) ?? fplExpected);
      return [gw, Object.fromEntries(managerIds.map((id) => [id, xiOf(squadOf(id), xp)]))];
    }),
  );

  const allScores = Object.values(scoresByGw)
    .flat()
    .map((s) => s.pts);
  const leagueMean = allScores.length ? sum(allScores) / allScores.length : 50;
  // How far scores land from their week's average.
  const residuals = Object.values(scoresByGw).flatMap((scores) => {
    const mean = sum(scores.map((s) => s.pts)) / scores.length;
    return scores.map((s) => s.pts - mean);
  });
  const sigma = Math.max(MIN_SCORE_SPREAD, residuals.length > 4 ? Math.sqrt(sum(residuals.map((r) => r * r)) / residuals.length) : 0);
  const hasProjections = (model !== null || epByCode.size > 0) && managerIds.some((id) => (projections[nextGw]?.[id]?.pts ?? 0) > 0);

  const byGw: Record<number, (id: number) => number> = Object.fromEntries(
    priced.map((gw) => [gw, fromProjections(Object.fromEntries(managerIds.map((id) => [id, projections[gw][id].pts])), leagueMean)]),
  );
  // The weeks after the priced ones, and one being played, get each side's average over those.
  const later = (id: number) => (priced.length ? sum(priced.map((gw) => byGw[gw](id))) / priced.length : leagueMean);
  const expectedScore = (id: number, gw: number) => (hasProjections ? (byGw[gw] ?? later)(id) : leagueMean);
  const spreadFor = (gw: number) => sigma * (gw === nextGw ? 1 : 1.1);

  // A gameweek that started before odds were kept: what the model would have said with
  // only the gameweeks before it, from each side's squad that week.
  const before = (gw: number) => {
    const earlier = Object.entries(scoresByGw).flatMap(([g, scores]) => (Number(g) < gw ? scores.map((s) => s.pts) : []));
    const mean = earlier.length ? sum(earlier) / earlier.length : leagueMean;
    const xp = modelBefore(season, gw);
    if (!xp) return () => mean;
    const squad = (id: number) => picks[id]?.[gw]?.picks.map((p) => p.element) ?? [];
    return fromProjections(Object.fromEntries(managerIds.map((id) => [id, xiOf(squad(id), xp).pts])), mean);
  };

  // FPL's own for the gameweek being played, and the site's, for the live odds.
  const fplNow = (pid: number) => {
    const ep = epNowByCode.get(elements.get(pid)?.code ?? -1);
    return Number.isFinite(ep) ? (ep as number) : fplExpected(pid);
  };
  const expectedNow = model?.now ?? fplNow;
  return {
    expected,
    expectedNow,
    fplExpected,
    fplNow,
    fromFpl: model === null,
    milestones: model?.milestones,
    priced,
    projections,
    leagueMean,
    sigma,
    hasProjections,
    expectedScore,
    spreadFor,
    before,
  };
}

/** Each side's expected score: the league's average plus how far its projected XI sits from the average one. */
export function fromProjections(projected: Record<number, number>, leagueMean: number): (id: number) => number {
  const all = Object.values(projected);
  const average = all.length ? sum(all) / all.length : 0;
  return (id) => leagueMean + (projected[id] ?? average) - average;
}

// Prices every match in the next ODDS_GAMEWEEKS gameweeks. A started match keeps the
// odds the last build before its deadline gave it (from `previous`, the last data.json).
export function priceMatches(matches: Match[], model: OddsModel, nextGw: number, previous: Partial<Data> | null) {
  const { sigma, hasProjections, expectedScore, spreadFor, projections, before } = model;
  const priced = (muHome: number, muAway: number, spread: number): Odds => {
    const p = winDrawWin(muHome, muAway, spread);
    return {
      p: [round(p.home, 3), round(p.draw, 3), round(p.away, 3)],
      prices: [price(p.home), price(p.draw), price(p.away)],
      expected: [round(muHome, 1), round(muAway, 1)],
    };
  };
  const afterwards = new Map<number, (id: number) => number>();
  const keptOdds = new Map((previous?.matches ?? []).flatMap((m) => (m.odds ? [[`${m.gw}:${m.home}:${m.away}`, m.odds] as const] : [])));
  for (const m of matches) {
    if (m.started) {
      // Pre-match odds: frozen at the last build before the deadline.
      const kept = keptOdds.get(`${m.gw}:${m.home}:${m.away}`);
      if (kept) {
        const { xi: _xi, ...odds } = kept;
        m.odds = odds;
      } else {
        if (!afterwards.has(m.gw)) afterwards.set(m.gw, before(m.gw));
        const mu = afterwards.get(m.gw)!;
        m.odds = { ...priced(mu(m.home), mu(m.away), sigma), afterwards: true };
      }
      continue;
    }
    if (m.gw < nextGw || m.gw >= nextGw + ODDS_GAMEWEEKS) continue;
    m.odds = priced(expectedScore(m.home, m.gw), expectedScore(m.away, m.gw), spreadFor(m.gw));
    if (m.gw === nextGw && hasProjections) m.odds.xi = [projections[nextGw][m.home].ids, projections[nextGw][m.away].ids];
  }
}

export { normalCdf, winDrawWin } from '../shared/odds.ts';

export function price(probability: number): Price {
  return sharedPrice(probability, ODDS_OVERROUND);
}
