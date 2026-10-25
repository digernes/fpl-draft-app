// A head-to-head match's page, as fotmob.com's match pages: the header with both sides,
// the score (or the deadline) and each side's top scorers, then the tabs, and beside the
// header and every tab the same right column (on one column, under the Facts tab alone):
// the odds, the round's other matches, the match report (or preview), the top players and
// the benches. Facts: the momentum, both lineups on one pitch (the projected ones before
// the deadline) and each side's form. Stats: what both XIs did and where their points came
// from, side by side, as fotmob.com's.
// Head-to-head: every meeting this season, played or to come. And the table.
// The momentum is in match-momentum.ts, the Stats tab in match-stats.ts.

import type { Lineup, Match } from '../../shared/data.ts';
import { playerState } from '../../shared/live.ts';
import { avatar, card, crest, empty, listRow, photo, roundCard, tile, type RoundRow } from '../components.ts';
import { esc, fmtDate, fmtShortDay, fmtTime, signed } from '../format.ts';
import { ballSvg, bootSvg, cardSvg, chevronSvg, leagueSvg, ownGoalSvg, subSvg } from '../icons.ts';
import { club, first, gwInfo, gwPoints, lineupFor, mgr, player, slotOf } from '../lookups.ts';
import { onAction } from '../actions.ts';
import { commentary, type Entry, type EntryPlayer } from '../commentary.ts';
import { matchReport, type ReportLine } from '../match-report.ts';
import { matchLineups, projectedLineups } from '../match-lineups.ts';
import { inPlayOdds, oddsRow, preMatchOdds } from '../match-odds.ts';
import { pollResults, whoWillWin } from '../match-poll.ts';
import { isOver, matchStatus, matchStatusText, statusDot } from '../matches.ts';
import { momentum, type Step } from '../momentum.ts';
import { gwTiebreaks } from '../lineup-filters.ts';
import { statsFor } from '../stats-files.ts';
import { renderView, type PageView } from '../render.ts';
import { href, MATCH_TABS, type Route } from '../router.ts';
import { D, live, state } from '../state.ts';
import { standingsTable } from '../league-tables.ts';
import { leagueHeader } from './league.ts';
import { momentumCard } from './match-momentum.ts';
import { sideStats, statsTab } from './match-stats.ts';

const LABELS: Record<(typeof MATCH_TABS)[number], string> = {
  facts: 'Facts',
  commentary: 'Commentary',
  lineup: 'Lineup',
  table: 'Table',
  stats: 'Stats',
  h2h: 'Head-to-head',
};

export function pageMatch(route: Route): PageView {
  const m = D.matches.find((x) => x.gw === route.gw && x.home === route.home && x.away === route.away);
  if (!m) return { title: 'Match', header: leagueHeader(), body: card({ body: empty('No such match in this league') }) };
  const l = lineups(m);
  const file = m.started ? statsFor(m.gw) : undefined;
  const steps = l ? momentum(D, m, l, live?.gw === m.gw ? live : undefined, typeof file === 'object' ? file : undefined) : [];
  const tabs: Record<string, () => string> = {
    facts: () => facts(m, steps),
    commentary: () => commentaryCard(m, l),
    lineup: () => lineupCard(m),
    stats: () => statsTab(m, l),
    h2h: () => headToHead(m),
    table: () => card({ title: 'Table', body: standingsTable('overall', { highlight: [m.home, m.away] }) }),
  };
  return {
    title: `${mgr(m.home)!.first} v ${mgr(m.away)!.first} · GW ${m.gw}`,
    header: {
      poster: poster(m),
      tabs: MATCH_TABS.map((tab) => ({ id: tab, label: LABELS[tab], href: href.match(m, tab) })),
      tab: route.tab,
      cls: 'match-header',
    },
    body: tabs[route.tab](),
    // As on fotmob.com, the right column stays the same whichever tab is open.
    aside: { html: sideColumn(m, steps), cls: `cols-match${route.tab === 'facts' ? ' facts' : ''}` },
  };
}

