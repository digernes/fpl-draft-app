// A head-to-head's momentum card, for its Facts tab: the lead through the gameweek, as
// fotmob.com's momentum, with a tip on each kick-off slot and each moment within one that
// moved the score; or, at the switch, each side's chance of winning through it: as the live
// odds had it where they were recorded (every minute by the relay, at each build by the
// build: in-play-records.ts), and otherwise worked out again from the moments (win-chance.ts).

import type { Lineup, Match, PlMatch } from '../../shared/data.ts';
import { onAction } from '../actions.ts';
import { card, seg } from '../components.ts';
import { esc, figure, fmtTime, fmtWeekday, pct, sum } from '../format.ts';
import { club, first, gwInfo, gwPoints, liveXp, mgr, player, slotOf } from '../lookups.ts';
import { recordsOf } from '../in-play-records.ts';
import { inPlayOdds } from '../match-odds.ts';
import type { Beat, Step } from '../momentum.ts';
import { plRound, plState } from '../pl.ts';
import { renderView } from '../render.ts';
import { smoothCurve, type CurvePoint } from '../smooth-curve.ts';
import { D, state } from '../state.ts';
import { chanceAfter, chanceAt, playingTime, type Chances, type Outlook, type PlayingTime, type Progress } from '../win-chance.ts';

interface Slot {
  ko: string | null;
  matches: PlMatch[];
}

// Where the pointer takes a slot or a moment: its point on the curve, or a slot's end before it starts.
interface Mark {
  x: number;
  /** Its tip, as data-tip attributes. */
  tip: string;
}

// A slot as the chart walks through it, or the automatic substitutions after the last.
interface Stop {
  /** Where its slot starts, and as far into it as play has got, or its end before it starts. */
  start: number;
  x: number;
  reached: boolean;
  /** Its matches (none for the substitutions), the steps of those played, and every step up to here. */
  matches: PlMatch[];
  played: Step[];
  sofar: Step[];
}

// The beats of a slot's matches within a minute of each other, as one: the minute of the
// last of them in the slot, and the score after it.
interface Moment {
  clock: number;
  beats: Beat[];
  score: [number, number];
}

// A point on the curve as the chart walks through the gameweek: a moment or a slot's end.
// A moment and an end have a mark, with the moments it shows: the kick-off's go with the
// next one's, and those in the last minute before the end with the end's.
interface Point {
  x: number;
  stop: Stop;
  score: [number, number];
  /** The minute in the slot, for a moment; none for a slot's end. */
  clock?: number;
  marks?: Moment[];
}

// The live odds as recorded (recordsOf), where they fall on the chart.
interface Recorded {
  x: number;
  stop: Stop;
  time: PlayingTime;
  chances: Chances;
  score: [number, number];
}

onAction('momentum-view', (value) => {
  state.momentumView = value;
  renderView();
});

const share = (x: number, of: number) => `${((x / of) * 100).toFixed(2)}%`;

// The lead through the gameweek, as fotmob.com's momentum: a smooth area, up in the home
// side's colour while it leads and down in the away side's. The x-axis is playing time:
// each kick-off slot (the matches starting together) takes 90 minutes, its moments that
// moved the score (goals, assists, cards, substitutes coming on, the hour played and the
// clean sheets, from the stats file's moments) at their minute in it and the rest of its
// matches' points (bonus, saves and the like) at its end; a slot whose matches' moments
// aren't known has its end alone, its points coming in evenly over it. A dotted line runs
// between match days, as fotmob.com's at half-time. Once the gameweek's matches are over the
// automatic substitutions take half a slot of their own after the last; while it's played,
// each is a moment of its own when it's made (momentum.ts). The pointer takes the nearest mark on the
// curve (a moment, where a match being played has got to, or a slot's end before it
// starts): a line down the plot and a dot on the lead there, as fotmob.com marks the
// minute, with its tip: what happened and the score after it, or after a slot its matches
// and who scored what in them. While a match is being played a dot pulses at the lead as
// it stands. The win chance is drawn the same way, about a 50% line, with a line where
// either side's chance reaches 80%, dotted as the match days' are. The curve is smoothed
// over a few minutes (smooth-curve.ts).
const SUBS = 45;
const HEIGHT = 100;
/** Moments this close, in minutes, share a mark. */
const MERGE = 1;

