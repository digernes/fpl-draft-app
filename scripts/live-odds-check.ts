// How well the live odds call the head-to-heads of the gameweeks played so far: each one
// replayed from before its first kick-off to its last kick-off slot, the state after each
// slot (and 30, 60 and 80 minutes into it, from the points as they came in) rebuilt as the
// win chance rebuilds it (src/app/win-chance.ts): each side's points from the matches
// played, and for each of its XI still to play the share of his expected points before the
// gameweek still to come, as the model would have forecast them from the gameweeks before
// (modelBefore; the first gameweek, with none before it, shares each side's projected score
// at the deadline over its XI, as the page does). The chances come from the live odds'
// skewed final scores (finalChances) and, for comparison, from the normal of the difference
// they replaced, and are scored against the results: log loss and Brier score, overall and
// by how much was left to play, and a calibration table. So is each side's final score, and
// each player's gameweek: the chance each method gave the whole points it ended on.
//
//   node scripts/live-odds-check.ts            from public/data.json and the API responses in .cache/
//   node scripts/live-odds-check.ts --cache <dir>
//
// It reads only what's on disk: a response missing from the cache is an error, not a fetch.

import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { momentum } from '../src/app/momentum.ts';
import { headingAfter, headingAt, type Outlook } from '../src/app/win-chance.ts';
import { fetchLeague } from '../src/build/api.ts';
import { modelBefore } from '../src/build/expected.ts';
import { readSummary } from '../src/build/last-season.ts';
import { seasonName } from '../src/build/output.ts';
import { readSeason } from '../src/build/season.ts';
import type { Data, Lineup, Match, PlStats } from '../src/shared/data.ts';
import { PLAYER_POINTS_SD, stillToPlay } from '../src/shared/live-projection.ts';
import { finalChances, outcomeProbabilities, type Heading } from '../src/shared/odds.ts';

type Chances = [number, number, number];

/** A gameweek's expected points for each player before it, on his side in a head-to-head; none for a gameweek not to be replayed. */
export type Expectations = (gw: number) => ((pid: number, side: 0 | 1, m: Match) => number) | null;

/** A head-to-head as it stood after a kick-off slot, the chances of each method then, and how it ended (0 home, 1 draw, 2 away). */
export interface State {
  gw: number;
  /** At a slot's end (or before the first kick-off), or within one. */
  at: 'end' | 'within';
  /** Players' worth of a full gameweek still to play, both sides together. */
  left: number;
  normal: Chances;
  skewed: Chances;
  outcome: 0 | 1 | 2;
  /** Each side's points still to come: how many players' worth it had left, and the chance of the whole points it got, by each method. */
  sides: { left: number; normal: number; skewed: number }[];
}

const normalChances = (home: Heading, away: Heading): Chances => {
  const p = outcomeProbabilities(home.mean - away.mean, Math.max(0.01, Math.sqrt(home.variance + away.variance)));
  return [p.home, p.draw, p.away];
};

// Minutes within a slot at which it's replayed too, its matches that far through.
const WITHIN = [30, 60, 80];

/**
 * Every finished head-to-head's states: before its first kick-off and after each of its
 * kick-off slots but the last, and with a gameweek's stats file (for the points as they came
 * in through each match), at WITHIN's minutes of each slot too.
 */
