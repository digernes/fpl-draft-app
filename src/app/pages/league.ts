// The draft league's page, as fotmob.com's league pages: its header with the season's
// status, and the tabs that were the whole site before the pages came.

import { esc, plural } from '../format.ts';
import { trophySvg } from '../icons.ts';
import { isArchive } from '../lookups.ts';
import type { PageView } from '../render.ts';
import { seasonChip, statusChips } from '../render.ts';
import { href, type Route } from '../router.ts';
import { D } from '../state.ts';
import { viewDraft } from '../views/draft.ts';
import { viewFixtures } from '../views/fixtures.ts';
import { viewOverview } from '../views/overview.ts';
import { viewStats } from '../views/stats.ts';
import { viewTable } from '../views/table.ts';
import { transferStats } from '../views/transfers.ts';

const TABS: [string, string][] = [
  ['overview', 'Overview'],
  ['table', 'Table'],
  ['fixtures', 'Fixtures'],
  ['stats', 'Stats'],
  ['transfer-stats', 'Transfer stats'],
  ['draft', 'Draft'],
];

/** The league's header, for its own page and the match pages under it. */
export const leagueHeader = (tab = '') => ({
  logo: trophySvg,
  title: esc(D.meta.name),
  titleHref: href.league(),
  sub: `Premier League Draft · ${plural(D.managers.length, 'manager')}${isArchive() ? ' · final standings' : ''}`,
  side: `<span class="status-chips">${statusChips()}</span>${seasonChip()}`,
  tabs: TABS.map(([id, label]) => ({ id, label, href: href.league(id) })),
  tab,
});

export function pageLeague(route: Route): PageView {
  const views: Record<string, () => string> = {
    overview: viewOverview,
    table: viewTable,
    fixtures: () => viewFixtures(route.gw),
    stats: viewStats,
    'transfer-stats': transferStats,
    draft: viewDraft,
  };
  const label = TABS.find(([id]) => id === route.tab)![1];
  return { title: route.tab === 'overview' ? 'Draft league' : label, header: leagueHeader(route.tab), body: views[route.tab]() };
}
