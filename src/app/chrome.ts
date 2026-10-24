// Page chrome: routing, theme, settings, search, tooltips and the one click handler,
// which runs whatever action the element clicked registered (actions.ts).

import { onAction, runAction } from './actions.ts';
import { avatar, crest, empty, markLoadingPhotos, photo, tag } from './components.ts';
import { esc, fmtShortDay } from './format.ts';
import { leagueSvg, premierLeagueSvg } from './icons.ts';
import { applyLatestLive, applyLatestTransfers, loadData, pollTransfers, scheduleRefresh } from './live-scores.ts';
import { club, first, gwInfo, mgr, seasonSlug } from './lookups.ts';
import { featuredGw } from './matches.ts';
import { plMatches, plState } from './pl.ts';
import { recentVisits, visitHref, type Visit } from './recent.ts';
import { navigate, placeTabIndicator, renderAll, renderView, syncSettings } from './render.ts';
import { href, legacyRedirect, parseRoute } from './router.ts';
import { D, seasons, state, store } from './state.ts';
import { withRowMoves } from './table.ts';

type Tipped = HTMLElement | SVGElement;

async function switchSeason(slug: string) {
  const entry = seasons.find((s) => seasonSlug(s.season) === slug);
  state.season = entry && !entry.current ? slug : null;
  const url = new URL(location.href);
  if (state.season) url.searchParams.set('season', state.season);
  else url.searchParams.delete('season');
  history.replaceState(null, '', url);
  Object.assign(state, { openSquad: null, logManager: 'all' });
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
  if (moved) history.replaceState(null, '', `${location.pathname}${location.search}${moved}`);
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
onAction('due', setting('due'));
onAction('lineup-stat', (value) => {
  state.lineupStat = state.lineupStat === value ? '' : value; // tapping the chosen filter again goes back to points
  renderView();
});
onAction('table-view', (value) => {
  state.tableView = value;
  withRowMoves(renderView);
});
onAction('manager', (value) => navigate(href.team(Number(value)))); // a table row
// A gameweek's arrows and picker, and any other move that shouldn't pile up in the history.
onAction('go', (value) => navigate(value, { replace: true }));
onAction('follow', (value) => {
  state.myTeam = state.myTeam === Number(value) ? null : Number(value);
  store.set('draft.myTeam', state.myTeam ? String(state.myTeam) : '');
  renderView();
});

// A link inside something with an action (a form pill in a table row) goes where it says.
function onClick(event: MouseEvent) {
  // On a sheet's backdrop: its panel fills the dialog, so only a tap around it lands on the dialog.
  if (event.target instanceof HTMLDialogElement) return event.target.close();
  const target = (event.target as Element).closest<HTMLElement>('[data-action]');
  const link = (event.target as Element).closest('a[href]');
  if (!target || target.tagName === 'SELECT' || (link && link !== target && target.contains(link))) return;
  runAction(target);
}

export function bindChrome() {
  document.addEventListener('click', onClick);
  document.addEventListener('error', onPhotoError, true); // image events don't bubble
  document.addEventListener('load', (event) => (event.target as Element).classList?.remove('loading'), true);
  document.addEventListener('change', (event) => {
    const select = event.target as HTMLSelectElement;
    if (select.matches('[data-action="season"]')) switchSeason(select.value);
    else if (select.matches('select[data-action]')) runAction(select);
  });
  window.addEventListener('hashchange', () => {
    closeMenu();
    readRoute();
    renderView();
    window.scrollTo({ top: 0 });
  });
  window.addEventListener('resize', () => placeTabIndicator());
  document.fonts?.ready.then(() => placeTabIndicator());
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

// fotmob.com's search: chips for the kind of thing (all, or players, matches, teams or
// leagues), and links to their pages, the pages opened last before anything is typed.
// Enter opens the first.
type Kind = 'all' | 'players' | 'matches' | 'teams' | 'leagues';
const KINDS: [Kind, string][] = [
  ['all', 'All'],
  ['players', 'Players'],
  ['matches', 'Matches'],
  ['teams', 'Teams'],
  ['leagues', 'Leagues'],
];
let searchKind: Kind = 'all';

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
const searchRow = (to: string, lead: string, name: string, meta: string, side = '') =>
  `<a class="sr" href="${to}">${lead}<div class="sr-main"><div class="sr-name">${name}</div><div class="sr-meta">${meta}</div></div>${side}</a>`;
const pair = (a: string, b: string) => `<span class="stack">${a}${b}</span>`;

function playerRows(q: string, n: number) {
  return Object.entries(D.players)
    .filter(([, p]) => !q || fold(`${p.name} ${p.full}`).includes(q))
    .sort((a, b) => (b[1].owner ? 1 : 0) - (a[1].owner ? 1 : 0) || b[1].total - a[1].total)
    .slice(0, n)
    .map(([pid, p]) => {
      const owner = p.owner ? `<span class="sr-owner">${avatar(p.owner, 24)}<span>${first(p.owner)}</span></span>` : tag('Free agent');
      const flag = p.status !== 'a' ? ` · ${esc(p.news || 'flagged')}` : '';
      return searchRow(
        href.player(Number(pid)),
        photo(pid, 32),
        esc(p.name),
        `${crest(p.club, 14)} ${esc(club(p.club).short)} · ${p.pos} · ${p.total} pts${flag}`,
        owner,
      );
    });
}

// Head-to-heads by a side's manager or team, the Premier League's by a club, the nearest
// to now first (this round's without a query).
function matchRows(q: string, n: number) {
  const now = Date.now();
  const deadline = (gw: number) => Date.parse(gwInfo(gw)?.deadline ?? '') || 0;
  const managerHit = (id: number) => fold(`${mgr(id)?.first} ${mgr(id)?.team}`).includes(q);
  const clubHit = (id: number) => fold(`${club(id)?.name} ${club(id)?.short}`).includes(q);
  const gw = featuredGw();
  const draft = D.matches
    .filter((m) => (q ? managerHit(m.home) || managerHit(m.away) : m.gw === gw))
    .map((m) => ({
      at: deadline(m.gw),
      html: searchRow(
        href.match(m),
        pair(avatar(m.home, 24), avatar(m.away, 24)),
        `${first(m.home)} v ${first(m.away)}`,
        `Gameweek ${m.gw}${m.started ? ` · ${m.homePts}–${m.awayPts}` : ''}`,
      ),
    }));
  const real = q
    ? plMatches()
        .filter((m) => clubHit(m.home) || clubHit(m.away))
        .map((m) => {
          const s = plState(m);
          const when =
            s.state === 'due' ? (m.ko ? ` · ${fmtShortDay.format(new Date(m.ko))}` : '') : ` · ${s.score?.[0] ?? 0}–${s.score?.[1] ?? 0}`;
          return {
            at: Date.parse(m.ko ?? '') || 0,
            html: searchRow(
              href.plMatch(m.id),
              pair(crest(m.home, 22), crest(m.away, 22)),
              `${esc(club(m.home)?.name)} v ${esc(club(m.away)?.name)}`,
              `Premier League · round ${m.gw}${when}`,
            ),
          };
        })
    : [];
  return [...draft, ...real]
    .sort((a, b) => Math.abs(a.at - now) - Math.abs(b.at - now))
    .slice(0, n)
    .map((x) => x.html);
}

function teamRows(q: string, n: number) {
  return D.managers
    .filter((m) => !q || fold(`${m.first} ${m.team}`).includes(q))
    .slice(0, n)
    .map((m) => searchRow(href.team(m.id), avatar(m.id, 32), esc(m.team), `${first(m.id)} · Draft team`));
}

function leagueRows(q: string) {
  const leagues = [
    { name: D.meta.name, meta: 'Draft league', to: href.league(), icon: leagueSvg },
    { name: 'Premier League', meta: 'England', to: href.pl(), icon: premierLeagueSvg },
  ];
  return leagues
    .filter((l) => !q || fold(l.name).includes(q))
    .map((l) => searchRow(l.to, `<span class="sr-icon">${l.icon}</span>`, esc(l.name), l.meta));
}

function rowsOf(kind: Exclude<Kind, 'all'>, q: string, n: number) {
  if (kind === 'players') return playerRows(q, n);
  if (kind === 'matches') return matchRows(q, n);
  if (kind === 'teams') return teamRows(q, n);
  return leagueRows(q);
}

const HEADS: Record<Exclude<Kind, 'all'>, string> = { players: 'Players', matches: 'Matches', teams: 'Teams', leagues: 'Leagues' };

function bindSearch() {
  const input = document.getElementById('search') as HTMLInputElement;
  const panel = document.getElementById('search-results')!;
  const show = () => {
    const q = fold(input.value.trim());
    if (!D) return;
    const chips = `<div class="sr-kinds">${KINDS.map(([kind, label]) => `<button type="button" class="chip" data-kind="${kind}" aria-pressed="${kind === searchKind}">${label}</button>`).join('')}</div>`;
    let body: string;
    if (q.length < 2) body = suggestions(searchKind);
    else if (searchKind !== 'all') {
      const rows = rowsOf(searchKind, q, 10);
      body = rows.length ? rows.join('') : empty(`No ${HEADS[searchKind].toLowerCase()} found`);
    } else {
      const sections = (['players', 'matches', 'teams', 'leagues'] as const)
        .map((kind) => [kind, rowsOf(kind, q, kind === 'players' ? 5 : 3)] as const)
        .filter(([, rows]) => rows.length)
        .map(([kind, rows]) => `<div class="sr-head">${HEADS[kind]}</div>${rows.join('')}`);
      body = sections.length ? sections.join('') : empty('Nothing found');
    }
    panel.innerHTML = chips + body;
    markLoadingPhotos(panel);
    panel.hidden = false;
  };
  input.addEventListener('input', show);
  input.addEventListener('focus', show);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') panel.querySelector<HTMLAnchorElement>('a.sr')?.click();
    if (event.key === 'Escape' || event.key === 'Enter') {
      input.value = '';
      panel.hidden = true;
      input.blur();
    }
  });
  panel.addEventListener('click', (event) => {
    const kind = (event.target as Element).closest<HTMLElement>('[data-kind]')?.dataset.kind as Kind | undefined;
    if (kind) {
      // Redrawn, the chip is no longer in the page, which would read as a click outside the search.
      event.stopPropagation();
      searchKind = kind;
      show();
      input.focus();
      return;
    }
    if (!(event.target as Element).closest('a.sr')) return;
    input.value = '';
    panel.hidden = true;
    input.blur();
  });
}

