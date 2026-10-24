// A draft team's page, as fotmob.com's team pages: the header with its manager, place in
// the table and a Follow button, then the tabs. Overview: form, the next match, the last
// starting XI, the table and head to head. Squad: the squad (or everyone ever owned) with
// this round's points, the next round's expected points and what each has scored for the
// team. Fixtures, Transfers, and Stats: the season's numbers and who scored them.

import { bestXi } from '../../shared/best-xi.ts';
import type { Match, Position } from '../../shared/data.ts';
import { playerState } from '../../shared/live.ts';
import { onAction } from '../actions.ts';
import { MOVE_TYPES } from '../cards.ts';
import { avatar, card, crest, empty, listRow, photo, seg, tag, tile, xpPill } from '../components.ts';
import { totalSlots } from '../event-icons.ts';
import { ago, esc, fmtShortDay, ordinal, pct, plural, priceText, signed, sum } from '../format.ts';
import { starSvg } from '../icons.ts';
import {
  club,
  first,
  gwEvents,
  gwInfo,
  gwPoints,
  isArchive,
  lineupFor,
  mgr,
  nextParts,
  nextXp,
  opponents,
  player,
  seasonStat,
  slotOf,
} from '../lookups.ts';
import { closeCalls, gameIn, nemesis, pointsByPosition, rivalries, type Rivalry } from '../manager-stats.ts';
import { matchStatusText, pitchPill, roundPill, stateLabel } from '../matches.ts';
import { dueFilters, lineupFilters, showsEvents, statBadge } from '../lineup-filters.ts';
import { autoSubOf, formationOf, pitch, type PitchPlayer } from '../pitch.ts';
import { renderView, type PageView } from '../render.ts';
import { href, TEAM_TABS, type Route } from '../router.ts';
import { D, live, state } from '../state.ts';
import { standingsTable } from '../table.ts';
import { TRADE_STATES } from '../views/transfers.ts';

const GROUPS: [Position, string][] = [
  ['GKP', 'Goalkeepers'],
  ['DEF', 'Defenders'],
  ['MID', 'Midfielders'],
  ['FWD', 'Forwards'],
];

const LABELS: Record<(typeof TEAM_TABS)[number], string> = {
  overview: 'Overview',
  squad: 'Squad',
  fixtures: 'Fixtures',
  transfers: 'Transfers',
  stats: 'Stats',
};

for (const [action, key] of [
  ['lineup-view', 'lineupView'],
  ['squad-scope', 'squadScope'],
  ['squad-sort', 'squadSort'],
  ['moves', 'moves'],
] as const)
  onAction(action, (value) => {
    state[key] = value;
    renderView();
  });

// fotmob.com's Follow button: the team the visitor follows comes first and stands out.
export function followButton(id: number) {
  const on = state.myTeam === id;
  return `<button type="button" class="follow${on ? ' on' : ''}" data-action="follow" data-value="${id}" aria-pressed="${on}">${starSvg(on)}<span>${on ? 'Following' : 'Follow'}</span></button>`;
}

