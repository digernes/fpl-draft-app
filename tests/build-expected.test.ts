import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { modelBefore, modelExpected, modelInput } from '../src/build/expected.ts';
import { readSeason } from '../src/build/season.ts';
import { fetched, SCORING } from './fixtures/build-league.ts';

// laterChance and deadlineFlags are in model.test.ts.

describe('the model’s input', () => {
  const season = readSeason(fetched());

  it('gives every player his club, position and FPL’s chance of playing the gameweek asked for', () => {
    const next = modelInput(season, 'next');
    assert.equal(next.players.size, 64);
    assert.deepEqual(next.players.get(13), { club: 2, pos: 'FWD', chance: null, penalties: 1 });
    assert.equal(next.players.get(21)?.chance, 75);
    assert.equal(next.players.get(20)?.chance, 0);
    assert.equal(modelInput(season, 'this').players.get(21)?.chance, 75);
    // A later gameweek: a doubt has cleared by then, an injury without a date to come back hasn't.
    const later = modelInput(season, 6);
    assert.equal(later.players.get(21)?.chance, null);
    assert.equal(later.players.get(20)?.chance, 0);
    // A backtest has no flags at all.
    assert.equal(modelInput(season).players.get(20)?.chance, null);
  });

  it('learns only from the finished gameweeks, with the Draft game’s scoring', () => {
    const input = modelInput(season, 'next');
    assert.deepEqual(Object.keys(input.feeds), ['1', '2']);
    assert.equal(input.scoring.goals_scored_MID, SCORING.goals_scored_MID);
    assert.equal(input.last, undefined);
  });

  it('takes the penalty order from the main game, and has none without it', () => {
    const without = readSeason(fetched({ noFplBoot: true }));
    assert.equal(modelInput(without, 'next').players.get(13)?.penalties, null);
  });
});

describe('the site’s expected points', () => {
  const season = readSeason(fetched());
  const model = modelExpected(season)!;

  it('has nothing before a gameweek has been played', () => {
    assert.equal(modelExpected(readSeason(fetched({ preseason: true }))), null);
  });

  it('forecasts the next gameweek, and the one being played on its own fixtures', () => {
    const ids = Array.from({ length: 64 }, (_, i) => i + 1);
    assert.ok(ids.every((pid) => model.next(pid) >= 0 && Number.isFinite(model.next(pid))));
    assert.ok(model.next(13) > 0);
    assert.ok(ids.some((pid) => Math.abs(model.now(pid) - model.next(pid)) > 0.01));
    assert.equal(model.next(999), 0);
    // An injured player isn't expected to play.
    assert.ok(model.next(20) < 0.1);
  });

  it('takes each forecast apart, its expected minutes first', () => {
    const parts = model.parts(13)!;
    assert.equal(parts.length, 11);
    assert.ok(parts[0] > 0 && parts[0] <= 90);
    // The parts after the minutes add up to his expected points.
    assert.ok(Math.abs(parts.slice(1).reduce((t, p) => t + p, 0) - model.next(13)) < 1e-6);
    assert.equal(model.parts(999), undefined);
    assert.equal(model.partsNow(13)?.length, 11);
  });

  it('forecasts a later gameweek on its own fixtures and chances', () => {
    const later = model.at(6);
    assert.ok(later.points(13) > 0);
    assert.equal(later.parts(13)?.length, 11);
    // A doubt has cleared by then.
    assert.ok(later.points(21) >= model.next(21));
  });

  it('says what it would have forecast for a gameweek already played, from the ones before', () => {
    assert.equal(modelBefore(season, 1), null); // nothing before it
    assert.equal(modelBefore(season, 9), null); // not played
    const before = modelBefore(season, 2)!;
    assert.ok(before(13) > 0);
    // Without flags, an injured player is expected to play as he has.
    assert.ok(before(20) > model.next(20));
  });
});
