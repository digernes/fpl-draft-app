// Manager of the Month, by FPL's months (meta.months): the one with the most table points
// from the month's head-to-heads, then the most points scored.

import type { Data, Month } from '../shared/data.ts';

export interface MonthStanding {
  id: number;
  pts: number;
  pf: number;
  won: number;
  drawn: number;
  lost: number;
}

export interface MonthAwards {
  month: Month;
  /** Every one of its gameweeks is over. */
  over: boolean;
  managers: MonthStanding[];
}

/** Each month that has started, the latest first. */
export function monthlyAwards(data: Data): MonthAwards[] {
  const { meta } = data;
  const months = (meta.months ?? []).filter((month) => data.matches.some((m) => m.started && m.gw >= month.from && m.gw <= month.to));
  return months
    .map((month) => {
      const inMonth = (gw: number) => gw >= month.from && gw <= month.to;
      const rows = new Map(data.managers.map((mg) => [mg.id, { id: mg.id, pts: 0, pf: 0, won: 0, drawn: 0, lost: 0 }]));
      for (const m of data.matches.filter((x) => x.started && inMonth(x.gw))) {
        for (const [id, pf, pa] of [
          [m.home, m.homePts ?? 0, m.awayPts ?? 0],
          [m.away, m.awayPts ?? 0, m.homePts ?? 0],
        ]) {
          const row = rows.get(id);
          if (!row) continue;
          row.pf += pf;
          if (pf > pa) row.won++;
          else if (pf === pa) row.drawn++;
          else row.lost++;
          row.pts = row.won * meta.scoring.win + row.drawn * meta.scoring.draw + row.lost * meta.scoring.loss;
        }
      }
      return {
        month,
        over: data.gameweeks.filter((g) => inMonth(g.id)).every((g) => g.finished),
        managers: [...rows.values()].sort((a, b) => b.pts - a.pts || b.pf - a.pf),
      };
    })
    .reverse();
}
