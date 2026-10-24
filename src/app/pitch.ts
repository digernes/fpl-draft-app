// Lineups on a pitch, as on fotmob.com: a team's XI in lines from the goalkeeper up
// (its "Last starting XI"), or both XIs of a match on one pitch. Each player has their
// photo, a points badge, what they did around the photo and their name.

import type { Position } from '../shared/data.ts';
import type { PlayerEvents } from '../shared/live.ts';
import { avatar, crest, photo } from './components.ts';
import { eventRow, eventSlots, type EventSlots } from './event-icons.ts';
import { esc } from './format.ts';
import { arrowSvg } from './icons.ts';
import { club, first, mgr, namedIn, player, slotOf } from './lookups.ts';
import { href } from './router.ts';
import { D } from './state.ts';

export interface PitchPlayer {
  pid: number;
  /** Top right of the photo: the points. */
  badge: string;
  /** What they did in the gameweek: icons around the photo (see event-icons.ts), or in a line on a bench row. */
  events?: PlayerEvents;
  /** Other icons around the photo instead, like the season's goals and assists. */
  icons?: EventSlots;
  /** By his name: the mark of an automatic substitute. */
  mark?: string;
  /** In a real match's lineup: whose draft squad he is in (his name a pill in that manager's colours), or null for nobody's. No crest then. */
  owner?: number | null;
  /** And whether that manager has him on the bench, where his points don't count (the pill only outlined), or in the XI; unknown for a gameweek to come. */
  benched?: boolean;
  /** The real match's gameweek, when the pill leads to that manager's head-to-head in it. */
  gw?: number;
  /** Under the name: where their match stands, or that they play twice. */
  note?: string;
  tip?: string;
  faded?: boolean;
}

export interface PitchSide {
  /** The manager, whose avatar and name head the side, unless `logo` and `name` are given (a club's). */
  id: number;
  logo?: string;
  name?: string;
  xi: PitchPlayer[];
  /** A real formation's lines from the goalkeeper up, each from the right of the team to its left, and its shape; without them the XI goes in lines by FPL position. */
  lines?: PitchPlayer[][];
  shape?: string;
  /** Under the name: how far through the gameweek, or the projected total. */
  note?: string;
  /** At the outer end of its header, as fotmob.com's team rating: the side's total. */
  total?: string;
}

const LINES: Position[] = ['FWD', 'MID', 'DEF', 'GKP'];

// A penalty area with its goal line at the bottom, after fotmob.com's.
const box = (cls: string) =>
  `<svg class="pitch-mark ${cls}" viewBox="0 0 316 174" aria-hidden="true"><path d="M3 174V40a10 10 0 0 1 10-10h290a10 10 0 0 1 10 10v134M102.6 30a76.8 76.8 0 0 1 110.8 0M84 174v-52a8 8 0 0 1 8-8h132a8 8 0 0 1 8 8v52"/></svg>`;

/**
 * An automatic substitution's mark by a name: one who came on for `other`, or (off) a
 * starter who made way for him: `left out` of his club's squad, or on its bench and not on.
 */
export function autoSubMark(dir: 'on' | 'off', other?: number, leftOut = false) {
  const name = other === undefined ? undefined : player(other)?.name;
  const tip =
    dir === 'on'
      ? `Came on for ${name ?? 'a starter who didn’t play'}, an automatic substitution`
      : `${leftOut ? 'Not in the squad' : 'Didn’t play'}, so ${name ?? 'a substitute'} came on for him`;
  return `<span class="pp-sub ${dir}" data-tip="${esc(tip)}">${arrowSvg}</span>`;
}

/** The mark for a player in a lineup that gameweek, if he was in one of its automatic substitutions. */
export function autoSubOf(l: { subs: number[]; off?: number[] }, pid: number, gw: number) {
  const on = l.subs.indexOf(pid);
  if (on >= 0) return autoSubMark('on', l.off?.[on]);
  const off = l.off?.indexOf(pid) ?? -1;
  return off >= 0 ? autoSubMark('off', l.subs[off], leftOut(pid, gw)) : '';
}

// Left out of his club's squad for each of its matches that gameweek, as the Premier
// League's lineups have it.
function leftOut(pid: number, gw: number) {
  const named = namedIn(gw);
  const fixtures = (D.plMatches ?? []).filter((x) => x.gw === gw && (x.home === player(pid)?.club || x.away === player(pid)?.club));
  return fixtures.length > 0 && fixtures.every((x) => named(pid, x.id) === 'out');
}

export const formationOf = (xi: number[]) =>
  (['DEF', 'MID', 'FWD'] as const).map((pos) => xi.filter((pid) => player(pid).pos === pos).length).join('-');

// His name under the photo: with his club's crest, or in a real match as a pill in the
// colours of the manager who has him, that manager's avatar at its left.
function nameOf(p: PitchPlayer, club: number, name: string) {
  if (p.owner === undefined) return `<div class="pp-name">${crest(club, 12)}<span>${esc(name)}</span>${p.mark ?? ''}</div>`;
  if (p.owner === null) return `<div class="pp-name"><span>${esc(name)}</span>${p.mark ?? ''}</div>`;
  return ownerPill(p.owner, p.benched, name, { tag: 'div', gw: p.gw });
}

/**
 * An owned player's name in a real match: a pill in his manager's colours, their avatar at
 * its left, only outlined on the bench. With `gw`, a tap on it opens that manager's
 * head-to-head that gameweek on its lineup, rather than the player.
 */
