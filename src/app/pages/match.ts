// A head-to-head match's page, as fotmob.com's match pages: the header with both sides,
// the score (or the deadline) and each side's top scorers, then the tabs, and beside the
// header and every tab the same right column (on one column, under the Facts tab alone):
// the odds, the round's other matches, the match report (or preview), the top players and
// the benches. Facts: the momentum, both lineups on one pitch (the projected ones before
// the deadline) and each side's form. Stats: what both XIs did, side by side, as fotmob.com's.
// Head-to-head: every meeting this season, played or to come. And the table.

import type { Lineup, Match, PlMatch } from '../../shared/data.ts';
import { playerState, type PlayerEvents } from '../../shared/live.ts';
import { avatar, card, crest, empty, listRow, photo, roundCard, tile, type RoundRow } from '../components.ts';
import { esc, fmtDate, fmtShortDay, fmtTime, fmtWeekday, pct, signed, sum } from '../format.ts';
import { ballSvg, bootSvg, cardSvg, chevronSvg, leagueSvg, ownGoalSvg, subSvg } from '../icons.ts';
import { club, first, gwEvents, gwInfo, gwPoints, lineupFor, mgr, player, slotOf } from '../lookups.ts';
import { onAction } from '../actions.ts';
import { commentary, type Entry } from '../commentary.ts';
import { matchReport, type ReportLine } from '../match-report.ts';
import {
  expectedStats,
  inPlayOdds,
  matchLineups,
  matchStatus,
  matchStatusText,
  oddsRow,
  preMatchOdds,
  projectedLineups,
  statusDot,
  winChances,
} from '../matches.ts';
import { momentum, type Step } from '../momentum.ts';
import { linesIn, plRound, plState } from '../pl.ts';
import { gwUnderlying, statsFor } from '../pl-stats.ts';
import { renderView, type PageView } from '../render.ts';
import { href, MATCH_TABS, type Route } from '../router.ts';
import { D, live, state } from '../state.ts';
import { standingsTable } from '../table.ts';
import { leagueHeader } from './league.ts';

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
  const chances = m.started && !m.finished ? inPlayOdds(m) : null;
  const l = lineups(m);
  const steps = l ? momentum(D, m, l, live?.gw === m.gw ? live : undefined) : [];
  const tabs: Record<string, () => string> = {
    facts: () => facts(m, steps),
    commentary: () => commentaryCard(m),
    lineup: () => lineupCard(m),
    stats: () => statsTab(m),
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
    aside: { html: sideColumn(m, chances, steps), cls: `cols-match${route.tab === 'facts' ? ' facts' : ''}` },
  };
}

const lineups = (m: Match): [Lineup, Lineup] | null => {
  const [home, away] = [lineupFor(m.home, m.gw), lineupFor(m.away, m.gw)];
  return home && away ? [home, away] : null;
};

// fotmob.com's match header: the way back and the league, the date, both sides around the
// score and, under each, its top scorers (the goals, on fotmob.com).
function poster(m: Match) {
  const deadline = gwInfo(m.gw)?.deadline;
  const when = deadline ? `${fmtShortDay.format(new Date(deadline))}, ${fmtTime.format(new Date(deadline))}` : '';
  const status = m.started ? matchStatusText(m) : 'Deadline';
  const mid = m.started ? `<span class="mh-score">${m.homePts} - ${m.awayPts}</span>` : `<span class="mh-time">${when || 'TBC'}</span>`;
  const side = (id: number, cls: string) =>
    `<a class="mh-team ${cls}" href="${href.team(id)}">${avatar(id, 48)}<span class="mh-team-text"><span class="mh-name">${first(id)}</span><span class="mh-sub">${esc(mgr(id)!.team)}</span></span></a>`;
  const l = lineups(m);
  const scorers = (lineup: Lineup | undefined) =>
    m.started && lineup
      ? [...lineup.xi]
          .filter((pid) => gwPoints(pid, m.gw) >= 6)
          .sort((a, b) => gwPoints(b, m.gw) - gwPoints(a, m.gw))
          .slice(0, 4)
          .map((pid) => `<a href="${href.player(pid)}">${esc(player(pid).name)} ${gwPoints(pid, m.gw)}</a>`)
          .join('')
      : '';
  return `<div class="mh${m.started ? '' : ' pre'}">
    <div class="mh-top"><a class="mh-back" href="${href.home(m.gw)}">${chevronSvg('left')}<span>Gameweek ${m.gw}</span></a><a class="mh-league" href="${href.league()}">${esc(D.meta.name)}</a></div>
    <div class="mh-date">${m.started ? `Gameweek ${m.gw}` : `Gameweek ${m.gw} · deadline ${when}`}</div>
    <div class="mh-main">${side(m.home, 'home')}<div class="mh-mid">${mid}<span class="mh-status">${status}</span></div>${side(m.away, 'away')}</div>
    ${m.started ? `<div class="mh-scorers"><div class="home">${scorers(l?.[0])}</div><div class="away">${scorers(l?.[1])}</div></div>` : ''}
  </div>`;
}

