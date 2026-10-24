// A player's page: everything the draft league has done with him, after fotmob.com's
// player pages. His season in numbers; one timeline of it all, the latest first: every
// gameweek he was in a squad (his match, his points, whether he started, sat on the bench
// or was swapped automatically), every claim, move and trade, each spell as a free agent
// in one line, and the draft; what he scored for each owner; his next matches; and the
// players most like him.

import type { Player, PlMatch } from '../../shared/data.ts';
import type { PlayerEvents } from '../../shared/live.ts';
import {
  avatar,
  card,
  crest,
  empty,
  listRow,
  photo,
  playerName,
  playerPhoto,
  ptsPill,
  tag,
  teamName,
  tile,
  xpPill,
} from '../components.ts';
import { eventRow } from '../event-icons.ts';
import { esc, fmtShortDay, ordinal, plural, sum } from '../format.ts';
import { club, first, isArchive, liveParts, liveXp, mgr, nextParts, nextXp, opponents, partsAt, player, xpAt } from '../lookups.ts';
import { projectedFor } from '../matches.ts';
import { playerHistory, type History, type StoryEvent, type Week } from '../player-history.ts';
import { clubMatches, lineEvents, linesIn, plState } from '../pl.ts';
import type { PageView } from '../render.ts';
import { href, type Route } from '../router.ts';
import { D } from '../state.ts';
import { TRADE_STATES } from '../views/transfers.ts';

const POSITIONS = { GKP: 'Goalkeeper', DEF: 'Defender', MID: 'Midfielder', FWD: 'Forward' };

export function pagePlayer(route: Route): PageView {
  const pid = route.id!;
  const p = player(pid);
  if (!p) return { title: 'Player', body: card({ body: empty('No such player this season') }) };
  const h = playerHistory(D, pid);
  const owner = p.owner
    ? `<a class="owner-chip" href="${href.team(p.owner)}">${avatar(p.owner, 24)}<span>${first(p.owner)}</span></a>`
    : tag('Free agent');
  const news = p.status !== 'a' ? `<div class="player-news">${tag('!', '', 'tag-flag')} ${esc(p.news || 'Flagged by FPL')}</div>` : '';
  return {
    title: p.name,
    header: {
      logo: photo(pid, 64),
      // Whose he is, beside his name.
      title: `<span>${esc(p.full)}</span>${owner}`,
      sub: `<a class="club-link" href="${href.pl('players', p.club)}">${crest(p.club, 16)} ${esc(club(p.club)?.name ?? '')}</a> · ${POSITIONS[p.pos]}`,
      cls: 'player-header',
    },
    body: `${news}<div class="cols">
      <div class="col">${seasonCard(pid, p)}${timelineCard(pid, p, h)}</div>
      <div class="col">${ownersCard(h)}${draftCard(h)}${nextCard(pid, p)}${similarCard(pid, p)}</div>
    </div>`,
  };
}

// His season so far, as fotmob.com's season stats: points, goals and assists, each over
// what was expected of them, and his minutes.
function seasonCard(pid: number, p: Player) {
  const lines = D.gameweeks.filter((g) => g.id <= D.meta.currentGw).flatMap((g) => linesIn(pid, g.id));
  const did = (key: keyof PlayerEvents) => sum(lines.map(({ m }) => m.events?.[pid]?.[key] ?? 0));
  const minutes = sum(lines.map(({ line }) => line[1]));
  const [xg, xa, xp] = p.xs ?? [0, 0, 0];
  const tiles = [
    tile('Points', p.total, `${xp.toFixed(1)} xP`, 'Expected points, from his xG, xA and xGC'),
    tile('Goals', did('goals'), `${xg.toFixed(2)} xG`),
    tile('Assists', did('assists'), `${xa.toFixed(2)} xA`),
    tile('Minutes', minutes, `${plural(lines.length, 'match', 'matches')}, ${plural(lines.filter(({ line }) => line[3]).length, 'start')}`),
  ];
  return card({ title: `Premier League ${D.meta.season}`, body: `<div class="tiles tiles-row">${tiles.join('')}</div>` });
}

// --- The timeline --------------------------------------------------------------------

const playerLink = (pid: number) => `<a href="${href.player(pid)}">${esc(player(pid)?.name ?? '?')}</a>`;
const teamLink = (id: number) => `<a href="${href.team(id)}">${first(id)}</a>`;
const names = (ids: number[]) => ids.map(playerLink).join(', ');

