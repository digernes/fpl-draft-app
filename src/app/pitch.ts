// FotMob's lineup on a pitch (its "Last starting XI"): the XI in lines from the
// goalkeeper up, each player with their photo, a points badge and their name, and the
// bench in a row below.

import type { Position } from '../shared/data.ts';
import { crest, photo } from './components.ts';
import { esc } from './format.ts';
import { player } from './lookups.ts';

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

const LINES: Position[] = ['FWD', 'MID', 'DEF', 'GKP'];

// The penalty area at the bottom of the pitch, after FotMob's.
const linesSvg = `<svg class="pitch-lines" viewBox="0 0 316 174" aria-hidden="true"><path d="M3 174V40a10 10 0 0 1 10-10h290a10 10 0 0 1 10 10v134M102.6 30a76.8 76.8 0 0 1 110.8 0M84 174v-52a8 8 0 0 1 8-8h132a8 8 0 0 1 8 8v52"/></svg>`;

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
  return `<div class="pitch">${linesSvg}<div class="pitch-xi">${rows}</div></div>${subs}`;
}
