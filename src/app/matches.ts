// Head-to-head matches: the list, odds and the expanded match.

import { bestXi } from '../shared/best-xi.ts';
import type { Lineup, Match, Odds } from '../shared/data.ts';
import { liveProjection, playerState, type Expected, type PlayerState, type Scored, type SlimLive } from '../shared/live.ts';
import { liveOdds } from '../shared/odds.ts';
import { avatar, empty, ptsPill, seg, xpPill } from './components.ts';
import { esc, fmtShortDay, fmtTime, fmtWeekday, pct, plural, priceText, sum } from './format.ts';
import {
  club,
  first,
  gwBonus,
  gwEvents,
  gwInfo,
  gwPoints,
  isLive,
  lineupFor,
  liveParts,
  liveXp,
  matchKey,
  mgr,
  partsAt,
  player,
  slotOf,
  xpAt,
} from './lookups.ts';
import { dueFilters, dueShows, lineupFilters, showsEvents, statBadge } from './lineup-filters.ts';
import { matchPitch, subMark, type PitchPlayer, type PitchSide } from './pitch.ts';
import { D, live, state } from './state.ts';

export function featuredGw() {
  const { meta } = D;
  if (isLive() || !meta.nextGw || meta.nextGw > meta.lastGw) return meta.currentGw || meta.firstGw;
  return meta.nextGw;
}

export function matchList(list: Match[]) {
  if (!list.length) return empty('No matches this gameweek');
  return `<div class="matches">${list.map(matchBlock).join('')}</div>`;
}

function matchBlock(m: Match) {
  const key = matchKey(m);
  const open = state.openMatch === key;
  const inPlay = m.started && !m.finished ? inPlayOdds(m) : null;
  const deadline = gwInfo(m.gw)?.deadline;
  const center = m.started
    ? `<span class="score${m.finished ? '' : ' is-live'}">${m.homePts} - ${m.awayPts}</span>${m.finished ? '' : '<span class="live-label">Live</span>'}`
    : `<span class="kickoff">${deadline ? fmtTime.format(new Date(deadline)) : 'TBC'}</span>`;
  const side = (id: number, cls: string) =>
    `<span class="side ${cls}">${cls === 'away' ? avatar(id, 22) : ''}<span class="side-text"><span class="side-name">${first(id)}</span><span class="side-team">${esc(mgr(id)!.team)}</span></span>${cls === 'home' ? avatar(id, 22) : ''}</span>`;
  return `<div class="match-block${open ? ' open' : ''}">
    <button type="button" class="match" data-action="match" data-value="${key}" aria-expanded="${open}">
      ${side(m.home, 'home')}<span class="mid">${center}</span>${side(m.away, 'away')}
    </button>
    ${m.odds && !m.started ? oddsRow(m.odds, m) : inPlay ? oddsRow(inPlay, m, null, true) : ''}
    ${open ? matchDetail(m) : ''}
  </div>`;
}

