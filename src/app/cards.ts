// Cards and rows used on more than one tab.

import type { Move, Retention, TopGameweek, Trade } from '../shared/data.ts';
import { avatar, card, crest, type Footer, listRow, playerName, playerPhoto, tag, teamName } from './components.ts';
import { ago, esc, maxOf, ordinal, pct, priceText, signed, sum } from './format.ts';
import { arrowSvg, swapSvg, triangleSvg } from './icons.ts';
import { first, gwPoints, lineupFor, player, slotOf, type Played } from './lookups.ts';
import { href } from './router.ts';
import { D } from './state.ts';
import { tableFrom } from './standings.ts';

// The prize's small print, last in both its rules tips.
export const dgwRule = () => `−${D.meta.dgwPenalty} per DGW player in the XI.`;

export const resultText = (g: TopGameweek) => {
  const oppPts = g.oppPts as number;
  return g.opp ? `${g.pts > oppPts ? 'Won' : g.pts < oppPts ? 'Lost' : 'Drew'} ${g.pts}-${g.oppPts} vs ${first(g.opp)}` : '';
};

export type FeedItem =
  { at: string; gw: number; move: Move; trade?: undefined } | { at: string; gw: number; trade: Trade; move?: undefined };

export function feed(): FeedItem[] {
  const singles = D.transfers.moves.filter((mv) => mv.type !== 'trade').map((mv) => ({ at: mv.at, gw: mv.gw, move: mv }));
  const trades = D.transfers.trades.filter((t) => t.state === 'p').map((t) => ({ at: t.at, gw: t.gw, trade: t }));
  return [...singles, ...trades].sort((a, b) => b.at.localeCompare(a.at));
}

export const MOVE_TYPES = { waiver: 'Waiver', free: 'Free agent', trade: 'Trade' };

export function feedRow(item: FeedItem) {
  if (item.trade) {
    const t = item.trade;
    const names = (ids: number[]) => ids.map(playerName).join(', ');
    return listRow({
      lead: `<span class="swap-icon">${swapSvg}</span>`,
      title: `${teamName(t.offeredBy)} ⇄ ${teamName(t.offeredTo)}`,
      meta: `${first(t.offeredBy)} gets ${names(t.items.map((i) => i.gets))} · ${first(t.offeredTo)} gets ${names(t.items.map((i) => i.gives))} · ${ago(t.at)}`,
      value: tag('Trade'),
    });
  }
  const mv = item.move;
  const pin = player(mv.in);
  const net =
    mv.net != null
      ? ` · <span data-tip="Points since: ${esc(pin.name)} ${mv.inPts}, ${esc(player(mv.out).name)} ${mv.outPts}">${signed(mv.net)} net</span>`
      : '';
  return listRow({
    lead: playerPhoto(mv.in),
    title: `<span class="arrow-in" aria-label="In">${arrowSvg}</span>${playerName(mv.in)} ${crest(pin.club, 14)}`,
    meta: `<span class="arrow-out" aria-label="Out">${arrowSvg}</span>${playerName(mv.out)} · ${MOVE_TYPES[mv.type]} · ${ago(mv.at)}${net}`,
    value: `<a href="${href.team(mv.manager)}">${avatar(mv.manager, 24)}</a>`,
  });
}

export function squadStrip(r: Retention) {
  const dots = Array.from({ length: r.size }, (_, i) => `<i class="${i < r.kept.length ? `on m${slotOf(r.id)}` : ''}"></i>`).join('');
  return `<span class="strip" data-tip="${r.kept.length} of ${r.size} draft picks still in the squad">${dots}</span>`;
}

// --- Gameweek review ----------------------------------------------------------------

// A manager's score in a match, beside the opponent's.
interface Score {
  id: number;
  pts: number;
  opp: number;
  oppPts: number;
  over: boolean;
}

const scoresIn = (m: Played): Score[] => [
  { id: m.home, pts: m.homePts, opp: m.away, oppPts: m.awayPts, over: m.finished },
  { id: m.away, pts: m.awayPts, opp: m.home, oppPts: m.homePts, over: m.finished },
];

// A match still being played is led, trailed or level, not won or lost.
function verdict(s: Score) {
  const [ahead, behind, level] = s.over ? ['beat', 'lost to', 'drew with'] : ['leads', 'trails', 'level with'];
  return `${s.pts > s.oppPts ? ahead : s.pts < s.oppPts ? behind : level} ${first(s.opp)} ${s.pts}-${s.oppPts}`;
}

const margin = (m: Played) => Math.abs(m.homePts - m.awayPts);
const winnerOf = (m: Played) => (m.homePts > m.awayPts ? { id: m.home, loser: m.away, side: 0 } : { id: m.away, loser: m.home, side: 2 });

// The winner (or the leader) first; a draw as it stands, home first.
function matchText(m: Played) {
  if (!margin(m)) return `${first(m.home)} ${m.homePts}-${m.awayPts} ${first(m.away)}`;
  const { id, loser } = winnerOf(m);
  return `${first(id)} ${Math.max(m.homePts, m.awayPts)}-${Math.min(m.homePts, m.awayPts)} ${first(loser)}`;
}

