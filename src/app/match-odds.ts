// A head-to-head's odds: the 1X2 row, the pre-match odds and who will win, and the live
// odds while it's played, from where each lineup's score is heading.

import type { Match, Odds } from '../shared/data.ts';
import { inPlayOddsIn, liveExpectedIn, playerInfoIn, projectionIn } from '../shared/in-play.ts';
import { playerOutlook, type Expected } from '../shared/live-projection.ts';
import { playerState, type Scored } from '../shared/live.ts';
import { avatar, empty, seg } from './components.ts';
import { esc, pct, priceText } from './format.ts';
import { mgr, player } from './lookups.ts';
import { D, live, state } from './state.ts';
import { statsFor, toComeRows } from './stats-files.ts';

// `outcome` (0 home, 1 draw, 2 away) settles the row the way fotmob.com does after full
// time: the losing selections go grey with their price struck through.
export function oddsRow(odds: Pick<Odds, 'p' | 'prices'>, m: Match, outcome: number | null = null, inPlay = false) {
  const labels = ['1', 'X', '2'];
  const who = [`${mgr(m.home)!.first} to win`, 'Draw', `${mgr(m.away)!.first} to win`];
  return `<div class="odds${inPlay ? ' in-play' : ''}">${odds.prices
    .map(
      (price, i) =>
        `<span class="odd${outcome !== null && i !== outcome ? ' lost' : ''}" data-tip="${esc(who[i])} · ${pct(odds.p[i])} chance${inPlay ? ' (live)' : ''}"><span class="odd-label">${labels[i]}</span><span class="odd-price">${priceText(price)}</span></span>`,
    )
    .join('')}</div>`;
}

// What a live projection expects of each player (liveExpectedIn): his expected points by
// the cog's setting, and the stats of the matches being played as the page has them, with
// the relay's laid over the stats file.
function liveExpected(gw: number): Expected {
  return liveExpectedIn(D, gw, state.xp === 'fpl', (fixture) => {
    const file = statsFor(gw);
    return typeof file === 'object' ? file.matches[fixture] : undefined;
  });
}

// Where a live lineup's score is heading: its points so far, plus the expected points for
// whatever its XI still has to play from where its matches stand, with the auto-subs it can
// count on, the uncertainty shrinking as games finish (see liveProjection). The live odds
// come from it, and so does the lineup's Projected total.
export function projectionOf(scored: Scored, gw: number) {
  return projectionIn(D, scored, live!.feed, liveExpected(gw));
}

/**
 * Where a player's gameweek is heading while it's played, as the live odds see it, and what
 * he has still to come by where it would come from (ToCome); nothing once it's over for him.
 */
export function projectionFor(pid: number, gw: number | undefined) {
  if (!live || live.gw !== gw) return undefined;
  const now = playerState(live.feed, pid, player(pid)?.club).state;
  return now === 'done' || now === 'blank' ? undefined : playerOutlook(pid, live.feed, playerInfoIn(D), liveExpected(gw));
}

/** The same as a points pill's options (ptsPill): where he's heading, and what's still to come as its tip's rows. */
export function projectedPill(pid: number, gw: number | undefined): { projected?: number; toCome?: [string, number][] } {
  const p = projectionFor(pid, gw);
  return p ? { projected: p.projected, toCome: toComeRows(p.toCome) } : {};
}

/** Live odds for a match in play (the build records the same at each build: src/build/in-play.ts). */
export function inPlayOdds(m: Match) {
  const home = live?.gw === m.gw ? live.lineups[m.home] : undefined;
  const away = live?.gw === m.gw ? live.lineups[m.away] : undefined;
  if (!home || !away) return null;
  return inPlayOddsIn(D, [home, away], live!.feed, liveExpected(m.gw));
}

const ODDS_MADE = {
  deadline: { tip: 'The odds at the deadline', label: '· at the deadline' },
  afterwards: {
    tip: 'Worked out afterwards from each side’s projected XI, with only the gameweeks before it to go on',
    label: '· worked out afterwards',
  },
};

export function preMatchOdds(m: Match) {
  if (!m.odds) return '';
  const { tip, label } = ODDS_MADE[m.odds.afterwards ? 'afterwards' : 'deadline'];
  // Faded while the match is on, under the live odds.
  return `<div class="detail-odds${m.started && !m.finished ? ' faded' : ''}"><div class="detail-label">Pre-match odds <span class="muted" data-tip="${tip}">${label}</span></div>${oddsRow(m.odds, m, outcomeOf(m))}</div>`;
}

// 0 for a home win, 1 for a draw and 2 for an away win, once it's over.
function outcomeOf(m: Match) {
  if (!m.finished) return null;
  return m.homePts! > m.awayPts! ? 0 : m.homePts === m.awayPts ? 1 : 2;
}

// Before kick-off, as fotmob.com's Who will win?: each side's chance under its avatar and
// the draw's under an X, the odds under them, and the score they come from: the card when
// there's no poll to show (match-poll.ts).
export function winChances(m: Match) {
  if (!m.odds) return empty('Odds go up three gameweeks before the deadline');
  const [ph, pd, pa] = m.odds.p;
  const side = (face: string, p: number, cls = '') => `<div class="poll-side${cls}">${face}<span>${pct(p)}</span></div>`;
  return `<div class="poll">${side(avatar(m.home, 48), ph)}${side('<span class="poll-x">X</span>', pd, ' draw')}${side(avatar(m.away, 48), pa)}</div>
    ${modelOdds(m)}`;
}

/** The odds under Who will win?, and the score they come from; under a poll, whose shares take their place above, the model's chances too. */
export function modelOdds(m: Match, withChances = false) {
  if (!m.odds) return '';
  const [eh, ea] = m.odds.expected;
  const how = D.meta.hasProjections
    ? 'the league average, plus how far each side’s best projected XI sits from the average one'
    : 'the league average, until there are projections';
  const chances = withChances
    ? `<span data-tip="The odds model’s chances of a home win, a draw and an away win">Model ${m.odds.p.map(pct).join(' · ')}</span>`
    : '';
  return `${oddsRow(m.odds, m)}
    <div class="prob-score">${chances}<span data-tip="The model’s score: ${how}">Projected ${eh.toFixed(1)} – ${ea.toFixed(1)}</span></div>`;
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
