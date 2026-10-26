import './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { simulationCols, simulationFormula, type SimRow } from '../src/app/simulation-table.ts';
import { setData } from '../src/app/state.ts';
import { dataTable } from '../src/app/table.ts';
import type { Data } from '../src/shared/data.ts';
import { text } from './fixtures/html.ts';
import { season } from './fixtures/league.ts';

beforeEach(() => setData(season()));

// The simulation's formula as a season further off would have it: `projected` gameweeks of
// their own with the next one in GW 4 of 38.
function formula(projected: number, lastGw = 38) {
  const d: Data = season();
  d.meta.lastGw = lastGw;
  d.simulation.model.projected = projected;
  setData(d);
  return simulationFormula();
}

describe('the simulated table’s formula', () => {
  it('puts this season’s numbers in each line', () => {
    const lines = simulationFormula().split('\n');
    assert.deepEqual(lines.slice(0, 5), [
      'Each simulated week, a manager scores:',
      'league average (45.2)',
      '+ how far their projected XI sits from the average one (each gameweek’s own)',
      '+ their level for this run (typically ±3.1 a week)',
      '+ that week’s randomness (typically ±11.8, ±13.4 after next week)',
    ]);
    assert.match(lines.at(-1)!, /^A projected XI is the best one their squad can field/);
  });

  it('says how much of the projected XI counts, for a season built with the weights', () => {
    const d: Data = season();
    d.simulation.model.weight = [1, 0.9, 0.5];
    setData(d);
    const formula = simulationFormula();
    assert.match(formula, /\+ part of how far their projected XI sits from the average one/);
    assert.match(
      formula,
      /The projected XI counts 100% next week, 0.9 of that for each week after, and never under 50%, as squads change\./,
    );
  });

  it('says how far ahead the projected XIs go, and leaves them out before there are any', () => {
    assert.match(formula(1), /\(the next gameweek’s, and the same after\)/);
    assert.match(formula(3), /\(each of the next 3 gameweeks’ own, then their average\)/);
    assert.match(formula(3, 6), /\(each gameweek’s own\)/);
    assert.doesNotMatch(formula(0), /projected XI sits/);
  });
});

describe('the simulated table’s columns', () => {
  const table = () => dataTable(simulationCols(), season().simulation.rows);
  const heads = (html: string) => text(html.split('<div class="trow thead">')[1].split('</div><div class="trow')[0]);
  // A manager's row, as a reader sees it.
  const row = (html: string, id: number) =>
    text(
      html
        .split(`data-key="m-${id}"`)[1]
        .split('<div class="trow')[0]
        .replace(/^[^>]*>/, ''),
    );

  it('has a column for each finishing place, the prize places and the last marked, and three for narrow tables', () => {
    const html = table();
    assert.equal(heads(html), '# PTS 1st 2nd 3rd 1st Top 2 Last');
    assert.match(html, /<span class="qmark" style="--q:var\(--qual-top\)">1st<\/span>/);
    assert.match(html, /<span class="qmark" style="--q:var\(--qual-europe\)">2nd<\/span>/);
    assert.match(html, /<span class="qmark" style="--q:var\(--qual-bottom\)">3rd<\/span>/);
    assert.match(html, /<span class="qmark" style="--q:var\(--qual-bottom\)">Last<\/span>/);
  });

  it('rounds the average points and gives each place’s chance, the top two together', () => {
    const html = table();
    // Cy: 52% to win it, 30% second and 18% last; in the prize places 82% of the time.
    assert.equal(row(html, 3), '1 CY Cy Cy United 8 52% 30% 18% 52% 82% 18%');
    assert.equal(row(html, 2), '3 BO Bob Bob FC 2 8% 28% 64% 8% 36% 64%');
  });

  it('marks a place never reached with a dash, and the near-certain ones as such', () => {
    const d = season();
    d.simulation.rows = [
      { id: 3, pts: 9, positions: [0.996, 0.004, 0], rank: 1 },
      { id: 1, pts: 5, positions: [0.004, 0.996, 0], rank: 2 },
      { id: 2, pts: 0, positions: [0, 0, 1], rank: 3 },
    ];
    setData(d);
    const html = dataTable(simulationCols(), d.simulation.rows);
    assert.equal(row(html, 3), '1 CY Cy Cy United 9 >99% <1% – >99% 100% –');
    assert.equal(row(html, 2), '3 BO Bob Bob FC 0 – – 100% – – 100%');
  });

  it('has no place columns without simulated rows', () => {
    const d = season();
    d.simulation.rows = [];
    setData(d);
    assert.equal(simulationCols().length, 6);
    const rows: SimRow[] = [];
    assert.equal(heads(dataTable(simulationCols(), rows)), '# PTS 1st Top 2 Last');
  });
});