type Chances = ReturnType<typeof inPlayOdds>;

function facts(m: Match, steps: Step[]) {
  return `${m.started && lineups(m) ? momentumCard(m, steps) : ''}${lineupCard(m)}${teamFormCard(m)}`;
}

// Each side's last five head-to-heads before this one, side by side, as fotmob.com's Team
// form: the score between the two, coloured by how it went for the side, the latest first.
function teamFormCard(m: Match) {
  const column = (id: number) =>
    D.matches
      .filter((x) => x.finished && x.gw < m.gw && (x.home === id || x.away === id))
      .slice(-5)
      .reverse()
      .map((x, i) => {
        const [pf, pa] = x.home === id ? [x.homePts ?? 0, x.awayPts ?? 0] : [x.awayPts ?? 0, x.homePts ?? 0];
        const res = pf > pa ? 'W' : pf < pa ? 'L' : 'D';
        const side = (s: number) => `<span class="tf-side">${avatar(s, 22)}<span class="tf-name">${first(s)}</span></span>`;
        return `<a class="tf-row${i ? '' : ' latest'}" href="${href.match(x)}" data-tip="GW ${x.gw}">${side(x.home)}<span class="tf-score ${res}">${x.homePts ?? 0} - ${x.awayPts ?? 0}</span>${side(x.away)}</a>`;
      })
      .join('');
  const [home, away] = [column(m.home), column(m.away)];
  return home || away ? card({ title: 'Team form', body: `<div class="tf-cols"><div>${home}</div><div>${away}</div></div>` }) : '';
}

