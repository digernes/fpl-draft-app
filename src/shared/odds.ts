// The odds maths shared by the build (pre-match odds) and the page (live odds): a
// normal model of the score difference before the deadline, each side's points still to
// come as a gamma above a floor with its rare drops (red cards and the like) laid over it
// while it's played, and prices in decimal and fractional.

import type { Price } from './data.ts';

// The usual UK fractional ladder, filled in where it jumps: from 1/2 to 4/1, where most
// matches' prices are, with the in-between fractions some books use (3/4, 20/21, 7/5,
// 85/40, 13/5…), so no step there is much over 5%, every whole price from 10/1 to
// 100/1 (from 40/1 to 50/1, say), then the books' long prices up to 5000/1, for a side
// all but beaten late in a gameweek. Decimal prices step on their own, finer ladder
// (DECIMAL_STEPS), up to 5000.
// prettier-ignore
const FRACTIONS: [number, number][] = [
  [1, 100], [1, 50], [1, 33], [1, 25], [1, 20], [1, 16], [1, 14], [1, 12], [1, 10], [1, 9], [1, 8],
  [2, 15], [1, 7], [1, 6], [2, 11], [1, 5], [2, 9], [1, 4], [2, 7], [3, 10], [1, 3], [4, 11], [2, 5],
  [4, 9], [1, 2], [8, 15], [4, 7], [3, 5], [8, 13], [13, 20], [4, 6], [7, 10], [8, 11], [3, 4], [4, 5],
  [5, 6], [17, 20], [9, 10], [10, 11], [20, 21], [1, 1], [21, 20], [11, 10], [23, 20], [6, 5], [5, 4],
  [13, 10], [11, 8], [7, 5], [6, 4], [8, 5], [13, 8], [7, 4], [9, 5], [15, 8], [2, 1], [85, 40], [11, 5],
  [9, 4], [12, 5], [5, 2], [13, 5], [11, 4], [14, 5], [3, 1], [16, 5], [10, 3], [7, 2], [15, 4], [4, 1],
  [9, 2], [5, 1], [11, 2], [6, 1], [13, 2], [7, 1], [15, 2], [8, 1], [17, 2], [9, 1],
  ...Array.from({ length: 91 }, (_, i): [number, number] => [10 + i, 1]),
  ...[125, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000].map((n): [number, number] => [n, 1]),
];

// Decimal prices step as on a betting exchange: by 0.01 up to 2, then by more as they lengthen.
// prettier-ignore
const DECIMAL_STEPS: [number, number][] = [[2, 0.01], [3, 0.02], [4, 0.05], [6, 0.1], [10, 0.2], [20, 0.5], [30, 1], [50, 2], [100, 5], [200, 10], [500, 25], [1000, 50], [5000, 250]];
const LONGEST = 5000;

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

// The fair price less the bookmaker's margin, rounded down onto each ladder; a sure thing
// (what shows as 100%) is 1.00, and in fractions the short end of the longest price.
export function price(probability: number, overround: number): Price {
  if (probability >= 0.9995) return { dec: 1, frac: `1/${LONGEST}` };
  const fair = 1 / (probability * overround);
  let [num, den] = FRACTIONS[0];
  for (const [n, d] of FRACTIONS) if (1 + n / d <= fair + 1e-9) [num, den] = [n, d];
  return { dec: decimalPrice(fair), frac: `${num}/${den}` };
}

function decimalPrice(fair: number) {
  const band = DECIMAL_STEPS.find(([upTo]) => fair < upTo);
  if (!band) return LONGEST;
  const stepped = Math.floor(fair / band[1] + 1e-9) * band[1];
  return Math.max(1.01, Math.round(stepped * 100) / 100);
}

/** Where a side's score is heading while its gameweek is played (see liveProjection in live-projection.ts). */
export interface Heading {
  /** Its expected final score, and the variance about it, its jumps' included. */
  mean: number;
  variance: number;
  /** What it will almost surely still have at the end, its jumps aside: without one, the score is taken as normal. */
  floor?: number;
  /** Its drops, each independent of the others. */
  jumps?: Jump[];
}

/**
 * Something that drops a side's score at once, a player's cards, an own goal, a clean sheet
 * lost: what it can cost (below 0) and the chance of each, one at most (a yellow card or a
 * red), and the rest of the time nothing.
 */
