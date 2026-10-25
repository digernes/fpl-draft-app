// A small draft league as the FPL APIs would send it, for the data build's tests: four
// managers of fifteen players each (and a place nobody took), four clubs, gameweeks 1 and
// 2 played (clubs 1 and 3 twice in the second), gameweek 3 half played, three more to
// come, and a waiver, a free signing and a trade along the way. Every number follows from
// the player's id, so the build's output can be worked out by hand where a test needs it.

import type { Fetched } from '../../src/build/api.ts';
import { buildLineups, buildManagers, buildMatches, lineupOf, patchLiveScores } from '../../src/build/lineups.ts';
import { oddsModel, priceMatches } from '../../src/build/odds.ts';
import { readSeason } from '../../src/build/season.ts';
import { simulate } from '../../src/build/simulation.ts';
import { buildResults, buildSeasonStats, buildTables } from '../../src/build/tables.ts';
import { buildTransfers } from '../../src/build/transfers.ts';
import type { Data } from '../../src/shared/data.ts';
import * as api from '../../src/shared/fpl-api.ts';

export const LEAGUE_ID = 4321;
/** Managers' entry ids, and their places in the league (league entries). */
export const MANAGERS = [101, 102, 103, 104];
export const LEAGUE_ENTRIES = [11, 12, 13, 14];

export const SCORING = {
  long_play_limit: 60,
  short_play: 1,
  long_play: 2,
  concede_limit: 2,
  goals_conceded_GKP: -1,
  goals_conceded_DEF: -1,
  goals_conceded_MID: 0,
  goals_conceded_FWD: 0,
  saves_limit: 3,
  saves: 1,
  goals_scored_GKP: 10,
  goals_scored_DEF: 6,
  goals_scored_MID: 5,
  goals_scored_FWD: 4,
  assists: 3,
  clean_sheets_GKP: 4,
  clean_sheets_DEF: 4,
  clean_sheets_MID: 1,
  clean_sheets_FWD: 0,
  defensive_contribution_limit_GKP: 0,
  defensive_contribution_limit_DEF: 10,
  defensive_contribution_limit_MID: 12,
  defensive_contribution_limit_FWD: 12,
  defensive_contribution_GKP: 0,
  defensive_contribution_DEF: 2,
  defensive_contribution_MID: 2,
  defensive_contribution_FWD: 2,
  penalties_saved: 5,
  penalties_missed: -2,
  yellow_cards: -1,
  red_cards: -3,
  own_goals: -2,
  bonus: 1,
};

/** Element types of a squad's fifteen, slot by slot: two goalkeepers, five defenders, five midfielders, three forwards. */
const SLOT_TYPES = [1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4];
/** The order they're picked in: an XI of 1-4-4-2, then the bench. */
const PICK_ORDER = [0, 2, 3, 4, 5, 7, 8, 9, 10, 12, 13, 1, 6, 11, 14];
/** Players 61-64 are free agents at the draft: a goalkeeper, a defender, a midfielder and a forward. */
const PLAYERS = 64;

export const typeOf = (pid: number) => (pid > 60 ? pid - 60 : SLOT_TYPES[(pid - 1) % 15]);
export const clubOf = (pid: number) => (pid % 4) + 1;
const POS = ['', 'GKP', 'DEF', 'MID', 'FWD'] as const;

const deadline = (gw: number) => new Date(Date.UTC(2026, 7, 15 + 7 * (gw - 1), 10)).toISOString();

// Fixture ids are the gameweek and a number: 101 is gameweek 1's first.
type State = 'done' | 'live' | 'future';
const FIXTURES: [id: number, gw: number, home: number, away: number, state: State][] = [
  [101, 1, 1, 2, 'done'],
  [102, 1, 3, 4, 'done'],
  [201, 2, 2, 3, 'done'],
  [202, 2, 4, 1, 'done'],
  [203, 2, 1, 3, 'done'],
  [301, 3, 1, 4, 'done'],
  [302, 3, 2, 3, 'live'],
  [401, 4, 3, 1, 'future'],
  [402, 4, 4, 2, 'future'],
  [501, 5, 1, 2, 'future'],
  [502, 5, 3, 4, 'future'],
  [601, 6, 2, 1, 'future'],
  [602, 6, 4, 3, 'future'],
];

