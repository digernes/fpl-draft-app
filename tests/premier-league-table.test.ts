import './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { href } from '../src/app/router.ts';
import { plZone, premierLeagueTable } from '../src/app/premier-league-table.ts';
import { setData } from '../src/app/state.ts';
import type { Data, PlMatch } from '../src/shared/data.ts';
import { text } from './fixtures/html.ts';
import { season } from './fixtures/league.ts';

const played = (id: number, gw: number, home: number, away: number, score: [number, number]): PlMatch => ({
  id,
  gw,
  home,
  away,
  ko: null,
  score,
  done: true,
});

// Two rounds of a league of four: Arsenal beat Chelsea and Man City, Liverpool drew with Man
// City and beat Chelsea. Arsenal v Liverpool, in the third, is under way.
function data(): Data {
  const d = season();
  d.plMatches = [
    played(1, 1, 1, 2, [3, 1]),
    played(2, 1, 3, 4, [1, 1]),
    played(3, 2, 4, 1, [0, 2]),
    played(4, 2, 2, 3, [0, 2]),
    { id: 5, gw: 3, home: 1, away: 3, ko: null, score: [1, 0] },
  ];
  return d;
}

beforeEach(() => setData(data()));

// A club's row as a reader sees it, and its form pills.
const row = (html: string, club: number) =>
  html
    .split(`data-key="club-${club}"`)[1]
    .split('<div class="trow')[0]
    .replace(/^[^>]*>/, '');
const form = (html: string, club: number) =>
  [...row(html, club).matchAll(/<a class="pill (\w)" href="([^"]+)" data-tip="([^"]+)">/g)].map((m) => `${m[1]} ${m[3]} ${m[2]}`);

describe('the Premier League table', () => {
  it('lists the clubs in order, each a link to its players, with the goals and the goal difference', () => {
    const html = premierLeagueTable();
    assert.deepEqual(
      [...html.matchAll(/data-key="club-(\d+)"/g)].map((m) => Number(m[1])),
      [1, 3, 4, 2],
    );
    assert.ok(row(html, 1).includes(`<a class="club-link" href="${href.pl('players', 1)}">`));
    assert.match(text(row(html, 1)), /^1 Arsenal 2 2 0 0 5-1 \+4 6/);
    assert.match(text(row(html, 2)), /^4 Chelsea 2 0 0 2 1-5 -4 0/);
  });

  it('gives each club its last finished matches as pills from its side, each a link to the match', () => {
    const html = premierLeagueTable();
    assert.deepEqual(form(html, 1), [`W GW 1: ARS 3-1 CHE ${href.plMatch(1)}`, `W GW 2: MCI 0-2 ARS ${href.plMatch(3)}`]);
    assert.deepEqual(
      form(html, 3).map((f) => f[0]),
      ['D', 'W'],
    );
  });

  it('keeps to the last five matches', () => {
    const d = data();
    d.plMatches = Array.from({ length: 7 }, (_, i) => played(10 + i, i + 1, 1, 2, [i % 3, 1]));
    setData(d);
    assert.deepEqual(
      form(premierLeagueTable(), 1).map((f) => f.split(':')[0]),
      ['W GW 3', 'L GW 4', 'D GW 5', 'W GW 6', 'L GW 7'],
    );
  });

  it('has no form before the season’s matches are known', () => {
    const d = data();
    delete d.plMatches;
    setData(d);
    assert.match(row(premierLeagueTable(), 1), /<span class="form"><\/span>/);
  });

  it('colours the places that lead somewhere, with a legend', () => {
    assert.deepEqual([1, 4, 5, 6, 17, 18, 20].map(plZone), [
      'var(--qual-top)',
      'var(--qual-top)',
      'var(--qual-europe)',
      null,
      null,
      'var(--qual-bottom)',
      'var(--qual-bottom)',
    ]);
    const html = premierLeagueTable();
    assert.match(html, /data-key="club-1" style="--qual:var\(--qual-top\)"/);
    assert.match(html, /data-key="club-2" style="--qual:var\(--qual-top\)"/); // fourth, of four
    assert.match(text(html.split('<div class="legend">')[1]), /^Champions League Europa League Relegation$/);
  });
});
