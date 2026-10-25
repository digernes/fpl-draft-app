// Head-to-head matches: the list, their odds, and the parts of a match's page.

import { bestXi } from '../shared/best-xi.ts';
import type { Lineup, Match, Odds } from '../shared/data.ts';
import {
  liveProjection,
  playerProjection,
  playerState,
  type Expected,
  type PlayerState,
  type Scored,
  type SlimLive,
} from '../shared/live.ts';
import { liveOdds } from '../shared/odds.ts';
import { avatar, empty, ptsPill, seg, xpPill } from './components.ts';
import { countdown, esc, fmtShortDay, fmtTime, fmtWeekday, pct, plural, priceText, sum } from './format.ts';
import {
  clubFixtures,
  first,
  gwBonus,
  gwEvents,
  gwInfo,
  gwPoints,
  isLive,
  lineupFor,
  liveParts,
  liveXp,
  mgr,
  namedIn,
  opponents,
  partsAt,
  player,
  versus,
  xpAt,
} from './lookups.ts';
import { gwUnderlying, pointsFrom, pointsRows } from './pl-stats.ts';
import { bestOfMatch, dueShows, hasLineupFilters, lineupFilters, showsEvents, statBadge, xpTip } from './lineup-filters.ts';
import { autoSubOf, matchPitch, type PitchPlayer, type PitchSide } from './pitch.ts';
import { href } from './router.ts';
import { D, live, state } from './state.ts';

export function featuredGw() {
  const { meta } = D;
  if (isLive() || !meta.nextGw || meta.nextGw > meta.lastGw) return meta.currentGw || meta.firstGw;
  return meta.nextGw;
}

// The followed team's match first. A side column's list is compact, without the odds,
// with the match whose page it is on picked out.
export function matchList(list: Match[], { compact = false, current = null as Match | null } = {}) {
  if (!list.length) return empty('No matches this gameweek');
  const mine = (m: Match) => (m.home === state.myTeam || m.away === state.myTeam ? 0 : 1);
  const rows = [...list].sort((a, b) => mine(a) - mine(b)).map((m) => matchBlock(m, compact, m === current));
  return `<div class="matches${compact ? ' compact' : ''}">${rows.join('')}</div>`;
}

// fotmob.com's status chip, at the left of a match's row and under its score: FT once
// it's over, and while it's on Live (or the minute) on the brand colour.
export const statusDot = (state: 'live' | 'done' | 'due', label = state === 'live' ? 'Live' : 'FT') =>
  state === 'due' ? '' : `<span class="status-dot${state === 'live' ? ' live' : ''}">${label}</span>`;

// Where a head-to-head stands: live while a club with a player in either squad is playing,
// done once every one of them is (or the gameweek is over), and neither between match
// days or before the deadline.
export function matchStatus(m: Match): 'live' | 'done' | 'due' {
  if (m.finished) return 'done';
  const feed = live?.gw === m.gw ? live.feed : D.live?.gw === m.gw ? D.live : null;
  if (!m.started || !feed) return 'due';
  const squads = [m.home, m.away].flatMap((id) => {
    const l = lineupFor(id, m.gw);
    return l ? [...l.xi, ...l.bench] : [];
  });
  const states = squads.map((pid) => playerState(feed, pid, player(pid)?.club).state);
  if (states.some((s) => s === 'live' || s === 'off')) return 'live';
  return states.every((s) => s === 'done' || s === 'blank') ? 'done' : 'due';
}

/** Between match days: when the next club with a player in either squad kicks off. */
export function nextKickoff(m: Match): string | null {
  const feed = live?.gw === m.gw ? live.feed : D.live?.gw === m.gw ? D.live : null;
  if (!feed) return null;
  const kickoffs = [m.home, m.away]
    .flatMap((id) => {
      const l = lineupFor(id, m.gw);
      return l ? [...l.xi, ...l.bench] : [];
    })
    .flatMap((pid) => {
      const s = playerState(feed, pid, player(pid)?.club);
      return s.state === 'due' && s.ko ? [s.ko] : [];
    })
    .sort();
  return kickoffs[0] ?? null;
}

/** A head-to-head's state under its score: Live, Full time, or the countdown to its next real match. */
export function matchStatusText(m: Match) {
  const state = matchStatus(m);
  if (state === 'live') return statusDot('live');
  if (state === 'done') return 'Full time';
  const ko = nextKickoff(m);
  const left = ko && countdown(ko);
  return left ? `Next match in ${left}` : '';
}