const lineups = (m: Match): [Lineup, Lineup] | null => {
  const [home, away] = [lineupFor(m.home, m.gw), lineupFor(m.away, m.gw)];
  return home && away ? [home, away] : null;
};

const involves = (x: Match, id: number) => x.home === id || x.away === id;
const opponent = (x: Match, id: number) => (x.home === id ? x.away : x.home);
const pointsOf = (x: Match, id: number) => (x.home === id ? (x.homePts ?? 0) : (x.awayPts ?? 0));

// fotmob.com's match header: the way back and the league, the date, both sides around the
// score and, under each, its top scorers (the goals, on fotmob.com).
function poster(m: Match) {
  const deadline = gwInfo(m.gw)?.deadline;
  const when = deadline ? `${fmtShortDay.format(new Date(deadline))}, ${fmtTime.format(new Date(deadline))}` : '';
  const side = (id: number, cls: string) =>
    `<a class="mh-team ${cls}" href="${href.team(id)}">${avatar(id, 48)}<span class="mh-team-text"><span class="mh-name">${first(id)}</span><span class="mh-sub">${esc(mgr(id)!.team)}</span></span></a>`;
  const { cls, date, mid, status, scorers } = m.started
    ? {
        cls: '',
        date: `Gameweek ${m.gw}`,
        mid: `<span class="mh-score">${m.homePts} - ${m.awayPts}</span>`,
        status: matchStatusText(m),
        scorers: posterScorers(m),
      }
    : {
        cls: ' pre',
        date: `Gameweek ${m.gw} · deadline ${when}`,
        mid: `<span class="mh-time">${when || 'TBC'}</span>`,
        status: 'Deadline',
        scorers: '',
      };
  return `<div class="mh${cls}">
    <div class="mh-top"><a class="mh-back" href="${href.home(m.gw)}">${chevronSvg('left')}<span>Gameweek ${m.gw}</span></a><a class="mh-league" href="${href.league()}">${esc(D.meta.name)}</a></div>
    <div class="mh-date">${date}</div>
    <div class="mh-main">${side(m.home, 'home')}<div class="mh-mid">${mid}<span class="mh-status">${status}</span></div>${side(m.away, 'away')}</div>
    ${scorers}
  </div>`;
}

function posterScorers(m: Match) {
  const l = lineups(m);
  return `<div class="mh-scorers"><div class="home">${topScorers(m, l?.[0])}</div><div class="away">${topScorers(m, l?.[1])}</div></div>`;
}

function topScorers(m: Match, lineup: Lineup | undefined) {
  if (!lineup) return '';
  return [...lineup.xi]
    .filter((pid) => gwPoints(pid, m.gw) >= 6)
    .sort((a, b) => gwPoints(b, m.gw) - gwPoints(a, m.gw))
    .slice(0, 4)
    .map((pid) => `<a href="${href.player(pid)}">${esc(player(pid).name)} ${gwPoints(pid, m.gw)}</a>`)
    .join('');
}

function facts(m: Match, steps: Step[]) {
  const l = lineups(m);
  return `${m.started && l ? momentumCard(m, steps, l) : ''}${lineupCard(m)}${teamFormCard(m)}`;
}

// Each side's last five head-to-heads before this one, side by side, as fotmob.com's Team
// form: the score between the two, coloured by how it went for the side, the latest first.
function teamFormCard(m: Match) {
  const column = (id: number) =>
    D.matches
      .filter((x) => x.finished && x.gw < m.gw && involves(x, id))
      .slice(-5)
      .reverse()
      .map((x, i) => formRow(x, id, i === 0))
      .join('');
  const [home, away] = [column(m.home), column(m.away)];
  return home || away ? card({ title: 'Team form', body: `<div class="tf-cols"><div>${home}</div><div>${away}</div></div>` }) : '';
}

