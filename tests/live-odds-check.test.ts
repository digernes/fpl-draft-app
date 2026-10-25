import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { calibration, playerChances, replay, report, scores, type State } from '../scripts/live-odds-check.ts';
import { bobVCy, statsFile } from './fixtures/match.ts';

// GW 2's head-to-head, Bob (Palmer, Haaland) v Cy (Salah, Watkins), 9 – 18: see bobVCy(). Its
// two kick-off slots, Chelsea v Liverpool and Man City v Arsenal, and everyone expected to score 5.
const onlyGw2 = (gw: number) => (gw === 2 ? () => 5 : null);
const state = (p: [number, number, number], outcome: 0 | 1 | 2): State => ({
  gw: 1,
  at: 'end',
  left: 1,
  normal: p,
  skewed: p,
  outcome,
  sides: [],
});

describe('the live odds’ replay', () => {
  it('rebuilds a head-to-head before its first kick-off and after each slot but the last', () => {
    const states = replay(bobVCy(), onlyGw2);
    assert.deepEqual(
      states.map((s) => [s.at, s.left, s.outcome]),
      [
        ['end', 4, 2],
        ['end', 1, 2], // only Palmer's Man City left
      ],
    );
    for (const s of states) {
      for (const p of [s.normal, s.skewed]) assert.ok(Math.abs(p[0] + p[1] + p[2] - 1) < 1e-9);
      // Each side's chance of the points it ended on, with as many players' worth as it had left.
      assert.deepEqual(
        s.sides.map((x) => x.left),
        s.at === 'end' && s.left === 4 ? [2, 2] : [1, 0],
      );
      for (const x of s.sides.filter((side) => side.left > 0)) assert.ok(x.normal > 0 && x.skewed > 0 && x.skewed < 1);
    }
    // 7 – 18 with only Haaland left for Bob: he needs a haul, likelier with the skew than the normal had it.
    const late = states[1];
    assert.ok(late.skewed[0] > late.normal[0] && late.skewed[0] < 0.05, `${late.skewed} ${late.normal}`);
  });

  it('replays within each slot too, from the points as they came in', () => {
    const within = replay(bobVCy(), onlyGw2, () => statsFile()).filter((s) => s.at === 'within');
    assert.ok(within.length >= 3);
    assert.ok(within.every((s) => s.left > 0 && s.left < 4));
  });

  it('skips a gameweek it has no expected points for', () => {
    assert.deepEqual(
      replay(bobVCy(), () => null),
      [],
    );
    assert.deepEqual(
      playerChances(bobVCy(), () => null),
      [],
    );
  });

  it('gives each of the XIs’ players his chance of the points he got', () => {
    const chances = playerChances(bobVCy(), onlyGw2);
    assert.equal(chances.length, 4);
    // Salah's 13 from an expected 5: likelier with the skew than with the normal.
    assert.ok(chances[2].skewed > chances[2].normal);
  });

  it('scores the chances by log loss and Brier score', () => {
    assert.deepEqual(scores([state([1, 0, 0], 0)], 'skewed'), { n: 1, log: 0, brier: 0 });
    const even = scores([state([0.5, 0, 0.5], 0), state([0.5, 0, 0.5], 2)], 'normal');
    assert.ok(Math.abs(even.log - Math.LN2) < 1e-12 && Math.abs(even.brier - 0.5) < 1e-12);
    // Held to 1 in 10,000 when it said never.
    assert.ok(Math.abs(scores([state([0, 0, 1], 0)], 'skewed').log - Math.log(1e4)) < 1e-9);
    assert.deepEqual(scores([], 'normal'), { n: 0, log: 0, brier: 0 });
  });

  it('bands every chance it gave for calibration', () => {
    const bands = calibration([state([0.7, 0.1, 0.2], 0), state([0.7, 0.1, 0.2], 2)], 'normal');
    const band = (p: number) => bands.find((b) => b.lo <= p && p < b.hi)!;
    assert.deepEqual([band(0.7).n, band(0.7).observed], [2, 0.5]);
    assert.deepEqual([band(0.1).n, band(0.1).predicted, band(0.1).observed], [2, 0.1, 0]);
    assert.deepEqual([band(0.2).n, band(0.2).observed], [2, 0.5]);
    assert.equal(
      bands.reduce((t, b) => t + b.n, 0),
      6,
    );
    assert.equal(bands.at(-1)!.hi, 1);
  });

  it('reports each score, the normal’s against the skewed, by how much was left to play', () => {
    const d = bobVCy();
    const lines = report(
      replay(d, onlyGw2, () => statsFile()),
      playerChances(d, onlyGw2),
    );
    assert.equal(lines[0], 'GW 2–2, the normal → the skewed final scores');
    const rows = (label: string) => lines.filter((l) => l.trimStart().startsWith(label));
    // The results at the slots' ends, then with the minutes within them; each side's points; the players'.
    assert.equal(rows('All ').length, 3);
    assert.match(rows('All ')[0], /n=2 +log loss \d\.\d{3} → \d\.\d{3} +Brier \d\.\d{3} → \d\.\d{3}$/);
    assert.match(rows('9 or more players left')[0], /n=0 /);
    assert.match(rows('The XIs’ players')[0], /n=4 +log loss \d\.\d{3} → \d\.\d{3}$/);
    // Both calibration tables, with only the bands it gave chances in.
    assert.equal(lines.filter((l) => l.startsWith('Calibration')).length, 2);
    assert.ok(lines.filter((l) => / – .*predicted/.test(l)).every((l) => !/n=0 /.test(l)));
  });
});
