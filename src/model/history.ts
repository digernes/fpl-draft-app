// The finished gameweeks' live feeds turned into what the model learns from: every
// club's matches, with its xG for and against, and every player's appearances, match by
// match. A double gameweek's stats are split between its two matches by minutes.

import type { Position } from '../shared/data.ts';
import type { LiveFeed } from '../shared/fpl-api.ts';

export interface ModelPlayer {
  club: number;
  pos: Position;
  /** FPL's chance of him playing the gameweek being forecast, in %; null when there's no doubt. */
  chance?: number | null;
  /** His place in FPL's order of his club's penalty takers (1 takes them); null when he isn't on it. */
  penalties?: number | null;
}

export interface ClubMatch {
  gw: number;
  fixture: number;
  club: number;
  opp: number;
  home: boolean;
  xg: number;
  xga: number;
  goals: number;
}

export interface Appearance {
  gw: number;
  fixture: number;
  pid: number;
  club: number;
  minutes: number;
  xg: number;
  xa: number;
  goals: number;
  assists: number;
  defcon: number;
  saves: number;
  bonus: number;
  yellow: number;
}

export interface History {
  matches: ClubMatch[];
  appearances: Appearance[];
}

export function readHistory(feeds: Record<number, LiveFeed>, players: Map<number, ModelPlayer>): History {
  const matches: ClubMatch[] = [];
  const appearances: Appearance[] = [];
  for (const [key, feed] of Object.entries(feeds)) {
    const gw = Number(key);
    const fixtures = new Map(feed.fixtures.filter((f) => f.finished || f.finished_provisional).map((f) => [f.id, f]));
    const clubXg = new Map<string, number>();
    for (const [id, { stats: s, explain = [] }] of Object.entries(feed.elements)) {
      const pid = Number(id);
      const club = players.get(pid)?.club;
      if (!s.minutes || club === undefined) continue;
      for (const [stats, fixture] of explain) {
        const f = fixtures.get(fixture);
        const minutes = stats.find((x) => x.stat === 'minutes')?.value ?? 0;
        // Someone who has changed clubs since: his old club's matches can't be told apart.
        if (!f || !minutes || (f.team_h !== club && f.team_a !== club)) continue;
        const share = minutes / s.minutes;
        const a: Appearance = {
          gw,
          fixture,
          pid,
          club,
          minutes,
          xg: share * Number(s.expected_goals ?? 0),
          xa: share * Number(s.expected_assists ?? 0),
          goals: share * s.goals_scored,
          assists: share * s.assists,
          defcon: share * (s.defensive_contribution ?? 0),
          saves: share * (s.saves ?? 0),
          bonus: share * (s.bonus ?? 0),
          yellow: share * (s.yellow_cards ?? 0),
        };
        appearances.push(a);
        clubXg.set(`${fixture}:${club}`, (clubXg.get(`${fixture}:${club}`) ?? 0) + a.xg);
      }
    }
    for (const f of fixtures.values()) {
      const xg = (club: number) => clubXg.get(`${f.id}:${club}`) ?? 0;
      const [h, a] = [f.team_h_score ?? 0, f.team_a_score ?? 0];
      matches.push({ gw, fixture: f.id, club: f.team_h, opp: f.team_a, home: true, xg: xg(f.team_h), xga: xg(f.team_a), goals: h });
      matches.push({ gw, fixture: f.id, club: f.team_a, opp: f.team_h, home: false, xg: xg(f.team_a), xga: xg(f.team_h), goals: a });
    }
  }
  return { matches, appearances };
}