export function pageTeam(route: Route): PageView {
  const id = route.id!;
  const m = mgr(id);
  if (!m) return { title: 'Team', body: card({ body: empty('No such team in this league') }) };
  const row = D.tables.overall.find((r) => r.id === id);
  const tabs: Record<string, () => string> = {
    overview: () => `<div class="cols">
      <div class="col">${formCard(id)}${nextMatchCard(id)}${card({ title: 'Table', body: standingsTable('overall', { highlight: [id] }), footer: { href: href.league('table'), label: 'Full table' } })}${rivalsCard(id)}</div>
      <div class="col">${lineupCard(id)}${fixturesCard(id, { limit: 5 })}</div>
    </div>`,
    squad: () => `<div class="cols">
      <div class="col">${squadCard(id)}</div>
      <div class="col">${positionCard(id)}${originalCard(id)}</div>
    </div>`,
    fixtures: () => `<div class="cols"><div class="col">${fixturesCard(id)}</div><div class="col">${rivalsCard(id)}</div></div>`,
    transfers: () => `<div class="cols">
      <div class="col">${movesCard(id)}</div>
      <div class="col">${claimsCard(id)}${tradesCard(id)}</div>
    </div>`,
    stats: () => `<div class="cols">
      <div class="col">${seasonCard(id)}${scorersCard(id)}</div>
      <div class="col">${positionCard(id)}${benchCard(id)}</div>
    </div>`,
  };
  return {
    title: route.tab === 'overview' ? m.team : `${LABELS[route.tab as keyof typeof LABELS]} · ${m.team}`,
    header: {
      logo: avatar(id, 56),
      title: esc(m.team),
      sub: `${esc(m.first)}${row ? ` · ${ordinal(row.rank)} of ${D.managers.length}` : ''}`,
      side: isArchive() ? '' : followButton(id),
      tabs: TEAM_TABS.map((tab) => ({ id: tab, label: LABELS[tab], href: href.team(id, tab) })),
      tab: route.tab,
      cls: 'team-header',
    },
    body: tabs[route.tab](),
  };
}

const who = (id: number) => `<span class="tile-who">${avatar(id, 24)}<span class="tile-name">${first(id)}</span></span>`;
const playerWho = (pid: number) =>
  `<a class="tile-who" href="${href.player(pid)}">${photo(pid, 28)}<span class="tile-name">${esc(player(pid).name)}</span></a>`;
const record = (r: Rivalry) => `W${r.won} D${r.drawn} L${r.lost} · ${r.pf}-${r.pa}`;
const opponentOf = (m: Match, id: number) => (m.home === id ? m.away : m.home);
const scoreFor = (m: Match, id: number) => (m.home === id ? [m.homePts ?? 0, m.awayPts ?? 0] : [m.awayPts ?? 0, m.homePts ?? 0]);

// fotmob.com's Team form: the last five results, each a score in its result's colour over
// the opponent, and a link to the match.
// The last five results; the match being played is the next card's.
function formCard(id: number) {
  const played = D.matches.filter((m) => m.finished && (m.home === id || m.away === id)).slice(-5);
  if (!played.length) return '';
  const items = played.map((m) => {
    const [pf, pa] = scoreFor(m, id);
    const res = pf > pa ? 'W' : pf < pa ? 'L' : 'D';
    return `<a class="form-item" href="${href.match(m)}" data-tip="GW ${m.gw}: ${pf}-${pa} vs ${first(opponentOf(m, id))}"><span class="livep ${res}">${pf}-${pa}</span>${avatar(opponentOf(m, id), 24)}</a>`;
  });
  return card({ title: 'Team form', body: `<div class="team-form">${items.join('')}</div>` });
}

// The match being played (Ongoing match), or the next one, as fotmob.com's Next match.
function nextMatchCard(id: number) {
  const m = D.matches.find((x) => !x.finished && (x.home === id || x.away === id));
  if (!m) return '';
  const deadline = gwInfo(m.gw)?.deadline;
  const mid = m.started
    ? `<span class="nm-score">${m.homePts} - ${m.awayPts}</span><span class="nm-when">${matchStatusText(m)}</span>`
    : `<span class="nm-time">${deadline ? fmtShortDay.format(new Date(deadline)) : 'TBC'}</span><span class="nm-when">Deadline</span>`;
  const side = (x: number) => `<span class="nm-side">${avatar(x, 40)}<span>${first(x)}</span></span>`;
  const home = m.home === id;
  const chance =
    m.odds && !m.started
      ? `<div class="nm-odds">${pct(m.odds.p[home ? 0 : 2])} to win · ${priceText(m.odds.prices[home ? 0 : 2])}</div>`
      : '';
  return card({
    title: m.started ? 'Ongoing match' : 'Next match',
    sub: `Gameweek ${m.gw}`,
    body: `<a class="next-match" href="${href.match(m)}">${side(m.home)}<span class="nm-mid">${mid}</span>${side(m.away)}</a>${chance}`,
  });
}

