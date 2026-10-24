// Managers, their head-to-head matches, and every lineup they have put out: points,
// the double-gameweek adjustment, bench points and expected points, and what the
// players in it did.

import type { ById, Data, LiveData, Lineup, Manager, Match, Underlying, XpParts } from '../shared/data.ts';
import { scoreLineup, slimLive, type PlayerEvents, type SlimLive } from '../shared/live.ts';
import { packUnderlying, underlyingOf } from '../shared/underlying.ts';
import { readScoring } from '../model/points.ts';
import { DGW_PENALTY } from './config.ts';
import type { Season } from './season.ts';
import { round, sum } from './util.ts';

export function buildManagers(season: Season) {
  const entries = season.details.league_entries.filter((e) => e.entry_id);
  // Only first names leave this script, because the page is public. Managers who share
  // a first name get their surname initial.
  const firstNames = entries.map((e) => e.player_first_name.trim());
  const managers: Manager[] = entries.map((e, i) => {
    const name = firstNames[i];
    const shared = firstNames.filter((f) => f === name).length > 1;
    return {
      id: e.entry_id as number,
      first: shared ? `${name} ${e.player_last_name.trim().charAt(0)}.` : name,
      initials: e.short_name,
      team: e.entry_name,
      waiverPick: e.waiver_pick,
    };
  });
  const entryByLeagueEntry = new Map(entries.map((e) => [e.id, e.entry_id as number]));
  return { managers, managerIds: managers.map((m) => m.id), entryByLeagueEntry };
}

export function buildMatches(season: Season, entryByLeagueEntry: Map<number, number>): Match[] {
  return season.details.matches
    .map((m) => ({
      gw: m.event,
      home: entryByLeagueEntry.get(m.league_entry_1),
      away: entryByLeagueEntry.get(m.league_entry_2),
      homePts: m.started ? m.league_entry_1_points : null,
      awayPts: m.started ? m.league_entry_2_points : null,
      started: m.started,
      finished: m.finished,
    }))
    .filter((m): m is Match => Boolean(m.home && m.away))
    .sort((a, b) => a.gw - b.gw);
}

export type Lineups = ById<ById<Lineup>>;

export function buildLineups(season: Season, matches: Match[]) {
  const { picks, finishedGws, live, doubleClubs, clubOf, pointsIn, positionOf, formation } = season;
  const matchPoints = new Map<string, number | null>();
  for (const m of matches.filter((x) => x.started)) {
    matchPoints.set(`${m.home}:${m.gw}`, m.homePts);
    matchPoints.set(`${m.away}:${m.gw}`, m.awayPts);
  }

  const playerInfo = (id: number) => ({ pos: positionOf(id), club: clubOf(id) });
  const liveFeeds: Record<number, SlimLive> = {};
  const lineups: Lineups = {};
  let lineupMismatches = 0;
  for (const [entry, byGw] of Object.entries(picks)) {
    for (const [gwKey, res] of Object.entries(byGw)) {
      const gw = Number(gwKey);
      const order = [...res.picks].sort((a, b) => a.position - b.position).map((p) => p.element);
      const finished = finishedGws.includes(gw);
      let xi = order.slice(0, 11);
      let bench = order.slice(11);
      let subs = (res.subs ?? []).map((s) => s.element_in);
      let off = (res.subs ?? []).map((s) => s.element_out);
      let pts: number;
      if (finished) {
        // Finished weeks come back with the auto-subs already made.
        const xiPoints = sum(xi.map((id) => pointsIn(id, gw)));
        pts = matchPoints.get(`${entry}:${gw}`) ?? xiPoints;
        if (pts !== xiPoints) lineupMismatches++;
      } else {
        // Still being played: score it as the page does live (provisional bonus and
        // auto-subs) rather than wait for the draft site's own head-to-head numbers.
        ({ xi, bench, subs, off, pts } = scoreLineup(order, (liveFeeds[gw] ??= slimLive(live[gw])), playerInfo, formation));
      }
      const doubles = new Set(doubleClubs[gw]);
      const dgw = xi.filter((id) => doubles.has(clubOf(id) as number)).length;
      (lineups[entry] ??= {})[gw] = {
        pts,
        adj: pts - DGW_PENALTY * dgw,
        dgw,
        benchPts: sum(bench.map((id) => pointsIn(id, gw))),
        xi,
        bench,
        subs,
        ...(off.length ? { off } : {}),
        ...(finished ? {} : { picks: order }), // the page re-scores live weeks from the picks
        xpf: 0, // set below
      };
    }
  }
  if (lineupMismatches) console.warn(`! ${lineupMismatches} lineups do not add up to their H2H score`);

  for (const byGw of Object.values(lineups)) {
    for (const [gw, l] of Object.entries(byGw)) l.xpf = round(sum(l.xi.map((pid) => underlyingIn(season, pid, Number(gw))?.xp ?? 0)), 1);
  }
  return lineups;
}

