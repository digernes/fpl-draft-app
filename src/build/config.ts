// The numbers that shape the page. Change them here.

import type { Position } from '../shared/data.ts';

// Bump when data.json changes shape, so the page can tell which archives it can read.
export const SCHEMA = 1;

// Top-gameweek ranking only: points knocked off per scoring-XI player whose club plays twice.
export const DGW_PENALTY = 4;
export const TOP_GAMEWEEKS = 10;
export const FORM_LENGTH = 5;
// Odds: bookmaker overround, how many gameweeks ahead get prices, and the least spread
// of a score around its expected value. A manager's expected score is the league average
// plus how far their best projected XI that gameweek sits from the league's average one.
export const ODDS_OVERROUND = 1.05;
export const ODDS_GAMEWEEKS = 3;
export const MIN_SCORE_SPREAD = 13;
// Season simulation: runs of the remaining fixtures, and how far a manager's true
// level may sit from their projections (points a week), drawn once per run. Seeded, so
// the same data always gives the same percentages.
export const SIM_RUNS = 10000;
export const SIM_SKILL_SPREAD = 3;
export const SIM_SEED = 20262027;

export const POSITIONS: Record<number, Position> = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };
// Home shirt and trim colours by the Premier League's club code, for the placeholder
// shown when a player has no photo. The API has no kit colours; unknown clubs go grey.
export const KIT_COLORS: Record<number, [string, string]> = {
  1: ['#da291c', '#ffffff'], // Man Utd
  2: ['#ffffff', '#1d428a'], // Leeds
  3: ['#ef0107', '#ffffff'], // Arsenal
  4: ['#241f20', '#ffffff'], // Newcastle
  6: ['#ffffff', '#132257'], // Tottenham
  7: ['#670e36', '#95bfe5'], // Aston Villa
  8: ['#034694', '#ffffff'], // Chelsea
  9: ['#59a5d8', '#ffffff'], // Coventry
  11: ['#003399', '#ffffff'], // Everton
  13: ['#003090', '#fdbe11'], // Leicester
  14: ['#c8102e', '#f6eb61'], // Liverpool
  17: ['#dd0000', '#ffffff'], // Nottm Forest
  20: ['#d71920', '#ffffff'], // Southampton
  21: ['#7a263a', '#1bb1e7'], // West Ham
  25: ['#e11b22', '#ffffff'], // Middlesbrough
  31: ['#1b458f', '#c4122e'], // Crystal Palace
  35: ['#122f67', '#ffffff'], // West Brom
  36: ['#0057b8', '#ffffff'], // Brighton
  39: ['#fdb913', '#231f20'], // Wolves
  40: ['#0044a9', '#ffffff'], // Ipswich
  43: ['#6cabdd', '#ffffff'], // Man City
  45: ['#fff200', '#00a650'], // Norwich
  49: ['#ee2737', '#ffffff'], // Sheffield Utd
  54: ['#ffffff', '#000000'], // Fulham
  56: ['#eb172b', '#ffffff'], // Sunderland
  57: ['#fbee23', '#ed2127'], // Watford
  88: ['#f5a12d', '#000000'], // Hull
  90: ['#6c1d45', '#99d6ea'], // Burnley
  91: ['#da291c', '#000000'], // Bournemouth
  94: ['#e30613', '#ffffff'], // Brentford
  102: ['#f78f1e', '#002d62'], // Luton
};