// The match report, or before the deadline its preview, under the round's matches.
function reportCard(m: Match, chances: Chances, steps: Step[]) {
  const l = lineups(m);
  const toPlay = (lineup: Lineup) =>
    live?.gw === m.gw
      ? lineup.xi.filter((pid) => ['due', 'live'].includes(playerState(live!.feed, pid, player(pid).club).state)).length
      : 0;
  const report = matchReport(D, m, {
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
function sideColumn(m: Match, chances: Chances, steps: Step[]) {
  const l = lineups(m);
  // Before kick-off fotmob.com's Who will win?; then untitled, as its odds: they're plainly the odds.
  const odds = card({
    title: m.started ? '' : 'Who will win?',
    cls: `odds-card${m.started ? '' : ' poll-card'}`,
    body: !m.started
      ? `<div class="match-detail">${winChances(m)}</div>`
      : `<div class="match-detail">${chances ? `<div><div class="detail-label">Live odds</div>${oddsRow(chances, m, null, true)}</div>` : ''}${preMatchOdds(m)}</div>`,
  });
  return [
    odds,
    roundMatches(m),
    reportCard(m, chances, steps),
    m.finished && m.xg
      ? card({
          title: 'Top stats',
          body: `<div class="match-detail">${expectedStats(m)}</div>`,
          footer: { href: href.match(m, 'stats'), label: 'All stats' },
        })
      : '',
    m.started && l ? topPlayersCard(m, l) : '',
    m.started && l ? benchCard(m, l) : '',
  ].join('');
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

// --- Momentum ------------------------------------------------------------------------

// The lead through the gameweek, as fotmob.com's momentum: a smooth area, up in the home
// side's colour while it leads and down in the away side's. The x-axis is playing time:
// each kick-off slot (the matches starting together) takes 90 minutes, over which its
// matches' points come in evenly, with a dotted line between match days as fotmob.com's
// at half-time, and the automatic substitutions half a slot of their own after the last.
// Under the pointer, every few minutes, a line down the plot and a dot on the lead, as
// fotmob.com marks the minute under it, with the tip of the slot it's in: the score after
// it, its matches and who scored what in them. While a match is being played a dot pulses
// at the lead as it stands.
const SUBS = 45;
const STEP = 5; // minutes between the marks

function momentumCard(m: Match, steps: Step[]) {
  if (!steps.length) return '';
  const byId = new Map(steps.flatMap((s) => (s.match ? [[s.match.id, s] as const] : [])));
  const subs = steps.find((s) => !s.match);
  const slots: { ko: string | null; matches: PlMatch[] }[] = [];
  for (const pm of plRound(m.gw)) {
    if (slots.at(-1)?.ko !== pm.ko) slots.push({ ko: pm.ko, matches: [] });
    slots.at(-1)!.matches.push(pm);
  }
  // The lead after each slot, as far into it as play has got.
  let lead = 0;
  const score: [number, number] = [0, 0];
  const points: [number, number][] = [[0, 0]];
  const tips: string[] = [];
  const count = (s: Step) => {
    lead += s.gained[0] - s.gained[1];
    score[0] += s.gained[0];
    score[1] += s.gained[1];
  };
  slots.forEach((slot, i) => {
    const played = slot.matches.flatMap((pm) => byId.get(pm.id) ?? []);
    played.forEach(count);
    const minuteOf = (pm: PlMatch) => {
      const s = plState(pm);
      return s.state === 'done' ? 90 : s.state === 'live' ? Math.min(90, s.min ?? 45) : 0;
    };
    const minute = Math.max(0, ...slot.matches.map(minuteOf));
    if (played.length && minute) points.push([i * 90 + minute, lead]);
    tips.push(slotTip(m, slot.matches, played, score));
  });
  if (subs) {
    count(subs);
    points.push([slots.length * 90 + SUBS, lead]);
    tips.push(subsTip(m, subs));
  }
  const width = slots.length * 90 + (subs ? SUBS : 0);
  const height = 100;
  const most = Math.max(4, ...points.map(([, v]) => Math.abs(v)));
  const y = (v: number) => height / 2 - (v / most) * (height / 2 - 4);
  const { path: curve, at: curveAt } = smoothCurve(points.map(([x, v]) => [x, y(v)]));
  const area = `${curve} L${points.at(-1)![0]},${height / 2} L0,${height / 2} Z`;
  const svg = `<svg class="mo-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
    <defs><clipPath id="mo-up"><rect x="0" y="0" width="${width}" height="${height / 2}"/></clipPath><clipPath id="mo-down"><rect x="0" y="${height / 2}" width="${width}" height="${height / 2}"/></clipPath></defs>
    <path d="${area}" fill="var(--m${slotOf(m.home)})" fill-opacity="0.9" clip-path="url(#mo-up)"/>
    <path d="${area}" fill="var(--m${slotOf(m.away)})" fill-opacity="0.9" clip-path="url(#mo-down)"/>
    <path d="${curve}" class="mo-edge" stroke="var(--m${slotOf(m.home)})" clip-path="url(#mo-up)" vector-effect="non-scaling-stroke"/>
    <path d="${curve}" class="mo-edge" stroke="var(--m${slotOf(m.away)})" clip-path="url(#mo-down)" vector-effect="non-scaling-stroke"/>
    <line x1="0" x2="${width}" y1="${height / 2}" y2="${height / 2}" class="mo-zero" vector-effect="non-scaling-stroke"/>
  </svg>`;
  const at = (x: number) => `${((x / width) * 100).toFixed(2)}%`;
  const dayOf = (ko: string | null) => (ko ? new Date(ko).toDateString() : '');
  const days = slots
    .flatMap((slot, i) => (i && dayOf(slot.ko) !== dayOf(slots[i - 1].ko) ? [`<i class="mo-day" style="left:${at(i * 90)}"></i>`] : []))
    .join('');
  let lastDay = '';
  const labels = slots
    .map((slot) => {
      const ko = slot.ko ? new Date(slot.ko) : null;
      const day = ko ? fmtWeekday.format(ko) : '';
      const label = ko ? `${day !== lastDay ? `${day} ` : ''}${fmtTime.format(ko)}` : 'TBC';
      lastDay = day;
      return `<span>${label}</span>`;
    })
    .join('');
  const narrow = `style="flex:${SUBS / 90}"`;
  // Each slot (and the substitutions) with its tip, over the marks in it: one every STEP
  // minutes, each the middle of its own stretch, and with a dot once the area has got there.
  const share = (x: number, of: number) => `${((x / of) * 100).toFixed(2)}%`;
  const reach = points.at(-1)![0];
  const stretch = (x: number) => [Math.max(0, x - STEP / 2), Math.min(width, x + STEP / 2)];
  const regions = [...slots.map((_, i) => [i * 90, i * 90 + 90]), ...(subs ? [[slots.length * 90, width]] : [])];
  const hits = regions
    .map(([start, end], r) => {
      const marks: number[] = [];
      for (let x = r ? start + STEP : 0; x <= end; x += STEP) marks.push(x);
      const [from, to] = [stretch(marks[0])[0], stretch(marks.at(-1)!)[1]];
      const cells = marks.map((x) => {
        const [left, right] = stretch(x);
        const on = x <= reach ? curveAt(x) : undefined;
        const ahead = on === undefined || Math.abs(on - height / 2) < 0.5 ? undefined : on < height / 2 ? m.home : m.away;
        const dot = on === undefined ? '' : `;--y:${share(on, height)}${ahead ? `;--dot:var(--m${slotOf(ahead)})` : ''}`;
        return `<span class="mo-cell" style="left:${share(left - from, to - from)};width:${share(right - left, to - from)}"><i class="mo-mark tip-at${on === undefined ? '' : ' lead'}" style="left:${share(x - left, right - left)}${dot}"></i></span>`;
      });
      return `<span class="mo-slot" tabindex="0" style="left:${at(from)};width:${at(to - from)}" ${tips[r]}>${cells.join('')}</span>`;
    })
    .join('');
  const legend = `<div class="legend"><span class="legend-item"><i class="m${slotOf(m.home)}" style="background:var(--av-bg)"></i>${first(m.home)} ahead</span><span class="legend-item"><i class="m${slotOf(m.away)}" style="background:var(--av-bg)"></i>${first(m.away)} ahead</span></div>`;
  const [nowX, nowLead] = points.at(-1)!;
  const now = slots.some((slot) => slot.matches.some((pm) => plState(pm).state === 'live'))
    ? `<i class="mo-now" style="left:${at(nowX)};top:${((y(nowLead) / height) * 100).toFixed(2)}%"></i>`
    : '';
  return card({
    title: 'Momentum',
    sub: `The lead through the gameweek${m.finished ? '' : ' so far'} · auto-subs come in at the end`,
    body: `<div class="momentum"><div class="mo-plot">${days}${svg}${now}<div class="mo-hits">${hits}</div></div><div class="mo-axis">${labels}${subs ? `<span ${narrow}>Subs</span>` : ''}</div></div>${legend}`,
  });
}

// With the live score while it's on, and saying so.
const matchName = (pm: PlMatch) => {
  const { state, score } = plState(pm);
  return `${club(pm.home)?.short} ${score ? `${score[0]}-${score[1]}` : 'v'} ${club(pm.away)?.short}${state === 'live' ? ', live' : ''}`;
};
const scorersOf = (s: Step, side: 0 | 1) =>
  s.scorers
    .filter(([, , x]) => x === side)
    .map(([pid, pts]) => `${player(pid)?.name ?? '?'} ${pts}`)
    .join(', ');
const sideRows = (m: Match, steps: Step[]) => {
  const gained = (side: 0 | 1) => sum(steps.map((s) => s.gained[side]));
  const who = (side: 0 | 1) =>
    steps
      .map((s) => scorersOf(s, side))
      .filter(Boolean)
      .join(', ');
  return [
    `${mgr(m.home)!.first}\t+${gained(0)}${who(0) ? ` (${who(0)})` : ''}`,
    `${mgr(m.away)!.first}\t+${gained(1)}${who(1) ? ` (${who(1)})` : ''}`,
  ].join('\n');
};

// A slot's tip: the score as it stood after its matches (as far as they've got), then the
// matches and what each side took from them, and who scored it.
function slotTip(m: Match, matches: PlMatch[], played: Step[], [home, away]: [number, number]) {
  const names = matches.map((pm) => (played.some((s) => s.match?.id === pm.id) ? matchName(pm) : `${matchName(pm)}, to come`));
  const head = [...(played.length ? [`${first(m.home)} ${home} - ${away} ${first(m.away)}`] : []), ...names].join('\n');
  const rows = played.length ? sideRows(m, played) : '';
  return `data-tip="${esc(head)}"${rows ? ` data-tip-rows="${esc(rows)}"` : ''}`;
}

// The automatic substitutions': the final score, and who came in for each side.
function subsTip(m: Match, s: Step) {
  const head = `${first(m.home)} ${s.score[0]} - ${s.score[1]} ${first(m.away)}\nAutomatic substitutions`;
  return `data-tip="${esc(head)}" data-tip-rows="${esc(sideRows(m, [s]))}"`;
}

// A smooth line through the points that never overshoots them: a monotone cubic, as
// fotmob.com's chart (and d3's curveMonotoneX) draws it, and its height at any x along it.
function smoothCurve(points: [number, number][]) {
  if (points.length < 2) return { path: `M${points[0][0]},${points[0][1]}`, at: () => points[0][1] };
  const n = points.length;
  const dx = points.slice(1).map(([x], i) => x - points[i][0]);
  const slope = points.slice(1).map(([, y], i) => (y - points[i][1]) / (dx[i] || 1));
  const tangent = points.map((_, i) => {
    if (i === 0) return slope[0];
    if (i === n - 1) return slope[n - 2];
    const [a, b] = [slope[i - 1], slope[i]];
    return a * b <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / a + (dx[i] + 2 * dx[i - 1]) / b);
  });
  let d = `M${points[0][0]},${points[0][1].toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const h = dx[i] / 3;
    d += ` C${(x0 + h).toFixed(2)},${(y0 + h * tangent[i]).toFixed(2)} ${(x1 - h).toFixed(2)},${(y1 - h * tangent[i + 1]).toFixed(2)} ${x1},${y1.toFixed(2)}`;
  }
  // Each piece's control points are a third of the way apart in x, so x runs evenly with t.
  const at = (x: number) => {
    let i = 0;
    while (i < n - 2 && x > points[i + 1][0]) i++;
    const [[x0, y0], [, y1]] = [points[i], points[i + 1]];
    const t = dx[i] ? (x - x0) / dx[i] : 0;
    const [c0, c1] = [y0 + (dx[i] / 3) * tangent[i], y1 - (dx[i] / 3) * tangent[i + 1]];
    return (1 - t) ** 3 * y0 + 3 * (1 - t) ** 2 * t * c0 + 3 * (1 - t) * t ** 2 * c1 + t ** 3 * y1;
  };
  return { path: d, at };
}

// --- Cards beside the pitch -------------------------------------------------------------

// Each side's best scorers in its XI.
function topPlayersCard(m: Match, [home, away]: [Lineup, Lineup]) {
  const rows = (id: number, l: Lineup) =>
    [...l.xi]
      .sort((a, b) => gwPoints(b, m.gw) - gwPoints(a, m.gw))
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

// --- Stats ---------------------------------------------------------------------------------

type Totals = Record<string, number>;

const COUNTED = ['goals', 'assists', 'bonus', 'cleanSheet', 'saves', 'defcon', 'pensSaved', 'pensMissed', 'ownGoals', 'yellow', 'red'];

// What an XI did: its players' gameweek from the real matches they played in (with the
// live relay's minutes and counts while it's on), and their underlying numbers once it's
// over.
function xiTotals(m: Match, l: Lineup): Totals {
  const t: Totals = {};
  const add = (key: string, n = 0) => (t[key] = (t[key] ?? 0) + n);
  for (const pid of l.xi) {
    const lines = linesIn(pid, m.gw);
    const fromMatches: Totals = {};
    for (const { m: pm } of lines)
      for (const [key, n] of Object.entries(pm.events?.[pid] ?? {})) fromMatches[key] = (fromMatches[key] ?? 0) + n;
    const ev: Totals = { ...fromMatches, ...((gwEvents(pid, m.gw) ?? {}) as PlayerEvents) };
    const minutes = live?.gw === m.gw ? (live.feed.elements[pid]?.[1] ?? 0) : sum(lines.map(({ line }) => line[1]));
    add('minutes', minutes);
    add('played', minutes > 0 ? 1 : 0);
    for (const key of COUNTED) add(key, ev[key]);
    const u = gwUnderlying(pid, m.gw);
    if (u) {
      add('xg', u[0]);
      add('xa', u[1]);
      add('xcs', u[3] ?? 0);
      if (['GKP', 'DEF'].includes(player(pid).pos)) add('xgc', u[4] ?? 0);
    }
  }
  add('bench', l.benchPts);
  add('subs', l.subs.length);
  return t;
}

// fotmob.com's stat rows: each side's value either side of the label, the higher in a
// pill of that side's colour.
function statRow(m: Match, label: string, [home, away]: [number, number], { digits = 0, percent = false, tip = '' } = {}) {
  const show = (v: number) => (percent ? pct(v) : v.toFixed(digits));
  const value = (v: number, id: number, higher: boolean) =>
    `<span class="xg-value${higher ? ` higher m${slotOf(id)}` : ''}">${show(v)}</span>`;
  return `<div class="xg-row">${value(home, m.home, home > away)}<span class="xg-label"${tip ? ` data-tip="${esc(tip)}"` : ''}>${label}</span>${value(away, m.away, away > home)}</div>`;
}

const section = (title: string, rows: (string | false | undefined)[]) => {
  const shown = rows.filter((r): r is string => Boolean(r));
  return shown.length ? card({ title, body: `<div class="match-detail stat-rows">${shown.join('')}</div>` }) : '';
};

function statsTab(m: Match) {
  const l = lineups(m);
  if (!m.started || !l) {
    const row = (id: number) => D.tables.overall.find((r) => r.id === id);
    const avg = (id: number) => (row(id)?.played ? row(id)!.pf / row(id)!.played : 0);
    const before = [
      m.odds && statRow(m, 'Win chance', [m.odds.p[0], m.odds.p[2]], { percent: true }),
      m.odds &&
        statRow(m, 'Projected points', m.odds.expected, {
          tip: 'The model’s score: the league average, plus how far each side’s best projected XI sits from the average one',
        }),
      statRow(m, 'Points a match this season', [avg(m.home), avg(m.away)], { digits: 1 }),
      statRow(m, 'Table points', [row(m.home)?.pts ?? 0, row(m.away)?.pts ?? 0]),
    ];
    return section('Before the match', before);
  }
  const [h, a] = [xiTotals(m, l[0]), xiTotals(m, l[1])];
  const v = (key: string): [number, number] => [h[key] ?? 0, a[key] ?? 0];
  const top = [
    statRow(m, 'Points', [m.homePts ?? 0, m.awayPts ?? 0]),
    m.xg &&
      statRow(m, 'Expected points (xP)', m.xg.xp, {
        digits: 1,
        tip: 'Each XI with goals, assists and clean sheets swapped for what the xG, xA and xGC were worth',
      }),
    m.xg &&
      statRow(m, 'Expected table points (xPTS)', m.xg.xPts, { digits: 1, tip: 'The table points both expected scores would have earned' }),
    m.odds && statRow(m, 'Projected before the deadline', m.odds.expected, { tip: 'The model’s score at the deadline' }),
    m.odds && statRow(m, 'Win chance at the deadline', [m.odds.p[0], m.odds.p[2]], { percent: true }),
    statRow(m, 'Points on the bench', v('bench')),
  ];
  const attack = [
    statRow(m, 'Goals', v('goals')),
    statRow(m, 'Assists', v('assists')),
    m.finished && statRow(m, 'Expected goals (xG)', v('xg'), { digits: 2 }),
    m.finished && statRow(m, 'Expected assists (xA)', v('xa'), { digits: 2 }),
    statRow(m, 'Bonus points', v('bonus')),
  ];
  const defence = [
    statRow(m, 'Clean sheets', v('cleanSheet'), { tip: 'Players in the XI who kept one, where it scores' }),
    m.finished && statRow(m, 'Expected clean sheets (xCS)', v('xcs'), { digits: 2 }),
    m.finished &&
      statRow(m, 'Expected goals conceded (xGC)', v('xgc'), {
        digits: 2,
        tip: 'By the goalkeepers and defenders in the XI, while they played',
      }),
    statRow(m, 'Saves', v('saves'), { tip: 'Counted by FPL once they score: three or more in a match' }),
    statRow(m, 'Defensive contributions', v('defcon'), {
      tip: 'Players who reached FPL’s threshold of tackles, clearances, blocks and interceptions',
    }),
    statRow(m, 'Penalties saved', v('pensSaved')),
  ];
  const squad = [
    statRow(m, 'Minutes played', v('minutes')),
    statRow(m, 'Players who played', v('played'), { tip: 'Of the eleven, after the automatic substitutions' }),
    statRow(m, 'Automatic substitutions', v('subs')),
  ];
  const discipline = [
    statRow(m, 'Yellow cards', v('yellow')),
    statRow(m, 'Red cards', v('red')),
    statRow(m, 'Own goals', v('ownGoals')),
    statRow(m, 'Penalties missed', v('pensMissed')),
  ];
  return [
    section('Top stats', top),
    section('Attack', attack),
    section('Defence', defence),
    section('Minutes', squad),
    section('Discipline', discipline),
  ].join('');
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

// A player's moment as fotmob.com marks it, at the bottom right of his photo.
function momentIcon(e: Entry, what = '') {
  if (what === 'Goal') return ballSvg();
  if (what === 'Own goal') return ownGoalSvg;
  if (what === 'Assist') return bootSvg();
  if (e.kind === 'yellow' || e.kind === 'red') return cardSvg(e.kind === 'red' || what === 'Second yellow');
  if (what === 'On' || what === 'Came in') return subSvg(true);
  if (what === 'Off' || what === 'Didn’t play' || what === 'Not in the squad') return subSvg(false);
  return '';
}

// fotmob.com's commentary, for the draft: everything either side's players did, the latest
// first (commentary.ts), each a box down the middle with its minute and what it was, its
// match, a row a player (his club, what he did and for whom, his points, his photo) and the
// head-to-head's score after it. The benches' players come in with the switch.
function commentaryCard(m: Match) {
  const title = 'Commentary';
  const l = lineups(m);
  if (!m.started || !l) return card({ title, body: empty('It starts with the gameweek’s first kick-off') });
  const file = statsFor(m.gw);
  if (file === 'loading') return card({ title, body: empty('Loading…') });
  if (file === 'missing') return card({ title, body: empty('Not in yet: it comes with the next update') });
  const entries = commentary(D, file, m, l, { bench: state.commentaryBench, now: live?.gw === m.gw ? live : undefined });
  const on = state.commentaryBench;
  const toggle = `<button type="button" class="cm-switch" role="switch" aria-checked="${on}" data-action="commentary-bench" data-value="${on ? 'off' : 'on'}"><span>Include benched players</span><span class="cm-track"><span class="cm-thumb"></span></span></button>`;
  const sideOf = (side: 0 | 1) => (side ? m.away : m.home);
  const box = (e: Entry) => {
    const sides = [...new Set(e.players.map((p) => p.side))];
    // A goal's minute in the colour of the side it's for, as fotmob.com's; the rest grey.
    const pill = (e.kind === 'goal' || e.kind === 'own') && sides.length === 1 ? `m${slotOf(sideOf(sides[0]))}` : 'neutral';
    const pm = e.match;
    const score = e.matchScore ? `${e.matchScore[0]} - ${e.matchScore[1]}` : 'v';
    const match = `<a class="cm-match" href="${href.plMatch(pm.id)}">${crest(pm.home, 16)}<span>${esc(club(pm.home)?.short ?? '?')} ${score} ${esc(club(pm.away)?.short ?? '?')}</span>${crest(pm.away, 16)}</a>`;
    const rows = e.players
      .map((p) => {
        const pl = player(p.pid);
        const other = p.other !== undefined ? ` for ${esc(player(p.other)?.name ?? '?')}` : '';
        const what = [p.what ? `${esc(p.what)}${other}` : '', p.bench ? 'on the bench' : ''].filter(Boolean).join(' · ');
        const icon = momentIcon(e, p.what);
        return `<a class="cm-player${p.bench ? ' bench' : ''}" href="${href.player(p.pid)}">
          ${crest(pl?.club, 28)}
          <span class="cm-who"><span class="cm-name">${esc(pl?.name ?? '?')}</span><span class="cm-what">${avatar(sideOf(p.side), 16)}<span>${what || first(sideOf(p.side))}</span></span></span>
          <span class="cm-pts">${p.pts ? signed(p.pts) : ''}</span>
          <span class="cm-face">${photo(p.pid, 40)}${icon ? `<span class="cm-icon">${icon}</span>` : ''}</span>
        </a>`;
      })
      .join('');
    // Roughly when it happened, in the reader's own time, and the score it left.
    const counts = e.players.some((p) => !p.bench && p.pts);
    const when = `<span class="cm-time" data-tip="Roughly when, your time">${fmtTime.format(new Date(e.at))}</span>`;
    const after = counts
      ? `<span class="cm-score">${first(m.home)} <strong>${e.score[0]} - ${e.score[1]}</strong> ${first(m.away)}</span>`
      : '';
    return `<div class="cm-entry ${e.kind}">
      <div class="cm-head"><span class="cm-min ${pill}">${e.minute}</span><span class="cm-title">${TITLES[e.kind]}</span></div>
      ${match}
      ${rows ? `<div class="cm-players">${rows}</div>` : ''}<div class="cm-foot">${when}${after}</div>
    </div>`;
  };
  return card({
    title,
    action: toggle,
    body: `<div class="cm-list">${entries.length ? entries.map(box).join('') : empty('Nothing yet')}</div>`,
  });
}

// --- Head-to-head --------------------------------------------------------------------------

// Every meeting this season, played or to come, as fotmob.com's head-to-head: the wins and
// draws as pills in each side's colours, then a row per meeting, its date and league above
// both sides and the score (or the deadline), this one picked out.
function headToHead(m: Match) {
  const meetings = D.matches.filter((x) => (x.home === m.home && x.away === m.away) || (x.home === m.away && x.away === m.home));
  const score = (x: Match, id: number) => (x.home === id ? (x.homePts ?? 0) : (x.awayPts ?? 0));
  const done = meetings.filter((x) => x.finished);
  const wins = (id: number) => done.filter((x) => score(x, id) > score(x, x.home === id ? x.away : x.home)).length;
  const draws = done.length - wins(m.home) - wins(m.away);
  const count = (n: number, label: string, cls: string) =>
    `<div class="h2h-count"><span class="h2h-badge ${cls}">${n}</span><span class="h2h-label">${label}</span></div>`;
  const summary = `<div class="h2h-sum">
    <a class="h2h-side" href="${href.team(m.home)}">${avatar(m.home, 40)}</a>
    <div class="h2h-counts">${count(wins(m.home), 'Wins', `m${slotOf(m.home)}`)}${count(draws, 'Draws', 'draw')}${count(wins(m.away), 'Wins', `m${slotOf(m.away)}`)}</div>
    <a class="h2h-side" href="${href.team(m.away)}">${avatar(m.away, 40)}</a>
  </div>`;
  const side = (id: number, cls: 'home' | 'away') =>
    `<span class="h2h-team ${cls}">${cls === 'away' ? avatar(id, 24) : ''}<span>${first(id)}</span>${cls === 'home' ? avatar(id, 24) : ''}</span>`;
  const rows = meetings
    .map((x) => {
      const deadline = gwInfo(x.gw)?.deadline;
      const mid = x.started ? `${x.homePts} - ${x.awayPts}` : deadline ? fmtTime.format(new Date(deadline)) : 'TBC';
      const where = matchStatus(x) === 'live' ? statusDot('live') : `${leagueSvg}<span>${esc(D.meta.name)}</span>`;
      return `<a class="h2h-row${x === m ? ' this' : ''}" href="${href.match(x)}">
        <span class="h2h-meta"><span>Gameweek ${x.gw}${deadline ? ` · ${fmtDate.format(new Date(deadline))}` : ''}</span><span class="h2h-where">${where}</span></span>
        <span class="h2h-line">${side(x.home, 'home')}<span class="h2h-score">${mid}</span>${side(x.away, 'away')}</span>
      </a>`;
    })
    .join('');
  return card({ body: `${summary}<div class="h2h-list">${rows}</div>` });
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