// Goals, cards, substitutions and so on, gameweek by gameweek, for the players in a
// lineup that week: the icons on the pitches.
export function buildEvents(season: Season, lineups: Lineups): ById<ById<PlayerEvents>> {
  const out: ById<ById<PlayerEvents>> = {};
  for (const gw of season.gws) {
    const { events = {} } = slimLive(season.live[gw]);
    const ids = Object.values(lineups).flatMap((byGw) => [...(byGw[gw]?.xi ?? []), ...(byGw[gw]?.bench ?? [])]);
    const week = Object.fromEntries(
      ids
        .filter((pid) => events[pid])
        .sort((a, b) => a - b)
        .map((pid) => [pid, events[pid]]),
    );
    if (Object.keys(week).length) out[gw] = week;
  }
  return out;
}

// The gameweek being played, as the page needs it to show who is still to play and
// to price the matches in play. Nothing once it is over.
//
/** The expected points the live block carries, from oddsModel. */
export interface LiveExpected {
  /** The site's for the gameweek being played, or FPL's while those are all there is. */
  now: (pid: number) => number;
  fromFpl: boolean;
  /** FPL's own for it. */
  fplNow: (pid: number) => number;
  /** The site's taken apart. */
  parts?: (pid: number) => XpParts | undefined;
}

// The gameweek being played, as the page needs it to show who is still to play and
// to price the matches in play. Nothing once it is over.
//
// FPL's expected points come from form: the average over the last 30 days' gameweeks,
// which from the deadline counts this one with nothing scored yet, so everyone's drops
// until the points come in. So FPL's are kept from the last build before the deadline
// (`previous`, whose players' expected points were for this gameweek), as every build
// since keeps them, both when they stand in for the site's (until a gameweek has been
// played) and next to them, for the setting that shows FPL's. The site's own don't move
// at the deadline.
export function buildLiveData(season: Season, lineups: Lineups, x: LiveExpected, previous: Partial<Data> | null): LiveData | undefined {
  const { currentGw: gw, finishedGws, live } = season;
  if (!gw || finishedGws.includes(gw) || !live[gw]) return undefined;
  const ids = [...new Set(Object.values(lineups).flatMap((byGw) => byGw[gw]?.picks ?? []))].sort((a, b) => a - b);
  const before = previous?.live?.gw === gw ? previous.live : null;
  const atDeadline = !before && previous?.meta?.nextGw === gw ? previous.players : null;
  const fpl = (pid: number) =>
    (x.fromFpl ? before?.ep[pid] : before?.fplEp?.[pid]) ??
    (x.fromFpl ? atDeadline?.[pid]?.ep : atDeadline?.[pid]?.fpl) ??
    round(x.fplNow(pid), 1);
  const feed = { gw, ...slimLive(live[gw]) };
  if (x.fromFpl) return { ...feed, ep: Object.fromEntries(ids.map((pid) => [pid, fpl(pid)])) };
  const parts: ById<XpParts> = {};
  for (const pid of ids) {
    const p = x.parts?.(pid);
    if (p) parts[pid] = p.map((v) => round(v, 2)) as XpParts;
  }
  return {
    ...feed,
    ep: Object.fromEntries(ids.map((pid) => [pid, round(x.now(pid), 1)])),
    parts,
    cleanSheet: readScoring(season.boot.settings.scoring).cleanSheet,
    fplEp: Object.fromEntries(ids.map((pid) => [pid, fpl(pid)])),
  };
}

/** A manager's lineup in a gameweek, if they had one. */
export const lineupOf =
  (lineups: Lineups) =>
  (entry: number, gw: number): Lineup | undefined =>
    lineups[entry]?.[gw];

// A match still being played shows the live score worked out above.
export function patchLiveScores(matches: Match[], lineup: ReturnType<typeof lineupOf>) {
  for (const m of matches.filter((x) => x.started && !x.finished)) {
    m.homePts = lineup(m.home, m.gw)?.pts ?? m.homePts;
    m.awayPts = lineup(m.away, m.gw)?.pts ?? m.awayPts;
  }
}

// Each lineup player's xG, xA, expected clean sheets and expected points, gameweek by
// gameweek, for the pitches' lineup filters. Only players who got on the pitch.
export function buildUnderlying(season: Season, lineups: Lineups): ById<ById<Underlying>> {
  const out: ById<ById<Underlying>> = {};
  for (const gw of season.finishedGws) {
    const ids = Object.values(lineups).flatMap((byGw) => [...(byGw[gw]?.xi ?? []), ...(byGw[gw]?.bench ?? [])]);
    const week: ById<Underlying> = {};
    for (const pid of [...ids].sort((a, b) => a - b)) {
      const u = packUnderlying(underlyingIn(season, pid, gw));
      if (u) week[pid] = u;
    }
    if (Object.keys(week).length) out[gw] = week;
  }
  return out;
}

// A player's underlying numbers in a finished gameweek (shared/underlying.ts).
export function underlyingIn(season: Season, pid: number, gw: number) {
  const s = season.live[gw]?.elements[pid]?.stats;
  if (!s) return undefined;
  const fixtures = season.doubleClubs[gw]?.includes(season.clubOf(pid) as number) ? 2 : 1;
  return underlyingOf(s, season.boot.settings.scoring, season.positionOf(pid), fixtures);
}
