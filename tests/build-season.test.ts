import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { clubsPlayingTwice, readSeason } from '../src/build/season.ts';
import { fetched } from './fixtures/build-league.ts';

describe('the season', () => {
  const season = readSeason(fetched());

  it('knows which gameweeks have been played, which are finished, and which comes next', () => {
    assert.equal(season.currentGw, 3);
    assert.deepEqual(season.gws, [1, 2, 3]);
    assert.deepEqual(season.finishedGws, [1, 2]);
    assert.equal(season.lastFinishedGw, 2);
    assert.equal(season.nextGw, 4);
    assert.equal(season.nextEvent?.id, 4);
    assert.equal(season.events.length, 6);
  });

  it('looks up a player’s club, position and points', () => {
    assert.equal(season.clubOf(13), 2);
    assert.equal(season.positionOf(1), 'GKP');
    assert.equal(season.positionOf(13), 'FWD');
    assert.equal(season.positionOf(999), undefined);
    assert.equal(season.clubOf(999), undefined);
    assert.equal(season.pointsIn(1, 1), season.live[1].elements[1].stats.total_points);
    assert.equal(season.pointsIn(1, 5), 0); // not played yet
  });

  it('marks the clubs that play twice in a gameweek, played or still to come', () => {
    assert.deepEqual(season.doubleClubs[1], []);
    assert.deepEqual(season.doubleClubs[2], [1, 3]);
    assert.deepEqual(season.doubleClubs[4], []);
    assert.deepEqual(
      clubsPlayingTwice([
        { team_h: 5, team_a: 6 },
        { team_h: 6, team_a: 7 },
        { team_h: 7, team_a: 5 },
      ]),
      [5, 6, 7],
    );
  });

  it('finds a gameweek’s fixtures in the Draft bootstrap, then in the main game’s', () => {
    assert.deepEqual(
      season.fixturesIn(4).map((f) => f.id),
      [401, 402],
    );
    assert.deepEqual(
      season.fixturesIn(6).map((f) => f.id),
      [601, 602],
    );
    assert.deepEqual(season.fixturesIn(7), []);
  });

  it('reads the formation and the XI’s limits from the squad rules, and the head-to-head points', () => {
    assert.deepEqual(season.formation, { DEF: 3, MID: 2, FWD: 1 });
    assert.deepEqual(season.xiLimits, { GKP: [1, 1], DEF: [3, 5], MID: [2, 5], FWD: [1, 3] });
    assert.deepEqual(season.scoring, { h2h_win: 3, h2h_draw: 1, h2h_lose: 0 });
    assert.equal(season.last, undefined);
  });

  it('has nothing played before the season starts', () => {
    const before = readSeason(fetched({ preseason: true }));
    assert.equal(before.currentGw, 0);
    assert.deepEqual(before.gws, []);
    assert.equal(before.lastFinishedGw, 0);
    assert.equal(before.nextGw, 1);
  });
});
