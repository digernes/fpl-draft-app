// A head-to-head's lineups on the pitch, as played or as projected before the deadline, and
// the pills and live state by each player's name.

import { bestXi } from '../shared/best-xi.ts';
import type { Lineup, Match } from '../shared/data.ts';
import { playerState, type PlayerState, type Scored, type SlimLive } from '../shared/live.ts';
import { empty, pointsTipRows, ptsPill, tenths, xpPill } from './components.ts';
import { esc, fmtTime, fmtWeekday, plural, sum } from './format.ts';
import {
  clubFixtures,
  gwBonus,
  gwEvents,
  gwInfo,
  gwPoints,
  lineupFor,
  liveParts,
  liveXp,
  opponents,
  partsAt,
  player,
  versus,
  xpAt,
} from './lookups.ts';
import { projectedPill, projectionFor, projectionOf } from './match-odds.ts';
import { matchStatus } from './matches.ts';
import { gwUnderlying, pointsFrom, pointsRows, toComeRows } from './stats-files.ts';
import { bestOfMatch, dueShows, hasLineupFilters, lineupFilters, showsEvents, statBadge, stillToCome, xpTip } from './lineup-filters.ts';
import { autoSubOf, matchPitch, type PitchPlayer, type PitchSide } from './pitch.ts';
import { D, live, state } from './state.ts';

// FotMob-style match state next to each player in a live gameweek.
export function stateLabel(s: PlayerState) {
  // One on the pitch has a softly blinking dot by the minute; his club's substitutes the minute in grey.
  if (s.state === 'live')
    return s.on
      ? `<span class="lp-state is-live" data-tip="Playing now"><i class="live-dot"></i>${Math.max(1, s.min)}'</span>`
      : `<span class="lp-state" data-tip="His match is on, without him on the pitch">${Math.max(1, s.min)}'</span>`;
  if (s.state === 'off') return `<span class="lp-state" data-tip="Off after ${plural(s.min, 'minute')}">${s.min}'</span>`;
  if (s.state === 'done') return `<span class="lp-state" data-tip="Match over">FT</span>`;
  if (s.state === 'blank') return `<span class="lp-state" data-tip="No match this gameweek">–</span>`;
  return `<span class="lp-state" data-tip="${esc(fixtureTip(s.ko, s.opp, s.home))}">${kickoffTime(s.ko)}</span>`;
}

// A kick-off's day and time, or just the time when it is today.
function kickoffTime(ko: string | null | undefined) {
  if (!ko) return 'TBC';
  const at = new Date(ko);
  const today = at.toDateString() === new Date().toDateString();
  return `${today ? '' : `<span class="ko-day">${fmtWeekday.format(at)}</span> `}${fmtTime.format(at)}`;
}

// Both XIs on one pitch with each player's points, what they did, auto-subs, double
// gameweeks and, in a live gameweek, the minute; the benches below. A finished
// gameweek gets the lineup filters on top.
export function matchLineups(m: Match) {
  const home = lineupFor(m.home, m.gw);
  const away = lineupFor(m.away, m.gw);
  if (!home || !away) return empty('No lineups');
  const feed = live?.gw === m.gw ? live.feed : null;
  const at: PitchAt = { m, feed, doubles: new Set(gwInfo(m.gw)?.doubles ?? []) };
  const top = matchStatus(m) === 'done' ? bestOfMatch([...home.xi, ...away.xi], m.gw) : undefined;
  const side = (id: number, l: Lineup): PitchSide => ({
    id,
    xi: l.xi.map(onPitch(at, l, top)),
    note: lineupNote(l, feed),
    total: xiTotal(l, m.gw, feed, feed ? live!.lineups[id] : undefined),
  });
  const benches: [PitchPlayer[], PitchPlayer[]] = [home.bench.map(onPitch(at, home)), away.bench.map(onPitch(at, away))];
  const pitch = matchPitch(side(m.home, home), side(m.away, away), benches);
  return `${lineupFilters(m.gw, stillToCome(feed))}${pitch}`;
}

/** The match a lineup is shown in, its gameweek's live feed while it's played, and the clubs that play twice in it. */
interface PitchAt {
  m: Match;
  feed: SlimLive | null;
  doubles: Set<number>;
}

