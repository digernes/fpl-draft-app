// The pitches' lineup filters, as on fotmob.com: chips over a lineup that swap each
// player's points for his underlying numbers, once a gameweek is over and while it's
// played (for those who have played). xP keeps the icons for what he did, like
// fotmob.com's Fantasy filter; the stats show alone. Before and during a gameweek, the
// chips choose what players still to play show, and those on the pitch.

import type { SlimLive } from '../shared/live.ts';
import { AS_SCORED, expectedPoints, UNDERLYING_TIPS } from '../shared/underlying.ts';
import { bestOf, chip, pointsTier, tenths } from './components.ts';
import { esc, plural, sum } from './format.ts';
import { gwPoints, isLive, player } from './lookups.ts';
import { linesIn } from './pl.ts';
import { bpsIn, gwAsScored, gwUnderlying, statsFor } from './stats-files.ts';
import { D, state } from './state.ts';

const STATS: [value: string, label: string, tip: string][] = [
  ['xp', 'xP', UNDERLYING_TIPS.xp],
  ['xg', 'xG', 'Expected goals'],
  ['xa', 'xA', 'Expected assists'],
  ['xcs', 'xCS', UNDERLYING_TIPS.xcs],
];

export const hasLineupFilters = (gw: number) =>
  Boolean(D.underlying?.[gw]) || (gw === D.meta.currentGw && isLive() && typeof statsFor(gw) === 'object');

/** While any of a live gameweek's matches is still to play or being played, when some players' points are still heading somewhere. */
export const stillToCome = (feed: SlimLive | null) => Boolean(feed?.fixtures.some((f) => !f.done));

/**
 * The chips over a lineup, in one row and one choice: while some still have to play or are
 * playing (`open`), Projected, then the underlying numbers of those who have played, a gap
 * between the two. None chosen is the default: the points, and for those still to play when
 * they kick off (their projections before a gameweek, when Projected starts chosen).
 */
export function lineupFilters(gw: number, open: boolean) {
  const stat = hasLineupFilters(gw) && state.lineupStat;
  const projected = !stat && dueShows(gw) === 'xp';
  const dues = open ? [chip('Projected', 'due', projected ? 'ko' : 'xp', projected)] : [];
  const stats = hasLineupFilters(gw)
    ? STATS.map(([value, label, tip]) => chip(label, 'lineup-stat', value, state.lineupStat === value, `data-tip="${esc(tip)}"`))
    : [];
  if (!dues.length && !stats.length) return '';
  const gap = dues.length && stats.length ? '<span class="lf-gap" aria-hidden="true"></span>' : '';
  return `<div class="filter-bar lineup-filters">${dues.join('')}${gap}${stats.join('')}</div>`;
}

export const showsEvents = (gw: number) =>
  !hasLineupFilters(gw) || (state.lineupStat !== 'xg' && state.lineupStat !== 'xa' && state.lineupStat !== 'xcs');

// A player's goals or assists in a gameweek's matches.
const inGw = (pid: number, gw: number, what: 'goals' | 'assists') => sum(linesIn(pid, gw).map(({ m }) => m.events?.[pid]?.[what] ?? 0));

/** Between players level on points in a gameweek: the more goals, then the higher BPS, then the more assists. */
export const gwTiebreaks = (gw: number) => [
  (pid: number) => inGw(pid, gw, 'goals'),
  (pid: number) => bpsIn(pid, gw),
  (pid: number) => inGw(pid, gw, 'assists'),
];

/** The best of a head-to-head's XIs, for the blue once it's over: by the xP filter's numbers while that's chosen, else by points, then as gwTiebreaks. */
export const bestOfMatch = (xis: number[], gw: number) =>
  bestOf(
    xis,
    (pid) => (state.lineupStat === 'xp' && hasLineupFilters(gw) ? gwUnderlying(pid, gw)?.[2] : gwPoints(pid, gw)),
    ...gwTiebreaks(gw),
  );

