import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PL_STATS, type Position, type XpParts } from '../src/shared/data.ts';
import {
  liveProjection,
  OWN_GOAL_RATE,
  PLAYER_FLOOR,
  playerOutlook,
  playerProjection,
  rareDrops,
  RED_CARD_RATE,
  stillToPlay,
  YELLOW_CARD_RATE,
  type Expected,
  type ToCome,
} from '../src/shared/live-projection.ts';
import { pointsOf, provisionalBonus, type SlimFixture, type SlimLive } from '../src/shared/live.ts';
import { finalChances, jumpsMean, liveOdds, type Jump } from '../src/shared/odds.ts';

// What a live projection has still to come of a player's points, taken apart: it adds up to
// the projection less his points so far (and his bonus as it stands), whatever the state of
// his match, and the projection itself is the same as before it was taken apart.

// A defender expected to play 81 minutes (and to play at all 95% of the time) for 4.9
// points: 1.9 for playing, 1.6 for a clean sheet, 0.6 bonus and 0.8 from the rest.
const defender: XpParts = [81, 1.9, 0.4, 0, 0.3, 1.6, -0.4, 0.6, 0, 0.6, -0.1];
const asExpected: Expected = { points: () => 4.9, parts: () => defender, cleanSheet: { DEF: 4 } };
const rules = { defensive_contribution_limit_DEF: 10, defensive_contribution_DEF: 2 };
const info = (id: number) => ({ pos: (id === 8 ? 'MID' : 'DEF') as Position, club: id === 70 ? 7 : 9 });
const stillToScoreAt = (minute: number) => (1 - minute / 90) * (1 + minute / 90 / 4); // the share of a match's goals still to come
const lastHalfHour = 7 / 18; // with half an hour left

const match = (min: number, more: Partial<SlimFixture> = {}): SlimFixture => ({
  id: 1,
  h: 9,
  a: 10,
  started: min > 0,
  done: false,
  min,
  score: [0, 0],
  ...more,
});
const at = (min: number, played: number, pts: number, more: Partial<SlimFixture> = {}): SlimLive => ({
  elements: played ? { 9: [pts, played] } : {},
  fixtures: [match(min, more)],
});

const total = (toCome: ToCome) => Object.values(toCome).reduce((t, x) => t + x, 0);
const near = (a: number | undefined, b: number, tolerance = 1e-9) => assert.ok(Math.abs((a ?? 0) - b) < tolerance, `${a} ≠ ${b}`);

// His outlook, checked to add up to what's still to come: the projection less his points and bonus as they stand.
function outlook(feed: SlimLive, expected = asExpected, id = 9) {
  const o = playerOutlook(id, feed, info, expected);
  near(total(o.toCome), o.projected - pointsOf(feed, id) - (provisionalBonus(feed.fixtures).get(id) ?? 0));
  assert.equal(o.projected, playerProjection(id, feed, info, expected));
  return o;
}

