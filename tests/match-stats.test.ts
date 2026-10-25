import { drawIntoNothing } from './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';

import { sideStats, statsTab } from '../src/app/pages/match-stats.ts';
import { setData, setLive, state } from '../src/app/state.ts';
import type { Data, Lineup, Match } from '../src/shared/data.ts';
import { bobVCy, statsFile } from './fixtures/match.ts';
import { match } from './fixtures/league.ts';

const game = (d: Data = bobVCy()) => d.matches.find((m) => m.gw === 2)!;
const lineups = (d: Data = bobVCy()): [Lineup, Lineup] => [d.lineups[2][2], d.lineups[3][2]];

// GW 2's stats file comes at once; the others never do.
before(async () => {
  drawIntoNothing();
  Object.assign(globalThis, {
    fetch: (url: string) =>
      url.startsWith('stats/2.json') ? Promise.resolve({ ok: true, json: async () => statsFile() }) : new Promise(() => {}),
  });
  setData(bobVCy());
  state.route = { page: 'home', tab: '' };
  statsTab(game(), lineups());
  await new Promise((resolve) => setImmediate(resolve));
});

beforeEach(() => {
  setData(bobVCy());
  setLive(null);
});

// Each group's rows: the label, then each side's value, the better one starred.
function groups(html: string) {
  return Object.fromEntries(
    html
      .split('<div class="st-group">')
      .slice(1)
      .map((group) => [
        group.match(/<h3 class="st-head">([^<]+)<\/h3>/)![1],
        [
          ...group.matchAll(
            /<div class="xg-row"><span class="xg-value([^"]*)">([^<]*)<\/span><span class="xg-label"[^>]*>([^<]*)<\/span><span class="xg-value([^"]*)">([^<]*)<\/span><\/div>/g,
          ),
        ].map(([, hc, h, label, ac, a]) => `${label}: ${h}${hc.includes('better') ? '*' : ''} ${a}${ac.includes('better') ? '*' : ''}`),
      ]),
  );
}

describe('a head-to-head’s Stats tab once it’s over', () => {
  it('opens with the points shared out and the top stats', () => {
    const html = statsTab(game(), lineups());
    assert.match(
      html,
      /<div class="st-bar"><span class="m2" style="--share: 0.333">9<\/span><span class="m3" style="--share: 0.667">18<\/span><\/div>/,
    );
    assert.deepEqual(groups(html)['Top stats'], [
      'Expected points (xP): 8.9 13.8*',
      'Projected before the deadline: 44 52*',
      'Goals: 1 2*',
      'Assists: 0 1*',
      'Bonus points: 0 3*',
      'BPS: 33 53*',
      'Points on the bench: 0 5*',
    ]);
  });

  it('takes the points apart by where they came from, once the gameweek’s stats file is in', () => {
    assert.deepEqual(groups(statsTab(game(), lineups()))['Where the points came from'], [
      'Playing: 4 4',
      'Goals: 5 9*',
      'Assists: 0 3*',
      'Clean sheets: 0 0',
      'Defensive contributions: 0 0',
      'Bonus: 0 3*',
      'Cards: 0* −1',
    ]);
  });

  it('has the expected numbers, the attack, the defence, the minutes and the discipline', () => {
    const g = groups(statsTab(game(), lineups()));
    assert.deepEqual(g.Expected, [
      'Expected points (xP): 8.9 13.8*',
      'Expected goals (xG): 1.07 1.30*',
      'Expected assists (xA): 0.15 0.47*',
      'xG + xA: 1.22 1.77*',
      'Expected clean sheets (xCS): 0.00 0.00',
      'xG conceded (xGC): 0.00 0.00',
    ]);
    assert.deepEqual(g.Attack, ['Goals: 1 2*', 'Assists: 0 1*', 'Threat: 50.0 66.0*', 'Creativity: 12.5 31.0*']);
    assert.deepEqual(g.Defence, [
      'Clean sheets: 0 0',
      'Defensive contributions: 0 0',
      'Tackles: 3* 0',
      'Clearances, blocks and interceptions: 1* 0',
      'Recoveries: 4* 3',
      'Saves: 0 0',
      'Penalties saved: 0 0',
    ]);
    assert.deepEqual(g.Minutes, [
      'Minutes played: 180* 165',
      'Players who played: 2 2',
      'Starts: 2 2',
      '60 minutes or more: 2 2',
      'Automatic substitutions: 0 0',
    ]);
    assert.deepEqual(g.Discipline, ['Yellow cards: 0* 1', 'Red cards: 0 0', 'Own goals: 0 0', 'Penalties missed: 0 0']);
  });

  it('puts the first two groups side by side and shares the rest out between two columns', () => {
    const html = statsTab(game(), lineups());
    const rows = html.split('<div class="st-row">').slice(1);
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((row) =>
        row
          .split('<div class="st-cell">')
          .slice(1)
          .map((cell) => [...cell.matchAll(/<h3 class="st-head">([^<]+)<\/h3>/g)].map((m) => m[1]).join(', ')),
      ),
      [
        ['Top stats', 'Where the points came from'],
        ['Expected, Attack', 'Defence, Minutes, Discipline'],
      ],
    );
  });

  it('takes the double gameweek’s penalty off, and tells what the stats don’t account for', () => {
    const d = bobVCy();
    d.lineups[3][2] = { ...d.lineups[3][2], adj: 14 };
    d.players[17].pts = [0, 7, 2]; // two more than his match accounts for
    setData(d);
    const g = groups(statsTab(game(d), lineups(d)));
    assert.ok(g['Where the points came from'].includes('Other: 0 2*'));
    assert.ok(g['Where the points came from'].includes('Double gameweek penalty: 0* −4'));
  });

  it('counts the minutes and the bonus as the relay has them while the gameweek is played', () => {
    const elements = { 13: [7, 45], 15: [2, 45], 14: [10, 45], 17: [5, 45] } as Record<number, [number, number]>;
    setLive({
      gw: 2,
      feed: { elements, fixtures: [] },
      lineups: {},
      points: (pid) => elements[pid]?.[0] ?? 0,
      bonus: (pid) => (pid === 13 ? 2 : 0),
    });
    const g = groups(statsTab(game(), lineups()));
    assert.equal(g.Minutes[0], 'Minutes played: 90 90');
    assert.ok(g['Top stats'].includes('Bonus points: 2* 0'));
  });

  it('leaves out what needs the stats file while it’s on its way, and the expected numbers before full time', () => {
    const d = bobVCy();
    for (const l of [d.lineups[1][1], d.lineups[2][1]]) l.xi = [];
    setData(d);
    const gw1: Match = { ...match(1, 1, 2, 50, 40, false) };
    const g = groups(statsTab(gw1, [d.lineups[1][1], d.lineups[2][1]]));
    assert.deepEqual(Object.keys(g), ['Top stats', 'Attack', 'Defence', 'Minutes', 'Discipline']);
    assert.ok(!g['Top stats'].some((r) => r.startsWith('BPS')));
    assert.ok(!g.Defence.some((r) => r.startsWith('Tackles')));
  });
});

