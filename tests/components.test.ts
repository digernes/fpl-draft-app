import './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { bestOf, gwNav, pointsTipRows, ptsPill, simCell, withDiff } from '../src/app/components.ts';
import { setData } from '../src/app/state.ts';
import { league } from './fixtures/league.ts';

beforeEach(() => setData(league()));

describe('points pills', () => {
  it('shows bonus apart, as FPL does, and takes the points apart in the tip', () => {
    const pill = ptsPill(13, 3, {
      from: [
        ['Goals', 10],
        ['Bonus', 3],
      ],
    });
    assert.match(pill, />10\+3</);
    assert.match(pill, /data-tip="13 points"/);
    assert.match(pill, /data-tip-rows="Goals\t10\nBonus\t3"/);
    assert.match(pill, /class="ptsp p2"/);
  });

  it('marks the match’s best in blue whatever he scored, and says so', () => {
    const pill = ptsPill(2, 0, { top: true });
    assert.match(pill, /class="ptsp top"/);
    assert.match(pill, /data-tip="The match’s best"/);
  });

  it('says where a gameweek being played is heading', () => {
    assert.match(ptsPill(1, 0, { projected: 4.26 }), /data-tip="1 point so far · 4\.3 projected"/);
  });

  it('takes apart what’s still to come under what he has, a heading of its own between them', () => {
    const pill = ptsPill(1, 0, {
      projected: 4.26,
      from: [['Playing', 1]],
      toCome: [
        ['Playing', 1],
        ['Goals', 0.64],
        ['Clean sheet', -0.32],
      ],
    });
    assert.match(
      pill,
      /data-tip="1 point so far · 4\.3 projected" data-tip-rows="Playing\t1\nStill to come\nPlaying\t1\.0\nGoals\t0\.6\nClean sheet\t−0\.3"/,
    );
    // Nothing yet to take apart of his points: the heading first.
    assert.equal(pointsTipRows([], [['Coming on', 0.78]]), 'Still to come\nComing on\t0.8');
    // Nothing to come: his points alone.
    assert.equal(pointsTipRows([['Goals', 5]]), 'Goals\t5');
    assert.equal(pointsTipRows([]), '');
  });
});

describe('bestOf', () => {
  const pts: Record<number, number> = { 1: 8, 2: 8, 3: 2 };
  const goals: Record<number, number> = { 1: 1, 2: 1, 3: 0 };
  const bps: Record<number, number> = { 1: 20, 2: 31, 3: 5 };

  it('breaks a tie with each tiebreak in turn', () => {
    assert.deepEqual(
      [
        ...bestOf(
          [1, 2, 3],
          (id) => pts[id],
          (id) => goals[id],
          (id) => bps[id],
        ),
      ],
      [2],
    );
  });

  it('picks nobody when nobody scored', () => {
    assert.equal(bestOf([1, 2], () => 0).size, 0);
  });
});

describe('small pieces', () => {
  it('turns the round picker’s arrows off at either end and names the current round', () => {
    const nav = gwNav(1, 1, 3, (g) => `#/round/${g}`, { current: 2 });
    assert.match(nav, /data-value="#\/round\/0" disabled aria-label="Previous gameweek"/);
    assert.match(nav, /data-value="#\/round\/2" {2}aria-label="Next gameweek"/);
    assert.match(nav, /<option value="#\/round\/2">Current \(GW 2\)<\/option>/);
  });

  it('shades a chance and keeps the extremes from reading as certain', () => {
    assert.match(simCell(0), />–</);
    assert.match(simCell(0.001), /><1%</);
    assert.match(simCell(0.999), />>99%</);
    assert.match(simCell(0.5), /class="simp strong"/);
  });

  it('colours actual against expected by whether it went the manager’s way', () => {
    assert.match(withDiff(10, 2.4, 'tip'), /class="diff good">\+2</);
    assert.match(withDiff(10, 2.4, 'tip', { lowerIsGood: true }), /class="diff bad">\+2</);
    assert.match(withDiff(10, -0.2, 'tip'), /class="diff even">0</);
  });
});
