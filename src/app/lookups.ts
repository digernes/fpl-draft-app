// Lookups into the loaded data, aware of live scores and the season being viewed.

import type { Lineup, Match } from '../shared/data.ts';
import { liveXpIn, namedInGw, nextXpOf } from '../shared/in-play.ts';
import type { Named, PlayerEvents } from '../shared/live.ts';
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
export const gwBonus = (pid: number, gw: number) => (live?.gw === gw ? live.bonus(pid) : (gwEvents(pid, gw)?.bonus ?? 0));
export const seasonStat = (id: number) => D.seasonStats.find((s) => s.id === id);
export const slotOf = (id: number) => {
  const slot = mgr(id)?.slot ?? COLOR_SLOTS;
  return slot < COLOR_SLOTS ? slot + 1 : 0;
};
export const isLive = () => D.matches.some((m) => m.started && !m.finished);
/** Still open, every one of its matches over, as it is until FPL confirms the points (the bonus): no longer live, the points provisional. */
export const isSettling = () => {
  const gw = D.meta.currentGw;
  const feed = live?.gw === gw ? live.feed : D.live?.gw === gw ? D.live : null;
  return isLive() && Boolean(feed?.fixtures.length) && feed!.fixtures.every((f) => f.done);
};
// A club's Premier League matches in a gameweek, [home, away, kick-off]: from the relay's
// feed while the gameweek is being played, else data.json's for the few gameweeks to come
// that it lists them for, else the season's matches (plMatches), which have every gameweek's
// (the Projected columns go further ahead than those few).
export const clubFixtures = (team: number, gw: number): [number, number, string | null][] =>
  live?.gw === gw
    ? live.feed.fixtures.filter((f) => f.h === team || f.a === team).map((f) => [f.h, f.a, f.ko ?? null])
    : (gwInfo(gw)?.fixtures ?? seasonFixtures(gw)).filter(([h, a]) => h === team || a === team);
const seasonFixtures = (gw: number) =>
  (D.plMatches ?? []).filter((m) => m.gw === gw).map((m): [number, number, string | null] => [m.home, m.away, m.ko]);
export const versus = (opp: number, home: boolean) => `${club(opp)?.name ?? '?'} (${home ? 'H' : 'A'})`;
// Who a club plays in a gameweek: "Arsenal (H)", or "Arsenal (H), Chelsea (A)" in a double.
export const opponents = (team: number, gw: number) =>
  clubFixtures(team, gw)
    .map(([h, a]) => (h === team ? versus(a, true) : versus(h, false)))
    .join(', ');

// Who each club has named for its fixtures in a gameweek, once the Premier League has the
// lineups (from about an hour before kick-off).
export const namedIn = (gw: number): Named => namedInGw(D.plMatches, gw);

export const seasonSlug = (season: string) => season.replace('/', '-');
export const seasonLabel = (season: string) => `${Number(season.slice(0, 4))}/${Number(season.slice(0, 4)) + 1}`;
export const seasonEntry = () => seasons.find((s) => seasonSlug(s.season) === state.season);
export const isArchive = () => Boolean(seasonEntry() && !seasonEntry()!.current);

// Expected points by the cog's setting: the site's own (by default) or FPL's form, for the
// next gameweek and for the one being played.
export const nextXp = (pid: number) => nextXpOf(player(pid), state.xp === 'fpl');
export const liveXp = (pid: number) => liveXpIn(D, pid, state.xp === 'fpl');
// The site's taken apart, when the setting shows the site's.
export const nextParts = (pid: number) => (state.xp === 'fpl' ? undefined : player(pid).parts);
export const liveParts = (pid: number) => (state.xp === 'fpl' ? undefined : D.live?.parts?.[pid]);
// Any gameweek still to come that shows projections: the site's from `ahead` after the next,
// or FPL's form, which is the same every week.
const ahead = (pid: number, gw: number) => player(pid).ahead?.[gw - D.meta.nextGw - 1];
export const xpAt = (pid: number, gw: number) => (gw <= D.meta.nextGw || state.xp === 'fpl' ? nextXp(pid) : (ahead(pid, gw)?.ep ?? 0));
export const partsAt = (pid: number, gw: number) => (state.xp === 'fpl' ? undefined : modelParts(pid, gw));
// The site's taken apart in any gameweek still to come whatever the setting, for the Projected
// columns, which are the site's alone: only where data.json has them (players in a squad, for
// the gameweeks it shows projected XIs for).
export const modelParts = (pid: number, gw: number) => (gw <= D.meta.nextGw ? player(pid).parts : ahead(pid, gw)?.parts);