export function momentumCard(m: Match, steps: Step[], lineups: [Lineup, Lineup]) {
  if (!steps.length) return '';
  const slots = kickOffSlots(m.gw);
  const stops = stopsThrough(slots, steps);
  const outlook = outlookOf(m, lineups);
  const chance = state.momentumView === 'chance' && outlook !== undefined;
  const { points, marks, most } = chance ? chanceThrough(m, stops, outlook, recordedIn(m, slots, stops)) : leadThrough(m, stops);
  const subs = stops.length > slots.length;
  const width = slots.length * 90 + (subs ? SUBS : 0);
  // The lead's biggest keeps a little off the edges; a win chance of 100% is on them, the
  // away side's on the axis.
  const edge = chance ? 0 : 4;
  const y = (v: number) => HEIGHT / 2 - (v / most) * (HEIGHT / 2 - edge);
  const curve = smoothCurve(points.map((p) => ({ ...p, v: y(p.v) })));
  const { x: nowX, v: nowV } = points.at(-1)!;
  const now = slots.some((slot) => slot.matches.some((pm) => plState(pm).state === 'live'))
    ? `<i class="mo-now" style="left:${share(nowX, width)};top:${share(y(nowV), HEIGHT)}"></i>`
    : '';
  const hits = hitAreas(m, marks, width, (x) => (x <= nowX ? curve.at(x) : undefined));
  const axis = `${axisLabels(slots)}${subs ? `<span style="flex:${SUBS / 90}">Subs</span>` : ''}`;
  // Home's chance less away's is home's share of the outcomes with the draw shared out,
  // from −1 to 1: so either side's 80% is ±0.6.
  const levels: [number, string][] = chance
    ? [
        [0.6, '80%'],
        [0, '50%'],
        [-0.6, '80%'],
      ]
    : [];
  const labels = levels
    .map(([v, label]) => {
      const top = share(y(v), HEIGHT);
      return `<i class="mo-level-line" style="top:${top}"></i><span class="mo-level" style="top:${top}" aria-hidden="true">${label}</span>`;
    })
    .join('');
  const views: [string, string][] = [
    ['lead', 'Lead'],
    ['chance', 'Win chance'],
  ];
  const sofar = m.finished ? '' : ' so far';
  return card({
    title: 'Momentum',
    sub: chance ? `Each side’s chance of winning through the gameweek${sofar}` : `The lead through the gameweek${sofar}`,
    action: outlook ? seg('momentum-view', views, chance ? 'chance' : 'lead') : '',
    body: `<div class="momentum${chance ? ' chance' : ''}"><div class="mo-plot">${dayLines(slots, width)}${plotSvg(m, curve.path, nowX, width)}${labels}${now}<div class="mo-hits">${hits}</div></div><div class="mo-axis">${axis}</div></div>${legend(m, chance ? 'favoured' : 'ahead')}`,
  });
}

// The round's matches, by kick-off.
function kickOffSlots(gw: number) {
  const slots: Slot[] = [];
  for (const pm of plRound(gw)) {
    if (slots.at(-1)?.ko !== pm.ko) slots.push({ ko: pm.ko, matches: [] });
    slots.at(-1)!.matches.push(pm);
  }
  return slots;
}

function minuteOf(pm: PlMatch) {
  const s = plState(pm);
  if (s.state === 'done') return 90;
  return s.state === 'live' ? Math.min(90, s.min ?? 45) : 0;
}

// Each slot as far into it as play has got, with the steps played by then, and the
// automatic substitutions after the last.
function stopsThrough(slots: Slot[], steps: Step[]): Stop[] {
  const byId = new Map(steps.flatMap((s) => (s.match ? [[s.match.id, s] as const] : [])));
  const sofar: Step[] = [];
  const stops = slots.map((slot, i): Stop => {
    const played = slot.matches.flatMap((pm) => byId.get(pm.id) ?? []);
    sofar.push(...played);
    const minute = Math.max(0, ...slot.matches.map(minuteOf));
    const reached = played.length > 0 && minute > 0;
    return { start: i * 90, x: i * 90 + (reached ? minute : 90), reached, matches: slot.matches, played, sofar: [...sofar] };
  });
  const subs = steps.find((s) => !s.match);
  const end = slots.length * 90;
  if (subs) stops.push({ start: end, x: end + SUBS, reached: true, matches: [], played: [subs], sofar: [...sofar, subs] });
  return stops;
}

