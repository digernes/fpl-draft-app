// A player's page: everything the draft league has done with him, after fotmob.com's
// player pages. The header in his owner's colour (as fotmob.com's is in his club's), with
// his facts under it and his position on a pitch. His season in numbers; one timeline of it all, the latest first: every
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
  cutout,
  empty,
  listRow,
  playerName,
  playerPhoto,
  ptsPill,
  tag,
  teamName,
  tile,
  xpPill,
} from '../components.ts';
import { eventRow } from '../event-icons.ts';
import { esc, fmtDate, fmtShortDay, ordinal, plural, sum } from '../format.ts';
import { club, first, isArchive, liveParts, liveXp, mgr, nextParts, nextXp, opponents, partsAt, player, slotOf, xpAt } from '../lookups.ts';
import { projectedPill } from '../match-odds.ts';
import { playerHistory, type History, type Spell, type StoryEvent, type Week } from '../player-history.ts';
import { clubMatches, lineEvents, linesIn, plState } from '../pl.ts';
import { pointsFrom, pointsRows } from '../stats-files.ts';
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
  // Whose he is, where fotmob.com has its Follow button.
  const owner = p.owner
    ? `<a class="owner-chip" href="${href.team(p.owner)}">${avatar(p.owner, 24)}<span>${first(p.owner)}</span></a>`
    : '<span class="owner-chip free">Free agent</span>';
  const news = p.status !== 'a' ? `<div class="player-news">${tag('!', '', 'tag-flag')} ${esc(p.news || 'Flagged by FPL')}</div>` : '';
  return {
    title: p.name,
    header: {
      logo: cutout(pid),
      title: esc(p.full),
      // His club, and the draft team he's in.
      sub: `<a class="club-link" href="${href.pl('players', p.club)}">${crest(p.club, 20)} ${esc(club(p.club)?.name ?? '')}</a>${
        mgr(p.owner) ? `<a class="club-link" href="${href.team(p.owner!)}">${avatar(p.owner, 18)} ${esc(mgr(p.owner)!.team)}</a>` : ''
      }`,
      side: owner,
      foot: bio(p, h),
      cls: `player-header m${mgr(p.owner) ? slotOf(p.owner!) : 0}`,
    },
    body: `${news}<div class="cols">
      <div class="col">${seasonCard(pid, p)}${timelineCard(pid, p, h)}</div>
      <div class="col">${ownersCard(h)}${draftCard(h)}${nextCard(pid, p)}${similarCard(pid, p)}</div>
    </div>`,
  };
}

// --- His facts, under the header ----------------------------------------------------------

// As fotmob.com's: a value over what it is, two to a row, and beside them his position on a
// pitch. What FPL doesn't have (an archived season's players have none of it) is left out.
function bio(p: Player, h: History) {
  const fact = (value: string, label: string) =>
    `<div class="bio-fact"><div class="bio-value">${value}</div><div class="bio-label">${label}</div></div>`;
  const facts = [
    p.born && fact(`${yearsOld(p.born)} years`, fmtDate.format(dateOf(p.born))),
    p.nation && fact(`${flag(p.nation[1])}${esc(p.nation[0])}`, 'Country'),
    p.joined && fact(fmtDate.format(dateOf(p.joined)), `Joined ${esc(club(p.club)?.name ?? 'his club')}`),
    ownerFact(p, h, fact),
  ].filter(Boolean);
  return `<div class="player-bio">
    <div class="bio-facts">${facts.join('')}</div>
    <div class="bio-position">
      <div class="bio-position-text"><div class="bio-heading">Position</div><div class="bio-label">Primary</div><div class="bio-value">${POSITIONS[p.pos]}</div></div>
      ${positionPitch(p.pos)}
    </div>
  </div>`;
}

// Whose he is and since when: the draft, or the gameweek he was signed or let go. Moves
// still to come split a spell, so it starts at the first of the owner's in a row.
function ownerFact(p: Player, h: History, fact: (value: string, label: string) => string) {
  let i = h.spells.length - 1;
  while (i > 0 && h.spells[i - 1].owner === p.owner) i--;
  const never = !p.owner && !h.pick && h.spells.every((s) => s.owner === null);
  const drafted = p.owner && i === 0 && h.pick?.manager === p.owner;
  const since = never ? 'Never in a squad' : drafted ? 'Since the draft' : h.spells[i] ? `Since gameweek ${h.spells[i].from}` : 'Owner';
  if (!p.owner) return fact('Free agent', since);
  return fact(`<a href="${href.team(p.owner)}">${avatar(p.owner, 18)}${esc(mgr(p.owner)!.team)}</a>`, since);
}

// The FPL position's place on a pitch, attacking upwards, as fotmob.com marks his.
const SPOTS = { GKP: ['GK', 88], DEF: ['DEF', 70], MID: ['MID', 47], FWD: ['FWD', 18] } as const;