// The badge for the chosen filter, or undefined for the usual points. `top`: the match's best.
export function statBadge(pid: number, gw: number, top = false): string | undefined {
  if (!state.lineupStat || !hasLineupFilters(gw)) return undefined;
  const u = gwUnderlying(pid, gw);
  // While the gameweek is played, one still to play shows what he would anyway.
  if (!u) return D.underlying?.[gw] ? '' : undefined;
  const [xg, xa, xp, xcs] = u;
  if (state.lineupStat === 'xp')
    return `<span class="ptsp ${top ? 'top' : pointsTier(xp)}" ${xpTip([pid], gw, top)}>${xp.toFixed(1)}</span>`;
  const [value, what] =
    state.lineupStat === 'xg'
      ? [xg, 'expected goals']
      : state.lineupStat === 'xa'
        ? [xa, 'expected assists']
        : [xcs, 'expected clean sheets'];
  if (value === undefined) return '';
  return `<span class="ptsp xp" data-tip="${value.toFixed(2)} ${what}">${value.toFixed(2)}</span>`;
}

const AS_SCORED_LABELS: Record<(typeof AS_SCORED)[number], string> = {
  playing: 'Playing',
  penalties: 'Penalties',
  defcon: 'Defcon',
  saves: 'Saves',
  bonus: 'Bonus',
  cards: 'Cards',
  ownGoals: 'Own goals',
  other: 'Other',
};

/**
 * The tip that takes xP apart, as the projections' tooltip does theirs: what he scored for
 * playing, his bonus, saves and the like, and what his xG, xA, xCS and xGC were worth in
 * place of his goals, assists, clean sheets and goals conceded. An XI's, its players' together.
 */
export function xpTip(pids: number[], gw: number, top = false) {
  const t = { xp: 0, pts: 0, xg: 0, xa: 0, xcs: 0, xgc: 0, goals: 0, assists: 0, cleanSheet: 0, conceded: 0 };
  let kept: number[] | undefined = AS_SCORED.map(() => 0);
  for (const pid of pids) {
    const u = gwUnderlying(pid, gw);
    if (!u) continue;
    const [xg, xa, xp, xcs = 0, xgc = 0] = u;
    const worth = expectedPoints({ xg, xa, xcs, xgc }, D.meta.rules ?? {}, player(pid)?.pos);
    Object.assign(t, {
      xp: t.xp + xp,
      pts: t.pts + gwPoints(pid, gw),
      xg: t.xg + xg,
      xa: t.xa + xa,
      xcs: t.xcs + xcs,
      xgc: t.xgc + (worth.conceded ? xgc : 0), // only where goals conceded cost points
      goals: t.goals + worth.goals,
      assists: t.assists + worth.assists,
      cleanSheet: t.cleanSheet + worth.cleanSheet,
      conceded: t.conceded + worth.conceded,
    });
    const own = gwAsScored(pid, gw);
    kept = own && kept?.map((v, i) => v + (own[i] ?? 0));
  }
  const part = (key: (typeof AS_SCORED)[number]): [string, number] => [AS_SCORED_LABELS[key], kept?.[AS_SCORED.indexOf(key)] ?? 0];
  // Without the parts that stay as scored (older data), what's left of xP in one.
  const rest = t.xp - t.goals - t.assists - t.cleanSheet - t.conceded;
  const rows: [string, number][] = [
    part('playing'),
    [`Goals · ${t.xg.toFixed(2)} xG`, t.goals],
    part('penalties'),
    [`Assists · ${t.xa.toFixed(2)} xA`, t.assists],
    [`Clean sheet · ${t.xcs.toFixed(2)} xCS`, t.cleanSheet],
    [`Conceded · ${t.xgc.toFixed(2)} xGC`, t.conceded],
    ...(['defcon', 'saves', 'bonus', 'cards', 'ownGoals', 'other'] as const).map(part),
    ...(kept ? [] : [['As scored', rest] as [string, number]]),
  ];
  const head = [`${tenths(t.xp)} xP`, `${plural(t.pts, 'point')} scored`, ...(top ? ['the match’s best'] : [])].join(' · ');
  const lines = rows.flatMap(([label, x]) => (Math.abs(x) >= 0.05 ? [`${label}\t${tenths(x)}`] : [])).join('\n');
  return `data-tip="${esc(head)}" data-tip-rows="${esc(lines)}"`;
}

// Players still to play show their projected points (the xP everywhere else on the site)
// or when they kick off: by default the projections before a gameweek, and the kick-offs
// once it is on. With the projections those on the pitch show where their points are
// heading rather than their points so far, so a gameweek under way reads as one forecast.
// Projected, not "xP", since a finished gameweek's xP filter means what his chances were worth.
export const dueShows = (gw: number) => state.due || (gw > D.meta.currentGw ? 'xp' : 'ko');
