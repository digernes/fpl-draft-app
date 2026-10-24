// The players, teams and matches a visitor opened last, on this device, the last six of each
// kind, for the search's suggestions before anything is typed.

import { href, type Route } from './router.ts';
import { store } from './state.ts';

export interface Visit {
  page: 'player' | 'team' | 'match' | 'pl-match';
  id?: number;
  gw?: number;
  home?: number;
  away?: number;
}

const KEY = 'draft.recent';
// Of each kind: players, teams, and matches of either league.
const KEEP = 6;
const kindOf = (v: Visit) => (v.page === 'pl-match' ? 'match' : v.page);

export function recentVisits(): Visit[] {
  try {
    const visits: unknown = JSON.parse(store.get(KEY, '[]'));
    return Array.isArray(visits) ? (visits as Visit[]) : [];
  } catch {
    return [];
  }
}

/** Where a visit leads: the page itself, whichever of its tabs it was on. */
export function visitHref(v: Visit) {
  if (v.page === 'player') return href.player(v.id!);
  if (v.page === 'team') return href.team(v.id!);
  if (v.page === 'pl-match') return href.plMatch(v.id!);
  return href.match({ gw: v.gw!, home: v.home!, away: v.away! });
}

export function recordVisit(route: Route) {
  if (route.page !== 'player' && route.page !== 'team' && route.page !== 'match' && route.page !== 'pl-match') return;
  const visit: Visit = { page: route.page, id: route.id, gw: route.gw, home: route.home, away: route.away };
  const visits = [visit, ...recentVisits().filter((v) => visitHref(v) !== visitHref(visit))];
  const kept = visits.filter((v, i) => visits.slice(0, i).filter((x) => kindOf(x) === kindOf(v)).length < KEEP);
  store.set(KEY, JSON.stringify(kept));
}