const scoreOf = (steps: Step[]): [number, number] => [sum(steps.map((s) => s.gained[0])), sum(steps.map((s) => s.gained[1]))];

// A beat's minute in its slot: the kick-off's at its first, and no further than play has got.
const clockIn = (stop: Stop, beat: Beat) => Math.min(Math.max(1, beat.clock), stop.x - stop.start);

// The slot's beats in order, those within a minute of each other as one moment, at their
// minute in the slot.
function momentsIn(stop: Stop): Moment[] {
  // An automatic substitute made at a kick-off comes after it, whichever match he's in.
  const kickOff = (b: Beat) => (b.kind === 'kickoff' ? 0 : 1);
  const beats = stop.played.flatMap((s) => s.beats ?? []).sort((a, b) => a.clock - b.clock || kickOff(a) - kickOff(b));
  const score = scoreOf(stop.sofar.slice(0, stop.sofar.length - stop.played.length));
  const moments: Moment[] = [];
  for (const beat of beats) {
    score[0] += beat.gained[0];
    score[1] += beat.gained[1];
    const clock = clockIn(stop, beat);
    const last = moments.at(-1);
    if (last && clock - last.clock <= MERGE) Object.assign(last, { clock, beats: [...last.beats, beat] });
    else moments.push({ clock, beats: [beat], score: [0, 0] });
    moments.at(-1)!.score = [...score];
  }
  return moments;
}

// The points the curve goes through, slot by slot: each slot's moments and its end, or its
// end alone when its matches' moments aren't known.
function walk(stops: Stop[]): Point[] {
  const points: Point[] = [];
  const add = (p: Point) => points.push(p);
  for (const stop of stops.filter((s) => s.reached)) {
    const end = { x: stop.x, stop, score: scoreOf(stop.sofar), marks: [] as Moment[] };
    if (!stop.played.some((s) => s.beats)) {
      add(end);
      continue;
    }
    let pending: Moment[] = [];
    for (const moment of momentsIn(stop)) {
      const x = stop.start + moment.clock;
      if (x >= stop.x - MERGE) {
        end.marks.push(...pending, moment);
        pending = [];
        continue;
      }
      const kickOff = moment.beats.every((b) => b.kind === 'kickoff');
      add({ x, stop, score: moment.score, clock: moment.clock, ...(kickOff ? {} : { marks: [...pending, moment] }) });
      pending = kickOff ? [moment] : [];
    }
    end.marks.unshift(...pending);
    add(end);
  }
  return points;
}

// The lead before the first kick-off and through the gameweek, and the marks: each moment's
// and each slot's end.
function leadThrough(m: Match, stops: Stop[]) {
  const walked = walk(stops);
  const points: CurvePoint[] = [{ x: 0, v: 0 }, ...walked.map((p) => ({ x: p.x, v: p.score[0] - p.score[1], ramp: evenly(p) }))];
  const marks: Mark[] = [];
  for (const stop of stops) {
    for (const p of walked.filter((w) => w.stop === stop && w.marks)) {
      if (p.clock !== undefined) marks.push({ x: p.x, tip: momentTip(m, p.marks!, beatRows(m, p.marks!)) });
      else if (!stop.matches.length) marks.push({ x: p.x, tip: subsTip(m, stop.played[0]) });
      else marks.push({ x: p.x, tip: slotTip(m, stop, p.marks!) });
    }
    if (!stop.reached) marks.push({ x: stop.x, tip: slotTip(m, stop, []) });
  }
  return { points, marks, most: Math.max(4, ...points.map(({ v }) => Math.abs(v))) };
}

// A slot's end whose matches' moments aren't known, and the automatic substitutions', come
// in evenly over it; the rest all at once.
const evenly = (p: Point) => p.clock === undefined && !p.stop.played.some((s) => s.beats);

