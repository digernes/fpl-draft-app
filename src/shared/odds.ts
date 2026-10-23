// The odds maths shared by the build (pre-match odds) and the page (live odds): a
// normal model of the score difference, and prices in decimal and fractional.

import type { Price } from './data.ts';

// The usual UK fractional ladder. It is coarse near evens (10/11 covers every chance from
// 47.6% to 49.9%), so decimal prices step on their own, finer ladder (DECIMAL_STEPS).
// prettier-ignore
const FRACTIONS: [number, number][] = [
  [1, 100], [1, 50], [1, 33], [1, 25], [1, 20], [1, 16], [1, 14], [1, 12], [1, 10], [1, 9], [1, 8],
  [2, 15], [1, 7], [1, 6], [2, 11], [1, 5], [2, 9], [1, 4], [2, 7], [3, 10], [1, 3], [4, 11], [2, 5],
  [4, 9], [1, 2], [8, 15], [4, 7], [8, 13], [4, 6], [8, 11], [4, 5], [5, 6], [10, 11], [1, 1],
  [21, 20], [11, 10], [6, 5], [5, 4], [11, 8], [6, 4], [13, 8], [7, 4], [15, 8], [2, 1], [9, 4],
  [5, 2], [11, 4], [3, 1], [10, 3], [7, 2], [4, 1], [9, 2], [5, 1], [11, 2], [6, 1], [13, 2], [7, 1],
  [15, 2], [8, 1], [17, 2], [9, 1], [10, 1], [11, 1], [12, 1], [14, 1], [16, 1], [18, 1], [20, 1],
  [22, 1], [25, 1], [28, 1], [33, 1], [40, 1], [50, 1], [66, 1], [80, 1], [100, 1],
];

// Decimal prices step as on a betting exchange: by 0.01 up to 2, then by more as they lengthen.
// prettier-ignore
const DECIMAL_STEPS: [number, number][] = [[2, 0.01], [3, 0.02], [4, 0.05], [6, 0.1], [10, 0.2], [20, 0.5], [30, 1], [50, 2], [100, 5]];

/** Home win, draw and away win when the home side's lead ends up ~ Normal(diff, spread). A draw is both sides on the same integer. */
export function outcomeProbabilities(diff: number, spread: number) {
  const home = 1 - normalCdf((0.5 - diff) / spread);
  const away = normalCdf((-0.5 - diff) / spread);
  return { home, draw: 1 - home - away, away };
}

// Both scores ~ Normal(mu, sigma), independently.
export function winDrawWin(muHome: number, muAway: number, sigma: number) {
  return outcomeProbabilities(muHome - muAway, Math.SQRT2 * sigma);
}

export function normalCdf(x: number): number {
  // Abramowitz & Stegun 7.1.26
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-z * z);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

// The fair price less the bookmaker's margin, rounded down onto each ladder.
export function price(probability: number, overround: number): Price {
  const fair = 1 / (probability * overround);
  let [num, den] = FRACTIONS[0];
  for (const [n, d] of FRACTIONS) if (1 + n / d <= fair + 1e-9) [num, den] = [n, d];
  return { dec: decimalPrice(fair), frac: `${num}/${den}` };
}

function decimalPrice(fair: number) {
  const band = DECIMAL_STEPS.find(([upTo]) => fair < upTo);
  if (!band) return 100;
  const stepped = Math.floor(fair / band[1] + 1e-9) * band[1];
  return Math.max(1.01, Math.round(stepped * 100) / 100);
}

// In-play odds from two live projections (see liveProjection in live.ts).
export function liveOdds(home: { mean: number; variance: number }, away: { mean: number; variance: number }, overround: number) {
  const spread = Math.max(0.01, Math.sqrt(home.variance + away.variance));
  const p = outcomeProbabilities(home.mean - away.mean, spread);
  const round3 = (x: number) => Math.round(x * 1000) / 1000;
  return {
    p: [round3(p.home), round3(p.draw), round3(p.away)] as [number, number, number],
    prices: [price(p.home, overround), price(p.draw, overround), price(p.away, overround)] as [Price, Price, Price],
  };
}
