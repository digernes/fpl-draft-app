// The pitches' lineup filters, as on fotmob.com: chips over a finished gameweek's
// lineup that swap each player's points for his underlying numbers. xP keeps the
// icons for what he did, like fotmob.com's Fantasy filter; the stats show alone.
// Before and during a gameweek, the chips choose what players still to play show.

import { chip, pointsTier } from './components.ts';
import { gwPoints, gwUnderlying } from './lookups.ts';
import { D, state } from './state.ts';

const STATS: [value: string, label: string][] = [
  ['xp', 'xP'],
  ['xg', 'xG'],
  ['xa', 'xA'],
  ['xcs', 'xCS'],
];

export const hasLineupFilters = (gw: number) => Boolean(D.underlying?.[gw]);

export function lineupFilters(gw: number) {
  if (!hasLineupFilters(gw)) return '';
  return `<div class="filter-bar lineup-filters">${STATS.map(([value, label]) => chip(label, 'lineup-stat', value, state.lineupStat === value)).join('')}</div>`;
}

export const showsEvents = (gw: number) =>
  !hasLineupFilters(gw) || (state.lineupStat !== 'xg' && state.lineupStat !== 'xa' && state.lineupStat !== 'xcs');

// The badge for the chosen filter, or undefined for the usual points.
export function statBadge(pid: number, gw: number): string | undefined {
  if (!state.lineupStat || !hasLineupFilters(gw)) return undefined;
  const u = gwUnderlying(pid, gw);
  if (!u) return '';
  const [xg, xa, xp, xcs] = u;
  if (state.lineupStat === 'xp')
    return `<span class="ptsp ${pointsTier(xp)}" data-tip="${xp.toFixed(1)} expected points, ${gwPoints(pid, gw)} scored">${xp.toFixed(1)}</span>`;
  const [value, what] =
    state.lineupStat === 'xg'
      ? [xg, 'expected goals']
      : state.lineupStat === 'xa'
        ? [xa, 'expected assists']
        : [xcs, 'expected clean sheets'];
  if (value === undefined) return '';
  return `<span class="ptsp xp" data-tip="${value.toFixed(2)} ${what}">${value.toFixed(2)}</span>`;
}

// Players still to play show their expected points or when they kick off: by default
// the xP before a gameweek, and the kick-offs once it is on.
const DUE: [value: string, label: string][] = [
  ['xp', 'xP'],
  ['ko', 'Kick-off'],
];

export const dueShows = (gw: number) => state.due || (gw > D.meta.currentGw ? 'xp' : 'ko');

export const dueFilters = (gw: number) =>
  `<div class="filter-bar lineup-filters">${DUE.map(([value, label]) => chip(label, 'due', value, dueShows(gw) === value)).join('')}</div>`;