function positionPitch(pos: Player['pos']) {
  const [label, y] = SPOTS[pos];
  return `<div class="bio-pitch" role="img" aria-label="${POSITIONS[pos]}">
    <svg viewBox="0 0 136 184" aria-hidden="true"><rect x="0.5" y="0.5" width="135" height="183" rx="6"/><path d="M0.5 92H135.5M38 0.5V26H98V0.5M38 183.5V158H98V183.5M54 0.5V9H82V0.5M54 183.5V175H82V183.5"/><circle cx="68" cy="92" r="16"/></svg>
    <span class="bio-spot" style="top:${y}%">${label}</span>
  </div>`;
}

// Dates FPL gives as YYYY-MM-DD, at noon UTC so no time zone moves them a day.
const dateOf = (day: string) => new Date(`${day}T12:00:00Z`);

export function yearsOld(born: string, now = new Date()) {
  const b = dateOf(born);
  const birthday = now.getUTCMonth() > b.getUTCMonth() || (now.getUTCMonth() === b.getUTCMonth() && now.getUTCDate() >= b.getUTCDate());
  return now.getUTCFullYear() - b.getUTCFullYear() - (birthday ? 0 : 1);
}

// A country's flag from its code: two regional-indicator letters, or for England, Scotland
// and Wales their own (FPL's EN, S1 and WA). Northern Ireland has none.
const HOME_NATIONS: Record<string, string> = { EN: 'eng', S1: 'sct', WA: 'wls' };

export function flag(code: string) {
  const nation = HOME_NATIONS[code];
  const emoji = nation
    ? String.fromCodePoint(0x1f3f4, ...[...`gb${nation}`].map((c) => 0xe0000 + c.charCodeAt(0)), 0xe007f)
    : /^[A-Z]{2}$/.test(code) && code !== 'NN'
      ? String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0)))
      : '';
  return emoji ? `<span class="flag" aria-hidden="true">${emoji}</span>` : '';
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
    case 'tried':
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
  tried: 'kept',
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
  const events = h.spells.flatMap((s) => s.events);
  const items = [draftItem(h), ...eventItems(events, esc(p.name)), ...h.spells.flatMap((s) => spellItems(pid, p, s, events))];
  items.sort((a, b) => b.gw - a.gw || b.order - a.order); // the latest first
  return card({ title: 'Timeline', sub: storyLine(h), body: `<div class="tl">${items.map((i) => i.html).join('')}</div>` });
}

interface Item {
  gw: number;
  order: number;
  html: string;
}

// Where his story starts: the draft, or the gameweek FPL added him.
function draftItem(h: History): Item {
  return { gw: h.added ?? D.meta.firstGw, order: -1, html: draftRow(h) };
}

function draftRow(h: History) {
  if (h.pick) {
    const { auto, manager, round, overall } = h.pick;
    const text = `${auto ? 'Auto-picked' : 'Drafted'} by ${teamLink(manager)}: round ${round}, ${ordinal(overall)} pick overall`;
    return row('Draft', 'in', text, avatar(manager, 24));
  }
  if (h.added !== undefined) return row(`GW ${h.added}`, '', '<span class="muted">Added to FPL after the draft</span>');
  return row('Draft', '', '<span class="muted">Not drafted</span>');
}

// Backwards, so a gameweek's own events come the latest first too: the sort keeps their order.
function eventItems(events: StoryEvent[], name: string): Item[] {
  return [...events].reverse().flatMap((e) => {
    const text = eventText(e, name);
    return text ? [{ gw: e.gw, order: 0, html: row(`GW ${e.gw}`, KINDS[e.kind], text) }] : [];
  });
}

// Each gameweek of a spell in a squad, or a spell as a free agent in one line.
function spellItems(pid: number, p: Player, s: Spell, events: StoryEvent[]): Item[] {
  if (s.owner !== null) return s.weeks.map((w) => ({ gw: w.gw, order: 1, html: weekRow(pid, p, w, subIn(events, w.gw)) }));
  return s.weeks.length ? [freeItem(s)] : [];
}

const subIn = (events: StoryEvent[], gw: number) => events.find((e) => e.gw === gw && (e.kind === 'subOn' || e.kind === 'subOff'));

function freeItem(s: Spell): Item {
  const weeks = s.weeks.length;
  const unclaimed = s.weeks.filter((w) => !w.claims).length;
  const pts = sum(s.weeks.map((w) => w.pts));
  const range = weeks > 1 ? `GW ${s.from}–${s.weeks.at(-1)!.gw}` : `GW ${s.from}`;
  const text = `A free agent for ${plural(weeks, 'gameweek')}, ${unclaimed === weeks ? 'unclaimed throughout' : `unclaimed in ${unclaimed}`} · ${plural(pts, 'point')}`;
  return { gw: s.from, order: 1, html: row(range, 'free', `<span class="muted">${text}</span>`) };
}

const row = (label: string, kind: string, text: string, side = '') =>
  `<div class="tl-row tl-event${kind ? ` ev-${kind}` : ''}"><span class="tl-gw">${label}</span><span class="tl-text">${text}</span><span class="tl-pts"></span><span class="tl-who">${side}</span></div>`;

