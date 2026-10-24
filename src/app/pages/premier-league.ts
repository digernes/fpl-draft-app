// The Premier League's page: the real football and nothing else. Its table and a round's
// matches, as fotmob.com's league page has them, each match opening its own page with
// the lineups.

import { card, gwNav } from '../components.ts';
import { premierLeagueSvg } from '../icons.ts';
import { seasonLabel } from '../lookups.ts';
import { plMatches, plRoundList, plState } from '../pl.ts';
import type { PageView } from '../render.ts';
import { href, PL_TABS, type Route } from '../router.ts';
import { D } from '../state.ts';
import { premierLeagueTable } from '../table.ts';

const LABELS: Record<(typeof PL_TABS)[number], string> = { overview: 'Overview', fixtures: 'Fixtures', table: 'Table' };

// The round being played, or else the next one to start, or the last.
export function plRoundNow() {
  const matches = plMatches();
  const playing = matches.find((m) => plState(m).state === 'live');
  const next = matches.find((m) => plState(m).state === 'due');
  return playing?.gw ?? next?.gw ?? matches.at(-1)?.gw ?? D.meta.currentGw;
}

export function pagePremierLeague(route: Route): PageView {
  const gws = [...new Set(plMatches().map((m) => m.gw))];
  const [from, last] = [gws[0] ?? D.meta.firstGw, gws.at(-1) ?? D.meta.lastGw];
  const gw = Math.min(Math.max(route.gw ?? plRoundNow(), from), last);
  const round = (to: (g: number) => string) =>
    card({
      header: `<div class="round-nav">${gwNav(gw, from, last, to, { label: 'Round', short: 'Round', current: plRoundNow() })}</div>`,
      body: plRoundList(gw),
      cls: 'round-card',
    });
  const table = (full: boolean) =>
    card({ title: full ? '' : 'Table', body: premierLeagueTable(), footer: full ? null : { href: href.pl('table'), label: 'Full table' } });
  const tabs: Record<string, () => string> = {
    overview: () =>
      `<div class="cols"><div class="col">${table(false)}</div><div class="col">${round((g) => href.pl('overview', g))}</div></div>`,
    fixtures: () =>
      `<div class="cols"><div class="col">${round((g) => href.pl('fixtures', g))}</div><div class="col">${table(false)}</div></div>`,
    table: () => table(true),
  };
  return {
    title: route.tab === 'overview' ? 'Premier League' : `${LABELS[route.tab as keyof typeof LABELS]} · Premier League`,
    header: {
      logo: `<span class="pl-logo">${premierLeagueSvg}</span>`,
      title: 'Premier League',
      titleHref: href.pl(),
      sub: `England · ${seasonLabel(D.meta.season)}`,
      tabs: PL_TABS.map((tab) => ({ id: tab, label: LABELS[tab], href: href.pl(tab) })),
      tab: route.tab,
    },
    body: tabs[route.tab](),
  };
}
