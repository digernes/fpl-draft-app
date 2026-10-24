// The shape of data.json (and the season archives), written by the build and read by
// the page. Ids are FPL ids: managers by entry id, players by element id, clubs by team id.

import type { PlayerEvents, SlimLive } from './live.ts';

export type Position = 'GKP' | 'DEF' | 'MID' | 'FWD';
export type Result = 'W' | 'D' | 'L';
export type Formation = Record<'DEF' | 'MID' | 'FWD', number>;
/** [min, max] players per position in an XI. */
export type XiLimits = Record<Position, [number, number]>;
/** Keyed by id; JSON object keys are strings, but numeric lookups work. */
export type ById<T> = Record<string, T>;
/** The site's expected points taken apart: expected minutes, then the points from each part, in src/model/points.ts's order. */
export type XpParts = [
  minutes: number,
  playing: number,
  goals: number,
  penalties: number,
  assists: number,
  cleanSheet: number,
  conceded: number,
  defcon: number,
  saves: number,
  bonus: number,
  cards: number,
];

export interface Data {
  meta: Meta;
  managers: Manager[];
  clubs: ById<Club>;
  gameweeks: Gameweek[];
  matches: Match[];
  tables: Tables;
  simulation: Simulation;
  plTwins: PlTwin[];
  /** entry id → gameweek → lineup */
  lineups: ById<ById<Lineup>>;
  /** gameweek → player → what he did, for everyone in a lineup that gameweek. Missing from older archives. */
  events?: ById<ById<PlayerEvents>>;
  /** Finished gameweek → player → his underlying numbers, for everyone in a lineup who played. Missing from older archives. */
  underlying?: ById<ById<Underlying>>;
  /** Beside `underlying`: the points in his xP that stay as FPL scored them, in shared/underlying.ts's AS_SCORED order without the noughts at the end, for its tooltip. Missing from older data. */
  asScored?: ById<ById<number[]>>;
  /** The real Premier League's matches, the whole season's, in kick-off order. Missing from older archives. */
  plMatches?: PlMatch[];
  /** While a gameweek is being played: its live feed, so the page can tell who is still to play. */
  live?: LiveData;
  /** FPL's chance of playing at each deadline for everyone it flagged (doubtful, injured or suspended), by gameweek: kept to test how the model reads flags. */
  flags?: ById<ById<number>>;
  topGameweeks: TopGameweek[];
  worstGameweeks: GameweekScore[];
  seasonStats: SeasonStat[];
  records: Records;
  transfers: Transfers;
  draft: Draft;
  players: ById<Player>;
}

export interface Meta {
  schema: number;
  generatedAt: string | null;
  leagueId: number;
  name: string;
  season: string;
  tz: string;
  firstGw: number;
  lastGw: number;
  currentGw: number;
  currentGwFinished: boolean;
  lastFinishedGw: number;
  nextGw: number;
  nextDeadline: string | null;
  nextWaivers: string | null;
  nextTrades: string | null;
  scoring: { win: number; draw: number; loss: number };
  /** FPL's points for what a player does, as the Draft game's settings name them (goals_scored_DEF, assists and so on). Missing from older archives. */
  rules?: Record<string, number>;
  dgwPenalty: number;
  formLength: number;
  oddsOverround: number;
  hasProjections: boolean;
  formation: Formation;
  xiLimits: XiLimits;
  /** The season's months by gameweek, as FPL's main game splits them, for the monthly awards. Missing from older archives. */
  months?: Month[];
}

export interface Month {
  name: string;
  from: number;
  to: number;
}

export interface Manager {
  id: number;
  first: string;
  initials: string;
  team: string;
  waiverPick: number;
}

export interface Club {
  name: string;
  short: string;
  logo: string;
  /** Home shirt and trim colours, or null when unknown. */
  kit: [string, string] | null;
}

export interface Gameweek {
  id: number;
  deadline: string;
  finished: boolean;
  /** Clubs playing twice. */
  doubles: number[];
  /** Its Premier League fixtures, [home, away, kick-off], while it is still to come. */
  fixtures?: [number, number, string | null][];
}

