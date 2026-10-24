// The real Premier League's matches (data.json's plMatches), with the live relay's score
// and minute for those being played, what each player did in each of them, and their rows
// in a round's list.

import type { PlLine, PlMatch } from '../shared/data.ts';
import type { PlayerEvents, SlimFixture } from '../shared/live.ts';
import { crest, empty } from './components.ts';
import { esc, fmtDay, fmtTime } from './format.ts';
import { club } from './lookups.ts';
import { statusDot } from './matches.ts';
import { href } from './router.ts';
import { D, live } from './state.ts';

export const plMatches = () => D.plMatches ?? [];
export const plMatch = (id: number) => plMatches().find((m) => m.id === id);
export const plRound = (gw: number) => plMatches().filter((m) => m.gw === gw);

// The feed for the gameweek being played: the relay's, or the one data.json came with.
const liveFixture = (m: PlMatch): SlimFixture | undefined =>
  m.gw === D.meta.currentGw
    ? ((live?.gw === m.gw && live.feed) || (D.live?.gw === m.gw && D.live) || undefined)?.fixtures.find((f) => f.id === m.id)
    : undefined;

export interface PlState {
  state: 'due' | 'live' | 'done';
  score?: [number, number];
  /** The minute, while it is on. */
  min?: number;
}

export function plState(m: PlMatch): PlState {
  const f = liveFixture(m);
  const score = f?.score ?? m.score;
  if (f ? f.done : m.done) return { state: 'done', score };
  if (f ? f.started : m.score) return { state: 'live', score: score ?? [0, 0], min: f?.min };
  return { state: 'due' };
}

/** Each club's matches in a gameweek, in kick-off order. */
export const clubMatches = (club: number, gw: number) => plRound(gw).filter((m) => m.home === club || m.away === club);

/** A player's lines in a gameweek's matches (two in a double), with the match each is from. */
export function linesIn(pid: number, gw: number): { m: PlMatch; line: PlLine; home: boolean }[] {
  return plRound(gw).flatMap((m) =>
    (m.lineups ?? []).flatMap((side, i) => side.filter(([id]) => id === pid).map((line) => ({ m, line, home: i === 0 }))),
  );
}

// What a player did in a match, with his substitution worked out from his minutes: a
// substitute came on at the match's minute less his own, a starter short of it went off.
export function lineEvents(m: PlMatch, [pid, min, , started]: PlLine): PlayerEvents | undefined {
  const did = m.events?.[pid] ?? {};
  const { state, min: now } = plState(m);
  const clock = state === 'done' ? 90 : (now ?? 90);
  const on = started ? 0 : 1;
  const off = started && !did.red && min < clock - (state === 'done' ? 0 : 1) ? 1 : 0;
  const ev: PlayerEvents = { ...did, ...(on ? { on, onAt: Math.max(1, clock - min), min } : {}), ...(off ? { off, min } : {}) };
  return Object.keys(ev).length ? ev : undefined;
}

/** A real match as a row: the clubs either side of the score, or of the kick-off; `current` when it's the page's own match. */
export function plRow(m: PlMatch, current = false) {
  const s = plState(m);
  const center =
    s.state === 'due'
      ? `<span class="kickoff">${m.ko ? fmtTime.format(new Date(m.ko)) : 'TBC'}</span>`
      : `<span class="score">${s.score?.[0] ?? 0} - ${s.score?.[1] ?? 0}</span>`;
  const side = (id: number, cls: string) =>
    `<span class="side ${cls}">${cls === 'away' ? crest(id, 22) : ''}<span class="side-text"><span class="side-name">${esc(club(id)?.name ?? '?')}</span></span>${cls === 'home' ? crest(id, 22) : ''}</span>`;
  const status = statusDot(s.state, s.state === 'live' && s.min ? `${s.min}’` : undefined);
  return `<div class="match-block${current ? ' this' : ''}"><a class="match" href="${href.plMatch(m.id)}"><span class="status-slot">${status}</span>${side(m.home, 'home')}<span class="mid">${center}</span>${side(m.away, 'away')}<span></span></a></div>`;
}

/** A round's matches, day by day; compact in a side column, with the page's own match picked out. */
export function plRoundList(gw: number, { compact = false, current = 0 } = {}) {
  const days: { day: string; rows: string[] }[] = [];
  for (const m of plRound(gw)) {
    const day = m.ko ? fmtDay.format(new Date(m.ko)) : 'Date to be set';
    if (days.at(-1)?.day !== day) days.push({ day, rows: [] });
    days.at(-1)!.rows.push(plRow(m, m.id === current));
  }
  if (!days.length) return empty('No matches this round');
  return days
    .map(
      (d) => `<div class="date-head"><span>${d.day}</span></div><div class="matches${compact ? ' compact' : ''}">${d.rows.join('')}</div>`,
    )
    .join('');
}
