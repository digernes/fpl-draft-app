import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Lineup, PlMatch } from '../src/shared/data.ts';
import { rareDrops } from '../src/shared/live-projection.ts';
import { liveOdds, type Heading } from '../src/shared/odds.ts';
import type { Step } from '../src/app/momentum.ts';
import { chanceAfter, chanceAt, headingAfter, headingAt, playingTime, type Outlook } from '../src/app/win-chance.ts';

// Club 1 plays twice (matches 1 and 3), as does club 4 (2 and 3).
const round = [
  { id: 1, gw: 5, home: 1, away: 2, ko: null },
  { id: 2, gw: 5, home: 3, away: 4, ko: null },
  { id: 3, gw: 5, home: 1, away: 4, ko: null },
] as PlMatch[];
const clubs: Record<number, number> = { 10: 1, 11: 3, 20: 2, 21: 4, 22: 3, 23: 2, 24: 5 };
const lineup = (xi: number[], subs: number[] = [], off: number[] = []): Lineup =>
  ({ pts: 0, adj: 0, dgw: 0, benchPts: 0, xi, bench: off, subs, off, xpf: 0 }) as Lineup;
const outlook = (home: Lineup, away: Lineup, expected: Record<number, number> = {}, points: Record<number, number> = {}): Outlook => ({
  round,
  lineups: [home, away],
  clubOf: (pid) => clubs[pid],
  expected: (pid) => expected[pid] ?? 5,
  points: (pid) => points[pid] ?? 0,
});
const step = (id: number | undefined, gained: [number, number]) =>
  ({ match: id === undefined ? undefined : round.find((pm) => pm.id === id), gained, score: gained, scorers: [] }) as Step;
// Where a side is heading: its score (its floor: each keeps what he has), its expected score,
// its spread in players' worth of a full gameweek, and the drops of each match its players
// have left: how much of it, and whether it has yet to start (when the point for playing comes
// with any of them).
const heading = (score: number, mean: number, players: number, matches: [number, boolean][] = []): Heading => ({
  mean,
  variance: players * 9,
  floor: score,
  jumps: matches.flatMap(([share, yet]) => rareDrops(share, undefined, yet ? 'yet to play' : undefined)),
});
const full: [number, boolean] = [1, true];
const odds = (home: Heading, away: Heading) => liveOdds(home, away, 1).p;

