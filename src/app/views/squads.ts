// The Squads tab: one manager at a time. Their table numbers and next match, the squad
// (or everyone they've owned) with this round's points, the next round's expected
// points and what each player has scored for them, and how they've fared against
// everyone else.

import { bestXi } from '../../shared/best-xi.ts';
import type { Position } from '../../shared/data.ts';
import { clubState } from '../../shared/live.ts';
import { avatar, card, chip, crest, empty, formPills, listRow, photo, pointsTier, seg, tag, tile } from '../components.ts';
import { esc, ordinal, pct, plural, signed, sum } from '../format.ts';
import { club, first, gwPoints, isArchive, lineupFor, mgr, player, seasonStat, slotOf } from '../lookups.ts';
import { closeCalls, gameIn, nemesis, pointsByPosition, rivalries, type Rivalry } from '../manager-stats.ts';
import { arrowSvg } from '../icons.ts';
import { roundPill, stateLabel } from '../matches.ts';
import { formationOf, pitch, type PitchPlayer } from '../pitch.ts';
import { D, live, state } from '../state.ts';

const GROUPS: [Position, string][] = [
  ['GKP', 'Goalkeepers'],
  ['DEF', 'Defenders'],
  ['MID', 'Midfielders'],
  ['FWD', 'Forwards'],
];

// The manager picked, or the league leader.
export function squadManager() {
  return mgr(state.squadId) ? (state.squadId as number) : (D.tables.overall[0]?.id ?? D.managers[0].id);
}

export function viewSquads() {
  const id = squadManager();
  const order = D.tables.overall.length ? D.tables.overall.map((r) => r.id) : D.managers.map((m) => m.id);
  const chips = order.map((m) => chip(`${avatar(m)}${first(m)}`, 'squads', m, m === id)).join('');
  return `${card({ body: `<div class="filter-bar">${chips}</div>`, cls: 'filter-card' })}
  <div class="cols">
    <div class="col">${teamCard(id)}${squadCard(id)}</div>
    <div class="col">${lineupCard(id)}${rivalsCard(id)}${seasonCard(id)}</div>
  </div>`;
}

const who = (id: number) => `<span class="tile-who">${avatar(id, 24)}<span class="tile-name">${first(id)}</span></span>`;
const playerWho = (pid: number) => `<span class="tile-who">${photo(pid, 28)}<span class="tile-name">${esc(player(pid).name)}</span></span>`;
const record = (r: Rivalry) => `W${r.won} D${r.drawn} L${r.lost} · ${r.pf}-${r.pa}`;

function teamCard(id: number) {
  const row = D.tables.overall.find((r) => r.id === id);
  const header = `<div class="team-head">${avatar(id, 48)}<div class="card-heading"><h2 class="team-name">${first(id)}</h2><div class="card-sub">${esc(mgr(id)!.team)}</div></div></div>`;
  if (!row) return card({ header, body: '', cls: 'team-card' });
  const rank = `<div class="team-rank"><strong>${ordinal(row.rank)}</strong>of ${D.managers.length}</div>`;
  const tiles = [
    tile('Points', row.pts, `W${row.won} D${row.drawn} L${row.lost}`),
    tile('Scored', row.pf, `${seasonStat(id)?.avg ?? 0} a week · ${row.pa} against`),
    row.form.length ? tile('Form', formPills(row.form), `Last ${plural(row.form.length, 'match', 'matches')}`) : '',
    nextTile(id),
  ];
  return card({ header, action: rank, body: `<div class="tiles">${tiles.join('')}</div>`, cls: 'team-card' });
}

// The match being played, or the next one; it opens on the Fixtures tab.
function nextTile(id: number) {
  const m = D.matches.find((x) => !x.finished && (x.home === id || x.away === id));
  if (!m) return '';
  const home = m.home === id;
  const opp = home ? m.away : m.home;
  const open = `data-action="match" data-value="${m.gw}" data-a="${opp}" data-go="1"`;
  const [label, value, meta] = m.started
    ? ['Live now', home ? `${m.homePts}-${m.awayPts}` : `${m.awayPts}-${m.homePts}`, `vs ${first(opp)} · GW ${m.gw}`]
    : [`GW ${m.gw}`, who(opp), m.odds ? `${pct(m.odds.p[home ? 0 : 2])} to win` : 'Odds three gameweeks out'];
  return `<button type="button" class="tile tile-link" ${open}><div class="tile-label">${label}</div><div class="tile-value">${value}</div><div class="tile-meta">${meta}</div></button>`;
}

