// Everything that has happened to a player in the draft league, from data.json alone:
// who drafted him, each gameweek's owner and whether he started, sat on the bench or
// came on as an automatic substitute, the waiver claims for him and those that tried to
// drop him, his moves and trades, and the weeks nobody wanted him (from the gameweek FPL
// added him, for one added after the draft). Split into spells, a stretch with one owner
// or none, each with what happened in it.

import type { Claim, Data, DraftPick, Lineup, Move, MoveType, Trade, Transfers } from '../shared/data.ts';

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
  /**
   * A claim that would have dropped him for `instead`, which didn't go through: `kept` when he
   * stayed, `tried` when the manager let him go that gameweek all the same.
   */
  | { kind: 'kept' | 'tried'; manager: number; instead: number; winner: number | null }
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
const PHASE: Record<StoryEvent['kind'], number> = {
  claim: 0,
  kept: 0,
  tried: 0,
  signed: 1,
  dropped: 1,
  traded: 1,
  offer: 1,
  subOn: 2,
  subOff: 2,
};

export function playerHistory(data: Data, pid: number): History {
  const { transfers } = data;
  const added = data.players[pid]?.added;
  const { weeks, subs } = weeksOf(data, pid, added);
  const events = [...subs, ...moveEvents(transfers.moves, pid), ...tradeEvents(transfers.trades, pid), ...claimEvents(transfers, pid)];
  events.sort((a, b) => a.gw - b.gw || PHASE[a.kind] - PHASE[b.kind]);
  return {
    pick: data.draft.picks.find((p) => p.player === pid),
    ...(added === undefined ? {} : { added }),
    claims: transfers.claims.filter((c) => c.in === pid),
    weeks,
    spells: spellsOf(data, pid, weeks, events),
    owners: ownerTotals(weeks),
    free: freeTotals(weeks),
  };
}

// --- His gameweeks -----------------------------------------------------------------------

// Each gameweek from the first he was in the game: whose squad he was in, and the automatic
// substitutions that brought him on or took him off.
function weeksOf(data: Data, pid: number, added: number | undefined) {
  const { meta } = data;
  const weeks: Week[] = [];
  const subs: StoryEvent[] = [];
  for (let gw = Math.max(meta.firstGw, added ?? meta.firstGw); gw <= meta.currentGw; gw++) {
    const claims = data.transfers.claims.filter((c) => c.in === pid && c.gw === gw).length;
    const week: Week = { gw, owner: null, role: 'free', counted: false, pts: pointsIn(data, pid, gw), claims };
    for (const mg of data.managers) {
      const l = data.lineups[mg.id]?.[gw];
      if (!l) continue;
      const spot = placeIn(l, pid);
      if (spot) Object.assign(week, { owner: mg.id }, spot);
      subs.push(...subEvents(week, mg.id, l, pid));
    }
    weeks.push(week);
  }
  return { weeks, subs };
}

function pointsIn(data: Data, pid: number, gw: number) {
  return data.players[pid]?.pts?.[gw - data.meta.firstGw] ?? fromMatches(data, pid, gw);
}

function fromMatches(data: Data, pid: number, gw: number) {
  return (data.plMatches ?? [])
    .filter((m) => m.gw === gw)
    .flatMap((m) => (m.lineups ?? []).flat())
    .filter(([id]) => id === pid)
    .reduce((total, [, , pts]) => total + pts, 0);
}

// Where the manager picked him. Lineups come with the automatic substitutions made, so a
// substitute is in the XI and the starter he replaced on the bench.
function placeIn(l: Lineup, pid: number): Pick<Week, 'role' | 'counted' | 'auto'> | undefined {
  if (l.xi.includes(pid)) return l.subs.includes(pid) ? { role: 'bench', counted: true, auto: 'on' } : { role: 'xi', counted: true };
  if (l.bench.includes(pid)) return l.off?.includes(pid) ? { role: 'xi', counted: false, auto: 'off' } : { role: 'bench', counted: false };
  return undefined;
}

function subEvents({ gw, pts }: Week, manager: number, l: Lineup, pid: number): StoryEvent[] {
  const on = l.subs.indexOf(pid);
  const off = l.off?.indexOf(pid) ?? -1;
  const events: StoryEvent[] = [];
  if (on >= 0) events.push({ gw, kind: 'subOn', manager, for: l.off?.[on], pts });
  if (off >= 0) events.push({ gw, kind: 'subOff', manager, by: l.subs[off] });
  return events;
}

// --- His moves, trades and claims --------------------------------------------------------

function moveEvents(moves: Move[], pid: number) {
  const events: StoryEvent[] = [];
  for (const mv of moves) {
    if (mv.type === 'trade') continue;
    if (mv.in === pid) events.push({ gw: mv.gw, kind: 'signed', manager: mv.manager, type: mv.type, out: mv.out });
    if (mv.out === pid) events.push({ gw: mv.gw, kind: 'dropped', manager: mv.manager, type: mv.type, in: mv.in });
  }
  return events;
}

