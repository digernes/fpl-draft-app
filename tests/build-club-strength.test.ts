import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildClubStrength } from '../src/build/club-strength.ts';
import type { ClubMatch } from '../src/model/history.ts';
import { fitTeams } from '../src/model/teams.ts';

const match = (gw: number, club: number, opp: number, home: boolean, xg: number, xga: number): ClubMatch => ({
  gw,
  fixture: gw * 10 + Math.min(club, opp),
  club,
  opp,
  home,
  xg,
  xga,
  goals: 0,
});

describe('buildClubStrength', () => {
  const matches = [
    match(1, 1, 2, true, 2.4, 0.6),
    match(1, 2, 1, false, 0.6, 2.4),
    match(2, 2, 1, true, 1.1, 1.3),
    match(2, 1, 2, false, 1.3, 1.1),
  ];
  const teams = fitTeams(matches, { atGw: 3, halfLife: 10, prior: 6, home: 0.15, homePrior: 20, goals: 0 });
  const s = buildClubStrength({ teams, matches }, 3, 10);

  it('keeps the model’s ratings, to three places', () => {
    assert.equal(s.gw, 3);
    assert.equal(s.size, 10);
    assert.equal(s.base, Math.round(teams.base * 1000) / 1000);
    assert.equal(s.home, Math.round(teams.home * 1000) / 1000);
    assert.deepEqual(s.ratings[1], [Math.round(teams.attack.get(1)! * 1000) / 1000, Math.round(teams.defence.get(1)! * 1000) / 1000]);
    // Arsenal made more and gave away less.
    assert.ok(s.ratings[1][0] > s.ratings[2][0]);
    assert.ok(s.ratings[1][1] > s.ratings[2][1]);
  });

  it('gives the same goals as the model itself', () => {
    const goals = Math.exp(s.base + s.home + s.ratings[1][0] - s.ratings[2][1]);
    assert.ok(Math.abs(goals - teams.rate(1, 2, true)) < 0.01);
  });

  it('sums each club’s matches, xG and xG against', () => {
    assert.deepEqual(s.season, { 1: [2, 3.7, 1.7], 2: [2, 1.7, 3.7] });
  });
});
