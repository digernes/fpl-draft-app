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

/** A match under way or over, as every sentence about it sees it: who leads (or won) and by how much. */
interface Standing {
  data: Data;
  m: Match;
  ctx: ReportContext;
  name: (id: number) => string;
  playerName: (pid: number) => string;
  homeWon: boolean;
  /** The side ahead, or the away side when level. */
  winner: number;
  loser: number;
  wp: number;
  lp: number;
  margin: number;
}

const pctOf = (p: number) => `${Math.round(p * 100)}%`;
const pts = (n: number) => `${n} ${n === 1 ? 'point' : 'points'}`;
const and = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : (xs[0] ?? ''));
const line = (text: string, side?: number): ReportLine => (side === undefined ? { text } : { text, side });
const managerName = (data: Data) => (id: number) => data.managers.find((mg) => mg.id === id)?.first ?? '?';
const top = (pids: number[] | undefined, points: (pid: number) => number) => [...(pids ?? [])].sort((a, b) => points(b) - points(a))[0];

export function matchReport(data: Data, m: Match, ctx: ReportContext): ReportLine[] {
  if (!m.started) return preview(data, m, managerName(data));
  const s = standing(data, m, ctx);
  const swap = winningSwap(s);
  return [
    ...(m.finished ? result(s) : soFar(s)),
    ...star(s),
    ...comeback(s),
    ...autoSub(s),
    ...(swap
      ? [
          line(
            `${s.name(s.loser)}’s bench had the win in it: ${swap.in} for ${swap.out} would have made it ${s.lp + swap.gain}–${s.wp}.`,
            s.loser,
          ),
        ]
      : []),
    // The loser's bench haul is in the line above if it had the win in it.
    ...benchHauls(s, swap ? [s.winner] : [s.winner, s.loser]),
    ...weekBest(s),
  ];
}

function standing(data: Data, m: Match, ctx: ReportContext): Standing {
  const [hp, ap] = [m.homePts ?? 0, m.awayPts ?? 0];
  const homeWon = hp > ap;
  const [winner, loser] = homeWon ? [m.home, m.away] : [m.away, m.home];
  const [wp, lp] = [Math.max(hp, ap), Math.min(hp, ap)];
  const playerName = (pid: number) => data.players[pid]?.name ?? '?';
  return { data, m, ctx, name: managerName(data), playerName, homeWon, winner, loser, wp, lp, margin: wp - lp };
}

// While it's on: who leads, with how many still to play, and the live chances.
function soFar({ m, ctx, name, winner, loser, wp, lp, margin }: Standing): ReportLine[] {
  const left = ctx.toPlay ? `, with ${ctx.toPlay[0]} still to play for ${name(m.home)} and ${ctx.toPlay[1]} for ${name(m.away)}` : '';
  const score = margin
    ? line(`${name(winner)} leads ${name(loser)} ${wp}–${lp}${left}.`, winner)
    : line(`${name(m.home)} and ${name(m.away)} are level at ${wp}–${lp}${left}.`);
  if (!ctx.chances) return [score];
  const [h, , a] = ctx.chances;
  const [fav, p] = h >= a ? [m.home, h] : [m.away, a];
  return [score, line(`As it stands, ${name(fav)} has a ${pctOf(p)} chance of winning it.`, fav)];
}

// Once it's over: who won and how, and whether that was an upset.
function result({ m, name, homeWon, winner, loser, wp, lp, margin }: Standing): ReportLine[] {
  if (!margin) return [line(`${name(m.home)} and ${name(m.away)} drew ${wp}–${lp}.`)];
  const verb = margin >= 25 ? 'thrashed' : margin <= 3 ? 'edged' : 'beat';
  const lines = [line(`${name(winner)} ${verb} ${name(loser)} ${wp}–${lp}.`, winner)];
  const chance = m.odds?.p[homeWon ? 0 : 2];
  if (chance !== undefined && chance < 0.35)
    lines.push(line(`An upset: ${name(winner)} had a ${pctOf(chance)} chance at the deadline.`, winner));
  return lines;
}

// The leader's top scorer, and whether the lead is down to those points: decided only once
// it's over, so while it's on just his share of them.
function star(s: Standing): ReportLine[] {
  const pid = top(s.ctx.lineup(s.winner)?.xi, s.ctx.points);
  if (pid === undefined) return [];
  return (s.m.finished ? starOfMatch : starSoFar)(s, s.playerName(pid), s.ctx.points(pid));
}

function starSoFar({ name, winner, wp, margin }: Standing, who: string, n: number): ReportLine[] {
  const telling = n > margin || n >= 10;
  return margin && n >= 5 && telling ? [line(`${who} has ${n} of ${name(winner)}’s ${wp} points so far.`, winner)] : [];
}