export type Jump = { points: number; chance: number }[];

const jumpMean = (j: Jump) => j.reduce((t, o) => t + o.chance * o.points, 0);
const jumpVariance = (j: Jump) => j.reduce((t, o) => t + o.chance * o.points ** 2, 0) - jumpMean(j) ** 2;

/** What the jumps take off on average (below 0). */
export const jumpsMean = (jumps: Jump[]) => jumps.reduce((t, j) => t + jumpMean(j), 0);

// In-play odds from two live projections: home win, draw and away win, with their prices.
export function liveOdds(home: Heading, away: Heading, overround: number) {
  const p = finalChances(home, away);
  const round3 = (x: number) => Math.round(x * 1000) / 1000;
  return {
    p: [round3(p[0]), round3(p[1]), round3(p[2])] as [number, number, number],
    prices: [price(p[0], overround), price(p[1], overround), price(p[2], overround)] as [Price, Price, Price],
  };
}

// The points still to come aren't normal: most of the time they're a point or two, now and
// then a haul, and below the score as it stands only now and then, all at once (a red card,
// a clean sheet lost). So each side's final score is its floor, what it will almost surely
// still have, plus a gamma: skewed right, more so the nearer its mean is to the floor, and
// close to a normal when there's plenty still to play. Its jumps are laid over that, each a
// chance of losing points at once, their mean and variance taken out of the gamma's so that
// the side's are the projection's. Each side is laid on a grid of tenths of a point and the
// two compared; FPL's points are whole, so a draw is the two within half a point of each
// other. Without floors, the normal of the difference, as before.
export function finalChances(home: Heading, away: Heading): [number, number, number] {
  if (home.floor === undefined || away.floor === undefined) {
    const p = outcomeProbabilities(home.mean - away.mean, Math.max(0.01, Math.sqrt(home.variance + away.variance)));
    return [p.home, p.draw, p.away];
  }
  const [h, a] = [finalScore(home), finalScore(away)];
  const ahead = (x: Grid, y: Grid) => {
    // The chance x ends more than half a point above y, one exactly half a point above counting half.
    const below = cumulative(y);
    const at = (j: number) => (j < y.start ? 0 : j >= y.start + y.p.length ? 1 : below[j - y.start]);
    let sum = 0;
    for (let i = 0; i < x.p.length; i++) {
      const j = x.start + i - HALF;
      sum += x.p[i] * (at(j - 1) + (at(j) - at(j - 1)) / 2);
    }
    return sum;
  };
  const homeWins = ahead(h, a);
  const awayWins = ahead(a, h);
  return [homeWins, Math.max(0, 1 - homeWins - awayWins), awayWins];
}

// A tenth of a point a cell, and half a point in cells.
const STEP = 0.1;
const HALF = 5;

/** A score on the grid: cell `start + i` is the chance it ends within half a step of (start + i) × STEP. */
export interface Grid {
  start: number;
  p: Float64Array;
}

/** A side's final score on the grid: the gamma above its floor, with its jumps laid over it (see finalChances). */
export function finalScore({ mean, variance, floor, jumps = [] }: Heading): Grid {
  const real = jumps.map((j) => j.filter((o) => o.chance > 0 && o.points !== 0)).filter((j) => j.length);
  const shift = jumpsMean(real);
  const spread = real.reduce((t, j) => t + jumpVariance(j), 0);
  const smooth = onGrid({ mean: mean - shift, variance: Math.max(0, variance - spread), floor });
  return real.length ? sum(smooth, dropsOf(real)) : smooth;
}

// An outcome of the jumps less likely than this is left out, and the rest scaled back up to
// the whole: early in a gameweek, with a few dozen jumps still to come, that keeps their
// outcomes to a few dozen too, and none of them can move a chance by a millionth.
const NEGLIGIBLE = 1e-9;

/** The jumps' total on the grid, outcome by outcome: each independent of the others. */
export function dropsOf(jumps: Jump[]): Grid {
  let outcomes = new Map([[0, 1]]);
  for (const jump of jumps) {
    const none = 1 - jump.reduce((t, o) => t + o.chance, 0);
    const next = new Map<number, number>();
    const add = (at: number, p: number) => p > NEGLIGIBLE && next.set(at, (next.get(at) ?? 0) + p);
    for (const [at, p] of outcomes) {
      add(at, p * none);
      for (const { points, chance } of jump) add(at + Math.round(points / STEP), p * chance);
    }
    outcomes = next;
  }
  const start = Math.min(...outcomes.keys());
  const p = new Float64Array(Math.max(...outcomes.keys()) - start + 1);
  const total = [...outcomes.values()].reduce((t, x) => t + x, 0);
  for (const [at, x] of outcomes) p[at - start] = x / total;
  return { start, p };
}

