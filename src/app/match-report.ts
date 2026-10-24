// A few sentences on a head-to-head match, written from the numbers, as fotmob.com's
// match insights: before it, who the odds like and how the last meeting went; while it is
// on, who leads, with how many still to play and whose points; after it, who won and how,
// what decided it, an upset, a comeback, an auto-sub that came good and a bench that had
// the win in it. Either way, a haul left on a bench.
// Each is plain text, for the page to escape, with the side it's about.

import { bestXi } from '../shared/best-xi.ts';
import type { Data, Lineup, Match } from '../shared/data.ts';
import type { Step } from './momentum.ts';

/** A sentence, and the manager it's about, if it's about one side. */
export interface ReportLine {
  text: string;
  side?: number;
}

export interface ReportContext {
  lineup: (id: number) => Lineup | undefined;
  /** A player's points in the match's gameweek. */
  points: (pid: number) => number;
  momentum: Step[];
  /** While it is on: each side's players still to play, and the live chances (home, draw, away). */
  toPlay?: [number, number];
  chances?: [number, number, number];
}

const pctOf = (p: number) => `${Math.round(p * 100)}%`;
const pts = (n: number) => `${n} ${n === 1 ? 'point' : 'points'}`;
const and = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : (xs[0] ?? ''));

export function matchReport(data: Data, m: Match, ctx: ReportContext): ReportLine[] {
  const name = (id: number) => data.managers.find((mg) => mg.id === id)?.first ?? '?';
  const playerName = (pid: number) => data.players[pid]?.name ?? '?';
  if (!m.started) return preview(data, m, name);
  const [hp, ap] = [m.homePts ?? 0, m.awayPts ?? 0];
  const lines: ReportLine[] = [];
  const say = (text: string, side?: number) => lines.push(side === undefined ? { text } : { text, side });
  const homeWon = hp > ap;
  const [winner, loser] = homeWon ? [m.home, m.away] : [m.away, m.home];
  const [wp, lp] = [Math.max(hp, ap), Math.min(hp, ap)];
  const margin = wp - lp;

  if (!m.finished) {
    const [hLeft, aLeft] = ctx.toPlay ?? [0, 0];
    const left = ctx.toPlay ? `, with ${hLeft} still to play for ${name(m.home)} and ${aLeft} for ${name(m.away)}` : '';
    if (margin) say(`${name(winner)} leads ${name(loser)} ${wp}–${lp}${left}.`, winner);
    else say(`${name(m.home)} and ${name(m.away)} are level at ${hp}–${ap}${left}.`);
    if (ctx.chances) {
      const [h, , a] = ctx.chances;
      const [fav, p] = h >= a ? [m.home, h] : [m.away, a];
      say(`As it stands, ${name(fav)} has a ${pctOf(p)} chance of winning it.`, fav);
    }
  } else if (!margin) {
    say(`${name(m.home)} and ${name(m.away)} drew ${hp}–${ap}.`);
  } else {
    const verb = margin >= 25 ? 'thrashed' : margin <= 3 ? 'edged' : 'beat';
    say(`${name(winner)} ${verb} ${name(loser)} ${wp}–${lp}.`, winner);
    const side = homeWon ? 0 : 2;
    if (m.odds && m.odds.p[side] < 0.35) say(`An upset: ${name(winner)} had a ${pctOf(m.odds.p[side])} chance at the deadline.`, winner);
  }

  // The leader's top scorer, and whether the lead is down to those points: decided only once
  // it's over, so while it's on just his share of them.
  const xi = (id: number) => ctx.lineup(id)?.xi ?? [];
  const star = [...xi(winner)].sort((a, b) => ctx.points(b) - ctx.points(a))[0];
  const [starName, starPts] = star === undefined ? ['', 0] : [playerName(star), ctx.points(star)];
  if (!m.finished) {
    if (margin && starPts >= 5 && (starPts > margin || starPts >= 10))
      say(`${starName} has ${starPts} of ${name(winner)}’s ${wp} points so far.`, winner);
  } else if (margin && starPts > margin)
    say(`${starName} made the difference: ${pts(starPts)} for ${name(winner)}, more than the margin.`, winner);
  else if (starPts >= 10) say(`${starName} led the way with ${pts(starPts)}.`, winner);

  // A comeback: the deficit the winner (or leader) came back from, Premier League match by match.
  const behind = Math.max(0, ...ctx.momentum.map((s) => s.score[homeWon ? 1 : 0] - s.score[homeWon ? 0 : 1]));
  if (margin && behind >= 5) say(`${name(winner)} ${m.finished ? 'came' : 'has come'} back from ${pts(behind)} down.`, winner);

  // An automatic substitute who came good for either side.
  for (const id of [winner, loser]) {
    const l = ctx.lineup(id);
    const best = [...(l?.subs ?? [])].sort((a, b) => ctx.points(b) - ctx.points(a))[0];
    if (best !== undefined && ctx.points(best) >= 5) {
      say(`${playerName(best)} came on as an automatic substitute for ${name(id)} and scored ${pts(ctx.points(best))}.`, id);
      break;
    }
  }

  // A bench that had the win in it: the loser's best XI from all fifteen, the formation kept.
  const swap = m.finished && margin ? benchSwap(data, ctx, loser) : null;
  const winning = swap && swap.gain > margin ? swap : null;
  if (winning)
    say(`${name(loser)}’s bench had the win in it: ${winning.in} for ${winning.out} would have made it ${lp + winning.gain}–${wp}.`, loser);

  // A double-figure haul on either bench, where it doesn't count (the loser's is in the line
  // above if it had the win in it).
  for (const id of [winner, loser]) {
    const best = [...(ctx.lineup(id)?.bench ?? [])].sort((a, b) => ctx.points(b) - ctx.points(a))[0];
    if (best === undefined || ctx.points(best) < 10 || (id === loser && winning)) continue;
    say(`${name(id)} ${m.finished ? 'left' : 'has'} ${playerName(best)} on the bench, with ${pts(ctx.points(best))}.`, id);
  }

  // The week's best score.
  const week = data.matches.filter((x) => x.gw === m.gw && x.started).flatMap((x) => [x.homePts ?? 0, x.awayPts ?? 0]);
  if (m.finished && margin && wp === Math.max(...week) && week.filter((x) => x === wp).length === 1)
    say(`Nobody scored more in gameweek ${m.gw} than ${name(winner)}’s ${wp}.`, winner);
  return lines;
}

