// Settings, view state and the loaded data, shared by every module of the page.

import type { Data, Lineup, Manager, SeasonEntry } from '../shared/data.ts';
import type { Scored, SlimLive } from '../shared/live.ts';
import type { Route } from './router.ts';

export const COLOR_SLOTS = 8; // --m1 … --m8 in styles.css; any later manager gets grey
export const REFRESH_MS = 10 * 60 * 1000;
export const LIVE_REFRESH_MS = 2 * 60 * 1000; // data.json itself changes about every 10 minutes during matches
// Near real-time scores while a gameweek is being played come from a small Cloudflare
// Worker (worker/), because browsers can't call the FPL API. Leave empty to rely on
// data.json, which the scheduled job refreshes every 10 minutes during matches. ?relay=off
// does that for one visit, to try a gameweek faked by scripts/fake-live.ts.
export const LIVE_URL: string =
  new URLSearchParams(location.search).get('relay') === 'off' ? '' : 'https://fpl-draft-live.digernes.workers.dev';
export const LIVE_POLL_MS = 30 * 1000; // while Premier League matches are on
export const LIVE_IDLE_MS = 5 * 60 * 1000; // between the match days of a live gameweek
export const TRANSFERS_POLL_MS = 2 * 60 * 1000; // new moves between builds, from the relay

export const store = {
  get(key: string, fallback: string): string {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage blocked: the setting just won't stick between visits.
    }
  },
};

export const state = {
  route: { page: 'home', tab: '' } as Route, // the page shown, from the address (router.ts)
  theme: store.get('draft.theme', 'system'),
  odds: store.get('draft.odds', 'decimal'),
  xp: store.get('draft.xp', 'model'), // expected points: 'model' (the site's own) or 'fpl' (FPL's form)
  tableView: 'overall',
  tableMode: store.get('draft.tableMode', 'short'), // narrow screens: 'short' columns or 'form'
  myTeam: Number(store.get('draft.myTeam', '')) || null, // the team the visitor follows
  logManager: 'all', // the Transfer center's team: 'all' or a manager's id
  moveType: 'all', // and its kind of move: 'all', 'waiver', 'free' or 'trade'
  moveGw: 'all', // its gameweek: 'all' or one
  movePos: 'all', // its players' position: 'all', 'GKP', 'DEF', 'MID' or 'FWD'
  openSquad: null as string | null, // manager whose original squad is expanded
  moves: 'all', // a team's moves, on its Transfers tab: 'all', 'in' or 'out'
  lineupView: 'last', // a team's pitch: 'last' (the latest lineup) or 'all' (the season's best XI)
  lineupStat: '', // the pitches' lineup filter: '' (points), 'xp', 'xg', 'xa' or 'xcs'
  due: '', // what the pitches' players still to play show: 'xp' (projected points, and those on the pitch theirs too), 'ko' (kick-off) or '' (projections before a gameweek, kick-offs once it's on)
  squadScope: 'now', // a team's squad: 'now' (the squad) or 'all' (everyone ever owned)
  squadSort: 'lineup', // a team's squad's column: 'lineup' (XI, bench, new signings), 'gw', 'xp' or 'total'
  statsCategory: 'top', // the Premier League's player stats: 'top', 'expected', 'projected' (the season's alone), 'attack', 'defence', 'goalkeeping' or 'fpl'
  statsSort: '', // and the column they're sorted by (none: the category's first), highest first unless statsAsc
  statsAsc: false,
  playersPos: 'all', // the Premier League's season of player stats: a position, or 'all'
  playersOwner: 'all', // and whose: 'all', 'free' (the free agents) or a manager's id
  playersAll: false, // all of them, rather than the first 50
  commentaryBench: false, // a head-to-head's commentary: the benches' players too
  momentumView: 'lead', // a head-to-head's momentum: 'lead' or 'chance' (each side's chance of winning)
  season: null as string | null, // slug of an archived season being viewed, e.g. "2025-26"; null = current
};

export type ManagerSlot = Manager & { slot: number };
export type LiveLineup = Lineup & Scored;
export interface LiveState {
  gw: number;
  feed: SlimLive;
  lineups: Record<number, LiveLineup>;
  points: (id: number) => number;
  /** Bonus in those points, awarded or provisional. */
  bonus: (id: number) => number;
}

// Live bindings: importers always see the current values, and change them through the
// setters below.
export let D: Data;
export let managers = new Map<number, ManagerSlot>();
export let seasons: SeasonEntry[] = []; // from seasons/index.json; the current season's file is data.json
export let live: LiveState | null = null; // latest scores from the live relay: { gw, feed, lineups, points, bonus }

export function setData(data: Data) {
  D = data;
  managers = new Map(D.managers.map((m, slot) => [m.id, { ...m, slot }]));
}

export function setSeasons(list: SeasonEntry[]) {
  seasons = list;
}

export function setLive(value: LiveState | null) {
  live = value;
}