// Every match: the results and those to come, each a link to the match.
function fixturesCard(id: number, { limit = Infinity } = {}) {
  const mine = D.matches.filter((m) => m.home === id || m.away === id);
  const next = mine.findIndex((m) => !m.finished);
  // Around the next match: the two before it and what comes after.
  const from = limit === Infinity ? 0 : Math.max(0, (next < 0 ? mine.length : next) - 2);
  const list = mine.slice(from, from + limit);
  const rows = list.map((m) => {
    const opp = opponentOf(m, id);
    const [pf, pa] = scoreFor(m, id);
    const res = pf > pa ? 'W' : pf < pa ? 'L' : 'D';
    const value = m.started
      ? `<span class="livep ${res}">${pf}-${pa}</span>`
      : m.odds
        ? `<span class="muted">${pct(m.odds.p[m.home === id ? 0 : 2])}</span>`
        : '';
    return `<a class="fx-row" href="${href.match(m)}"><span class="fx-gw">GW ${m.gw}</span>${avatar(opp, 24)}<span class="fx-opp">${first(opp)} <span class="muted">${m.home === id ? '(H)' : '(A)'}</span></span>${value}</a>`;
  });
  return card({
    title: 'Fixtures',
    body: rows.length ? `<div class="fx-list">${rows.join('')}</div>` : empty('No fixtures'),
    footer: limit < mine.length ? { href: href.team(id, 'fixtures'), label: 'All fixtures' } : null,
  });
}

const squadOf = (id: number) =>
  Object.keys(D.players)
    .map(Number)
    .filter((pid) => player(pid).owner === id);

// Each player's time with this manager: gameweeks in their lineup (XI or bench), and
// starts and points in the XI, the gameweek being played included.
function xiRecord(id: number) {
  const record = new Map<number, { pts: number; goals: number; assists: number; starts: number; weeks: number }>();
  const add = (pid: number, started: boolean, gw: number) => {
    const r = record.get(pid) ?? { pts: 0, goals: 0, assists: 0, starts: 0, weeks: 0 };
    r.weeks++;
    if (started) {
      const ev = gwEvents(pid, gw);
      r.pts += gwPoints(pid, gw);
      r.goals += ev?.goals ?? 0;
      r.assists += ev?.assists ?? 0;
      r.starts++;
    }
    record.set(pid, r);
  };
  for (let gw = D.meta.firstGw; gw <= D.meta.currentGw; gw++) {
    const l = lineupFor(id, gw);
    for (const pid of l?.xi ?? []) add(pid, true, gw);
    for (const pid of l?.bench ?? []) add(pid, false, gw);
  }
  return record;
}

// FotMob's "Last starting XI" on a pitch, or the best XI of the season by the points
// players have scored for this manager.
function lineupCard(id: number) {
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
  const onPitch = (pid: number): PitchPlayer => {
    const match = feed ? playerState(feed, pid, player(pid).club) : null;
    return {
      pid,
      badge: statBadge(pid, gw) ?? pitchPill(pid, gw, match),
      events: showsEvents(gw) ? gwEvents(pid, gw) : undefined,
      mark: autoSubOf(l, pid),
      note: match?.state === 'live' ? stateLabel(match) : '', // one taken off has his minute by the arrow
    };
  };
  return {
    sub: `GW ${gw} · ${plural(l.pts, 'pt')}${feed ? ' so far' : ''} · ${formationOf(l.xi)}`,
    body:
      lineupFilters(gw) + (feed?.fixtures.some((f) => !f.started) ? dueFilters(gw) : '') + pitch(l.xi.map(onPitch), l.bench.map(onPitch)),
  };
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
  // league's average XI player (about 4 a week) and blue is half as much again.
  const gameweeks = Math.max(1, D.meta.currentGw - D.meta.firstGw + 1);
  const tier = (perWeek: number) => (perWeek >= 6 ? 'p4' : perWeek >= 4 ? 'p3' : perWeek >= 2 ? 'p2' : perWeek >= 1 ? 'p1' : 'p0');
  const onPitch = (pid: number): PitchPlayer => {
    const { pts, goals, assists, starts } = record.get(pid)!;
    const owner = player(pid).owner;
    const now = owned.has(pid) ? '' : owner ? ` · now with ${mgr(owner)?.first}` : ' · a free agent now';
    return {
      pid,
      badge: `<span class="ptsp ${tier(pts / gameweeks)}">${pts}</span>`,
      icons: totalSlots(goals, assists, starts),
      tip: `${player(pid).name}: ${plural(pts, 'pt')} in ${plural(starts, 'start')}${now}`,
      faded: !owned.has(pid),
    };
  };
  return { sub: `Season’s best · ${xi.pts} pts · ${formationOf(xi.ids)}`, body: pitch(xi.ids.map(onPitch)) };
}

