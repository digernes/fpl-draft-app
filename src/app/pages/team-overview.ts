// A draft team's Overview tab: its form, the next match, the starting XI on a pitch and the
// head to head; the Fixtures tab shows the fixtures and the head to head too.

import { bestXi } from '../../shared/best-xi.ts';
import type { Match } from '../../shared/data.ts';
import { playerState, type SlimLive } from '../../shared/live.ts';
import { avatar, bestOf, card, empty, listRow, photo, seg, tile } from '../components.ts';
import { totalSlots } from '../event-icons.ts';
import { esc, fmtShortDay, pct, plural, priceText, signed } from '../format.ts';
import { first, gwEvents, gwInfo, lineupFor, mgr, player } from '../lookups.ts';
import { nemesis, rivalries, type Rivalry } from '../manager-stats.ts';
import { pitchPill, stateLabel } from '../match-lineups.ts';
import { matchStatus, matchStatusText } from '../matches.ts';
import { bestOfMatch, lineupFilters, showsEvents, statBadge, stillToCome } from '../lineup-filters.ts';
import { autoSubOf, formationOf, pitch, type PitchPlayer } from '../pitch.ts';
import { href } from '../router.ts';
import { D, live, state } from '../state.ts';
import { everOwned, squadOf, xiRecord } from './team-squad.ts';

const who = (id: number) => `<span class="tile-who">${avatar(id, 24)}<span class="tile-name">${first(id)}</span></span>`;
export const playerWho = (pid: number) =>
  `<a class="tile-who" href="${href.player(pid)}">${photo(pid, 28)}<span class="tile-name">${esc(player(pid).name)}</span></a>`;
const record = (r: Rivalry) => `W${r.won} D${r.drawn} L${r.lost} · ${r.pf}-${r.pa}`;
const opponentOf = (m: Match, id: number) => (m.home === id ? m.away : m.home);
const scoreFor = (m: Match, id: number) => (m.home === id ? [m.homePts ?? 0, m.awayPts ?? 0] : [m.awayPts ?? 0, m.homePts ?? 0]);
export const resultOf = (pf: number, pa: number) => (pf > pa ? 'W' : pf < pa ? 'L' : 'D');
// Where a win for this team is in a match's odds: home, draw, away.
const winIndex = (m: Match, id: number) => (m.home === id ? 0 : 2);

// fotmob.com's Team form: the last five results, each a score in its result's colour over
// the opponent, and a link to the match.
// The last five results; the match being played is the next card's.
export function formCard(id: number) {
  const played = D.matches.filter((m) => m.finished && (m.home === id || m.away === id)).slice(-5);
  if (!played.length) return '';
  const items = played.map((m) => {
    const [pf, pa] = scoreFor(m, id);
    const res = resultOf(pf, pa);
    return `<a class="form-item" href="${href.match(m)}" data-tip="GW ${m.gw}: ${pf}-${pa} vs ${first(opponentOf(m, id))}"><span class="livep ${res}">${pf}-${pa}</span>${avatar(opponentOf(m, id), 24)}</a>`;
  });
  return card({ title: 'Team form', body: `<div class="team-form">${items.join('')}</div>` });
}

// The match being played (Ongoing match), or the next one, as fotmob.com's Next match.
export function nextMatchCard(id: number) {
  const m = D.matches.find((x) => !x.finished && (x.home === id || x.away === id));
  if (!m) return '';
  const side = (x: number) => `<span class="nm-side">${avatar(x, 40)}<span>${first(x)}</span></span>`;
  const win = winIndex(m, id);
  const chance = m.odds && !m.started ? `<div class="nm-odds">${pct(m.odds.p[win])} to win · ${priceText(m.odds.prices[win])}</div>` : '';
  return card({
    title: m.started ? 'Ongoing match' : 'Next match',
    sub: `Gameweek ${m.gw}`,
    body: `<a class="next-match" href="${href.match(m)}">${side(m.home)}<span class="nm-mid">${nextMatchMid(m)}</span>${side(m.away)}</a>${chance}`,
  });
}

// Between the sides: the score while it's played, or the deadline before.
function nextMatchMid(m: Match) {
  if (m.started) return `<span class="nm-score">${m.homePts} - ${m.awayPts}</span><span class="nm-when">${matchStatusText(m)}</span>`;
  const deadline = gwInfo(m.gw)?.deadline;
  return `<span class="nm-time">${deadline ? fmtShortDay.format(new Date(deadline)) : 'TBC'}</span><span class="nm-when">Deadline</span>`;
}

// Every match: the results and those to come, each a link to the match.
export function fixturesCard(id: number, { limit = Infinity } = {}) {
  const mine = D.matches.filter((m) => m.home === id || m.away === id);
  const next = mine.findIndex((m) => !m.finished);
  // Around the next match: the two before it and what comes after.
  const from = limit === Infinity ? 0 : Math.max(0, (next < 0 ? mine.length : next) - 2);
  const list = mine.slice(from, from + limit);
  const rows = list.map((m) => {
    const opp = opponentOf(m, id);
    return `<a class="fx-row" href="${href.match(m)}"><span class="fx-gw">GW ${m.gw}</span>${avatar(opp, 24)}<span class="fx-opp">${first(opp)} <span class="muted">${m.home === id ? '(H)' : '(A)'}</span></span>${fixtureValue(m, id)}</a>`;
  });
  return card({
    title: 'Fixtures',
    body: rows.length ? `<div class="fx-list">${rows.join('')}</div>` : empty('No fixtures'),
    footer: limit < mine.length ? { href: href.team(id, 'fixtures'), label: 'All fixtures' } : null,
  });
}