function matchBlock(m: Match, compact = false, current = false) {
  const inPlay = m.started && !m.finished && !compact ? inPlayOdds(m) : null;
  const deadline = gwInfo(m.gw)?.deadline;
  const center = m.started
    ? `<span class="score">${m.homePts} - ${m.awayPts}</span>`
    : `<span class="kickoff">${deadline ? fmtTime.format(new Date(deadline)) : 'TBC'}</span>`;
  const status = statusDot(matchStatus(m));
  const side = (id: number, cls: string) =>
    `<span class="side ${cls}">${cls === 'away' ? avatar(id, 22) : ''}<span class="side-text"><span class="side-name">${first(id)}</span><span class="side-team">${esc(mgr(id)!.team)}</span></span>${cls === 'home' ? avatar(id, 22) : ''}</span>`;
  const mine = m.home === state.myTeam || m.away === state.myTeam;
  const odds = compact ? '' : m.odds && !m.started ? oddsRow(m.odds, m) : inPlay ? oddsRow(inPlay, m, null, true) : '';
  return `<div class="match-block${mine ? ' mine' : ''}${current ? ' this' : ''}">
    <a class="match" href="${href.match(m)}"><span class="status-slot">${status}</span>${side(m.home, 'home')}<span class="mid">${center}</span>${side(m.away, 'away')}<span></span></a>
    ${odds}
  </div>`;
}

// `outcome` (0 home, 1 draw, 2 away) settles the row the way fotmob.com does after full
// time: the losing selections go grey with their price struck through.
export function oddsRow(odds: Pick<Odds, 'p' | 'prices'>, m: Match, outcome: number | null = null, inPlay = false) {
  const labels = ['1', 'X', '2'];
  const who = [`${mgr(m.home)!.first} to win`, 'Draw', `${mgr(m.away)!.first} to win`];
  return `<div class="odds${inPlay ? ' in-play' : ''}">${odds.prices
    .map(
      (price, i) =>
        `<span class="odd${outcome !== null && i !== outcome ? ' lost' : ''}" data-tip="${esc(who[i])} · ${pct(odds.p[i])} chance${inPlay ? ' (live)' : ''}"><span class="odd-label">${labels[i]}</span><span class="odd-price">${priceText(price)}</span></span>`,
    )
    .join('')}</div>`;
}

const playerInfo = (pid: number) => player(pid) ?? { pos: undefined, club: undefined };

// What a live projection expects of each player: his expected points by the cog's
// setting, taken apart when they're the model's, and who his club has named.
function liveExpected(gw: number): Expected {
  const ours = state.xp !== 'fpl'; // the parts are the model's
  return {
    points: (pid) => (player(pid) ? liveXp(pid) : 0),
    parts: ours ? (pid) => D.live?.parts?.[pid] : undefined,
    cleanSheet: D.live?.cleanSheet,
    named: namedIn(gw),
  };
}

// Where a live lineup's score is heading: its points so far, plus the expected points for
// whatever its XI still has to play from where its matches stand, with the auto-subs it can
// count on, the uncertainty shrinking as games finish (see liveProjection). The live odds
// come from it, and so does the lineup's Projected total.
function projectionOf(scored: Scored, gw: number) {
  return liveProjection(scored, live!.feed, playerInfo, liveExpected(gw), D.meta.formation);
}

/** Where a player's gameweek is heading while it's played, as the live odds see it; nothing once it's over for him. */
export function projectedFor(pid: number, gw: number | undefined): number | undefined {
  if (!live || live.gw !== gw) return undefined;
  const now = playerState(live.feed, pid, player(pid)?.club).state;
  return now === 'done' || now === 'blank' ? undefined : playerProjection(pid, live.feed, playerInfo, liveExpected(gw));
}

/** Live odds for a match in play. */
export function inPlayOdds(m: Match) {
  const home = live?.gw === m.gw ? live.lineups[m.home] : undefined;
  const away = live?.gw === m.gw ? live.lineups[m.away] : undefined;
  if (!home || !away) return null;
  return liveOdds(projectionOf(home, m.gw), projectionOf(away, m.gw), D.meta.oddsOverround);
}

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

export function preMatchOdds(m: Match) {
  if (!m.odds) return '';
  const outcome = !m.finished ? null : m.homePts! > m.awayPts! ? 0 : m.homePts === m.awayPts ? 1 : 2;
  const tip = m.odds.afterwards
    ? 'Worked out afterwards from each side’s projected XI, with only the gameweeks before it to go on'
    : 'The odds at the deadline';
  // Faded while the match is on, under the live odds.
  return `<div class="detail-odds${m.started && !m.finished ? ' faded' : ''}"><div class="detail-label">Pre-match odds <span class="muted" data-tip="${tip}">${m.odds.afterwards ? '· worked out afterwards' : '· at the deadline'}</span></div>${oddsRow(m.odds, m, outcome)}</div>`;
}

// Both XIs on one pitch with each player's points, what they did, auto-subs, double
// gameweeks and, in a live gameweek, the minute; the benches below. A finished
// gameweek gets the lineup filters on top.
export function matchLineups(m: Match) {
  const home = lineupFor(m.home, m.gw);
  const away = lineupFor(m.away, m.gw);
  if (!home || !away) return empty('No lineups');
  const feed = live?.gw === m.gw ? live.feed : null;
  const doubles = new Set(gwInfo(m.gw)?.doubles ?? []);
  const top = matchStatus(m) === 'done' ? bestOfMatch([...home.xi, ...away.xi], m.gw) : undefined;
  const onPitch =
    (l: Lineup, top = new Set<number>()) =>
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
  const side = (id: number, l: Lineup): PitchSide => ({
    id,
    xi: l.xi.map(onPitch(l, top)),
    note: lineupNote(l, feed),
    total: xiTotal(l, m.gw, feed, feed ? live!.lineups[id] : undefined),
  });
  const pitch = matchPitch(side(m.home, home), side(m.away, away), [home.bench.map(onPitch(home)), away.bench.map(onPitch(away))]);
  return `${lineupFilters(m.gw, Boolean(feed?.fixtures.some((f) => !f.started)))}${pitch}`;
}