// The win chance before the first kick-off and through the gameweek, as home's chance less
// away's: up while home is the likelier winner, on the line at even chances (or a draw for
// sure). It starts from the pre-match odds and, while the match is on, ends at the live
// odds the page shows beside it. Through a slot the live odds were recorded in, it's
// those (coming in evenly from one to the next), and at its end the last recorded after its
// matches; through any other, it's worked out again: at a moment within it, from the score
// then, with the slot's matches that far through; at its end, its matches over.
function chanceThrough(m: Match, stops: Stop[], outlook: Outlook, recorded: Recorded[]) {
  const walked = walk(stops);
  const lastEnd = walked.findLast((p) => p.clock === undefined);
  const inPlay = m.started && !m.finished ? inPlayOdds(m)?.p : undefined;
  const chanceOf = (p: Point) =>
    p.clock !== undefined
      ? chanceAt(p.score, progressAt(p.stop, p.clock), withSubsIn(outlook, subsBy(p)))
      : p === lastEnd && inPlay
        ? inPlay
        : chanceAfter(p.stop.sofar, withSubsIn(outlook, subsBy(p)));
  const kickOff = m.odds?.p ?? chanceAfter([], outlook);
  const before = 'Before kick-off';
  const points: CurvePoint[] = [{ x: 0, v: lean(kickOff) }];
  const marks: Mark[] = [{ x: 0, tip: chanceTip(m, before, kickOff) }];
  const add = (x: number, odds: Chances, ramp: boolean, tip?: string) => {
    points.push({ x, v: lean(odds), ramp });
    if (tip) marks.push({ x, tip });
  };
  // A slot's end worked out again: the live odds now, or the chance after its matches.
  const endTip = (p: Point, odds: Chances) =>
    chanceTip(m, `${odds === inPlay ? 'Now' : afterWhat(p.stop.matches)} · ${shortScore(p.score)}`, odds);
  for (const stop of stops) {
    const here = walked.filter((w) => w.stop === stop);
    const records = recorded.filter((r) => r.stop === stop);
    const end = here.find((p) => p.clock === undefined);
    if (records.length && end) {
      for (const r of closeOnesMerged(records.filter((r) => r.x < end.x - MERGE))) add(r.x, r.chances, true, recordTip(m, r));
      // The live odds now, or the result, rather than any recorded at the end.
      const atEnd = end === lastEnd ? undefined : records.findLast((r) => r.x >= end.x - MERGE);
      const odds = atEnd?.chances ?? chanceOf(end);
      add(end.x, odds, true, atEnd ? recordTip(m, atEnd) : endTip(end, odds));
    } else {
      for (const p of here) {
        const odds = chanceOf(p);
        const tip = !p.marks
          ? undefined
          : p.clock !== undefined
            ? chanceTip(m, `${momentLines(p.marks).at(-1)} · ${shortScore(p.score)}`, odds)
            : endTip(p, odds);
        add(p.x, odds, evenly(p), tip);
      }
    }
    if (!stop.reached) marks.push({ x: stop.x, tip: slotTip(m, stop, []) }); // still to come
  }
  return { points, marks, most: 1 };
}

const lean = (p: Chances) => p[0] - p[2];

// The automatic substitutes in by a point while the gameweek is played: those of the slots
// before its own, and those of its own whose beat it has got to (all of them at its end).
function subsBy({ stop, clock }: Point) {
  const before = stop.sofar.slice(0, stop.sofar.length - stop.played.length).flatMap((s) => s.subsIn ?? []);
  const here = stop.played.flatMap((s) =>
    clock === undefined
      ? (s.subsIn ?? [])
      : (s.beats ?? []).filter((b) => b.kind === 'autosub' && clockIn(stop, b) <= clock).map((b) => b.players[0][0]),
  );
  return new Set([...before, ...here]);
}

// Those in count as any of the XI, their points so far in the score and the rest to come.
function withSubsIn(o: Outlook, subsIn: Set<number>): Outlook {
  if (!subsIn.size) return o;
  const lineups = o.lineups.map((l) => {
    const out = l.subs.map((pid) => subsIn.has(pid));
    return { ...l, subs: l.subs.filter((_, i) => !out[i]), ...(l.off ? { off: l.off.filter((_, i) => !out[i]) } : {}) };
  }) as [Lineup, Lineup];
  return { ...o, lineups };
}

// The live odds as recorded (Match.inPlay, with the relay's latest while it's played:
// recordsOf), at their time within the kick-off slots: those before the first kick-off, in
// the minute after a slot's or in one not yet reached aside.
function recordedIn(m: Match, slots: Slot[], stops: Stop[]): Recorded[] {
  const deadline = Date.parse(gwInfo(m.gw)?.deadline ?? '');
  const kickOffs = slots.map((s) => s.ko);
  return (recordsOf(m) ?? []).flatMap(([minutes, home, away, homePts, awayPts]): Recorded[] => {
    const time = playingTime(deadline + minutes * 60_000, kickOffs);
    const stop = time && stops[time.slot];
    if (!time || !stop?.reached || time.minute < MERGE) return [];
    const chances: Chances = [home / 1000, (1000 - home - away) / 1000, away / 1000];
    return [{ x: stop.start + time.minute, stop, time, chances, score: [homePts, awayPts] }];
  });
}