function squadCard(id: number) {
  const squad = squadOf(id);
  if (!squad.length) return card({ title: 'Squad', body: empty('No players yet') });
  const { currentGw: gw, firstGw, nextGw, lastGw } = D.meta;
  const l = gw >= firstGw ? lineupFor(id, gw) : undefined;
  const feed = live?.gw === gw ? live.feed : null;
  const showXp = !isArchive() && nextGw <= lastGw;
  const allTime = state.squadScope === 'all';
  const owned = new Set(squad);
  const players = allTime ? everOwned(id, squad) : squad;
  // In this gameweek's lineup or not ('out'); 'none' before the first gameweek.
  const role = (pid: number) => (!l ? 'none' : l.xi.includes(pid) ? 'xi' : l.bench.includes(pid) ? 'bench' : 'out');
  const ROLE_ORDER = { xi: 0, bench: 1, out: 2, none: 3 };

  const record = xiRecord(id);
  const total = (pid: number) => record.get(pid)?.pts ?? 0;
  const weeks = (pid: number) => record.get(pid)?.weeks ?? 0;

  // Grouped by position in lineup order, or one list sorted on a column, highest first,
  // with each player's position as a chip. Tapping the column again, or Position, groups
  // them again.
  const matchOf = (pid: number) => (feed && role(pid) !== 'out' ? playerState(feed, pid, player(pid).club) : null);
  const dash = '<span class="muted">–</span>';
  const columns = [
    {
      key: 'weeks',
      label: 'GWs',
      tip: `Gameweeks in ${mgr(id)!.first}’s squad, in the XI or on the bench`,
      value: weeks,
      cell: (pid: number) => String(weeks(pid)),
    },
    l && {
      key: 'gw',
      label: `GW${gw}`,
      tip: `Points in GW ${gw}${feed ? ', live' : ''}`,
      value: (pid: number) => (role(pid) === 'out' ? -1 : gwPoints(pid, gw)),
      cell: (pid: number) => (role(pid) === 'out' ? dash : roundPill(pid, gw, matchOf(pid))),
      cls: 'sq-gw',
    },
    showXp && {
      key: 'xp',
      label: 'xP',
      tip: `Expected points for GW ${nextGw}${state.xp === 'fpl' ? ' (FPL’s form)' : ''}`,
      value: (pid: number) => (owned.has(pid) ? nextXp(pid) : -1),
      cell: (pid: number) => (owned.has(pid) ? xpPill(nextXp(pid), nextParts(pid), opponents(player(pid).club, nextGw)) : dash),
    },
    {
      key: 'total',
      label: 'Total',
      tip: `Points in ${mgr(id)!.first}’s XI this season`,
      value: total,
      cell: (pid: number) => String(total(pid)),
      cls: 'sq-total',
    },
  ].filter((c) => !!c);
  const sorted = columns.find((c) => c.key === state.squadSort);
  const byLineup = (a: number, b: number) =>
    Number(!owned.has(a)) - Number(!owned.has(b)) || ROLE_ORDER[role(a)] - ROLE_ORDER[role(b)] || total(b) - total(a);
  const order = (a: number, b: number) => (sorted ? sorted.value(b) - sorted.value(a) : 0) || byLineup(a, b);
  const heads = columns
    .map((c) => {
      const on = c === sorted;
      const tip = `${c.tip} · ${on ? 'tap again for the lineup order' : 'tap to sort'}`;
      return `<button type="button" class="sq-num sq-sort" data-action="squad-sort" data-value="${on ? 'lineup' : c.key}" aria-pressed="${on}" data-tip="${esc(tip)}">${c.label}</button>`;
    })
    .join('');
  const row = (pid: number) => {
    const p = player(pid);
    const r = role(pid);
    const match = matchOf(pid);
    // Lineups already have the automatic substitutions made.
    const note = !owned.has(pid)
      ? `<span data-tip="${p.owner ? `Now with ${esc(mgr(p.owner)?.first)}` : 'A free agent now'}">Left</span>`
      : r === 'bench'
        ? 'Bench'
        : r === 'out'
          ? `<span data-tip="Joined after the GW ${gw} deadline, so not in that lineup">New</span>`
          : l?.subs.includes(pid)
            ? `<span data-tip="Came on as an automatic substitute in GW ${gw}">Auto-sub</span>`
            : '';
    // Sorted, the position chip takes the room of the club's short name; the crest stays.
    const where = sorted
      ? `<span class="pos-tag pos-${p.pos}">${p.pos}</span>${crest(p.club, 14)}`
      : `${crest(p.club, 14)}${esc(club(p.club).short)}`;
    const meta = [where, note].filter(Boolean).join(' · ');
    const flag = owned.has(pid) && p.status !== 'a' ? tag('!', p.news || 'Flagged', 'tag-flag') : '';
    const state = match ? stateLabel(match) : ''; // by the name, or on a phone in a column of its own (squads.css)
    return `<a class="sq-row${r === 'bench' ? ' benched' : ''}${owned.has(pid) ? '' : ' gone'}" href="${href.player(pid)}">
      ${photo(pid, 32)}
      <div class="sq-main"><div class="sq-name"><span>${esc(p.name)}</span>${flag}${state}</div><div class="sq-meta">${meta}</div>${state}</div>
      ${columns.map((c) => `<span class="sq-num ${c.cls ?? ''}">${c.cell(pid)}</span>`).join('')}
    </a>`;
  };
  const head = (label: string) => `<div class="sq-head">${label}${heads}</div>`;
  const body = sorted
    ? head(
        '<button type="button" class="sq-label sq-sort" data-action="squad-sort" data-value="lineup" aria-pressed="false" data-tip="Group by position, in lineup order">Position</button>',
      ) + [...players].sort(order).map(row).join('')
    : GROUPS.map(([pos, label]) => {
        const ids = players.filter((pid) => player(pid).pos === pos).sort(order);
        return ids.length ? head(`<span class="sq-label">${label}</span>`) + ids.map(row).join('') : '';
      }).join('');
  const sub = allTime
    ? `${plural(players.length, 'player')} ever owned · ${sum(players.map(total))} pts in the XI`
    : l
      ? `${plural(squad.length, 'player')} · ${l.pts} pts in GW ${gw}${feed ? ' so far' : ''}`
      : plural(squad.length, 'player');
  const scope = seg(
    'squad-scope',
    [
      ['now', 'Current'],
      ['all', 'All-time'],
    ],
    allTime ? 'all' : 'now',
  );
  return card({ title: 'Squad', sub, action: scope, body: `<div class="squad">${body}</div>` });
}

