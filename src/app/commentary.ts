// A head-to-head's commentary, as fotmob.com's: what happened to either side's players in
// the gameweek's Premier League matches, from each kick-off to its full time, with the
// points each thing was worth and the score it left. The goals, cards and substitutions
// and their minutes are the match centre's (PlStats' moments); the hour played is from the
// minutes; and what FPL hands out at the end (clean sheets, saves, defensive contributions,
// bonus, and anything else in a player's points) comes at full time, so the score ends on
// the real one. A match being played comes from the live feed and the relay's moments, as
// the score does (match-lines.ts). A pure function of the data, for the tests.

import {
  PL_STATS,
  type Data,
  type Lineup,
  type Match,
  type PlLine,
  type PlMatch,
  type PlMoment,
  type PlStats,
  type Position,
} from '../shared/data.ts';
import { roundLines, type LiveRound } from './match-lines.ts';
import { withFplAssists } from '../shared/match-stats.ts';

export interface Entry {
  /** For the order: its match's kick-off plus its minute (and a quarter of an hour at half-time). */
  at: number;
  /** As fotmob.com shows it: 41’, 45+2’, or HT and FT. */
  minute: string;
  match: PlMatch;
  kind: 'kickoff' | 'goal' | 'own' | 'yellow' | 'red' | 'sub' | 'hour' | 'halftime' | 'fulltime' | 'autosub';
  /** The match's score after it, for a goal and at half-time and full time. */
  matchScore?: [number, number];
  players: EntryPlayer[];
  /** The head-to-head's score after it. */
  score: [number, number];
}

export interface EntryPlayer {
  pid: number;
  /** Home (0) or away (1) in the head-to-head. */
  side: 0 | 1;
  /** On his manager's bench, where his points don't count. */
  bench: boolean;
  pts: number;
  /** What he did, when an entry has more than one thing (full time's clean sheets and bonus). */
  what?: string;
  /** For a substitution: the player he came on for, or who came on for him. */
  other?: number;
}

const minuteText = (min: number, half: 1 | 2) =>
  half === 1 && min > 45 ? `45+${min - 45}’` : half === 2 && min > 90 ? `90+${min - 90}’` : `${min}’`;

