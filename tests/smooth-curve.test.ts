import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GRID, RISE, SPREAD, smoothCurve, smoothed, type CurvePoint } from '../src/app/smooth-curve.ts';

const near = (a: number, b: number, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${a} is not ${b}`);

// The path's pieces: where each starts, its two control points and where it ends.
function pieces(path: string) {
  const [start, ...rest] = path.slice(1).split(' C');
  let from = start.split(',').map(Number);
  return rest.map((piece) => {
    const [c1, c2, to] = piece.split(' ').map((xy) => xy.split(',').map(Number));
    const out = { from, c1, c2, to };
    from = to;
    return out;
  });
}

// The lead through a slot: kick-off at 1, then two goals a minute apart with big jumps (the
// near-corners a curve straight through the points made), a level stretch, and a goal late on.
const bunched: CurvePoint[] = [
  { x: 0, v: 0 },
  { x: 1, v: 1 },
  { x: 41, v: 7 },
  { x: 42, v: -1 },
  { x: 70, v: -1 },
  { x: 80, v: 5 },
  { x: 90, v: 4 },
];

describe('the momentum card’s curve', () => {
  it('starts at the first point and ends at the last, where the live dot is', () => {
    for (const points of [bunched, [...bunched.slice(0, -1), { x: 90, v: 2, ramp: true }]]) {
      const curve = smoothCurve(points);
      near(curve.at(0), 0);
      near(curve.at(90), points.at(-1)!.v);
      assert.match(curve.path, /^M0,0 C/);
      assert.ok(curve.path.endsWith(` 90,${points.at(-1)!.v}`), curve.path.slice(-30));
    }
  });

  it('keeps exactly level where nothing changes', () => {
    const value = smoothed(bunched);
    // From the second goal until the late one starts to rise.
    for (let x = 42; x <= 80 - RISE; x += 0.5) assert.equal(value(x), -1);
    // Drawn as one flat piece.
    const flat = pieces(smoothCurve(bunched).path).filter((p) => p.from[1] === p.to[1] && p.from[1] === -1);
    assert.ok(flat.some((p) => p.to[0] - p.from[0] >= 20 && p.c1[1] === -1 && p.c2[1] === -1));
    // Nothing happening at all is a straight line.
    assert.equal(
      smoothCurve([
        { x: 0, v: 3 },
        { x: 90, v: 3 },
      ]).path,
      'M0,3 C30,3 60,3 90,3',
    );
  });

  it('rises to a moment over the minutes before it, and has got there at the moment', () => {
    const value = smoothed(bunched);
    assert.equal(value(70 + 0.01), -1);
    assert.equal(value(80 - RISE), -1);
    near(value(80 - RISE / 2), (-1 + 5) / 2, 1e-6); // half-way, RISE / 2 before it
    assert.ok(value(80 - RISE / 2 - SPREAD) < 0.7 && value(80 - RISE / 2 + SPREAD) > 3.3);
    assert.equal(value(80), 5);
    assert.equal(value(90 - RISE), 5); // the last point's fall starts
  });

  it('brings a point that comes in evenly in along a straight line, its corners rounded', () => {
    const points: CurvePoint[] = [
      { x: 0, v: 0 },
      { x: 90, v: 9, ramp: true },
      { x: 180, v: 9, ramp: true },
    ];
    const value = smoothed(points);
    near(value(45), 4.5);
    near(value(135), 9);
    assert.ok(value(90) < 9 && value(90) > 8.8);
  });

  it('has no corners: each piece leaves where the last arrived, at the same slope, and bends gently', () => {
    const all = pieces(smoothCurve(bunched).path);
    const slope = ([x0, y0]: number[], [x1, y1]: number[]) => (y1 - y0) / (x1 - x0);
    for (let i = 1; i < all.length; i++) {
      assert.deepEqual(all[i].from, all[i - 1].to);
      near(slope(all[i - 1].c2, all[i - 1].to), slope(all[i].from, all[i].c1), 0.05);
    }
    // How sharply it turns, minute by minute: about what a Gaussian makes of the jumps (0.8),
    // a tenth of the monotone curve's straight through the points (8).
    const curve = smoothCurve(bunched);
    let sharpest = 0;
    for (let x = 1; x < 89; x += 0.25) sharpest = Math.max(sharpest, Math.abs(curve.at(x + 1) - 2 * curve.at(x) + curve.at(x - 1)));
    assert.ok(sharpest < 1, `${sharpest}`);
  });

  it('is drawn through samples GRID minutes apart, a level stretch through its ends alone', () => {
    const xs = pieces(smoothCurve(bunched).path).map((p) => p.to[0]);
    assert.ok(xs.every((x, i) => x === 90 || x % GRID === 0 || i === xs.length - 1));
    assert.ok(xs.length < 90 / GRID);
  });

  it('is a dot for a single point', () => {
    const curve = smoothCurve([{ x: 0, v: 50 }]);
    assert.equal(curve.path, 'M0,50.00');
    assert.equal(curve.at(10), 50);
  });
});
