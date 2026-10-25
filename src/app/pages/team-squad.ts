// A draft team's Squad tab: the squad (or everyone ever owned) with this round's points, the
// next round's expected points and each player's record with the team, then the points by
// position (the Stats tab's too) and the original squad.

import type { Lineup, Position } from '../../shared/data.ts';
import { playerState, type SlimLive } from '../../shared/live.ts';
import { avatar, card, crest, empty, photo, seg, tag, xpPill } from '../components.ts';
import { esc, pct, plural, sum } from '../format.ts';
import { club, gwEvents, gwPoints, isArchive, lineupFor, mgr, nextParts, nextXp, opponents, player, slotOf } from '../lookups.ts';
import { pointsByPosition } from '../manager-stats.ts';
import { roundPill, stateLabel } from '../match-lineups.ts';
import { href } from '../router.ts';
import { D, live, state } from '../state.ts';

const GROUPS: [Position, string][] = [
  ['GKP', 'Goalkeepers'],
  ['DEF', 'Defenders'],
  ['MID', 'Midfielders'],
  ['FWD', 'Forwards'],
];

export const squadOf = (id: number) =>
  Object.keys(D.players)
    .map(Number)
    .filter((pid) => player(pid).owner === id);

// Each player's time with this manager: gameweeks in their lineup (XI or bench), and
// starts and points in the XI, the gameweek being played included.
export function xiRecord(id: number) {
  const record = new Map<number, { pts: number; goals: number; assists: number; starts: number; weeks: number }>();
  const add = (pid: number, started: boolean, gw: number) => {
    const r = record.get(pid) ?? { pts: 0, goals: 0, assists: 0, starts: 0, weeks: 0 };
    r.weeks++;
    if (started) {
      const ev = gwEvents(pid, gw);
      r.pts += gwPoints(pid, gw);
      r.goals += ev?.goals ?? 0;
      r.assists += ev?.assists ?? 0;
      r.starts++;
    }
    record.set(pid, r);
  };
  for (let gw = D.meta.firstGw; gw <= D.meta.currentGw; gw++) {
    const l = lineupFor(id, gw);
    for (const pid of l?.xi ?? []) add(pid, true, gw);
    for (const pid of l?.bench ?? []) add(pid, false, gw);
  }
  return record;
}

// What the squad's rows and columns read: this gameweek's lineup and live feed, the squad
// now, and each player's record with this manager.
interface Squad {
  id: number;
  gw: number;
  l: Lineup | undefined;
  feed: SlimLive | null;
  owned: Set<number>;
  record: ReturnType<typeof xiRecord>;
}

interface SquadColumn {
  key: string;
  label: string;
  tip: string;
  value: (pid: number) => number;
  cell: (pid: number) => string;
  cls?: string;
}

// In this gameweek's lineup or not ('out'); 'none' before the first gameweek.
const roleIn = (l: Lineup | undefined, pid: number) => (!l ? 'none' : l.xi.includes(pid) ? 'xi' : l.bench.includes(pid) ? 'bench' : 'out');
const ROLE_ORDER = { xi: 0, bench: 1, out: 2, none: 3 };
const DASH = '<span class="muted">–</span>';
const REGROUP =
  '<button type="button" class="sq-label sq-sort" data-action="squad-sort" data-value="lineup" aria-pressed="false" data-tip="Group by position, in lineup order">Position</button>';

const xiPoints = (sq: Squad, pid: number) => sq.record.get(pid)?.pts ?? 0;
const matchOf = (sq: Squad, pid: number) => (sq.feed && roleIn(sq.l, pid) !== 'out' ? playerState(sq.feed, pid, player(pid).club) : null);

export function squadCard(id: number) {
  const squad = squadOf(id);
  if (!squad.length) return card({ title: 'Squad', body: empty('No players yet') });
  const gw = D.meta.currentGw;
  const sq: Squad = {
    id,
    gw,
    l: gw >= D.meta.firstGw ? lineupFor(id, gw) : undefined,
    feed: live?.gw === gw ? live.feed : null,
    owned: new Set(squad),
    record: xiRecord(id),
  };
  const allTime = state.squadScope === 'all';
  const players = allTime ? everOwned(id, squad) : squad;
  const scope = seg(
    'squad-scope',
    [
      ['now', 'Current'],
      ['all', 'All-time'],
    ],
    allTime ? 'all' : 'now',
  );
  return card({
    title: 'Squad',
    sub: squadSub(sq, players, allTime),
    action: scope,
    body: `<div class="squad">${squadList(sq, players)}</div>`,
  });
}

