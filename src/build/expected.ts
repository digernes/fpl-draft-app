// Expected points from the site's own model (src/model) for the gameweeks ahead and the
// one being played, and the season turned into what the model reads. Before any
// gameweek has been played there is nothing to learn from, so odds.ts falls back on FPL's.

import { forecast, type Forecast, type ModelInput } from '../model/forecast.ts';
import type { ById, Data } from '../shared/data.ts';
import type { Element } from '../shared/fpl-api.ts';
import type { ModelPlayer } from '../model/history.ts';
import { POSITIONS } from './config.ts';
import type { Season } from './season.ts';

/**
 * `chance`: which of FPL's chances of playing to scale by: the next gameweek's, this one's,
 * or a later gameweek's (see laterChance); none for a backtest, where they are long out of date.
 */
export function modelInput(season: Season, chance?: 'next' | 'this' | number): ModelInput {
  const deadline = Date.parse(season.events.find((e) => e.id === chance)?.deadline_time ?? '');
  const players = new Map<number, ModelPlayer>();
  for (const el of season.elements.values()) {
    const odds =
      chance === 'next'
        ? el.chance_of_playing_next_round
        : chance === 'this'
          ? el.chance_of_playing_this_round
          : chance !== undefined
            ? laterChance(el, deadline)
            : null;
    players.set(el.id, { club: el.team, pos: POSITIONS[el.element_type], chance: odds ?? null });
  }
  const feeds = Object.fromEntries(season.finishedGws.map((gw) => [gw, season.live[gw]]));
  return { scoring: season.boot.settings.scoring, players, feeds };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// FPL's chance of playing is for the next gameweek only. By a later one a doubt has
// cleared, and a player injured or banned is back if FPL's news has him back before its
// deadline ("Expected back 1 Nov", "Suspended until 08 Nov").
export function laterChance(el: Pick<Element, 'status' | 'news' | 'chance_of_playing_next_round'>, deadline: number): number | null {
  if (el.status === 'a' || el.status === 'd') return null;
  const date = /(?:Expected back|Suspended until) (\d{1,2}) ([A-Z][a-z]{2})/.exec(el.news ?? '');
  const month = date ? MONTHS.indexOf(date[2]) : -1;
  if (date && month >= 0) {
    const year = new Date(deadline).getUTCFullYear();
    // A date months gone is next year's: news in December of a return in January.
    const back = [year, year + 1].map((y) => Date.UTC(y, month, Number(date[1]))).find((t) => t > deadline - 180 * 864e5) ?? Infinity;
    if (back <= deadline) return null;
  }
  return el.chance_of_playing_next_round ?? 0;
}

const points = (f: Forecast) => (pid: number) => f.points.get(pid) ?? 0;

export function modelExpected(season: Season) {
  if (!season.finishedGws.length) return null;
  const { currentGw, nextGw, live, boot } = season;
  const next = forecast(modelInput(season, 'next'), nextGw, boot.fixtures?.[nextGw] ?? []);
  const playing = currentGw && !season.finishedGws.includes(currentGw) && live[currentGw];
  const now = playing ? forecast(modelInput(season, 'this'), currentGw, live[currentGw].fixtures) : next;
  return {
    next: points(next),
    now: points(now),
    /** A later gameweek's, by the chances of playing it (laterChance). */
    at: (gw: number) => points(forecast(modelInput(season, gw), gw, boot.fixtures?.[gw] ?? [])),
    /** This gameweek's appearance and clean-sheet points, for the live projections. */
    milestones: (pid: number): [number, number] | undefined => {
      const parts = now.parts.get(pid);
      return parts && [parts.appearance, parts.cleanSheet];
    },
  };
}

/** A gameweek already played, as the model would have forecast it from the ones before: without flags, which FPL doesn't keep. */
export function modelBefore(season: Season, gw: number) {
  if (!season.finishedGws.some((g) => g < gw) || !season.live[gw]) return null;
  return points(forecast(modelInput(season), gw, season.live[gw].fixtures));
}

// FPL's flags as they stood at each deadline: every build before one writes the coming
// gameweek's and later builds keep them, so a season's worth can show how often a 75%,
// 50% or 25% player really plays (the model only guesses so far: see flagPower).
export function deadlineFlags(season: Season, previous: Partial<Data> | null, now = Date.now()): ById<ById<number>> {
  const flags = { ...previous?.flags };
  const { nextGw, nextEvent } = season;
  if (nextEvent && Date.parse(nextEvent.deadline_time) > now) {
    const flagged: ById<number> = {};
    for (const el of season.elements.values())
      if (['d', 'i', 's'].includes(el.status)) flagged[el.id] = el.chance_of_playing_next_round ?? 0;
    flags[nextGw] = flagged;
  }
  return flags;
}