// The XI's total, at the end of its header as fotmob.com's team rating: its points, or with
// the xP filter what the pitch's pills add up to (its expected points), or with Projected
// where its score is heading, as the live odds see it (`scored`: its live lineup).
function xiTotal(l: Lineup, gw: number, feed: SlimLive | null, scored?: Scored) {
  const pill = (value: string, tip: string) => `<span class="mp-total" data-tip="${tip}">${value}</span>`;
  if (state.lineupStat === 'xp' && hasLineupFilters(gw))
    return `<span class="mp-total" ${xpTip(l.xi, gw)}>${sum(l.xi.map((pid) => gwUnderlying(pid, gw)?.[2] ?? 0)).toFixed(1)}</span>`;
  if (scored && feed?.fixtures.some((f) => !f.started) && dueShows(gw) === 'xp') {
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
// the filter (lineup-filters.ts). `top`: the match's best.
export function pitchPill(pid: number, gw: number, match: PlayerState | null, top = false) {
  if (match?.state !== 'due' || gwPoints(pid, gw) !== 0 || dueShows(gw) !== 'ko') return roundPill(pid, gw, match, top);
  return kickoffPill(match.ko, fixtureTip(match.ko, match.opp, match.home));
}

// A player's points in a gameweek. Before kick-off a 0 says nothing, so players still
// to play show their expected points instead.
export function roundPill(pid: number, gw: number, match: PlayerState | null, top = false) {
  const pts = gwPoints(pid, gw);
  if (match?.state !== 'due' || pts !== 0)
    return ptsPill(pts, gwBonus(pid, gw), { top, projected: projectedFor(pid, gw), from: pointsRows(pointsFrom(pid, gw)) });
  return xpPill(liveXp(pid), liveParts(pid), opponents(player(pid).club, gw), ' (not played yet)');
}

// Before kick-off, as fotmob.com's Who will win?: each side's chance under its avatar and
// the draw's under an X, the odds under them, and the score they come from.
export function winChances(m: Match) {
  if (!m.odds) return empty('Odds go up three gameweeks before the deadline');
  const [ph, pd, pa] = m.odds.p;
  const [eh, ea] = m.odds.expected;
  const side = (face: string, p: number, cls = '') => `<div class="poll-side${cls}">${face}<span>${pct(p)}</span></div>`;
  const how = D.meta.hasProjections
    ? 'the league average, plus how far each side’s best projected XI sits from the average one'
    : 'the league average, until there are projections';
  return `<div class="poll">${side(avatar(m.home, 48), ph)}${side('<span class="poll-x">X</span>', pd, ' draw')}${side(avatar(m.away, 48), pa)}</div>
    ${oddsRow(m.odds, m)}
    <div class="prob-score"><span data-tip="The model’s score: ${how}">Projected ${eh.toFixed(1)} – ${ea.toFixed(1)}</span></div>`;
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

export function roundSubtitle(gw: number) {
  const info = gwInfo(gw);
  if (isLive() && gw === D.meta.currentGw) return 'Live now';
  if (info?.finished) return 'Final scores';
  const parts = [];
  if (info?.deadline) parts.push(`Deadline ${fmtShortDay.format(new Date(info.deadline))}, ${fmtTime.format(new Date(info.deadline))}`);
  if (gw === D.meta.nextGw && D.meta.nextWaivers && new Date(D.meta.nextWaivers).getTime() > Date.now()) {
    parts.push(`waivers ${fmtShortDay.format(new Date(D.meta.nextWaivers))}, ${fmtTime.format(new Date(D.meta.nextWaivers))}`);
  }
  return parts.join(' · ');
}

// The Fixtures tab's date row already says the day, so it only needs the deadline's
// time; the waivers (also in the header) are left out on phones.
export function deadlineNote(gw: number) {
  const info = gwInfo(gw);
  if ((isLive() && gw === D.meta.currentGw) || !info?.deadline || info.finished) return roundSubtitle(gw);
  const waivers = gw === D.meta.nextGw && D.meta.nextWaivers ? new Date(D.meta.nextWaivers) : null;
  const waiverNote =
    waivers && waivers.getTime() > Date.now()
      ? `<span class="wide-only"> · waivers ${fmtShortDay.format(waivers)}, ${fmtTime.format(waivers)}</span>`
      : '';
  return `Deadline ${fmtTime.format(new Date(info.deadline))}${waiverNote}`;
}

// Phones get the odds format from the settings menu only, to keep the card header clear.
export const oddsToggle = () =>
  `<div class="wide-only">${seg(
    'odds',
    [
      ['decimal', 'Decimal'],
      ['fractional', 'Fractional'],
    ],
    state.odds,
  )}</div>`;
