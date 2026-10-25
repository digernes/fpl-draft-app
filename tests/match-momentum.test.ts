import { drawIntoNothing } from './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { runAction } from '../src/app/actions.ts';
import { forgetRelayed } from '../src/app/in-play-records.ts';
import { applyLatestLive } from '../src/app/live-scores.ts';
import { pct } from '../src/app/format.ts';
import { slotOf } from '../src/app/lookups.ts';
import { inPlayOdds } from '../src/app/match-odds.ts';
import { momentum } from '../src/app/momentum.ts';
import { momentumCard } from '../src/app/pages/match-momentum.ts';
import { D, live, setData, setLive, state } from '../src/app/state.ts';
import { chanceAfter, chanceAt, type Chances, type Outlook } from '../src/app/win-chance.ts';
import type { Data, InPlayRecord, Lineup, LiveData, Match, PlMoment, PlStats } from '../src/shared/data.ts';
import { liveRound, liveStats, type Setup } from './fixtures/auto-subs.ts';
import { lineup } from './fixtures/league.ts';
import { bobVCy, cells, statsFile } from './fixtures/match.ts';

// The live odds ask for the gameweek's stats file, which never comes.
drawIntoNothing();
globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;

beforeEach(() => {
  setData(bobVCy());
  setLive(null);
  state.momentumView = 'lead';
});

// GW 2: Bob (Palmer, Haaland) v Cy (Salah, Watkins), see bobVCy(). Two kick-off slots,
// CHE v LIV at 14:00 and MCI v ARS at 16:30: 180 minutes across.
const game = () => D.matches.find((x) => x.gw === 2)!;
const sides = (): [Lineup, Lineup] => [D.lineups[2][2], D.lineups[3][2]];
const card = (stats?: PlStats, lineups = sides(), m: Match = game()) =>
  momentumCard(m, momentum(D, m, lineups, live?.gw === m.gw ? live : undefined, stats), lineups);
const withMoments = (moments: PlMoment[]) => {
  const stats = statsFile();
  stats.moments![20] = moments;
  return stats;
};

const unesc = (s = '') => s.replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)));
const who = (dot: string) => (dot === `var(--m${slotOf(2)})` ? 'Bob' : dot === `var(--m${slotOf(3)})` ? 'Cy' : dot);

/** Each mark: where it is in minutes across the chart, its tip and rows, the side ahead at its dot (none level) and the dot's height. */
function marks(html: string) {
  const width = Number(/viewBox="0 0 ([\d.]+) /.exec(html)![1]);
  return [
    ...html.matchAll(
      /<span class="mo-slot" tabindex="0" style="left:([\d.]+)%;width:([\d.]+)%"(?: data-tip-head="([^"]*)")? data-tip="([^"]*)"(?: data-tip-rows="([^"]*)")?><i class="mo-mark tip-at[^"]*" style="left:([\d.]+)%([^"]*)"><\/i><\/span>/g,
    ),
  ].map(([, left, span, head, tip, rows, at, style]) => ({
    x: Math.round(((Number(left) + (Number(span) * Number(at)) / 100) / 100) * width),
    tip: unesc(tip),
    // The lead's rows, or the win chance's heading (its chances).
    rows: unesc(rows ?? head),
    ahead: who(/--dot:([^;]+)/.exec(style)?.[1] ?? ''),
    y: /--y:([\d.]+)%/.exec(style)?.[1],
  }));
}
const chanceRows = ([home, draw, away]: Chances) => `Bob ${pct(home)} · Draw ${pct(draw)} · Cy ${pct(away)}`;
// As the card sees the gameweek before this one was played: each side's projected score shared over its XI.
const outlook = (): Outlook => ({
  round: D.plMatches!,
  lineups: sides(),
  clubOf: (pid) => D.players[pid]?.club,
  expected: (_, side) => game().odds!.expected[side] / 11,
  points: () => 0,
});