function starOfMatch({ name, winner, margin }: Standing, who: string, n: number): ReportLine[] {
  if (margin && n > margin) return [line(`${who} made the difference: ${pts(n)} for ${name(winner)}, more than the margin.`, winner)];
  return n >= 10 ? [line(`${who} led the way with ${pts(n)}.`, winner)] : [];
}

// A comeback: the deficit the winner (or leader) came back from, Premier League match by match.
function comeback({ m, ctx, name, homeWon, winner, margin }: Standing): ReportLine[] {
  const [us, them] = homeWon ? [0, 1] : [1, 0];
  const behind = Math.max(0, ...ctx.momentum.map((step) => step.score[them] - step.score[us]));
  return margin && behind >= 5 ? [line(`${name(winner)} ${m.finished ? 'came' : 'has come'} back from ${pts(behind)} down.`, winner)] : [];
}

// An automatic substitute who came good for either side.
function autoSub({ ctx, name, playerName, winner, loser }: Standing): ReportLine[] {
  for (const id of [winner, loser]) {
    const pid = top(ctx.lineup(id)?.subs, ctx.points);
    if (pid !== undefined && ctx.points(pid) >= 5)
      return [line(`${playerName(pid)} came on as an automatic substitute for ${name(id)} and scored ${pts(ctx.points(pid))}.`, id)];
  }
  return [];
}

// A bench that had the win in it: the loser's best XI from all fifteen, the formation kept.
function winningSwap({ data, m, ctx, loser, margin }: Standing) {
  if (!m.finished || !margin) return null;
  const swap = benchSwap(data, ctx, loser);
  return swap && swap.gain > margin ? swap : null;
}

// A double-figure haul on the benches of these sides, where it doesn't count.
function benchHauls({ m, ctx, name, playerName }: Standing, ids: number[]): ReportLine[] {
  return ids.flatMap((id) => {
    const pid = top(ctx.lineup(id)?.bench, ctx.points);
    if (pid === undefined || ctx.points(pid) < 10) return [];
    return [line(`${name(id)} ${m.finished ? 'left' : 'has'} ${playerName(pid)} on the bench, with ${pts(ctx.points(pid))}.`, id)];
  });
}

// The week's best score.
function weekBest({ data, m, name, winner, wp, margin }: Standing): ReportLine[] {
  if (!m.finished || !margin) return [];
  const week = data.matches.filter((x) => x.gw === m.gw && x.started).flatMap((x) => [x.homePts ?? 0, x.awayPts ?? 0]);
  const alone = wp === Math.max(...week) && week.filter((x) => x === wp).length === 1;
  return alone ? [line(`Nobody scored more in gameweek ${m.gw} than ${name(winner)}’s ${wp}.`, winner)] : [];
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
  return [...odds(m, name), lastMeeting(data, m, name)];
}

// Who the odds like, and the score the model expects.
function odds(m: Match, name: (id: number) => string): ReportLine[] {
  if (!m.odds) return [];
  const [h, d, a] = m.odds.p;
  const [fav, other, p] = h > a ? [m.home, m.away, h] : [m.away, m.home, a];
  const call =
    Math.abs(h - a) < 0.05
      ? line(`Too close to call: ${pctOf(h)} for ${name(m.home)}, ${pctOf(a)} for ${name(m.away)} and ${pctOf(d)} for a draw.`)
      : line(`${name(fav)} is the favourite against ${name(other)}, with a ${pctOf(p)} chance of winning.`, fav);
  return [call, line(`The model has it ${m.odds.expected[0]}–${m.odds.expected[1]}.`)];
}

// How their last meeting this season went.
function lastMeeting(data: Data, m: Match, name: (id: number) => string): ReportLine {
  // The two managers, whichever was at home.
  const pair = (x: Match) => [x.home, x.away].sort((a, b) => a - b).join();
  const met = data.matches.filter((x) => x.finished && x.gw < m.gw && pair(x) === pair(m)).sort((a, b) => b.gw - a.gw)[0];
  if (!met) return line('Their first meeting this season.');
  const [hp, ap] = [met.homePts ?? 0, met.awayPts ?? 0];
  if (hp === ap) return line(`When they met in gameweek ${met.gw}, they drew ${hp}–${ap}.`);
  const winner = hp > ap ? met.home : met.away;
  return line(`When they met in gameweek ${met.gw}, ${name(winner)} won ${Math.max(hp, ap)}–${Math.min(hp, ap)}.`, winner);
}
