// A real Premier League match: the score and who scored, both lineups on one pitch with
// the substitutes who came on, and, for the draft, each player's FPL points and whose
// squad he was in that week, and what each draft team took from the match. While it is
// being played the lineups come from the live relay's feed, fresher than data.json's. A
// Player stats tab has everyone's FPL stats in it (pl-stats.ts); the right column, what
// the draft took from it and the round's other matches, stays on both tabs (on one column,
// under the Facts tab alone).

import type { PlLine, PlMatch, PlMoment } from '../../shared/data.ts';
import type { PlayerEvents } from '../../shared/live.ts';
import { withFplAssists } from '../../shared/match-stats.ts';
import { avatar, bestOf, card, crest, empty, listRow, ptsPill, roundCard, xpPill, type RoundRow } from '../components.ts';
import { esc, fmtShortDay, fmtTime, fmtWeekday, plural, sum } from '../format.ts';
import { ballSvg, cardSvg, chevronSvg, missSvg, premierLeagueSvg } from '../icons.ts';
import { club, first, gwInfo, lineupFor, nextParts, nextXp, player } from '../lookups.ts';
import { projectedPill } from '../match-odds.ts';
import { statusDot } from '../matches.ts';
import { matchPitch, playerColumns, type PitchPlayer, type PitchSide } from '../pitch.ts';
import { lineEvents, plMatch, plRound, plState } from '../pl.ts';
import { playerLeadsCard, playerStatsCard } from '../pl-stats.ts';
import type { PageView } from '../render.ts';
import { href, PL_MATCH_TABS, type Route } from '../router.ts';
import { D, live, state } from '../state.ts';
import { bpsIn, pointsFrom, pointsRows, statsFor } from '../stats-files.ts';
import type { StatsRow } from '../stats-table.ts';

interface Line {
  pid: number;
  min: number;
  pts: number;
  started: boolean;
  events?: PlayerEvents;
}

const LABELS: Record<(typeof PL_MATCH_TABS)[number], string> = { facts: 'Facts', 'player-stats': 'Player stats' };

export function pagePlMatch(route: Route): PageView {
  const m = plMatch(route.id!);
  if (!m) return { title: 'Premier League', body: card({ body: empty('No such Premier League match this season') }) };
  const sides = linesOf(m);
  const main =
    route.tab === 'player-stats'
      ? playerStatsCard(m.gw, m.id, statsRows(m, sides))
      : `${playerLeadsCard(m.gw, m.id, statsRows(m, sides), href.plMatch(m.id, 'player-stats'))}${lineupCard(m, sides)}${squadsCard(m)}`;
  return {
    title: `${club(m.home)?.name} v ${club(m.away)?.name}`,
    header: {
      poster: poster(m, sides),
      tabs: PL_MATCH_TABS.map((tab) => ({ id: tab, label: LABELS[tab], href: href.plMatch(m.id, tab) })),
      tab: route.tab,
      cls: 'match-header',
    },
    body: main,
    // As on fotmob.com, the right column stays the same whichever tab is open.
    aside: { html: `${sides ? draftCard(m, sides) : ''}${roundMatches(m)}`, cls: `cols-match${route.tab === 'facts' ? ' facts' : ''}` },
  };
}

// Everyone who played, with the points and minutes the pitch shows and whose squad each was
// in, and the substitutes who haven't come on, for the player stats.
function statsRows(m: PlMatch, sides: [Line[], Line[]] | null): StatsRow[] {
  const row = (pid: number, club: number, l?: Line): StatsRow => ({
    pid,
    club,
    min: l?.min ?? 0,
    pts: l?.pts ?? 0,
    owner: ownerOf(pid, m.gw) ?? null,
    benched: m.gw <= D.meta.currentGw ? benched(pid, m.gw) : undefined,
    gw: m.gw,
    ...(l ? {} : { unused: true }),
  });
  const played = new Set((sides ?? [[], []]).flat().map((l) => l.pid));
  const rows = (sides ?? [[], []]).flatMap((lines, i) => [
    ...lines.map((l) => row(l.pid, i ? m.away : m.home, l)),
    ...(sides ? (m.formations?.[i].subs ?? []) : []).filter((pid) => !played.has(pid)).map((pid) => row(pid, i ? m.away : m.home)),
  ]);
  return rows;
}

