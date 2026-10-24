// The page's addresses, as fotmob.com's: the home page at #/, then a page per league,
// team, match and player, each with its tabs, like #/league/table, #/team/123/squad,
// #/match/9/123-456, #/premier-league/match/81/player-stats and #/player/351. Links from
// before the pages (#table, #squads/123) still land where they used to.

export type Page = 'home' | 'league' | 'pl' | 'transfers' | 'teams' | 'team' | 'match' | 'pl-match' | 'player';

export interface Route {
  page: Page;
  /** The page's tab; '' for a page without tabs. */
  tab: string;
  /** The team (entry), Premier League match (fixture) or player. */
  id?: number;
  /** The gameweek: the home page's round, a fixtures tab's, or a match's. */
  gw?: number;
  /** A head-to-head match's sides. */
  home?: number;
  away?: number;
  /** Anything after the tab, like the Stats tab's view. */
  arg?: string;
}

export const LEAGUE_TABS = ['overview', 'table', 'fixtures', 'stats', 'transfer-stats', 'draft'] as const;
export const PL_TABS = ['overview', 'fixtures', 'table'] as const;
export const TEAM_TABS = ['overview', 'squad', 'fixtures', 'transfers', 'stats'] as const;
export const MATCH_TABS = ['facts', 'commentary', 'lineup', 'table', 'stats', 'h2h'] as const;
export const PL_MATCH_TABS = ['facts', 'player-stats'] as const;

const num = (s: string | undefined) => (s && /^\d+$/.test(s) ? Number(s) : undefined);
const tabOf = (tabs: readonly string[], s: string | undefined) => (s && tabs.includes(s) ? s : tabs[0]);

// The old tabs and where they live now.
const LEGACY: Record<string, (arg: string | undefined) => string> = {
  overview: () => '#/',
  table: () => '#/league/table',
  fixtures: (gw) => `#/league/fixtures${gw ? `/${gw}` : ''}`,
  squads: (id) => (id ? `#/team/${id}` : '#/teams'),
  stats: (view) => (view === 'transfers' ? '#/league/transfer-stats' : '#/league/stats'),
  transfers: () => '#/transfers',
  draft: () => '#/league/draft',
};

/** Where an old address goes now, or null for one of today's. */
export function legacyRedirect(hash: string): string | null {
  if (hash.startsWith('#/')) return null;
  const [tab, arg] = hash.replace(/^#/, '').split('/');
  return tab ? (LEGACY[tab]?.(arg) ?? '#/') : null;
}

export function parseRoute(hash: string): Route {
  const [page = '', ...rest] = hash.replace(/^#\/?/, '').split('/');
  const [a, b] = rest;
  switch (page) {
    case 'round':
      return { page: 'home', tab: '', gw: num(a) };
    case 'league': {
      const tab = tabOf(LEAGUE_TABS, a);
      return { page: 'league', tab, ...(tab === 'fixtures' ? { gw: num(b) } : { arg: b }) };
    }
    case 'premier-league':
      if (a === 'match' && num(b)) return { page: 'pl-match', tab: tabOf(PL_MATCH_TABS, rest[2]), id: num(b) };
      return { page: 'pl', tab: tabOf(PL_TABS, a), gw: num(b) };
    case 'transfers':
      return { page: 'transfers', tab: '' };
    case 'teams':
      return { page: 'teams', tab: '' };
    case 'team':
      if (num(a)) return { page: 'team', tab: tabOf(TEAM_TABS, b), id: num(a) };
      break;
    case 'match': {
      const [home, away] = (b ?? '').split('-').map(num);
      if (num(a) && home && away) return { page: 'match', tab: tabOf(MATCH_TABS, rest[2]), gw: num(a), home, away };
      break;
    }
    case 'player':
      if (num(a)) return { page: 'player', tab: '', id: num(a) };
      break;
  }
  return { page: 'home', tab: '' };
}

const tabPath = (tab: string, first: string) => (tab === first ? '' : `/${tab}`);

/** Links to each page and tab. */
export const href = {
  home: (gw?: number) => (gw ? `#/round/${gw}` : '#/'),
  league: (tab = 'overview', arg?: string | number) =>
    `#/league${tab === 'overview' && arg == null ? '' : `/${tab}`}${arg != null ? `/${arg}` : ''}`,
  pl: (tab = 'overview', gw?: number) =>
    `#/premier-league${tab === 'overview' && gw == null ? '' : `/${tab}`}${gw != null ? `/${gw}` : ''}`,
  transfers: () => '#/transfers',
  teams: () => '#/teams',
  team: (id: number, tab = 'overview') => `#/team/${id}${tabPath(tab, 'overview')}`,
  match: (m: { gw: number; home: number; away: number }, tab = 'facts') => `#/match/${m.gw}/${m.home}-${m.away}${tabPath(tab, 'facts')}`,
  plMatch: (id: number, tab = 'facts') => `#/premier-league/match/${id}${tabPath(tab, 'facts')}`,
  player: (pid: number) => `#/player/${pid}`,
};
