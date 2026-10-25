// The momentum card's curve, smooth as fotmob.com's momentum: the lead or the win chance at
// each of its points, smoothed over a few minutes and drawn through samples every GRID
// minutes, so points bunched together with big jumps between them never make a corner.
//
// A point either comes all at once at its x (a moment: a goal, a card), or comes in evenly
// from the point before (`ramp`: a slot whose moments aren't known, the automatic
// substitutions, the live odds recorded at each build). All at once, it rises over the
// RISE minutes before its x, along a Gaussian's S (spread SPREAD), so the curve has got
// there at the moment itself, where its mark is. Evenly, the straight line between the two
// is smoothed with a Gaussian of the same spread, rounding its corners. The curve starts
// at the first point and ends at the last, the live end's pulsing dot on it, and is exactly
// level wherever nothing changes.

import { normalCdf } from '../shared/odds.ts';

export interface CurvePoint {
  x: number;
  v: number;
  /** Comes in evenly from the point before, rather than all at once at x. */
  ramp?: boolean;
}

/** Minutes between the samples the curve is drawn through. */
export const GRID = 2;
/** The Gaussian's spread, in minutes. */
export const SPREAD = 1.5;
/** How long before a moment the curve starts to rise to it: three spreads either side of the S's middle. */
export const RISE = 6 * SPREAD;

// A Gaussian's S over [−3, 3] spreads, from exactly 0 to exactly 1.
const S_EDGE = normalCdf(-3);
const sCurve = (z: number) => (z <= -3 ? 0 : z >= 3 ? 1 : (normalCdf(z) - S_EDGE) / (1 - 2 * S_EDGE));
// The Gaussian's weights at whole samples, three spreads either side.
const TAPS = Array.from({ length: 2 * Math.ceil((3 * SPREAD) / GRID) + 1 }, (_, i) => (i - Math.ceil((3 * SPREAD) / GRID)) * GRID);
const WEIGHTS = (() => {
  const raw = TAPS.map((t) => Math.exp(-((t / SPREAD) ** 2) / 2));
  const total = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => w / total);
})();
// Eases from 0 to 1 with no slope at either end.
const smoothstep = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/** The curve's value at any x, before it's drawn: for the samples, and for the tests. */
export function smoothed(points: CurvePoint[]) {
  const [first] = points;
  const end = points.at(-1)!.x;
  const steps = points.flatMap((p, i) => (i && !p.ramp ? [{ x: p.x, by: p.v - points[i - 1].v }] : []));
  const ramps = points.flatMap((p, i) => (i && p.ramp ? [{ from: points[i - 1].x, to: p.x, by: p.v - points[i - 1].v }] : []));
  const ramped = (x: number) =>
    ramps.reduce((t, r) => t + r.by * (r.to > r.from ? Math.min(1, Math.max(0, (x - r.from) / (r.to - r.from))) : x >= r.to ? 1 : 0), 0);
  const raw = (x: number) => {
    const at = ramped(x);
    const smoothRamps = TAPS.reduce((t, dx, k) => t + WEIGHTS[k] * (ramped(Math.min(end, Math.max(0, x + dx))) - at), 0);
    return first.v + steps.reduce((t, s) => t + s.by * sCurve((x - s.x + RISE / 2) / SPREAD), 0) + at + smoothRamps;
  };
  // Pinned to the first point and the last, easing into the rest over RISE minutes.
  const [fromStart, fromEnd] = [first.v - raw(first.x), points.at(-1)!.v - raw(end)];
  return (x: number) => raw(x) + fromStart * (1 - smoothstep((x - first.x) / RISE)) + fromEnd * smoothstep((x - (end - RISE)) / RISE);
}

/** The curve through the points as an SVG path, and its height at any x along it. */
export function smoothCurve(points: CurvePoint[]) {
  if (points.length < 2) return { path: `M${points[0].x},${points[0].v.toFixed(2)}`, at: () => points[0].v };
  const value = smoothed(points);
  const [start, end] = [points[0].x, points.at(-1)!.x];
  const xs: number[] = [];
  for (let x = start; x < end - GRID / 3; x += GRID) xs.push(x);
  xs.push(end);
  const all = xs.map((x): [number, number] => [x, value(x)]);
  // A level stretch needs only its ends: the curve keeps level between them.
  const samples = all.filter(([, v], i) => i === 0 || i === all.length - 1 || v !== all[i - 1][1] || v !== all[i + 1][1]);
  return monotoneCubic(samples);
}

const num = (n: number) => String(Number(n.toFixed(2)));

// A smooth line through the samples that never overshoots them: a monotone cubic, as d3's
// curveMonotoneX draws it, and its height at any x along it.
function monotoneCubic(points: [number, number][]) {
  const n = points.length;
  const dx = points.slice(1).map(([x], i) => x - points[i][0]);
  const slope = points.slice(1).map(([, y], i) => (y - points[i][1]) / (dx[i] || 1));
  const tangent = monotoneTangents(dx, slope);
  const pieces = points.slice(1).map(([x1, y1], i) => {
    const [x0, y0] = points[i];
    const h = dx[i] / 3;
    return ` C${num(x0 + h)},${num(y0 + h * tangent[i])} ${num(x1 - h)},${num(y1 - h * tangent[i + 1])} ${num(x1)},${num(y1)}`;
  });
  // Each piece's control points are a third of the way apart in x, so x runs evenly with t.
  const at = (x: number) => {
    let i = 0;
    while (i < n - 2 && x > points[i + 1][0]) i++;
    const [[x0, y0], [, y1]] = [points[i], points[i + 1]];
    const t = dx[i] ? (x - x0) / dx[i] : 0;
    const [c0, c1] = [y0 + (dx[i] / 3) * tangent[i], y1 - (dx[i] / 3) * tangent[i + 1]];
    return (1 - t) ** 3 * y0 + 3 * (1 - t) ** 2 * t * c0 + 3 * (1 - t) * t ** 2 * c1 + t ** 3 * y1;
  };
  return { path: `M${num(points[0][0])},${num(points[0][1])}${pieces.join('')}`, at };
}

// Fritsch–Carlson's tangents: flat where the slope turns, so the curve never overshoots.
function monotoneTangents(dx: number[], slope: number[]) {
  const n = slope.length + 1;
  return Array.from({ length: n }, (_, i) => {
    if (i === 0) return slope[0];
    if (i === n - 1) return slope[n - 2];
    const [a, b] = [slope[i - 1], slope[i]];
    return a * b <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / a + (dx[i] + 2 * dx[i - 1]) / b);
  });
}