/** Who has whom: the draft's squads, then the waiver (63 for 12) and the trade (59 for 14) in gameweek 2, and the free signing (64 for 45) in 3. */
export function squadOf(manager: number, gw: number): number[] {
  const m = MANAGERS.indexOf(manager);
  const swaps: Record<number, number> = {};
  if (gw >= 2 && manager === 101) Object.assign(swaps, { 12: 63, 14: 59 });
  if (gw >= 2 && manager === 104) Object.assign(swaps, { 59: 14 });
  if (gw >= 3 && manager === 103) Object.assign(swaps, { 45: 64 });
  return PICK_ORDER.map((slot) => m * 15 + slot + 1).map((pid) => swaps[pid] ?? pid);
}

interface Line {
  minutes: number;
  goals: number;
  assists: number;
  xg: number;
  xa: number;
  saves: number;
  defcon: number;
  yellow: number;
  bonus: number;
}

// A player's match, from his id and the fixture's: 9, 18, 27… never get on, 11, 22, 33…
// come on for the last half hour, and the rest play it all (or the hour gone in a match
// being played).
function lineIn(pid: number, fid: number, live: boolean): Line {
  const type = typeOf(pid);
  const minutes = pid % 9 === 0 ? 0 : pid % 11 === 0 ? 30 : live ? 60 : 90;
  if (!minutes) return { minutes, goals: 0, assists: 0, xg: 0, xa: 0, saves: 0, defcon: 0, yellow: 0, bonus: 0 };
  const goals = [0, 0, (pid + fid) % 13 === 0, (pid + fid) % 5 === 0, (pid + fid) % 3 === 0][type] ? 1 : 0;
  const assists = type > 1 && (pid * 7 + fid) % 6 === 0 ? 1 : 0;
  const share = minutes / 90;
  return {
    minutes,
    goals,
    assists,
    xg: Math.round((goals ? 0.55 : [0, 0, 0.05, 0.15, 0.3][type]) * share * 100) / 100,
    xa: type > 1 ? Math.round((assists ? 0.4 : 0.1) * share * 100) / 100 : 0,
    saves: type === 1 ? 3 : 0,
    defcon: type === 2 ? (pid % 2 ? 10 : 4) : type === 3 ? 6 : 0,
    yellow: (pid + fid) % 17 === 0 ? 1 : 0,
    bonus: !live && goals && (pid + fid) % 2 === 0 ? 2 : 0,
  };
}

const goalsFor = (club: number, fid: number, live: boolean) =>
  Array.from({ length: PLAYERS }, (_, i) => i + 1)
    .filter((pid) => clubOf(pid) === club)
    .reduce((t, pid) => t + lineIn(pid, fid, live).goals, 0);

type Stat = { stat: string; value: number; points: number };

function scoreLine(pid: number, line: Line, conceded: number): { stats: Stat[]; cleanSheet: number } {
  const pos = POS[typeOf(pid)];
  const rule = (key: string) => (SCORING as Record<string, number>)[key] ?? 0;
  const cleanSheet = line.minutes >= 60 && conceded === 0 ? 1 : 0;
  const defconLimit = rule(`defensive_contribution_limit_${pos}`);
  const stats: Stat[] = [
    { stat: 'minutes', value: line.minutes, points: line.minutes >= 60 ? 2 : line.minutes ? 1 : 0 },
    { stat: 'goals_scored', value: line.goals, points: line.goals * rule(`goals_scored_${pos}`) },
    { stat: 'assists', value: line.assists, points: line.assists * 3 },
    { stat: 'clean_sheets', value: cleanSheet, points: cleanSheet * rule(`clean_sheets_${pos}`) },
    {
      stat: 'goals_conceded',
      value: line.minutes ? conceded : 0,
      points: line.minutes ? Math.floor(conceded / 2) * rule(`goals_conceded_${pos}`) : 0,
    },
    { stat: 'saves', value: line.saves, points: Math.floor(line.saves / 3) },
    {
      stat: 'defensive_contribution',
      value: line.defcon,
      points: defconLimit && line.defcon >= defconLimit ? rule(`defensive_contribution_${pos}`) : 0,
    },
    { stat: 'yellow_cards', value: line.yellow, points: -line.yellow },
    { stat: 'bonus', value: line.bonus, points: line.bonus },
  ];
  // (+ 0 turns the -0 of no goals conceded or cards into the 0 JSON would give.)
  return { stats: stats.filter((s, i) => i === 0 || s.value).map((s) => ({ ...s, points: s.points + 0 })), cleanSheet };
}