describe('a head-to-head’s top stats beside it', () => {
  const rows = (html: string) => Object.values(groups(`<div class="st-group"><h3 class="st-head">Side</h3>${html}`))[0];

  it('has the points, then the expected points, goals and assists', () => {
    const html = sideStats(game(), lineups());
    assert.match(html, /^<div class="st-cell"><div class="st-share">/);
    assert.deepEqual(rows(html), ['Expected points (xP): 8.9 13.8*', 'Goals: 1 2*', 'Assists: 0 1*']);
  });

  it('adds up the XIs’ expected points from their matches while the gameweek is on', () => {
    const unfinished = { ...game(), finished: false, xg: undefined };
    const [xp] = rows(sideStats(unfinished, lineups()));
    assert.match(xp, /^Expected points \(xP\): \d+\.\d\*? \d+\.\d\*?$/);
  });
});

describe('a head-to-head’s Stats tab before kick-off', () => {
  // GW 4: Ann at home to Cy, second against first, on the same points.
  const ahead = (): Match => ({
    ...match(4, 1, 3, 0, 0, false),
    homePts: null,
    awayPts: null,
    started: false,
    odds: game().odds,
  });

  it('has what the odds make of it and each side’s season so far', () => {
    const g = groups(statsTab(ahead(), null));
    assert.deepEqual(g['Before the match'], [
      'Win chance: 30% 50%*',
      'Projected points: 44 52*',
      'Table position: 2nd 1st*',
      'Table points: 4 4',
    ]);
    // The table's points for and against a match (Ann 80 and 70 in two, Cy 90 and 75), and
    // the highest of the scores in the matches (Ann's 50, Cy's 30 and 18).
    assert.deepEqual(g['This season'], [
      'Wins: 1 1',
      'Points a match: 40.0 45.0*',
      'Points against a match: 35.0* 37.5',
      'Highest score: 50* 30',
      'Form: 4 4',
    ]);
  });

  it('leaves the odds out before they’re made', () => {
    const g = groups(statsTab({ ...ahead(), odds: undefined }, null));
    assert.deepEqual(g['Before the match'], ['Table position: 2nd 1st*', 'Table points: 4 4']);
  });
});
