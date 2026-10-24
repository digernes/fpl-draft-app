// Everything that has happened to a player in the draft league, from data.json alone:
// who drafted him, each gameweek's owner and whether he started, sat on the bench or
// came on as an automatic substitute, the waiver claims for him and those that tried to
// drop him, his moves and trades, and the weeks nobody wanted him (from the gameweek FPL
// added him, for one added after the draft). Split into spells, a stretch with one owner
// or none, each with what happened in it.

import type { Claim, Data, DraftPick, MoveType } from '../shared/data.ts';

export type Role = 'xi' | 'bench' | 'free';

export interface Week {
  gw: number;
  /** Whose squad he was in at the deadline, if anyone's. */
  owner: number | null;
  /** Where the manager picked him. */
  role: Role;
  /** An automatic substitution: brought on from the bench, or replaced in the XI for not playing. */
  auto?: 'on' | 'off';
  /** His points counted for the manager: in the XI once the automatic substitutions were made. */
  counted: boolean;
  pts: number;
  /** Waiver claims for him that gameweek. */
  claims: number;
}

export type StoryEvent = { gw: number } & (
  | { kind: 'signed'; manager: number; type: MoveType; out: number }
  | { kind: 'dropped'; manager: number; type: MoveType; in: number }
  /**
   * A waiver claim for him, dropping `out`, that didn't go through (one that did is his
   * signing): `instead` when the manager's claim for another, dropping the same, went first.
   */
  | { kind: 'claim'; manager: number; out: number; outcome: Exclude<Claim['outcome'], 'won'>; winner: number | null; instead?: number }
  /** A claim that would have dropped him for `instead`, which didn't go through. */
  | { kind: 'kept'; manager: number; instead: number; winner: number | null }
  | { kind: 'traded'; from: number; to: number; for: number[] }
  /** A trade for him, or of him, that didn't happen. */
  | { kind: 'offer'; by: number; to: number; state: string; for: number[]; wanted: boolean }
  /** Came on for `for` (unknown in older archives). */
  | { kind: 'subOn'; manager: number; for?: number; pts: number }
  | { kind: 'subOff'; manager: number; by: number }
);

export interface Spell {
  owner: number | null;
  from: number;
  /** Null while it goes on. */
  to: number | null;
  weeks: Week[];
  events: StoryEvent[];
}

export interface OwnerTotals {
  owner: number;
  weeks: number;
  /** Weeks his points counted, and those points. */
  starts: number;
  xiPts: number;
  /** Weeks left on the bench, and the points he scored there. */
  benched: number;
  benchPts: number;
}

export interface History {
  pick: DraftPick | undefined;
  /** The first gameweek he was in the game, when FPL added him after the draft. */
  added?: number;
  /** Every waiver claim for him, those that went through too. */
  claims: Claim[];
  weeks: Week[];
  spells: Spell[];
  owners: OwnerTotals[];
  /** As a free agent: gameweeks, those nobody claimed him in, and his points then. */
  free: { weeks: number; unclaimed: number; pts: number };
}

// Within a gameweek: its waivers and moves come before what happened in its matches.
const PHASE: Record<StoryEvent['kind'], number> = { claim: 0, kept: 0, signed: 1, dropped: 1, traded: 1, offer: 1, subOn: 2, subOff: 2 };

