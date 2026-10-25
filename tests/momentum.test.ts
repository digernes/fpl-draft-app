import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { happenings } from '../src/app/commentary.ts';
import { momentum, type Beat, type Step } from '../src/app/momentum.ts';
import type { Data, Lineup, PlMoment, PlStats } from '../src/shared/data.ts';
import type { SlimLive } from '../src/shared/live.ts';
import type { LiveRound } from '../src/app/match-lines.ts';
import { liveRound, liveStats } from './fixtures/auto-subs.ts';
import { lineup } from './fixtures/league.ts';
import { bobVCy, cells, RULES, statsFile } from './fixtures/match.ts';

// GW 2's head-to-head, Bob (Palmer, Haaland) v Cy (Salah, Watkins): see bobVCy().
const m = () => bobVCy().matches.find((x) => x.gw === 2)!;
const sides = (d: Data): [Lineup, Lineup] => [d.lineups[2][2], d.lineups[3][2]];
const beatsOf = (steps: Step[], id: number) => steps.find((s) => s.match?.id === id)?.beats;
// A beat as [its minute, each side's points from it, who did what].
const read = (beats: Beat[] | undefined) =>
  beats?.map((b) => [b.minute, b.gained, b.players.map(([pid, pts, , what]) => `${pid} ${what} ${pts}`).join(', ')]);
const sumOf = (beats: Beat[], side: 0 | 1) => beats.reduce((t, b) => t + b.gained[side], 0);