/** A real Premier League match. */
export interface PlMatch {
  /** FPL's fixture id. */
  id: number;
  gw: number;
  /** Clubs. */
  home: number;
  away: number;
  /** Kick-off, while it is set. */
  ko: string | null;
  /** Home and away goals, once it has kicked off. */
  score?: [number, number];
  /** Over, provisionally or for good. */
  done?: true;
  /** Everyone who played in it, home side and away side, starters first. */
  lineups?: [PlLine[], PlLine[]];
  /** What they did in this match alone, for anyone who did something. */
  events?: ById<PlayerEvents>;
  /** Home's and away's formations, from the Premier League's match centre, once the lineups are out. */
  formations?: [PlFormation, PlFormation];
}

/**
 * stats/<gw>.json (for a finished season, seasons/<2026-27>/stats/<gw>.json): everyone's
 * FPL stats in each of a gameweek's matches. Only the Premier League's player stats want
 * them, so they stay out of data.json. A player's numbers are in PL_STATS' order, null
 * where FPL gives one only for the gameweek and he played twice in it.
 */
export interface PlStats {
  gw: number;
  /** fixture id → player id → his stats */
  matches: ById<ById<(number | null)[]>>;
  /** fixture id → what happened in it and when, from the Premier League's match centre, in order. */
  moments?: ById<PlMoment[]>;
  /** The matches whose moments were asked for after full time, so they're kept as they are. */
  final?: number[];
}

/**
 * stats/season.json: everyone's FPL stats over the season so far, for the Premier League's
 * Players tab: player id → his minutes, then PL_STATS, then his xP and xCS (shared/underlying.ts;
 * no xCS where a clean sheet scores nothing for him), for anyone who has played.
 */
export interface PlSeasonStats {
  players: ById<(number | null)[]>;
  /**
   * The site's projections for the gameweeks to come (`gws`), for its Projected category:
   * player id → his expected points in each, then over them all his minutes, goals and
   * assists, and his points from clean sheets, defensive contributions and bonus.
   */
  projected?: { gws: number[]; players: ById<number[]> };
}

/**
 * A moment in a Premier League match: its minute (stoppage time added on, so 47 in the
 * first half is 45+2) and half, what it was, who, and the assister of a goal or the one
 * who went off for a substitute.
 */
export type PlMoment = [
  minute: number,
  half: 1 | 2,
  kind: 'goal' | 'pen' | 'own' | 'yellow' | 'second' | 'red' | 'sub',
  pid: number,
  other?: number,
];

/** The stats in a PlStats row, by FPL's names for them; his minutes and points are in the match's lineups. */
export const PL_STATS = [
  'goals_scored',
  'assists',
  'expected_goals',
  'expected_assists',
  'expected_goals_conceded',
  'clean_sheets',
  'goals_conceded',
  'own_goals',
  'penalties_saved',
  'penalties_missed',
  'yellow_cards',
  'red_cards',
  'saves',
  'bonus',
  'bps',
  'influence',
  'creativity',
  'threat',
  'ict_index',
  'clearances_blocks_interceptions',
  'recoveries',
  'tackles',
  'defensive_contribution',
] as const;
export type PlStat = (typeof PL_STATS)[number];

/** A side's formation: its shape, its XI line by line from the goalkeeper, and its named substitutes. */
export interface PlFormation {
  shape: string;
  lines: number[][];
  subs: number[];
}

/** A player in a match: his minutes, his FPL points from it (bonus once awarded), and 1 if he started. */
export type PlLine = [pid: number, minutes: number, points: number, started: 0 | 1];

export interface Price {
  dec: number;
  frac: string;
}

export interface Odds {
  /** Home, draw, away. */
  p: [number, number, number];
  prices: [Price, Price, Price];
  expected: [number, number];
  /** Projected XIs behind the prices, for the gameweeks that show them. */
  xi?: [number[], number[]];
  /** Worked out after kick-off from the form before the gameweek. */
  afterwards?: true;
}

export interface Match {
  gw: number;
  home: number;
  away: number;
  homePts: number | null;
  awayPts: number | null;
  started: boolean;
  finished: boolean;
  odds?: Odds;
  /** Once finished: the xG table's numbers for this match (home, away). */
  xg?: MatchXg;
}

