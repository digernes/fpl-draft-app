// The fetched league turned into the lookups every other build module works from:
// which gameweeks are played and finished, who the players are, and their points.

import type { Formation, Position } from '../shared/data.ts';
import type { Element } from '../shared/fpl-api.ts';
import type { Fetched } from './api.ts';
import { POSITIONS } from './config.ts';
import { countBy, range } from './util.ts';

export type Season = ReturnType<typeof readSeason>;

export function readSeason(fetched: Fetched) {
  const { details, boot, game, live } = fetched;
  const { league } = details;
  const events = boot.events.data;
  const currentGw = Math.min(game.current_event ?? 0, league.stop_event);
  const gws = range(league.start_event, currentGw);
  const finishedGws = gws.filter((gw) => events.find((e) => e.id === gw)?.finished);
  const lastFinishedGw = finishedGws.at(-1) ?? 0;
  const nextEvent = events.find((e) => e.id === game.next_event);
  const nextGw = game.next_event ?? currentGw + 1;

  const elements = new Map<number, Element>(boot.elements.map((el) => [el.id, el]));
  const clubOf = (id: number) => elements.get(id)?.team;
  const positionOf = (id: number): Position | undefined => POSITIONS[elements.get(id)?.element_type ?? 0];
  const pointsIn = (id: number, gw: number) => live[gw]?.elements[id]?.stats.total_points ?? 0;

  const doubleClubs: Record<number, number[]> = {};
  for (const gw of gws) doubleClubs[gw] = clubsPlayingTwice(live[gw].fixtures);
  for (const [gw, fixtures] of Object.entries(boot.fixtures ?? {})) doubleClubs[Number(gw)] ??= clubsPlayingTwice(fixtures);

  const { squad } = boot.settings;
  const formation: Formation = { DEF: squad.min_play_DEF, MID: squad.min_play_MID, FWD: squad.min_play_FWD };

  return {
    ...fetched,
    league,
    events,
    currentGw,
    gws,
    finishedGws,
    lastFinishedGw,
    nextEvent,
    nextGw,
    elements,
    clubOf,
    positionOf,
    pointsIn,
    doubleClubs,
    formation,
    /** Head-to-head points for a win, draw and loss. */
    scoring: boot.settings.league,
  };
}

export function clubsPlayingTwice(fixtures: { team_h: number; team_a: number }[]): number[] {
  const counts = countBy(
    fixtures.flatMap((f) => [f.team_h, f.team_a]),
    (club) => club,
  );
  return Object.keys(counts)
    .filter((club) => counts[club] > 1)
    .map(Number);
}