// Records this close share a mark: the later's.
function closeOnesMerged(records: Recorded[]) {
  const merged: Recorded[] = [];
  for (const r of records) {
    if (merged.length && r.x - merged.at(-1)!.x <= MERGE) merged[merged.length - 1] = r;
    else merged.push(r);
  }
  return merged;
}

// A recorded point's tip: the minute (or half-time, or after its matches) and the score then.
function recordTip(m: Match, { stop, time, chances, score }: Recorded) {
  const when =
    time.phase === 'after' ? afterWhat(stop.matches) : time.phase === 'half-time' ? 'Half-time' : `${Math.max(1, Math.ceil(time.minute))}’`;
  return chanceTip(m, `${when} · ${shortScore(score)}`, chances);
}

// How far each match had got at a minute in a stop's slot: those of the slots before over,
// its own that far through, and those after still to come.
function progressAt(stop: Stop, clock: number): Progress {
  const here = new Set(stop.played.map((s) => s.match!.id));
  const before = new Set(stop.sofar.map((s) => s.match?.id).filter((id) => id !== undefined && !here.has(id)));
  return (pm) => (before.has(pm.id) ? 1 : here.has(pm.id) ? Math.max(0, Math.min(90, clock)) / 90 : 0);
}

// What a slot's chance comes after, in short: its match, or its kick-off.
function afterWhat(matches: PlMatch[]) {
  if (!matches.length) return 'After the auto-subs';
  if (matches.length === 1) return `After ${club(matches[0].home)?.short} v ${club(matches[0].away)?.short}`;
  return matches[0].ko ? `After the ${fmtTime.format(new Date(matches[0].ko))} kick-offs` : 'After these matches';
}

const shortScore = ([home, away]: [number, number]) => `${figure(home)} - ${figure(away)}`;

const scoreLine = (m: Match, [home, away]: [number, number]) =>
  `${mgr(m.home)!.first} ${figure(home)} - ${figure(away)} ${mgr(m.away)!.first}`;

// The win chance's tip, kept short: the chances as its heading, then when and the score.
function chanceTip(m: Match, when: string, [home, draw, away]: Chances) {
  const head = `${mgr(m.home)!.first} ${pct(home)} · Draw ${pct(draw)} · ${mgr(m.away)!.first} ${pct(away)}`;
  return `data-tip-head="${esc(head)}" data-tip="${esc(when)}"`;
}

// What each did in a beat, as the tips say it.
const DID: Record<string, string> = {
  Goal: 'goal',
  'Own goal': 'own goal',
  Assist: 'assist',
  'Goals conceded': 'goals conceded',
  'Clean sheet': 'clean sheet',
  'Clean sheet lost': 'clean sheet gone',
  On: 'on',
  'Second yellow': 'sent off',
  yellow: 'booked',
  red: 'sent off',
  hour: 'an hour',
};
const and = new Intl.ListFormat('en-GB');

// Moments as lines of a tip: each beat's minute and who did what, those who did the same
// together, and the kick-off once however many matches it's of.
function momentLines(moments: Moment[]) {
  const lines = moments.flatMap(({ beats }) =>
    beats.map((beat) => {
      if (beat.kind === 'kickoff') return 'Kick-off';
      if (beat.kind === 'autosub') return autoSubLine(beat);
      const byWhat = new Map<string, string[]>();
      for (const [pid, , , what] of beat.players) byWhat.set(DID[what], [...(byWhat.get(DID[what]) ?? []), player(pid)?.name ?? '?']);
      return `${beat.minute} ${[...byWhat].map(([what, names]) => `${and.format(names)} ${what}`).join(', ')}`;
    }),
  );
  return [...new Set(lines)];
}

// An automatic substitute coming in, with his points by then.
function autoSubLine({ players: [[sub, pts], starter] }: Beat) {
  return `Auto-sub: ${player(sub)?.name ?? '?'} on${starter ? ` for ${player(starter[0])?.name ?? '?'}` : ''}, ${gain(pts)}`;
}