describe('chanceAfter', () => {
  const sides = outlook(lineup([10, 11]), lineup([20, 21]));

  it('starts from what each XI is expected to score, as the live odds would', () => {
    const p = chanceAfter([], sides);
    // 10 and 21 play twice, 11 and 20 once.
    assert.deepEqual(headingAfter([], sides), [heading(0, 10, 2, [full, full, full]), heading(0, 10, 2, [full, full, full])]);
    assert.deepEqual(p, odds(heading(0, 10, 2, [full, full, full]), heading(0, 10, 2, [full, full, full])));
    assert.equal(p[0], p[2]);
  });

  it('adds the score to the share of each player’s expected points still to come', () => {
    // After 3 v 4: player 11 is done, and 21 has half his double gameweek left.
    assert.deepEqual(
      chanceAfter([step(2, [8, 1])], sides),
      odds(heading(8, 8 + 5, 1, [full, full]), heading(1, 1 + 5 + 2.5, 1.5, [full, full])),
    );
    // In any order of the steps.
    const steps = [step(1, [3, 2]), step(2, [8, 1])];
    assert.deepEqual(chanceAfter(steps, sides), chanceAfter([...steps].reverse(), sides));
  });

  it('is the win, the draw or the defeat once nothing is left to play', () => {
    const all = (home: number, away: number) => [step(1, [home, away]), step(2, [0, 0]), step(3, [0, 0])];
    assert.deepEqual(chanceAfter(all(9, 4), sides), [1, 0, 0]);
    assert.deepEqual(chanceAfter(all(4, 4), sides), [0, 1, 0]);
    assert.deepEqual(chanceAfter(all(3, 4), sides), [0, 0, 1]);
    // A player whose club has no match adds nothing.
    assert.deepEqual(chanceAfter(all(9, 4), outlook(lineup([10]), lineup([24]))), [1, 0, 0]);
  });

  it('is certain once a side leads by more than the other can still gain and it can still lose', () => {
    // After 3 v 4: 11 is done, and 20 (club 2) is all the away side has left, 2 to lose at worst (a red card).
    const one = outlook(lineup([11]), lineup([20]));
    assert.deepEqual(chanceAfter([step(2, [3, 9])], one), [0, 0, 1]);
    assert.deepEqual(headingAfter([step(2, [3, 9])], one), [
      { mean: 3, variance: 0, floor: 3, jumps: [] },
      { mean: 14, variance: 9, floor: 9, jumps: rareDrops(1, undefined, 'yet to play') },
    ]);
    // Ahead by just what he can lose: a draw at worst, and far less than a 1 in 1,000 one with 5 points expected of him.
    assert.deepEqual(chanceAfter([step(2, [7, 9])], one), [0, 0, 1]);
    const [, draw] = liveOdds(...headingAfter([step(2, [7, 9])], one), 1).p;
    assert.equal(draw, 0);
    // Where the normal gave the other side a chance of winning outright.
    const [home, away] = headingAfter([step(2, [7, 9])], one);
    assert.ok(liveOdds({ mean: home.mean, variance: home.variance }, { mean: away.mean, variance: away.variance }, 1).p[0] > 0.005);
  });

  it('counts an automatic substitute as the starter he came on for until that starter’s match is over', () => {
    // 22 (club 3) came on for 23 (club 2), and scored 6.
    const subbed = outlook(lineup([10]), lineup([22], [22], [23]), { 10: 5, 22: 2, 23: 4 }, { 22: 6 });
    const starting = odds(heading(0, 5, 1, [full, full]), heading(0, 4, 1, [full]));
    assert.deepEqual(chanceAfter([], subbed), starting);
    assert.deepEqual(chanceAfter([step(2, [0, 0])], subbed), starting);
    // Then as himself: what he's expected to score, and once he has played, his points for sure.
    assert.deepEqual(chanceAfter([step(1, [0, 0])], subbed), odds(heading(0, 2.5, 0.5, [full]), heading(0, 2, 1, [full])));
    const after = odds(heading(0, 2.5, 0.5, [full]), heading(6, 6, 0));
    assert.deepEqual(chanceAfter([step(1, [0, 0]), step(2, [0, 0])], subbed), after);
    // Once the substitutions are in the score, not again.
    const all = [step(1, [0, 0]), step(2, [0, 0]), step(undefined, [0, 6])];
    assert.deepEqual(chanceAfter(all, subbed), after);
  });
});

