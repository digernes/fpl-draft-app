// Lookups into the loaded data, aware of live scores and the season being viewed.

import type { Lineup, Match, Underlying } from '../shared/data.ts';
import type { PlayerEvents } from '../shared/live.ts';
import { esc } from './format.ts';
import { COLOR_SLOTS, D, live, managers, seasons, state } from './state.ts';

/** A match that has started, so both scores are in. */
export type Played = Match & { homePts: number; awayPts: number };

export const mgr = (id: number | null | undefined) => managers.get(id as number);
export const first = (id: number | null | undefined) => esc(mgr(id)?.first ?? '?');
export const player = (id: number) => D.players[id];
export const club = (id: number | undefined) => D.clubs[id as number];
export const gwInfo = (gw: number) => D.gameweeks.find((g) => g.id === gw);
export const gwPoints = (pid: number, gw: number) => (live?.gw === gw ? live.points(pid) : (player(pid)?.pts?.[gw - D.meta.firstGw] ?? 0));
export const lineupFor = (id: number, gw: number): Lineup | undefined => (live?.gw === gw && live.lineups[id]) || D.lineups[id]?.[gw];
// What a player did in a gameweek, from the relay while it is being played (data.json's
// copy if the relay's feed doesn't have them), and the bonus in his points.
export const gwEvents = (pid: number, gw: number): PlayerEvents | undefined =>
  ((live?.gw === gw && live.feed.events) || D.events?.[gw])?.[pid];
export const gwUnderlying = (pid: number, gw: number): Underlying | undefined => D.underlying?.[gw]?.[pid];
export const gwBonus = (pid: number, gw: number) => (live?.gw === gw ? live.bonus(pid) : (gwEvents(pid, gw)?.bonus ?? 0));
export const seasonStat = (id: number) => D.seasonStats.find((s) => s.id === id);
export const slotOf = (id: number) => {
  const slot = mgr(id)?.slot ?? COLOR_SLOTS;
  return slot < COLOR_SLOTS ? slot + 1 : 0;
};
export const isLive = () => D.matches.some((m) => m.started && !m.finished);

export const matchKey = (m: Match) => `${m.gw}:${m.home}:${m.away}`;

export const seasonSlug = (season: string) => season.replace('/', '-');
export const seasonLabel = (season: string) => `${Number(season.slice(0, 4))}/${Number(season.slice(0, 4)) + 1}`;
export const seasonEntry = () => seasons.find((s) => seasonSlug(s.season) === state.season);
export const isArchive = () => Boolean(seasonEntry() && !seasonEntry()!.current);

// Expected points by the cog's setting: the site's own (by default) or FPL's form, for the
// next gameweek and for the one being played.
export const nextXp = (pid: number) => (state.xp === 'fpl' ? (player(pid).fpl ?? player(pid).ep) : player(pid).ep);
export const liveXp = (pid: number) => (state.xp === 'fpl' ? D.live?.fplEp?.[pid] : undefined) ?? D.live?.ep[pid] ?? nextXp(pid);
