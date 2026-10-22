// The tables: the official one, form, luck (against the league average), xG, points,
// the Premier League rebuilt from its fixtures, and each manager's club "twin".

import type {
  ClubRow,
  FormRow,
  LuckRow,
  Match,
  MatchResult,
  OverallRow,
  PlTwin,
  PointsRow,
  SeasonStat,
  Tally,
  XgRow,
} from '../shared/data.ts';
import type { Fixture } from '../shared/fpl-api.ts';
import { FORM_LENGTH } from './config.ts';
import type { lineupOf } from './lineups.ts';
import { winDrawWin } from './odds.ts';
import type { Season } from './season.ts';
import { groupBy, maxBy, round, sum } from './util.ts';

type LineupOf = ReturnType<typeof lineupOf>;
type Scoring = Season['scoring'];
export type Results = Record<number, MatchResult[]>;

export function buildResults(managerIds: number[], matches: Match[]): Results {
  const results: Results = Object.fromEntries(managerIds.map((id) => [id, []]));
  for (const m of matches.filter((x) => x.finished)) {
    results[m.home].push(matchResult(m.gw, m.away, m.homePts as number, m.awayPts as number));
    results[m.away].push(matchResult(m.gw, m.home, m.awayPts as number, m.homePts as number));
  }
  return results;
}

export function buildTables(
  season: Season,
  managerIds: number[],
  entryByLeagueEntry: Map<number, number>,
  matches: Match[],
  results: Results,
  lineup: LineupOf,
) {
  const { details, finishedGws, scoring } = season;
  const nextMatch = (id: number) => matches.find((m) => !m.finished && (m.home === id || m.away === id));
  const formAndNext = (id: number) => {
    const next = nextMatch(id);
    return {
      form: results[id].slice(-FORM_LENGTH),
      next: next && { gw: next.gw, opp: next.home === id ? next.away : next.home, live: next.started },
    };
  };

  const overall: OverallRow[] = details.standings
    .map((s) => {
      const id = entryByLeagueEntry.get(s.league_entry) as number;
      return {
        id,
        rank: s.rank,
        lastRank: s.last_rank,
        played: s.matches_won + s.matches_drawn + s.matches_lost,
        won: s.matches_won,
        drawn: s.matches_drawn,
        lost: s.matches_lost,
        pf: s.points_for,
        pa: s.points_against,
        pts: s.total,
        ...formAndNext(id),
      };
    })
    .filter((row) => row.id)
    .sort((a, b) => a.rank - b.rank);

  const formGws = new Set(finishedGws.slice(-FORM_LENGTH));
  const form: FormRow[] = rankRows(
    managerIds.map((id) => {
      const recent = results[id].filter((r) => formGws.has(r.gw));
      return { id, ...tally(recent, scoring), ...formAndNext(id) };
    }),
  );

  const scoresByGw = Object.fromEntries(
    finishedGws.map((gw) => [
      gw,
      managerIds.flatMap((id) => {
        const pts = lineup(id, gw)?.pts;
        return pts != null ? [{ id, pts }] : [];
      }),
    ]),
  );
  // Luck: every week played against the league average, where scoring above it is a
  // win. (Beating the league average is the same as beating everyone else's average.)
  // The gap to the real table points is what the fixture list gave or took.
  const luck: LuckRow[] = managerIds
    .map((id) => {
      const row = { id, played: 0, won: 0, drawn: 0, lost: 0, above: 0 };
      for (const scores of Object.values(scoresByGw)) {
        const mine = scores.find((sc) => sc.id === id);
        if (!mine) continue;
        const average = sum(scores.map((sc) => sc.pts)) / scores.length;
        row.played++;
        row.above += mine.pts - average;
        if (mine.pts > average) row.won++;
        else if (mine.pts === average) row.drawn++;
        else row.lost++;
      }
      const official = overall.find((r) => r.id === id);
      const avgPts = scoring.h2h_win * row.won + scoring.h2h_draw * row.drawn + scoring.h2h_lose * row.lost;
      const pts = official?.pts ?? 0;
      return { ...row, above: round(row.above, 1), avgPts, pts, luck: pts - avgPts, tableRank: official?.rank };
    })
    .sort((a, b) => b.avgPts - a.avgPts || b.above - a.above)
    .map((row, i) => ({ ...row, rank: i + 1 }));

  // The xG table, after FotMob's: expected points for and against, and the
  // table points those would have earned. Each match is decided by a normal model
  // around both sides' expected scores, with the spread of actual-minus-expected.
  const played = matches.filter((m) => m.finished && lineup(m.home, m.gw) && lineup(m.away, m.gw));
  const xpfOf = (id: number, gw: number) => (lineup(id, gw) as NonNullable<ReturnType<LineupOf>>).xpf;
  const xgResiduals = played.flatMap((m) => [(m.homePts as number) - xpfOf(m.home, m.gw), (m.awayPts as number) - xpfOf(m.away, m.gw)]);
  const xgSpread = Math.max(4, Math.sqrt(sum(xgResiduals.map((r) => r * r)) / Math.max(1, xgResiduals.length)));
  const xg: XgRow[] = managerIds
    .map((id) => {
      const row = { id, played: 0, pf: 0, pa: 0, xpf: 0, xpa: 0, xPts: 0 };
      for (const m of played.filter((x) => x.home === id || x.away === id)) {
        const home = m.home === id;
        const mine = xpfOf(id, m.gw);
        const theirs = xpfOf(home ? m.away : m.home, m.gw);
        const p = winDrawWin(mine, theirs, xgSpread);
        row.played++;
        row.pf += (home ? m.homePts : m.awayPts) as number;
        row.pa += (home ? m.awayPts : m.homePts) as number;
        row.xpf += mine;
        row.xpa += theirs;
        row.xPts += scoring.h2h_win * p.home + scoring.h2h_draw * p.draw;
      }
      const official = overall.find((r) => r.id === id);
      return {
        ...row,
        xpf: round(row.xpf, 1),
        xpa: round(row.xpa, 1),
        xPts: round(row.xPts, 1),
        pts: official?.pts ?? 0,
        tableRank: official?.rank,
      };
    })
    .sort((a, b) => b.xPts - a.xPts || b.xpf - a.xpf)
    .map((row, i) => ({ ...row, rank: i + 1 }));

  return { overall, form, luck, xg, scoresByGw };
}