// The squad now, plus everyone the manager drafted, signed or put in a lineup.
function everOwned(id: number, squad: number[]) {
  const ids = new Set(squad);
  for (const l of Object.values(D.lineups[id] ?? {})) for (const pid of [...l.xi, ...l.bench]) ids.add(pid);
  for (const pk of D.draft.picks) if (pk.manager === id) ids.add(pk.player);
  for (const mv of D.transfers.moves) if (mv.manager === id) ids.add(mv.in);
  return [...ids].filter((pid) => player(pid));
}

function rivalsCard(id: number) {
  const rows = rivalries(D, id);
  const played = rows.filter((r) => r.played);
  if (!played.length) return card({ title: 'Head to head', body: empty('No finished matches yet') });
  const best = played.length > 1 ? played[0] : null;
  const worst = played.length > 1 ? played.at(-1)! : null;
  const foe = nemesis(D, id);
  const tiles = [
    best && tile('Best opponent', who(best.opp), record(best)),
    worst && tile('Worst opponent', who(worst.opp), record(worst)),
    foe &&
      tile(
        'Nemesis',
        playerWho(foe.player),
        `${foe.pts} pts against you${foe.matches > 1 ? ` in ${foe.matches} matches` : ''} for ${foe.owners.map(first).join(', ')}`,
        'The opposing player with the most points against you',
      ),
  ].filter(Boolean);
  const list = rows.map((r) =>
    listRow({
      lead: avatar(r.opp, 24),
      title: first(r.opp),
      meta: r.played ? record(r) : 'Not played yet',
      value: r.played ? signed(r.pf - r.pa) : '–',
    }),
  );
  return card({
    title: 'Head to head',
    sub: 'Best record first: points per match, then points difference',
    body: `<div class="tiles">${tiles.join('')}</div><div class="list">${list.join('')}</div>`,
  });
}

