// The columns of the draft league's simulated table, and the simulation's formula for
// the (i) by its legend.

import type { Simulation } from '../shared/data.ts';
import { markedHeader, PRIZE_MARKS, simCell } from './components.ts';
import { ordinal, pct } from './format.ts';
import { D } from './state.ts';
import { managerCol, posCol, type Column } from './table.ts';

// The simulation's formula with this season's numbers, for the (i) by the legend.
export function simulationFormula() {
  const m = D.simulation.model;
  // Every gameweek left has its own unless FPL's fixtures for the later ones were missing.
  const weeks =
    m.projected > D.meta.lastGw - D.meta.nextGw
      ? 'each gameweek’s own'
      : m.projected === 1
        ? 'the next gameweek’s, and the same after'
        : `each of the next ${m.projected} gameweeks’ own, then their average`;
  return [
    'Each simulated week, a manager scores:',
    `league average (${m.leagueAverage})`,
    m.projected ? `+ ${m.weight ? 'part of ' : ''}how far their projected XI sits from the average one (${weeks})` : null,
    `+ their level for this run (typically ±${m.levelSpread} a week)`,
    `+ that week’s randomness (typically ±${m.spread}, ±${m.laterSpread} after next week)`,
    '',
    m.weight && m.projected ? weightLine(m.weight) : null,
    'A projected XI is the best one their squad can field, by the site’s expected points. Higher score wins 3 points, level scores draw. Equal points split on points scored.',
  ]
    .filter((line) => line !== null)
    .join('\n');
}

// How much of the projected XI counts, week by week.
const weightLine = ([next, decay, floor]: [number, number, number]) =>
  `The projected XI counts ${pct(next)} next week, ${decay} of that for each week after, and never under ${pct(floor)}, as squads change.\n`;

export type SimRow = Simulation['rows'][number];

export function simulationCols(): Column<SimRow>[] {
  const positions = D.simulation.rows[0]?.positions.length ?? 0;
  return [
    posCol,
    managerCol,
    { label: 'PTS', w: '44px', cls: 'c-pts', tip: 'Average final points across the simulations', cell: (r) => Math.round(r.pts) },
    ...Array.from({ length: positions }, (_, i): Column<SimRow> => ({
      label: markedHeader(ordinal(i + 1), PRIZE_MARKS[i + 1] ?? (i === positions - 1 ? 'var(--qual-bottom)' : null)),
      w: '44px',
      from: 'md',
      tip: `How often they finish ${ordinal(i + 1)}`,
      cell: (r) => simCell(r.positions[i]),
    })),
    // Narrow tables get the three that matter instead of the full grid.
    {
      label: markedHeader('1st', 'var(--qual-top)'),
      w: '48px',
      until: 'sm',
      tip: 'How often they win the league',
      cell: (r) => simCell(r.positions[0]),
    },
    {
      label: 'Top 2',
      w: '52px',
      until: 'sm',
      tip: 'How often they finish in the prize places',
      cell: (r) => simCell(r.positions[0] + r.positions[1]),
    },
    {
      label: markedHeader('Last', 'var(--qual-bottom)'),
      w: '48px',
      until: 'sm',
      tip: 'How often they finish last',
      cell: (r) => simCell(r.positions.at(-1) as number),
    },
  ];
}