// A claim that didn't go through: the player it was for had gone to a manager ahead in the
// waiver order, or it was void.
const missedOut = (winner: number | null, manager: number, who: string) =>
  winner && winner !== manager ? `but ${who} had already signed for ${teamLink(winner)}` : 'but it didn’t go through';

function eventText(e: StoryEvent, name: string) {
  switch (e.kind) {
    case 'claim':
      return `${teamLink(e.manager)} tried to swap ${playerLink(e.out)} for ${name} on waivers, ${e.instead ? `but he signed ${playerLink(e.instead)} instead` : missedOut(e.winner, e.manager, 'he')}`;
    case 'kept':
      return `${teamLink(e.manager)} tried to swap ${name} for ${playerLink(e.instead)} on waivers, ${missedOut(e.winner, e.manager, playerLink(e.instead))}`;
    case 'signed':
      return `${teamLink(e.manager)} signed ${name} ${e.type === 'waiver' ? 'on waivers' : 'as a free agent'}, dropping ${playerLink(e.out)}`;
    case 'dropped':
      return `${teamLink(e.manager)} dropped ${name} for ${e.type === 'free' ? 'free agent ' : ''}${playerLink(e.in)}${e.type === 'waiver' ? ' on waivers' : ''}`;
    case 'traded':
      return `${teamLink(e.from)} traded ${name} to ${teamLink(e.to)} for ${names(e.for)}`;
    case 'offer':
      return `${teamLink(e.by)} offered ${e.wanted ? `${names(e.for)} to ${teamLink(e.to)} for ${name}` : `${name} to ${teamLink(e.to)} for ${names(e.for)}`}: ${(TRADE_STATES[e.state] ?? e.state).toLowerCase()}`;
    // Told by his gameweek's row instead.
    case 'subOn':
    case 'subOff':
      return '';
  }
}

const KINDS: Record<StoryEvent['kind'], string> = {
  claim: 'claim',
  kept: 'kept',
  signed: 'in',
  dropped: 'out',
  traded: 'trade',
  offer: 'trade',
  subOn: 'in',
  subOff: 'out',
};

const ROLES = { xi: 'In starting XI', bench: 'Bench', on: 'Came on', off: 'Didn’t play', free: '' };

// The latest first: gameweek by gameweek his week while he was in a squad and his moves
// (made before its deadline), down to the draft. A spell as a free agent is one line.
function timelineCard(pid: number, p: Player, h: History) {
  const name = esc(p.name);
  const events = h.spells.flatMap((s) => s.events);
  const subOf = (gw: number) => events.find((e) => e.gw === gw && (e.kind === 'subOn' || e.kind === 'subOff'));
  const items: { gw: number; order: number; html: string }[] = [];
  items.push({
    gw: h.added ?? D.meta.firstGw,
    order: -1,
    html: h.pick
      ? row(
          'Draft',
          'in',
          `${h.pick.auto ? 'Auto-picked' : 'Drafted'} by ${teamLink(h.pick.manager)}: round ${h.pick.round}, ${ordinal(h.pick.overall)} pick overall`,
          avatar(h.pick.manager, 24),
        )
      : h.added !== undefined
        ? row(`GW ${h.added}`, '', '<span class="muted">Added to FPL after the draft</span>')
        : row('Draft', '', '<span class="muted">Not drafted</span>'),
  });
  for (const e of events) {
    const text = eventText(e, name);
    if (text) items.push({ gw: e.gw, order: 0, html: row(`GW ${e.gw}`, KINDS[e.kind], text) });
  }
  for (const s of h.spells) {
    if (s.owner === null) {
      if (!s.weeks.length) continue;
      const unclaimed = s.weeks.filter((w) => !w.claims).length;
      const pts = sum(s.weeks.map((w) => w.pts));
      const range = s.weeks.length > 1 ? `GW ${s.from}–${s.weeks.at(-1)!.gw}` : `GW ${s.from}`;
      const text = `A free agent for ${plural(s.weeks.length, 'gameweek')}, ${unclaimed === s.weeks.length ? 'unclaimed throughout' : `unclaimed in ${unclaimed}`} · ${plural(pts, 'point')}`;
      items.push({ gw: s.from, order: 1, html: row(range, 'free', `<span class="muted">${text}</span>`) });
      continue;
    }
    for (const w of s.weeks) items.push({ gw: w.gw, order: 1, html: weekRow(pid, p, w, subOf(w.gw)) });
  }
  items.sort((a, b) => b.gw - a.gw || b.order - a.order); // the latest first
  return card({ title: 'Timeline', sub: storyLine(h), body: `<div class="tl">${items.map((i) => i.html).join('')}</div>` });
}

