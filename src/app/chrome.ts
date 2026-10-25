// Page chrome: routing, theme, settings and the one click handler, which runs whatever
// action the element clicked registered (actions.ts). It binds the search and the tooltips.

import { onAction, runAction } from './actions.ts';
import { alignHead, alignHeads } from './components.ts';
import { applyLatestLive, applyLatestTransfers, loadData, pollTransfers, scheduleRefresh } from './live-scores.ts';
import { seasonSlug } from './lookups.ts';
import { navigate, pageKey, placeTabIndicator, renderAll, renderView, syncSettings } from './render.ts';
import { href, legacyRedirect, parseRoute } from './router.ts';
import { bindScroll, changeEntry } from './scroll.ts';
import { bindSearch } from './search.ts';
import { seasons, state, store } from './state.ts';
import { withRowMoves } from './table.ts';
import { bindTooltips } from './tooltips.ts';

async function switchSeason(slug: string) {
  const entry = seasons.find((s) => seasonSlug(s.season) === slug);
  state.season = entry && !entry.current ? slug : null;
  const url = new URL(location.href);
  if (state.season) url.searchParams.set('season', state.season);
  else url.searchParams.delete('season');
  history.replaceState(history.state, '', url);
  Object.assign(state, { openSquad: null, logManager: 'all', playersOwner: 'all' }); // another season's managers
  try {
    await loadData();
  } catch {
    return; // keep the season we have
  }
  applyLatestLive();
  applyLatestTransfers();
  renderAll();
  scheduleRefresh();
  pollTransfers();
}

export function readRoute() {
  const moved = legacyRedirect(location.hash);
  if (moved) history.replaceState(history.state, '', `${location.pathname}${location.search}${moved}`);
  state.route = parseRoute(location.hash);
}

export function applyTheme() {
  const dark = state.theme === 'dark' || (state.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  // The installed app's status bar follows the top bar.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1a1a1a' : '#ffffff');
}

// --- Actions shared by every page --------------------------------------------------

const setting = (key: keyof typeof state & string, stored?: string) => (value: string) => {
  Object.assign(state, { [key]: value });
  if (stored) store.set(stored, value);
  renderView();
};

onAction('theme', (value) => {
  state.theme = value;
  store.set('draft.theme', value);
  applyTheme();
  syncSettings();
});
onAction('odds', setting('odds', 'draft.odds'));
onAction('xp', setting('xp', 'draft.xp'));
onAction('table-mode', setting('tableMode', 'draft.tableMode'));
// The lineup's chips are one choice, and tapping the chosen one again goes back to the
// default: the points, and the kick-offs (or projections) of those still to play.
onAction('due', (value) => {
  state.lineupStat = '';
  setting('due')(value);
});
onAction('lineup-stat', (value) => {
  state.lineupStat = state.lineupStat === value ? '' : value;
  state.due = '';
  renderView();
});
onAction('table-view', (value) => {
  state.tableView = value;
  withRowMoves(renderView);
});
onAction('manager', (value) => navigate(href.team(Number(value)))); // a table row
// A gameweek's arrows and picker, and any other move that shouldn't pile up in the history.
onAction('go', (value) => navigate(value, { replace: true }));
// Elsewhere, as a link inside a link to something else would (a player's manager's pill).
onAction('open', (value) => navigate(value));
onAction('follow', (value) => {
  state.myTeam = state.myTeam === Number(value) ? null : Number(value);
  store.set('draft.myTeam', state.myTeam ? String(state.myTeam) : '');
  renderView();
});

// A link inside something with an action (a form pill in a table row) goes where it says.
const linkWins = (target: HTMLElement, link: Element | null) => link !== null && link !== target && target.contains(link);

function onClick(event: MouseEvent) {
  // On a sheet's backdrop: its panel fills the dialog, so only a tap around it lands on the dialog.
  if (event.target instanceof HTMLDialogElement) return event.target.close();
  const target = (event.target as Element).closest<HTMLElement>('[data-action]');
  const link = (event.target as Element).closest('a[href]');
  if (!target || target.tagName === 'SELECT' || linkWins(target, link)) return;
  if (link && link !== target) event.preventDefault(); // inside a link, the action wins
  runAction(target);
}

export function bindChrome() {
  bindScroll();
  bindDocument();
  bindWindow();
  bindSettings();
  bindSearch();
  bindTooltips();
}

function bindDocument() {
  document.addEventListener('click', onClick);
  document.addEventListener('error', onPhotoError, true); // image events don't bubble
  document.addEventListener('load', (event) => (event.target as Element).classList?.remove('loading'), true);
  document.addEventListener('change', (event) => {
    const select = event.target as HTMLSelectElement;
    if (select.matches('[data-action="season"]')) switchSeason(select.value);
    else if (select.matches('select[data-action]')) runAction(select);
  });
  // Scrolls don't bubble: a table's rows scrolled sideways, for its header to follow.
  document.addEventListener(
    'scroll',
    (event) => event.target instanceof HTMLElement && event.target.matches('.split-rows') && alignHead(event.target),
    { capture: true, passive: true },
  );
  document.fonts?.ready.then(() => placeTabIndicator());
}

function bindWindow() {
  window.addEventListener('hashchange', () => {
    closeMenu();
    const from = pageKey(state.route);
    changeEntry(() => {
      readRoute();
      renderView();
      return pageKey(state.route) === from;
    });
  });
  window.addEventListener('resize', () => {
    placeTabIndicator();
    alignHeads();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => state.theme === 'system' && applyTheme());
}

// The cog's menu, and the search's results, close on a click anywhere else.
function bindSettings() {
  const button = document.getElementById('settings-btn')!;
  const menu = document.getElementById('settings-menu')!;
  button.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    button.setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('click', (event) => {
    const target = event.target as Element;
    if (!target.closest('.settings')) closeMenu();
    if (!target.closest('.search')) document.getElementById('search-results')!.hidden = true;
  });
  document.addEventListener('keydown', (event) => event.key === 'Escape' && closeMenu());
}

// A photo that fails tries the other address, then gets out of the way of the kit.
function onPhotoError(event: Event) {
  const img = event.target;
  if (!(img instanceof HTMLImageElement) || !img.closest('.photo')) return;
  if (img.dataset.fallback) {
    img.src = img.dataset.fallback;
    delete img.dataset.fallback;
    img.classList.add('loading');
  } else {
    img.remove();
  }
}

function closeMenu() {
  document.getElementById('settings-menu')!.hidden = true;
  document.getElementById('settings-btn')!.setAttribute('aria-expanded', 'false');
}
