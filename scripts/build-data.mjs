#!/usr/bin/env node
// Builds data.json for the FotMob Draft League page.
//
// Everything comes from the public FPL Draft API (no login needed), plus the main
// FPL game's bootstrap for next-gameweek expected points. Node 18+, no dependencies.
//
//   node scripts/build-data.mjs                      league 23793 -> ./data.json
//   node scripts/build-data.mjs --league 12345 --out data.json
//   node scripts/build-data.mjs --cache .cache        reuse raw API responses (local dev)
//   node scripts/build-data.mjs --archive             freeze the season into seasons/ now
//
// A finished season is frozen into seasons/<2026-27>.json automatically, and
// seasons/index.json lists every season the page can show.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const LEAGUE_ID = Number(args.league ?? process.env.LEAGUE_ID ?? 23793);
const OUT_FILE = args.out ?? 'data.json';
const CACHE_DIR = args.cache ?? null;
const SEASONS_DIR = path.join(path.dirname(OUT_FILE), 'seasons');
// Bump when data.json changes shape, so the page can tell which archives it can read.
const SCHEMA = 1;

const DRAFT_API = 'https://draft.premierleague.com/api';
const FPL_API = 'https://fantasy.premierleague.com/api';
const USER_AGENT = 'Mozilla/5.0 (compatible; fotmob-draft-page)';

// Top-gameweek ranking only: points knocked off per scoring-XI player whose club plays twice.
const DGW_PENALTY = 4;
const TOP_GAMEWEEKS = 10;
const FORM_LENGTH = 5;
// Odds: bookmaker overround and how many gameweeks ahead get prices. A manager's
// expected score is the league average plus a share of how far their form, and (next
// gameweek only) their best projected XI, sit from the league's. FPL's own expected
// points spread far wider than real scores do, hence the small projection share.
const ODDS_OVERROUND = 1.05;
const ODDS_GAMEWEEKS = 3;
const FORM_WEIGHT = 0.6;
const PROJECTION_WEIGHT = 0.3;
const MIN_SCORE_SPREAD = 13;
// Season simulation: runs of the remaining fixtures, and how far a manager's true
// level may sit from their form (points a week), drawn once per run. Seeded, so the
// same data always gives the same percentages.
const SIM_RUNS = 10000;
const SIM_SKILL_SPREAD = 3;
const SIM_SEED = 20262027;

const POSITIONS = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };
// FotMob team ids keyed by the Premier League's club code (stable across seasons).
// Clubs missing here fall back to the Premier League's own badge.
const FOTMOB_TEAM_IDS = {
  1: 10260, 2: 8463, 3: 9825, 4: 10261, 6: 8586, 7: 10252, 8: 8455, 9: 8669, 11: 8668, 14: 8650,
  17: 10203, 31: 9826, 36: 10204, 40: 9902, 43: 8456, 54: 9879, 56: 8472, 88: 8667, 91: 8678, 94: 9937,
};
// The usual UK fractional ladder. Prices are rounded down onto it, so decimal and
// fractional always show the same price.
const FRACTIONS = [
  [1, 100], [1, 50], [1, 33], [1, 25], [1, 20], [1, 16], [1, 14], [1, 12], [1, 10], [1, 9], [1, 8],
  [2, 15], [1, 7], [1, 6], [2, 11], [1, 5], [2, 9], [1, 4], [2, 7], [3, 10], [1, 3], [4, 11], [2, 5],
  [4, 9], [1, 2], [8, 15], [4, 7], [8, 13], [4, 6], [8, 11], [4, 5], [5, 6], [10, 11], [1, 1],
  [21, 20], [11, 10], [6, 5], [5, 4], [11, 8], [6, 4], [13, 8], [7, 4], [15, 8], [2, 1], [9, 4],
  [5, 2], [11, 4], [3, 1], [10, 3], [7, 2], [4, 1], [9, 2], [5, 1], [11, 2], [6, 1], [13, 2], [7, 1],
  [15, 2], [8, 1], [17, 2], [9, 1], [10, 1], [11, 1], [12, 1], [14, 1], [16, 1], [18, 1], [20, 1],
  [22, 1], [25, 1], [28, 1], [33, 1], [40, 1], [50, 1], [66, 1], [80, 1], [100, 1],
];

await main();

