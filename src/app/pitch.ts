// Lineups on a pitch, as on fotmob.com: a team's XI in lines from the goalkeeper up
// (its "Last starting XI"), or both XIs of a match on one pitch. Each player has their
// photo, a points badge and their name.

import type { Position } from '../shared/data.ts';
import { avatar, crest, photo } from './components.ts';
import { esc } from './format.ts';
import { arrowSvg } from './icons.ts';
import { club, first, player } from './lookups.ts';

export interface PitchPlayer {
  pid: number;
  /** Top right of the photo: the points. */
  badge: string;
  /** Bottom left and bottom right of the photo. */
  left?: string;
  right?: string;
  tip?: string;
  faded?: boolean;
}

export interface PitchSide {
  id: number;
  xi: PitchPlayer[];
  /** Under the name: how far through the gameweek, or the projected total. */
  note?: string;
}

const LINES: Position[] = ['FWD', 'MID', 'DEF', 'GKP'];

// A penalty area with its goal line at the bottom, after fotmob.com's.
const box = (cls: string) =>
  `<svg class="pitch-mark ${cls}" viewBox="0 0 316 174" aria-hidden="true"><path d="M3 174V40a10 10 0 0 1 10-10h290a10 10 0 0 1 10 10v134M102.6 30a76.8 76.8 0 0 1 110.8 0M84 174v-52a8 8 0 0 1 8-8h132a8 8 0 0 1 8 8v52"/></svg>`;

export const subMark = `<span class="pp-sub" data-tip="Came on as an automatic substitute">${arrowSvg}</span>`;

export const formationOf = (xi: number[]) =>
  (['DEF', 'MID', 'FWD'] as const).map((pos) => xi.filter((pid) => player(pid).pos === pos).length).join('-');

function pitchPlayer(p: PitchPlayer) {
  const pl = player(p.pid);
  return `<div class="pp${p.faded ? ' faded' : ''}"${p.tip ? ` data-tip="${esc(p.tip)}"` : ''}>
    <div class="pp-head">${photo(p.pid, 44)}<span class="pp-badge">${p.badge}</span>${p.left ? `<span class="pp-corner pp-left">${p.left}</span>` : ''}${p.right ? `<span class="pp-corner pp-right">${p.right}</span>` : ''}</div>
    <div class="pp-name">${crest(pl.club, 12)}<span>${esc(pl.name)}</span></div>
  </div>`;
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
export function matchPitch(home: PitchSide, away: PitchSide, benches?: [PitchPlayer[], PitchPlayer[]]) {
  const lines = (side: PitchSide, order: Position[]) =>
    order
      .map((pos) => side.xi.filter((p) => player(p.pid).pos === pos))
      .filter((line) => line.length)
      .map((line) => `<div class="mline">${line.map(pitchPlayer).join('')}</div>`)
      .join('');
  const team = (side: PitchSide, cls: string) => {
    const formation = `<span class="mp-form">${formationOf(side.xi.map((p) => p.pid))}</span>`;
    const name = `<span>${first(side.id)}</span>`;
    return `<div class="mp-team ${cls}">${avatar(side.id, 24)}<div class="mp-team-text"><div class="mp-name">${cls === 'home' ? name + formation : formation + name}</div>${side.note ? `<div class="mp-note">${side.note}</div>` : ''}</div></div>`;
  };
  const order: Position[] = ['GKP', 'DEF', 'MID', 'FWD'];
  const bench = benches
    ? `<div class="mp-bench"><div class="mp-bench-title">Bench</div><div class="mp-bench-cols">${benches
        .map((list) => `<div>${list.map(benchRow).join('')}</div>`)
        .join('')}</div></div>`
    : '';
  return `<div class="mp">
    <div class="mp-head">${team(home, 'home')}${team(away, 'away')}</div>
    <div class="mpitch"><i class="mp-halfway"></i><i class="mp-circle"></i>${box('mp-box home')}${box('mp-box away')}
      <div class="mhalf home">${lines(home, order)}</div><div class="mhalf away">${lines(away, [...order].reverse())}</div>
    </div>
  </div>${bench}`;
}

function benchRow(p: PitchPlayer) {
  const pl = player(p.pid);
  return `<div class="mp-sub">${photo(p.pid, 28)}<div class="mp-sub-main"><div class="mp-sub-name">${esc(pl.name)}</div><div class="mp-sub-meta">${crest(pl.club, 12)}${esc(club(pl.club).short)} · ${pl.pos}</div></div>${p.badge}</div>`;
}