// One of a lineup's players on the pitch; `top`: the match's best.
const onPitch =
  ({ m, feed, doubles }: PitchAt, l: Lineup, top = new Set<number>()) =>
  (pid: number): PitchPlayer => {
    const p = player(pid);
    const match = feed ? playerState(feed, pid, p.club) : null;
    const twice = doubles.has(p.club) ? '<span data-tip="Plays twice this gameweek">×2</span>' : '';
    return {
      pid,
      badge: statBadge(pid, m.gw, top.has(pid)) ?? pitchPill(pid, m.gw, match, top.has(pid)),
      events: showsEvents(m.gw) ? gwEvents(pid, m.gw) : undefined,
      mark: autoSubOf(l, pid, m.gw),
      note: match?.state === 'live' ? stateLabel(match) : twice, // one taken off has his minute by the arrow
    };
  };

// The XI's total, at the end of its header as fotmob.com's team rating: its points, or with
// the xP filter what the pitch's pills add up to (its expected points), or with Projected
// where its score is heading, as the live odds see it (`scored`: its live lineup).
function xiTotal(l: Lineup, gw: number, feed: SlimLive | null, scored?: Scored) {
  const pill = (value: string, tip: string) => `<span class="mp-total" data-tip="${tip}">${value}</span>`;
  if (state.lineupStat === 'xp' && hasLineupFilters(gw))
    return `<span class="mp-total" ${xpTip(l.xi, gw)}>${sum(l.xi.map((pid) => gwUnderlying(pid, gw)?.[2] ?? 0)).toFixed(1)}</span>`;
  if (scored && stillToCome(feed) && dueShows(gw) === 'xp') {
    const { mean } = projectionOf(scored, gw);
    const more = mean - scored.pts;
    const tip = `${scored.pts} so far ${more < 0 ? '−' : '+'} ${Math.abs(more).toFixed(1)} to come, as the live odds see it`;
    return pill(mean.toFixed(1), scored.pts ? tip : 'Projected, as the live odds see it');
  }
  return pill(String(sum(l.xi.map((pid) => gwPoints(pid, gw)))), 'Points');
}

// How far through the gameweek the XI is, and the score after any double-gameweek penalty.
function lineupNote(l: Lineup, feed: SlimLive | null) {
  const states = feed ? l.xi.map((pid) => playerState(feed, pid, player(pid).club).state) : [];
  const count = (...wanted: PlayerState['state'][]) => states.filter((s) => wanted.includes(s)).length;
  return [
    count('live') && `${count('live')} playing`,
    count('due') && `${count('due')} to play`,
    count('done', 'off', 'blank') && `${count('done', 'off', 'blank')} done`,
    l.dgw && `<span data-tip="${D.meta.dgwPenalty} off per double-gameweek player in the XI">${l.adj} adj.</span>`,
  ]
    .filter(Boolean)
    .join(' · ');
}

// On a pitch, a player still to play shows his expected points or when he kicks off, by
// the filter (lineup-filters.ts), and with Projected one on the pitch where his points are
// heading. `top`: the match's best.
export function pitchPill(pid: number, gw: number, match: PlayerState | null, top = false) {
  if (match?.state === 'live' && match.on && dueShows(gw) === 'xp') return headingPill(pid, gw) ?? roundPill(pid, gw, match, top);
  if (match?.state !== 'due' || gwPoints(pid, gw) !== 0 || dueShows(gw) !== 'ko') return roundPill(pid, gw, match, top);
  return kickoffPill(match.ko, fixtureTip(match.ko, match.opp, match.home));
}

// Where the points of one on the pitch are heading, as the live odds see them: in the pill
// of those still to play, so that a projection reads as one whether he has kicked off or
// not, its figure green, as his minute under his name is, to tell it from one that hasn't
// started. The tip takes apart what he has so far, as his points' does, and what's still to come.
function headingPill(pid: number, gw: number) {
  const projection = projectionFor(pid, gw);
  if (!projection) return undefined;
  const { projected } = projection;
  const head = `${tenths(projected)} projected · ${plural(gwPoints(pid, gw), 'point')} so far`;
  const rows = pointsTipRows(pointsRows(pointsFrom(pid, gw)), toComeRows(projection.toCome));
  return `<span class="ptsp xp live" data-tip="${esc(head)}"${rows ? ` data-tip-rows="${esc(rows)}"` : ''}>${projected.toFixed(1)}</span>`;
}