const squadOf = (id: number) =>
  Object.keys(D.players)
    .map(Number)
    .filter((pid) => player(pid).owner === id);

// What each player has scored for this manager: points and starts in their XI, the
// gameweek being played included.
function xiRecord(id: number) {
  const record = new Map<number, { pts: number; starts: number }>();
  for (let gw = D.meta.firstGw; gw <= D.meta.currentGw; gw++) {
    for (const pid of lineupFor(id, gw)?.xi ?? []) {
      const r = record.get(pid) ?? { pts: 0, starts: 0 };
      record.set(pid, { pts: r.pts + gwPoints(pid, gw), starts: r.starts + 1 });
    }
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
    const match = feed ? clubState(feed, player(pid).club) : null;
    return {
      pid,
      badge: roundPill(pid, gw, match),
      left: l.subs.includes(pid) ? `<span class="pp-sub" data-tip="Came on as an automatic substitute">${arrowSvg}</span>` : '',
      right: match?.state === 'live' ? stateLabel(match) : '',
    };
  };
  return {
    sub: `GW ${gw} · ${plural(l.pts, 'pt')}${feed ? ' so far' : ''} · ${formationOf(l.xi)}`,
    body: pitch(l.xi.map(onPitch), l.bench.map(onPitch)),
  };
}

function bestLineup(id: number) {
  const record = xiRecord(id);
  const squad = squadOf(id);
  const owned = new Set(squad);
  const scored = (pid: number) => record.get(pid)?.pts ?? 0;
  const xi = bestXi(everOwned(id, squad), scored, (pid) => player(pid).pos, D.meta.xiLimits);
  if (!xi.ids.length) return { sub: '', body: empty('No points yet') };
  const onPitch = (pid: number): PitchPlayer => {
    const { pts, starts } = record.get(pid)!;
    const owner = player(pid).owner;
    const now = owned.has(pid) ? '' : owner ? ` · now with ${mgr(owner)?.first}` : ' · a free agent now';
    return {
      pid,
      // Coloured by points per start, as the round's points are.
      badge: `<span class="ptsp ${pointsTier(pts / starts)}">${pts}</span>`,
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

  // Grouped by position in lineup order, or one list sorted on a column, highest first,
  // with each player's position as a chip. Tapping the column again, or Position, groups
  // them again.
  const columns = [
    l && {
      key: 'gw',
      label: `GW${gw}`,
      tip: `Points in GW ${gw}${feed ? ', live' : ''}`,
      value: (pid: number) => (role(pid) === 'out' ? -1 : gwPoints(pid, gw)),
    },
    showXp && {
      key: 'xp',
      label: 'xP',
      tip: `FPL’s expected points for GW ${nextGw}`,
      value: (pid: number) => (owned.has(pid) ? player(pid).ep : -1),
    },
    { key: 'total', label: 'Total', tip: `Points in ${mgr(id)!.first}’s XI this season`, value: total },
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
    const match = feed && r !== 'out' ? clubState(feed, p.club) : null;
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
    const position = sorted ? `<span class="pos-tag pos-${p.pos}">${p.pos}</span>` : '';
    const meta = [`${position}${crest(p.club, 14)}${esc(club(p.club).short)}`, note].filter(Boolean).join(' · ');
    const flag = owned.has(pid) && p.status !== 'a' ? tag('!', p.news || 'Flagged', 'tag-flag') : '';
    const dash = '<span class="muted">–</span>';
    const gwCell = l ? `<span class="sq-num sq-gw">${r === 'out' ? dash : roundPill(pid, gw, match)}</span>` : '';
    const xpCell = showXp ? `<span class="sq-num">${owned.has(pid) ? `<span class="ptsp xp">${p.ep.toFixed(1)}</span>` : dash}</span>` : '';
    return `<div class="sq-row${r === 'bench' ? ' benched' : ''}${owned.has(pid) ? '' : ' gone'}">
      ${photo(pid, 32)}
      <div class="sq-main"><div class="sq-name"><span>${esc(p.name)}</span>${flag}${match ? stateLabel(match) : ''}</div><div class="sq-meta">${meta}</div></div>
      ${gwCell}${xpCell}<span class="sq-num sq-total">${total(pid)}</span>
    </div>`;
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
  return card({ title: 'Season', body: `<div class="tiles">${tiles.join('')}</div>${positionSplit(id)}` });
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
  return `<div class="date-head"><span>Points by position</span></div><div class="pos-split">${rows}</div>`;
}