function squadSub(sq: Squad, players: number[], allTime: boolean) {
  const count = plural(players.length, 'player');
  if (allTime) return `${count} ever owned · ${sum(players.map((pid) => xiPoints(sq, pid)))} pts in the XI`;
  return sq.l ? `${count} · ${sq.l.pts} pts in GW ${sq.gw}${sq.feed ? ' so far' : ''}` : count;
}

// Grouped by position in lineup order, or one list sorted on a column, highest first,
// with each player's position as a chip. Tapping the column again, or Position, groups
// them again.
function squadList(sq: Squad, players: number[]) {
  const columns = squadColumns(sq);
  const sorted = columns.find((c) => c.key === state.squadSort);
  const byLineup = (a: number, b: number) =>
    Number(!sq.owned.has(a)) - Number(!sq.owned.has(b)) ||
    ROLE_ORDER[roleIn(sq.l, a)] - ROLE_ORDER[roleIn(sq.l, b)] ||
    xiPoints(sq, b) - xiPoints(sq, a);
  const order = (a: number, b: number) => (sorted ? sorted.value(b) - sorted.value(a) : 0) || byLineup(a, b);
  const heads = sortButtons(columns, sorted);
  const head = (label: string) => `<div class="sq-head">${label}${heads}</div>`;
  const row = (pid: number) => squadRow(sq, columns, Boolean(sorted), pid);
  if (sorted) return head(REGROUP) + [...players].sort(order).map(row).join('');
  return GROUPS.map(([pos, label]) => {
    const ids = players.filter((pid) => player(pid).pos === pos).sort(order);
    return ids.length ? head(`<span class="sq-label">${label}</span>`) + ids.map(row).join('') : '';
  }).join('');
}

function squadColumns(sq: Squad): SquadColumn[] {
  const name = mgr(sq.id)!.first;
  const weeks = (pid: number) => sq.record.get(pid)?.weeks ?? 0;
  const total = (pid: number) => xiPoints(sq, pid);
  const showXp = !isArchive() && D.meta.nextGw <= D.meta.lastGw;
  const columns = [
    {
      key: 'weeks',
      label: 'GWs',
      tip: `Gameweeks in ${name}’s squad, in the XI or on the bench`,
      value: weeks,
      cell: (pid: number) => String(weeks(pid)),
    },
    sq.l && gwColumn(sq, sq.l),
    showXp && xpColumn(sq),
    {
      key: 'total',
      label: 'Total',
      tip: `Points in ${name}’s XI this season`,
      value: total,
      cell: (pid: number) => String(total(pid)),
      cls: 'sq-total',
    },
  ];
  return columns.filter((c): c is SquadColumn => !!c);
}

function gwColumn(sq: Squad, l: Lineup): SquadColumn {
  const out = (pid: number) => roleIn(l, pid) === 'out';
  return {
    key: 'gw',
    label: `GW${sq.gw}`,
    tip: `Points in GW ${sq.gw}${sq.feed ? ', live' : ''}`,
    value: (pid) => (out(pid) ? -1 : gwPoints(pid, sq.gw)),
    cell: (pid) => (out(pid) ? DASH : roundPill(pid, sq.gw, matchOf(sq, pid))),
    cls: 'sq-gw',
  };
}

// The next gameweek's expected points, for the squad now only.
function xpColumn(sq: Squad): SquadColumn {
  const { nextGw } = D.meta;
  return {
    key: 'xp',
    label: 'xP',
    tip: `Expected points for GW ${nextGw}${state.xp === 'fpl' ? ' (FPL’s form)' : ''}`,
    value: (pid) => (sq.owned.has(pid) ? nextXp(pid) : -1),
    cell: (pid) => (sq.owned.has(pid) ? xpPill(nextXp(pid), nextParts(pid), opponents(player(pid).club, nextGw)) : DASH),
  };
}

function sortButtons(columns: SquadColumn[], sorted: SquadColumn | undefined) {
  return columns
    .map((c) => {
      const on = c === sorted;
      const tip = `${c.tip} · ${on ? 'tap again for the lineup order' : 'tap to sort'}`;
      return `<button type="button" class="sq-num sq-sort" data-action="squad-sort" data-value="${on ? 'lineup' : c.key}" aria-pressed="${on}" data-tip="${esc(tip)}">${c.label}</button>`;
    })
    .join('');
}

