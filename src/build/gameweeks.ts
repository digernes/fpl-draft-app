// The best and worst gameweeks, and the season's records.

import type { Decided, GameweekScore, Match, Records, SeasonStat, TopGameweek } from '../shared/data.ts';
import { TOP_GAMEWEEKS } from './config.ts';
import type { lineupOf } from './lineups.ts';
import type { Season } from './season.ts';
import { maxBy } from './util.ts';

type LineupOf = ReturnType<typeof lineupOf>;

// Top gameweeks (DGW-adjusted, at least one per manager). This is also the
// highest-gameweek prize: on a tie the earlier week wins, and two managers on the same
// score in the same week share the place.
export function buildGameweeks(season: Season, managerIds: number[], matches: Match[], lineup: LineupOf) {
  const { finishedGws, pointsIn } = season;
  const candidates: GameweekScore[] = managerIds
    .flatMap((id) =>
      finishedGws.flatMap((gw) => {
        const l = lineup(id, gw);
        return l ? [{ id, gw, pts: l.pts, dgw: l.dgw, adj: l.adj, rank: 0 }] : [];
      }),
    )
    .sort((a, b) => b.adj - a.adj || a.gw - b.gw);
  candidates.forEach((c, i) => {
    const prev = candidates[i - 1];
    c.rank = prev && prev.adj === c.adj && prev.gw === c.gw ? prev.rank : i + 1;
  });
  const chosen = new Set(managerIds.flatMap((id) => candidates.find((c) => c.id === id) ?? []));
  for (const c of candidates) {
    if (chosen.size >= TOP_GAMEWEEKS) break;
    chosen.add(c);
  }
  const topGameweeks: TopGameweek[] = [...chosen]
    .sort((a, b) => a.rank - b.rank)
    .map((c) => {
      const m = matches.find((x) => x.gw === c.gw && (x.home === c.id || x.away === c.id));
      const opp = m && (m.home === c.id ? m.away : m.home);
      const oppPts = m && (m.home === c.id ? m.awayPts : m.homePts);
      const star = maxBy(lineup(c.id, c.gw)?.xi ?? [], (pid) => pointsIn(pid, c.gw));
      return {
        ...c,
        guaranteed: c.rank > TOP_GAMEWEEKS,
        opp,
        oppPts,
        star: star ? { player: star, pts: pointsIn(star, c.gw) } : null,
      };
    });
  const worstGameweeks = [...candidates].sort((a, b) => a.pts - b.pts || a.gw - b.gw).slice(0, 5);
  return { candidates, topGameweeks, worstGameweeks };
}

export function buildRecords(
  season: Season,
  managerIds: number[],
  matches: Match[],
  candidates: GameweekScore[],
  seasonStats: SeasonStat[],
  lineup: LineupOf,
): Records {
  const decided: Decided[] = matches
    .filter((m) => m.finished)
    .map((m) => {
      const homePts = m.homePts as number;
      const awayPts = m.awayPts as number;
      const homeWon = homePts >= awayPts;
      return {
        gw: m.gw,
        winner: homeWon ? m.home : m.away,
        loser: homeWon ? m.away : m.home,
        winPts: Math.max(homePts, awayPts),
        losePts: Math.min(homePts, awayPts),
        margin: Math.abs(homePts - awayPts),
      };
    });
  const wins = decided.filter((d) => d.margin > 0);
  const benchGws = managerIds.flatMap((id) => season.finishedGws.map((gw) => ({ id, gw, pts: lineup(id, gw)?.benchPts ?? 0 })));
  return {
    highest: candidates.length ? maxBy(candidates, (c) => c.pts) : null,
    lowest: candidates.length ? maxBy(candidates, (c) => -c.pts) : null,
    biggestWin: maxBy(wins, (d) => d.margin),
    narrowestWin: maxBy(wins, (d) => -d.margin),
    unluckiest: maxBy(wins, (d) => d.losePts),
    luckiest: maxBy(wins, (d) => -d.winPts),
    draws: decided.filter((d) => d.margin === 0).length,
    benchMax: maxBy(benchGws, (b) => b.pts),
    longestWinRun: maxBy(seasonStats, (s) => s.streak.bestWin),
  };
}
