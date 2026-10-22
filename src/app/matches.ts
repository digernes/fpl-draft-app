// Head-to-head matches: the list, odds and the expanded match.

import type { Match, Odds } from '../shared/data.ts';
import { clubState, liveProjection, type PlayerState } from '../shared/live.ts';
import { liveOdds } from '../shared/odds.ts';
import { avatar, crest, empty, ptsPill, seg, tag } from './components.ts';
import { esc, fmtShortDay, fmtTime, fmtWeekday, pct, plural, priceText, sum } from './format.ts';
import { first, gwInfo, gwPoints, isLive, lineupFor, matchKey, mgr, player, slotOf } from './lookups.ts';
import { D, live, LIVE_URL, state } from './state.ts';

const POS_ORDER = { GKP: 0, DEF: 1, MID: 2, FWD: 3 };

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
function stateLabel(s: PlayerState) {
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
  return `<div class="match-detail">${preMatchOdds(m)}<div class="lineups">${lineupColumn(m.home, m.gw)}${lineupColumn(m.away, m.gw)}</div></div>`;
}

function lineupColumn(id: number, gw: number) {
  const l = lineupFor(id, gw);
  if (!l) return `<div class="lineup">${empty('No lineup')}</div>`;
  const feed = live?.gw === gw ? live.feed : null;
  const doubles = new Set(gwInfo(gw)?.doubles ?? []);
  const byPosition = (ids: number[]) => [...ids].sort((a, b) => POS_ORDER[player(a).pos] - POS_ORDER[player(b).pos]);
  const row = (pid: number, benched: boolean) => {
    const p = player(pid);
    const flags = [
      l.subs.includes(pid) ? tag('Sub', 'Came on as an automatic substitute', 'tag-sub') : '',
      doubles.has(p.club) ? tag('DGW', 'Plays twice this gameweek', 'tag-dgw') : '',
    ].join('');
    const match = feed ? clubState(feed, p.club) : null;
    const pts = gwPoints(pid, gw);
    // Before kick-off a 0 says nothing, so players still to play show what FPL expects instead.
    const ep = D.live?.ep[pid] ?? p.ep;
    const pill =
      match?.state === 'due' && pts === 0
        ? `<span class="ptsp xp" data-tip="Expected points (not played yet)">${ep.toFixed(1)}</span>`
        : ptsPill(pts);
    return `<div class="lp${benched ? ' benched' : ''}"><span class="lp-pos">${p.pos}</span>${crest(p.club, 16)}<span class="lp-name">${esc(p.name)}${flags}</span>${match ? stateLabel(match) : ''}${pill}</div>`;
  };
  // How far through the gameweek the scoring XI is.
  const states = feed ? l.xi.map((pid) => clubState(feed, player(pid).club).state) : [];
  const count = (...wanted: PlayerState['state'][]) => states.filter((s) => wanted.includes(s)).length;
  const progress = feed
    ? `<div class="lineup-state">${[
        count('live') && `${count('live')} playing`,
        count('due') && `${count('due')} to play`,
        count('done', 'blank') && `${count('done', 'blank')} done`,
      ]
        .filter(Boolean)
        .join(' · ')}</div>`
    : '';
  const adjusted = l.dgw
    ? ` <span class="muted" data-tip="${D.meta.dgwPenalty} off per double-gameweek player in the XI">(${l.adj} adj.)</span>`
    : '';
  return `<div class="lineup">
    <div class="lineup-head">${avatar(id, 24)}<span class="lineup-name">${first(id)}</span><span class="lineup-total">${l.pts}${adjusted}</span></div>${progress}
    ${byPosition(l.xi)
      .map((pid) => row(pid, false))
      .join('')}
    <div class="lineup-bench">Bench · ${plural(l.benchPts, 'pt')}</div>
    ${l.bench.map((pid) => row(pid, true)).join('')}
  </div>`;
}

function upcomingDetail(m: Match) {
  if (!m.odds) return `<div class="match-detail">${empty('Odds go up three gameweeks before the deadline')}</div>`;
  const [ph, pd, pa] = m.odds.p;
  const [eh, ea] = m.odds.expected;
  const projected = (id: number, ids: number[]) => {
    const xp = sum(ids.map((pid) => player(pid).ep));
    const rows = [...ids]
      .sort((a, b) => POS_ORDER[player(a).pos] - POS_ORDER[player(b).pos])
      .map((pid) => {
        const p = player(pid);
        const flag = p.status !== 'a' ? tag('!', p.news || 'Flagged', 'tag-flag') : '';
        return `<div class="lp"><span class="lp-pos">${p.pos}</span>${crest(p.club, 16)}<span class="lp-name">${esc(p.name)}${flag}</span><span class="ptsp xp">${p.ep.toFixed(1)}</span></div>`;
      });
    return `<div class="lineup"><div class="lineup-head">${avatar(id, 24)}<span class="lineup-name">${first(id)}</span><span class="lineup-total" data-tip="Best legal XI by FPL expected points">${xp.toFixed(1)} xP</span></div>${rows.join('')}</div>`;
  };
  return `<div class="match-detail">
    <div class="prob">
      <div class="prob-bar"><span class="m${slotOf(m.home)}" style="flex:${ph}"></span><span class="prob-draw" style="flex:${pd}"></span><span class="m${slotOf(m.away)}" style="flex:${pa}"></span></div>
      <div class="prob-legend"><span>${first(m.home)} ${pct(ph)}</span><span>Draw ${pct(pd)}</span><span>${first(m.away)} ${pct(pa)}</span></div>
    </div>
    <p class="detail-note">Model score ${eh} – ${ea}: league average, plus ${m.odds.xi ? 'form and each side’s best projected XI' : 'season form'}. Prices carry a ${Math.round((D.meta.oddsOverround - 1) * 100)}% margin.</p>
    ${m.odds.xi ? `<div class="lineups">${projected(m.home, m.odds.xi[0])}${projected(m.away, m.odds.xi[1])}</div>` : ''}
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