/** xG, xA and expected points; then, where a clean sheet scores for his position, expected clean sheets and the xG his club conceded while he played. */
export type Underlying = [xg: number, xa: number, xp: number, xcs?: number, xgc?: number];

export interface MatchXg {
  /** Expected points: each XI with goals, assists and clean sheets swapped for their expected values. */
  xp: [number, number];
  /** The table points those expected scores would have earned. */
  xPts: [number, number];
}

export interface MatchResult {
  gw: number;
  opp: number;
  pf: number;
  pa: number;
  res: Result;
}

export interface NextMatch {
  gw: number;
  opp: number;
  live: boolean;
}

interface FormAndNext {
  form: MatchResult[];
  next: NextMatch | undefined;
}

export interface Tally {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  pf: number;
  pa: number;
  pts: number;
}

export interface OverallRow extends Tally, FormAndNext {
  id: number;
  rank: number;
  lastRank: number | null;
}

export interface FormRow extends Tally, FormAndNext {
  id: number;
  rank: number;
}

export interface XgRow {
  id: number;
  played: number;
  pf: number;
  pa: number;
  xpf: number;
  xpa: number;
  xPts: number;
  pts: number;
  tableRank: number | undefined;
  rank: number;
}

export interface LuckRow {
  id: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  above: number;
  avgPts: number;
  pts: number;
  luck: number;
  tableRank: number | undefined;
  rank: number;
}

export interface PointsRow {
  id: number;
  total: number;
  avg: number;
  high: number;
  low: number;
  bench: number;
  rank: number;
}

export interface ClubRow {
  club: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  pts: number;
  rank: number;
}

export interface Tables {
  overall: OverallRow[];
  form: FormRow[];
  xg: XgRow[];
  luck: LuckRow[];
  points: PointsRow[];
  premierLeague: ClubRow[];
}

export interface Simulation {
  runs: number;
  gameweeksLeft: number;
  model: {
    leagueAverage: number;
    /** How many gameweeks ahead get their own projected XIs; 0 before there are projections. */
    projected: number;
    levelSpread: number;
    spread: number;
    laterSpread: number;
  };
  rows: { id: number; pts: number; positions: number[]; rank: number }[];
}

export interface PlTwin {
  id: number;
  club: number;
  also: number[];
  exact: boolean;
  wouldBe: number;
}

export interface Lineup {
  pts: number;
  /** Points less the double-gameweek penalty. */
  adj: number;
  /** Scoring players whose club plays twice. */
  dgw: number;
  benchPts: number;
  xi: number[];
  bench: number[];
  subs: number[];
  /** The starters those automatic substitutes came on for, in the same order. Missing from older archives. */
  off?: number[];
  /** Picks in order, for weeks still being played (the page re-scores them live). */
  picks?: number[];
  xpf: number;
}

export interface LiveData extends SlimLive {
  gw: number;
  /** Expected points for this gameweek, for everyone in a lineup. */
  ep: ById<number>;
  /** Those taken apart (from the site's model only): the live odds take the appearance and clean-sheet points from them, which FPL hands out at 1 and 60 minutes. */
  parts?: ById<XpParts>;
  /** Points for a clean sheet, by position. */
  cleanSheet?: Partial<Record<Position, number>>;
  /** FPL's own expected points as they were at the deadline, for the setting that shows them; left out when `ep` is FPL's already. */
  fplEp?: ById<number>;
}

export interface GameweekScore {
  id: number;
  gw: number;
  pts: number;
  dgw: number;
  adj: number;
  rank: number;
}

export interface TopGameweek extends GameweekScore {
  /** Only on the list as the manager's best week. */
  guaranteed: boolean;
  opp: number | undefined;
  oppPts: number | null | undefined;
  star: { player: number; pts: number } | null;
}

export interface SeasonStat {
  id: number;
  total: number;
  avg: number;
  high: { pts: number; gw: number } | null;
  low: { pts: number; gw: number } | null;
  bench: number;
  mvp: { player: number; pts: number } | null;
  streak: { bestWin: number; current: string | null };
}