export function replay(data: Data, expectedIn: Expectations, statsIn: (gw: number) => PlStats | undefined = () => undefined): State[] {
  const states: State[] = [];
  for (const m of data.matches.filter((x) => x.finished)) {
    const lineups = [data.lineups[m.home]?.[m.gw], data.lineups[m.away]?.[m.gw]] as [Lineup, Lineup];
    const expected = expectedIn(m.gw);
    if (!lineups[0] || !lineups[1] || !expected) continue;
    const outlook: Outlook = {
      round: (data.plMatches ?? []).filter((pm) => pm.gw === m.gw),
      lineups,
      clubOf: (pid) => data.players[pid]?.club,
      expected: (pid, side) => expected(pid, side, m),
      points: (pid) => data.players[pid]?.pts?.[m.gw - data.meta.firstGw] ?? 0,
    };
    const steps = momentum(data, m, lineups, undefined, statsIn(m.gw));
    const outcome = m.homePts! > m.awayPts! ? 0 : m.homePts === m.awayPts ? 1 : 2;
    const final = steps.at(-1)?.score ?? [0, 0];
    const add = (at: State['at'], [home, away]: [Heading, Heading]) => {
      const left = (home.variance + away.variance) / PLAYER_POINTS_SD ** 2;
      if (left < 1e-9) return; // nothing left to play: certain either way
      // The chance of the score a side ended on is the chance of a draw with that score for certain.
      const sides = [home, away].map((h, i) => {
        const end: Heading = { mean: final[i], variance: 0, floor: final[i] };
        return { left: h.variance / PLAYER_POINTS_SD ** 2, normal: normalChances(h, end)[1], skewed: finalChances(h, end)[1] };
      });
      states.push({ gw: m.gw, at, left, normal: normalChances(home, away), skewed: finalChances(home, away), outcome, sides });
    };
    // The kick-off slots, as the steps of their matches.
    const slots: [number, number][] = [];
    steps.forEach((step, i) => {
      if (!step.match) return;
      if (i && steps[i - 1].match?.ko === step.match.ko) slots.at(-1)![1] = i + 1;
      else slots.push([i, i + 1]);
    });
    add('end', headingAfter([], outlook));
    for (const [first, last] of slots) {
      const before = steps.slice(0, first);
      const slot = steps.slice(first, last);
      if (slot.every((step) => step.beats)) {
        const done = new Set(before.flatMap((step) => (step.match ? [step.match.id] : [])));
        const here = new Set(slot.map((step) => step.match!.id));
        for (const minute of WITHIN) {
          const score = [0, 1].map(
            (side) =>
              before.reduce((t, step) => t + step.gained[side], 0) +
              slot.reduce((t, step) => t + step.beats!.reduce((u, b) => u + (b.clock <= minute ? b.gained[side] : 0), 0), 0),
          ) as [number, number];
          add(
            'within',
            headingAt(score, (pm) => (done.has(pm.id) ? 1 : here.has(pm.id) ? minute / 90 : 0), outlook),
          );
        }
      }
      add('end', headingAfter(steps.slice(0, last), outlook));
    }
  }
  return states;
}

/** Log loss (natural, each chance held to at least 1 in 10,000) and Brier score, averaged. */
export function scores(states: State[], method: 'normal' | 'skewed') {
  const n = states.length || 1;
  let log = 0;
  let brier = 0;
  for (const s of states) {
    const p = s[method];
    log -= Math.log(Math.max(1e-4, p[s.outcome]));
    brier += p.reduce((t, x, i) => t + (x - (i === s.outcome ? 1 : 0)) ** 2, 0);
  }
  return { n: states.length, log: log / n, brier: brier / n };
}

const BANDS = [0, 0.01, 0.05, 0.15, 0.35, 0.65, 0.85, 0.95, 0.99, 1.0000001];

/** Every chance given (home, draw and away alike) by band: how many, the average chance and how often it came true. */
export function calibration(states: State[], method: 'normal' | 'skewed') {
  return BANDS.slice(0, -1).map((lo, b) => {
    const hi = BANDS[b + 1];
    const picks = states.flatMap((s) => s[method].flatMap((p, i) => (p >= lo && p < hi ? [[p, i === s.outcome ? 1 : 0]] : [])));
    const mean = (k: 0 | 1) => (picks.length ? picks.reduce((t, x) => t + x[k], 0) / picks.length : 0);
    return { lo, hi: Math.min(1, hi), n: picks.length, predicted: mean(0), observed: mean(1) };
  });
}

/** Each of the XIs' players in the finished gameweeks: the chance of the whole points he got, from his expected points, by each method. */
export function playerChances(data: Data, expectedIn: Expectations) {
  const chances: Pair[] = [];
  for (const m of data.matches.filter((x) => x.finished)) {
    const expected = expectedIn(m.gw);
    if (!expected) continue;
    [m.home, m.away].forEach((id, side) => {
      for (const pid of data.lineups[id]?.[m.gw]?.xi ?? []) {
        const his: Heading = {
          mean: expected(pid, side as 0 | 1, m),
          variance: PLAYER_POINTS_SD ** 2,
          ...stillToPlay(1, undefined, 'yet to play'),
        };
        const got = data.players[pid]?.pts?.[m.gw - data.meta.firstGw] ?? 0;
        const end: Heading = { mean: got, variance: 0, floor: got };
        chances.push({ normal: normalChances(his, end)[1], skewed: finalChances(his, end)[1] });
      }
    });
  }
  return chances;
}