describe('the momentum’s beats', () => {
  it('has the points as they came in through a match, from its moments, in order', () => {
    const d = bobVCy();
    const steps = momentum(d, m(), sides(d), undefined, statsFile());
    assert.deepEqual(read(beatsOf(steps, 20)), [
      ['KO', [1, 2], '13 kickoff 1, 14 kickoff 1, 17 kickoff 1'],
      ['23’', [0, 5], '14 Goal 5'],
      ['41’', [5, 0], '13 Goal 5'],
      ['52’', [0, -1], '17 yellow -1'],
      ['60’', [1, 2], '13 hour 1, 14 hour 1, 17 hour 1'],
      ['67’', [0, 7], '17 Goal 4, 14 Assist 3'],
    ]);
    assert.deepEqual(
      beatsOf(steps, 20)!.map((b) => b.clock),
      [0, 23, 41, 52, 60, 67],
    );
  });

  it('leaves full time’s points (the bonus) to the match’s step, which ends on the real score', () => {
    const d = bobVCy();
    const steps = momentum(d, m(), sides(d), undefined, statsFile());
    const beats = beatsOf(steps, 20)!;
    assert.deepEqual(steps[0].gained, [7, 18]);
    assert.equal(sumOf(beats, 0), 7);
    assert.equal(sumOf(beats, 1), 15); // Salah's 3 bonus at full time
  });

  it('has no beats for a match whose moments aren’t known, nor without the stats file, the steps as they were', () => {
    const d = bobVCy();
    const steps = momentum(d, m(), sides(d), undefined, statsFile());
    assert.equal(beatsOf(steps, 21), undefined); // MCI v ARS: no moments
    const without = momentum(d, m(), sides(d));
    assert.ok(without.every((s) => !('beats' in s)));
    assert.deepEqual(
      steps.map(({ beats: _, ...s }) => s),
      without,
    );
  });

  it('counts a clean sheet from the hour, gone at the first goal against while he’s on, as FPL’s live scores do', () => {
    const d = bobVCy();
    d.meta.rules = { ...RULES, clean_sheets_MID: 1, clean_sheets_DEF: 4 };
    // Palmer's goal at 75 minutes, after Liverpool's hour without conceding.
    const stats = statsFile();
    stats.moments![20] = [
      [23, 1, 'goal', 14],
      [75, 2, 'goal', 13],
    ];
    const beats = beatsOf(momentum(d, m(), sides(d), undefined, stats), 20)!;
    assert.deepEqual(read(beats)!.slice(2), [
      ['60’', [1, 3], '13 hour 1, 14 hour 1, 14 Clean sheet 1, 17 hour 1'],
      ['75’', [5, -1], '13 Goal 5, 14 Clean sheet lost -1'],
    ]);
    // Chelsea had conceded by the hour: Palmer had none to keep.
    assert.ok(!read(beats)!.some(([, , who]) => (who as string).includes('13 Clean sheet')));
    // A goal by someone neither side has still takes it.
    stats.moments![20][1] = [75, 2, 'goal', 16];
    assert.deepEqual(read(beatsOf(momentum(d, m(), sides(d), undefined, stats), 20))!.at(-1), ['75’', [0, -1], '14 Clean sheet lost -1']);
  });

  it('doesn’t count a clean sheet kept to full time twice', () => {
    const d = bobVCy();
    d.meta.rules = { ...RULES, clean_sheets_MID: 1 };
    const stats = statsFile();
    stats.moments![20] = [[23, 1, 'goal', 14]];
    stats.matches[20][14] = cells({ goals_scored: 1, clean_sheets: 1, bonus: 3 });
    const salah = happenings(d, stats, m(), sides(d)).flatMap((e) =>
      e.players.filter((p) => p.pid === 14).map((p) => `${e.minute} ${p.what ?? e.kind} ${p.pts}`),
    );
    assert.deepEqual(salah, ['KO kickoff 1', '23’ Goal 5', '60’ hour 1', '60’ Clean sheet 1', 'FT Bonus 3', 'FT Other points 2']);
  });

  it('times an hour from coming on, with half-time between for one on in the first half', () => {
    const d = bobVCy();
    // Watkins came on for Isak after half an hour, and played the hour out.
    d.plMatches![0].lineups![1][1] = [17, 60, 5, 0];
    const stats = statsFile();
    stats.moments![20] = [[30, 1, 'sub', 17, 16]];
    const beats = beatsOf(momentum(d, m(), sides(d), undefined, stats), 20)!;
    assert.deepEqual(read(beats), [
      ['KO', [1, 1], '13 kickoff 1, 14 kickoff 1'],
      ['30’', [0, 1], '17 On 1'],
      ['60’', [1, 1], '13 hour 1, 14 hour 1'],
      ['90’', [0, 1], '17 hour 1'],
    ]);
    assert.equal(beats.at(-1)!.clock, 90);
  });

  it('brings an automatic substitute in when his substitution is made, once the gameweek is over too', () => {
    const d = bobVCy();
    // Isak came into Cy's XI for someone who wasn't in the squad: in at the kick-off, his points counting from there.
    const cy: Lineup = { ...lineup([14, 17, 16], [99]), subs: [16], off: [99] };
    const steps = momentum(d, m(), [d.lineups[2][2], cy], undefined, statsFile());
    assert.ok(
      steps.every((s) => s.match),
      'no step of their own at the end',
    );
    assert.ok(beatsOf(steps, 20)!.some((b) => b.kind === 'autosub' && b.minute === 'KO' && b.players[0][0] === 16));
    assert.deepEqual(steps.find((s) => s.match?.id === 20)!.subsIn, [16]);
    assert.deepEqual(steps.at(-1)!.score, [9, 23]);
  });

  it('has a match being played as far as it has got, without full time', () => {
    const d = bobVCy();
    Object.assign(d.plMatches![0], { done: false, lineups: undefined });
    const feed: SlimLive = {
      elements: { 13: [6, 50], 14: [7, 50], 17: [0, 50] },
      fixtures: [{ id: 20, h: 2, a: 3, started: true, done: false, min: 50, score: [1, 1] }],
    } as unknown as SlimLive;
    const stats: PlStats = {
      gw: 2,
      matches: { 20: { 14: cells({ goals_scored: 1 }) } },
      moments: {
        20: [
          [23, 1, 'goal', 14],
          [41, 1, 'goal', 13],
          [47, 1, 'yellow', 17],
        ] as PlMoment[],
      },
    };
    const steps = momentum(d, { ...m(), finished: false }, sides(d), { feed, points: (pid) => feed.elements[pid]?.[0] ?? 0 }, stats);
    const beats = beatsOf(steps, 20)!;
    assert.deepEqual(read(beats), [
      ['KO', [1, 2], '13 kickoff 1, 14 kickoff 1, 17 kickoff 1'],
      ['23’', [0, 5], '14 Goal 5'],
      ['41’', [5, 0], '13 Goal 5'],
      ['45+2’', [0, -1], '17 yellow -1'],
    ]);
    assert.equal(beats.at(-1)!.clock, 47);
    // The live points have Salah's provisional bonus, which no moment shows.
    assert.deepEqual(steps[0].gained, [6, 7]);
    assert.deepEqual([sumOf(beats, 0), sumOf(beats, 1)], [6, 6]);
  });
});

