// Page chrome: routing, theme, settings, search, tooltips and click handling.

import { avatar, crest, empty, markLoadingPhotos, photo, tag } from './components.ts';
import { esc } from './format.ts';
import { applyLatestLive, applyLatestTransfers, loadData, pollTransfers, scheduleRefresh } from './live-scores.ts';
import { club, first, matchKey, seasonSlug } from './lookups.ts';
import { placeTabIndicator, renderAll, renderView, syncSettings } from './render.ts';
import { D, seasons, state, store, TABS } from './state.ts';
import { withRowMoves } from './table.ts';

type Tipped = HTMLElement | SVGElement;

async function switchSeason(slug: string) {
  const entry = seasons.find((s) => seasonSlug(s.season) === slug);
  state.season = entry && !entry.current ? slug : null;
  const url = new URL(location.href);
  if (state.season) url.searchParams.set('season', state.season);
  else url.searchParams.delete('season');
  history.replaceState(null, '', url);
  Object.assign(state, { gw: null, openMatch: null, openSquad: null, squadId: null, logManager: 'all' });
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
  const [tab, arg] = location.hash.slice(1).split('/');
  state.tab = TABS.some((t) => t.id === tab) ? tab : 'overview';
  if (state.tab === 'fixtures' && arg) state.gw = Number(arg) || state.gw;
  if (state.tab === 'stats') state.statsView = arg === 'transfers' ? 'transfers' : 'season';
  if (state.tab === 'squads' && arg) state.squadId = Number(arg) || state.squadId;
}

export function applyTheme() {
  const dark = state.theme === 'dark' || (state.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  // The installed app's status bar follows the top bar.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1a1a1a' : '#ffffff');
}

// --- Events ------------------------------------------------------------------------

function onClick(event: MouseEvent) {
  const target = (event.target as Element).closest<HTMLElement>('[data-action]');
  if (!target) return;
  const { action, value } = target.dataset as { action: string; value: string };
  if (action === 'theme') {
    state.theme = value;
    store.set('draft.theme', value);
    applyTheme();
    syncSettings();
  } else if (action === 'odds') {
    state.odds = value;
    store.set('draft.odds', value);
    renderView();
  } else if (action === 'due') {
    state.due = value;
    renderView();
  } else if (action === 'xp') {
    state.xp = value;
    store.set('draft.xp', value);
    renderView();
  } else if (action === 'table-mode') {
    state.tableMode = value;
    store.set('draft.tableMode', value);
    renderView();
  } else if (action === 'table-view') {
    state.tableView = value;
    if (state.tab === 'table') withRowMoves(renderView);
  } else if (action === 'gw') {
    goToGameweek(Number(value));
  } else if (action === 'stats-view') {
    state.statsView = value;
    history.replaceState(null, '', value === 'transfers' ? '#stats/transfers' : '#stats');
    renderView();
  } else if (action === 'log') {
    state.logManager = value;
    renderView();
  } else if (action === 'squad') {
    state.openSquad = state.openSquad === value ? null : value;
    renderView();
  } else if (action === 'squads') {
    state.squadId = Number(value);
    history.replaceState(null, '', `#squads/${value}`);
    renderView();
  } else if (action === 'lineup-view') {
    state.lineupView = value;
    renderView();
  } else if (action === 'lineup-stat') {
    state.lineupStat = state.lineupStat === value ? '' : value; // tapping the chosen filter again goes back to points
    renderView();
  } else if (action === 'squad-scope') {
    state.squadScope = value;
    renderView();
  } else if (action === 'squad-sort') {
    state.squadSort = value;
    renderView();
  } else if (action === 'manager') {
    location.hash = `squads/${value}`; // a table row
  } else if (action === 'match') {
    if (target.dataset.go) {
      // A form pill: open that week's match on the Fixtures tab.
      const gw = Number(value);
      const opp = Number(target.dataset.a);
      const m = D.matches.find((x) => x.gw === gw && (x.home === opp || x.away === opp));
      state.openMatch = m ? matchKey(m) : null;
      state.gw = gw;
      location.hash = `fixtures/${gw}`;
      return;
    }
    state.openMatch = state.openMatch === value ? null : value;
    renderView();
  }
}

function goToGameweek(gw: number) {
  state.gw = gw;
  state.openMatch = null;
  history.replaceState(null, '', `#fixtures/${gw}`);
  renderView();
}

export function bindChrome() {
  document.addEventListener('click', onClick);
  document.addEventListener('error', onPhotoError, true); // image events don't bubble
  document.addEventListener('load', (event) => (event.target as Element).classList?.remove('loading'), true);
  document.addEventListener('change', (event) => {
    const select = event.target as HTMLSelectElement;
    if (select.matches('[data-action="gw-select"]')) goToGameweek(Number(select.value));
    if (select.matches('[data-action="season"]')) switchSeason(select.value);
  });
  window.addEventListener('hashchange', () => {
    closeMenu();
    readRoute();
    renderView();
    window.scrollTo({ top: 0 });
  });
  window.addEventListener('resize', placeTabIndicator);
  document.fonts?.ready.then(placeTabIndicator);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => state.theme === 'system' && applyTheme());

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

  bindSearch();
  bindTooltips();
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

function bindSearch() {
  const input = document.getElementById('search') as HTMLInputElement;
  const panel = document.getElementById('search-results')!;
  const fold = (s: string) =>
    s
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
  const show = () => {
    const q = fold(input.value.trim());
    if (q.length < 2 || !D) {
      panel.hidden = true;
      return;
    }
    const hits = Object.entries(D.players)
      .filter(([, p]) => fold(`${p.name} ${p.full}`).includes(q))
      .sort((a, b) => (b[1].owner ? 1 : 0) - (a[1].owner ? 1 : 0) || b[1].total - a[1].total)
      .slice(0, 8);
    panel.innerHTML = hits.length
      ? hits
          .map(([pid, p]) => {
            const owner = p.owner
              ? `<span class="sr-owner">${avatar(p.owner, 24)}<span>${first(p.owner)}</span></span>`
              : tag('Free agent');
            const flag = p.status !== 'a' ? ` · ${esc(p.news || 'flagged')}` : '';
            return `<div class="sr">${photo(pid, 32)}<div class="sr-main"><div class="sr-name">${esc(p.name)}</div><div class="sr-meta">${crest(p.club, 14)} ${esc(club(p.club).short)} · ${p.pos} · ${p.total} pts${flag}</div></div>${owner}</div>`;
          })
          .join('')
      : empty('No players found');
    markLoadingPhotos(panel);
    panel.hidden = false;
  };
  input.addEventListener('input', show);
  input.addEventListener('focus', show);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      input.value = '';
      panel.hidden = true;
      input.blur();
    }
  });
}