describe('what a live projection has still to come', () => {
  it('takes apart one on the pitch: the rate a minute by his parts, the hour, the clean sheet kept and the bonus race', () => {
    // 60 minutes into a goalless match with 6 points and 3 provisional bonus, alone in the BPS race.
    const { toCome } = outlook(at(60, 60, 6, { bps: [[9, 30]] }));
    const onFor = 90 * lastHalfHour * (81 / 0.95 / 90);
    // Each part of his rate a minute at its own, as they add up to it (0.8).
    near(toCome.goals_scored, (0.4 / 81) * onFor);
    near(toCome.assists, (0.3 / 81) * onFor);
    near(toCome.goals_conceded, (-0.4 / 81) * onFor);
    near(toCome.defensive_contribution, (0.6 / 81) * onFor);
    near(toCome.cards, (-0.1 / 81) * onFor);
    assert.equal(toCome.penalties, undefined); // none expected, so none to come
    // Nothing more for playing; the 4 for the clean sheet in his points, kept with this chance.
    near(toCome.minutes, 0);
    near(toCome.clean_sheets, 4 * ((1.6 / 4 / 0.95) ** lastHalfHour - 1));
    near(toCome.bonus, lastHalfHour * (0.6 / 0.95 - 6 / 22));
  });

  it('counts the point at the hour and a clean sheet still to get before 60 minutes', () => {
    const { toCome } = outlook(at(30, 30, 1));
    near(toCome.minutes, 1); // a regular, sure of the hour once he plays
    assert.ok(toCome.clean_sheets! > 0);
    // Once his club concedes, no clean sheet to come, and the parts still add up.
    assert.equal(outlook(at(30, 30, 1, { score: [0, 1] })).toCome.clean_sheets, 0);
  });

  it('gives the point for playing that the feed hasn’t given him yet', () => {
    const { toCome } = outlook(at(2, 0, 0), { ...asExpected, named: () => 'xi' });
    assert.ok(toCome.minutes! > 1.5, `${toCome.minutes}`);
  });

  it('counts the defensive contribution from those he has made, apart from the rate a minute', () => {
    const cells = (made: number) => PL_STATS.map((s) => (s === 'defensive_contribution' ? made : 0));
    const expected = { ...asExpected, named: () => 'xi' as const, rules, stats: () => ({ 9: cells(9) }) };
    const { toCome } = outlook(at(45, 45, 1), expected);
    assert.ok(toCome.defensive_contribution! > 1.9 && toCome.defensive_contribution! < 2); // 9 of 10 at half-time
    // Reached: nothing more, and the rest of his rate as before.
    const reached = outlook(at(45, 45, 3), { ...expected, stats: () => ({ 9: cells(10) }) }).toCome;
    assert.equal(reached.defensive_contribution, 0);
    near(reached.goals_scored, toCome.goals_scored!);
  });

  it('takes apart his expected points before kick-off, a named starter’s as a starter’s', () => {
    // Until the teams are out, his parts as they are: they add up to his 4.9.
    const { toCome } = outlook(at(0, 0, 0));
    for (const [key, i] of [
      ['minutes', 1],
      ['goals_scored', 2],
      ['assists', 4],
      ['clean_sheets', 5],
      ['goals_conceded', 6],
      ['defensive_contribution', 7],
      ['bonus', 9],
      ['cards', 10],
    ] as const)
      near(toCome[key], defender[i]);
    // Named to start, he plays for sure: 1 + 0.86 at least for playing, and more of the rest.
    const starter = outlook(at(0, 0, 0), { ...asExpected, named: () => 'xi' }).toCome;
    assert.ok(starter.minutes! > 1.86 - 1e-9);
    assert.ok(starter.goals_scored! > 0.4 / 0.95 - 1e-9);
  });

  it('shares out what the parts don’t account for by their size, none changing sign', () => {
    // His expected points in tenths, the parts in hundredths: 5.0 against parts adding up to 4.9.
    const { toCome } = outlook(at(0, 0, 0), { ...asExpected, points: () => 5 });
    near(total(toCome), 5);
    near(toCome.minutes, 1.9 + (0.1 * 1.9) / 5.9); // 5.9 of them, whichever way they go
    assert.ok(toCome.goals_conceded! < 0 && toCome.cards! < 0);
    // Parts of nothing: all of it as other.
    assert.deepEqual(outlook(at(0, 0, 0), { ...asExpected, points: () => 2, parts: () => [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }).toCome, {
      other: 2,
    });
    assert.deepEqual(outlook(at(0, 0, 0), { ...asExpected, points: () => 0, parts: () => [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }).toCome, {});
  });

  it('has FPL’s expected points, which come whole, as one', () => {
    const fpl = { points: () => 6 };
    assert.deepEqual(outlook(at(0, 0, 0), fpl).toCome, { expected: 6 });
    near(outlook(at(60, 60, 2), fpl).toCome.expected, 6 * lastHalfHour);
  });

  it('gives one off the pitch his chance of coming on, and one left out nothing', () => {
    // An hour in without him: any substitute comes on two times in three, for 1.3 points.
    assert.deepEqual(Object.keys(outlook(at(60, 0, 0)).toCome), ['coming_on']);
    near(outlook(at(60, 0, 0)).toCome.coming_on, 0.65 * 1.3);
    near(outlook(at(75, 0, 0)).toCome.coming_on, 0.65 * 1.3 * 0.5 ** 0.7);
    // Before kick-off, on his club's bench: a defender two times in five.
    near(outlook(at(0, 0, 0), { ...asExpected, named: () => 'bench' }).toCome.coming_on, 0.4 * 1.3);
    assert.deepEqual(outlook(at(0, 0, 0), { ...asExpected, named: () => 'out' }).toCome, {});
    assert.deepEqual(outlook(at(60, 0, 0), { ...asExpected, named: () => 'out' }).toCome, {});
  });

  it('leaves one gone off only the bonus the race can still take from him', () => {
    const race: [number, number][] = [
      [9, 30],
      [5, 28],
      [6, 27],
      [7, 26],
    ];
    const { toCome } = outlook(at(70, 65, 9, { bps: race, off: [[9, 65]] }));
    assert.deepEqual(Object.keys(toCome), ['bonus']);
    assert.ok(toCome.bonus! < 0 && toCome.bonus! > -1);
    // Without a race, nothing.
    assert.deepEqual(outlook(at(70, 65, 6, { off: [[9, 65]] })).toCome, { bonus: 0 });
  });

  it('adds up a double gameweek’s two matches, and has nothing for a blank or a match over', () => {
    // Club 7's first match is over; half his expected points are still to come in the second.
    const feed: SlimLive = {
      elements: { 70: [6, 90] },
      fixtures: [
        { id: 4, h: 7, a: 8, started: true, done: true },
        { id: 5, h: 11, a: 7, started: false, done: false },
      ],
    };
    const { toCome } = outlook(feed, asExpected, 70);
    near(toCome.minutes, 1.9 / 2);
    near(total(toCome), 4.9 / 2);
    assert.deepEqual(outlook({ elements: {}, fixtures: [] }).toCome, {});
    assert.deepEqual(outlook({ elements: { 9: [8, 90] }, fixtures: [{ ...match(90), done: true }] }).toCome, {});
  });

  // As the projection had it before it was taken apart, to the last bit.
  it('leaves the projection exactly as it was', () => {
    const named = { ...asExpected, named: () => 'xi' as const, rules };
    const cells = PL_STATS.map((s) => (s === 'defensive_contribution' ? 6 : 0));
    assert.equal(playerProjection(9, at(60, 60, 6, { bps: [[9, 30]] }), info, asExpected), EXACT.onThePitch);
    assert.equal(playerProjection(9, at(30, 30, 1), info, named), EXACT.beforeTheHour);
    assert.equal(playerProjection(9, at(45, 45, 1), info, { ...named, stats: () => ({ 9: cells }) }), EXACT.defcons);
    assert.equal(playerProjection(9, at(0, 0, 0), info, named), EXACT.starter);
    assert.equal(playerProjection(9, at(75, 0, 0), info, asExpected), EXACT.fromTheBench);
    const lineup = { xi: [9, 8], bench: [], subs: [], off: [], pts: 7, points: (id: number) => (id === 9 ? 6 : 1) };
    const both: SlimLive = { elements: { 9: [6, 60], 8: [1, 60] }, fixtures: [match(60, { bps: [[9, 30]] })] };
    const { mean, variance } = liveProjection(lineup, both, info, named);
    assert.equal(mean, EXACT.lineup.mean);
    assert.equal(variance, EXACT.lineup.variance);
  });
});

// From the projection before it was taken apart.
const EXACT = {
  onThePitch: 8.324422660065183,
  beforeTheHour: 5.205971980532997,
  defcons: 6.11516347574359,
  starter: 5.157894736842106,
  fromTheBench: 0.5201585146382272,
  lineup: { mean: 7.064188741936529, variance: 16.99873460480029 },
};

// What a lineup will almost surely still have, for the live odds: its points so far, each of its
// XI keeping what he has, and below that its drops, each a chance of losing points at once.
describe('the live projection’s floor and drops', () => {
  const lone = (pts: number, id = 9) => ({ xi: [id], bench: [], subs: [], off: [], pts, points: () => pts });
  const projectOne = (feed: SlimLive, expected: Expected = asExpected, pts = 0, id = 9) =>
    liveProjection(lone(pts, id), feed, info, expected);
  const floorOf = (...args: Parameters<typeof projectOne>) => projectOne(...args).floor;
  const jumpsOf = (...args: Parameters<typeof projectOne>) => projectOne(...args).jumps;
  const named = (who: 'xi' | 'bench' | 'out') => ({ ...asExpected, named: () => who });
  // His cards and an own goal for `share` of a full match, as rareDrops has them.
  const cards = (share: number, yellow: number, red: number, own: number): Jump[] => [
    [...(yellow ? [{ points: yellow, chance: YELLOW_CARD_RATE * share }] : []), { points: red, chance: RED_CARD_RATE * share }],
    [{ points: own, chance: OWN_GOAL_RATE * share }],
  ];
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-12, `${a} ≠ ${b}`);
  const sameJumps = (a: Jump[], b: Jump[]) => {
    assert.equal(a.length, b.length);
    a.forEach((jump, i) => {
      assert.deepEqual(
        jump.map((o) => o.points),
        b[i].map((o) => o.points),
      );
      jump.forEach((o, k) => near(o.chance, b[i][k].chance));
    });
  };

  it('has the rates of this season’s cards and own goals, and what they cost by FPL’s rules', () => {
    assert.equal(PLAYER_FLOOR, 0);
    assert.deepEqual([YELLOW_CARD_RATE, RED_CARD_RATE, OWN_GOAL_RATE], [0.178, 0.008, 0.006]);
    sameJumps(rareDrops(1), cards(1, -1, -3, -2));
    sameJumps(rareDrops(0.5), cards(0.5, -1, -3, -2));
    // One booked can only be sent off, and gets his yellow's point back for it; one yet to play has his point for playing with any of them.
    sameJumps(rareDrops(1, {}, 'booked'), cards(1, 0, -2, -2));
    sameJumps(rareDrops(1, {}, 'yet to play'), cards(1, 0, -2, -1));
    sameJumps(rareDrops(1, { red_cards: -4, yellow_cards: -2, own_goals: -3, short_play: 1 }), cards(1, -2, -4, -3));
    assert.deepEqual(rareDrops(0), []);
    assert.deepEqual(stillToPlay(0.5, {}, 'booked'), { floor: 0, jumps: rareDrops(0.5, {}, 'booked') });
  });

  it('is nothing for one yet to play, with his drops net of the point for playing they come with', () => {
    for (const expected of [asExpected, named('xi'), named('bench'), named('out'), { points: () => 6 }])
      assert.equal(floorOf(at(0, 0, 0), expected), 0);
    sameJumps(jumpsOf(at(0, 0, 0), named('xi')), cards(1, 0, -2, -1));
    sameJumps(jumpsOf(at(0, 0, 0)), cards(1, 0, -2, -1));
    // A named substitute by his chance of coming on (a defender's 40%), and none for one left out.
    sameJumps(jumpsOf(at(0, 0, 0), named('bench')), cards(0.4, 0, -2, -1));
    assert.deepEqual(jumpsOf(at(0, 0, 0), named('out')), []);
  });

  it('keeps what one on the pitch has, his cards and own goal for the time left, and his clean sheet at stake as a drop of its own', () => {
    // Half an hour in, 1 point so far.
    assert.equal(floorOf(at(30, 30, 1), asExpected, 1), 1);
    sameJumps(jumpsOf(at(30, 30, 1), asExpected, 1).slice(0, 2), cards(stillToScoreAt(30), -1, -3, -2));
    // An hour in, goalless, 9 points with the 4 for the clean sheet and 3 bonus in: a goal against costs both.
    const feed = at(60, 60, 6, { bps: [[9, 30]] });
    assert.equal(floorOf(feed, asExpected, 9), 9);
    const [cardsOf, own, stake] = jumpsOf(feed, asExpected, 9);
    sameJumps([cardsOf, own], cards(lastHalfHour, -1, -3, -2));
    assert.equal(stake.length, 1);
    assert.equal(stake[0].points, -4 - 3);
    assert.ok(stake[0].chance > 0.05 && stake[0].chance < 0.5, `${stake[0].chance}`);
    // Once a goal has gone in, no clean sheet to lose.
    assert.equal(jumpsOf(at(60, 60, 6, { bps: [[9, 30]], score: [0, 1] }), asExpected, 9).length, 2);
    // The point for playing the feed hasn't given him yet comes with any of them.
    sameJumps(jumpsOf(at(2, 0, 0), named('xi')).slice(0, 2), cards(stillToScoreAt(2), 0, -2, -1));
    // FPL's expected points, which come whole: the same.
    assert.equal(floorOf(feed, { points: () => 6, cleanSheet: { DEF: 4 } }, 9), 9);
  });

  it('takes the yellow card he already has into his red, with the rules’ cards', () => {
    const booked: SlimLive = { ...at(60, 60, 5), events: { 9: { yellow: 1 } } };
    sameJumps(jumpsOf(booked, asExpected, 5).slice(0, 2), cards(lastHalfHour, 0, -2, -2));
    // The match's stats say so first, when they have him.
    const yellow = PL_STATS.map((s) => (s === 'yellow_cards' ? 1 : 0));
    sameJumps(jumpsOf(at(60, 60, 5), { ...asExpected, stats: () => ({ 9: yellow }) }, 5).slice(0, 2), cards(lastHalfHour, 0, -2, -2));
    const rules = { red_cards: -2, yellow_cards: -1, own_goals: -2 };
    sameJumps(jumpsOf(at(60, 60, 5), { ...asExpected, rules }, 5).slice(0, 2), cards(lastHalfHour, -1, -2, -2));
  });

  it('has nothing more to lose for one gone off but the bonus others are likely to overtake, and none for one done', () => {
    const race: [number, number][] = [
      [9, 30],
      [5, 28],
    ];
    const gone = projectOne(at(70, 65, 6, { bps: race, off: [[9, 65]] }), asExpected, 9);
    assert.ok(gone.mean < 9 && gone.floor === gone.mean, `${gone.mean} ${gone.floor}`);
    assert.deepEqual(gone.jumps, []);
    assert.equal(floorOf(at(70, 65, 6, { off: [[9, 65]] }), asExpected, 6), 6);
    assert.equal(floorOf({ elements: { 9: [8, 90] }, fixtures: [{ ...match(90), done: true }] }, asExpected, 8), 8);
    assert.deepEqual(jumpsOf({ elements: {}, fixtures: [] }, asExpected, 0), []); // a blank
  });

  it('gives one off the pitch with his match on the drops of coming on, until it’s too late to', () => {
    assert.equal(floorOf(at(60, 0, 0)), 0);
    // Half an hour left: his chance of coming on as before it (65%), for what's left.
    sameJumps(jumpsOf(at(60, 0, 0)), cards((0.65 * 30) / 90, 0, -2, -1));
    assert.deepEqual(jumpsOf(at(60, 0, 0), named('out')), []);
    assert.deepEqual(jumpsOf(at(95, 0, 0)), []);
  });

  it('adds up a double gameweek’s two matches', () => {
    const feed: SlimLive = {
      elements: {},
      fixtures: [
        { id: 4, h: 7, a: 8, started: false, done: false },
        { id: 5, h: 11, a: 7, started: false, done: false },
      ],
    };
    assert.equal(floorOf(feed, asExpected, 0, 70), 0);
    sameJumps(jumpsOf(feed, asExpected, 0, 70), [...cards(1, 0, -2, -1), ...cards(1, 0, -2, -1)]);
  });

  describe('with the bench', () => {
    // 1 and 4 start (club 9, still to play); on the bench 2 (club 7, done with 5 points) or 3 (club 9, still to play).
    const clubs: Record<number, number> = { 1: 9, 2: 7, 3: 9, 4: 9 };
    const statuses = (one?: string, four?: string) => (id: number) => ({
      pos: 'DEF' as const,
      club: clubs[id],
      status: id === 1 ? one : id === 4 ? four : 'a',
    });
    const free = { DEF: 0, MID: 0, FWD: 0 };
    const feed: SlimLive = { elements: { 2: [5, 90] }, fixtures: [match(0), { id: 4, h: 7, a: 8, started: true, done: true }] };
    const lineup = (xi: number[], bench: number[]) => ({
      xi,
      bench,
      subs: [],
      off: [],
      pts: 10,
      points: (id: number) => (id === 2 ? 5 : 0),
    });
    const project = (xi: number[], bench: number[], one?: string, four?: string) =>
      liveProjection(lineup(xi, bench), feed, statuses(one, four), asExpected, free);

    it('has the bench player’s points and drops in place of a starter sure not to play', () => {
      assert.equal(project([1], [2], 'i').floor, 10 + 5);
      assert.deepEqual(project([1], [2], 'i').jumps, []);
      assert.equal(project([1], [3], 'i').floor, 10);
      sameJumps(project([1], [3], 'i').jumps, cards(1, 0, -2, -1));
      assert.equal(project([1], [], 'i').floor, 10); // nobody to come on
    });

    it('takes the worse of a doubtful starter playing and his bench player coming on, his drops by the chance he’s needed', () => {
      assert.equal(project([1], [2], 'd').floor, 10);
      assert.equal(project([1], [3], 'd').floor, 10);
      assert.equal(project([4, 1], [2], 'i', 'd').floor, 10);
      assert.equal(project([4, 1], [2], 'd', 'd').floor, 10);
      // The starter's in full, and the bench player's by the chance he doesn't play.
      const [starter, own, sub, subOwn] = project([1], [3], 'd').jumps;
      sameJumps([starter, own], cards(1, 0, -2, -1));
      const needed = sub[0].chance / RED_CARD_RATE;
      assert.ok(needed > 0 && needed < 0.1, `${needed}`);
      sameJumps([sub, subOwn], cards(needed, 0, -2, -1));
    });

    it('never puts the floor above the mean less the drops', () => {
      for (const one of ['a', 'd', 'i', undefined])
        for (const xi of [[1], [4, 1]]) {
          const p = project(xi, [2], one, 'd');
          assert.ok(p.floor <= p.mean - jumpsMean(p.jumps), `${one} ${xi.join()}`);
        }
    });
  });

  // GW 8: Le Fée (named to start) and Brobbey (on the bench) at Sunderland, the rest done.
  const lefee: XpParts = [84.16, 1.93, 1.03, 0.3, 0.76, 0.25, 0, 0.26, 0, 0.43, -0.13];
  const brobbey: XpParts = [35.63, 0.85, 0.63, 0, 0.09, 0, 0, 0.01, 0, 0.21, -0.09];
  const sunderland = (id: number) => ({ pos: (id === 1 ? 'MID' : 'FWD') as Position, club: 20 });
  const brageXp: Expected = {
    points: (id) => (id === 1 ? 4.8 : 1.7),
    parts: (id) => (id === 1 ? lefee : brobbey),
    cleanSheet: { MID: 1 },
    named: (id) => (id === 1 ? 'xi' : 'bench'),
  };
  const brageOn = (pts: number, feed: SlimLive, expected = brageXp) =>
    liveProjection({ xi: [1, 2], bench: [], subs: [], off: [], pts, points: () => 0 }, feed, sunderland, expected);
  const curt = { mean: 39, variance: 0, floor: 39 };

  it('gives Curt, all done on 39, almost no chance against Brage on 40 with two attackers still to kick off', () => {
    const brage = brageOn(40, { elements: {}, fixtures: [{ id: 80, h: 20, a: 13, started: false, done: false }] });
    assert.equal(brage.floor, 40);
    // Curt wins only should Le Fée be sent off with nothing else for either, and draws only should Brage lose 1 more.
    const [win, draw, lose] = finalChances(curt, brage);
    assert.ok(win < 2e-4 && draw < 2e-3 && lose > 0.998, `${win} ${draw} ${lose}`);
    // The normal had him at 1/32 and the draw at 1/48.
    const normal = liveOdds(curt, { mean: brage.mean, variance: brage.variance }, 1.05);
    assert.ok(normal.p[0] > 0.025 && normal.p[1] > 0.015, `${normal.p}`);
  });

  it('gives Curt next to none once Le Fée is on the pitch with his point in and Brage on 43', () => {
    for (const min of [1, 30, 55])
      for (const expected of [brageXp, { points: (id: number) => (id === 1 ? 2 : 0), named: brageXp.named, cleanSheet: { MID: 1 } }]) {
        const feed: SlimLive = {
          elements: { 1: [1, min] },
          fixtures: [{ id: 80, h: 20, a: 13, started: true, done: false, min, score: [0, 0] }],
        };
        const brage = brageOn(43, feed, expected);
        assert.equal(brage.floor, 43);
        // A draw needs Brage to lose 4: a red card and an own goal, or the like.
        const [win, draw] = finalChances(curt, brage);
        assert.ok(win < 1e-4 && draw < 1e-4, `${min}' ${win} ${draw}`);
        assert.deepEqual(liveOdds(curt, brage, 1.05).prices[0], { dec: 5000, frac: '5000/1' });
      }
  });
});