function formRow(x: Match, id: number, latest: boolean) {
  const [pf, pa] = [pointsOf(x, id), pointsOf(x, opponent(x, id))];
  const res = pf > pa ? 'W' : pf < pa ? 'L' : 'D';
  const side = (s: number) => `<span class="tf-side">${avatar(s, 22)}<span class="tf-name">${first(s)}</span></span>`;
  return `<a class="tf-row${latest ? ' latest' : ''}" href="${href.match(x)}" data-tip="GW ${x.gw}">${side(x.home)}<span class="tf-score ${res}">${x.homePts ?? 0} - ${x.awayPts ?? 0}</span>${side(x.away)}</a>`;
}

type Chances = ReturnType<typeof inPlayOdds>;

// The match report, or before the deadline its preview, under the round's matches.
function reportCard(m: Match, chances: Chances, steps: Step[]) {
  const l = lineups(m);
  const toPlay = (lineup: Lineup) =>
    live?.gw === m.gw
      ? lineup.xi.filter((pid) => ['due', 'live'].includes(playerState(live!.feed, pid, player(pid).club).state)).length
      : 0;
  // Over once its Full time shows, though FPL finishes it only when the gameweek is settled.
  const report = matchReport(D, isOver(m) ? { ...m, finished: true } : m, {
    lineup: (id) => lineupFor(id, m.gw),
    points: (pid) => gwPoints(pid, m.gw),
    momentum: steps,
    ...(chances && l ? { chances: chances.p, toPlay: [toPlay(l[0]), toPlay(l[1])] as [number, number] } : {}),
  });
  return report.length ? card({ title: m.started ? 'Match report' : 'Preview', body: insights(report), cls: 'report-card' }) : '';
}

// The report as fotmob.com's insights: a bubble a sentence, edged in the colour of the side
// it's about, with that side's avatar by the first of each run.
function insights(lines: ReportLine[]) {
  const rows = lines.map((line, i) => {
    const who = line.side !== undefined && line.side !== lines[i - 1]?.side ? avatar(line.side, 24) : '';
    const edge = line.side !== undefined ? ` style="--edge: var(--m${slotOf(line.side)})"` : '';
    return `<li class="insight"><span class="insight-who">${who}</span><p${edge}>${esc(line.text)}</p></li>`;
  });
  return `<ul class="insights">${rows.join('')}</ul>`;
}

// The right column, the same on every tab: the odds, the round's other matches, the top
// stats once it's over, the top players (or before kick-off each side's form) and the benches.
function sideColumn(m: Match, steps: Step[]) {
  const chances = m.started && !isOver(m) ? inPlayOdds(m) : null;
  const l = lineups(m);
  // Once it's on, its top stats above the report that tells them.
  const stats = m.started && l ? topStatsCard(m, l) : '';
  const played = m.started && l ? [topPlayersCard(m, l), benchCard(m, l)] : [];
  return [oddsCard(m, chances), roundMatches(m), stats, reportCard(m, chances, steps), ...played].join('');
}

// Before kick-off fotmob.com's Who will win?; then untitled, as its odds: they're plainly
// the odds, with what the poll's voters said above them.
function oddsCard(m: Match, chances: Chances) {
  if (!m.started)
    return card({ title: 'Who will win?', cls: 'odds-card poll-card', body: `<div class="match-detail">${whoWillWin(m)}</div>` });
  const inPlay = chances ? `<div><div class="detail-label">Live odds</div>${oddsRow(chances, m, null, true)}</div>` : '';
  return card({ title: '', cls: 'odds-card', body: `<div class="match-detail">${pollResults(m)}${inPlay}${preMatchOdds(m)}</div>` });
}