type Lines = ReturnType<typeof linesIn>;
type Fixture = { m: PlMatch; home: boolean };

// A gameweek in a squad: where he was picked, his match and what he did, his points (or,
// before his match, his expected points) and whose squad.
function weekRow(pid: number, p: Player, w: Week, sub: StoryEvent | undefined) {
  const lines = linesIn(pid, w.gw);
  const matches = lines.length
    ? lines.map((l) => ({ m: l.m, home: l.home }))
    : clubMatches(p.club, w.gw).map((m) => ({ m, home: m.home === p.club }));
  const role = `<span class="tl-role ${w.counted ? 'counted' : ''}">${ROLES[w.auto ?? w.role]}</span>${swapNote(sub)}`;
  // The points open the owner's head-to-head that gameweek, the avatar his team.
  return `<div class="tl-row tl-week${w.counted ? '' : ' benched'}">
    <span class="tl-gw">GW ${w.gw}</span>
    <span class="tl-main"><span class="tl-line">${role}</span><span class="tl-line">${matchLine(lines, matches)}</span></span>
    <span class="tl-pts">${weekPoints(pid, w, lines, matches)}</span>
    <span class="tl-who">${w.owner ? `<a href="${href.team(w.owner)}">${avatar(w.owner, 24)}</a>` : ''}</span>
  </div>`;
}

// Who he came on for, or who came on for him.
function swapNote(sub: StoryEvent | undefined) {
  if (sub?.kind === 'subOn' && sub.for) return ` <span class="muted">for ${playerLink(sub.for)}</span>`;
  if (sub?.kind === 'subOff') return ` <span class="muted">${playerLink(sub.by)} came on</span>`;
  return '';
}

// His match (both, in a double gameweek), his minutes and what he did.
function matchLine(lines: Lines, matches: Fixture[]) {
  const opp = matches.map(matchLink).join('');
  const minutes = sum(lines.map((l) => l.line[1]));
  const events = addEvents(lines.map((l) => lineEvents(l.m, l.line)));
  return `${opp || '<span class="muted">No match</span>'}${minutes ? `<span class="muted">${minutes}’</span>` : ''}${eventRow(events)}`;
}

function matchLink({ m, home }: Fixture) {
  const opp = home ? m.away : m.home;
  return `<a class="ml-match" href="${href.plMatch(m.id)}">${crest(opp, 16)}<span>${esc(club(opp)?.short ?? '?')} <span class="muted">(${home ? 'H' : 'A'})</span></span>${matchScore(m, home)}</a>`;
}

// The score from his side, once the match has started.
function matchScore(m: PlMatch, home: boolean) {
  const s = plState(m);
  if (s.state === 'due') return '';
  const [gf, ga] = home ? (s.score ?? [0, 0]) : [s.score?.[1] ?? 0, s.score?.[0] ?? 0];
  return `<span class="livep ${gf > ga ? 'W' : gf < ga ? 'L' : 'D'}">${gf}-${ga}</span>`;
}

function weekPoints(pid: number, w: Week, lines: Lines, matches: Fixture[]) {
  const bonus = lines.reduce((t, l) => t + (l.m.events?.[pid]?.bonus ?? 0), 0);
  const pts = pointsFor(
    pid,
    w.pts,
    matches.map(({ m }) => m),
    bonus,
  );
  const h2h = D.matches.find((x) => x.gw === w.gw && (x.home === w.owner || x.away === w.owner));
  if (!h2h) return pts;
  const versus = `${mgr(h2h.home)?.first} v ${mgr(h2h.away)?.first}, gameweek ${w.gw}`;
  return `<a href="${href.match(h2h)}" aria-label="${esc(versus)}">${pts}</a>`;
}

// A gameweek's points, or before his match the expected points (as everywhere a player
// is still to play).
function pointsFor(pid: number, pts: number, matches: PlMatch[], bonus: number) {
  const due = pts === 0 && stillToPlay(matches);
  return due
    ? xpPill(liveXp(pid), liveParts(pid), opponents(player(pid).club, matches[0].gw), ' (not played yet)')
    : ptsPill(pts, bonus, {
        ...projectedPill(pid, matches[0]?.gw),
        from: matches.length ? pointsRows(pointsFrom(pid, matches[0].gw)) : [],
      });
}

// His matches are this gameweek's and none has kicked off.
const stillToPlay = (matches: PlMatch[]) =>
  matches.length > 0 && matches.every((m) => plState(m).state === 'due') && matches[0].gw === D.meta.currentGw;

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
        meta: `${x.total} pts · ${x.ep.toFixed(1)} projected next · ${x.owner ? `with ${teamName(x.owner)}` : 'free agent'}`,
        value: x.owner ? avatar(x.owner, 24) : tag('FA', 'A free agent'),
      }),
    );
  return card({
    title: 'Similar players',
    sub: `${POSITIONS[p.pos]}s on about the same points`,
    body: `<div class="list">${rows.join('')}</div>`,
  });
}