function seasonCard(id: number) {
  const s = seasonStat(id);
  if (!s?.high || !s.low) return '';
  const result = (gw: number) => {
    const g = gameIn(D, id, gw);
    if (!g) return `GW ${gw}`;
    const verb = g.pf > g.pa ? 'Won' : g.pf < g.pa ? 'Lost' : 'Drew';
    return `${verb} ${g.pf}-${g.pa} vs ${first(g.opp)} · GW ${gw}`;
  };
  const { bestDefeat, worstWin } = closeCalls(D, id);
  const moves = D.transfers.summary.find((t) => t.id === id);
  const weeks = D.lineups[id] ? Object.keys(D.lineups[id]).length : 0;
  const tiles = [
    tile('Best gameweek', s.high.pts, result(s.high.gw)),
    tile('Worst gameweek', s.low.pts, result(s.low.gw)),
    s.mvp && tile('Top scorer', playerWho(s.mvp.player), `${s.mvp.pts} pts in your XI`),
    tile('On the bench', s.bench, weeks ? `${Math.round(s.bench / weeks)} a week left out` : ''),
    bestDefeat &&
      tile('Best losing score', bestDefeat.pf, `Lost ${bestDefeat.pf}-${bestDefeat.pa} to ${first(bestDefeat.opp)} · GW ${bestDefeat.gw}`),
    worstWin && tile('Worst winning score', worstWin.pf, `Beat ${first(worstWin.opp)} ${worstWin.pf}-${worstWin.pa} · GW ${worstWin.gw}`),
    tile('Longest winning run', s.streak.bestWin, s.streak.current ? `Current run ${s.streak.current}` : ''),
    moves &&
      tile(
        'Transfers',
        moves.moves,
        moves.moves ? `${signed(moves.net)} net points` : 'None yet',
        'Waivers, free agents and trades; net is what came in minus what went out, since each move',
      ),
  ].filter(Boolean);
  return card({ title: 'Season', body: `<div class="tiles">${tiles.join('')}</div>` });
}

// Where the XI's points come from, as bars against the biggest share.
function positionSplit(id: number) {
  const split = pointsByPosition(D, id);
  const total = sum(Object.values(split));
  if (!total) return '';
  const top = Math.max(...Object.values(split));
  const rows = GROUPS.map(
    ([pos, label]) =>
      `<div class="pos-row" data-tip="${label}: ${split[pos]} pts, ${pct(split[pos] / total)} of the XI’s points"><span class="pos-label">${pos}</span><span class="pos-track"><i class="m${slotOf(id)}" style="width:${((split[pos] / top) * 100).toFixed(1)}%"></i></span><span class="pos-value">${split[pos]}</span></div>`,
  ).join('');
  return `<div class="pos-split">${rows}</div>`;
}

function positionCard(id: number) {
  const split = positionSplit(id);
  return split ? card({ title: 'Points by position', sub: 'In the XI this season', body: split }) : '';
}