async function main() {
  if (CACHE_DIR) await mkdir(CACHE_DIR, { recursive: true });

  const [details, boot, game, txRes, tradeRes, choiceRes, statusRes, fplBoot] = await Promise.all([
    getJSON(`${DRAFT_API}/league/${LEAGUE_ID}/details`),
    getJSON(`${DRAFT_API}/bootstrap-static`),
    getJSON(`${DRAFT_API}/game`),
    getJSON(`${DRAFT_API}/draft/league/${LEAGUE_ID}/transactions`),
    getJSON(`${DRAFT_API}/draft/league/${LEAGUE_ID}/trades`),
    getJSON(`${DRAFT_API}/draft/${LEAGUE_ID}/choices`),
    getJSON(`${DRAFT_API}/league/${LEAGUE_ID}/element-status`),
    getJSON(`${FPL_API}/bootstrap-static/`, { optional: true }),
  ]);
  const { league } = details;
  const transactions = txRes.transactions;
  const trades = tradeRes.trades;
  const choices = choiceRes.choices;
  const ownerNow = new Map(statusRes.element_status.filter((s) => s.owner).map((s) => [s.element, s.owner]));

  const events = boot.events.data;
  const currentGw = Math.min(game.current_event ?? 0, league.stop_event);
  const gws = range(league.start_event, currentGw);
  const finishedGws = gws.filter((gw) => events.find((e) => e.id === gw)?.finished);
  const lastFinishedGw = finishedGws.at(-1) ?? 0;
  const nextEvent = events.find((e) => e.id === game.next_event);

  // --- Raw per-gameweek data -------------------------------------------------

  const entries = details.league_entries.filter((e) => e.entry_id);
  const live = {};
  await mapPool(gws, 4, async (gw) => {
    live[gw] = await getJSON(`${DRAFT_API}/event/${gw}/live`);
  });
  const picks = {};
  await mapPool(entries.flatMap((e) => gws.map((gw) => [e.entry_id, gw])), 6, async ([entry, gw]) => {
    const res = await getJSON(`${DRAFT_API}/entry/${entry}/event/${gw}`, { optional: true });
    if (res) (picks[entry] ??= {})[gw] = res;
  });

  const elements = new Map(boot.elements.map((el) => [el.id, el]));
  const clubOf = (id) => elements.get(id)?.team;
  const pointsIn = (id, gw) => live[gw]?.elements[id]?.stats.total_points ?? 0;

  const doubleClubs = {};
  for (const gw of gws) doubleClubs[gw] = clubsPlayingTwice(live[gw].fixtures);
  for (const [gw, fixtures] of Object.entries(boot.fixtures ?? {})) doubleClubs[gw] ??= clubsPlayingTwice(fixtures);

  // --- Managers, matches and lineups -----------------------------------------

  // Only first names leave this script, because the page is public. Managers who share
  // a first name get their surname initial.
  const firstNames = entries.map((e) => e.player_first_name.trim());
  const managers = entries.map((e, i) => {
    const name = firstNames[i];
    const shared = firstNames.filter((f) => f === name).length > 1;
    return {
      id: e.entry_id,
      first: shared ? `${name} ${e.player_last_name.trim().charAt(0)}.` : name,
      initials: e.short_name,
      team: e.entry_name,
      waiverPick: e.waiver_pick,
    };
  });
  const managerIds = managers.map((m) => m.id);
  const entryByLeagueEntry = new Map(entries.map((e) => [e.id, e.entry_id]));

  const matches = details.matches
    .map((m) => ({
      gw: m.event,
      home: entryByLeagueEntry.get(m.league_entry_1),
      away: entryByLeagueEntry.get(m.league_entry_2),
      homePts: m.started ? m.league_entry_1_points : null,
      awayPts: m.started ? m.league_entry_2_points : null,
      started: m.started,
      finished: m.finished,
    }))
    .filter((m) => m.home && m.away)
    .sort((a, b) => a.gw - b.gw);

  const matchPoints = new Map();
  for (const m of matches.filter((x) => x.started)) {
    matchPoints.set(`${m.home}:${m.gw}`, m.homePts);
    matchPoints.set(`${m.away}:${m.gw}`, m.awayPts);
  }

  const lineups = {};
  let lineupMismatches = 0;
  for (const [entry, byGw] of Object.entries(picks)) {
    for (const [gw, res] of Object.entries(byGw)) {
      const order = [...res.picks].sort((a, b) => a.position - b.position).map((p) => p.element);
      let xi = order.slice(0, 11);
      let bench = order.slice(11);
      for (const sub of res.subs ?? []) {
        xi = xi.map((id) => (id === sub.element_out ? sub.element_in : id));
        bench = bench.map((id) => (id === sub.element_in ? sub.element_out : id));
      }
      const doubles = new Set(doubleClubs[gw]);
      const dgw = xi.filter((id) => doubles.has(clubOf(id))).length;
      const xiPoints = sum(xi.map((id) => pointsIn(id, gw)));
      const pts = matchPoints.get(`${entry}:${gw}`) ?? xiPoints;
      if (pts !== xiPoints && finishedGws.includes(Number(gw))) lineupMismatches++;
      (lineups[entry] ??= {})[gw] = {
        pts,
        adj: pts - DGW_PENALTY * dgw,
        dgw,
        benchPts: sum(bench.map((id) => pointsIn(id, gw))),
        xi,
        bench,
        subs: (res.subs ?? []).map((s) => s.element_in),
      };
    }
  }
  if (lineupMismatches) console.warn(`! ${lineupMismatches} lineups do not add up to their H2H score`);

  const lineup = (entry, gw) => lineups[entry]?.[gw];
  const squadAt = (entry, gw) => {
    const l = lineup(entry, gw);
    return l ? new Set([...l.xi, ...l.bench]) : null;
  };

  // Expected ("underlying") points, in the spirit of FotMob's xG: the returns that
  // swing on finishing (goals, assists, clean sheets, goals conceded) are swapped
  // for what the player's xG, xA and xGC were worth. Minutes, bonus, saves, cards
  // and defensive contributions stay as scored.
  const rules = boot.settings.scoring;
  const expectedPointsIn = (pid, gw) => {
    const s = live[gw]?.elements[pid]?.stats;
    if (!s) return 0;
    if (s.expected_goals == null) return s.total_points;
    const pos = POSITIONS[elements.get(pid)?.element_type];
    const goal = rules[`goals_scored_${pos}`] ?? 0;
    const cleanSheet = rules[`clean_sheets_${pos}`] ?? 0;
    const conceded = rules[`goals_conceded_${pos}`] ?? 0; // per `concede_limit` goals
    const fixtures = doubleClubs[gw]?.includes(clubOf(pid)) ? 2 : 1;
    const fullGames = Math.min(fixtures, Math.floor(s.minutes / rules.long_play_limit));
    const xConceded = Number(s.expected_goals_conceded);
    const actual =
      goal * s.goals_scored + rules.assists * s.assists + cleanSheet * s.clean_sheets + conceded * Math.floor(s.goals_conceded / rules.concede_limit);
    const expected =
      goal * Number(s.expected_goals) +
      rules.assists * Number(s.expected_assists) +
      cleanSheet * fullGames * Math.exp(-xConceded / fixtures) + // chance of a clean sheet, per full game
      (conceded * xConceded) / rules.concede_limit;
    return s.total_points - actual + expected;
  };
  for (const byGw of Object.values(lineups)) {
    for (const [gw, l] of Object.entries(byGw)) l.xpf = round(sum(l.xi.map((pid) => expectedPointsIn(pid, gw))), 1);
  }

  // --- Tables ----------------------------------------------------------------

  const results = Object.fromEntries(managerIds.map((id) => [id, []]));
  for (const m of matches.filter((x) => x.finished)) {
    results[m.home].push(matchResult(m.gw, m.away, m.homePts, m.awayPts));
    results[m.away].push(matchResult(m.gw, m.home, m.awayPts, m.homePts));
  }
  const nextMatch = (id) => matches.find((m) => !m.finished && (m.home === id || m.away === id));
  const formAndNext = (id) => {
    const next = nextMatch(id);
    return {
      form: results[id].slice(-FORM_LENGTH),
      next: next && { gw: next.gw, opp: next.home === id ? next.away : next.home, live: next.started },
    };
  };

  const overall = details.standings
    .map((s) => {
      const id = entryByLeagueEntry.get(s.league_entry);
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

  const scoring = boot.settings.league;
  const formGws = new Set(finishedGws.slice(-FORM_LENGTH));
  const formTable = rankRows(
    managerIds.map((id) => {
      const recent = results[id].filter((r) => formGws.has(r.gw));
      return { id, ...tally(recent, scoring), ...formAndNext(id) };
    }),
  );

  const scoresByGw = Object.fromEntries(
    finishedGws.map((gw) => [gw, managerIds.map((id) => ({ id, pts: lineup(id, gw)?.pts })).filter((s) => s.pts != null)]),
  );
  // Luck: every week played against the league average, where scoring above it is a
  // win. (Beating the league average is the same as beating everyone else's average.)
  // The gap to the real table points is what the fixture list gave or took.
  const luckTable = managerIds
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
  const xgResiduals = played.flatMap((m) => [m.homePts - lineup(m.home, m.gw).xpf, m.awayPts - lineup(m.away, m.gw).xpf]);
  const xgSpread = Math.max(4, Math.sqrt(sum(xgResiduals.map((r) => r * r)) / Math.max(1, xgResiduals.length)));
  const xgTable = managerIds
    .map((id) => {
      const row = { id, played: 0, pf: 0, pa: 0, xpf: 0, xpa: 0, xPts: 0 };
      for (const m of played.filter((x) => x.home === id || x.away === id)) {
        const home = m.home === id;
        const mine = lineup(id, m.gw).xpf;
        const theirs = lineup(home ? m.away : m.home, m.gw).xpf;
        const p = winDrawWin(mine, theirs, xgSpread);
        row.played++;
        row.pf += home ? m.homePts : m.awayPts;
        row.pa += home ? m.awayPts : m.homePts;
        row.xpf += mine;
        row.xpa += theirs;
        row.xPts += scoring.h2h_win * p.home + scoring.h2h_draw * p.draw;
      }
      const official = overall.find((r) => r.id === id);
      return { ...row, xpf: round(row.xpf, 1), xpa: round(row.xpa, 1), xPts: round(row.xPts, 1), pts: official?.pts ?? 0, tableRank: official?.rank };
    })
    .sort((a, b) => b.xPts - a.xPts || b.xpf - a.xpf)
    .map((row, i) => ({ ...row, rank: i + 1 }));

  const seasonStats = managerIds.map((id) => {
    const played = finishedGws.map((gw) => ({ gw, ...lineup(id, gw) })).filter((l) => l.pts != null);
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
  const pointsTable = seasonStats
    .map((s) => ({ id: s.id, total: s.total, avg: s.avg, high: s.high?.pts ?? 0, low: s.low?.pts ?? 0, bench: s.bench }))
    .sort((a, b) => b.total - a.total)
    .map((row, i) => ({ ...row, rank: i + 1 }));

  // The Premier League itself, rebuilt from the same fixtures, so each manager can get
  // the club sitting on the same number of points.
  const plTable = premierLeagueTable(gws.flatMap((gw) => live[gw].fixtures), boot.teams);
  // Managers level on points share out the clubs level with them, in table order.
  const twinOf = new Map();
  for (const group of Object.values(groupBy(overall, (row) => row.pts))) {
    const gap = Math.min(...plTable.map((c) => Math.abs(c.pts - group[0].pts)));
    const level = plTable.filter((c) => Math.abs(c.pts - group[0].pts) === gap);
    group.forEach((row, i) => {
      const twin = level[i % level.length];
      twinOf.set(row.id, { club: twin.club, also: level.filter((c) => c !== twin).map((c) => c.club), exact: gap === 0 });
    });
  }
  const plTwins = overall.map((row) => ({ id: row.id, ...twinOf.get(row.id), wouldBe: 1 + plTable.filter((c) => c.pts > row.pts).length }));

  // --- Top gameweeks (DGW-adjusted, at least one per manager) ----------------
  // This is also the highest-gameweek prize: on a tie the earlier week wins, and two
  // managers on the same score in the same week share the place.

  const candidates = managerIds
    .flatMap((id) =>
      finishedGws
        .map((gw) => ({ id, gw, l: lineup(id, gw) }))
        .filter((c) => c.l)
        .map(({ id: mid, gw, l }) => ({ id: mid, gw, pts: l.pts, dgw: l.dgw, adj: l.adj })),
    )
    .sort((a, b) => b.adj - a.adj || a.gw - b.gw);
  candidates.forEach((c, i) => {
    const prev = candidates[i - 1];
    c.rank = prev && prev.adj === c.adj && prev.gw === c.gw ? prev.rank : i + 1;
  });
  const chosen = new Set(managerIds.map((id) => candidates.find((c) => c.id === id)).filter(Boolean));
  for (const c of candidates) {
    if (chosen.size >= TOP_GAMEWEEKS) break;
    chosen.add(c);
  }
  const topGameweeks = [...chosen]
    .sort((a, b) => a.rank - b.rank)
    .map((c) => {
      const m = matches.find((x) => x.gw === c.gw && (x.home === c.id || x.away === c.id));
      const opp = m && (m.home === c.id ? m.away : m.home);
      const oppPts = m && (m.home === c.id ? m.awayPts : m.homePts);
      const star = maxBy(lineup(c.id, c.gw).xi, (pid) => pointsIn(pid, c.gw));
      return {
        ...c,
        guaranteed: c.rank > TOP_GAMEWEEKS,
        opp,
        oppPts,
        star: star && { player: star, pts: pointsIn(star, c.gw) },
      };
    });
  const worstGameweeks = [...candidates].sort((a, b) => a.pts - b.pts || a.gw - b.gw).slice(0, 5);

  // --- Records ---------------------------------------------------------------

  const decided = matches
    .filter((m) => m.finished)
    .map((m) => {
      const homeWon = m.homePts >= m.awayPts;
      return {
        gw: m.gw,
        winner: homeWon ? m.home : m.away,
        loser: homeWon ? m.away : m.home,
        winPts: Math.max(m.homePts, m.awayPts),
        losePts: Math.min(m.homePts, m.awayPts),
        margin: Math.abs(m.homePts - m.awayPts),
      };
    });
  const wins = decided.filter((d) => d.margin > 0);
  const benchGws = managerIds.flatMap((id) => finishedGws.map((gw) => ({ id, gw, pts: lineup(id, gw)?.benchPts ?? 0 })));
  const records = {
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

  // --- Transfers -------------------------------------------------------------

  const pointsSince = (id, gw) => sum(finishedGws.filter((g) => g >= gw).map((g) => pointsIn(id, g)));
  const bankedSince = (entry, id, gw) =>
    sum(finishedGws.filter((g) => g >= gw && lineup(entry, g)?.xi.includes(id)).map((g) => pointsIn(id, g)));

  const moves = [];
  for (const t of transactions) {
    if (t.result !== 'a') continue;
    moves.push({ type: t.kind === 'w' ? 'waiver' : 'free', manager: t.entry, in: t.element_in, out: t.element_out, gw: t.event, at: t.added });
  }
  for (const tr of trades.filter((x) => x.state === 'p')) {
    const at = tr.response_time ?? tr.offer_time;
    for (const item of tr.tradeitem_set) {
      moves.push({ type: 'trade', manager: tr.offered_entry, partner: tr.received_entry, in: item.element_in, out: item.element_out, gw: tr.event, at });
      moves.push({ type: 'trade', manager: tr.received_entry, partner: tr.offered_entry, in: item.element_out, out: item.element_in, gw: tr.event, at });
    }
  }
  for (const mv of moves) {
    if (mv.gw > lastFinishedGw) continue; // nothing scored yet
    mv.inPts = pointsSince(mv.in, mv.gw);
    mv.outPts = pointsSince(mv.out, mv.gw);
    mv.net = mv.inPts - mv.outPts;
    mv.banked = bankedSince(mv.manager, mv.in, mv.gw);
  }
  moves.sort((a, b) => b.at.localeCompare(a.at));

  // Waiver result codes: "a" won, "di" the player in was already gone (claimed by a
  // higher priority, or by your own earlier claim), "do" the player out was already gone.
  const waiverClaims = transactions.filter((t) => t.kind === 'w');
  const wonBy = new Map(waiverClaims.filter((t) => t.result === 'a').map((t) => [`${t.event}:${t.element_in}`, t.entry]));
  const claims = waiverClaims.map((t) => {
    const winner = wonBy.get(`${t.event}:${t.element_in}`) ?? null;
    const outcome = t.result === 'a' ? 'won' : t.result === 'di' && winner && winner !== t.entry ? 'lost' : 'void';
    return { manager: t.entry, in: t.element_in, out: t.element_out, gw: t.event, priority: t.priority, outcome, winner };
  });

  const contested = Object.values(groupBy(claims, (c) => `${c.gw}:${c.in}`))
    .map((group) => ({
      gw: group[0].gw,
      player: group[0].in,
      claimants: [...new Set(group.map((c) => c.manager))],
      winner: group[0].winner,
      pts: group[0].gw <= lastFinishedGw ? pointsSince(group[0].in, group[0].gw) : null,
    }))
    .filter((g) => g.claimants.length > 1)
    .sort((a, b) => b.claimants.length - a.claimants.length || b.gw - a.gw)
    .slice(0, 8);

  const ownersOf = new Map();
  for (const id of managerIds) {
    for (const gw of gws) for (const pid of squadAt(id, gw) ?? []) (ownersOf.get(pid) ?? ownersOf.set(pid, new Set()).get(pid)).add(id);
  }
  for (const [pid, owner] of ownerNow) (ownersOf.get(pid) ?? ownersOf.set(pid, new Set()).get(pid)).add(owner);
  const hotPotatoes = [...ownersOf]
    .filter(([, owners]) => owners.size > 1)
    .map(([player, owners]) => ({ player, owners: [...owners], moves: moves.filter((mv) => mv.in === player && mv.type !== 'trade').length }))
    .sort((a, b) => b.owners.length - a.owners.length || b.moves - a.moves)
    .slice(0, 6);

  const dropCounts = countBy(moves.filter((mv) => mv.type !== 'trade'), (mv) => mv.out);
  const mostDropped = Object.entries(dropCounts)
    .map(([player, times]) => ({ player: Number(player), times }))
    .sort((a, b) => b.times - a.times || (elements.get(b.player)?.total_points ?? 0) - (elements.get(a.player)?.total_points ?? 0))
    .slice(0, 5);

  const scoredMoves = moves.filter((mv) => mv.net != null && mv.type !== 'trade');
  const bestPickups = [...scoredMoves].sort((a, b) => b.net - a.net || b.banked - a.banked).slice(0, 6);
  const regrets = [...scoredMoves].sort((a, b) => b.outPts - a.outPts || a.net - b.net).slice(0, 6);

  const byGw = range(league.start_event, Math.max(currentGw, game.next_event ?? 0, 1)).map((gw) => ({
    gw,
    waiver: moves.filter((mv) => mv.gw === gw && mv.type === 'waiver').length,
    free: moves.filter((mv) => mv.gw === gw && mv.type === 'free').length,
    trade: trades.filter((tr) => tr.state === 'p' && tr.event === gw).length,
  }));

  const transferSummary = managerIds.map((id) => {
    const mine = moves.filter((mv) => mv.manager === id);
    const myClaims = claims.filter((c) => c.manager === id);
    const scored = mine.filter((mv) => mv.net != null);
    return {
      id,
      moves: mine.length,
      waivers: mine.filter((mv) => mv.type === 'waiver').length,
      free: mine.filter((mv) => mv.type === 'free').length,
      trades: trades.filter((tr) => tr.state === 'p' && (tr.offered_entry === id || tr.received_entry === id)).length,
      claims: myClaims.length,
      lost: myClaims.filter((c) => c.outcome === 'lost').length,
      void: myClaims.filter((c) => c.outcome === 'void').length,
      net: sum(scored.map((mv) => mv.net)),
      banked: sum(scored.map((mv) => mv.banked)),
      best: maxBy(scored, (mv) => mv.net),
      worst: maxBy(scored, (mv) => -mv.net),
    };
  });

  const tradeLog = trades
    .map((tr) => ({
      gw: tr.event,
      offeredBy: tr.offered_entry,
      offeredTo: tr.received_entry,
      state: tr.state,
      at: tr.response_time ?? tr.offer_time,
      items: tr.tradeitem_set.map((it) => ({ gives: it.element_out, gets: it.element_in })),
    }))
    .sort((a, b) => b.at.localeCompare(a.at));

  // --- Draft and original squads ---------------------------------------------

  const draftPicks = choices
    .filter((c) => c.element)
    .sort((a, b) => a.index - b.index)
    .map((c) => ({ overall: c.index, round: c.round, pick: c.pick, manager: c.entry, player: c.element, auto: c.was_auto }));
  const originals = groupBy(draftPicks, (p) => p.manager);
  const xiPointsOf = (id, keep) => sum(gws.flatMap((gw) => (lineup(id, gw)?.xi ?? []).filter(keep).map((pid) => pointsIn(pid, gw))));
  const retention = managerIds.map((id) => {
    const original = new Set((originals[id] ?? []).map((p) => p.player));
    const current = [...ownerNow].filter(([, owner]) => owner === id).map(([pid]) => pid);
    const total = xiPointsOf(id, () => true);
    const fromOriginals = xiPointsOf(id, (pid) => original.has(pid));
    return {
      id,
      size: original.size,
      kept: [...original].filter((pid) => ownerNow.get(pid) === id),
      gone: [...original].filter((pid) => ownerNow.get(pid) !== id).map((pid) => ({ player: pid, owner: ownerNow.get(pid) ?? null })),
      newcomers: current.filter((pid) => !original.has(pid)),
      byGw: gws.map((gw) => [...(squadAt(id, gw) ?? [])].filter((pid) => original.has(pid)).length),
      originalShare: total ? round(fromOriginals / total, 3) : 0,
      originalXiPts: fromOriginals,
      draftHaul: sum([...original].map((pid) => elements.get(pid)?.total_points ?? 0)),
    };
  });

  // --- Odds ------------------------------------------------------------------

  const epByCode = new Map((fplBoot?.elements ?? []).map((el) => [el.code, Number(el.ep_next)]));
  const expected = (pid) => {
    const el = elements.get(pid);
    if (!el) return 0;
    const ep = epByCode.get(el.code);
    if (Number.isFinite(ep)) return ep;
    const chance = el.chance_of_playing_next_round ?? (el.status === 'a' ? 100 : 0);
    return (Number(el.form) || 0) * (chance / 100);
  };
  const projections = Object.fromEntries(
    managerIds.map((id) => {
      const squad = [...ownerNow].filter(([, owner]) => owner === id).map(([pid]) => pid);
      return [id, bestXi(squad, expected, (pid) => elements.get(pid)?.element_type, boot.settings.squad)];
    }),
  );

  const allScores = Object.values(scoresByGw).flat().map((s) => s.pts);
  const leagueMean = allScores.length ? sum(allScores) / allScores.length : 50;
  const ratings = Object.fromEntries(managerIds.map((id) => [id, rating(results[id], leagueMean)]));
  const residuals = managerIds.flatMap((id) => results[id].map((r) => r.pf - ratings[id]));
  const sigma = Math.max(MIN_SCORE_SPREAD, residuals.length > 4 ? Math.sqrt(sum(residuals.map((r) => r * r)) / residuals.length) : 0);
  const meanProjection = sum(managerIds.map((id) => projections[id].pts)) / managerIds.length;
  const hasProjections = epByCode.size > 0 && meanProjection > 0;

  const nextGw = game.next_event ?? currentGw + 1;
  const expectedScore = (id, gw) =>
    leagueMean +
    FORM_WEIGHT * (ratings[id] - leagueMean) +
    (gw === nextGw && hasProjections ? PROJECTION_WEIGHT * (projections[id].pts - meanProjection) : 0);
  const spreadFor = (gw) => sigma * (gw === nextGw ? 1 : 1.1);
  for (const m of matches) {
    if (m.started || m.gw < nextGw || m.gw >= nextGw + ODDS_GAMEWEEKS) continue;
    const p = winDrawWin(expectedScore(m.home, m.gw), expectedScore(m.away, m.gw), spreadFor(m.gw));
    m.odds = {
      p: [round(p.home, 3), round(p.draw, 3), round(p.away, 3)],
      prices: [price(p.home), price(p.draw), price(p.away)],
      expected: [round(expectedScore(m.home, m.gw), 1), round(expectedScore(m.away, m.gw), 1)],
    };
    if (m.gw === nextGw && hasProjections) m.odds.xi = [projections[m.home].ids, projections[m.away].ids];
  }

  // --- Season simulation ------------------------------------------------------
  // Every unfinished match is played SIM_RUNS times with the odds model: each score
  // drawn around the manager's expected score with this season's spread, plus a
  // per-run offset for how good they really are. Ties on points split on points
  // scored, as in the real table. A match still being played starts from scratch.
  const remaining = matches
    .filter((m) => !m.finished)
    .map((m) => ({ ...m, muHome: expectedScore(m.home, m.gw), muAway: expectedScore(m.away, m.gw), spread: spreadFor(m.gw) }));
  const finishCounts = Object.fromEntries(managerIds.map((id) => [id, new Array(managerIds.length).fill(0)]));
  const pointsTotal = Object.fromEntries(managerIds.map((id) => [id, 0]));
  const normal = gaussian(mulberry32(SIM_SEED));
  for (let run = 0; run < SIM_RUNS; run++) {
    const level = Object.fromEntries(managerIds.map((id) => [id, normal() * SIM_SKILL_SPREAD]));
    const table = new Map(overall.map((r) => [r.id, { id: r.id, pts: r.pts, pf: r.pf }]));
    for (const m of remaining) {
      const home = table.get(m.home);
      const away = table.get(m.away);
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
  const simulation = {
    runs: SIM_RUNS,
    gameweeksLeft: new Set(remaining.map((m) => m.gw)).size,
    // The numbers behind the model, for the formula shown on the page.
    model: {
      leagueAverage: round(leagueMean, 1),
      formWeight: FORM_WEIGHT,
      projectionWeight: hasProjections ? PROJECTION_WEIGHT : 0,
      levelSpread: SIM_SKILL_SPREAD,
      spread: round(sigma, 1),
      laterSpread: round(spreadFor(nextGw + 1), 1),
    },
    rows: managerIds
      .map((id) => ({ id, pts: round(pointsTotal[id] / SIM_RUNS, 1), positions: finishCounts[id].map((n) => round(n / SIM_RUNS, 4)) }))
      .sort((a, b) => b.pts - a.pts)
      .map((row, i) => ({ ...row, rank: i + 1 })),
  };

  // --- Players referenced anywhere -------------------------------------------

  const referenced = new Set([
    ...ownerNow.keys(),
    ...draftPicks.map((p) => p.player),
    ...transactions.flatMap((t) => [t.element_in, t.element_out]),
    ...trades.flatMap((tr) => tr.tradeitem_set.flatMap((it) => [it.element_in, it.element_out])),
    ...Object.values(lineups).flatMap((byGw) => Object.values(byGw).flatMap((l) => [...l.xi, ...l.bench])),
  ]);
  const players = {};
  for (const el of [...elements.values()].sort((a, b) => a.id - b.id)) {
    const pid = el.id;
    players[pid] = {
      name: el.web_name,
      full: `${el.first_name} ${el.second_name}`,
      pos: POSITIONS[el.element_type],
      club: el.team,
      code: el.code,
      total: el.total_points,
      ...(referenced.has(pid) ? { pts: gws.map((gw) => pointsIn(pid, gw)) } : {}),
      owner: ownerNow.get(pid) ?? null,
      status: el.status,
      ...(el.news ? { news: el.news } : {}),
      ep: round(expected(pid), 1),
    };
  }

  const clubs = Object.fromEntries(
    boot.teams.map((t) => [
      t.id,
      {
        name: t.name,
        short: t.short_name,
        logo: FOTMOB_TEAM_IDS[t.code]
          ? `https://images.fotmob.com/image_resources/logo/teamlogo/${FOTMOB_TEAM_IDS[t.code]}_small.png`
          : `https://resources.premierleague.com/premierleague/badges/50/t${t.code}.png`,
      },
    ]),
  );

  const firstDeadline = events[0]?.deadline_time ?? new Date().toISOString();
  const seasonStart = new Date(firstDeadline).getUTCFullYear();
  const data = {
    meta: {
      schema: SCHEMA,
      generatedAt: new Date().toISOString(),
      leagueId: LEAGUE_ID,
      name: league.name,
      season: `${seasonStart}/${String(seasonStart + 1).slice(-2)}`,
      tz: league.draft_tz_show || 'Europe/London',
      firstGw: league.start_event,
      lastGw: league.stop_event,
      currentGw,
      currentGwFinished: game.current_event_finished,
      lastFinishedGw,
      nextGw,
      nextDeadline: nextEvent?.deadline_time ?? null,
      nextWaivers: nextEvent?.waivers_time ?? null,
      nextTrades: nextEvent?.trades_time ?? null,
      scoring: { win: scoring.h2h_win, draw: scoring.h2h_draw, loss: scoring.h2h_lose },
      dgwPenalty: DGW_PENALTY,
      formLength: FORM_LENGTH,
      oddsOverround: ODDS_OVERROUND,
      hasProjections,
    },
    managers,
    clubs,
    gameweeks: events.map((e) => ({ id: e.id, deadline: e.deadline_time, finished: e.finished, doubles: doubleClubs[e.id] ?? [] })),
    matches,
    tables: { overall, form: formTable, xg: xgTable, luck: luckTable, points: pointsTable, premierLeague: plTable },
    simulation,
    plTwins,
    lineups,
    topGameweeks,
    worstGameweeks,
    seasonStats,
    records,
    transfers: {
      moves,
      claims,
      summary: transferSummary,
      contested,
      hotPotatoes,
      mostDropped,
      bestPickups,
      regrets,
      byGw,
      trades: tradeLog,
      waiverOrder: [...managers].sort((a, b) => a.waiverPick - b.waiverPick).map((m) => m.id),
    },
    draft: { picks: draftPicks, retention },
    players,
  };

  if (await writeIfChanged(OUT_FILE, data)) {
    console.log(
      `Wrote ${OUT_FILE}: ${managers.length} managers, GW${currentGw}${game.current_event_finished ? ' (finished)' : ' (live)'}, ` +
        `${moves.length} moves, ${Object.keys(players).length} players${hasProjections ? '' : ', no projections'}.`,
    );
  } else {
    console.log(`No changes for GW${currentGw}; ${OUT_FILE} left as is.`);
  }

  await mkdir(SEASONS_DIR, { recursive: true });
  const seasonOver = events.length > 0 && events.every((e) => e.finished);
  if (seasonOver || args.archive) {
    const archive = path.join(SEASONS_DIR, `${seasonSlug(data.meta.season)}.json`);
    if (await writeIfChanged(archive, data)) console.log(`Archived ${data.meta.season} to ${archive}.`);
  }
  await writeSeasonIndex(data.meta);
}

// The current season is always data.json; finished ones are frozen copies in seasons/.
async function writeSeasonIndex(current) {
  const files = (await readdir(SEASONS_DIR)).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).sort().reverse();
  const seasons = [{ season: current.season, name: current.name, file: path.basename(OUT_FILE), current: true }];
  for (const file of files) {
    const { meta } = JSON.parse(await readFile(path.join(SEASONS_DIR, file), 'utf8'));
    if (meta.season !== current.season) seasons.push({ season: meta.season, name: meta.name, file: `seasons/${file}`, schema: meta.schema ?? 0 });
  }
  await writeIfChanged(path.join(SEASONS_DIR, 'index.json'), { seasons });
}

// Rewrites the file only when something other than the timestamp changed, so the
// scheduled job only commits and deploys real changes.
async function writeIfChanged(file, data) {
  const comparable = (d) => JSON.stringify(d?.meta ? { ...d, meta: { ...d.meta, generatedAt: null } } : d);
  const previous = await readFile(file, 'utf8').then(JSON.parse, () => null);
  if (previous && comparable(previous) === comparable(data)) return false;
  await writeFile(file, JSON.stringify(data));
  return true;
}

function seasonSlug(season) {
  return season.replace('/', '-');
}

// --- Model helpers -----------------------------------------------------------

function matchResult(gw, opp, pf, pa) {
  return { gw, opp, pf, pa, res: pf > pa ? 'W' : pf < pa ? 'L' : 'D' };
}

function tally(results, scoring) {
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

function rankRows(rows) {
  return rows
    .sort((a, b) => b.pts - a.pts || b.pf - a.pf)
    .map((row, i) => ({ ...row, rank: i + 1 }));
}

function streaks(results) {
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

function topContributor(entry, gws, lineup, pointsIn) {
  const totals = new Map();
  for (const gw of gws) for (const pid of lineup(entry, gw)?.xi ?? []) totals.set(pid, (totals.get(pid) ?? 0) + pointsIn(pid, gw));
  const best = maxBy([...totals], ([, pts]) => pts);
  return best && { player: best[0], pts: best[1] };
}

function premierLeagueTable(fixtures, teams) {
  const rows = new Map(teams.map((t) => [t.id, { club: t.id, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, pts: 0 }]));
  const add = (row, gf, ga) => {
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
    add(rows.get(f.team_h), f.team_h_score, f.team_a_score);
    add(rows.get(f.team_a), f.team_a_score, f.team_h_score);
  }
  return [...rows.values()]
    .sort((a, b) => b.pts - a.pts || b.gf - b.ga - (a.gf - a.ga) || b.gf - a.gf)
    .map((row, i) => ({ ...row, rank: i + 1 }));
}

function clubsPlayingTwice(fixtures) {
  const counts = countBy(fixtures.flatMap((f) => [f.team_h, f.team_a]), (club) => club);
  return Object.keys(counts)
    .filter((club) => counts[club] > 1)
    .map(Number);
}

// Best legal XI by expected points, honouring the league's formation limits.
function bestXi(squad, expected, positionOf, rules) {
  const byPos = { 1: [], 2: [], 3: [], 4: [] };
  for (const pid of squad) byPos[positionOf(pid)]?.push(pid);
  for (const list of Object.values(byPos)) list.sort((a, b) => expected(b) - expected(a));
  const limits = [1, 2, 3, 4].map((t) => {
    const key = POSITIONS[t];
    return [rules[`min_play_${key}`], Math.min(rules[`max_play_${key}`], byPos[t].length)];
  });
  let best = { ids: [], pts: 0 };
  const choose = (t, counts) => {
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
function rating(results, leagueMean, decay = 0.85, prior = 2) {
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
function winDrawWin(muHome, muAway, sigma) {
  const spread = Math.SQRT2 * sigma;
  const diff = muHome - muAway;
  const home = 1 - normalCdf((0.5 - diff) / spread);
  const away = normalCdf((-0.5 - diff) / spread);
  return { home, draw: 1 - home - away, away };
}

function normalCdf(x) {
  // Abramowitz & Stegun 7.1.26
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-z * z);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

// Small seeded PRNG (mulberry32) and a Box-Muller normal on top of it.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random) {
  return () => {
    let u = 0;
    while (u === 0) u = random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
  };
}

function price(probability) {
  const fair = 1 / (probability * ODDS_OVERROUND);
  let [num, den] = FRACTIONS[0];
  for (const [n, d] of FRACTIONS) if (1 + n / d <= fair + 1e-9) [num, den] = [n, d];
  return { dec: round(1 + num / den, 2), frac: `${num}/${den}` };
}

// --- Plumbing ----------------------------------------------------------------

async function getJSON(url, { optional = false } = {}) {
  const cacheFile = CACHE_DIR && path.join(CACHE_DIR, `${url.replace(/^https:\/\//, '').replace(/\W+/g, '_')}.json`);
  if (cacheFile) {
    const cached = await readFile(cacheFile, 'utf8').catch(() => null);
    if (cached) return JSON.parse(cached);
  }
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (res.ok) {
        const json = await res.json();
        if (cacheFile) await writeFile(cacheFile, JSON.stringify(json));
        return json;
      }
      lastError = new Error(`HTTP ${res.status} for ${url}`);
      if (res.status !== 429 && res.status < 500) break; // a 4xx will not get better
    } catch (err) {
      lastError = err;
    }
    if (attempt < 4) await new Promise((r) => setTimeout(r, attempt * 1500));
  }
  if (optional) {
    console.warn(`! Skipping ${url}: ${lastError.message}`);
    return null;
  }
  throw lastError;
}

async function mapPool(items, limit, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const value = argv[i + 1];
    out[argv[i].slice(2)] = value && !value.startsWith('--') ? argv[++i] : true;
  }
  return out;
}

function range(from, to) {
  return to < from ? [] : Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

function sum(values) {
  return values.reduce((a, b) => a + (b ?? 0), 0);
}

function round(value, digits) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function maxBy(items, score) {
  let best = null;
  let bestScore = -Infinity;
  for (const item of items) {
    const s = score(item);
    if (s > bestScore) [best, bestScore] = [item, s];
  }
  return best;
}

function groupBy(items, key) {
  const out = {};
  for (const item of items) (out[key(item)] ??= []).push(item);
  return out;
}

function countBy(items, key) {
  const out = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return out;
}
