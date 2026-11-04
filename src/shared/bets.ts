// Betting fake money on the draft league's head-to-heads, as the page and the Worker both
// see it: who can sign up, what a bet is, when a match takes one and at what price, and how
// it's settled. The Worker keeps the accounts and the bets (worker/bets.ts) and prices every
// bet itself from the site's data.json, so a bet is only ever taken at the odds it works out.
//
// Everyone has ALLOWANCE to stake in each gameweek, a fresh one every gameweek; what isn't
// staked doesn't carry over. Singles on 1 X 2 only: before the deadline at the pre-match
// odds, and while the gameweek is played at the live odds, until a result is all but sure.

import type { Data, Match } from './data.ts';
import { matchOddsNow, type InPlayData } from './in-play.ts';
import type { Expected } from './live-projection.ts';
import type { SlimLive } from './live.ts';

/** What everyone has to stake in each gameweek. */
export const ALLOWANCE = 1000;
/** A live bet is refused once one result is this sure: there's nothing left to bet on. */
export const DECIDED = 0.99;

export const NAME = /^[A-Za-z0-9_-]{3,16}$/;
export const PIN = /^\d{6}$/;
export const NAME_RULE = '3 to 16 letters, digits, - or _';

/** Home win, draw, away win: the odds' order. */
export type Outcome = 0 | 1 | 2;
export const OUTCOMES: Outcome[] = [0, 1, 2];

/** A bet as the relay hands it out: on whose account, which match and what came of it. */
export interface Bet {
  id: number;
  name: string;
  season: string;
  gw: number;
  home: number;
  away: number;
  pick: Outcome;
  stake: number;
  /** Decimal odds it was taken at. */
  price: number;
  /** When it was taken (ms), and if live, the score then. */
  at: number;
  live?: [number, number];
  /** Once settled: the result, and what it paid back (0 when it lost). */
  result?: Outcome;
  payout?: number;
}

/** An account as its owner sees it: the draft team it follows on every device, and its bets, newest first. */
export interface Me {
  name: string;
  team: number | null;
  bets: Bet[];
}

/** A row of the leaderboard: settled bets only. */
export interface Leader {
  name: string;
  /** Winnings: what the bets paid back less what was staked. */
  profit: number;
  /** Gameweeks with a settled bet. */
  gws: number;
  bets: number;
  won: number;
}

export interface Board {
  leaders: Leader[];
  /** The latest settled bets, newest first. */
  feed: Bet[];
}

/** What a bet asks for: the match, the pick, the stake and the price the page showed. */
export interface Slip {
  gw: number;
  home: number;
  away: number;
  pick: Outcome;
  stake: number;
  price: number;
}

/** What of data.json pricing and settling read. */
export type BetData = InPlayData & Pick<Data, 'matches' | 'gameweeks'>;

export const seasonSlug = (d: Pick<Data, 'meta'>) => d.meta.season.replace('/', '-');

/** A finished head-to-head's result, as its points have it. */
export function resultOf(m: Match): Outcome | null {
  if (!m.finished || m.homePts === null || m.awayPts === null) return null;
  return m.homePts > m.awayPts ? 0 : m.homePts < m.awayPts ? 2 : 1;
}

/** What a stake at a price pays back when it wins: whole coins. */
export const payoutOf = (stake: number, price: number) => Math.round(stake * price);

/** What a bet won or lost: nothing until it's settled. */
export const profitOf = (b: Pick<Bet, 'stake' | 'payout'>) => (b.payout === undefined ? 0 : b.payout - b.stake);

/** What's left to stake in a gameweek after these bets. */
export const leftIn = (bets: Pick<Bet, 'season' | 'gw' | 'stake'>[], season: string, gw: number) =>
  ALLOWANCE - bets.filter((b) => b.season === season && b.gw === gw).reduce((t, b) => t + b.stake, 0);

/**
 * The odds a match takes a bet at now (`now` in ms), or why it doesn't: the next gameweek's
 * before its deadline at the pre-match odds; the gameweek being played, with the live feed,
 * at the live odds while no result is all but sure.
 */
export function oddsNow(
  d: BetData,
  m: Match,
  now: number,
  feed?: SlimLive | null,
  stats?: Expected['stats'],
): { p: [number, number, number]; prices: [number, number, number]; live?: [number, number] } | string {
  if (m.finished) return 'This match is over';
  const deadline = Date.parse(d.gameweeks.find((g) => g.id === m.gw)?.deadline ?? '');
  if (now < deadline) {
    if (m.gw !== d.meta.nextGw || !m.odds) return 'Betting opens once its odds are out';
    return { p: m.odds.p, prices: m.odds.prices.map((x) => x.dec) as [number, number, number] };
  }
  if (!feed || d.live?.gw !== m.gw) return 'Live betting opens once the gameweek’s first data build is in';
  const live = matchOddsNow(d, feed, m, stats);
  if (!live) return 'No live odds for this match just now';
  if (live.p.some((p) => p >= DECIDED)) return 'Betting has closed: the result is all but sure';
  return { p: live.p, prices: live.prices.map((x) => x.dec) as [number, number, number], live: live.score };
}

/** A leaderboard from everyone's settled bets: the most won first, then the best average. */
export function leadersOf(bets: Bet[]): Leader[] {
  const rows = new Map<string, Leader & { weeks: Set<string> }>();
  for (const b of bets) {
    if (b.payout === undefined) continue;
    const row = rows.get(b.name) ?? { name: b.name, profit: 0, gws: 0, bets: 0, won: 0, weeks: new Set<string>() };
    row.profit += profitOf(b);
    row.bets += 1;
    row.won += b.payout > 0 ? 1 : 0;
    row.weeks.add(`${b.season}:${b.gw}`);
    rows.set(b.name, row);
  }
  return [...rows.values()]
    .map(({ weeks, ...row }) => ({ ...row, gws: weeks.size }))
    .sort((a, b) => b.profit - a.profit || b.profit / b.gws - a.profit / a.gws || a.name.localeCompare(b.name));
}