// Both sides' players: from the relay while the match is on (unless a club plays twice
// that gameweek, which its feed can't split), otherwise from data.json.
function linesOf(m: PlMatch): [Line[], Line[]] | null {
  const feed = live?.gw === m.gw ? live.feed : null;
  const single = (c: number) => plRound(m.gw).filter((x) => x.home === c || x.away === c).length === 1;
  if (feed && plState(m).state === 'live' && single(m.home) && single(m.away)) {
    const side = (c: number) =>
      Object.entries(feed.elements)
        .filter(([pid, [, min]]) => min > 0 && player(Number(pid))?.club === c)
        .map(([pid, [pts, min]]) => {
          const events = feed.events?.[pid];
          return { pid: Number(pid), min, pts, started: !events?.on, events };
        })
        .sort((a, b) => Number(b.started) - Number(a.started) || b.min - a.min);
    return [side(m.home), side(m.away)];
  }
  if (!m.lineups) return null;
  const from = (line: PlLine): Line => ({
    pid: line[0],
    min: line[1],
    pts: line[2],
    started: Boolean(line[3]),
    events: lineEvents(m, line),
  });
  return [m.lineups[0].map(from), m.lineups[1].map(from)];
}

// Who had a player in their squad that gameweek (or has him now, for one to come).
const ownerOf = (pid: number, gw: number) => (gw > D.meta.currentGw ? (player(pid).owner ?? undefined) : ownerIn(pid, gw));

const ownerIn = (pid: number, gw: number) =>
  D.managers.find((mg) => {
    const l = lineupFor(mg.id, gw);
    return l && (l.xi.includes(pid) || l.bench.includes(pid));
  })?.id;

// On his manager's bench that gameweek, after the automatic substitutions: his points don't count.
const benched = (pid: number, gw: number) => D.managers.some((mg) => lineupFor(mg.id, gw)?.bench.includes(pid));

function poster(m: PlMatch, sides: [Line[], Line[]] | null) {
  const s = plState(m);
  const when = m.ko ? `${fmtShortDay.format(new Date(m.ko))}, ${fmtTime.format(new Date(m.ko))}` : 'Date to be set';
  const mid =
    s.state === 'due'
      ? `<span class="mh-time">${m.ko ? fmtTime.format(new Date(m.ko)) : 'TBC'}</span>`
      : `<span class="mh-score">${s.score?.[0] ?? 0} - ${s.score?.[1] ?? 0}</span>`;
  const status = s.state === 'due' ? '' : s.state === 'done' ? 'Full time' : statusDot('live', s.min ? `${s.min}’` : 'Live');
  // Each club leads to its players' stats, as its name does in the table.
  const side = (id: number, cls: string) =>
    `<a class="mh-team ${cls}" href="${href.pl('players', id)}">${crest(id, 48)}<span class="mh-team-text"><span class="mh-name">${esc(club(id)?.name ?? '?')}</span></span></a>`;
  const file = statsFor(m.gw);
  const found = typeof file === 'object' ? file.moments?.[m.id] : undefined;
  const moments =
    found && sides
      ? withFplAssists(found, [sides[0].map((l) => l.pid), sides[1].map((l) => l.pid)], (pid) => m.events?.[pid]?.assists ?? 0)
      : (found ?? null);
  return `<div class="mh">
    <div class="mh-top"><a class="mh-back" href="${href.pl('fixtures', m.gw)}">${chevronSvg('left')}<span>Round ${m.gw}</span></a><a class="mh-league" href="${href.pl()}">Premier League</a></div>
    <div class="mh-date">${when}</div>
    <div class="mh-main">${side(m.home, 'home')}<div class="mh-mid">${mid}<span class="mh-status">${status}</span></div>${side(m.away, 'away')}</div>
    ${sides ? `<div class="mh-scorers"><div class="home">${incidents(sides, 0, s.score?.[0] ?? 0, moments)}</div><div class="away">${incidents(sides, 1, s.score?.[1] ?? 0, moments)}</div></div>` : ''}
  </div>`;
}