export function ownerPill(
  owner: number,
  benched: boolean | undefined,
  name: string,
  { tag = 'span', gw }: { tag?: string; gw?: number } = {},
) {
  const who = mgr(owner)?.first ?? '?';
  const where = benched ? `on ${who}’s bench` : benched === false ? `in ${who}’s XI` : `in ${who}’s squad`;
  const m = gw === undefined ? undefined : D.matches.find((x) => x.gw === gw && (x.home === owner || x.away === owner));
  const to = m ? ` data-action="open" data-value="${href.match(m, 'lineup')}"` : '';
  return `<${tag} class="pp-name owned m${slotOf(owner)}${benched ? ' benched' : ''}"${to} data-tip="${esc(`${name}: ${where}`)}">${avatar(owner, 16)}<span>${esc(name)}</span></${tag}>`;
}

function pitchPlayer(p: PitchPlayer) {
  const pl = player(p.pid);
  const { topLeft = '', middleLeft, middleRight, bottomLeft, bottomRight } = p.icons ?? eventSlots(p.events);
  const at = (place: string, html?: string) => (html ? `<span class="pp-ev ${place}">${html}</span>` : '');
  const around = [
    at('top-left', topLeft),
    at('middle-left', middleLeft),
    at('middle-right', middleRight),
    at('bottom-left', bottomLeft),
    at('bottom-right', bottomRight),
  ].join('');
  return `<a class="pp${p.faded ? ' faded' : ''}" href="${href.player(p.pid)}"${p.tip ? ` data-tip="${esc(p.tip)}"` : ''}>
    <div class="pp-head">${photo(p.pid, 44)}<span class="pp-badge">${p.badge}</span>${around}</div>
    ${nameOf(p, pl.club, pl.name)}${p.note ? `<div class="pp-note">${p.note}</div>` : ''}
  </a>`;
}

export function pitch(xi: PitchPlayer[], bench: PitchPlayer[] = []) {
  const rows = LINES.map((pos) => xi.filter((p) => player(p.pid).pos === pos))
    .filter((line) => line.length)
    .map((line) => `<div class="pitch-row">${line.map(pitchPlayer).join('')}</div>`)
    .join('');
  const subs = bench.length
    ? `<div class="pitch-bench"><div class="pitch-bench-label">Bench</div><div class="pitch-row">${bench.map(pitchPlayer).join('')}</div></div>`
    : '';
  return `<div class="pitch">${box('pitch-lines')}<div class="pitch-xi">${rows}</div></div>${subs}`;
}

// A match: home on the left with the goalkeeper at the edge and away on the right, or
// home at the top and away at the bottom when there isn't room (see .mpitch).
export function matchPitch(home: PitchSide, away: PitchSide, benches?: [PitchPlayer[], PitchPlayer[]], benchTitle = 'Bench') {
  const lines = (side: PitchSide, order: Position[]) => {
    const byPosition = order.map((pos) => side.xi.filter((p) => player(p.pid).pos === pos));
    // A real formation's lines go the other way for the away side, its goalkeeper at the far end.
    const real = side.lines && (order[0] === 'GKP' ? side.lines : [...side.lines].reverse());
    return (real ?? byPosition)
      .filter((line) => line.length)
      .map((line) => `<div class="mline">${line.map(pitchPlayer).join('')}</div>`)
      .join('');
  };
  const team = (side: PitchSide, cls: string) => {
    const formation = `<span class="mp-form">${side.shape ?? formationOf(side.xi.map((p) => p.pid))}</span>`;
    const name = `<span>${side.name ?? first(side.id)}</span>`;
    return `<div class="mp-team ${cls}">${side.total ?? ''}${side.logo ?? avatar(side.id, 24)}<div class="mp-team-text"><div class="mp-name">${name}${formation}</div>${side.note ? `<div class="mp-note">${side.note}</div>` : ''}</div></div>`;
  };
  const order: Position[] = ['GKP', 'DEF', 'MID', 'FWD'];
  const bench = benches ? playerColumns(benchTitle, benches) : '';
  return `<div class="mp-wrap"><div class="mp">
    <div class="mp-head">${team(home, 'home')}${team(away, 'away')}</div>
    <div class="mpitch"><i class="mp-halfway"></i><i class="mp-circle"></i>${box('mp-box home')}${box('mp-box away')}
      <div class="mhalf home">${lines(home, order)}</div><div class="mhalf away">${lines(away, [...order].reverse())}</div>
    </div>
  </div>${bench}</div>`;
}

/** Two columns of players, home's and away's, as a match's bench under the pitch, or as a lineup of its own. */
export function playerColumns(title: string, [home, away]: [PitchPlayer[], PitchPlayer[]]) {
  return `<div class="mp-bench"><div class="mp-bench-title">${title}</div><div class="mp-bench-cols"><div>${home.map(benchRow).join('')}</div><div>${away.map(benchRow).join('')}</div></div></div>`;
}

function benchRow(p: PitchPlayer) {
  const pl = player(p.pid);
  const name =
    p.owner === undefined || p.owner === null
      ? `<div class="mp-sub-name"><span>${esc(pl.name)}</span>${p.mark ?? ''}</div>`
      : `<div class="mp-sub-name">${ownerPill(p.owner, p.benched, pl.name, { gw: p.gw })}</div>`;
  const where = p.owner === undefined ? `${crest(pl.club, 12)}${esc(club(pl.club).short)} · ` : '';
  return `<a class="mp-sub" href="${href.player(p.pid)}">${photo(p.pid, 28)}<div class="mp-sub-main">${name}<div class="mp-sub-meta">${where}${pl.pos}${p.note ? ` · ${p.note}` : ''}</div></div>${eventRow(p.events)}${p.badge}</a>`;
}