function fixtureJson(id: number, gw: number, home: number, away: number, state: State) {
  const live = state === 'live';
  const played = state !== 'future';
  return {
    id,
    code: 900000 + id,
    event: gw,
    team_h: home,
    team_a: away,
    started: played,
    finished: state === 'done',
    finished_provisional: state === 'done',
    team_h_score: played ? goalsFor(home, id, live) : null,
    team_a_score: played ? goalsFor(away, id, live) : null,
    kickoff_time: new Date(Date.parse(deadline(gw)) + 4 * 36e5).toISOString(),
    minutes: state === 'done' ? 90 : live ? 60 : 0,
  };
}

function liveFeed(gw: number) {
  const fixtures = FIXTURES.filter(([, g]) => g === gw);
  const elements: Record<string, unknown> = {};
  for (let pid = 1; pid <= PLAYERS; pid++) {
    const club = clubOf(pid);
    const explain: [Stat[], number][] = [];
    const total = { points: 0, minutes: 0, goals: 0, assists: 0, cs: 0, conceded: 0, xg: 0, xa: 0, xgc: 0 };
    const more = { saves: 0, defcon: 0, yellow: 0, bonus: 0, starts: 0 };
    for (const [fid, , home, away, state] of fixtures.filter(([, , h, a]) => h === club || a === club)) {
      const live = state === 'live';
      const line = lineIn(pid, fid, live);
      const opp = home === club ? away : home;
      const conceded = goalsFor(opp, fid, live);
      const { stats, cleanSheet } = scoreLine(pid, line, conceded);
      explain.push([stats, fid]);
      total.points += stats.reduce((t, s) => t + s.points, 0);
      total.minutes += line.minutes;
      total.goals += line.goals;
      total.assists += line.assists;
      total.cs += cleanSheet;
      total.conceded += line.minutes ? conceded : 0;
      total.xg += line.xg;
      total.xa += line.xa;
      total.xgc += line.minutes ? 0.4 * conceded + 0.6 : 0;
      more.saves += line.saves;
      more.defcon += line.defcon;
      more.yellow += line.yellow;
      more.bonus += line.bonus;
      more.starts += line.minutes > 45 ? 1 : 0;
    }
    elements[pid] = {
      stats: {
        total_points: total.points,
        minutes: total.minutes,
        goals_scored: total.goals,
        assists: total.assists,
        clean_sheets: total.cs,
        goals_conceded: total.conceded,
        yellow_cards: more.yellow,
        bonus: more.bonus,
        starts: more.starts,
        saves: more.saves,
        defensive_contribution: more.defcon,
        expected_goals: total.xg.toFixed(2),
        expected_assists: total.xa.toFixed(2),
        expected_goals_conceded: total.xgc.toFixed(2),
        bps: total.points * 3,
      },
      explain,
    };
  }
  return {
    elements,
    fixtures: fixtures.map(([id, g, h, a, state]) => {
      const bps = (club: number) =>
        Object.entries(elements)
          .filter(([pid]) => clubOf(Number(pid)) === club)
          .map(([pid, el]) => ({ element: Number(pid), value: (el as { stats: { bps: number } }).stats.bps + (Number(pid) % 3) }));
      return { ...fixtureJson(id, g, h, a, state), stats: [{ s: 'bps', h: bps(h), a: bps(a) }] };
    }),
  };
}