export function buildSeasonStats(season: Season, managerIds: number[], results: Results, lineup: LineupOf): SeasonStat[] {
  const { finishedGws, pointsIn } = season;
  return managerIds.map((id) => {
    const played = finishedGws.flatMap((gw) => {
      const l = lineup(id, gw);
      return l && l.pts != null ? [{ gw, ...l }] : [];
    });
    const scores = played.map((l) => l.pts);
    const high = maxBy(played, (l) => l.pts);
    const low = maxBy(played, (l) => -l.pts);
    const mvp = topContributor(id, finishedGws, lineup, pointsIn);
    return {
      id,
      total: sum(scores),
      avg: scores.length ? round(sum(scores) / scores.length, 1) : 0,
      high: high && { pts: high.pts, gw: high.gw },
      low: low && { pts: low.pts, gw: low.gw },
      bench: sum(played.map((l) => l.benchPts)),
      mvp,
      streak: streaks(results[id]),
    };
  });
}

export function buildPointsTable(seasonStats: SeasonStat[]): PointsRow[] {
  return seasonStats
    .map((s) => ({ id: s.id, total: s.total, avg: s.avg, high: s.high?.pts ?? 0, low: s.low?.pts ?? 0, bench: s.bench }))
    .sort((a, b) => b.total - a.total)
    .map((row, i) => ({ ...row, rank: i + 1 }));
}