describe('the momentum card’s lead', () => {
  it('has a mark at each moment that moved the score, at its minute, with what happened and the score after it', () => {
    assert.deepEqual(
      marks(card(statsFile())).map(({ x, tip, rows }) => [x, tip, rows]),
      [
        [23, 'Kick-off\n23’ Salah goal: Bob 1 - 7 Cy', 'Bob\t+1 (Palmer 1)\nCy\t+7 (Salah 6, Watkins 1)'],
        [41, '41’ Palmer goal: Bob 6 - 7 Cy', 'Bob\t+5 (Palmer 5)'],
        [52, '52’ Watkins booked: Bob 6 - 6 Cy', 'Cy\t−1 (Watkins −1)'],
        [60, '60’ Palmer, Salah and Watkins an hour: Bob 7 - 8 Cy', 'Bob\t+1 (Palmer 1)\nCy\t+2 (Salah 1, Watkins 1)'],
        [67, '67’ Watkins goal, Salah assist: Bob 7 - 15 Cy', 'Cy\t+7 (Watkins 4, Salah 3)'],
        [
          90,
          'Bob 7 - 18 Cy\nCHE 1-2 LIV\nWith bonus, saves and defensive contributions at full time',
          'Bob\t+7 (Palmer 7)\nCy\t+18 (Salah 13, Watkins 5)',
        ],
        // MCI v ARS has no moments: its slot's end alone, as before.
        [180, 'Bob 9 - 18 Cy\nMCI 0-0 ARS', 'Bob\t+2 (Haaland 2)\nCy\t+0'],
      ],
    );
  });

  it('moves the lead at a goal’s minute', () => {
    // Level after Watkins' booking at 52 minutes, Cy ahead either side of it.
    assert.deepEqual(
      marks(card(statsFile())).map(({ x, ahead }) => [x, ahead]),
      [
        [23, 'Cy'],
        [41, 'Cy'],
        [52, ''],
        [60, 'Cy'],
        [67, 'Cy'],
        [90, 'Cy'],
        [180, 'Cy'],
      ],
    );
    // On the line, give or take the next moment's rise starting (smooth-curve.ts).
    const level = marks(card(statsFile())).find((mk) => mk.x === 52)!;
    assert.ok(Math.abs(Number(level.y) - 50) < 0.1, level.y);
  });

  it('shows a lead within a slot that’s gone by its end', () => {
    // Palmer scores after 10 minutes and Bob leads until Watkins' goal at 67.
    const html = card(
      withMoments([
        [10, 1, 'goal', 13],
        [67, 2, 'goal', 17, 14],
      ]),
    );
    assert.deepEqual(
      marks(html).map(({ x, tip, ahead }) => [x, tip.split('\n').at(-1), ahead]),
      [
        [10, '10’ Palmer goal: Bob 6 - 2 Cy', 'Bob'],
        [60, '60’ Palmer, Salah and Watkins an hour: Bob 7 - 4 Cy', 'Bob'],
        [67, '67’ Watkins goal, Salah assist: Bob 7 - 11 Cy', 'Cy'],
        [90, 'With bonus, saves and defensive contributions at full time', 'Cy'],
        [180, 'MCI 0-0 ARS', 'Cy'],
      ],
    );
    // Up in Bob's colour, which it never was before.
    assert.ok(!marks(card()).some((mk) => mk.ahead === 'Bob'));
  });

  it('ends each slot where it did without the moments', () => {
    const ends = (html: string) => marks(html).filter((mk) => mk.x % 90 === 0);
    const [before, after] = [ends(card()), ends(card(statsFile()))];
    assert.deepEqual(
      after.map(({ x, rows, ahead }) => [x, rows, ahead]),
      before.map(({ x, rows, ahead }) => [x, rows, ahead]),
    );
    // Where the curve is there, give or take how its corners are smoothed (smooth-curve.ts).
    after.forEach(({ y }, i) => assert.ok(Math.abs(Number(y) - Number(before[i].y)) < 0.5, `${y} ${before[i].y}`));
    assert.deepEqual(
      before.map(({ tip }) => tip),
      ['Bob 7 - 18 Cy\nCHE 1-2 LIV', 'Bob 9 - 18 Cy\nMCI 0-0 ARS'],
    );
  });

  it('keeps a slot to its end alone without its matches’ moments', () => {
    const stats = statsFile();
    delete stats.moments;
    assert.deepEqual(
      marks(card(stats)).map(({ x }) => x),
      [90, 180],
    );
    assert.equal(card(stats), card());
  });

  it('puts moments within a minute of each other under one mark, and those in the last minute with the slot’s end', () => {
    const html = card(
      withMoments([
        [41, 1, 'goal', 13],
        [42, 1, 'yellow', 17],
        [93, 2, 'goal', 14],
      ]),
    );
    assert.deepEqual(
      marks(html).map(({ x, tip }) => [x, tip]),
      [
        [42, 'Kick-off\n41’ Palmer goal\n42’ Watkins booked: Bob 6 - 1 Cy'],
        [60, '60’ Palmer, Salah and Watkins an hour: Bob 7 - 3 Cy'],
        [90, '90+3’ Salah goal\nBob 7 - 18 Cy\nCHE 1-2 LIV\nWith bonus, saves and defensive contributions at full time'],
        [180, 'Bob 9 - 18 Cy\nMCI 0-0 ARS'],
      ],
    );
  });

  it('writes a score below nought with a minus sign', () => {
    D.meta.rules = { ...D.meta.rules, own_goals: -2 };
    // Salah's FPL assist, which no goal accounts for, goes with the own goal (withFplAssists).
    assert.equal(marks(card(withMoments([[10, 1, 'own', 13]])))[0].tip, 'Kick-off\n10’ Palmer own goal, Salah assist: Bob −1 - 5 Cy');
  });

  it('brings an automatic substitute in where his substitution is made, with no Subs at the end', () => {
    const cy: Lineup = { ...lineup([14, 17, 16], [99]), subs: [16], off: [99] };
    const html = card(statsFile(), [D.lineups[2][2], cy]);
    const all = marks(html);
    assert.ok(!html.includes('>Subs<'));
    // In at the kick-off, his starter not in the squad.
    assert.ok(all.some((mk) => mk.x < 90 && mk.tip.includes('Auto-sub: Isak on for')));
    assert.equal(all.at(-1)!.tip.split('\n')[0], 'Bob 9 - 23 Cy');
  });
});

