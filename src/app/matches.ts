// Head-to-head matches: the list, where each stands, and a round's subtitle and deadline.
// Their odds are in match-odds.ts, and their lineups in match-lineups.ts.

import type { Match } from '../shared/data.ts';
import { playerState } from '../shared/live.ts';
import { avatar, empty } from './components.ts';
import { countdown, esc, fmtShortDay, fmtTime, fmtWeekday, plural } from './format.ts';
import { first, gwInfo, isLive, isSettling, lineupFor, mgr, player } from './lookups.ts';
import { inPlayOdds, oddsRow } from './match-odds.ts';
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
  const mine = (m: Match) => (followed(m) ? 0 : 1);
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
  const feed = feedFor(m.gw);
  if (!m.started || !feed) return 'due';
  const states = squadsIn(m).map((pid) => playerState(feed, pid, player(pid)?.club).state);
  if (states.some((s) => s === 'live' || s === 'off')) return 'live';
  return states.every((s) => s === 'done' || s === 'blank') ? 'done' : 'due';
}

// The gameweek's live feed: the relay's while it's played, else the last build's.
const feedFor = (gw: number) => (live?.gw === gw ? live.feed : D.live?.gw === gw ? D.live : null);

// Every player in either squad.
const squadsIn = (m: Match) =>
  [m.home, m.away].flatMap((id) => {
    const l = lineupFor(id, m.gw);
    return l ? [...l.xi, ...l.bench] : [];
  });

const followed = (m: Match) => m.home === state.myTeam || m.away === state.myTeam;