const pointsOf = (feed: ReturnType<typeof liveFeed>, pid: number) =>
  (feed.elements[pid] as { stats: { total_points: number; minutes: number } }).stats;

// A finished gameweek's picks come back with FPL's auto-subs made: a starter who never got
// on swaps with the first bench player in his position who did.
function picksFor(manager: number, gw: number, feed: ReturnType<typeof liveFeed>, finished: boolean) {
  const order = squadOf(manager, gw);
  const subs: { element_in: number; element_out: number }[] = [];
  if (finished)
    for (let i = 0; i < 11; i++) {
      if (pointsOf(feed, order[i]).minutes) continue;
      const j = order.findIndex((pid, k) => k >= 11 && typeOf(pid) === typeOf(order[i]) && pointsOf(feed, pid).minutes);
      if (j < 0) continue;
      subs.push({ element_in: order[j], element_out: order[i] });
      [order[i], order[j]] = [order[j], order[i]];
    }
  return { picks: order.map((element, i) => ({ element, position: i + 1 })), subs };
}

// Head to head, league entries 11-14: each pairing twice over six gameweeks.
const SCHEDULE: [gw: number, home: number, away: number][] = [
  [1, 11, 12],
  [1, 13, 14],
  [2, 11, 13],
  [2, 12, 14],
  [3, 11, 14],
  [3, 12, 13],
  [4, 12, 11],
  [4, 14, 13],
  [5, 13, 11],
  [5, 14, 12],
  [6, 14, 11],
  [6, 13, 12],
];

export interface Options {
  /** Leave out the main game's bootstrap, as when it fails. */
  noFplBoot?: boolean;
  /** Before a ball has been kicked: gameweek 1 next, nothing played. */
  preseason?: boolean;
}