export function playerHistory(data: Data, pid: number): History {
  const { meta, transfers } = data;
  const fromMatches = (gw: number) =>
    (data.plMatches ?? [])
      .filter((m) => m.gw === gw)
      .flatMap((m) => (m.lineups ?? []).flat())
      .filter(([id]) => id === pid)
      .reduce((total, [, , pts]) => total + pts, 0);
  const pointsIn = (gw: number) => data.players[pid]?.pts?.[gw - meta.firstGw] ?? fromMatches(gw);

  const added = data.players[pid]?.added;
  const weeks: Week[] = [];
  const events: StoryEvent[] = [];
  for (let gw = Math.max(meta.firstGw, added ?? meta.firstGw); gw <= meta.currentGw; gw++) {
    const claims = transfers.claims.filter((c) => c.in === pid && c.gw === gw).length;
    const week: Week = { gw, owner: null, role: 'free', counted: false, pts: pointsIn(gw), claims };
    for (const mg of data.managers) {
      const l = data.lineups[mg.id]?.[gw];
      if (!l) continue;
      // Lineups come with the automatic substitutions made, so a substitute is in the XI
      // and the starter he replaced on the bench.
      const on = l.subs.indexOf(pid);
      const off = l.off?.indexOf(pid) ?? -1;
      const picked = (role: Role, counted: boolean, auto?: Week['auto']) =>
        Object.assign(week, { owner: mg.id, role, counted }, auto && { auto });
      if (l.xi.includes(pid)) picked(on >= 0 ? 'bench' : 'xi', true, on >= 0 ? 'on' : undefined);
      else if (l.bench.includes(pid)) picked(off >= 0 ? 'xi' : 'bench', false, off >= 0 ? 'off' : undefined);
      if (on >= 0) events.push({ gw, kind: 'subOn', manager: mg.id, for: l.off?.[on], pts: week.pts });
      if (off >= 0) events.push({ gw, kind: 'subOff', manager: mg.id, by: l.subs[off] });
    }
    weeks.push(week);
  }

  for (const mv of transfers.moves) {
    if (mv.type === 'trade') continue;
    if (mv.in === pid) events.push({ gw: mv.gw, kind: 'signed', manager: mv.manager, type: mv.type, out: mv.out });
    if (mv.out === pid) events.push({ gw: mv.gw, kind: 'dropped', manager: mv.manager, type: mv.type, in: mv.in });
  }
  for (const t of transfers.trades) {
    const gives = t.items.map((i) => i.gives);
    const gets = t.items.map((i) => i.gets);
    // The side that gives him up, and the players going the other way.
    const [from, to, back] = gives.includes(pid)
      ? [t.offeredBy, t.offeredTo, gets]
      : gets.includes(pid)
        ? [t.offeredTo, t.offeredBy, gives]
        : [];
    if (from === undefined) continue;
    if (t.state === 'p') events.push({ gw: t.gw, kind: 'traded', from, to: to!, for: back! });
    else events.push({ gw: t.gw, kind: 'offer', by: t.offeredBy, to: t.offeredTo, state: t.state, for: back!, wanted: gets.includes(pid) });
  }
  for (const c of transfers.claims) {
    if (c.in === pid && c.outcome !== 'won') {
      const instead = transfers.claims.find((w) => w.outcome === 'won' && w.manager === c.manager && w.gw === c.gw && w.out === c.out)?.in;
      events.push({
        gw: c.gw,
        kind: 'claim',
        manager: c.manager,
        out: c.out,
        outcome: c.outcome,
        winner: c.winner,
        ...(instead && { instead }),
      });
    }
    // A claim to drop him that didn't go through, unless another of the manager's did.
    const dropped = transfers.moves.some((mv) => mv.out === pid && mv.manager === c.manager && mv.gw === c.gw);
    if (c.out === pid && c.outcome !== 'won' && !dropped)
      events.push({ gw: c.gw, kind: 'kept', manager: c.manager, instead: c.in, winner: c.winner });
  }
  events.sort((a, b) => a.gw - b.gw || PHASE[a.kind] - PHASE[b.kind]);

  // Spells of one owner (or none), and one more for a move into the gameweek to come.
  const spells: Spell[] = [];
  for (const week of weeks) {
    const last = spells.at(-1);
    if (last && last.owner === week.owner) {
      last.weeks.push(week);
      last.to = week.gw;
    } else spells.push({ owner: week.owner, from: week.gw, to: week.gw, weeks: [week], events: [] });
  }
  const owner = data.players[pid]?.owner ?? null;
  const later = events.some((e) => e.gw > meta.currentGw);
  if (!spells.length || later || spells.at(-1)!.owner !== owner)
    spells.push({ owner, from: Math.max(meta.currentGw + 1, meta.firstGw), to: null, weeks: [], events: [] });
  else spells.at(-1)!.to = null;
  for (const e of events) {
    const spell = [...spells].reverse().find((s) => s.from <= e.gw) ?? spells[0];
    spell.events.push(e);
  }

  const owners = new Map<number, OwnerTotals>();
  for (const w of weeks) {
    if (w.owner === null) continue;
    const t =
      owners.get(w.owner) ?? owners.set(w.owner, { owner: w.owner, weeks: 0, starts: 0, benched: 0, xiPts: 0, benchPts: 0 }).get(w.owner)!;
    t.weeks++;
    if (w.counted) {
      t.starts++;
      t.xiPts += w.pts;
    } else if (w.role === 'bench') {
      t.benched++;
      t.benchPts += w.pts;
    }
  }
  const free = weeks.filter((w) => w.role === 'free');
  return {
    pick: data.draft.picks.find((p) => p.player === pid),
    ...(added === undefined ? {} : { added }),
    claims: transfers.claims.filter((c) => c.in === pid),
    weeks,
    spells,
    owners: [...owners.values()].sort((a, b) => b.xiPts - a.xiPts || b.weeks - a.weeks),
    free: { weeks: free.length, unclaimed: free.filter((w) => !w.claims).length, pts: free.reduce((t, w) => t + w.pts, 0) },
  };
}