describe('the momentum card’s win chance', () => {
  beforeEach(() => {
    runAction({ dataset: { action: 'momentum-view', value: 'chance' } } as unknown as HTMLElement);
  });

  it('has each side’s chance at each moment, from the score then and the minutes left', () => {
    const all = marks(card(statsFile()));
    assert.deepEqual(all[0], {
      x: 0,
      tip: 'Before kick-off',
      rows: chanceRows([0.3, 0.2, 0.5]),
      ahead: 'Cy',
      y: all[0].y,
    });
    const at41 = all.find((mk) => mk.x === 41)!;
    assert.equal(at41.tip, '41’ Palmer goal · 6 - 7');
    assert.equal(at41.rows, chanceRows(chanceAt([6, 7], (pm) => (pm.id === 20 ? 41 / 90 : 0), outlook())));
    // Palmer's goal makes Bob likelier to win than Salah's had left him.
    const at23 = all.find((mk) => mk.x === 23)!;
    const bob = (rows: string) => Number(/^Bob (\d+)%/.exec(rows)![1]);
    assert.ok(bob(at41.rows) > bob(at23.rows));
  });

  it('turns with a lead within a slot that’s gone by its end', () => {
    const all = marks(
      card(
        withMoments([
          [10, 1, 'goal', 13],
          [67, 2, 'goal', 17, 14],
        ]),
      ),
    );
    assert.deepEqual(
      all.map(({ x, ahead }) => [x, ahead]),
      [
        [0, 'Cy'],
        [10, 'Bob'],
        [60, 'Bob'],
        [67, 'Cy'],
        [90, 'Cy'],
        [180, 'Cy'],
      ],
    );
  });

  it('ends each slot on the chance after its matches, and the last on the result', () => {
    const ends = (html: string) => marks(html).filter((mk) => mk.x && mk.x % 90 === 0);
    const [before, after] = [ends(card()), ends(card(statsFile()))];
    assert.deepEqual(
      after.map(({ rows }) => rows),
      before.map(({ rows }) => rows),
    );
    after.forEach(({ y }, i) => assert.ok(Math.abs(Number(y) - Number(before[i].y)) < 0.5, `${y} ${before[i].y}`));
    // The result at the end, exactly: a win for certain on the axis.
    assert.equal(after[1].y, '100.00');
    assert.equal(after[0].tip, 'After CHE v LIV · 7 - 18');
    assert.equal(after[1].rows, chanceRows([0, 0, 1]));
  });
});