/** Every response the build asks for, by URL. */
export function responses({ noFplBoot = false, preseason = false }: Options = {}): Record<string, unknown> {
  const draft = 'https://draft.premierleague.com/api';
  const currentGw = preseason ? 0 : 3;
  const finished = (gw: number) => gw < currentGw;
  // Before the season, every fixture is to come, and the Draft bootstrap lists the first two gameweeks'.
  const fixtures = FIXTURES.map(([id, gw, h, a, state]): (typeof FIXTURES)[number] => [id, gw, h, a, preseason ? 'future' : state]);
  const listed = preseason ? [1, 2] : [4, 5];
  const feeds = Object.fromEntries([1, 2, 3].filter((gw) => gw <= currentGw).map((gw) => [gw, liveFeed(gw)]));
  const picks = Object.fromEntries(
    MANAGERS.flatMap((m) => Object.entries(feeds).map(([gw, feed]) => [`${m}:${gw}`, picksFor(m, Number(gw), feed, finished(Number(gw)))])),
  );
  const entryOf = (le: number) => MANAGERS[LEAGUE_ENTRIES.indexOf(le)];
  const xiPoints = (le: number, gw: number) =>
    (picks[`${entryOf(le)}:${gw}`] as ReturnType<typeof picksFor>).picks
      .slice(0, 11)
      .reduce((t, p) => t + pointsOf(feeds[gw], p.element).total_points, 0);
  const matches = SCHEDULE.map(([gw, h, a]) => ({
    event: gw,
    league_entry_1: h,
    league_entry_2: a,
    league_entry_1_points: gw <= currentGw ? xiPoints(h, gw) : 0,
    league_entry_2_points: gw <= currentGw ? xiPoints(a, gw) : 0,
    started: gw <= currentGw,
    finished: finished(gw),
  }));

  // The standings after the finished gameweeks, and after the one before for last_rank.
  const standingsAfter = (lastGw: number) => {
    const rows = LEAGUE_ENTRIES.map((le) => ({ le, won: 0, drawn: 0, lost: 0, pf: 0, pa: 0, total: 0 }));
    for (const m of matches.filter((x) => x.finished && x.event <= lastGw)) {
      const [h, a] = [rows.find((r) => r.le === m.league_entry_1)!, rows.find((r) => r.le === m.league_entry_2)!];
      const [hp, ap] = [m.league_entry_1_points, m.league_entry_2_points];
      h.pf += hp;
      h.pa += ap;
      a.pf += ap;
      a.pa += hp;
      if (hp > ap) [h.won, a.lost] = [h.won + 1, a.lost + 1];
      else if (hp < ap) [a.won, h.lost] = [a.won + 1, h.lost + 1];
      else [h.drawn, a.drawn] = [h.drawn + 1, a.drawn + 1];
    }
    for (const r of rows) r.total = 3 * r.won + r.drawn;
    return rows.sort((x, y) => y.total - x.total || y.pf - x.pf);
  };
  const lastRanks = standingsAfter(currentGw - 2).map((r) => r.le);
  const standings = standingsAfter(currentGw - 1).map((r, i) => ({
    league_entry: r.le,
    rank: i + 1,
    last_rank: currentGw > 2 ? lastRanks.indexOf(r.le) + 1 : null,
    matches_won: r.won,
    matches_drawn: r.drawn,
    matches_lost: r.lost,
    points_for: r.pf,
    points_against: r.pa,
    total: r.total,
  }));

  const ownerNow = new Map<number, number>();
  for (const m of MANAGERS) for (const pid of squadOf(m, 3)) ownerNow.set(pid, m);
  const seasonPoints = (pid: number) => Object.values(feeds).reduce((t, feed) => t + pointsOf(feed, pid).total_points, 0);

  const elements = Array.from({ length: PLAYERS }, (_, i) => {
    const id = i + 1;
    const injured = id === 20;
    const doubtful = id === 21;
    return {
      id,
      code: 1000 + id,
      team: clubOf(id),
      element_type: typeOf(id),
      web_name: `P${id}`,
      first_name: 'Player',
      second_name: `Number ${id}`,
      total_points: seasonPoints(id),
      status: injured ? 'i' : doubtful ? 'd' : 'a',
      added: id === 61 ? '2026-08-25T09:00:00Z' : '2026-07-01T09:00:00Z',
      news: injured ? 'Knee injury - Unknown return date' : doubtful ? 'Knock - 75% chance of playing' : '',
      form: (id % 7) + 0.5,
      chance_of_playing_next_round: injured ? 0 : doubtful ? 75 : null,
      chance_of_playing_this_round: injured ? 0 : doubtful ? 75 : null,
    };
  });

  const choices = Array.from({ length: 60 }, (_, i) => {
    const round = Math.floor(i / 4) + 1;
    const pick = (i % 4) + 1;
    const m = round % 2 ? pick - 1 : 4 - pick; // a snake draft
    return {
      element: m * 15 + round,
      entry: MANAGERS[m],
      index: i + 1,
      round,
      pick,
      was_auto: i === 59,
      choice_time: new Date(Date.UTC(2026, 7, 10, 18, i)).toISOString(),
    };
  });

  const out: Record<string, unknown> = {
    [`${draft}/league/${LEAGUE_ID}/details`]: {
      league: { name: 'Test League', start_event: 1, stop_event: 6, draft_tz_show: 'Europe/Oslo' },
      league_entries: [
        ...LEAGUE_ENTRIES.map((id, i) => ({
          id,
          entry_id: MANAGERS[i],
          entry_name: `Team ${i + 1}`,
          short_name: `T${i + 1}`,
          player_first_name: ['Ola', 'Kari', 'Ola', 'Per'][i],
          player_last_name: ['Nordmann', 'Hansen', 'Holm', 'Berg'][i],
          waiver_pick: [3, 1, 4, 2][i],
        })),
        { id: 15, entry_id: null, entry_name: '', short_name: '', player_first_name: '', player_last_name: '', waiver_pick: 5 },
      ],
      matches,
      standings,
    },
    [`${draft}/bootstrap-static`]: {
      events: {
        data: [1, 2, 3, 4, 5, 6].map((id) => ({
          id,
          finished: finished(id),
          deadline_time: deadline(id),
          waivers_time: new Date(Date.parse(deadline(id)) - 36 * 36e5).toISOString(),
          trades_time: new Date(Date.parse(deadline(id)) - 24 * 36e5).toISOString(),
        })),
      },
      elements,
      teams: [
        { id: 1, code: 3, name: 'Arsenal', short_name: 'ARS' },
        { id: 2, code: 14, name: 'Liverpool', short_name: 'LIV' },
        { id: 3, code: 43, name: 'Man City', short_name: 'MCI' },
        { id: 4, code: 999, name: 'Nowhere Town', short_name: 'NWT' },
      ],
      // The Draft bootstrap lists the next few gameweeks' fixtures.
      fixtures: Object.fromEntries(
        listed.map((gw) => [gw, fixtures.filter(([, g]) => g === gw).map(([id, g, h, a, s]) => fixtureJson(id, g, h, a, s))]),
      ),
      settings: {
        league: { h2h_win: 3, h2h_draw: 1, h2h_lose: 0 },
        scoring: SCORING,
        squad: {
          play: 11,
          min_play_GKP: 1,
          max_play_GKP: 1,
          min_play_DEF: 3,
          max_play_DEF: 5,
          min_play_MID: 2,
          max_play_MID: 5,
          min_play_FWD: 1,
          max_play_FWD: 3,
        },
      },
    },
    [`${draft}/game`]: { current_event: currentGw || null, current_event_finished: false, next_event: currentGw + 1 },
    [`${draft}/draft/league/${LEAGUE_ID}/transactions`]: {
      transactions: preseason
        ? []
        : [
            { entry: 101, element_in: 63, element_out: 12, event: 2, kind: 'w', result: 'a', added: '2026-08-21T09:00:00Z', index: 1, priority: 1 },
            { entry: 102, element_in: 63, element_out: 27, event: 2, kind: 'w', result: 'di', added: '2026-08-20T09:00:00Z', index: 2, priority: 2 },
            { entry: 104, element_in: 62, element_out: 60, event: 2, kind: 'w', result: 'do', added: '2026-08-20T10:00:00Z', index: 3, priority: 3 },
            { entry: 103, element_in: 64, element_out: 45, event: 3, kind: 'f', result: 'a', added: '2026-08-27T09:00:00Z', index: 4, priority: null },
          ],
    },
    [`${draft}/draft/league/${LEAGUE_ID}/trades`]: {
      trades: preseason
        ? []
        : [
            {
              event: 2,
              offered_entry: 101,
              received_entry: 104,
              offer_time: '2026-08-20T08:00:00Z',
              response_time: '2026-08-20T12:00:00Z',
              state: 'p',
              tradeitem_set: [{ element_in: 59, element_out: 14 }],
            },
            {
              event: 3,
              offered_entry: 102,
              received_entry: 103,
              offer_time: '2026-08-26T08:00:00Z',
              response_time: null,
              state: 'd',
              tradeitem_set: [{ element_in: 31, element_out: 16 }],
            },
          ],
    },
    [`${draft}/draft/${LEAGUE_ID}/choices`]: { choices },
    [`${draft}/league/${LEAGUE_ID}/element-status`]: {
      element_status: Array.from({ length: PLAYERS }, (_, i) => ({ element: i + 1, owner: ownerNow.get(i + 1) ?? null })),
    },
    'https://fantasy.premierleague.com/api/fixtures/?future=1': [
      ...fixtures.filter(([, , , , s]) => s === 'future').map(([id, g, h, a, s]) => fixtureJson(id, g, h, a, s)),
      { ...fixtureJson(699, 6, 1, 3, 'future'), event: null }, // not scheduled yet
    ],
  };
  if (!noFplBoot)
    out['https://fantasy.premierleague.com/api/bootstrap-static/'] = {
      elements: elements.map((el) => ({
        code: el.code,
        ep_next: ((el.id % 6) + 1).toFixed(1),
        ep_this: (el.id % 5).toFixed(1),
        penalties_order: el.id === 13 ? 1 : null,
      })),
      phases: [
        { name: 'Overall', start_event: 1, stop_event: 38 },
        { name: 'August', start_event: 1, stop_event: 3 },
        { name: 'September', start_event: 4, stop_event: 7 },
      ],
    };
  for (const [gw, feed] of Object.entries(feeds)) out[`${draft}/event/${gw}/live`] = feed;
  for (const [key, res] of Object.entries(picks)) {
    const [entry, gw] = key.split(':');
    out[`${draft}/entry/${entry}/event/${gw}`] = res;
  }
  return out;
}