// Both XIs on one pitch, or before the deadline the projected ones behind the odds, as
// fotmob.com's predicted lineup.
function lineupCard(m: Match) {
  if (!m.started)
    return card({
      title: 'Predicted lineup',
      body: projectedLineups(m) || empty('They come with the odds, three gameweeks out'),
      cls: 'lineup-card',
    });
  return card({ title: 'Lineup', body: lineups(m) ? matchLineups(m) : empty('No lineups'), cls: 'lineup-card' });
}

// --- Cards beside the pitch -------------------------------------------------------------

const topStatsCard = (m: Match, l: [Lineup, Lineup]) =>
  card({ title: 'Top stats', cls: 'st-card st-side', body: sideStats(m, l), footer: { href: href.match(m, 'stats'), label: 'All stats' } });

// Each side's best scorers in its XI.
function topPlayersCard(m: Match, [home, away]: [Lineup, Lineup]) {
  const ties = gwTiebreaks(m.gw);
  const rows = (id: number, l: Lineup) =>
    [...l.xi]
      .sort((a, b) => [(pid: number) => gwPoints(pid, m.gw), ...ties].reduce((d, by) => d || (by(b) ?? 0) - (by(a) ?? 0), 0))
      .slice(0, 3)
      .map((pid) =>
        listRow({
          lead: `<a href="${href.player(pid)}">${photo(pid)}</a>`,
          title: `<a href="${href.player(pid)}">${esc(player(pid).name)}</a>`,
          meta: `For <a href="${href.team(id)}">${first(id)}</a>${l.subs.includes(pid) ? ' · came on automatically' : ''}`,
          value: gwPoints(pid, m.gw),
        }),
      )
      .join('');
  return card({ title: 'Top players', body: `<div class="list">${rows(m.home, home)}${rows(m.away, away)}</div>` });
}

function benchCard(m: Match, [home, away]: [Lineup, Lineup]) {
  const tiles = [home, away].map((l, i) => {
    const id = i ? m.away : m.home;
    const subs = l.subs.map((pid) => esc(player(pid)?.name ?? '?')).join(', ');
    return tile(`${first(id)}’s bench`, l.benchPts, subs ? `On automatically: ${subs}` : 'No automatic substitutions');
  });
  return card({ title: 'On the bench', body: `<div class="tiles">${tiles.join('')}</div>` });
}

// --- Commentary ----------------------------------------------------------------------------

onAction('commentary-bench', (value) => {
  state.commentaryBench = value === 'on';
  renderView();
});

const TITLES: Record<Entry['kind'], string> = {
  kickoff: 'Kick-off',
  goal: 'Goal!',
  own: 'Own goal',
  yellow: 'Yellow card',
  red: 'Red card',
  sub: 'Substitution',
  hour: 'An hour played',
  halftime: 'Half-time',
  fulltime: 'Full time',
  autosub: 'Automatic substitution',
};

// Why there's no commentary yet, while the gameweek's stats file isn't.
const WAITING: Record<'loading' | 'missing', string> = {
  loading: 'Loading…',
  missing: 'Not in yet: it comes with the next update',
};

// A player's moment as fotmob.com marks it, at the bottom right of his photo: what he did,
// but a card goes by the entry's kind.
const SCORED = new Map([
  ['Goal', ballSvg()],
  ['Own goal', ownGoalSvg],
  ['Assist', bootSvg()],
]);
const SUBBED = new Map([
  ['On', subSvg(true)],
  ['Came in', subSvg(true)],
  ['Off', subSvg(false)],
  ['Didn’t play', subSvg(false)],
  ['Not in the squad', subSvg(false)],
]);

function momentIcon(e: Entry, what = '') {
  const scored = SCORED.get(what);
  if (scored) return scored;
  if (e.kind === 'yellow' || e.kind === 'red') return cardSvg(e.kind === 'red' || what === 'Second yellow');
  return SUBBED.get(what) ?? '';
}

