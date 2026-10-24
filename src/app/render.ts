// Puts the page the address asks for on screen: its header and tabs, its body, the
// document title, and which of the top bar's and the bottom bar's links is lit.

import { avatar, markLoadingPhotos } from './components.ts';
import { countdown, esc, fmtShortDay, fmtStamp, fmtTime } from './format.ts';
import { caretSvg, leagueSvg, matchesSvg, premierLeagueSvg, shirtSvg, swapSvg } from './icons.ts';
import { isLive, mgr, seasonLabel, seasonSlug } from './lookups.ts';
import { pageHeader, type Header } from './page-header.ts';
import { pageHome } from './pages/home.ts';
import { pageLeague } from './pages/league.ts';
import { pageMatch } from './pages/match.ts';
import { pagePlMatch } from './pages/pl-match.ts';
import { pagePlayer } from './pages/player.ts';
import { pagePremierLeague } from './pages/premier-league.ts';
import { pageTeam } from './pages/team.ts';
import { pageTeams } from './pages/teams.ts';
import { pageTransfers } from './pages/transfers.ts';
import { recordVisit } from './recent.ts';
import { href, parseRoute, type Page, type Route } from './router.ts';
import { D, seasons, state } from './state.ts';

export interface PageView {
  /** Before the league's name in the document title, as plain text; none for the home page. */
  title?: string;
  header?: Header;
  body: string;
}

const PAGES: Record<Page, (route: Route) => PageView> = {
  home: pageHome,
  league: pageLeague,
  pl: pagePremierLeague,
  transfers: pageTransfers,
  teams: pageTeams,
  team: pageTeam,
  match: pageMatch,
  'pl-match': pagePlMatch,
  player: pagePlayer,
};

// Between rounds the waiver run comes first, then the deadline; during a live
// gameweek the live chip replaces the deadline.
export function statusChips() {
  const { meta } = D;
  const at = (iso: string) => `${fmtShortDay.format(new Date(iso))}, ${fmtTime.format(new Date(iso))}`;
  const waivers = meta.nextWaivers && countdown(meta.nextWaivers);
  const deadline = meta.nextDeadline && countdown(meta.nextDeadline);
  return [
    isLive() && `<span class="status-chip live"><i></i>Live · GW ${meta.currentGw}</span>`,
    waivers &&
      `<span class="status-chip" data-tip="GW ${meta.nextGw} waivers process ${at(meta.nextWaivers!)}">Waivers in <strong>${waivers}</strong></span>`,
    !isLive() &&
      deadline &&
      `<span class="status-chip" data-tip="GW ${meta.nextGw} deadline ${at(meta.nextDeadline!)}">GW ${meta.nextGw} deadline in <strong>${deadline}</strong></span>`,
  ]
    .filter(Boolean)
    .join('');
}

// FotMob's season chip; it turns into a picker once there is more than one season.
export function seasonChip() {
  if (seasons.length < 2) return `<span class="season-chip">${seasonLabel(D.meta.season)}</span>`;
  const options = seasons
    .map(
      (s) =>
        `<option value="${esc(seasonSlug(s.season))}"${s.season === D.meta.season ? ' selected' : ''}>${seasonLabel(s.season)}</option>`,
    )
    .join('');
  return `<label class="season-chip season-select"><select data-action="season" aria-label="Season">${options}</select>${caretSvg}</label>`;
}

export function renderAll() {
  document.getElementById('updated')!.textContent = `Updated ${fmtStamp.format(new Date(D.meta.generatedAt!))}`;
  renderView();
}

let shown = '';
let last = '';

export function renderView() {
  const { route } = state;
  // Another tab of the same page: the bar under the tabs slides over from the last one.
  const key = route.page === 'match' ? `match:${route.gw}:${route.home}:${route.away}` : `${route.page}:${route.id ?? ''}`;
  const from = key === shown ? indicatorAt() : null;
  shown = key;
  const page = PAGES[route.page](route);
  const app = document.getElementById('app')!;
  // A sheet open over the page stays open as the page redraws under it (a filter in it
  // changed): without sliding up again, and scrolled where it was.
  const sheet = app.querySelector<HTMLDialogElement>('dialog[open]');
  const scrolled = sheet?.querySelector('.sheet-body')?.scrollTop ?? 0;
  app.innerHTML = `${page.header ? pageHeader(page.header) : ''}<div class="view" id="view">${page.body}</div>`;
  const again = sheet?.id ? document.getElementById(sheet.id) : null;
  if (again instanceof HTMLDialogElement) {
    again.classList.add('kept');
    again.showModal();
    again.querySelector('.sheet-body')?.scrollTo({ top: scrolled });
  }
  markLoadingPhotos(app);
  revealPicked();
  document.title = page.title ? `${page.title} · ${D.meta.name}` : D.meta.name;
  if (key !== last) recordVisit(route);
  last = key;
  placeTabIndicator(from);
  renderNav();
  syncSettings();
}

