import './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { pageTeams } from '../src/app/pages/teams.ts';
import { setData, state } from '../src/app/state.ts';
import { text } from './fixtures/html.ts';
import { season } from './fixtures/league.ts';

beforeEach(() => {
  setData(season());
  state.myTeam = null;
});

// Each team's row: its link, what it says, and whether it's the one followed.
const rows = (html: string) =>
  [...html.matchAll(/<div class="team-row( mine)?">\s*<a class="team-link" href="([^"]+)">([\s\S]*?)<\/a>/g)].map(
    ([, mine, to, inside]) => `${to} ${text(inside)}${mine ? ' (mine)' : ''}`,
  );

describe('the Teams page', () => {
  it('lists every team in table order, with its manager, place and points', () => {
    const { title, body } = pageTeams();
    assert.equal(title, 'Teams');
    assert.match(body, /<div class="card-sub">Office League · 3 teams<\/div>/);
    assert.deepEqual(rows(body), [
      '#/team/3 CY Cy United Cy · 1st · 4 pts',
      '#/team/1 AN Ann’s &#38; Co Ann · 2nd · 4 pts',
      '#/team/2 BO Bob FC Bob · 3rd · 0 pts',
    ]);
  });

  it('puts the team the visitor follows first, picked out and Following', () => {
    state.myTeam = 2;
    const { body } = pageTeams();
    assert.deepEqual(
      rows(body).map((r) => r.split(' ')[0] + (r.endsWith('(mine)') ? ' mine' : '')),
      ['#/team/2 mine', '#/team/3', '#/team/1'],
    );
    assert.equal(body.match(/<span>Following<\/span>/g)?.length, 1);
  });

  it('gives each team its form and a Follow button', () => {
    const { body } = pageTeams();
    assert.equal(body.match(/<span class="form">/g)?.length, 3);
    assert.equal(body.match(/data-action="follow"/g)?.length, 3);
  });

  it('lists the managers as they come before there is a table', () => {
    const d = season();
    d.tables.overall = [];
    setData(d);
    const { body } = pageTeams();
    assert.deepEqual(rows(body), ['#/team/1 AN Ann’s &#38; Co Ann', '#/team/2 BO Bob FC Bob', '#/team/3 CY Cy United Cy']);
    assert.doesNotMatch(body, /class="form"/);
  });
});