const minuteText = (min: number, half: 1 | 2) =>
  half === 1 && min > 45 ? `45+${min - 45}’` : half === 2 && min > 90 ? `90+${min - 90}’` : `${min}’`;

// Under each side, as fotmob.com's: its goals, each with its scorer, minute and who made it
// (and the other side's own goals), then its red cards and missed penalties. Without the
// moments, or while they're behind the score, just the scorers.
function incidents(sides: [Line[], Line[]], i: 0 | 1, score: number, moments: PlMoment[] | null) {
  const [mine, theirs] = [sides[i], sides[1 - i]];
  const ours = new Set(mine.map((l) => l.pid));
  const other = new Set(theirs.map((l) => l.pid));
  const line = (icon: string, text: string) => `<span class="mh-incident">${icon}<span>${text}</span></span>`;
  const name = (pid: number) => `<a href="${href.player(pid)}">${esc(player(pid)?.name ?? '?')}</a>`;
  const goals = (moments ?? []).filter(
    ([, , kind, pid]) => ((kind === 'goal' || kind === 'pen') && ours.has(pid)) || (kind === 'own' && other.has(pid)),
  );
  let scored: string[];
  if (moments && goals.length === score) {
    // A line a goal, so an assister never reads as the next goal's scorer.
    scored = goals.map(([min, half, kind, pid, assist]) => {
      const what = kind === 'pen' ? ' (pen)' : kind === 'own' ? ' (OG)' : '';
      return line(
        ballSvg(),
        `${name(pid)} ${minuteText(min, half)}${what}${assist ? ` <span class="mh-assist">(${name(assist)})</span>` : ''}`,
      );
    });
  } else
    scored = [
      ...mine
        .filter((l) => l.events?.goals)
        .map((l) => line(ballSvg(), `${name(l.pid)}${l.events!.goals! > 1 ? ` ×${l.events!.goals}` : ''}`)),
      ...theirs.filter((l) => l.events?.ownGoals).map((l) => line(ballSvg(), `${name(l.pid)} (OG)`)),
    ];
  const reds = (moments ?? [])
    .filter(([, , kind, pid]) => (kind === 'red' || kind === 'second') && ours.has(pid))
    .map(([min, half, , pid]) => line(cardSvg(true), `${name(pid)} ${minuteText(min, half)}`));
  const missed = mine
    .filter((l) => l.events?.pensMissed)
    .map((l) => line(missSvg, `${name(l.pid)} <span class="mh-assist">penalty missed</span>`));
  return [...scored, ...reds, ...missed].join('');
}