/** Goes to an address; `replace` keeps it out of the history, as for a gameweek's arrows. */
export function navigate(to: string, { replace = false } = {}) {
  if (!replace) {
    location.hash = to; // the hashchange handler (chrome.ts) renders it
    return;
  }
  history.replaceState(null, '', `${location.pathname}${location.search}${to}`);
  state.route = parseRoute(to);
  renderView();
}

// A re-render starts the tabs and filter bars scrolled back to the left, which on a
// phone can hide the one that is picked (say, a team's Stats tab).
function revealPicked() {
  for (const bar of document.querySelectorAll<HTMLElement>('#app .filter-bar, #app .tabs')) {
    const picked = bar.querySelector<HTMLElement>('[aria-pressed="true"], [aria-selected="true"]');
    if (!picked) continue;
    const left = picked.getBoundingClientRect().left - bar.getBoundingClientRect().left;
    if (left < 0 || left + picked.offsetWidth > bar.clientWidth) bar.scrollLeft = left - (bar.clientWidth - picked.offsetWidth) / 2;
  }
}

function indicatorAt() {
  const bar = document.querySelector<HTMLElement>('.tab-indicator');
  return bar?.style.width ? { left: bar.style.left, width: bar.style.width } : null;
}

export function placeTabIndicator(from: { left: string; width: string } | null = null) {
  const active = document.querySelector<HTMLElement>('.tab[aria-selected="true"]');
  const bar = document.querySelector<HTMLElement>('.tab-indicator');
  if (!active || !bar) return;
  bar.style.transition = 'none';
  if (from) {
    Object.assign(bar.style, from);
    void bar.offsetWidth; // so it slides from there
    bar.style.transition = '';
  }
  bar.style.width = `${active.offsetWidth}px`;
  bar.style.left = `${active.offsetLeft}px`;
  if (!from) {
    void bar.offsetWidth;
    bar.style.transition = '';
  }
}

// The top bar's links (from 769px) and the bottom bar's (on phones): the leagues, the
// Transfer center, and the team the visitor follows, or all the teams.
function renderNav() {
  const { page, id } = state.route;
  const mine = mgr(state.myTeam) ? (state.myTeam as number) : null;
  // `face`: the followed team's link has its avatar in the top bar too.
  const items: { label: string; to: string; icon: string; on: boolean; top: boolean; face?: boolean }[] = [
    { label: 'Home', to: href.home(), icon: matchesSvg, on: page === 'home', top: false },
    { label: 'Draft league', to: href.league(), icon: leagueSvg, on: page === 'league' || page === 'match', top: true },
    { label: 'Premier League', to: href.pl(), icon: premierLeagueSvg, on: page === 'pl' || page === 'pl-match', top: true },
    { label: 'Transfers', to: href.transfers(), icon: swapSvg, on: page === 'transfers', top: true },
    mine
      ? { label: 'My team', to: href.team(mine), icon: avatar(mine, 24), on: page === 'team' && id === mine, top: true, face: true }
      : { label: 'Teams', to: href.teams(), icon: shirtSvg, on: page === 'teams' || page === 'team', top: true },
  ];
  const link = (i: (typeof items)[number], withIcon: boolean) =>
    `<a href="${i.to}"${i.on ? ' aria-current="page"' : ''}>${withIcon ? `<span class="nav-icon">${i.icon}</span>` : ''}<span>${i.label}</span></a>`;
  document.getElementById('topnav')!.innerHTML = items
    .filter((i) => i.top)
    .map((i) => link(i, Boolean(i.face)))
    .join('');
  document.getElementById('bottom-bar')!.innerHTML = items.map((i) => link(i, true)).join('');
}

export function syncSettings() {
  for (const button of document.querySelectorAll<HTMLElement>('#settings-menu [data-action]')) {
    button.setAttribute('aria-pressed', String(state[button.dataset.action as keyof typeof state] === button.dataset.value));
  }
}