describe('chanceAt', () => {
  const sides = outlook(lineup([10, 11]), lineup([20, 21]));
  const played =
    (shares: Record<number, number>) =>
    (pm: PlMatch): number =>
      shares[pm.id] ?? 0;

  it('is chanceAfter’s at the ends of matches', () => {
    assert.deepEqual(chanceAt([0, 0], played({}), sides), chanceAfter([], sides));
    assert.deepEqual(chanceAt([8, 1], played({ 2: 1 }), sides), chanceAfter([step(2, [8, 1])], sides));
    assert.deepEqual(chanceAt([9, 4], played({ 1: 1, 2: 1, 3: 1 }), sides), [1, 0, 0]);
  });

  it('takes what was left of a match being played by the minute', () => {
    // An hour into 3 v 4: player 11 has a third of his match left, 21 a third of one and all of the other.
    const third: [number, boolean] = [1 / 3, false];
    const expected = odds(
      heading(2, 2 + 5 + 5 / 3, 1 + 1 / 3, [full, full, third]),
      heading(2, 2 + 5 + 5 * (2 / 3), 1 + 2 / 3, [full, third, full]),
    );
    assert.deepEqual(chanceAt([2, 2], played({ 2: 2 / 3 }), sides), expected);
  });

  it('keeps what each player has, with his cards and an own goal as their own chances for what’s left of each match', () => {
    const at = (share: number) => headingAt([0, 0], played({ 1: share }), outlook(lineup([20]), lineup([])))[0];
    // Before kick-off his point for playing comes with any of them: a red card costs him 2, an own goal 1, a yellow nothing.
    assert.deepEqual(at(0).jumps, [[{ points: -2, chance: 0.008 }], [{ points: -1, chance: 0.006 }]]);
    // On the pitch, with it in: a yellow 1, a red 3 and an own goal 2, for the half left.
    assert.deepEqual(at(0.5).jumps, [
      [
        { points: -1, chance: 0.089 },
        { points: -3, chance: 0.004 },
      ],
      [{ points: -2, chance: 0.003 }],
    ]);
    assert.equal(at(0.5).floor, 0);
    // None once his match is over.
    assert.deepEqual(at(1), { mean: 0, variance: 0, floor: 0, jumps: [] });
  });

  it('moves with a goal at its minute, and the further on the more', () => {
    // 11 v 22, both in 3 v 4.
    const both = outlook(lineup([11]), lineup([22]));
    const at = (minute: number, score: [number, number]) => chanceAt(score, played({ 2: minute / 90 }), both)[0];
    const level = chanceAt([1, 1], played({ 2: 1 / 3 }), both);
    assert.equal(level[0], level[2]);
    assert.ok(at(30, [6, 1]) > at(30, [1, 1]));
    assert.ok(at(80, [6, 1]) > at(30, [6, 1]));
  });

  it('counts an automatic substitute as the starter he came on for until the substitutions are in', () => {
    // 22 (club 3) came on for 23 (club 2): halfway through 1 v 2, half the starter's 4 to come.
    const subbed = outlook(lineup([10]), lineup([22], [22], [23]), { 10: 5, 22: 2, 23: 4 }, { 22: 6 });
    const half: [number, boolean] = [0.5, false];
    assert.deepEqual(
      chanceAt([0, 0], played({ 1: 0.5 }), subbed),
      odds(heading(0, 5 * 0.75, 0.75, [half, full]), heading(0, 2, 0.5, [half])),
    );
    assert.deepEqual(chanceAt([0, 6], played({ 1: 1, 2: 1, 3: 1 }), subbed, true), [0, 0, 1]);
  });
});

describe('playingTime', () => {
  // A Saturday's 12:30 and 15:00 kick-offs, one still to be set, and Sunday's 14:00.
  const kickOffs = ['2026-08-29T12:30:00Z', '2026-08-29T15:00:00Z', null, '2026-08-30T14:00:00Z'];
  const after = (ko: string, minutes: number) => playingTime(Date.parse(ko) + minutes * 60_000, kickOffs);
  const [first, second, , sunday] = kickOffs as string[];

  it('has nothing before the first kick-off', () => {
    assert.equal(after(first, -90), undefined);
    assert.equal(after(first, 0), undefined);
  });

  it('counts the first half by the clock, into its stoppage time', () => {
    assert.deepEqual(after(first, 0.5), { slot: 0, minute: 0.5, phase: 'play' });
    assert.deepEqual(after(first, 30), { slot: 0, minute: 30, phase: 'play' });
    assert.deepEqual(after(first, 46), { slot: 0, minute: 45, phase: 'play' });
  });

  it('stays at 45 through half-time', () => {
    assert.deepEqual(after(first, 47), { slot: 0, minute: 45, phase: 'half-time' });
    assert.deepEqual(after(first, 61.5), { slot: 0, minute: 45, phase: 'half-time' });
  });

  it('takes the 17 minutes of stoppage time and half-time off the second half, up to 90', () => {
    assert.deepEqual(after(first, 62), { slot: 0, minute: 45, phase: 'play' });
    assert.deepEqual(after(first, 81), { slot: 0, minute: 64, phase: 'play' });
    assert.deepEqual(after(first, 110), { slot: 0, minute: 90, phase: 'play' }); // stoppage time
  });

  it('puts the time between slots at the end of the last played', () => {
    assert.deepEqual(after(first, 112), { slot: 0, minute: 90, phase: 'after' });
    assert.deepEqual(after(second, -1), { slot: 0, minute: 90, phase: 'after' });
    assert.deepEqual(after(second, 10), { slot: 1, minute: 10, phase: 'play' });
    // Overnight, past the slot whose kick-off isn't set.
    assert.deepEqual(after(sunday, -600), { slot: 1, minute: 90, phase: 'after' });
    assert.deepEqual(after(sunday, 5), { slot: 3, minute: 5, phase: 'play' });
    assert.deepEqual(after(sunday, 600), { slot: 3, minute: 90, phase: 'after' });
  });
});
