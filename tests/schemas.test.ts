import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EntryPicks, Game, LiveFeed } from '../src/shared/fpl-api.ts';

describe('API schemas', () => {
  it('accept a response and drop the fields not in use', () => {
    const game = Game.parse({ current_event: 7, current_event_finished: true, next_event: 8, processing_status: 'n' });
    assert.deepEqual(game, { current_event: 7, current_event_finished: true, next_event: 8 });
  });

  it('accept the empty values FPL sends between seasons', () => {
    assert.ok(Game.safeParse({ current_event: null, current_event_finished: false, next_event: null }).success);
  });

  it('reject a response that changed shape', () => {
    const result = EntryPicks.safeParse({ picks: [{ element: '384', position: 1 }] });
    assert.equal(result.success, false);
    assert.deepEqual(result.error?.issues[0].path, ['picks', 0, 'element']);
  });

  it('take numbers sent as strings for expected stats', () => {
    const stats = { total_points: 2, minutes: 90, goals_scored: 0, assists: 0, clean_sheets: 0, goals_conceded: 1, expected_goals: '0.12' };
    assert.ok(LiveFeed.safeParse({ elements: { 1: { stats } }, fixtures: [] }).success);
  });
});
