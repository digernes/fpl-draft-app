// The top bar's search, which chrome.ts binds.

import { avatar, crest, empty, markLoadingPhotos, photo, tag } from './components.ts';
import { esc, fmtShortDay } from './format.ts';
import { leagueSvg, premierLeagueSvg } from './icons.ts';
import { club, first, gwInfo, mgr } from './lookups.ts';
import { featuredGw } from './matches.ts';
import { plMatches, plState } from './pl.ts';
import { recentVisits, visitHref, type Visit } from './recent.ts';
import { href } from './router.ts';
import type { PlMatch } from '../shared/data.ts';
import { D } from './state.ts';

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
  return [...draftMatchRows(q), ...(q ? plMatchRows(q) : [])]
    .sort((a, b) => Math.abs(a.at - now) - Math.abs(b.at - now))
    .slice(0, n)
    .map((x) => x.html);
}

interface Dated {
  at: number;
  html: string;
}

function draftMatchRows(q: string): Dated[] {
  const deadline = (gw: number) => Date.parse(gwInfo(gw)?.deadline ?? '') || 0;
  const managerHit = (id: number) => fold(`${mgr(id)?.first} ${mgr(id)?.team}`).includes(q);
  const gw = featuredGw();
  return D.matches
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
}

function plMatchRows(q: string): Dated[] {
  const clubHit = (id: number) => fold(`${club(id)?.name} ${club(id)?.short}`).includes(q);
  return plMatches()
    .filter((m) => clubHit(m.home) || clubHit(m.away))
    .map((m) => ({
      at: Date.parse(m.ko ?? '') || 0,
      html: searchRow(
        href.plMatch(m.id),
        pair(crest(m.home, 22), crest(m.away, 22)),
        `${esc(club(m.home)?.name)} v ${esc(club(m.away)?.name)}`,
        `Premier League · round ${m.gw}${plWhen(m)}`,
      ),
    }));
}

// Its kick-off's day before it starts, its score after.
function plWhen(m: PlMatch) {
  const s = plState(m);
  if (s.state !== 'due') return ` · ${s.score?.[0] ?? 0}–${s.score?.[1] ?? 0}`;
  return m.ko ? ` · ${fmtShortDay.format(new Date(m.ko))}` : '';
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

const kindChips = () =>
  `<div class="sr-kinds">${KINDS.map(([kind, label]) => `<button type="button" class="chip" data-kind="${kind}" aria-pressed="${kind === searchKind}">${label}</button>`).join('')}</div>`;

// What a query finds: of one kind, or a few of each kind under their heads.
function results(q: string) {
  if (q.length < 2) return suggestions(searchKind);
  if (searchKind !== 'all') {
    const rows = rowsOf(searchKind, q, 10);
    return rows.length ? rows.join('') : empty(`No ${HEADS[searchKind].toLowerCase()} found`);
  }
  const sections = (['players', 'matches', 'teams', 'leagues'] as const)
    .map((kind) => [kind, rowsOf(kind, q, kind === 'players' ? 5 : 3)] as const)
    .filter(([, rows]) => rows.length)
    .map(([kind, rows]) => `<div class="sr-head">${HEADS[kind]}</div>${rows.join('')}`);
  return sections.length ? sections.join('') : empty('Nothing found');
}

export function bindSearch() {
  const input = document.getElementById('search') as HTMLInputElement;
  const panel = document.getElementById('search-results')!;
  const show = () => {
    if (!D) return;
    panel.innerHTML = kindChips() + results(fold(input.value.trim()));
    markLoadingPhotos(panel);
    panel.hidden = false;
  };
  const close = () => {
    input.value = '';
    panel.hidden = true;
    input.blur();
  };
  input.addEventListener('input', show);
  input.addEventListener('focus', show);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') panel.querySelector<HTMLAnchorElement>('a.sr')?.click();
    if (event.key === 'Escape' || event.key === 'Enter') close();
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
    if ((event.target as Element).closest('a.sr')) close();
  });
}

const KIND_OF: Record<Visit['page'], Exclude<Kind, 'all'>> = { player: 'players', match: 'matches', 'pl-match': 'matches', team: 'teams' };

// A page opened before, while what it shows is still in the data.
const VISIT_ROWS: Record<Visit['page'], (v: Visit) => string | undefined> = {
  player: (v) => {
    const p = D.players[v.id!];
    return p && searchRow(visitHref(v), photo(v.id!, 32), esc(p.name), `${crest(p.club, 14)} ${esc(club(p.club).short)} · ${p.pos}`);
  },
  team: (v) => mgr(v.id) && searchRow(visitHref(v), avatar(v.id, 32), esc(mgr(v.id)!.team), `${first(v.id)} · Draft team`),
  match: (v) =>
    mgr(v.home) && mgr(v.away)
      ? searchRow(visitHref(v), pair(avatar(v.home, 24), avatar(v.away, 24)), `${first(v.home)} v ${first(v.away)}`, `Gameweek ${v.gw}`)
      : undefined,
  'pl-match': (v) => {
    const pm = D.plMatches?.find((m) => m.id === v.id);
    return (
      pm &&
      searchRow(
        visitHref(v),
        pair(crest(pm.home, 22), crest(pm.away, 22)),
        `${esc(club(pm.home).name)} v ${esc(club(pm.away).name)}`,
        `Premier League · round ${pm.gw}`,
      )
    );
  },
};

// Before anything is typed: the pages of the kind opened last, then the rest of the kind's
// usual ones (the top players, this round's matches, the teams, the leagues). For all of
// them together, the pages opened last, or else the teams.
function suggestions(kind: Kind) {
  // All of them together: the last six, whatever kind.
  const visits = recentVisits()
    .filter((v) => kind === 'all' || KIND_OF[v.page] === kind)
    .slice(0, 6);
  const recent = visits.flatMap((v) => VISIT_ROWS[v.page](v) ?? []);
  const head = (text: string) => `<div class="sr-head">${text}</div>`;
  if (kind === 'all') return recent.length ? `${head('Recent')}${recent.join('')}` : `${head('Teams')}${teamRows('', 8).join('')}`;
  const seen = visits.map((v) => `href="${visitHref(v)}"`);
  const more = rowsOf(kind, '', 10)
    .filter((row) => !seen.some((h) => row.includes(h)))
    .slice(0, Math.max(3, 10 - recent.length));
  return `${recent.length ? `${head('Recent')}${recent.join('')}` : ''}${more.length ? `${head(HEADS[kind])}${more.join('')}` : ''}`;
}