// The most a side's XI could have scored from its squad in hindsight, its formation kept:
// who would have come in, for whom, and the points gained. Of the XIs that score the most,
// the one keeping most of the XI that played, so no swap is of two on the same points.
function benchSwap(data: Data, ctx: ReportContext, id: number) {
  const l = ctx.lineup(id);
  const limits = data.meta.xiLimits;
  if (!l || !limits) return null;
  const kept = new Set(l.xi);
  const value = (pid: number) => ctx.points(pid) + (kept.has(pid) ? 1e-6 : 0);
  const best = bestXi([...l.xi, ...l.bench], value, (pid) => data.players[pid]?.pos, limits, l.xi.length);
  const names = (ids: number[]) => and(ids.map((pid) => data.players[pid]?.name ?? '?'));
  return {
    gain: Math.round(best.pts - l.xi.reduce((total, pid) => total + value(pid), 0)),
    in: names(best.ids.filter((pid) => !l.xi.includes(pid))),
    out: names(l.xi.filter((pid) => !best.ids.includes(pid))),
  };
}

function preview(data: Data, m: Match, name: (id: number) => string): ReportLine[] {
  const lines: ReportLine[] = [];
  const say = (text: string, side?: number) => lines.push(side === undefined ? { text } : { text, side });
  if (m.odds) {
    const [h, d, a] = m.odds.p;
    if (Math.abs(h - a) < 0.05)
      say(`Too close to call: ${pctOf(h)} for ${name(m.home)}, ${pctOf(a)} for ${name(m.away)} and ${pctOf(d)} for a draw.`);
    else {
      const [fav, other, p] = h > a ? [m.home, m.away, h] : [m.away, m.home, a];
      say(`${name(fav)} is the favourite against ${name(other)}, with a ${pctOf(p)} chance of winning.`, fav);
    }
    say(`The model has it ${m.odds.expected[0]}–${m.odds.expected[1]}.`);
  }
  const met = data.matches
    .filter((x) => x.finished && x.gw < m.gw && ((x.home === m.home && x.away === m.away) || (x.home === m.away && x.away === m.home)))
    .sort((a, b) => b.gw - a.gw)[0];
  if (met) {
    const [hp, ap] = [met.homePts ?? 0, met.awayPts ?? 0];
    const result = hp === ap ? `drew ${hp}–${ap}` : `${name(hp > ap ? met.home : met.away)} won ${Math.max(hp, ap)}–${Math.min(hp, ap)}`;
    say(
      `When they met in gameweek ${met.gw}, ${hp === ap ? `they ${result}` : result}.`,
      hp === ap ? undefined : hp > ap ? met.home : met.away,
    );
  } else say('Their first meeting this season.');
  return lines;
}