function tradeEvents(trades: Trade[], pid: number) {
  const events: StoryEvent[] = [];
  for (const t of trades) {
    const side = tradeSide(t, pid);
    if (!side) continue;
    const { from, to, back, wanted } = side;
    if (t.state === 'p') events.push({ gw: t.gw, kind: 'traded', from, to, for: back });
    else events.push({ gw: t.gw, kind: 'offer', by: t.offeredBy, to: t.offeredTo, state: t.state, for: back, wanted });
  }
  return events;
}

// The side of a trade that gives him up, and the players going the other way.
function tradeSide(t: Trade, pid: number) {
  const gives = t.items.map((i) => i.gives);
  const gets = t.items.map((i) => i.gets);
  const wanted = gets.includes(pid);
  if (gives.includes(pid)) return { from: t.offeredBy, to: t.offeredTo, back: gets, wanted };
  if (wanted) return { from: t.offeredTo, to: t.offeredBy, back: gives, wanted };
  return undefined;
}

function claimEvents(transfers: Transfers, pid: number) {
  const events: StoryEvent[] = [];
  for (const c of transfers.claims) {
    if (c.outcome === 'won') continue;
    if (c.in === pid) events.push(missedClaim(transfers.claims, c, c.outcome));
    const drop = claimToDrop(transfers, c, pid);
    if (drop) events.push(drop);
  }
  return events;
}

// A claim for him that didn't go through.
function missedClaim(claims: Claim[], c: Claim, outcome: Exclude<Claim['outcome'], 'won'>): StoryEvent {
  const instead = wonFirst(claims, c)?.in;
  return { gw: c.gw, kind: 'claim', manager: c.manager, out: c.out, outcome, winner: c.winner, ...(instead && { instead }) };
}

// A claim to drop him that didn't go through, unless one of the manager's that did had
// dropped him already. When he went all the same that gameweek (on a claim ranked below,
// as a free agent or in a trade), only one lost to another manager is told: a void one
// may have fallen through because he had gone already.
function claimToDrop(transfers: Transfers, c: Claim, pid: number): StoryEvent | undefined {
  if (c.out !== pid || wonFirst(transfers.claims, c)) return undefined;
  const went = transfers.moves.some((mv) => mv.out === pid && mv.manager === c.manager && mv.gw === c.gw);
  if (went && c.outcome !== 'lost') return undefined;
  return { gw: c.gw, kind: went ? 'tried' : 'kept', manager: c.manager, instead: c.in, winner: c.winner };
}

// The manager's claim dropping the same player that went through ahead of `c`: ranked above
// it, so FPL tried it first (or either is from before FPL kept a priority, and there's no telling).
const wonFirst = (claims: Claim[], c: Claim) => claims.find((w) => w.outcome === 'won' && sameDrop(w, c) && rankedAbove(w, c));

const sameDrop = (w: Claim, c: Claim) => w.manager === c.manager && w.gw === c.gw && w.out === c.out;

const rankedAbove = (w: Claim, c: Claim) => w.priority === null || c.priority === null || w.priority < c.priority;

// --- Spells and totals -------------------------------------------------------------------

// Spells of one owner (or none), and one more for a move into the gameweek to come.
function spellsOf(data: Data, pid: number, weeks: Week[], events: StoryEvent[]) {
  const { meta } = data;
  const spells = ownerSpells(weeks);
  const owner = data.players[pid]?.owner ?? null;
  const later = events.some((e) => e.gw > meta.currentGw);
  if (!spells.length || later || spells.at(-1)!.owner !== owner)
    spells.push({ owner, from: Math.max(meta.currentGw + 1, meta.firstGw), to: null, weeks: [], events: [] });
  else spells.at(-1)!.to = null;
  for (const e of events) spellAt(spells, e.gw).events.push(e);
  return spells;
}

function ownerSpells(weeks: Week[]) {
  const spells: Spell[] = [];
  for (const week of weeks) {
    const last = spells.at(-1);
    if (last && last.owner === week.owner) {
      last.weeks.push(week);
      last.to = week.gw;
    } else spells.push({ owner: week.owner, from: week.gw, to: week.gw, weeks: [week], events: [] });
  }
  return spells;
}

const spellAt = (spells: Spell[], gw: number) => [...spells].reverse().find((s) => s.from <= gw) ?? spells[0];

function ownerTotals(weeks: Week[]) {
  const owners = new Map<number, OwnerTotals>();
  for (const w of weeks) {
    if (w.owner === null) continue;
    const t =
      owners.get(w.owner) ?? owners.set(w.owner, { owner: w.owner, weeks: 0, starts: 0, benched: 0, xiPts: 0, benchPts: 0 }).get(w.owner)!;
    addWeek(t, w);
  }
  return [...owners.values()].sort((a, b) => b.xiPts - a.xiPts || b.weeks - a.weeks);
}

function addWeek(t: OwnerTotals, w: Week) {
  t.weeks++;
  if (w.counted) {
    t.starts++;
    t.xiPts += w.pts;
  } else if (w.role === 'bench') {
    t.benched++;
    t.benchPts += w.pts;
  }
}

function freeTotals(weeks: Week[]): History['free'] {
  const free = weeks.filter((w) => w.role === 'free');
  return { weeks: free.length, unclaimed: free.filter((w) => !w.claims).length, pts: free.reduce((t, w) => t + w.pts, 0) };
}
