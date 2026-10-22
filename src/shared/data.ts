// The shape of data.json (and the season archives), written by the build and read by
// the page. Ids are FPL ids: managers by entry id, players by element id, clubs by team id.

import type { SlimLive } from './live.ts';

export type Position = 'GKP' | 'DEF' | 'MID' | 'FWD';
export type Result = 'W' | 'D' | 'L';
export type Formation = Record<'DEF' | 'MID' | 'FWD', number>;
/** Keyed by id; JSON object keys are strings, but numeric lookups work. */
export type ById<T> = Record<string, T>;

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
  /** While a gameweek is being played: its live feed, so the page can tell who is still to play. */
  live?: LiveData;
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
  dgwPenalty: number;
  formLength: number;
  oddsOverround: number;
  hasProjections: boolean;
  formation: Formation;
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
}

export interface Price {
  dec: number;
  frac: string;
}

export interface Odds {
  /** Home, draw, away. */
  p: [number, number, number];
  prices: [Price, Price, Price];
  expected: [number, number];
  /** Projected XIs behind the next gameweek's prices. */
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
    formWeight: number;
    projectionWeight: number;
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
  /** Picks in order, for weeks still being played (the page re-scores them live). */
  picks?: number[];
  xpf: number;
}

export interface LiveData extends SlimLive {
  gw: number;
  /** FPL's expected points for this gameweek, for everyone in a lineup. */
  ep: ById<number>;
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
  news?: string;
  ep: number;
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