// A moment's tip: what happened, those of the kick-off and any others put with it first,
// with the score after it, and the rows under it.
function momentTip(m: Match, moments: Moment[], rows: string) {
  const head = `${momentLines(moments).join('\n')}: ${scoreLine(m, moments.at(-1)!.score)}`;
  return `data-tip="${esc(head)}"${rows ? ` data-tip-rows="${esc(rows)}"` : ''}`;
}

// What the moments don't show comes in at a slot's end: so its tip says.
function restLine(stop: Stop) {
  if (!stop.played.some((s) => s.beats)) return [];
  const live = stop.matches.some((pm) => plState(pm).state === 'live');
  return [
    live ? 'With bonus, saves and defensive contributions as they stand' : 'With bonus, saves and defensive contributions at full time',
  ];
}
// What the win chance is worked out from: each player's expected points for the gameweek
// before it started, while it's the one being played; for one before, which data.json
// keeps no player's for, each side's projected score at the deadline shared over its XI.
// Without either, the card keeps to the lead.
function outlookOf(m: Match, lineups: [Lineup, Lineup]): Outlook | undefined {
  const odds = m.odds;
  const expected: Outlook['expected'] | undefined =
    D.live?.gw === m.gw ? (pid) => liveXp(pid) : odds ? (_, side) => odds.expected[side] / 11 : undefined;
  if (!expected) return undefined;
  return { round: plRound(m.gw), lineups, clubOf: (pid) => player(pid)?.club, expected, points: (pid) => gwPoints(pid, m.gw) };
}

