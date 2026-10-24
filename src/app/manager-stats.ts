// One manager's season against the rest of the league, for their team's page: their record
// against each opponent, the opposing player who has hurt them most, their closest calls
// and where their points come from. Finished matches only, so a live gameweek waits.

import type { Data, Match, Position } from '../shared/data.ts';

export interface Rivalry {
  opp: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  pf: number;
  pa: number;
  pts: number;
}

export interface Game {
  gw: number;
  opp: number;
  pf: number;
  pa: number;
}

export interface Nemesis {
  player: number;
  pts: number;
  matches: number;
  /** The opponents who fielded him. */
  owners: number[];
}

function games(data: Data, id: number): Game[] {
  return data.matches
    .filter((m): m is Match & { homePts: number; awayPts: number } => m.finished && (m.home === id || m.away === id))
    .map((m) =>
      m.home === id ? { gw: m.gw, opp: m.away, pf: m.homePts, pa: m.awayPts } : { gw: m.gw, opp: m.home, pf: m.awayPts, pa: m.homePts },
    );
}

const pointsIn = (data: Data, pid: number, gw: number) => data.players[pid]?.pts?.[gw - data.meta.firstGw] ?? 0;

// Best record first: table points per match, then points difference per match. Anyone
// not played yet goes last.
export function rivalries(data: Data, id: number): Rivalry[] {
  const { win, draw, loss } = data.meta.scoring;
  const rows = new Map<number, Rivalry>(
    data.managers.filter((m) => m.id !== id).map((m) => [m.id, { opp: m.id, played: 0, won: 0, drawn: 0, lost: 0, pf: 0, pa: 0, pts: 0 }]),
  );
  for (const g of games(data, id)) {
    const r = rows.get(g.opp);
    if (!r) continue;
    r.played++;
    r.pf += g.pf;
    r.pa += g.pa;
    if (g.pf > g.pa) [r.won, r.pts] = [r.won + 1, r.pts + win];
    else if (g.pf === g.pa) [r.drawn, r.pts] = [r.drawn + 1, r.pts + draw];
    else [r.lost, r.pts] = [r.lost + 1, r.pts + loss];
  }
  const perMatch = (r: Rivalry, value: number) => (r.played ? value / r.played : -Infinity);
  return [...rows.values()].sort((a, b) => perMatch(b, b.pts) - perMatch(a, a.pts) || perMatch(b, b.pf - b.pa) - perMatch(a, a.pf - a.pa));
}

// The opposing player with the most points in XIs against this manager.
export function nemesis(data: Data, id: number): Nemesis | null {
  const totals = new Map<number, Nemesis>();
  for (const g of games(data, id)) {
    for (const pid of data.lineups[g.opp]?.[g.gw]?.xi ?? []) {
      const n = totals.get(pid) ?? { player: pid, pts: 0, matches: 0, owners: [] };
      n.pts += pointsIn(data, pid, g.gw);
      n.matches++;
      if (!n.owners.includes(g.opp)) n.owners.push(g.opp);
      totals.set(pid, n);
    }
  }
  const [best] = [...totals.values()].sort((a, b) => b.pts - a.pts || a.matches - b.matches);
  return best?.pts > 0 ? best : null;
}

// The highest score in a defeat and the lowest in a win.
export function closeCalls(data: Data, id: number) {
  const played = games(data, id);
  const [bestDefeat] = played.filter((g) => g.pf < g.pa).sort((a, b) => b.pf - a.pf || a.gw - b.gw);
  const [worstWin] = played.filter((g) => g.pf > g.pa).sort((a, b) => a.pf - b.pf || a.gw - b.gw);
  return { bestDefeat: bestDefeat ?? null, worstWin: worstWin ?? null };
}

// Points scored in the XI, by position.
export function pointsByPosition(data: Data, id: number): Record<Position, number> {
  const split: Record<Position, number> = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const g of games(data, id)) {
    for (const pid of data.lineups[id]?.[g.gw]?.xi ?? []) {
      const p = data.players[pid];
      if (p) split[p.pos] += pointsIn(data, pid, g.gw);
    }
  }
  return split;
}

export function gameIn(data: Data, id: number, gw: number): Game | undefined {
  return games(data, id).find((g) => g.gw === gw);
}