/** The latest first. With `bench`, the benches' players too, whose points don't count; `now`, while the gameweek is played. */
export function commentary(
  data: Data,
  stats: PlStats,
  m: Match,
  lineups: [Lineup, Lineup],
  { bench = false, now }: { bench?: boolean; now?: LiveRound } = {},
): Entry[] {
  const byMatch = roundLines(data, m.gw, now);
  const isDone = (pm: PlMatch) => Boolean(now?.feed.fixtures.find((f) => f.id === pm.id)?.done ?? pm.done);
  const rules = data.meta.rules ?? {};
  const rule = (key: string) => rules[key] ?? 0;
  const pos = (pid: number): Position => data.players[pid]?.pos ?? 'MID';
  const ours = new Map<number, { side: 0 | 1; bench: boolean }>();
  lineups.forEach((l, side) => {
    for (const pid of l.xi) ours.set(pid, { side: side as 0 | 1, bench: false });
    for (const pid of l.bench) ours.set(pid, { side: side as 0 | 1, bench: true });
  });
  const shown = (pid: number) => {
    const o = ours.get(pid);
    return o && (bench || !o.bench) ? o : undefined;
  };

  const entries: Omit<Entry, 'score'>[] = [];
  for (const pm of (data.plMatches ?? []).filter((x) => x.gw === m.gw && byMatch.has(x.id) && x.ko)) {
    const sides = byMatch.get(pm.id)!;
    const lines = sides.flat();
    if (!lines.some(([pid]) => shown(pid))) continue;
    const ko = Date.parse(pm.ko!);
    const at = (min: number, half: 1 | 2) => ko + (min + (half === 2 ? 15 : 0)) * 60_000;
    const ids = sides.map((side) => side.map(([pid]) => pid)) as [number[], number[]];
    const moments = withFplAssists(stats.moments?.[pm.id] ?? [], ids, (pid) => pm.events?.[pid]?.assists ?? 0);
    const cells = stats.matches[pm.id] ?? {};
    const stat = (pid: number, name: (typeof PL_STATS)[number]) => cells[pid]?.[PL_STATS.indexOf(name)] ?? 0;
    const home = new Set(sides[0].map(([pid]) => pid));
    const done = isDone(pm);
    // What's been put down to each player, so full time can hand out the rest of his points.
    const given = new Map<number, number>();
    const player = (pid: number, pts: number, more: Partial<EntryPlayer> = {}): EntryPlayer => {
      given.set(pid, (given.get(pid) ?? 0) + pts);
      return { pid, side: ours.get(pid)!.side, bench: ours.get(pid)!.bench, pts, ...more };
    };
    const add = (e: Omit<Entry, 'score' | 'match'>) => e.players.length && entries.push({ ...e, match: pm });

    // On the pitch from kick-off (or coming on) until going off or a red card.
    const on = new Map<number, number>(); // pid → when he came on, as `at`
    const off = new Map<number, number>();
    for (const [pid, , , started] of lines) if (started) on.set(pid, ko);
    for (const [min, half, kind, pid, other] of moments) {
      if (kind === 'sub') {
        on.set(pid, at(min, half));
        if (other) off.set(other, at(min, half));
      }
      if (kind === 'red' || kind === 'second') off.set(pid, at(min, half));
    }
    const playing = (pid: number, t: number) => (on.get(pid) ?? Infinity) <= t && t < (off.get(pid) ?? Infinity);

    add({
      at: ko,
      minute: 'KO',
      kind: 'kickoff',
      players: lines.filter(([pid, , , started]) => started && shown(pid)).map(([pid]) => player(pid, rule('short_play'))),
    });

    const score: [number, number] = [0, 0];
    const conceded = new Map<number, number>();
    for (const [min, half, kind, pid, other] of moments) {
      const t = at(min, half);
      if (kind === 'goal' || kind === 'pen' || kind === 'own') {
        // The side it counts for: the scorer's, or for an own goal the other one.
        const forHome = home.has(pid) !== (kind === 'own');
        score[forHome ? 0 : 1]++;
        const players: EntryPlayer[] = [];
        if (shown(pid))
          players.push(
            kind === 'own'
              ? player(pid, rule('own_goals'), { what: 'Own goal' })
              : player(pid, rule(`goals_scored_${pos(pid)}`), { what: 'Goal' }),
          );
        if (other && shown(other) && stat(other, 'assists') > 0) players.push(player(other, rule('assists'), { what: 'Assist' }));
        // Every so many goals conceded while he's on the pitch cost a keeper or a defender a point.
        for (const [def] of lines) {
          if (!shown(def) || home.has(def) === forHome || !playing(def, t) || !rule(`goals_conceded_${pos(def)}`)) continue;
          const n = (conceded.get(def) ?? 0) + 1;
          conceded.set(def, n);
          if (n % (rule('concede_limit') || 2) === 0)
            players.push(player(def, rule(`goals_conceded_${pos(def)}`), { what: 'Goals conceded' }));
        }
        add({ at: t, minute: minuteText(min, half), kind: kind === 'own' ? 'own' : 'goal', matchScore: [...score], players });
      } else if (kind === 'yellow' || kind === 'second' || kind === 'red') {
        if (!shown(pid)) continue;
        // A red card's points include the yellow's, so a second yellow adds the difference.
        const pts =
          kind === 'yellow' ? rule('yellow_cards') : kind === 'second' ? rule('red_cards') - rule('yellow_cards') : rule('red_cards');
        add({
          at: t,
          minute: minuteText(min, half),
          kind: kind === 'yellow' ? 'yellow' : 'red',
          players: [player(pid, pts, { what: kind === 'second' ? 'Second yellow' : undefined })],
        });
      } else if (kind === 'sub') {
        const players = [
          ...(shown(pid) ? [player(pid, rule('short_play'), { what: 'On', other })] : []),
          ...(other && shown(other) ? [player(other, 0, { what: 'Off', other: pid })] : []),
        ];
        add({ at: t, minute: minuteText(min, half), kind: 'sub', players });
      }
    }

    // An hour played: FPL's second appearance point.
    const hour = rule('long_play_limit') || 60;
    const hours = new Map<number, EntryPlayer[]>();
    for (const [pid, min] of lines) {
      if (!shown(pid) || min < hour) continue;
      const t = (on.get(pid) ?? ko) + hour * 60_000 + (on.get(pid) === ko ? 15 * 60_000 : 0);
      hours.set(t, [...(hours.get(t) ?? []), player(pid, rule('long_play') - rule('short_play'))]);
    }
    for (const [t, players] of hours) add({ at: t, minute: `${Math.round((t - ko) / 60_000) - 15}’`, kind: 'hour', players });

    const firstHalf = moments.filter(([, half]) => half === 1);
    if (done || moments.some(([, half]) => half === 2))
      entries.push({
        at: at(Math.max(45, ...firstHalf.map(([min]) => min)), 1) + 30_000,
        minute: 'HT',
        kind: 'halftime',
        match: pm,
        matchScore: halfTimeScore(moments, home),
        players: [],
      });

    // Full time: what FPL hands out at the end, and whatever else is in a player's points.
    if (done) {
      const players: EntryPlayer[] = [];
      for (const [pid, , pts] of lines) {
        if (!shown(pid)) continue;
        const p = pos(pid);
        const award = (what: string, value: number) => value && players.push(player(pid, value, { what }));
        award('Clean sheet', stat(pid, 'clean_sheets') * rule(`clean_sheets_${p}`));
        award('Saves', Math.floor(stat(pid, 'saves') / (rule('saves_limit') || 3)) * rule('saves'));
        award('Penalty saved', stat(pid, 'penalties_saved') * rule('penalties_saved'));
        award('Penalty missed', stat(pid, 'penalties_missed') * rule('penalties_missed'));
        const limit = rule(`defensive_contribution_limit_${p}`);
        award('Defensive contribution', limit && stat(pid, 'defensive_contribution') >= limit ? rule(`defensive_contribution_${p}`) : 0);
        award('Bonus', stat(pid, 'bonus') * (rule('bonus') || 1));
        award('Other points', pts - (given.get(pid) ?? 0));
      }
      const last = Math.max(90, ...moments.filter(([, half]) => half === 2).map(([min]) => min));
      entries.push({ at: at(last, 2) + 30_000, minute: 'FT', kind: 'fulltime', match: pm, matchScore: pm.score, players });
    }
  }

  // An automatic substitute was on the bench until the substitution was made: once his
  // starter was sure not to play, or once he'd come on himself if that was later. Until
  // then what he did doesn't count (and shows only with the benches), and then all of it
  // comes in at once.
  for (const [side, l] of lineups.entries())
    (l.subs ?? []).forEach((sub, i) => {
      const starter = l.off?.[i];
      const ended = starter === undefined ? null : outFrom(data, stats, starter, m.gw, isDone);
      const came = firstOn(data, stats, sub, m.gw, byMatch);
      if (!came && !ended) return;
      // Made at the later of the two, in that one's match.
      const [made, match, minute] =
        ended && (!came || ended.at >= came.at) ? [ended.at, ended.match, ended.minute] : [came!.at, came!.match, came!.minute];
      let before = 0;
      for (const e of entries)
        for (const p of e.players)
          if (p.pid === sub && e.at < made) {
            before += p.pts;
            p.bench = true;
          }
      entries.push({
        at: made + 1,
        minute,
        kind: 'autosub',
        match,
        players: [
          {
            pid: sub,
            side: side as 0 | 1,
            bench: false,
            pts: before,
            what: 'Came in',
            ...(starter !== undefined ? { other: starter } : {}),
          },
          ...(starter !== undefined
            ? [{ pid: starter, side: side as 0 | 1, bench: false, pts: 0, what: ended?.what ?? 'Didn’t play' }]
            : []),
        ],
      });
    });
  // Without the benches, the moments a substitute had before coming in go too.
  if (!bench) for (const e of entries) e.players = e.players.filter((p) => !p.bench);

  // The head-to-head's score after each, counting the XIs only.
  entries.sort((a, b) => a.at - b.at);
  const running: [number, number] = [0, 0];
  return entries
    .map((e) => {
      for (const p of e.players) if (!p.bench) running[p.side] += p.pts;
      return { ...e, score: [...running] as [number, number] };
    })
    .reverse();
}