// fotmob.com's commentary, for the draft: everything either side's players did, the latest
// first (commentary.ts), each a box down the middle with its minute and what it was, its
// match, a row a player (his club, what he did and for whom, his points, his photo) and the
// head-to-head's score after it. The benches' players come in with the switch.
function commentaryCard(m: Match, l: [Lineup, Lineup] | null) {
  const title = 'Commentary';
  if (!m.started || !l) return card({ title, body: empty('It starts with the gameweek’s first kick-off') });
  const file = statsFor(m.gw);
  if (typeof file === 'string') return card({ title, body: empty(WAITING[file]) });
  const on = state.commentaryBench;
  const entries = commentary(D, file, m, l, { bench: on, now: live?.gw === m.gw ? live : undefined });
  const toggle = `<button type="button" class="cm-switch" role="switch" aria-checked="${on}" data-action="commentary-bench" data-value="${on ? 'off' : 'on'}"><span>Include benched players</span><span class="cm-track"><span class="cm-thumb"></span></span></button>`;
  const list = entries.length ? entries.map((e) => commentaryEntry(m, e)).join('') : empty('Nothing yet');
  return card({ title, action: toggle, body: `<div class="cm-list">${list}</div>` });
}

const sideOf = (m: Match, side: 0 | 1) => (side ? m.away : m.home);

function commentaryEntry(m: Match, e: Entry) {
  const rows = e.players.map((p) => commentaryPlayer(m, e, p)).join('');
  return `<div class="cm-entry ${e.kind}">
      <div class="cm-head"><span class="cm-min ${minutePill(m, e)}">${e.minute}</span><span class="cm-title">${TITLES[e.kind]}</span></div>
      ${commentaryMatch(e)}
      ${rows ? `<div class="cm-players">${rows}</div>` : ''}<div class="cm-foot">${commentaryFoot(m, e)}</div>
    </div>`;
}

// A goal's minute in the colour of the side it's for, as fotmob.com's; the rest grey.
function minutePill(m: Match, e: Entry) {
  const sides = [...new Set(e.players.map((p) => p.side))];
  const goal = e.kind === 'goal' || e.kind === 'own';
  return goal && sides.length === 1 ? `m${slotOf(sideOf(m, sides[0]))}` : 'neutral';
}

function commentaryMatch({ match: pm, matchScore }: Entry) {
  const score = matchScore ? `${matchScore[0]} - ${matchScore[1]}` : 'v';
  return `<a class="cm-match" href="${href.plMatch(pm.id)}">${crest(pm.home, 16)}<span>${esc(club(pm.home)?.short ?? '?')} ${score} ${esc(club(pm.away)?.short ?? '?')}</span>${crest(pm.away, 16)}</a>`;
}

function commentaryPlayer(m: Match, e: Entry, p: EntryPlayer) {
  const pl = player(p.pid);
  const icon = momentIcon(e, p.what);
  return `<a class="cm-player${p.bench ? ' bench' : ''}" href="${href.player(p.pid)}">
          ${crest(pl?.club, 28)}
          <span class="cm-who"><span class="cm-name">${esc(pl?.name ?? '?')}</span><span class="cm-what">${avatar(sideOf(m, p.side), 16)}<span>${whatHeDid(p) || first(sideOf(m, p.side))}</span></span></span>
          <span class="cm-pts">${p.pts ? signed(p.pts) : ''}</span>
          <span class="cm-face">${photo(p.pid, 40)}${icon ? `<span class="cm-icon">${icon}</span>` : ''}</span>
        </a>`;
}

function whatHeDid(p: EntryPlayer) {
  const other = p.other !== undefined ? ` for ${esc(player(p.other)?.name ?? '?')}` : '';
  return [p.what ? `${esc(p.what)}${other}` : '', p.bench ? 'on the bench' : ''].filter(Boolean).join(' · ');
}

// Roughly when it happened, in the reader's own time, and the score it left.
function commentaryFoot(m: Match, e: Entry) {
  const when = `<span class="cm-time" data-tip="Roughly when, your time">${fmtTime.format(new Date(e.at))}</span>`;
  if (!e.players.some((p) => !p.bench && p.pts)) return when;
  return `${when}<span class="cm-score">${first(m.home)} <strong>${e.score[0]} - ${e.score[1]}</strong> ${first(m.away)}</span>`;
}