type Pair = { normal: number; skewed: number };
const logLoss = (list: Pair[], k: keyof Pair) => list.reduce((t, x) => t - Math.log(Math.max(1e-4, x[k])), 0) / (list.length || 1);

// Overall, and by how many players' worth was left to play.
function byLeft<T extends { left: number }>(list: T[], show: (label: string, part: T[]) => string) {
  const bands: [string, (left: number) => boolean][] = [
    ['All', () => true],
    ['9 or more players left', (left) => left >= 9],
    ['4 to 8 players left', (left) => left >= 4 && left < 9],
    ['Late: under 4 players left', (left) => left < 4],
    ['Under 2 players left', (left) => left < 2],
  ];
  return bands.map(([label, keep]) =>
    show(
      label,
      list.filter((x) => keep(x.left)),
    ),
  );
}

/** The replay's results, the normal against the skewed, as lines to print. */
export function report(states: State[], players: Pair[]): string[] {
  const pct = (x: number) => `${(100 * x).toFixed(1)}%`.padStart(6);
  const head = (label: string, n: number) => `  ${label.padEnd(28)} n=${String(n).padEnd(4)}`;
  const results = (label: string, list: State[]) => {
    const [a, b] = [scores(list, 'normal'), scores(list, 'skewed')];
    return `${head(label, a.n)} log loss ${a.log.toFixed(3)} → ${b.log.toFixed(3)}   Brier ${a.brier.toFixed(3)} → ${b.brier.toFixed(3)}`;
  };
  const scored = (label: string, list: Pair[]) =>
    `${head(label, list.length)} log loss ${logLoss(list, 'normal').toFixed(3)} → ${logLoss(list, 'skewed').toFixed(3)}`;
  const gws = [...new Set(states.map((s) => s.gw))];
  return [
    `GW ${gws[0]}–${gws.at(-1)}, the normal → the skewed final scores`,
    '',
    'The results, at the kick-off slots’ ends',
    ...byLeft(
      states.filter((s) => s.at === 'end'),
      results,
    ),
    `The results, with ${WITHIN.join(', ')} minutes into each slot too`,
    ...byLeft(states, results),
    'Each side’s final score: the chance of the whole points it ended on, all states',
    ...byLeft(
      states.flatMap((s) => s.sides.filter((x) => x.left > 0)),
      scored,
    ),
    'Each player’s gameweek, from his expected points: the chance of the whole points he got',
    scored('The XIs’ players', players),
    ...(['normal', 'skewed'] as const).flatMap((method) => [
      '',
      `Calibration, ${method}: every home, draw and away chance, all states, by band`,
      ...calibration(states, method).flatMap((b) =>
        b.n ? [`  ${pct(b.lo)} – ${pct(b.hi)}  n=${String(b.n).padEnd(4)} predicted ${pct(b.predicted)}  observed ${pct(b.observed)}`] : [],
      ),
    ]),
  ];
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { cache: { type: 'string', default: '.cache' }, league: { type: 'string', default: '23793' } } });
  globalThis.fetch = () => Promise.reject(new Error('live-odds-check reads the cache only'));
  const data = JSON.parse(readFileSync('public/data.json', 'utf8')) as Data;
  const fetched = await fetchLeague(Number(values.league), values.cache);
  const season = readSeason(fetched, await readSummary('public/seasons', seasonName(fetched.boot.events.data, 1)));
  const models = new Map(season.finishedGws.map((gw) => [gw, modelBefore(season, gw)]));
  const expectedIn: Expectations = (gw) => {
    if (!models.has(gw)) return null;
    const model = models.get(gw);
    // With no gameweek before it, as the page does: each side's projected score shared over its XI.
    return model ? (pid) => model(pid) : (_, side, m) => (m.odds ? m.odds.expected[side] / 11 : 0);
  };
  const statsIn = (gw: number) => {
    const file = `public/stats/${gw}.json`;
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as PlStats) : undefined;
  };
  console.log(report(replay(data, expectedIn, statsIn), playerChances(data, expectedIn)).join('\n'));
}