// When a match ended, as its full time entry has it.
function endOf(stats: PlStats, pm: PlMatch) {
  const last = Math.max(90, ...(stats.moments?.[pm.id] ?? []).filter(([, half]) => half === 2).map(([min]) => min));
  return Date.parse(pm.ko ?? '') + (last + 15) * 60_000 + 30_000;
}

// When a starter was sure not to play in the gameweek, and in which match: once each of his
// club's matches was over, or kicked off without him in the squad, the last of them. Null
// while he might still play.
function outFrom(data: Data, stats: PlStats, pid: number, gw: number, isDone: (pm: PlMatch) => boolean) {
  const club = data.players[pid]?.club;
  const named = (pm: PlMatch) => pm.formations?.some((f) => f.lines.some((line) => line.includes(pid)) || f.subs.includes(pid));
  let last: { at: number; match: PlMatch; minute: string; what: string } | null = null;
  for (const match of (data.plMatches ?? []).filter((pm) => pm.gw === gw && (pm.home === club || pm.away === club))) {
    const out = isDone(match)
      ? { at: endOf(stats, match), match, minute: 'FT', what: 'Didn’t play' }
      : match.formations && match.ko && !named(match)
        ? { at: Date.parse(match.ko), match, minute: 'KO', what: 'Not in the squad' }
        : null;
    if (!out) return null;
    if (!last || out.at > last.at) last = out;
  }
  return last;
}

// When a player first came on in the gameweek, in which match and at what minute: its
// kick-off if he started it.
function firstOn(data: Data, stats: PlStats, pid: number, gw: number, byMatch: Map<number, [PlLine[], PlLine[]]>) {
  const times = (data.plMatches ?? [])
    .filter((pm) => pm.gw === gw && pm.ko)
    .flatMap((match) => {
      const line = byMatch
        .get(match.id)
        ?.flat()
        .find(([id]) => id === pid);
      if (!line) return [];
      const ko = Date.parse(match.ko!);
      if (line[3]) return [{ at: ko, match, minute: 'KO' }];
      const on = (stats.moments?.[match.id] ?? []).find(([, , kind, id]) => kind === 'sub' && id === pid);
      return on ? [{ at: ko + (on[0] + (on[1] === 2 ? 15 : 0)) * 60_000, match, minute: minuteText(on[0], on[1]) }] : [];
    })
    .sort((a, b) => a.at - b.at);
  return times[0] ?? null;
}

function halfTimeScore(moments: PlMoment[], home: Set<number>): [number, number] {
  const score: [number, number] = [0, 0];
  for (const [, half, kind, pid] of moments)
    if (half === 1 && (kind === 'goal' || kind === 'pen' || kind === 'own')) score[home.has(pid) !== (kind === 'own') ? 0 : 1]++;
  return score;
}
