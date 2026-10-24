// Bonus from the match. FPL gives bonus to the three best BPS in a match, and those mostly
// follow goals, assists and clean sheets, so a player's bonus comes from what the forecast
// expects of him in that match: what a goal, an assist, a clean sheet, a defensive
// contribution and three saves have been worth in bonus at his position this season, plus
// his own bonus beyond that per 90, pulled towards none. A flat rate per 90 pulled towards
// his position's average left the best players short: what they score is what earns it.

import type { Position } from '../shared/data.ts';
import type { History, ModelPlayer } from './history.ts';

/** Bonus at a position per 90 minutes played, and per goal, assist, clean sheet, defensive contribution and three saves. */
export interface BonusRates {
  per90: number;
  goal: number;
  assist: number;
  cleanSheet: number;
  defcon: number;
  saves: number;
}

export interface BonusOptions {
  /** How many 90s a player's own bonus (beyond what his goals and the rest earn) starts from at none. */
  prior: number;
  /** A pull of each position's values towards none, as if from this much more data: it steadies the first gameweeks. */
  ridge: number;
}

export interface Bonus {
  rates: Record<Position, BonusRates>;
  /** Each player's own bonus per 90, beyond his position's rates. */
  own: Map<number, number>;
}

const POSITIONS: Position[] = ['GKP', 'DEF', 'MID', 'FWD'];
const FEATURES = ['per90', 'goal', 'assist', 'cleanSheet', 'defcon', 'saves'] as const;

/**
 * Least squares, position by position, on every appearance before `atGw`: bonus against
 * minutes, goals, assists, a clean sheet, a defensive contribution and saves, an appearance
 * `halfLife` gameweeks back counting half.
 */
export function fitBonus(
  h: History,
  players: Map<number, ModelPlayer>,
  atGw: number,
  halfLife: number,
  defconLimit: Record<Position, number>,
  o: BonusOptions,
): Bonus {
  const rows = h.appearances.flatMap((a) => {
    const pos = players.get(a.pid)?.pos;
    if (!pos || a.minutes <= 0) return [];
    const defcon = defconLimit[pos] && a.defcon >= defconLimit[pos] ? 1 : 0;
    const x = [a.minutes / 90, a.goals, a.assists, a.cleanSheet, defcon, a.saves / 3];
    return [{ pid: a.pid, pos, x, y: a.bonus, w: 0.5 ** ((atGw - a.gw) / halfLife) }];
  });
  const rates = {} as Record<Position, BonusRates>;
  for (const pos of POSITIONS) {
    const n = FEATURES.length;
    const a = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? o.ridge : 0)));
    const b = new Array<number>(n).fill(0);
    for (const r of rows.filter((row) => row.pos === pos))
      for (let i = 0; i < n; i++) {
        b[i] += r.w * r.x[i] * r.y;
        for (let j = 0; j < n; j++) a[i][j] += r.w * r.x[i] * r.x[j];
      }
    const beta = solve(a, b);
    rates[pos] = Object.fromEntries(FEATURES.map((f, i) => [f, beta[i]])) as unknown as BonusRates;
  }
  const sums = new Map<number, { beyond: number; n90: number }>();
  for (const r of rows) {
    const fit = FEATURES.reduce((t, f, i) => t + rates[r.pos][f] * r.x[i], 0);
    const s = sums.get(r.pid) ?? { beyond: 0, n90: 0 };
    sums.set(r.pid, { beyond: s.beyond + r.w * (r.y - fit), n90: s.n90 + r.w * r.x[0] });
  }
  const own = new Map([...sums].map(([pid, s]) => [pid, s.beyond / (s.n90 + o.prior)]));
  return { rates, own };
}

// Gaussian elimination with partial pivoting: the ridge keeps the system well posed.
function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < n; r++) {
      if (r === c || !m[c][c]) continue;
      const f = m[r][c] / m[c][c];
      for (let j = c; j <= n; j++) m[r][j] -= f * m[c][j];
    }
  }
  return m.map((row, i) => (row[i] ? row[n] / row[i] : 0));
}