const row = (label: string, kind: string, text: string, side = '') =>
  `<div class="tl-row tl-event${kind ? ` ev-${kind}` : ''}"><span class="tl-gw">${label}</span><span class="tl-text">${text}</span><span class="tl-pts"></span><span class="tl-who">${side}</span></div>`;

// A gameweek in a squad: where he was picked, his match and what he did, his points (or,
// before his match, his expected points) and whose squad.
function weekRow(pid: number, p: Player, w: Week, sub: StoryEvent | undefined) {
  const lines = linesIn(pid, w.gw);
  const matches = lines.length
    ? lines.map((l) => ({ m: l.m, home: l.home }))
    : clubMatches(p.club, w.gw).map((m) => ({ m, home: m.home === p.club }));
  const opp = matches
    .map(({ m, home }) => {
      const s = plState(m);
      const [gf, ga] = home ? (s.score ?? [0, 0]) : [s.score?.[1] ?? 0, s.score?.[0] ?? 0];
      const score = s.state === 'due' ? '' : `<span class="livep ${gf > ga ? 'W' : gf < ga ? 'L' : 'D'}">${gf}-${ga}</span>`;
      return `<a class="ml-match" href="${href.plMatch(m.id)}">${crest(home ? m.away : m.home, 16)}<span>${esc(club(home ? m.away : m.home)?.short ?? '?')} <span class="muted">(${home ? 'H' : 'A'})</span></span>${score}</a>`;
    })
    .join('');
  const minutes = sum(lines.map((l) => l.line[1]));
  const events = addEvents(lines.map((l) => lineEvents(l.m, l.line)));
  const swap =
    sub?.kind === 'subOn' && sub.for
      ? ` <span class="muted">for ${playerLink(sub.for)}</span>`
      : sub?.kind === 'subOff'
        ? ` <span class="muted">${playerLink(sub.by)} came on</span>`
        : '';
  const role = `<span class="tl-role ${w.counted ? 'counted' : ''}">${ROLES[w.auto ?? w.role]}</span>${swap}`;
  const bonus = lines.reduce((t, l) => t + (l.m.events?.[pid]?.bonus ?? 0), 0);
  const pts = pointsFor(
    pid,
    w.pts,
    matches.map(({ m }) => m),
    bonus,
  );
  // The points open the owner's head-to-head that gameweek, the avatar his team.
  const h2h = D.matches.find((x) => x.gw === w.gw && (x.home === w.owner || x.away === w.owner));
  const versus = h2h && `${mgr(h2h.home)?.first} v ${mgr(h2h.away)?.first}, gameweek ${w.gw}`;
  return `<div class="tl-row tl-week${w.counted ? '' : ' benched'}">
    <span class="tl-gw">GW ${w.gw}</span>
    <span class="tl-main"><span class="tl-line">${role}</span><span class="tl-line">${opp || '<span class="muted">No match</span>'}${minutes ? `<span class="muted">${minutes}’</span>` : ''}${eventRow(events)}</span></span>
    <span class="tl-pts">${h2h ? `<a href="${href.match(h2h)}" aria-label="${esc(versus)}">${pts}</a>` : pts}</span>
    <span class="tl-who">${w.owner ? `<a href="${href.team(w.owner)}">${avatar(w.owner, 24)}</a>` : ''}</span>
  </div>`;
}

// A gameweek's points, or before his match the expected points (as everywhere a player
// is still to play).
function pointsFor(pid: number, pts: number, matches: PlMatch[], bonus: number) {
  const due = pts === 0 && matches.length > 0 && matches.every((m) => plState(m).state === 'due') && matches[0].gw === D.meta.currentGw;
  return due
    ? xpPill(liveXp(pid), liveParts(pid), opponents(player(pid).club, matches[0].gw), ' (not played yet)')
    : ptsPill(pts, bonus, { projected: projectedFor(pid, matches[0]?.gw) });
}

// A double gameweek's two matches as one: what he did in both.
function addEvents(all: (PlayerEvents | undefined)[]): PlayerEvents {
  const total: Record<string, number> = {};
  for (const ev of all) for (const [key, n] of Object.entries(ev ?? {})) total[key] = (total[key] ?? 0) + n;
  return total;
}

// The card's one-line summary: how long owned, and how long nobody wanted him.
function storyLine(h: History) {
  const owned = h.weeks.length - h.free.weeks;
  return [owned && `${plural(owned, 'gameweek')} in a squad`, h.free.weeks && `${plural(h.free.unclaimed, 'gameweek')} unwanted`]
    .filter(Boolean)
    .join(' · ');
}