const KIND_OF: Record<Visit['page'], Exclude<Kind, 'all'>> = { player: 'players', match: 'matches', 'pl-match': 'matches', team: 'teams' };

// Before anything is typed: the pages of the kind opened last, then the rest of the kind's
// usual ones (the top players, this round's matches, the teams, the leagues). For all of
// them together, the pages opened last, or else the teams.
function suggestions(kind: Kind) {
  // All of them together: the last six, whatever kind.
  const visits = recentVisits()
    .filter((v) => kind === 'all' || KIND_OF[v.page] === kind)
    .slice(0, 6);
  const recent = visits.flatMap((v) => {
    if (v.page === 'player' && D.players[v.id!]) {
      const p = D.players[v.id!];
      return [searchRow(visitHref(v), photo(v.id!, 32), esc(p.name), `${crest(p.club, 14)} ${esc(club(p.club).short)} · ${p.pos}`)];
    }
    if (v.page === 'team' && mgr(v.id))
      return [searchRow(visitHref(v), avatar(v.id, 32), esc(mgr(v.id)!.team), `${first(v.id)} · Draft team`)];
    if (v.page === 'match' && mgr(v.home) && mgr(v.away))
      return [
        searchRow(visitHref(v), pair(avatar(v.home, 24), avatar(v.away, 24)), `${first(v.home)} v ${first(v.away)}`, `Gameweek ${v.gw}`),
      ];
    const pm = v.page === 'pl-match' ? D.plMatches?.find((m) => m.id === v.id) : undefined;
    if (pm)
      return [
        searchRow(
          visitHref(v),
          pair(crest(pm.home, 22), crest(pm.away, 22)),
          `${esc(club(pm.home).name)} v ${esc(club(pm.away).name)}`,
          `Premier League · round ${pm.gw}`,
        ),
      ];
    return [];
  });
  const head = (text: string) => `<div class="sr-head">${text}</div>`;
  if (kind === 'all') return recent.length ? `${head('Recent')}${recent.join('')}` : `${head('Teams')}${teamRows('', 8).join('')}`;
  const seen = visits.map((v) => `href="${visitHref(v)}"`);
  const more = rowsOf(kind, '', 10)
    .filter((row) => !seen.some((h) => row.includes(h)))
    .slice(0, Math.max(3, 10 - recent.length));
  return `${recent.length ? `${head('Recent')}${recent.join('')}` : ''}${more.length ? `${head(HEADS[kind])}${more.join('')}` : ''}`;
}

function bindTooltips() {
  const tip = document.getElementById('tooltip')!;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  const show = (el: Tipped) => {
    clearTimeout(hideTimer);
    tip.textContent = el.dataset.tip ?? el.getAttribute('data-tip');
    const line = (text: string, className = '') => Object.assign(document.createElement('div'), { className, textContent: text });
    // A heading over it, when it has one.
    const heading = el.dataset.tipHead;
    if (heading) tip.replaceChildren(line(heading, 'tip-head'), line(tip.textContent ?? ''));
    // Label and value pairs under the tip, lined up in two columns (as text, never markup).
    const rows = el.dataset.tipRows;
    if (rows) {
      const grid = Object.assign(document.createElement('div'), { className: 'tip-rows' });
      for (const row of rows.split('\n'))
        for (const cell of row.split('\t')) grid.append(Object.assign(document.createElement('span'), { textContent: cell }));
      // The tip's first line heads it; any after it (who against) are plain.
      const [head, ...below] = (tip.textContent ?? '').split('\n');
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