// `outcome` (0 home, 1 draw, 2 away) settles the row the way fotmob.com does after full
// time: the losing selections go grey with their price struck through.
function oddsRow(odds: Pick<Odds, 'p' | 'prices'>, m: Match, outcome: number | null = null, inPlay = false) {
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

// Live odds for a match in play: both scores so far, plus the expected points (by the
// cog's setting) for whatever each XI still has to play, with the auto-subs it can count
// on, the uncertainty shrinking as games finish.
function inPlayOdds(m: Match) {
  const home = live?.gw === m.gw ? live.lineups[m.home] : undefined;
  const away = live?.gw === m.gw ? live.lineups[m.away] : undefined;
  if (!live || !home || !away) return null;
  const { feed } = live;
  const ours = state.xp !== 'fpl'; // the appearance and clean-sheet parts are the model's
  const expected: Expected = {
    points: (pid) => (player(pid) ? liveXp(pid) : 0),
    milestones: ours
      ? (pid) => {
          const parts = D.live?.parts?.[pid];
          return parts && [parts[1], parts[5]];
        }
      : undefined,
    cleanSheet: D.live?.cleanSheet,
  };
  const projection = (scored: Scored) => liveProjection(scored, feed, playerInfo, expected, D.meta.formation);
  return liveOdds(projection(home), projection(away), D.meta.oddsOverround);
}

// FotMob-style match state next to each player in a live gameweek.
export function stateLabel(s: PlayerState) {
  if (s.state === 'live') return `<span class="lp-state is-live" data-tip="Playing now">${Math.max(1, s.min)}'</span>`;
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

function preMatchOdds(m: Match) {
  if (!m.odds) return '';
  const outcome = !m.finished ? null : m.homePts! > m.awayPts! ? 0 : m.homePts === m.awayPts ? 1 : 2;
  // The first gameweek priced before its deadline, so kept rather than worked out afterwards.
  const keptFrom = Math.min(...D.matches.filter((x) => x.odds && !x.odds.afterwards).map((x) => x.gw));
  const tip = m.odds.afterwards
    ? `Worked out afterwards from each side’s projected XI, with only the gameweeks before it to go on; from GW ${keptFrom} on, the odds are the ones at the deadline`
    : 'The odds at the deadline';
  // Faded while the match is on, under the live odds.
  return `<div class="detail-odds${m.started && !m.finished ? ' faded' : ''}"><div class="detail-label">Pre-match odds <span class="muted" data-tip="${tip}">${m.odds.afterwards ? '· worked out afterwards' : '· at the deadline'}</span></div>${oddsRow(m.odds, m, outcome)}</div>`;
}

function matchDetail(m: Match) {
  if (!m.started) return upcomingDetail(m);
  return `<div class="match-detail">${preMatchOdds(m)}${expectedStats(m)}${matchLineups(m)}</div>`;
}

// A finished match's numbers from the xG table, the way fotmob.com shows a match's xG:
// the label in the middle and the higher figure in a pill of that side's colour.
function expectedStats(m: Match) {
  if (!m.xg) return '';
  const row = (label: string, tip: string, [home, away]: [number, number]) => {
    const value = (v: number, id: number, higher: boolean) =>
      `<span class="xg-value${higher ? ` higher m${slotOf(id)}` : ''}">${v.toFixed(1)}</span>`;
    return `<div class="xg-row">${value(home, m.home, home > away)}<span class="xg-label" data-tip="${tip}">${label}</span>${value(away, m.away, away > home)}</div>`;
  };
  return `<div class="detail-xg">
    <div class="detail-label">Underlying numbers <span class="muted">· as in the xG table</span></div>
    ${row('Expected points (xP)', 'Each XI with goals, assists and clean sheets swapped for what the xG, xA and xGC were worth', m.xg.xp)}
    ${row('Expected table points (xPTS)', 'The table points both expected scores would have earned', m.xg.xPts)}
  </div>`;
}

// Both XIs on one pitch with each player's points, what they did, auto-subs, double
// gameweeks and, in a live gameweek, the minute; the benches below. A finished
// gameweek gets the lineup filters on top.
function matchLineups(m: Match) {
  const home = lineupFor(m.home, m.gw);
  const away = lineupFor(m.away, m.gw);
  if (!home || !away) return empty('No lineups');
  const feed = live?.gw === m.gw ? live.feed : null;
  const doubles = new Set(gwInfo(m.gw)?.doubles ?? []);
  const onPitch =
    (l: Lineup) =>
    (pid: number): PitchPlayer => {
      const p = player(pid);
      const match = feed ? playerState(feed, pid, p.club) : null;
      const twice = doubles.has(p.club) ? '<span data-tip="Plays twice this gameweek">×2</span>' : '';
      return {
        pid,
        badge: statBadge(pid, m.gw) ?? pitchPill(pid, m.gw, match),
        events: showsEvents(m.gw) ? gwEvents(pid, m.gw) : undefined,
        mark: l.subs.includes(pid) ? subMark : '',
        note: match?.state === 'live' ? stateLabel(match) : twice, // one taken off has his minute by the arrow
      };
    };
  const side = (id: number, l: Lineup): PitchSide => ({ id, xi: l.xi.map(onPitch(l)), note: lineupNote(l, feed) });
  const pitch = matchPitch(side(m.home, home), side(m.away, away), [home.bench.map(onPitch(home)), away.bench.map(onPitch(away))]);
  return `${lineupFilters(m.gw)}${feed?.fixtures.some((f) => !f.started) ? dueFilters(m.gw) : ''}${pitch}`;
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
// the filter (lineup-filters.ts).
export function pitchPill(pid: number, gw: number, match: PlayerState | null) {
  if (match?.state !== 'due' || gwPoints(pid, gw) !== 0 || dueShows(gw) !== 'ko') return roundPill(pid, gw, match);
  return kickoffPill(match.ko, fixtureTip(match.ko, match.opp, match.home));
}

// A player's points in a gameweek. Before kick-off a 0 says nothing, so players still
// to play show their expected points instead.
export function roundPill(pid: number, gw: number, match: PlayerState | null) {
  const pts = gwPoints(pid, gw);
  if (match?.state !== 'due' || pts !== 0) return ptsPill(pts, gwBonus(pid, gw));
  return xpPill(liveXp(pid), liveParts(pid), ' (not played yet)');
}

function upcomingDetail(m: Match) {
  if (!m.odds) return `<div class="match-detail">${empty('Odds go up three gameweeks before the deadline')}</div>`;
  const [ph, pd, pa] = m.odds.p;
  const [eh, ea] = m.odds.expected;
  // Each side's best XI by expected points, as the odds have it, or again by FPL's when
  // the cog asks for those. The xP filter shows the numbers; without it, when each plays.
  const showXp = dueShows(m.gw) === 'xp';
  const xiOf = (id: number, priced: number[]) => {
    if (state.xp !== 'fpl') return priced;
    const squad = Object.keys(D.players)
      .map(Number)
      .filter((pid) => player(pid).owner === id);
    return bestXi(
      squad,
      (pid) => xpAt(pid, m.gw),
      (pid) => player(pid).pos,
      D.meta.xiLimits,
    ).ids;
  };
  const projected = (id: number, priced: number[]): PitchSide => {
    const ids = xiOf(id, priced);
    return {
      id,
      xi: ids.map((pid) => {
        const p = player(pid);
        return {
          pid,
          badge: showXp ? xpPill(xpAt(pid, m.gw), partsAt(pid, m.gw)) : kickoffBadge(pid, m.gw),
          mark: p.status !== 'a' ? `<span class="pp-flag" data-tip="${esc(p.news || 'Flagged')}">!</span>` : '',
        };
      }),
      note: showXp
        ? `<span data-tip="Best legal XI by expected points">${sum(ids.map((pid) => xpAt(pid, m.gw))).toFixed(1)} xP</span>`
        : '',
    };
  };
  return `<div class="match-detail">
    <div class="prob">
      <div class="prob-bar"><span class="m${slotOf(m.home)}" style="flex:${ph}"></span><span class="prob-draw" style="flex:${pd}"></span><span class="m${slotOf(m.away)}" style="flex:${pa}"></span></div>
      <div class="prob-legend"><span>${first(m.home)} ${pct(ph)}</span><span>Draw ${pct(pd)}</span><span>${first(m.away)} ${pct(pa)}</span></div>
    </div>
    <p class="detail-note">Model score ${eh} – ${ea}: ${D.meta.hasProjections ? 'league average, plus how far each side’s best projected XI sits from the average one' : 'league average, until there are projections'}. Prices carry a ${Math.round((D.meta.oddsOverround - 1) * 100)}% margin.</p>
    ${m.odds.xi ? `${dueFilters(m.gw)}${matchPitch(projected(m.home, m.odds.xi[0]), projected(m.away, m.odds.xi[1]))}` : ''}
  </div>`;
}

const when = (ko: string | null | undefined) => {
  if (!ko) return 'Kick-off to be set';
  const at = new Date(ko);
  return `${at.toDateString() === new Date().toDateString() ? 'Today' : fmtWeekday.format(at)} ${fmtTime.format(at)}`;
};

// When a match kicks off and who against, for a tip: "Sat 18:30, v Arsenal".
const fixtureTip = (ko: string | null | undefined, opp: number, home: boolean) =>
  `${when(ko)}, ${home ? 'v' : 'at'} ${club(opp)?.name ?? '?'}`;

// When a player kicks off.
function kickoffPill(ko: string | null | undefined, tip: string) {
  return `<span class="ptsp ko" data-tip="${esc(tip)}">${kickoffTime(ko)}</span>`;
}

// When a player's club plays in a gameweek still to come, with the opponent in the tip.
function kickoffBadge(pid: number, gw: number) {
  const team = player(pid).club;
  const games = (gwInfo(gw)?.fixtures ?? []).filter(([h, a]) => h === team || a === team);
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