// --- Head-to-head --------------------------------------------------------------------------

// Every meeting this season, played or to come, as fotmob.com's head-to-head: the wins and
// draws as pills in each side's colours, then a row per meeting, its date and league above
// both sides and the score (or the deadline), this one picked out.
function headToHead(m: Match) {
  const meetings = D.matches.filter((x) => involves(x, m.home) && involves(x, m.away));
  const rows = meetings.map((x) => meetingRow(m, x)).join('');
  return card({ body: `${meetingsSummary(m, meetings)}<div class="h2h-list">${rows}</div>` });
}

function meetingsSummary(m: Match, meetings: Match[]) {
  const done = meetings.filter((x) => x.finished);
  const wins = (id: number) => done.filter((x) => pointsOf(x, id) > pointsOf(x, opponent(x, id))).length;
  const draws = done.length - wins(m.home) - wins(m.away);
  const count = (n: number, label: string, cls: string) =>
    `<div class="h2h-count"><span class="h2h-badge ${cls}">${n}</span><span class="h2h-label">${label}</span></div>`;
  return `<div class="h2h-sum">
    <a class="h2h-side" href="${href.team(m.home)}">${avatar(m.home, 40)}</a>
    <div class="h2h-counts">${count(wins(m.home), 'Wins', `m${slotOf(m.home)}`)}${count(draws, 'Draws', 'draw')}${count(wins(m.away), 'Wins', `m${slotOf(m.away)}`)}</div>
    <a class="h2h-side" href="${href.team(m.away)}">${avatar(m.away, 40)}</a>
  </div>`;
}

const meetingSide = (id: number, cls: 'home' | 'away') =>
  `<span class="h2h-team ${cls}">${cls === 'away' ? avatar(id, 24) : ''}<span>${first(id)}</span>${cls === 'home' ? avatar(id, 24) : ''}</span>`;

function meetingRow(m: Match, x: Match) {
  const deadline = gwInfo(x.gw)?.deadline;
  const mid = x.started ? `${x.homePts} - ${x.awayPts}` : deadline ? fmtTime.format(new Date(deadline)) : 'TBC';
  const where = matchStatus(x) === 'live' ? statusDot('live') : `${leagueSvg}<span>${esc(D.meta.name)}</span>`;
  return `<a class="h2h-row${x === m ? ' this' : ''}" href="${href.match(x)}">
        <span class="h2h-meta"><span>Gameweek ${x.gw}${deadline ? ` · ${fmtDate.format(new Date(deadline))}` : ''}</span><span class="h2h-where">${where}</span></span>
        <span class="h2h-line">${meetingSide(x.home, 'home')}<span class="h2h-score">${mid}</span>${meetingSide(x.away, 'away')}</span>
      </a>`;
}

// The round's other head-to-heads, as fotmob.com's matches in the round.
function roundMatches(m: Match) {
  const deadline = gwInfo(m.gw)?.deadline;
  const rows = D.matches
    .filter((x) => x.gw === m.gw)
    .map((x): RoundRow => {
      const state = matchStatus(x);
      const line = (id: number, pts: number | null) => ({
        icon: avatar(id, 20),
        name: first(id),
        score: x.started ? (pts ?? 0) : undefined,
      });
      return {
        href: href.match(x),
        lines: [line(x.home, x.homePts), line(x.away, x.awayPts)],
        status: state !== 'due' ? statusDot(state) : x.started ? '' : deadline ? fmtTime.format(new Date(deadline)) : '',
        current: x === m,
      };
    });
  return roundCard({ title: esc(D.meta.name), sub: `Gameweek ${m.gw}`, logo: leagueSvg, to: href.league('fixtures', m.gw), rows });
}