// The live odds as the builds recorded them (Match.inPlay), `minutes` after the first kick-off
// (14:00, 20.5 hours after GW 2's deadline): Bob's and Cy's chances in thousandths, and the score.
const recorded = (minutes: number, home: number, away: number, score: [number, number]): InPlayRecord => [
  1230 + minutes,
  home,
  away,
  ...score,
];
function withRecords(...records: InPlayRecord[]) {
  D.gameweeks[1].deadline = '2026-08-21T17:30:00Z';
  game().inPlay = records;
}

describe('the momentum card’s win chance, as the live odds had it', () => {
  beforeEach(() => {
    state.momentumView = 'chance';
  });

  it('draws the records at their time within the kick-off slots, and works out again the slots without', () => {
    const without = marks(card(statsFile()));
    withRecords(
      recorded(-60, 300, 500, [0, 0]), // before the first kick-off
      recorded(30, 400, 300, [3, 4]),
      recorded(55, 350, 350, [6, 7]), // half-time
      recorded(80, 300, 400, [6, 7]),
      recorded(81, 250, 500, [6, 7]), // a minute later: the same mark
      recorded(120, 50, 900, [7, 18]), // after full time
    );
    const all = marks(card(statsFile()));
    assert.deepEqual(
      all.map(({ x, tip, rows }) => [x, tip, rows]),
      [
        [0, without[0].tip, without[0].rows],
        [30, '30’ · 3 - 4', chanceRows([0.4, 0.3, 0.3])],
        [45, 'Half-time · 6 - 7', chanceRows([0.35, 0.3, 0.35])],
        [64, '64’ · 6 - 7', chanceRows([0.25, 0.25, 0.5])],
        [90, 'After CHE v LIV · 7 - 18', chanceRows([0.05, 0.05, 0.9])],
        // MCI v ARS, recorded nowhere, ends on the result as before.
        [180, without.at(-1)!.tip, without.at(-1)!.rows],
      ],
    );
    // The dots on the curve at the chances recorded, give or take its rounded corners.
    const y = (home: number, away: number) => 50 - (home - away) * 50;
    for (const [x, home, away] of [
      [30, 0.4, 0.3],
      [64, 0.25, 0.5],
      [90, 0.05, 0.9],
    ])
      assert.ok(Math.abs(Number(all.find((mk) => mk.x === x)!.y) - y(home, away)) < 1.5, `${x}`);
  });

  it('works out a recorded slot’s end again when nothing was recorded after its matches', () => {
    const without = marks(card());
    withRecords(recorded(30, 400, 300, [3, 4]));
    assert.deepEqual(
      marks(card()).map(({ x, tip, rows }) => [x, tip, rows]),
      [
        [0, without[0].tip, without[0].rows],
        [30, '30’ · 3 - 4', chanceRows([0.4, 0.3, 0.3])],
        ...without.slice(1).map(({ x, tip, rows }) => [x, tip, rows]),
      ],
    );
  });

  it('keeps a recorded point’s tip to the minute and the score, in a slot of more than one match too', () => {
    D.plMatches![1].ko = D.plMatches![0].ko;
    withRecords(recorded(10, 400, 300, [3, 4]));
    assert.equal(marks(card())[1].tip, '10’ · 3 - 4');
  });

  it('leaves the lead as it was', () => {
    state.momentumView = 'lead';
    const before = card(statsFile());
    withRecords(recorded(30, 400, 300, [3, 4]), recorded(120, 50, 900, [7, 18]));
    assert.equal(card(statsFile()), before);
  });
});

