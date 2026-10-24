// The pitches' lineup filters, as on fotmob.com: chips over a lineup that swap each
// player's points for his underlying numbers, once a gameweek is over and while it's
// played (for those who have played). xP keeps the icons for what he did, like
// fotmob.com's Fantasy filter; the stats show alone. Before and during a gameweek, the
// chips choose what players still to play show.

import { chip, pointsTier } from './components.ts';
import { esc } from './format.ts';
import { gwPoints, isLive } from './lookups.ts';
import { gwUnderlying, statsFor } from './pl-stats.ts';
import { D, state } from './state.ts';

const STATS: [value: string, label: string, tip: string][] = [
  ['xp', 'xP', 'Expected points, from his xG, xA and xGC'],
  ['xg', 'xG', 'Expected goals'],
  ['xa', 'xA', 'Expected assists'],
  ['xcs', 'xCS', 'Expected clean sheets, from the xG conceded'],
];

export const hasLineupFilters = (gw: number) =>
  Boolean(D.underlying?.[gw]) || (gw === D.meta.currentGw && isLive() && typeof statsFor(gw) === 'object');

export function lineupFilters(gw: number) {
  if (!hasLineupFilters(gw)) return '';
  return `<div class="filter-bar lineup-filters">${STATS.map(([value, label, tip]) =>
    chip(label, 'lineup-stat', value, state.lineupStat === value, `data-tip="${esc(tip)}"`),
  ).join('')}</div>`;
}

export const showsEvents = (gw: number) =>
  !hasLineupFilters(gw) || (state.lineupStat !== 'xg' && state.lineupStat !== 'xa' && state.lineupStat !== 'xcs');

// The badge for the chosen filter, or undefined for the usual points.
export function statBadge(pid: number, gw: number): string | undefined {
  if (!state.lineupStat || !hasLineupFilters(gw)) return undefined;
  const u = gwUnderlying(pid, gw);
  // While the gameweek is played, one still to play shows what he would anyway.
  if (!u) return D.underlying?.[gw] ? '' : undefined;
  const [xg, xa, xp, xcs] = u;
  if (state.lineupStat === 'xp')
    return `<span class="ptsp ${pointsTier(xp)}" data-tip="${xp.toFixed(1)} points from his xG, xA and xGC, ${gwPoints(pid, gw)} scored">${xp.toFixed(1)}</span>`;
  const [value, what] =
    state.lineupStat === 'xg'
      ? [xg, 'expected goals']
      : state.lineupStat === 'xa'
        ? [xa, 'expected assists']
        : [xcs, 'expected clean sheets'];
  if (value === undefined) return '';
  return `<span class="ptsp xp" data-tip="${value.toFixed(2)} ${what}">${value.toFixed(2)}</span>`;
}

// Players still to play show their projected points (the xP everywhere else on the site)
// or when they kick off: by default the projections before a gameweek, and the kick-offs
// once it is on. Not "xP" here, since a finished gameweek's xP filter means what his
// chances were worth.
const DUE: [value: string, label: string][] = [
  ['xp', 'Projected'],
  ['ko', 'Kick-off'],
];

export const dueShows = (gw: number) => state.due || (gw > D.meta.currentGw ? 'xp' : 'ko');

export const dueFilters = (gw: number) =>
  `<div class="filter-bar lineup-filters">${DUE.map(([value, label]) => chip(label, 'due', value, dueShows(gw) === value)).join('')}</div>`;