function bindTooltips() {
  const tip = document.getElementById('tooltip')!;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  const show = (el: Tipped) => {
    clearTimeout(hideTimer);
    tip.textContent = el.dataset.tip ?? el.getAttribute('data-tip');
    // Label and value pairs under the tip, lined up in two columns (as text, never markup).
    const rows = el.dataset.tipRows;
    if (rows) {
      const grid = Object.assign(document.createElement('div'), { className: 'tip-rows' });
      for (const row of rows.split('\n'))
        for (const cell of row.split('\t')) grid.append(Object.assign(document.createElement('span'), { textContent: cell }));
      // The tip's first line heads it; any after it (who against) are plain.
      const [head, ...below] = (tip.textContent ?? '').split('\n');
      const line = (text: string, className = '') => Object.assign(document.createElement('div'), { className, textContent: text });
      tip.replaceChildren(line(head, 'tip-head'), ...below.map((text) => line(text)), grid);
    }
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const half = tip.offsetWidth / 2;
    const center = r.left + r.width / 2;
    const x = Math.min(Math.max(center, half + 8), window.innerWidth - half - 8);
    const below = r.top < tip.offsetHeight + 16;
    tip.classList.toggle('below', below);
    tip.style.left = `${x}px`;
    tip.style.top = `${below ? r.bottom : r.top}px`;
    tip.style.setProperty('--arrow', `${center - x}px`);
  };
  const hide = () => {
    tip.hidden = true;
  };
  const tipped = (target: EventTarget | null) => (target as Element).closest<Tipped>('[data-tip]');
  document.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'touch') return;
    const el = tipped(event.target);
    if (el) show(el);
  });
  document.addEventListener('pointerout', (event) => {
    const el = tipped(event.target);
    if (el && !el.contains(event.relatedTarget as Node | null)) hide();
  });
  document.addEventListener('pointerdown', (event) => {
    const el = tipped(event.target);
    if (event.pointerType !== 'touch' || !el) return hide();
    show(el);
    hideTimer = setTimeout(hide, el.classList.contains('info-btn') ? 10000 : 2500);
  });
  // Nor the phone's menu for the image or text under it (Android's comes as a contextmenu).
  document.addEventListener('contextmenu', (event) => {
    if ((event as PointerEvent).pointerType === 'touch' && tipped(event.target)) event.preventDefault();
  });
  document.addEventListener('focusin', (event) => (event.target as Element).matches?.('[data-tip]') && show(event.target as Tipped));
  document.addEventListener('focusout', (event) => (event.target as Element).matches?.('[data-tip]') && hide());
  // Scrolling hides a hover tip, but a focused element (keyboard) keeps its tip in place.
  window.addEventListener(
    'scroll',
    () => (!tip.hidden && document.activeElement?.matches?.('[data-tip]') ? show(document.activeElement as Tipped) : hide()),
    {
      passive: true,
    },
  );
}