describe('the momentum card while it’s played', () => {
  // GW 2 under way: 50 minutes into CHE v LIV, 1-1, Watkins booked in first-half stoppage
  // time; MCI v ARS to come.
  function playing(): Data {
    const d = bobVCy();
    d.meta.currentGw = 2;
    d.gameweeks[1].finished = false;
    Object.assign(
      d.matches.find((x) => x.gw === 2)!,
      { finished: false, homePts: 6, awayPts: 6 },
    );
    Object.assign(d.plMatches![0], { done: false, lineups: undefined, score: [1, 1] });
    Object.assign(d.plMatches![1], { done: false, lineups: undefined, score: undefined });
    Object.assign(d.lineups[2][2], { picks: [13, 15] });
    Object.assign(d.lineups[3][2], { picks: [14, 17, 16] });
    d.live = {
      gw: 2,
      ep: { 13: 5, 14: 6, 15: 6, 17: 4 },
      elements: { 13: [6, 50], 14: [6, 50], 17: [0, 50] },
      fixtures: [
        { id: 20, h: 2, a: 3, started: true, done: false, min: 50, score: [1, 1] },
        { id: 21, h: 4, a: 1, started: false, done: false, ko: '2026-08-22T16:30:00Z' },
      ],
    } as LiveData;
    return d;
  }
  const stats = (moments: PlMoment[]): PlStats => ({
    gw: 2,
    matches: { 20: { 14: cells({ goals_scored: 1 }) } },
    moments: { 20: moments },
  });
  const sofar: PlMoment[] = [
    [23, 1, 'goal', 14],
    [41, 1, 'goal', 13],
    [47, 1, 'yellow', 17],
  ];

  beforeEach(() => {
    setData(playing());
    applyLatestLive();
  });

  it('follows the moments as far as play has got, then the score as it stands', () => {
    const all = marks(card(stats(sofar)));
    assert.deepEqual(
      all.map(({ x, tip }) => [x, tip]),
      [
        [23, 'Kick-off\n23’ Salah goal: Bob 1 - 7 Cy'],
        [41, '41’ Palmer goal: Bob 6 - 7 Cy'],
        [47, '45+2’ Watkins booked: Bob 6 - 6 Cy'],
        [50, 'Bob 6 - 6 Cy\nCHE 1-1 LIV, live\nWith bonus, saves and defensive contributions as they stand'],
        [180, 'MCI v ARS, to come'],
      ],
    );
    assert.match(card(stats(sofar)), /<i class="mo-now" style="left:27.78%;top:50.00%"><\/i>/);
  });

  it('ends on the live odds the page shows', () => {
    state.momentumView = 'chance';
    const all = marks(card(stats(sofar)));
    const now = all.find((mk) => mk.x === 50)!;
    assert.equal(now.tip, 'Now · 6 - 6');
    assert.equal(now.rows, chanceRows(inPlayOdds(game())!.p));
    // The moments before it from the score then, and the matches that far through.
    const expected: Outlook = { ...outlook(), expected: (pid) => D.live!.ep[pid] ?? 0 };
    assert.equal(all.find((mk) => mk.x === 41)!.rows, chanceRows(chanceAt([6, 7], (pm) => (pm.id === 20 ? 41 / 90 : 0), expected)));
  });

  it('draws the live odds recorded so far, then those now', () => {
    state.momentumView = 'chance';
    withRecords(
      recorded(20, 300, 450, [1, 7]),
      recorded(40, 350, 400, [6, 7]),
      recorded(66, 380, 380, [6, 6]), // the 49th minute, the one before now: the live odds now instead
      recorded(160, 900, 50, [9, 6]), // in MCI v ARS, still to come by the live feed
    );
    const all = marks(card(stats(sofar)));
    assert.deepEqual(
      all.map(({ x, tip }) => [x, tip.split('\n')[0]]),
      [
        [0, 'Before kick-off'],
        [20, '20’ · 1 - 7'],
        [40, '40’ · 6 - 7'],
        [50, 'Now · 6 - 6'],
        [180, 'MCI v ARS, to come'],
      ],
    );
    assert.equal(all.find((mk) => mk.x === 50)!.rows, chanceRows(inPlayOdds(game())!.p));
  });

  it('draws what the relay recorded every minute since the last build, once it’s in', async () => {
    state.momentumView = 'chance';
    forgetRelayed();
    withRecords(recorded(20, 300, 450, [1, 7]));
    const never = globalThis.fetch;
    globalThis.fetch = (async (url: string) =>
      String(url).endsWith('/in-play/2026-27/2')
        ? Response.json({ '2-3': [recorded(40, 350, 400, [6, 7])] })
        : new Promise(() => {})) as unknown as typeof fetch;
    const tips = () => marks(card(stats(sofar))).map(({ x, tip }) => [x, tip.split('\n')[0]]);
    try {
      assert.deepEqual(
        tips().map(([x]) => x),
        [0, 20, 50, 180],
      ); // data.json's, and asks
      await new Promise((done) => setImmediate(done));
      assert.deepEqual(tips(), [
        [0, 'Before kick-off'],
        [20, '20’ · 1 - 7'],
        [40, '40’ · 6 - 7'],
        [50, 'Now · 6 - 6'],
        [180, 'MCI v ARS, to come'],
      ]);
    } finally {
      globalThis.fetch = never;
      forgetRelayed();
    }
  });

  it('puts a moment in the minute before where play has got with the score as it stands', () => {
    const all = marks(card(stats([...sofar, [49, 2, 'goal', 13]])));
    assert.equal(all.find((mk) => mk.x === 50)!.tip.split('\n')[0], '49’ Palmer goal');
    assert.ok(!all.some((mk) => mk.x === 49));
  });
});