// The draft picks still here, those gone and where to, and who has come in since.
function originalCard(id: number) {
  const r = D.draft.retention.find((x) => x.id === id);
  if (!r) return '';
  const chipOf = (pid: number, note = '') =>
    `<a class="pchip" href="${href.player(pid)}">${crest(player(pid).club, 14)}${esc(player(pid).name)}${note}</a>`;
  const where = (owner: number | null) => (owner ? avatar(owner) : tag('FA', 'A free agent now'));
  return card({
    title: 'Original squad',
    sub: `${r.kept.length} of ${r.size} draft picks still here · ${pct(r.originalShare)} of the XI’s points`,
    body: `<div class="squad-detail">
      <div><div class="squad-head">Still here · ${r.kept.length}</div><div class="pchips">${r.kept.map((pid) => chipOf(pid)).join('') || '<span class="muted">Nobody</span>'}</div></div>
      <div><div class="squad-head">Gone · ${r.gone.length}</div><div class="pchips">${r.gone.map((g) => chipOf(g.player, where(g.owner))).join('') || '<span class="muted">Nobody, yet</span>'}</div></div>
      <div><div class="squad-head">Signed since · ${r.newcomers.length}</div><div class="pchips">${r.newcomers.map((pid) => chipOf(pid)).join('') || '<span class="muted">Nobody</span>'}</div></div>
    </div>`,
  });
}

// As fotmob.com's Transfers tab: every move, or the players in or out, newest first.
function movesCard(id: number) {
  const moves = D.transfers.moves.filter((mv) => mv.manager === id);
  const dir = state.moves;
  const filter = seg(
    'moves',
    [
      ['all', 'All'],
      ['in', 'In'],
      ['out', 'Out'],
    ],
    dir,
  );
  const how = (mv: (typeof moves)[number]) => (mv.type === 'trade' ? `Trade with ${first(mv.partner)}` : MOVE_TYPES[mv.type]);
  const rows = moves.map((mv) => {
    const main = dir === 'out' ? mv.out : mv.in;
    const other = dir === 'out' ? mv.in : mv.out;
    const since = dir === 'out' ? mv.outPts : dir === 'in' ? mv.inPts : mv.net;
    const p = player(main);
    return listRow({
      lead: `<a href="${href.player(main)}">${photo(main)}</a>`,
      title: `<a href="${href.player(main)}">${esc(p.name)}</a> ${crest(p.club, 14)}`,
      meta: `${dir === 'out' ? 'Out, for' : dir === 'in' ? 'In, for' : 'For'} <a href="${href.player(other)}">${esc(player(other).name)}</a> · ${how(mv)} · GW ${mv.gw} · ${ago(mv.at)}`,
      value:
        since == null
          ? ''
          : `<span data-tip="${dir === 'all' ? 'Points since by the player in, less the player out' : `Points since by ${esc(p.name)}`}">${dir === 'all' ? signed(since) : since}</span>`,
    });
  });
  return card({
    title: 'Transfers',
    sub: plural(moves.length, 'move'),
    action: filter,
    body: rows.length ? `<div class="list">${rows.join('')}</div>` : empty('No transfers yet'),
  });
}

const OUTCOMES = {
  won: ['Won', ''],
  lost: ['Lost', 'Another manager with better waiver priority got him'],
  void: ['Void', 'The player in or out was gone by the time it came up'],
};

function claimsCard(id: number) {
  const claims = D.transfers.claims.filter((c) => c.manager === id).sort((a, b) => b.gw - a.gw);
  if (!claims.length) return '';
  const rows = claims.map((c) => {
    const [label, tip] = OUTCOMES[c.outcome];
    const lostTo = c.outcome === 'lost' && c.winner ? ` to ${first(c.winner)}` : '';
    return listRow({
      lead: `<a href="${href.player(c.in)}">${photo(c.in)}</a>`,
      title: `<a href="${href.player(c.in)}">${esc(player(c.in).name)}</a>`,
      meta: `For <a href="${href.player(c.out)}">${esc(player(c.out).name)}</a> · GW ${c.gw}${c.priority ? ` · priority ${c.priority}` : ''}`,
      value: tag(`${label}${lostTo}`, tip, c.outcome === 'won' ? 'tag-won' : ''),
    });
  });
  return card({
    title: 'Waiver claims',
    sub: `${claims.filter((c) => c.outcome === 'won').length} of ${claims.length} won`,
    body: `<div class="list">${rows.join('')}</div>`,
  });
}

