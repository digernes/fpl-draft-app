import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AS_SCORED, expectedPoints, packAsScored, packUnderlying, scoredIn, underlyingOf } from '../src/shared/underlying.ts';

// FPL's scoring, as the Draft bootstrap has it (the positions these tests need).
const rules = {
  long_play_limit: 60,
  short_play: 1,
  long_play: 2,
  concede_limit: 2,
  assists: 3,
  goals_scored_DEF: 6,
  goals_scored_MID: 5,
  clean_sheets_DEF: 4,
  clean_sheets_MID: 1,
  goals_conceded_DEF: -1,
  goals_conceded_MID: 0,
  defensive_contribution_limit_DEF: 10,
  defensive_contribution_limit_MID: 12,
  defensive_contribution_DEF: 2,
  defensive_contribution_MID: 2,
  saves_limit: 3,
  saves: 1,
  penalties_saved: 5,
  penalties_missed: -2,
  yellow_cards: -1,
  red_cards: -3,
  own_goals: -2,
  bonus: 1,
};

// A defender's 90 minutes: a goal, a clean sheet, a defensive contribution and the 3 bonus.
const stats = { minutes: 90, total_points: 17, expected_goals: 0.3, expected_assists: 0.1, expected_goals_conceded: 0.5 };
const scored = { minutes: 2, goals_scored: 6, clean_sheets: 4, defensive_contribution: 2, bonus: 3 };
const part = (parts: number[] | undefined, name: (typeof AS_SCORED)[number]) => parts?.[AS_SCORED.indexOf(name)];

describe('underlyingOf', () => {
  it('swaps the goal and the clean sheet for what was expected, and keeps the rest as scored', () => {
    const u = underlyingOf(stats, rules, 'DEF', 1, scored);
    assert.equal(part(u.asScored, 'playing'), 2);
    assert.equal(part(u.asScored, 'defcon'), 2);
    assert.equal(part(u.asScored, 'bonus'), 3);
    const worth = expectedPoints({ xg: 0.3, xa: 0.1, xcs: Math.exp(-0.5), xgc: 0.5 }, rules, 'DEF');
    assert.deepEqual(
      Object.values(worth).map((x) => x.toFixed(3)),
      ['1.800', '0.300', '2.426', '-0.250'],
    );
    assert.equal(u.xp.toFixed(3), (7 + 1.8 + 0.3 + 4 * Math.exp(-0.5) - 0.25).toFixed(3));
  });

  it('puts the points it has no part for in other, so that the parts add up to his', () => {
    const u = underlyingOf({ ...stats, total_points: 19 }, rules, 'DEF', 1, { ...scored, a_new_stat: 1 });
    assert.equal(part(u.asScored, 'other'), 2); // the new stat's point, and one the stats don't explain
  });

  it('keeps no clean sheet for a position where one doesn’t score', () => {
    const u = underlyingOf(stats, { ...rules, clean_sheets_FWD: 0, goals_scored_FWD: 4 }, 'FWD', 1, { minutes: 2, goals_scored: 4 });
    assert.equal(u.xcs, undefined);
    assert.equal(packUnderlying(u)?.length, 3);
  });
});

describe('packAsScored', () => {
  it('leaves out the noughts at the end', () => {
    assert.deepEqual(packAsScored(underlyingOf(stats, rules, 'DEF', 1, scored)), [2, 0, 2, 0, 3]);
  });

  it('has none for one who didn’t get on the pitch, as packUnderlying', () => {
    const u = underlyingOf({ ...stats, minutes: 0, total_points: 0 }, rules, 'DEF', 1, { minutes: 0 });
    assert.equal(packUnderlying(u), undefined);
    assert.equal(packAsScored(u), undefined);
  });
});

describe('scoredIn', () => {
  const of = (values: Record<string, number>) => (name: string) => values[name] ?? 0;

  it('scores a match as FPL does', () => {
    const points = scoredIn(
      of({ goals_scored: 1, goals_conceded: 3, defensive_contribution: 11, yellow_cards: 1, bonus: 2 }),
      90,
      rules,
      'DEF',
    );
    const scoring = Object.fromEntries(Object.entries(points).filter(([, x]) => x !== 0));
    assert.deepEqual(scoring, { minutes: 2, goals_scored: 6, goals_conceded: -1, defensive_contribution: 2, yellow_cards: -1, bonus: 2 }); // one conceded for each two
  });

  it('needs the hour for the second appearance point, and each position its own defensive contributions', () => {
    const points = scoredIn(of({ defensive_contribution: 11 }), 59, rules, 'MID');
    assert.equal(points.minutes, 1);
    assert.equal(points.defensive_contribution, 0); // a midfielder needs 12
  });
});
