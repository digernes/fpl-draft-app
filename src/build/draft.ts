// The draft itself and how much of each original squad is still there.

import type { Draft, DraftPick, Retention } from '../shared/data.ts';
import type { lineupOf } from './lineups.ts';
import type { Season } from './season.ts';
import { groupBy, round, sum } from './util.ts';

type LineupOf = ReturnType<typeof lineupOf>;

export function buildDraft(season: Season, managerIds: number[], lineup: LineupOf): Draft {
  const { choices, ownerNow, gws, pointsIn, elements } = season;
  const squadAt = (entry: number, gw: number) => {
    const l = lineup(entry, gw);
    return l ? new Set([...l.xi, ...l.bench]) : null;
  };

  const picks: DraftPick[] = choices
    .filter((c) => c.element)
    .sort((a, b) => a.index - b.index)
    .map((c) => ({ overall: c.index, round: c.round, pick: c.pick, manager: c.entry, player: c.element as number, auto: c.was_auto }));
  const originals = groupBy(picks, (p) => p.manager);
  const xiPointsOf = (id: number, keep: (pid: number) => boolean) =>
    sum(gws.flatMap((gw) => (lineup(id, gw)?.xi ?? []).filter(keep).map((pid) => pointsIn(pid, gw))));
  const retention: Retention[] = managerIds.map((id) => {
    const original = new Set((originals[id] ?? []).map((p) => p.player));
    const current = [...ownerNow].filter(([, owner]) => owner === id).map(([pid]) => pid);
    const total = xiPointsOf(id, () => true);
    const fromOriginals = xiPointsOf(id, (pid) => original.has(pid));
    return {
      id,
      size: original.size,
      kept: [...original].filter((pid) => ownerNow.get(pid) === id),
      gone: [...original].filter((pid) => ownerNow.get(pid) !== id).map((pid) => ({ player: pid, owner: ownerNow.get(pid) ?? null })),
      newcomers: current.filter((pid) => !original.has(pid)),
      byGw: gws.map((gw) => [...(squadAt(id, gw) ?? [])].filter((pid) => original.has(pid)).length),
      originalShare: total ? round(fromOriginals / total, 3) : 0,
      originalXiPts: fromOriginals,
      draftHaul: sum([...original].map((pid) => elements.get(pid)?.total_points ?? 0)),
    };
  });
  return { picks, retention };
}