// Two independent scores on the grid added up: each cell of one spread over the other.
function sum(g: Grid, h: Grid): Grid {
  const p = new Float64Array(g.p.length + h.p.length - 1);
  for (let j = 0; j < h.p.length; j++) {
    const q = h.p[j];
    if (q) for (let i = 0; i < g.p.length; i++) p[i + j] += g.p[i] * q;
  }
  return { start: g.start + h.start, p };
}

function cumulative(g: Grid) {
  const sums = new Float64Array(g.p.length);
  let total = 0;
  for (let i = 0; i < g.p.length; i++) sums[i] = total += g.p[i];
  return sums;
}

// The floor plus a gamma with the side's mean and variance, from the floor (or ten spreads
// below the mean, should that be higher) to where all but a sliver of the gamma's right
// tail is in. The cell with the floor in it has the gamma's chance up to its top, since its
// density can be infinite there; the rest their density at their middle. Nothing left to
// play (or a floor at the mean) is the mean for certain.
function onGrid({ mean, variance, floor = mean }: Heading): Grid {
  const room = mean - floor;
  if (!(variance > 1e-12) || !(room > 1e-9)) return { start: Math.round(mean / STEP), p: Float64Array.of(1) };
  const shape = (room * room) / variance;
  const scale = variance / room;
  const first = Math.round(Math.max(floor, mean - 10 * Math.sqrt(variance)) / STEP);
  const last = Math.round((floor + scale * (shape + 8 * Math.sqrt(shape) + 20)) / STEP);
  const p = new Float64Array(last - first + 1);
  const norm = lnGamma(shape) + Math.log(scale);
  let total = 0;
  for (let i = 0; i < p.length; i++) {
    const top = (first + i + 0.5) * STEP;
    if (top <= floor) continue;
    const z = ((first + i) * STEP - floor) / scale;
    p[i] = z <= STEP / 2 / scale ? lowerGamma(shape, (top - floor) / scale) : STEP * Math.exp((shape - 1) * Math.log(z) - z - norm);
    total += p[i];
  }
  for (let i = 0; i < p.length; i++) p[i] /= total;
  return { start: first, p };
}

// ln Γ(x) for x > 0, by Lanczos' approximation as Numerical Recipes has it: good to 1e-10.
const LANCZOS = [76.18009172947146, -86.50532032941678, 24.01409824083091, -1.231739572450155, 0.001208650973866179, -0.000005395239384953];
export function lnGamma(x: number): number {
  let sum = 1.000000000190015;
  LANCZOS.forEach((c, i) => (sum += c / (x + 1 + i)));
  const t = x + 5.5;
  return (x + 0.5) * Math.log(t) - t + Math.log((Math.sqrt(2 * Math.PI) * sum) / x);
}

// The regularised lower incomplete gamma P(a, x): a gamma's chance of ending below x scales.
// Its series below a + 1, and one less the continued fraction for the upper tail above.
export function lowerGamma(a: number, x: number): number {
  if (x <= 0) return 0;
  const front = Math.exp(a * Math.log(x) - x - lnGamma(a));
  if (x < a + 1) {
    let [term, sum] = [1 / a, 1 / a];
    for (let n = 1; n < 500 && Math.abs(term) > Math.abs(sum) * 1e-14; n++) sum += term *= x / (a + n);
    return Math.min(1, sum * front);
  }
  // Lentz's method.
  let b = x + 1 - a;
  let c = 1 / 1e-300;
  let d = 1 / b;
  let h = d;
  for (let n = 1; n < 500; n++) {
    const an = -n * (n - a);
    b += 2;
    d = an * d + b;
    d = Math.abs(d) < 1e-300 ? 1e-300 : d;
    c = b + an / c;
    c = Math.abs(c) < 1e-300 ? 1e-300 : c;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-14) break;
  }
  return Math.max(0, 1 - front * h);
}