// The score once a match has started, or the chance of a win before it.
function fixtureValue(m: Match, id: number) {
  if (m.started) {
    const [pf, pa] = scoreFor(m, id);
    return `<span class="livep ${resultOf(pf, pa)}">${pf}-${pa}</span>`;
  }
  return m.odds ? `<span class="muted">${pct(m.odds.p[winIndex(m, id)])}</span>` : '';
}

// FotMob's "Last starting XI" on a pitch, or the best XI of the season by the points
// players have scored for this manager.
export function lineupCard(id: number) {
  const allTime = state.lineupView === 'all';
  const { sub, body } = allTime ? bestLineup(id) : lastLineup(id);
  const toggle = seg(
    'lineup-view',
    [
      ['last', 'Last match'],
      ['all', 'All-time'],
    ],
    allTime ? 'all' : 'last',
  );
  return card({ title: 'Starting XI', sub, action: toggle, body, cls: 'lineup-card' });
}

function lastLineup(id: number) {
  const gw = D.meta.currentGw;
  const l = gw >= D.meta.firstGw ? lineupFor(id, gw) : undefined;
  if (!l) return { sub: '', body: empty('No lineup yet') };
  const feed = live?.gw === gw ? live.feed : null;
  const top = bestInMatch(id, gw, l.xi, feed);
  const onPitch = (pid: number): PitchPlayer => {
    const match = feed ? playerState(feed, pid, player(pid).club) : null;
    return {
      pid,
      badge: statBadge(pid, gw, top.has(pid)) ?? pitchPill(pid, gw, match, top.has(pid)),
      events: showsEvents(gw) ? gwEvents(pid, gw) : undefined,
      mark: autoSubOf(l, pid, gw),
      note: match?.state === 'live' ? stateLabel(match) : '', // one taken off has his minute by the arrow
    };
  };
  return {
    sub: `GW ${gw} · ${plural(l.pts, 'pt')}${feed ? ' so far' : ''} · ${formationOf(l.xi)}`,
    body: lineupFilters(gw, stillToCome(feed)) + pitch(l.xi.map(onPitch), l.bench.map(onPitch)),
  };
}

// The head-to-head's best is blue once it's over, should he be in this XI.
function bestInMatch(id: number, gw: number, xi: number[], feed: SlimLive | null) {
  const h2h = D.matches.find((m) => m.gw === gw && (m.home === id || m.away === id));
  const over = h2h ? matchStatus(h2h) === 'done' : !feed;
  if (!over) return new Set<number>();
  const other = h2h && lineupFor(opponentOf(h2h, id), gw);
  return bestOfMatch([...xi, ...(other?.xi ?? [])], gw);
}

function bestLineup(id: number) {
  const record = xiRecord(id);
  const squad = squadOf(id);
  const owned = new Set(squad);
  const scored = (pid: number) => record.get(pid)?.pts ?? 0;
  const xi = bestXi(everOwned(id, squad), scored, (pid) => player(pid).pos, D.meta.xiLimits);
  if (!xi.ids.length) return { sub: '', body: empty('No points yet') };
  // Badges are coloured by points per gameweek of the season, on a scale of their own: a
  // gameweek's 6 for green is more than even the best average, so here green beats the
  // league's average XI player (about 4 a week). Blue is the XI's best.
  const gameweeks = Math.max(1, D.meta.currentGw - D.meta.firstGw + 1);
  const tier = (perWeek: number) => (perWeek >= 4 ? 'p2' : perWeek >= 1 ? 'p1' : 'p0');
  const top = bestOf(xi.ids, scored);
  const onPitch = (pid: number): PitchPlayer => {
    const { pts, goals, assists, starts } = record.get(pid)!;
    const owner = player(pid).owner;
    const now = owned.has(pid) ? '' : owner ? ` · now with ${mgr(owner)?.first}` : ' · a free agent now';
    return {
      pid,
      badge: `<span class="ptsp ${top.has(pid) ? 'top' : tier(pts / gameweeks)}">${pts}</span>`,
      icons: totalSlots(goals, assists, starts),
      tip: `${player(pid).name}: ${plural(pts, 'pt')} in ${plural(starts, 'start')}${now}`,
      faded: !owned.has(pid),
    };
  };
  return { sub: `Season’s best · ${xi.pts} pts · ${formationOf(xi.ids)}`, body: pitch(xi.ids.map(onPitch)) };
}

export function rivalsCard(id: number) {
  const rows = rivalries(D, id);
  const played = rows.filter((r) => r.played);
  if (!played.length) return card({ title: 'Head to head', body: empty('No finished matches yet') });
  return card({
    title: 'Head to head',
    body: `<div class="tiles">${rivalTiles(id, played)}</div><div class="list">${rows.map(rivalRow).join('')}</div>`,
  });
}

// The best and worst opponents, once there are two to tell apart, and the nemesis.
function rivalTiles(id: number, played: Rivalry[]) {
  const [best, worst] = played.length > 1 ? [played[0], played.at(-1)!] : [null, null];
  const foe = nemesis(D, id);
  return [
    best && tile('Best opponent', who(best.opp), record(best)),
    worst && tile('Worst opponent', who(worst.opp), record(worst)),
    foe &&
      tile(
        'Nemesis',
        playerWho(foe.player),
        `${foe.pts} pts against you${foe.matches > 1 ? ` in ${foe.matches} matches` : ''} for ${foe.owners.map(first).join(', ')}`,
        'The opposing player with the most points against you',
      ),
  ]
    .filter(Boolean)
    .join('');
}

const rivalRow = (r: Rivalry) =>
  listRow({
    lead: avatar(r.opp, 24),
    title: first(r.opp),
    meta: r.played ? record(r) : 'Not played yet',
    value: r.played ? signed(r.pf - r.pa) : '–',
  });