describe('the momentum’s automatic substitutes while the gameweek is played', () => {
  // Isak on for Haaland in Bob's XI, as the live scores have it; or Haaland on for Isak.
  const isakOn: Lineup = { ...lineup([13, 16], [15]), subs: [16], off: [15] };
  const haalandOn: Lineup = { ...lineup([13, 15], [16]), subs: [15], off: [16] };
  const nowIn = (d: Data): LiveRound => ({ feed: d.live!, points: (pid) => d.live!.elements[pid]?.[0] ?? 0 });
  const stepsOf = (d: Data, bob: Lineup, stats?: PlStats) =>
    momentum(
      d,
      d.matches.find((x) => x.gw === 2)!,
      [bob, d.lineups[3][2]],
      nowIn(d),
      stats,
    );
  const autoSubs = (steps: Step[]) =>
    steps.flatMap((s) => (s.beats ?? []).filter((b) => b.kind === 'autosub').map((b) => [s.match?.id, b.minute, b.gained, b.players]));
  const end = (steps: Step[]) => steps.at(-1)!.score;
  const everyone = (steps: Step[]) =>
    steps.flatMap((s) => [...s.scorers.map(([pid]) => pid), ...(s.beats ?? []).flatMap((b) => b.players.map(([pid]) => pid))]);

  it('brings one in at the full time of his starter’s club’s last match, with what he’d scored by then', () => {
    const d = liveRound({ mciVArs: 'over' });
    const steps = stepsOf(d, isakOn, liveStats());
    assert.deepEqual(
      steps.map((s) => [s.match?.id, s.gained, s.scorers, s.subsIn]),
      [
        [
          20,
          [7, 18],
          [
            [14, 13, 1],
            [13, 7, 0],
            [17, 5, 1],
          ],
          undefined,
        ],
        [21, [5, 0], [[16, 5, 0]], [16]],
      ],
    );
    assert.deepEqual(autoSubs(steps), [
      [
        21,
        'FT',
        [5, 0],
        [
          [16, 5, 0, 'Came in'],
          [15, 0, 0, 'Didn’t play'],
        ],
      ],
    ]);
    // At full time, after the rest of the match.
    assert.equal(steps[1].beats!.at(-1)!.clock, 91);
    // His kick-off and hour at Chelsea were on the bench.
    assert.ok(steps[0].beats!.every((b) => b.players.every(([pid]) => pid !== 16)));
    // No step of their own at the end while the gameweek is played.
    assert.ok(steps.every((s) => s.match));
  });

  it('brings one in at the kick-off of a match his starter isn’t in the squad for', () => {
    const d = liveRound({ mciVArs: 'live', teams: true });
    const steps = stepsOf(d, isakOn, liveStats());
    assert.deepEqual(autoSubs(steps), [
      [
        21,
        'KO',
        [5, 0],
        [
          [16, 5, 0, 'Came in'],
          [15, 0, 0, 'Not in the squad'],
        ],
      ],
    ]);
    assert.equal(steps[1].beats![0].clock, 0);
    assert.deepEqual(end(steps), [12, 18]);
  });

  it('counts a substitute’s moments in a match after his substitution for his side', () => {
    // Isak didn't get on at Chelsea, and Haaland came in when MCI v ARS kicked off.
    const d = liveRound({ mciVArs: 'live', haalandPlays: true });
    const steps = stepsOf(d, haalandOn, liveStats({ haalandPlays: true }));
    assert.deepEqual(read(steps[1].beats), [
      ['KO', [1, 0], '15 kickoff 1'],
      ['KO', [0, 0], '15 Came in 0, 16 Didn’t play 0'],
      ['20’', [4, 0], '15 Goal 4'],
    ]);
    assert.deepEqual(steps[1].scorers, [[15, 6, 0]]);
    assert.deepEqual(end(steps), [13, 18]);
  });

  it('ends on the live score, with the stats file or without', () => {
    for (const [setup, bob] of [
      [{ mciVArs: 'over' }, isakOn],
      [{ mciVArs: 'live', teams: true }, isakOn],
      [{ mciVArs: 'due', teams: true }, isakOn],
      [{ mciVArs: 'live', haalandPlays: true }, haalandOn],
    ] as const) {
      const d = liveRound(setup);
      const now = nowIn(d);
      const score = [bob, d.lineups[3][2]].map((l) => l.xi.reduce((t, pid) => t + now.points(pid), 0));
      assert.deepEqual(end(stepsOf(d, bob, liveStats(setup))), score, JSON.stringify(setup));
      assert.deepEqual(end(stepsOf(d, bob)), score, `${JSON.stringify(setup)} without the stats file`);
    }
  });

  it('brings one made ahead of a kick-off still to come in where play has got', () => {
    // The teams are out for MCI v ARS without Haaland, so the live scores have Isak on already.
    const d = liveRound({ mciVArs: 'due', teams: true });
    const steps = stepsOf(d, isakOn, liveStats());
    assert.deepEqual(
      steps.map((s) => [s.match?.id, s.gained, s.subsIn]),
      [[20, [12, 18], [16]]],
    );
    assert.deepEqual(autoSubs(steps), [
      [
        20,
        'KO',
        [5, 0],
        [
          [16, 5, 0, 'Came in'],
          [15, 0, 0, 'Not in the squad'],
        ],
      ],
    ]);
    // The latest there is, which the chart puts where play has got.
    assert.ok(steps[0].beats!.at(-1)!.clock > 90);
  });

  it('leaves out one not yet made', () => {
    // Haaland's match is still to come: Isak waits on the bench, his points not counting.
    const d = liveRound({ mciVArs: 'due' });
    const steps = stepsOf(d, d.lineups[2][2], liveStats());
    assert.ok(!everyone(steps).includes(16));
    assert.deepEqual(end(steps), [7, 18]);
    // Nor one the lineups have come on whom the commentary has no time for.
    const never: Lineup = { ...lineup([13, 18], [15]), subs: [18], off: [15] };
    assert.ok(!everyone(stepsOf(d, never, liveStats())).includes(18));
  });

  it('keeps each where it was made once every match is over, before the head-to-head is', () => {
    const d = liveRound({ mciVArs: 'over' });
    Object.assign(d.live!.fixtures[2], { started: true, done: true });
    const steps = stepsOf(d, isakOn, liveStats());
    assert.ok(
      steps.every((s) => s.match),
      'no step of their own at the end',
    );
    assert.equal(autoSubs(steps).length, 1);
    assert.deepEqual(end(steps), [12, 18]);
  });
});