describe('the momentum card’s automatic substitutes while it’s played', () => {
  // GW 2 under way with three kick-off slots (CHE v LIV over, MCI v ARS as each test has it,
  // EVE v FUL to come), Bob's lineup scored live from his picks: see liveRound().
  function playing(setup: Setup) {
    setData(liveRound(setup));
    setLive(null);
    applyLatestLive();
    const lineups: [Lineup, Lineup] = [live!.lineups[2], live!.lineups[3]];
    const stats = liveStats(setup);
    return { lineups, stats, html: card(stats, lineups), steps: momentum(D, game(), lineups, live!, stats) };
  }
  const ending = (html: string) => marks(html).findLast((mk) => /Bob .* Cy/.test(mk.tip))!;

  it('brings one in at the kick-off of a match his starter isn’t in the squad for, with a mark and a tip', () => {
    const { lineups, html } = playing({ mciVArs: 'live', teams: true });
    assert.deepEqual(lineups[0].subs, [16]);
    const all = marks(html);
    assert.deepEqual(
      all.map(({ x, tip, rows }) => [x, tip.split('\n')[0], rows]),
      [
        [23, 'Kick-off', 'Bob\t+1 (Palmer 1)\nCy\t+7 (Salah 6, Watkins 1)'],
        [41, '41’ Palmer goal: Bob 6 - 7 Cy', 'Bob\t+5 (Palmer 5)'],
        [52, '52’ Watkins booked: Bob 6 - 6 Cy', 'Cy\t−1 (Watkins −1)'],
        [60, '60’ Palmer, Salah and Watkins an hour: Bob 7 - 8 Cy', 'Bob\t+1 (Palmer 1)\nCy\t+2 (Salah 1, Watkins 1)'],
        [67, '67’ Watkins goal, Salah assist: Bob 7 - 15 Cy', 'Cy\t+7 (Watkins 4, Salah 3)'],
        [90, 'Bob 7 - 18 Cy', 'Bob\t+7 (Palmer 7)\nCy\t+18 (Salah 13, Watkins 5)'],
        [91, 'Auto-sub: Isak on for Haaland, +5: Bob 12 - 18 Cy', 'Bob\t+5 (Isak 5)'],
        [140, 'Bob 12 - 18 Cy', 'Bob\t+5 (Isak 5)\nCy\t+0'],
        [270, 'EVE v FUL, to come', ''],
      ],
    );
    // Isak's kick-off and hour at Chelsea were on the bench.
    assert.ok(all.every((mk) => !mk.tip.includes('Isak') || mk.x === 91));
  });

  it('puts one made at a kick-off after it, whichever match of the slot he comes in at', () => {
    // EVE v FUL kicks off with MCI v ARS, Bob's Everton players on from the start.
    const d = liveRound({ mciVArs: 'live', teams: true });
    d.plMatches![2].ko = d.plMatches![1].ko;
    Object.assign(d.live!.fixtures[2], { ko: d.plMatches![1].ko, started: true, min: 50, score: [0, 0] });
    d.live!.elements[21] = [1, 50];
    setData(d);
    setLive(null);
    applyLatestLive();
    const stats = liveStats();
    stats.moments![22] = [];
    const html = card(stats, [live!.lineups[2], live!.lineups[3]]);
    assert.equal(marks(html).find((mk) => mk.x === 91)!.tip, 'Kick-off\nAuto-sub: Isak on for Haaland, +5: Bob 13 - 18 Cy');
  });

  it('brings one in at the full time of his starter’s club’s last match, with the slot’s end', () => {
    const { html } = playing({ mciVArs: 'over' });
    assert.equal(
      marks(html).find((mk) => mk.x === 180)!.tip,
      'Auto-sub: Isak on for Haaland, +5\nBob 12 - 18 Cy\nMCI 0-0 ARS\nWith bonus, saves and defensive contributions at full time',
    );
  });

  it('counts his moments after it for his side', () => {
    const { html } = playing({ mciVArs: 'live', haalandPlays: true });
    assert.deepEqual(
      marks(html)
        .filter((mk) => mk.x > 90)
        .map(({ x, tip }) => [x, tip.split('\n').slice(0, 2).join(' / ')]),
      [
        [91, 'Kick-off / Auto-sub: Haaland on for Isak, +0: Bob 8 - 18 Cy'],
        [110, '20’ Haaland goal: Bob 12 - 18 Cy'],
        [140, 'Bob 13 - 18 Cy / MCI 1-0 ARS, live'],
        [270, 'EVE v FUL, to come'],
      ],
    );
  });

  it('ends on the live score, and has no step of their own at the end while it’s played', () => {
    for (const setup of [
      { mciVArs: 'over' },
      { mciVArs: 'live', teams: true },
      { mciVArs: 'due', teams: true },
      { mciVArs: 'live', haalandPlays: true },
      { mciVArs: 'due' },
    ] as const) {
      const { html } = playing(setup);
      const m = game();
      assert.ok(ending(html).tip.includes(`Bob ${m.homePts} - ${m.awayPts} Cy`), `${JSON.stringify(setup)}: ${ending(html).tip}`);
      assert.ok(!html.includes('>Subs<'), JSON.stringify(setup));
    }
  });

  it('brings one made ahead of a kick-off still to come in where play has got', () => {
    const { html } = playing({ mciVArs: 'due', teams: true });
    assert.equal(
      marks(html).find((mk) => mk.x === 90)!.tip,
      'Auto-sub: Isak on for Haaland, +5\nBob 12 - 18 Cy\nCHE 1-2 LIV\nWith bonus, saves and defensive contributions at full time',
    );
  });

  it('leaves out one not yet made', () => {
    const { lineups, html } = playing({ mciVArs: 'due' });
    assert.deepEqual(lineups[0].subs, []);
    assert.ok(!html.includes('Isak'));
    assert.equal(ending(html).tip.split('\n')[0], 'Bob 7 - 18 Cy');
  });

  it('keeps each where it was made once every match is over, with no Subs at the end', () => {
    const d = liveRound({ mciVArs: 'over' });
    Object.assign(d.live!.fixtures[2], { started: true, done: true, score: [0, 0] });
    setData(d);
    applyLatestLive();
    const html = card(liveStats(), [live!.lineups[2], live!.lineups[3]]);
    assert.ok(!html.includes('>Subs<'));
    assert.ok(marks(html).some((mk) => mk.tip.includes('Auto-sub: Isak on for Haaland')));
    assert.equal(ending(html).tip.split('\n')[0], 'Bob 12 - 18 Cy');
  });

  it('works out the win chance at a substitute’s moment from the score then, him one of the XI from then on', () => {
    state.momentumView = 'chance';
    const { lineups, html, steps } = playing({ mciVArs: 'live', teams: true });
    const before: Outlook = { ...outlook(), lineups, expected: (pid) => D.live!.ep[pid] ?? 0 };
    const after: Outlook = { ...before, lineups: [{ ...lineups[0], subs: [], off: [] }, lineups[1]] };
    const all = marks(html);
    const at = all.find((mk) => mk.x === 91)!;
    assert.equal(at.tip, 'Auto-sub: Isak on for Haaland, +5 · 12 - 18');
    assert.equal(at.rows, chanceRows(chanceAt([12, 18], (pm) => (pm.id === 20 ? 1 : pm.id === 21 ? 1 / 90 : 0), after)));
    // Before it, Haaland's still to come for Bob.
    assert.equal(all.find((mk) => mk.x === 90)!.rows, chanceRows(chanceAfter(steps.slice(0, 1), before)));
    assert.notEqual(chanceRows(chanceAfter(steps.slice(0, 1), before)), chanceRows(chanceAfter(steps.slice(0, 1), after)));
  });
});
