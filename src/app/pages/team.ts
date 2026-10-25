// A draft team's page, as fotmob.com's team pages: the header with its manager, place in
// the table and a Follow button, then the tabs. Overview: form, the next match, the last
// starting XI, the table and head to head. Squad: the squad (or everyone ever owned) with
// this round's points, the next round's expected points and what each has scored for the
// team. Fixtures, Transfers, and Stats: the season's numbers and who scored them.

import { onAction } from '../actions.ts';
import { avatar, card, empty } from '../components.ts';
import { esc, ordinal } from '../format.ts';
import { starSvg } from '../icons.ts';
import { isArchive, mgr } from '../lookups.ts';
import { renderView, type PageView } from '../render.ts';
import { href, TEAM_TABS, type Route } from '../router.ts';
import { D, state } from '../state.ts';
import { standingsTable } from '../league-tables.ts';
import { fixturesCard, formCard, lineupCard, nextMatchCard, rivalsCard } from './team-overview.ts';
import { originalCard, positionCard, squadCard } from './team-squad.ts';
import { benchCard, scorersCard, seasonCard } from './team-stats.ts';
import { claimsCard, movesCard, tradesCard } from './team-transfers.ts';

const LABELS: Record<(typeof TEAM_TABS)[number], string> = {
  overview: 'Overview',
  squad: 'Squad',
  fixtures: 'Fixtures',
  transfers: 'Transfers',
  stats: 'Stats',
};

for (const [action, key] of [
  ['lineup-view', 'lineupView'],
  ['squad-scope', 'squadScope'],
  ['squad-sort', 'squadSort'],
  ['moves', 'moves'],
] as const)
  onAction(action, (value) => {
    state[key] = value;
    renderView();
  });

// fotmob.com's Follow button: the team the visitor follows comes first and stands out.
export function followButton(id: number) {
  const on = state.myTeam === id;
  return `<button type="button" class="follow${on ? ' on' : ''}" data-action="follow" data-value="${id}" aria-pressed="${on}">${starSvg(on)}<span>${on ? 'Following' : 'Follow'}</span></button>`;
}

export function pageTeam(route: Route): PageView {
  const id = route.id!;
  const m = mgr(id);
  if (!m) return { title: 'Team', body: card({ body: empty('No such team in this league') }) };
  const row = D.tables.overall.find((r) => r.id === id);
  const tabs: Record<string, () => string> = {
    overview: () => `<div class="cols">
      <div class="col">${formCard(id)}${nextMatchCard(id)}${card({ title: 'Table', body: standingsTable('overall', { highlight: [id] }), footer: { href: href.league('table'), label: 'Full table' } })}${rivalsCard(id)}</div>
      <div class="col">${lineupCard(id)}${fixturesCard(id, { limit: 5 })}</div>
    </div>`,
    squad: () => `<div class="cols">
      <div class="col">${squadCard(id)}</div>
      <div class="col">${positionCard(id)}${originalCard(id)}</div>
    </div>`,
    fixtures: () => `<div class="cols"><div class="col">${fixturesCard(id)}</div><div class="col">${rivalsCard(id)}</div></div>`,
    transfers: () => `<div class="cols">
      <div class="col">${movesCard(id)}</div>
      <div class="col">${claimsCard(id)}${tradesCard(id)}</div>
    </div>`,
    stats: () => `<div class="cols">
      <div class="col">${seasonCard(id)}${scorersCard(id)}</div>
      <div class="col">${positionCard(id)}${benchCard(id)}</div>
    </div>`,
  };
  return {
    title: route.tab === 'overview' ? m.team : `${LABELS[route.tab as keyof typeof LABELS]} · ${m.team}`,
    header: {
      logo: avatar(id, 56),
      title: esc(m.team),
      sub: `${esc(m.first)}${row ? ` · ${ordinal(row.rank)} of ${D.managers.length}` : ''}`,
      side: isArchive() ? '' : followButton(id),
      tabs: TEAM_TABS.map((tab) => ({ id: tab, label: LABELS[tab], href: href.team(id, tab) })),
      tab: route.tab,
      cls: 'team-header',
    },
    body: tabs[route.tab](),
  };
}
