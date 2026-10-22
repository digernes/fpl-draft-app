// Managers, their head-to-head matches, and every lineup they have put out: points,
// the double-gameweek adjustment, bench points and expected points.

import type { ById, LiveData, Lineup, Manager, Match } from '../shared/data.ts';
import { scoreLineup, slimLive, type SlimLive } from '../shared/live.ts';
import { DGW_PENALTY } from './config.ts';
import type { Season } from './season.ts';
import { round, sum } from './util.ts';

export function buildManagers(season: Season) {
  const entries = season.details.league_entries.filter((e) => e.entry_id);
  // Only first names leave this script, because the page is public. Managers who share
  // a first name get their surname initial.
  const firstNames = entries.map((e) => e.player_first_name.trim());
  const managers: Manager[] = entries.map((e, i) => {
    const name = firstNames[i];
    const shared = firstNames.filter((f) => f === name).length > 1;
    return {
      id: e.entry_id as number,
      first: shared ? `${name} ${e.player_last_name.trim().charAt(0)}.` : name,
      initials: e.short_name,
      team: e.entry_name,
      waiverPick: e.waiver_pick,
    };
  });
  const entryByLeagueEntry = new Map(entries.map((e) => [e.id, e.entry_id as number]));
  return { managers, managerIds: managers.map((m) => m.id), entryByLeagueEntry };
}

export function buildMatches(season: Season, entryByLeagueEntry: Map<number, number>): Match[] {
  return season.details.matches
    .map((m) => ({
      gw: m.event,
      home: entryByLeagueEntry.get(m.league_entry_1),
      away: entryByLeagueEntry.get(m.league_entry_2),
      homePts: m.started ? m.league_entry_1_points : null,
      awayPts: m.started ? m.league_entry_2_points : null,
      started: m.started,
      finished: m.finished,
    }))
    .filter((m): m is Match => Boolean(m.home && m.away))
    .sort((a, b) => a.gw - b.gw);
}

export type Lineups = ById<ById<Lineup>>;

export function buildLineups(season: Season, matches: Match[]) {
  const { picks, finishedGws, live, doubleClubs, clubOf, pointsIn, positionOf, formation } = season;
  const matchPoints = new Map<string, number | null>();
  for (const m of matches.filter((x) => x.started)) {
    matchPoints.set(`${m.home}:${m.gw}`, m.homePts);
    matchPoints.set(`${m.away}:${m.gw}`, m.awayPts);
  }

  const playerInfo = (id: number) => ({ pos: positionOf(id), club: clubOf(id) });
  const liveFeeds: Record<number, SlimLive> = {};
  const lineups: Lineups = {};
  let lineupMismatches = 0;
  for (const [entry, byGw] of Object.entries(picks)) {
    for (const [gwKey, res] of Object.entries(byGw)) {
      const gw = Number(gwKey);
      const order = [...res.picks].sort((a, b) => a.position - b.position).map((p) => p.element);
      const finished = finishedGws.includes(gw);
      let xi = order.slice(0, 11);
      let bench = order.slice(11);
      let subs = (res.subs ?? []).map((s) => s.element_in);
      let pts: number;
      if (finished) {
        // Finished weeks come back with the auto-subs already made.
        const xiPoints = sum(xi.map((id) => pointsIn(id, gw)));
        pts = matchPoints.get(`${entry}:${gw}`) ?? xiPoints;
        if (pts !== xiPoints) lineupMismatches++;
      } else {
        // Still being played: score it as the page does live (provisional bonus and
        // auto-subs) rather than wait for the draft site's own head-to-head numbers.
        ({ xi, bench, subs, pts } = scoreLineup(order, (liveFeeds[gw] ??= slimLive(live[gw])), playerInfo, formation));
      }
      const doubles = new Set(doubleClubs[gw]);
      const dgw = xi.filter((id) => doubles.has(clubOf(id) as number)).length;
      (lineups[entry] ??= {})[gw] = {
        pts,
        adj: pts - DGW_PENALTY * dgw,
        dgw,
        benchPts: sum(bench.map((id) => pointsIn(id, gw))),
        xi,
        bench,
        subs,
        ...(finished ? {} : { picks: order }), // the page re-scores live weeks from the picks
        xpf: 0, // set below
      };
    }
  }
  if (lineupMismatches) console.warn(`! ${lineupMismatches} lineups do not add up to their H2H score`);

  for (const byGw of Object.values(lineups)) {
    for (const [gw, l] of Object.entries(byGw)) l.xpf = round(sum(l.xi.map((pid) => expectedPointsIn(season, pid, Number(gw)))), 1);
  }
  return lineups;
}

// The gameweek being played, as the page needs it to show who is still to play and
// to price the matches in play. Nothing once it is over.
export function buildLiveData(season: Season, lineups: Lineups, expectedNow: (pid: number) => number): LiveData | undefined {
  const { currentGw: gw, finishedGws, live } = season;
  if (!gw || finishedGws.includes(gw) || !live[gw]) return undefined;
  const ids = new Set(Object.values(lineups).flatMap((byGw) => byGw[gw]?.picks ?? []));
  const ep = Object.fromEntries([...ids].sort((a, b) => a - b).map((pid) => [pid, round(expectedNow(pid), 1)]));
  return { gw, ...slimLive(live[gw]), ep };
}

/** A manager's lineup in a gameweek, if they had one. */
export const lineupOf =
  (lineups: Lineups) =>
  (entry: number, gw: number): Lineup | undefined =>
    lineups[entry]?.[gw];

// A match still being played shows the live score worked out above.
export function patchLiveScores(matches: Match[], lineup: ReturnType<typeof lineupOf>) {
  for (const m of matches.filter((x) => x.started && !x.finished)) {
    m.homePts = lineup(m.home, m.gw)?.pts ?? m.homePts;
    m.awayPts = lineup(m.away, m.gw)?.pts ?? m.awayPts;
  }
}

// Expected ("underlying") points, in the spirit of FotMob's xG: the returns that
// swing on finishing (goals, assists, clean sheets, goals conceded) are swapped
// for what the player's xG, xA and xGC were worth. Minutes, bonus, saves, cards
// and defensive contributions stay as scored.
function expectedPointsIn(season: Season, pid: number, gw: number): number {
  const rules = season.boot.settings.scoring;
  const rule = (key: string) => {
    const value = rules[key];
    return typeof value === 'number' ? value : 0;
  };
  const s = season.live[gw]?.elements[pid]?.stats;
  if (!s) return 0;
  if (s.expected_goals == null) return s.total_points;
  const pos = season.positionOf(pid);
  const goal = rule(`goals_scored_${pos}`);
  const cleanSheet = rule(`clean_sheets_${pos}`);
  const conceded = rule(`goals_conceded_${pos}`); // per `concede_limit` goals
  const fixtures = season.doubleClubs[gw]?.includes(season.clubOf(pid) as number) ? 2 : 1;
  const fullGames = Math.min(fixtures, Math.floor(s.minutes / rules.long_play_limit));
  const xConceded = Number(s.expected_goals_conceded);
  const actual =
    goal * s.goals_scored +
    rules.assists * s.assists +
    cleanSheet * s.clean_sheets +
    conceded * Math.floor(s.goals_conceded / rules.concede_limit);
  const expected =
    goal * Number(s.expected_goals) +
    rules.assists * Number(s.expected_assists) +
    cleanSheet * fullGames * Math.exp(-xConceded / fixtures) + // chance of a clean sheet, per full game
    (conceded * xConceded) / rules.concede_limit;
  return s.total_points - actual + expected;
}