function plotSvg(m: Match, curve: string, end: number, width: number) {
  const area = `${curve} L${end},${HEIGHT / 2} L0,${HEIGHT / 2} Z`;
  return `<svg class="mo-svg" viewBox="0 0 ${width} ${HEIGHT}" preserveAspectRatio="none" aria-hidden="true">
    <defs><clipPath id="mo-up"><rect x="0" y="0" width="${width}" height="${HEIGHT / 2}"/></clipPath><clipPath id="mo-down"><rect x="0" y="${HEIGHT / 2}" width="${width}" height="${HEIGHT / 2}"/></clipPath></defs>
    <path d="${area}" fill="var(--m${slotOf(m.home)})" fill-opacity="0.9" clip-path="url(#mo-up)"/>
    <path d="${area}" fill="var(--m${slotOf(m.away)})" fill-opacity="0.9" clip-path="url(#mo-down)"/>
    <path d="${curve}" class="mo-edge" stroke="var(--m${slotOf(m.home)})" clip-path="url(#mo-up)" vector-effect="non-scaling-stroke"/>
    <path d="${curve}" class="mo-edge" stroke="var(--m${slotOf(m.away)})" clip-path="url(#mo-down)" vector-effect="non-scaling-stroke"/>
    <line x1="0" x2="${width}" y1="${HEIGHT / 2}" y2="${HEIGHT / 2}" class="mo-zero" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

const dayOf = (ko: string | null) => (ko ? new Date(ko).toDateString() : '');

function dayLines(slots: Slot[], width: number) {
  return slots
    .flatMap((slot, i) =>
      i && dayOf(slot.ko) !== dayOf(slots[i - 1].ko) ? [`<i class="mo-day" style="left:${share(i * 90, width)}"></i>`] : [],
    )
    .join('');
}

// Each slot's kick-off, with its day when that's new.
function axisLabels(slots: Slot[]) {
  let lastDay = '';
  return slots
    .map((slot) => {
      const ko = slot.ko ? new Date(slot.ko) : null;
      const day = ko ? fmtWeekday.format(ko) : '';
      const label = ko ? `${day !== lastDay ? `${day} ` : ''}${fmtTime.format(ko)}` : 'TBC';
      lastDay = day;
      return `<span>${label}</span>`;
    })
    .join('');
}

// Each slot's mark with its tip, over the stretch of the plot nearer it than the next.
function hitAreas(m: Match, marks: Mark[], width: number, leadAt: (x: number) => number | undefined) {
  return marks
    .map(({ x, tip }, r) => {
      const from = r ? (marks[r - 1].x + x) / 2 : 0;
      const to = r < marks.length - 1 ? (x + marks[r + 1].x) / 2 : width;
      const { cls, style } = leadDot(m, leadAt(x));
      return `<span class="mo-slot" tabindex="0" style="left:${share(from, width)};width:${share(to - from, width)}" ${tip}><i class="mo-mark tip-at${cls}" style="left:${share(x - from, to - from)}${style}"></i></span>`;
    })
    .join('');
}

// The dot on the curve at a mark, in the colour of the side ahead there; none past where
// play has got.
function leadDot(m: Match, on: number | undefined) {
  if (on === undefined) return { cls: '', style: '' };
  const ahead = Math.abs(on - HEIGHT / 2) < 0.5 ? undefined : on < HEIGHT / 2 ? m.home : m.away;
  return { cls: ' lead', style: `;--y:${share(on, HEIGHT)}${ahead ? `;--dot:var(--m${slotOf(ahead)})` : ''}` };
}

const legend = (m: Match, what: string) =>
  `<div class="legend"><span class="legend-item"><i class="m${slotOf(m.home)}" style="background:var(--av-bg)"></i>${first(m.home)} ${what}</span><span class="legend-item"><i class="m${slotOf(m.away)}" style="background:var(--av-bg)"></i>${first(m.away)} ${what}</span></div>`;

// With the live score while it's on, and saying so.
const matchName = (pm: PlMatch) => {
  const { state, score } = plState(pm);
  return `${club(pm.home)?.short} ${score ? `${score[0]}-${score[1]}` : 'v'} ${club(pm.away)?.short}${state === 'live' ? ', live' : ''}`;
};
const scorersOf = (s: Step, side: 0 | 1) =>
  s.scorers
    .filter(([, , x]) => x === side)
    .map(([pid, pts]) => `${player(pid)?.name ?? '?'} ${figure(pts)}`)
    .join(', ');
// Points gained, with a real minus sign when they're lost.
const gain = (n: number) => (n < 0 ? figure(n) : `+${n}`);
const sideRows = (m: Match, steps: Step[]) => {
  const gained = (side: 0 | 1) => sum(steps.map((s) => s.gained[side]));
  const who = (side: 0 | 1) =>
    steps
      .map((s) => scorersOf(s, side))
      .filter(Boolean)
      .join(', ');
  return [
    `${mgr(m.home)!.first}\t${gain(gained(0))}${who(0) ? ` (${who(0)})` : ''}`,
    `${mgr(m.away)!.first}\t${gain(gained(1))}${who(1) ? ` (${who(1)})` : ''}`,
  ].join('\n');
};

// What each side took from a moment and from whom, those it left as they were aside.
function beatRows(m: Match, moments: Moment[]) {
  const beats = moments.flatMap((x) => x.beats);
  const rowOf = (side: 0 | 1) => {
    const by = new Map<number, number>();
    for (const [pid, pts, s] of beats.flatMap((b) => b.players)) if (s === side) by.set(pid, (by.get(pid) ?? 0) + pts);
    const who = [...by].filter(([, pts]) => pts);
    if (!who.length) return [];
    const list = who.map(([pid, pts]) => `${player(pid)?.name ?? '?'} ${figure(pts)}`).join(', ');
    return [`${mgr(side ? m.away : m.home)!.first}\t${gain(sum(who.map(([, pts]) => pts)))} (${list})`];
  };
  return [...rowOf(0), ...rowOf(1)].join('\n');
}

// A slot's tip: any moments put with its end, the score as it stood after its matches (as
// far as they've got), then the matches and what each side took from them, and who scored it.
function slotTip(m: Match, stop: Stop, moments: Moment[]) {
  const played = stop.reached ? stop.played : [];
  const [home, away] = scoreOf(stop.sofar);
  const names = stop.matches.map((pm) => (played.some((s) => s.match?.id === pm.id) ? matchName(pm) : `${matchName(pm)}, to come`));
  const score = played.length ? [`${first(m.home)} ${figure(home)} - ${figure(away)} ${first(m.away)}`] : [];
  const head = [...momentLines(moments), ...score, ...names, ...(played.length ? restLine(stop) : [])].join('\n');
  const rows = played.length ? sideRows(m, played) : '';
  return `data-tip="${esc(head)}"${rows ? ` data-tip-rows="${esc(rows)}"` : ''}`;
}

// The automatic substitutions': the final score, and who came in for each side.
function subsTip(m: Match, s: Step) {
  const head = `${first(m.home)} ${s.score[0]} - ${s.score[1]} ${first(m.away)}\nAutomatic substitutions`;
  return `data-tip="${esc(head)}" data-tip-rows="${esc(sideRows(m, [s]))}"`;
}