/** The league as fetchLeague returns it, each response parsed by its schema. */
export function fetched(options: Options = {}): Fetched {
  const res = responses(options);
  const draft = 'https://draft.premierleague.com/api';
  const get = (url: string) => res[url];
  const details = api.LeagueDetails.parse(get(`${draft}/league/${LEAGUE_ID}/details`));
  const game = api.Game.parse(get(`${draft}/game`));
  const currentGw = game.current_event ?? 0;
  const gws = Array.from({ length: currentGw }, (_, i) => i + 1);
  const fplBoot = get('https://fantasy.premierleague.com/api/bootstrap-static/');
  return {
    details,
    boot: api.Bootstrap.parse(get(`${draft}/bootstrap-static`)),
    game,
    transactions: api.Transactions.parse(get(`${draft}/draft/league/${LEAGUE_ID}/transactions`)).transactions,
    trades: api.Trades.parse(get(`${draft}/draft/league/${LEAGUE_ID}/trades`)).trades,
    choices: api.DraftChoices.parse(get(`${draft}/draft/${LEAGUE_ID}/choices`)).choices,
    ownerNow: new Map(
      api.ElementStatus.parse(get(`${draft}/league/${LEAGUE_ID}/element-status`)).element_status.flatMap((s) =>
        s.owner ? [[s.element, s.owner] as const] : [],
      ),
    ),
    fplBoot: fplBoot ? api.FplBootstrap.parse(fplBoot) : null,
    fplFixtures: api.FplFixtures.parse(get('https://fantasy.premierleague.com/api/fixtures/?future=1')),
    live: Object.fromEntries(gws.map((gw) => [gw, api.LiveFeed.parse(get(`${draft}/event/${gw}/live`))])),
    picks: Object.fromEntries(
      MANAGERS.map((m) => [m, Object.fromEntries(gws.map((gw) => [gw, api.EntryPicks.parse(get(`${draft}/entry/${m}/event/${gw}`))]))]),
    ),
  };
}

/** The build run on the league as scripts/build-data.ts runs it, up to data.json's parts, with nothing written. */
export function build(options: Options = {}, previous: Partial<Data> | null = null) {
  const season = readSeason(fetched(options));
  const { managers, managerIds, entryByLeagueEntry } = buildManagers(season);
  const matches = buildMatches(season, entryByLeagueEntry);
  const lineups = buildLineups(season, matches);
  const lineup = lineupOf(lineups);
  patchLiveScores(matches, lineup);
  const results = buildResults(managerIds, matches);
  const tables = buildTables(season, managerIds, entryByLeagueEntry, matches, results, lineup);
  const seasonStats = buildSeasonStats(season, managerIds, results, lineup);
  const waiverOrder = [...managers].sort((a, b) => a.waiverPick - b.waiverPick).map((m) => m.id);
  const transfers = buildTransfers(season, managerIds, waiverOrder, lineup);
  const model = oddsModel(season, managerIds, tables.scoresByGw);
  priceMatches(matches, model, season.nextGw, previous);
  const simulation = simulate(season, managerIds, matches, tables.overall, model);
  return { season, managers, managerIds, entryByLeagueEntry, matches, lineups, lineup, results, tables, seasonStats, transfers, model, simulation };
}