export interface Decided {
  gw: number;
  winner: number;
  loser: number;
  winPts: number;
  losePts: number;
  margin: number;
}

export interface Records {
  highest: GameweekScore | null;
  lowest: GameweekScore | null;
  biggestWin: Decided | null;
  narrowestWin: Decided | null;
  unluckiest: Decided | null;
  luckiest: Decided | null;
  draws: number;
  benchMax: { id: number; gw: number; pts: number } | null;
  longestWinRun: SeasonStat | null;
}

export type MoveType = 'waiver' | 'free' | 'trade';

export interface Move {
  type: MoveType;
  manager: number;
  /** The other side of a trade. */
  partner?: number;
  in: number;
  out: number;
  gw: number;
  at: string;
  /** Order within a waiver run. */
  order?: number;
  // Set once the gameweek has been scored.
  inPts?: number;
  outPts?: number;
  net?: number;
  banked?: number;
}

export type ScoredMove = Move & Required<Pick<Move, 'inPts' | 'outPts' | 'net' | 'banked'>>;

export interface Claim {
  manager: number;
  in: number;
  out: number;
  gw: number;
  /** Null for claims made before FPL kept a priority. */
  priority: number | null;
  outcome: 'won' | 'lost' | 'void';
  winner: number | null;
}

export interface TransferSummary {
  id: number;
  moves: number;
  waivers: number;
  free: number;
  trades: number;
  claims: number;
  lost: number;
  void: number;
  net: number;
  banked: number;
  best: ScoredMove | null;
  worst: ScoredMove | null;
}

export interface Trade {
  gw: number;
  offeredBy: number;
  offeredTo: number;
  state: string;
  at: string;
  items: { gives: number; gets: number }[];
}

export interface Transfers {
  moves: Move[];
  claims: Claim[];
  summary: TransferSummary[];
  contested: { gw: number; player: number; claimants: number[]; winner: number | null; pts: number | null }[];
  hotPotatoes: { player: number; owners: number[]; moves: number }[];
  mostDropped: { player: number; times: number }[];
  bestPickups: ScoredMove[];
  regrets: ScoredMove[];
  byGw: { gw: number; waiver: number; free: number; trade: number }[];
  trades: Trade[];
  waiverOrder: number[];
}

export interface DraftPick {
  overall: number;
  round: number;
  pick: number;
  manager: number;
  player: number;
  auto: boolean;
}

export interface Retention {
  id: number;
  size: number;
  kept: number[];
  gone: { player: number; owner: number | null }[];
  newcomers: number[];
  /** Originals in the squad, gameweek by gameweek. */
  byGw: number[];
  originalShare: number;
  originalXiPts: number;
  draftHaul: number;
}

export interface Draft {
  picks: DraftPick[];
  retention: Retention[];
}

export interface Player {
  name: string;
  full: string;
  pos: Position;
  club: number;
  code: number;
  total: number;
  /** Points gameweek by gameweek, only for players in the league's story. */
  pts?: number[];
  owner: number | null;
  status: string;
  /** For one FPL added after the draft (so nobody could draft him): the first gameweek he was in the game. */
  added?: number;
  news?: string;
  /** The season's xG, xA and expected points (as the xG table counts them) over the finished gameweeks, for anyone who has played. */
  xs?: [xg: number, xa: number, xp: number];
  /** Expected points for the next gameweek, from the site's model (FPL's before a gameweek has been played). */
  ep: number;
  /** FPL's own, its form, for the setting that shows them instead; left out when `ep` is FPL's already. */
  fpl?: number;
  /** The site's taken apart, in tenths, for its tooltip: only for players in a squad (the only ones the page shows xP for) it expects something of. */
  parts?: XpParts;
  /** The site's for the gameweeks after the next that show projected XIs, in order, for players in a squad. */
  ahead?: { ep: number; parts?: XpParts }[];
}

export interface SeasonIndex {
  seasons: SeasonEntry[];
}

export interface SeasonEntry {
  season: string;
  name: string;
  file: string;
  current?: true;
  schema?: number;
}