// Both lineups: the real formations on the pitch once the Premier League has them (before
// kick-off too), or else two plain lists. Each player has his FPL points (or, before the
// next gameweek, his expected points) and, if he's in a draft squad, his name in that
// manager's colours.
function lineupCard(m: PlMatch, sides: [Line[], Line[]] | null) {
  const lineOf = new Map((sides ?? [[], []]).flat().map((l) => [l.pid, l]));
  const ahead = !sides && m.gw === D.meta.nextGw;
  // The match's best of those who played is blue after full time (on a tie, the more goals,
  // then the higher BPS, then the more assists).
  const over = sides && plState(m).state === 'done';
  const top = over
    ? bestOf(
        [...lineOf.keys()],
        (pid) => lineOf.get(pid)?.pts,
        (pid) => lineOf.get(pid)?.events?.goals ?? 0,
        (pid) => bpsIn(pid, m.gw, m.id),
        (pid) => lineOf.get(pid)?.events?.assists ?? 0,
      )
    : new Set<number>();
  // A player's points here are this match's, so only one with no other match this gameweek has his projection in their tip.
  const doubles = new Set(gwInfo(m.gw)?.doubles ?? []);
  const once = (pid: number) => !doubles.has(player(pid)?.club);
  const onPitch = (pid: number): PitchPlayer => {
    const l = lineOf.get(pid);
    return {
      pid,
      badge: l
        ? ptsPill(l.pts, l.events?.bonus ?? 0, {
            top: top.has(pid),
            ...(once(pid) ? projectedPill(pid, m.gw) : {}),
            from: pointsRows(pointsFrom(pid, m.gw, m.id)),
          })
        : ahead
          ? xpPill(nextXp(pid), nextParts(pid))
          : '',
      events: l?.events,
      owner: ownerOf(pid, m.gw) ?? null,
      benched: m.gw <= D.meta.currentGw ? benched(pid, m.gw) : undefined,
      gw: m.gw,
      faded: Boolean(sides) && !l, // a substitute who didn't come on
    };
  };

  if (m.formations) {
    const side = (i: 0 | 1, c: number): PitchSide => {
      const f = m.formations![i];
      return {
        id: 0,
        logo: crest(c, 24),
        name: esc(club(c)?.short ?? '?'),
        xi: f.lines.flat().map(onPitch),
        lines: f.lines.map((line) => line.map(onPitch)),
        shape: f.shape,
      };
    };
    // The substitutes who came on first, in the order they did, then the rest.
    const subs = m.formations.map((f) =>
      [...f.subs].sort((a, b) => (lineOf.get(b)?.min ?? -1) - (lineOf.get(a)?.min ?? -1)).map(onPitch),
    ) as [PitchPlayer[], PitchPlayer[]];
    return card({ title: 'Lineups', body: matchPitch(side(0, m.home), side(1, m.away), subs, 'Substitutes'), cls: 'lineup-card' });
  }
  if (!sides) return '';
  const order = { GKP: 0, DEF: 1, MID: 2, FWD: 3 };
  const byPosition = (a: Line, b: Line) => order[player(a.pid).pos] - order[player(b.pid).pos];
  const starters = sides.map((list) =>
    list
      .filter((l) => l.started)
      .sort(byPosition)
      .map((l) => onPitch(l.pid)),
  ) as [PitchPlayer[], PitchPlayer[]];
  const subs = sides.map((list) => list.filter((l) => !l.started).map((l) => onPitch(l.pid))) as [PitchPlayer[], PitchPlayer[]];
  return card({
    title: 'Lineups',
    body: `${playerColumns('Starting XI', starters)}${playerColumns('Substitutes', subs)}`,
    cls: 'lineup-card',
  });
}

// What each draft team took from the match: its XI's points, and its bench's.
function draftCard(m: PlMatch, [home, away]: [Line[], Line[]]) {
  const lines = [...home, ...away];
  const rows = D.managers
    .map((mg) => {
      const l = lineupFor(mg.id, m.gw);
      const xi = lines.filter((x) => l?.xi.includes(x.pid));
      const bench = lines.filter((x) => l?.bench.includes(x.pid));
      return { id: mg.id, xi, bench, pts: sum(xi.map((x) => x.pts)) };
    })
    .filter((r) => r.xi.length || r.bench.length)
    .sort((a, b) => b.pts - a.pts);
  if (!rows.length) return card({ title: 'Draft points', body: empty('Nobody in the league had a player in it') });
  const names = (xs: Line[]) => xs.map((x) => `<a href="${href.player(x.pid)}">${esc(player(x.pid).name)}</a> ${x.pts}`).join(', ');
  return card({
    title: 'Draft points',
    sub: 'What each team’s XI took from the match',
    body: `<div class="list">${rows
      .map((r) =>
        listRow({
          lead: avatar(r.id, 32),
          title: `<a href="${href.team(r.id)}">${first(r.id)}</a>`,
          meta: `<span>${[r.xi.length ? names(r.xi) : '', r.bench.length ? `bench: ${names(r.bench)}` : ''].filter(Boolean).join(' · ')}</span>`,
          value: r.pts,
          mine: r.id === state.myTeam,
        }),
      )
      .join('')}</div>`,
    footer: { href: href.home(m.gw), label: `${plural(rows.length, 'team')} in gameweek ${m.gw}` },
  });
}