// A player's points in a gameweek. Before kick-off a 0 says nothing, so players still
// to play show their expected points instead.
export function roundPill(pid: number, gw: number, match: PlayerState | null, top = false) {
  const pts = gwPoints(pid, gw);
  if (match?.state !== 'due' || pts !== 0)
    return ptsPill(pts, gwBonus(pid, gw), { top, ...projectedPill(pid, gw), from: pointsRows(pointsFrom(pid, gw)) });
  return xpPill(liveXp(pid), liveParts(pid), opponents(player(pid).club, gw), ' (not played yet)');
}

// Each side's best XI by expected points, as the odds have it, or again by FPL's when
// the cog asks for those. The xP filter shows the numbers; without it, when each plays.
export function projectedLineups(m: Match) {
  if (!m.odds?.xi) return '';
  const showXp = dueShows(m.gw) === 'xp';
  const squadOf = (id: number) =>
    Object.keys(D.players)
      .map(Number)
      .filter((pid) => player(pid).owner === id);
  const xiOf = (id: number, priced: number[]) =>
    state.xp !== 'fpl'
      ? priced
      : bestXi(
          squadOf(id),
          (pid) => xpAt(pid, m.gw),
          (pid) => player(pid).pos,
          D.meta.xiLimits,
        ).ids;
  // The rest of the squad on the bench, as FPL lays one out: its goalkeeper first, then the
  // most expected of the others.
  const benchOf = (id: number, xi: number[]) =>
    squadOf(id)
      .filter((pid) => !xi.includes(pid))
      .sort((a, b) => Number(player(b).pos === 'GKP') - Number(player(a).pos === 'GKP') || xpAt(b, m.gw) - xpAt(a, m.gw));
  const face = (pid: number) => {
    const p = player(pid);
    return {
      pid,
      badge: showXp ? xpPill(xpAt(pid, m.gw), partsAt(pid, m.gw), opponents(p.club, m.gw)) : kickoffBadge(pid, m.gw),
      mark: p.status !== 'a' ? `<span class="pp-flag" data-tip="${esc(p.news || 'Flagged')}">!</span>` : '',
    };
  };
  const projected = (id: number, priced: number[]): PitchSide => {
    const ids = xiOf(id, priced);
    return {
      id,
      xi: ids.map(face),
      note: showXp
        ? `<span data-tip="Best legal XI by expected points">${sum(ids.map((pid) => xpAt(pid, m.gw))).toFixed(1)} xP</span>`
        : '',
    };
  };
  const [home, away] = [projected(m.home, m.odds.xi[0]), projected(m.away, m.odds.xi[1])];
  const benches: [PitchPlayer[], PitchPlayer[]] = [home, away].map((side) =>
    benchOf(
      side.id,
      side.xi.map((p) => p.pid),
    ).map(face),
  ) as [PitchPlayer[], PitchPlayer[]];
  return `${lineupFilters(m.gw, true)}${matchPitch(home, away, benches)}`;
}

const when = (ko: string | null | undefined) => {
  if (!ko) return 'Kick-off to be set';
  const at = new Date(ko);
  return `${at.toDateString() === new Date().toDateString() ? 'Today' : fmtWeekday.format(at)} ${fmtTime.format(at)}`;
};

// When a match kicks off and who against, for a tip: "Sat 18:30, Arsenal (H)".
const fixtureTip = (ko: string | null | undefined, opp: number, home: boolean) => `${when(ko)}, ${versus(opp, home)}`;

// When a player kicks off.
function kickoffPill(ko: string | null | undefined, tip: string) {
  return `<span class="ptsp ko" data-tip="${esc(tip)}">${kickoffTime(ko)}</span>`;
}

// When a player's club plays in a gameweek still to come, with the opponent in the tip.
function kickoffBadge(pid: number, gw: number) {
  const team = player(pid).club;
  const games = clubFixtures(team, gw);
  if (!games.length) return `<span class="ptsp ko" data-tip="No match this gameweek">–</span>`;
  const tip = games.map(([h, a, ko]) => fixtureTip(ko, h === team ? a : h, h === team)).join(' · ');
  return kickoffPill(games[0][2], tip);
}