function squadRow(sq: Squad, columns: SquadColumn[], sorted: boolean, pid: number) {
  const p = player(pid);
  const role = roleIn(sq.l, pid);
  const match = matchOf(sq, pid);
  const owned = sq.owned.has(pid);
  // Sorted, the position chip takes the room of the club's short name; the crest stays.
  const where = sorted
    ? `<span class="pos-tag pos-${p.pos}">${p.pos}</span>${crest(p.club, 14)}`
    : `${crest(p.club, 14)}${esc(club(p.club).short)}`;
  const meta = [where, squadNote(sq, pid, role)].filter(Boolean).join(' · ');
  const flag = owned && p.status !== 'a' ? tag('!', p.news || 'Flagged', 'tag-flag') : '';
  const state = match ? stateLabel(match) : ''; // by the name, or on a phone in a column of its own (squads.css)
  return `<a class="sq-row${role === 'bench' ? ' benched' : ''}${owned ? '' : ' gone'}" href="${href.player(pid)}">
      ${photo(pid, 32)}
      <div class="sq-main"><div class="sq-name"><span>${esc(p.name)}</span>${flag}${state}</div><div class="sq-meta">${meta}</div>${state}</div>
      ${columns.map((c) => `<span class="sq-num ${c.cls ?? ''}">${c.cell(pid)}</span>`).join('')}
    </a>`;
}

// Lineups already have the automatic substitutions made.
function squadNote(sq: Squad, pid: number, role: ReturnType<typeof roleIn>) {
  if (!sq.owned.has(pid)) {
    const owner = player(pid).owner;
    return `<span data-tip="${owner ? `Now with ${esc(mgr(owner)?.first)}` : 'A free agent now'}">Left</span>`;
  }
  if (role === 'bench') return 'Bench';
  if (role === 'out') return `<span data-tip="Joined after the GW ${sq.gw} deadline, so not in that lineup">New</span>`;
  return sq.l?.subs.includes(pid) ? `<span data-tip="Came on as an automatic substitute in GW ${sq.gw}">Auto-sub</span>` : '';
}

// The squad now, plus everyone the manager drafted, signed or put in a lineup.
export function everOwned(id: number, squad: number[]) {
  const picked = Object.values(D.lineups[id] ?? {}).flatMap((l) => [...l.xi, ...l.bench]);
  const drafted = D.draft.picks.filter((pk) => pk.manager === id).map((pk) => pk.player);
  const signings = D.transfers.moves.filter((mv) => mv.manager === id).map((mv) => mv.in);
  return [...new Set([...squad, ...picked, ...drafted, ...signings])].filter((pid) => player(pid));
}

// Where the XI's points come from, as bars against the biggest share.
function positionSplit(id: number) {
  const split = pointsByPosition(D, id);
  const total = sum(Object.values(split));
  if (!total) return '';
  const top = Math.max(...Object.values(split));
  const rows = GROUPS.map(
    ([pos, label]) =>
      `<div class="pos-row" data-tip="${label}: ${split[pos]} pts, ${pct(split[pos] / total)} of the XI’s points"><span class="pos-label">${pos}</span><span class="pos-track"><i class="m${slotOf(id)}" style="width:${((split[pos] / top) * 100).toFixed(1)}%"></i></span><span class="pos-value">${split[pos]}</span></div>`,
  ).join('');
  return `<div class="pos-split">${rows}</div>`;
}

export function positionCard(id: number) {
  const split = positionSplit(id);
  return split ? card({ title: 'Points by position', body: split }) : '';
}

// The draft picks still here, those gone and where to, and who has come in since.
export function originalCard(id: number) {
  const r = D.draft.retention.find((x) => x.id === id);
  if (!r) return '';
  const chipOf = (pid: number, note = '') =>
    `<a class="pchip" href="${href.player(pid)}">${crest(player(pid).club, 14)}${esc(player(pid).name)}${note}</a>`;
  const where = (owner: number | null) => (owner ? avatar(owner) : tag('FA', 'A free agent now'));
  return card({
    title: 'Original squad',
    body: `<div class="squad-detail">
      <div><div class="squad-head">Still here · ${r.kept.length}</div><div class="pchips">${r.kept.map((pid) => chipOf(pid)).join('') || '<span class="muted">Nobody</span>'}</div></div>
      <div><div class="squad-head">Gone · ${r.gone.length}</div><div class="pchips">${r.gone.map((g) => chipOf(g.player, where(g.owner))).join('') || '<span class="muted">Nobody, yet</span>'}</div></div>
      <div><div class="squad-head">Signed since · ${r.newcomers.length}</div><div class="pchips">${r.newcomers.map((pid) => chipOf(pid)).join('') || '<span class="muted">Nobody</span>'}</div></div>
    </div>`,
  });
}