export function gameweekReviewCard(gw: number, { limit = Infinity, footer = null as Footer | null } = {}) {
  const games = D.matches.filter((m) => m.gw === gw && m.started) as Played[];
  if (!games.length) return '';
  const live = games.some((m) => !m.finished);
  const scores = games.flatMap(scoresIn);
  const decided = games.filter((m) => margin(m) > 0);
  const biggest = maxOf(decided, margin);
  const top = maxOf(scores, (s) => s.pts);
  const low = maxOf(scores, (s) => -s.pts);
  const rows = [
    scoreRow('Top score', top, true),
    starRow(gw),
    biggest && marginRow(biggest.finished ? 'Biggest win' : 'Biggest lead', biggest),
    upsetRow(decided),
    ...moverRows(gw, live),
    signingRow(gw),
    benchRow(gw),
    closestRow(games, biggest),
    scoreRow('Lowest score', low),
  ].filter(Boolean);
  const average = Math.round(sum(scores.map((s) => s.pts)) / scores.length);
  return card({
    title: `Gameweek ${gw} ${live ? 'so far' : 'review'}`,
    sub: `Average score ${average}${live ? ' · live' : ''}`,
    body: `<div class="list">${rows.slice(0, limit).join('')}</div>`,
    footer,
  });
}

function scoreRow(title: string, s: Score | undefined, top = false) {
  if (!s) return '';
  return listRow({ lead: avatar(s.id, 32), title, meta: `${first(s.id)} · ${verdict(s)}`, value: s.pts, top });
}

function starRow(gw: number) {
  const star = maxOf(
    D.managers.flatMap((mg) => (lineupFor(mg.id, gw)?.xi ?? []).map((pid) => ({ pid, id: mg.id, pts: gwPoints(pid, gw) }))),
    (x) => x.pts,
  );
  if (!star) return '';
  return listRow({
    lead: playerPhoto(star.pid),
    title: 'Player of the week',
    meta: `${playerName(star.pid)} ${crest(player(star.pid).club, 14)} · for ${teamName(star.id)}`,
    value: star.pts,
  });
}

const marginRow = (title: string, m: Played) =>
  listRow({
    lead: `<span class="stack">${avatar(m.home, 24)}${avatar(m.away, 24)}</span>`,
    title,
    meta: matchText(m),
    value: margin(m) ? `+${margin(m)}` : m.finished ? 'Draw' : 'Level',
  });

// The closest match, unless it is the biggest win too.
function closestRow(games: Played[], biggest: Played | undefined) {
  const closest = maxOf(games, (m) => -margin(m)); // a draw is as close as it gets
  if (!closest || closest === biggest) return '';
  return marginRow('Closest match', closest);
}

// The winner the pre-match odds liked least, if they were the outsider.
function upsetRow(decided: Played[]) {
  const upset = maxOf(
    decided
      .filter((m) => m.odds)
      .map((m) => ({ ...winnerOf(m), over: m.finished, p: m.odds!.p[winnerOf(m).side], price: m.odds!.prices[winnerOf(m).side] }))
      .filter((u) => u.p < 0.4),
    (u) => -u.p,
  );
  if (!upset) return '';
  return listRow({
    lead: avatar(upset.id, 32),
    title: 'Upset',
    meta: `${first(upset.id)} ${upset.over ? 'beat' : 'leads'} ${first(upset.loser)} at ${priceText(upset.price)}`,
    value: pct(upset.p),
  });
}

// The biggest climb and fall in the table since the gameweek before.
function moverRows(gw: number, live: boolean) {
  if (gw <= D.meta.firstGw) return [];
  const before = tableFrom(D.matches.filter((m) => m.started && m.gw < gw));
  const after = tableFrom(D.matches.filter((m) => m.started && m.gw <= gw));
  const movers = after.map((r) => ({ id: r.id, rank: r.rank, change: before.find((b) => b.id === r.id)!.rank - r.rank }));
  const climber = maxOf(
    movers.filter((x) => x.change > 0),
    (x) => x.change,
  );
  const faller = maxOf(
    movers.filter((x) => x.change < 0),
    (x) => -x.change,
  );
  const stands = live ? ' as it stands' : '';
  return [
    climber && moverRow('Climber', climber, `up to ${ordinal(climber.rank)}${stands}`, 'good'),
    faller && moverRow('Faller', faller, `down to ${ordinal(faller.rank)}${stands}`, 'bad'),
  ];
}

const moverRow = (title: string, x: { id: number; change: number }, meta: string, tone: string) =>
  listRow({
    lead: avatar(x.id, 32),
    title,
    meta: `${first(x.id)}, ${meta}`,
    value: `<span class="rank-delta ${tone}">${triangleSvg}${Math.abs(x.change)}</span>`,
  });

function signingRow(gw: number) {
  const signing = maxOf(
    D.transfers.moves
      .filter((mv) => mv.gw === gw && player(mv.in))
      .map((mv) => ({ mv, pts: gwPoints(mv.in, gw) }))
      .filter((s) => s.pts > 0),
    (s) => s.pts,
  );
  if (!signing) return '';
  return listRow({
    lead: playerPhoto(signing.mv.in),
    title: 'Best new signing',
    meta: `${playerName(signing.mv.in)} · ${MOVE_TYPES[signing.mv.type]} for ${teamName(signing.mv.manager)}`,
    value: signing.pts,
  });
}

// Who left the most points on the bench, if anyone left any.
function benchRow(gw: number) {
  const bench = maxOf(
    D.managers.map((mg) => ({ id: mg.id, pts: lineupFor(mg.id, gw)?.benchPts ?? 0 })).filter((b) => b.pts > 0),
    (b) => b.pts,
  );
  return bench ? listRow({ lead: avatar(bench.id, 32), title: 'Left on the bench', meta: first(bench.id), value: bench.pts }) : '';
}