function tradesCard(id: number) {
  const trades = D.transfers.trades.filter((t) => t.offeredBy === id || t.offeredTo === id);
  if (!trades.length) return '';
  const names = (ids: number[]) => ids.map((pid) => `<a href="${href.player(pid)}">${esc(player(pid).name)}</a>`).join(', ');
  const rows = trades.map((t) => {
    const other = t.offeredBy === id ? t.offeredTo : t.offeredBy;
    const gets = t.offeredBy === id ? t.items.map((i) => i.gets) : t.items.map((i) => i.gives);
    const gives = t.offeredBy === id ? t.items.map((i) => i.gives) : t.items.map((i) => i.gets);
    return listRow({
      lead: avatar(other, 32),
      title: `${t.offeredBy === id ? 'Offered to' : 'Offer from'} ${first(other)}`,
      meta: `Gets ${names(gets)} · gives ${names(gives)} · GW ${t.gw}`,
      value: tag(TRADE_STATES[t.state] ?? t.state),
    });
  });
  return card({ title: 'Trades', body: `<div class="list">${rows.join('')}</div>` });
}

// Who has scored the team's points: each player's points in its XI, with starts, goals and assists.
function scorersCard(id: number) {
  const rows = [...xiRecord(id)]
    .filter(([pid, r]) => player(pid) && r.pts)
    .sort((a, b) => b[1].pts - a[1].pts)
    .map(([pid, r], i) =>
      listRow({
        rank: i + 1,
        lead: `<a href="${href.player(pid)}">${photo(pid)}</a>`,
        title: `<a href="${href.player(pid)}">${esc(player(pid).name)}</a> ${crest(player(pid).club, 14)}`,
        meta: `${plural(r.starts, 'start')} · ${plural(r.goals, 'goal')} · ${plural(r.assists, 'assist')}`,
        value: r.pts,
        top: i === 0,
      }),
    );
  return card({
    title: 'Top scorers',
    sub: 'Points in the XI',
    body: rows.length ? `<div class="list">${rows.join('')}</div>` : empty('No points yet'),
  });
}

// The points each player has scored on the bench, and the automatic substitutions.
function benchCard(id: number) {
  const bench = new Map<number, { pts: number; weeks: number }>();
  let subs = 0;
  for (let gw = D.meta.firstGw; gw <= D.meta.currentGw; gw++) {
    const l = lineupFor(id, gw);
    subs += l?.subs.length ?? 0;
    for (const pid of l?.bench ?? []) {
      const b = bench.get(pid) ?? { pts: 0, weeks: 0 };
      b.pts += gwPoints(pid, gw);
      b.weeks++;
      bench.set(pid, b);
    }
  }
  const rows = [...bench]
    .filter(([pid, b]) => player(pid) && b.pts > 0)
    .sort((a, b) => b[1].pts - a[1].pts)
    .slice(0, 8)
    .map(([pid, b]) =>
      listRow({
        lead: `<a href="${href.player(pid)}">${photo(pid)}</a>`,
        title: `<a href="${href.player(pid)}">${esc(player(pid).name)}</a>`,
        meta: `${plural(b.weeks, 'week')} on the bench`,
        value: b.pts,
      }),
    );
  const total = sum([...bench.values()].map((b) => b.pts));
  return card({
    title: 'Left on the bench',
    sub: `${total} pts on the bench · ${plural(subs, 'automatic substitution')}`,
    body: rows.length ? `<div class="list">${rows.join('')}</div>` : empty('Nothing on the bench yet'),
  });
}