/** Between match days: when the next club with a player in either squad kicks off. */
export function nextKickoff(m: Match): string | null {
  const feed = feedFor(m.gw);
  if (!feed) return null;
  const kickoffs = squadsIn(m)
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

// FT or Live, and between a gameweek's match days when the next of its players kicks off:
// the time if it's today, the short day if not, green as Live is, the gameweek being on.
// Over before FPL has checked the gameweek's stats, FT* with what can still change (and
// while the gameweek settles, should the last build predate FPL's flag).
function statusChip(m: Match) {
  const state = matchStatus(m);
  const unchecked = gwInfo(m.gw)?.checked === false || (m.gw === D.meta.currentGw && isSettling());
  if (state === 'done' && unchecked)
    return statusDot(
      'done',
      '<span data-tip="Until FPL has checked the gameweek’s stats, the bonus, defensive contributions and contentious goals can still change">FT*</span>',
    );
  if (state !== 'due' || !m.started || m.finished) return statusDot(state);
  const ko = nextKickoff(m);
  if (!ko) return '';
  const at = new Date(ko);
  const today = at.toDateString() === new Date().toDateString();
  return `<span class="status-dot live" data-tip="Next match ${esc(dayAndTime(at))}">${today ? fmtTime.format(at) : fmtWeekday.format(at)}</span>`;
}

function matchBlock(m: Match, compact = false, current = false) {
  const odds = compact ? '' : blockOdds(m);
  const status = statusChip(m);
  return `<div class="match-block${followed(m) ? ' mine' : ''}${current ? ' this' : ''}">
    <a class="match" href="${href.match(m)}"><span class="status-slot">${status}</span>${blockSide(m.home, 'home')}<span class="mid">${blockCenter(m)}</span>${blockSide(m.away, 'away')}<span></span></a>
    ${odds}
  </div>`;
}

/** Over, as its Full time says: FPL has finished it, or every player in either squad is done. */
export const isOver = (m: Match) => m.finished || matchStatus(m) === 'done';

/** Whether a head-to-head shows odds: the pre-match ones until it starts, then the live ones while it's played. */
export const showsOdds = (m: Match) => (m.started ? !isOver(m) && !isSettling() : Boolean(m.odds));

// The pre-match odds until it starts, then the live ones while it's played.
function blockOdds(m: Match) {
  if (m.odds && !m.started) return oddsRow(m.odds, m);
  const inPlay = m.started && !isOver(m) ? inPlayOdds(m) : null;
  return inPlay ? oddsRow(inPlay, m, null, true) : '';
}

// The score once it has started, the deadline's time before.
function blockCenter(m: Match) {
  if (m.started) return `<span class="score">${m.homePts} - ${m.awayPts}</span>`;
  const deadline = gwInfo(m.gw)?.deadline;
  return `<span class="kickoff">${deadline ? fmtTime.format(new Date(deadline)) : 'TBC'}</span>`;
}

const blockSide = (id: number, cls: 'home' | 'away') =>
  `<span class="side ${cls}">${cls === 'away' ? avatar(id, 22) : ''}<span class="side-text"><span class="side-name">${first(id)}</span><span class="side-team">${esc(mgr(id)!.team)}</span></span>${cls === 'home' ? avatar(id, 22) : ''}</span>`;

/** `short`: under a title that already names the gameweek, where it shares the line with the odds' switch. */
export function roundSubtitle(gw: number, { short = false } = {}) {
  const info = gwInfo(gw);
  if (liveNow(gw)) return liveLine(gw, short);
  if (info?.finished) return 'Final scores';
  const parts = [];
  if (info?.deadline) parts.push(`Deadline ${dayAndTime(new Date(info.deadline))}`);
  const waivers = waiversBefore(gw);
  if (waivers) parts.push(`waivers ${dayAndTime(waivers)}`);
  return parts.join(' · ');
}

// The Fixtures tab's date row already says the day, so it only needs the deadline's
// time; the waivers (also in the header) are left out on phones.
export function deadlineNote(gw: number) {
  const info = gwInfo(gw);
  if (liveNow(gw) || !info?.deadline || info.finished) return roundSubtitle(gw, { short: true });
  const waivers = waiversBefore(gw);
  const waiverNote = waivers ? `<span class="wide-only"> · waivers ${dayAndTime(waivers)}</span>` : '';
  return `Deadline ${fmtTime.format(new Date(info.deadline))}${waiverNote}`;
}

const liveNow = (gw: number) => isLive() && gw === D.meta.currentGw;

// Every match over but the points not yet confirmed: plain, as it's no longer live.
const settlingLine = (gw: number, matches: number, short: boolean) =>
  short
    ? `All ${matches} played · points provisional`
    : `Gameweek ${gw} · all ${matches} matches played · points provisional until FPL confirms them`;

// The gameweek being played, in green, then how far its Premier League matches have got:
// how many are over, and how many are on now or, between them, when the next kicks off.
function liveLine(gw: number, short: boolean) {
  const fixtures = feedFor(gw)?.fixtures ?? [];
  if (isSettling()) return settlingLine(gw, fixtures.length, short);
  const done = fixtures.filter((f) => f.done).length;
  const on = fixtures.filter((f) => f.started && !f.done).length;
  const next = fixtures
    .filter((f) => !f.started && f.ko)
    .map((f) => f.ko!)
    .sort()[0];
  const left = next && countdown(next);
  const now = on ? `${on} on now` : left ? `next in ${left}` : '';
  const of = short ? fixtures.length : plural(fixtures.length, 'match', 'matches');
  const played = fixtures.length ? `${done} of ${of} played` : '';
  const live = short ? 'Live' : `Gameweek ${gw} live`;
  return [`<span class="round-live"><i class="live-dot"></i>${live}</span>`, played, now].filter(Boolean).join(' · ');
}

// The next waivers, in the gameweek they come before, while they're still to come.
function waiversBefore(gw: number) {
  const waivers = gw === D.meta.nextGw && D.meta.nextWaivers ? new Date(D.meta.nextWaivers) : null;
  return waivers && waivers.getTime() > Date.now() ? waivers : null;
}

const dayAndTime = (at: Date) => `${fmtShortDay.format(at)}, ${fmtTime.format(at)}`;
