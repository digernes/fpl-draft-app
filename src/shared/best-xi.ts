// The best legal XI from a squad by a value per player: each position between its
// minimum and maximum, eleven in all. The build uses it for projected XIs by expected
// points, the Squads tab for each manager's best XI by the points scored for them.

import type { Position, XiLimits } from './data.ts';

const POSITIONS: Position[] = ['GKP', 'DEF', 'MID', 'FWD'];

export function bestXi(
  squad: number[],
  value: (pid: number) => number,
  positionOf: (pid: number) => Position | undefined,
  limits: XiLimits,
  play = 11,
): { ids: number[]; pts: number } {
  const byPos = Object.fromEntries(POSITIONS.map((pos) => [pos, [] as number[]])) as Record<Position, number[]>;
  for (const pid of squad) byPos[positionOf(pid) as Position]?.push(pid);
  for (const list of Object.values(byPos)) list.sort((a, b) => value(b) - value(a));
  const range = POSITIONS.map((pos) => [limits[pos][0], Math.min(limits[pos][1], byPos[pos].length)]);
  const total = (ids: number[]) => ids.reduce((acc, pid) => acc + value(pid), 0);
  let best = { ids: [] as number[], pts: 0 };
  const choose = (i: number, counts: number[]) => {
    if (i === POSITIONS.length) {
      if (counts.reduce((a, b) => a + b, 0) !== play) return;
      const ids = counts.flatMap((n, j) => byPos[POSITIONS[j]].slice(0, n));
      const pts = total(ids);
      if (pts > best.pts) best = { ids, pts };
      return;
    }
    for (let n = range[i][0]; n <= range[i][1]; n++) choose(i + 1, [...counts, n]);
  };
  choose(0, []);
  return best;
}