// --- Beside it ---------------------------------------------------------------------------

// What he has scored for each owner, and as a free agent.
function ownersCard(h: History) {
  const rows = h.owners.map((o) =>
    listRow({
      lead: avatar(o.owner, 32),
      title: teamLink(o.owner),
      meta: `${plural(o.weeks, 'gameweek')} · ${o.starts} in the XI · ${o.benchPts} pts on the bench`,
      value: o.xiPts,
    }),
  );
  if (h.free.weeks)
    rows.push(
      listRow({
        lead: '<span class="av av-32 m0"></span>',
        title: 'Free agent',
        meta: `${plural(h.free.weeks, 'gameweek')} · unclaimed in ${h.free.unclaimed}`,
        value: h.free.pts,
      }),
    );
  return card({
    title: 'Points for each owner',
    body: rows.length ? `<div class="list">${rows.join('')}</div>` : empty('Not played yet'),
  });
}

function draftCard(h: History) {
  const events = h.spells.flatMap((s) => s.events);
  const count = (kind: StoryEvent['kind']) => events.filter((e) => e.kind === kind).length;
  const tiles = [
    tile(
      'Drafted',
      h.pick ? `#${h.pick.overall}` : '–',
      h.pick
        ? `Round ${h.pick.round}, by ${first(h.pick.manager)}`
        : h.added !== undefined
          ? `Added after it, in GW ${h.added}`
          : 'Not drafted',
    ),
    tile('Waiver claims', h.claims.length, plural(new Set(h.claims.map((c) => c.gw)).size, 'waiver run')),
    tile('Dropped', count('dropped'), count('kept') ? `Nearly ${plural(count('kept'), 'more time', 'more times')}` : 'Times let go'),
    tile('Automatic subs', count('subOn'), 'Came on from a bench'),
  ];
  return card({ title: 'In the draft', body: `<div class="tiles">${tiles.join('')}</div>` });
}

// His next three gameweeks: who against, and the expected points, where the model has them.
function nextCard(pid: number, p: Player) {
  if (isArchive() || D.meta.nextGw > D.meta.lastGw) return '';
  const gws = [0, 1, 2].map((i) => D.meta.nextGw + i).filter((gw) => gw <= D.meta.lastGw);
  const rows = gws.map((gw) => {
    const against = opponents(p.club, gw) || 'No match';
    const xp =
      gw === D.meta.nextGw ? xpPill(nextXp(pid), nextParts(pid), against) : p.ahead ? xpPill(xpAt(pid, gw), partsAt(pid, gw), against) : '';
    const deadline = D.gameweeks.find((g) => g.id === gw)?.deadline;
    return listRow({
      title: `Gameweek ${gw}`,
      meta: `${esc(against)}${deadline ? ` · ${fmtShortDay.format(new Date(deadline))}` : ''}`,
      value: xp,
    });
  });
  return card({
    title: 'Next matches',
    sub: mgr(p.owner) ? 'With expected points' : 'Expected points for the next gameweek',
    body: `<div class="list">${rows.join('')}</div>`,
  });
}

// The players most like him: his position, the nearest on season points and on expected
// points for the next gameweek, with who has them (a free agent is a waiver to think about).
function similarCard(pid: number, p: Player) {
  const most = Math.max(1, ...Object.values(D.players).map((x) => x.total));
  const distance = (x: Player) => Math.abs(x.total - p.total) / most + Math.abs(x.ep - p.ep) / 10;
  const rows = Object.entries(D.players)
    .filter(([id, x]) => Number(id) !== pid && x.pos === p.pos && (x.total > 0 || x.ep > 0))
    .sort((a, b) => distance(a[1]) - distance(b[1]))
    .slice(0, 5)
    .map(([id, x]) =>
      listRow({
        lead: playerPhoto(Number(id)),
        title: `${playerName(Number(id))} ${crest(x.club, 14)}`,
        meta: `${x.total} pts · ${x.ep.toFixed(1)} xP next · ${x.owner ? `with ${teamName(x.owner)}` : 'free agent'}`,
        value: x.owner ? avatar(x.owner, 24) : tag('FA', 'A free agent'),
      }),
    );
  return card({
    title: 'Similar players',
    sub: `${POSITIONS[p.pos]}s on about the same points`,
    body: `<div class="list">${rows.join('')}</div>`,
  });
}
