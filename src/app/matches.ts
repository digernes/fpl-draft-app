// Head-to-head matches: the list, odds and the expanded match.

import type { Lineup, Match, Odds } from '../shared/data.ts';
import { clubState, liveProjection, type PlayerState, type SlimLive } from '../shared/live.ts';
import { liveOdds } from '../shared/odds.ts';
import { avatar, empty, ptsPill, seg } from './components.ts';
import { esc, fmtShortDay, fmtTime, fmtWeekday, pct, priceText, sum } from './format.ts';
import { first, gwBonus, gwEvents, gwInfo, gwPoints, isLive, lineupFor, matchKey, mgr, player, slotOf } from './lookups.ts';
import { lineupFilters, showsEvents, statBadge } from './lineup-filters.ts';
import { matchPitch, subMark, type PitchPlayer, type PitchSide } from './pitch.ts';
import { D, live, LIVE_URL, state } from './state.ts';

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

// Live odds for a match in play: both scores so far, plus FPL's expected points for
// whatever each XI still has to play, with the uncertainty shrinking as games finish.
function inPlayOdds(m: Match) {
  const home = live?.gw === m.gw ? live.lineups[m.home] : undefined;
  const away = live?.gw === m.gw ? live.lineups[m.away] : undefined;
  if (!live || !home || !away) return null;
  const ep = (pid: number) => D.live?.ep[pid] ?? player(pid)?.ep ?? 0;
  return liveOdds(liveProjection(home, live.feed, playerInfo, ep), liveProjection(away, live.feed, playerInfo, ep), D.meta.oddsOverround);
}

// FotMob-style match state next to each player in a live gameweek.
export function stateLabel(s: PlayerState) {
  if (s.state === 'live') return `<span class="lp-state is-live" data-tip="Playing now">${Math.max(1, s.min)}'</span>`;
  if (s.state === 'done') return `<span class="lp-state" data-tip="Match over">FT</span>`;
  if (s.state === 'blank') return `<span class="lp-state" data-tip="No match this gameweek">–</span>`;
  const ko = s.ko ? new Date(s.ko) : null;
  // Phones only have room for the time.
  return `<span class="lp-state" data-tip="Still to play">${ko ? `<span class="wide-only">${fmtWeekday.format(ko)} </span>${fmtTime.format(ko)}` : 'TBC'}</span>`;
}

function preMatchOdds(m: Match) {
  if (!m.odds) return '';
  const outcome = !m.finished ? null : m.homePts! > m.awayPts! ? 0 : m.homePts === m.awayPts ? 1 : 2;
  // The first gameweek priced before its deadline, so kept rather than worked out afterwards.
  const keptFrom = Math.min(...D.matches.filter((x) => x.odds && !x.odds.afterwards).map((x) => x.gw));
  const tip = m.odds.afterwards
    ? `Worked out afterwards from form before the gameweek; from GW ${keptFrom} on, the odds are the ones at the deadline`
    : 'The odds at the deadline';
  return `<div class="detail-odds"><div class="detail-label">Pre-match odds <span class="muted" data-tip="${tip}">${m.odds.afterwards ? '· worked out afterwards' : '· at the deadline'}</span></div>${oddsRow(m.odds, m, outcome)}</div>`;
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
      const match = feed ? clubState(feed, p.club) : null;
      const twice = doubles.has(p.club) ? '<span data-tip="Plays twice this gameweek">×2</span>' : '';
      return {
        pid,
        badge: statBadge(pid, m.gw) ?? roundPill(pid, m.gw, match),
        events: showsEvents(m.gw) ? gwEvents(pid, m.gw) : undefined,
        mark: l.subs.includes(pid) ? subMark : '',
        note: match?.state === 'live' ? stateLabel(match) : twice,
      };
    };
  const side = (id: number, l: Lineup): PitchSide => ({ id, xi: l.xi.map(onPitch(l)), note: lineupNote(l, feed) });
  const pitch = matchPitch(side(m.home, home), side(m.away, away), [home.bench.map(onPitch(home)), away.bench.map(onPitch(away))]);
  return `${lineupFilters(m.gw)}${pitch}`;
}

// How far through the gameweek the XI is, and the score after any double-gameweek penalty.
function lineupNote(l: Lineup, feed: SlimLive | null) {
  const states = feed ? l.xi.map((pid) => clubState(feed, player(pid).club).state) : [];
  const count = (...wanted: PlayerState['state'][]) => states.filter((s) => wanted.includes(s)).length;
  return [
    count('live') && `${count('live')} playing`,
    count('due') && `${count('due')} to play`,
    count('done', 'blank') && `${count('done', 'blank')} done`,
    l.dgw && `<span data-tip="${D.meta.dgwPenalty} off per double-gameweek player in the XI">${l.adj} adj.</span>`,
  ]
    .filter(Boolean)
    .join(' · ');
}

// A player's points in a gameweek. Before kick-off a 0 says nothing, so players still
// to play show what FPL expects instead.
export function roundPill(pid: number, gw: number, match: PlayerState | null) {
  const pts = gwPoints(pid, gw);
  if (match?.state !== 'due' || pts !== 0) return ptsPill(pts, gwBonus(pid, gw));
  const ep = D.live?.ep[pid] ?? player(pid).ep;
  return `<span class="ptsp xp" data-tip="Expected points (not played yet)">${ep.toFixed(1)}</span>`;
}

function upcomingDetail(m: Match) {
  if (!m.odds) return `<div class="match-detail">${empty('Odds go up three gameweeks before the deadline')}</div>`;
  const [ph, pd, pa] = m.odds.p;
  const [eh, ea] = m.odds.expected;
  const projected = (id: number, ids: number[]): PitchSide => ({
    id,
    xi: ids.map((pid) => {
      const p = player(pid);
      return {
        pid,
        badge: `<span class="ptsp xp">${p.ep.toFixed(1)}</span>`,
        mark: p.status !== 'a' ? `<span class="pp-flag" data-tip="${esc(p.news || 'Flagged')}">!</span>` : '',
      };
    }),
    note: `<span data-tip="Best legal XI by FPL expected points">${sum(ids.map((pid) => player(pid).ep)).toFixed(1)} xP</span>`,
  });
  return `<div class="match-detail">
    <div class="prob">
      <div class="prob-bar"><span class="m${slotOf(m.home)}" style="flex:${ph}"></span><span class="prob-draw" style="flex:${pd}"></span><span class="m${slotOf(m.away)}" style="flex:${pa}"></span></div>
      <div class="prob-legend"><span>${first(m.home)} ${pct(ph)}</span><span>Draw ${pct(pd)}</span><span>${first(m.away)} ${pct(pa)}</span></div>
    </div>
    <p class="detail-note">Model score ${eh} – ${ea}: league average, plus ${m.odds.xi ? 'form and each side’s best projected XI' : 'season form'}. Prices carry a ${Math.round((D.meta.oddsOverround - 1) * 100)}% margin.</p>
    ${m.odds.xi ? matchPitch(projected(m.home, m.odds.xi[0]), projected(m.away, m.odds.xi[1])) : ''}
  </div>`;
}

export function roundSubtitle(gw: number) {
  const info = gwInfo(gw);
  if (isLive() && gw === D.meta.currentGw) return `Live now · scores update every ${LIVE_URL ? '30 seconds' : '10 minutes'}`;
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
  if (isLive() && gw === D.meta.currentGw)
    return `Live now<span class="wide-only"> · scores update every ${LIVE_URL ? '30 seconds' : '10 minutes'}</span>`;
  if (!info?.deadline || info.finished) return roundSubtitle(gw);
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