// The Premier League itself, rebuilt from the same fixtures, so each manager can get
// the club sitting on the same number of points.
export function premierLeagueTable(fixtures: Fixture[], teams: { id: number }[]): ClubRow[] {
  const rows = new Map(teams.map((t) => [t.id, { club: t.id, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, pts: 0 }]));
  const add = (row: Omit<ClubRow, 'rank'>, gf: number, ga: number) => {
    row.played++;
    row.gf += gf;
    row.ga += ga;
    if (gf > ga) row.won++;
    else if (gf === ga) row.drawn++;
    else row.lost++;
    row.pts = 3 * row.won + row.drawn;
  };
  for (const f of fixtures) {
    if (!(f.finished || f.finished_provisional) || f.team_h_score == null || f.team_a_score == null) continue;
    add(rows.get(f.team_h)!, f.team_h_score, f.team_a_score);
    add(rows.get(f.team_a)!, f.team_a_score, f.team_h_score);
  }
  return [...rows.values()]
    .sort((a, b) => b.pts - a.pts || b.gf - b.ga - (a.gf - a.ga) || b.gf - a.gf)
    .map((row, i) => ({ ...row, rank: i + 1 }));
}

// Managers level on points share out the clubs level with them, in table order.
export function premierLeagueTwins(overall: OverallRow[], plTable: ClubRow[]): PlTwin[] {
  const twinOf = new Map<number, Omit<PlTwin, 'id' | 'wouldBe'>>();
  for (const group of Object.values(groupBy(overall, (row) => row.pts))) {
    const gap = Math.min(...plTable.map((c) => Math.abs(c.pts - group[0].pts)));
    const level = plTable.filter((c) => Math.abs(c.pts - group[0].pts) === gap);
    group.forEach((row, i) => {
      const twin = level[i % level.length];
      twinOf.set(row.id, { club: twin.club, also: level.filter((c) => c !== twin).map((c) => c.club), exact: gap === 0 });
    });
  }
  return overall.map((row) => ({ id: row.id, ...twinOf.get(row.id)!, wouldBe: 1 + plTable.filter((c) => c.pts > row.pts).length }));
}

export function matchResult(gw: number, opp: number, pf: number, pa: number): MatchResult {
  return { gw, opp, pf, pa, res: pf > pa ? 'W' : pf < pa ? 'L' : 'D' };
}

export function tally(results: MatchResult[], scoring: Scoring): Tally {
  const won = results.filter((r) => r.res === 'W').length;
  const drawn = results.filter((r) => r.res === 'D').length;
  const lost = results.filter((r) => r.res === 'L').length;
  return {
    played: results.length,
    won,
    drawn,
    lost,
    pf: sum(results.map((r) => r.pf)),
    pa: sum(results.map((r) => r.pa)),
    pts: scoring.h2h_win * won + scoring.h2h_draw * drawn + scoring.h2h_lose * lost,
  };
}

function rankRows<T extends { pts: number; pf: number }>(rows: T[]): (T & { rank: number })[] {
  return rows.sort((a, b) => b.pts - a.pts || b.pf - a.pf).map((row, i) => ({ ...row, rank: i + 1 }));
}

export function streaks(results: MatchResult[]): SeasonStat['streak'] {
  let bestWin = 0;
  let run = 0;
  for (const r of results) {
    run = r.res === 'W' ? run + 1 : 0;
    bestWin = Math.max(bestWin, run);
  }
  const last = results.at(-1)?.res ?? null;
  let current = 0;
  for (let i = results.length - 1; i >= 0 && results[i].res === last; i--) current++;
  return { bestWin, current: last ? `${last}${current}` : null };
}

function topContributor(entry: number, gws: number[], lineup: LineupOf, pointsIn: Season['pointsIn']) {
  const totals = new Map<number, number>();
  for (const gw of gws) for (const pid of lineup(entry, gw)?.xi ?? []) totals.set(pid, (totals.get(pid) ?? 0) + pointsIn(pid, gw));
  const best = maxBy([...totals], ([, pts]) => pts);
  return best && { player: best[0], pts: best[1] };
}