// Every draft team's players at the two clubs (in its squad that week, or now for a match
// to come), the teams with nobody in it too, with their expected points when the match is
// in the next gameweek. Those on the team's bench that week come after the rest, as the
// points card has them, and their expected points don't count in its total.
function squadsCard(m: PlMatch) {
  const next = m.gw === D.meta.nextGw;
  const rows = D.managers
    .map((mg) => {
      const players = Object.keys(D.players)
        .map(Number)
        .filter((pid) => (player(pid).club === m.home || player(pid).club === m.away) && ownerOf(pid, m.gw) === mg.id)
        .sort((a, b) => player(b).total - player(a).total);
      const bench = lineupFor(mg.id, m.gw)?.bench ?? [];
      return { id: mg.id, players, xi: players.filter((pid) => !bench.includes(pid)), bench: players.filter((pid) => bench.includes(pid)) };
    })
    .sort((a, b) => b.players.length - a.players.length || b.xi.length - a.xi.length); // level, those with more in their XI first
  const names = (ids: number[]) =>
    ids
      .map(
        (pid) =>
          `<a href="${href.player(pid)}">${esc(player(pid).name)}</a>${next ? ` <span class="muted">${nextXp(pid).toFixed(1)}</span>` : ''}`,
      )
      .join(', ');
  const who = (r: { xi: number[]; bench: number[] }) =>
    [r.xi.length ? names(r.xi) : '', r.bench.length ? `bench: ${names(r.bench)}` : ''].filter(Boolean).join(' · ') ||
    'No players in this match';
  return card({
    title: 'Draft players',
    sub: `Each team’s players in it${next ? ', with their expected points' : ''}`,
    body: `<div class="list">${rows
      .map((r) =>
        listRow({
          lead: avatar(r.id, 32),
          title: `<a href="${href.team(r.id)}">${first(r.id)}</a>`,
          meta: `<span>${who(r)}</span>`, // one run of text, not the row meta's flex items with their gaps
          value: next && r.players.length ? sum(r.xi.map(nextXp)).toFixed(1) : r.players.length,
          mine: r.id === state.myTeam,
        }),
      )
      .join('')}</div>`,
  });
}

// The round's other matches, as fotmob.com's matches in the round.
function roundMatches(m: PlMatch) {
  const rows = plRound(m.gw).map((x): RoundRow => {
    const s = plState(x);
    const line = (c: number, goals?: number) => ({ icon: crest(c, 20), name: esc(club(c)?.name ?? '?'), score: goals });
    return {
      href: href.plMatch(x.id),
      lines: [line(x.home, s.score?.[0]), line(x.away, s.score?.[1])],
      status:
        s.state === 'due'
          ? x.ko
            ? `${fmtWeekday.format(new Date(x.ko))}<br>${fmtTime.format(new Date(x.ko))}`
            : 'TBC'
          : statusDot(s.state, s.state === 'live' && s.min ? `${s.min}’` : undefined),
      current: x.id === m.id,
    };
  });
  return roundCard({ title: 'Premier League', sub: `Round ${m.gw}`, logo: premierLeagueSvg, to: href.pl('fixtures', m.gw), rows });
}
