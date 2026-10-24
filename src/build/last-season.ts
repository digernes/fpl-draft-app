// Each season summed up for the next one's model to start from (src/model/last-season.ts):
// every player's totals at the club he ended it at, and every match's xG and goals, by
// FPL's codes for players and clubs, which stay the same from season to season while the
// ids don't. The build writes a finished season's into public/seasons/model/ (the workflow
// commits it with the season's archive), and the next season's build reads it back in its
// own ids. 2025/26's, from before the site's first season, came from the public match
// archive instead (scripts/season-summary.ts).

import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { readHistory, type ClubMatch, type History } from '../model/history.ts';
import type { LastSeason } from '../model/last-season.ts';
import type { SeasonTotals } from '../model/players.ts';
import type { Position } from '../shared/data.ts';
import type { Element } from '../shared/fpl-api.ts';
import { modelInput } from './expected.ts';
import { seasonSlug, writeIfChanged } from './output.ts';
import type { Season } from './season.ts';

export interface SeasonSummary {
  /** As "2025/26". */
  season: string;
  /** Everyone who played, by his code: his club's code, then his totals at that club. */
  players: Record<number, SeasonTotals & { club: number }>;
  /** Every match: the home and away clubs' codes, then their xG and goals. */
  matches: [home: number, away: number, homeXg: number, awayXg: number, homeGoals: number, awayGoals: number][];
}

/** What a history's ids stand for, for its summary. */
export interface Codes {
  player: (pid: number) => number | undefined;
  club: (club: number) => number | undefined;
  pos: (pid: number) => Position | undefined;
  penalties: (pid: number) => number | null;
}

const TOTALS = ['minutes', 'xg', 'xa', 'goals', 'assists', 'clubXg'] as const;
const round = (x: number) => Math.round(x * 100) / 100;

// Each player's totals at the club of his last appearance (a January move leaves his first
// club's out), and each match once, from its home side.
export function summarise(season: string, h: History, codes: Codes): SeasonSummary {
  const match = new Map(h.matches.map((m) => [`${m.fixture}:${m.club}`, m]));
  const finalClub = new Map<number, { gw: number; club: number }>();
  for (const a of h.appearances) if (a.minutes > 0 && (finalClub.get(a.pid)?.gw ?? -Infinity) <= a.gw) finalClub.set(a.pid, a);
  const players: SeasonSummary['players'] = {};
  for (const a of h.appearances) {
    const m = match.get(`${a.fixture}:${a.club}`);
    const [code, club, pos] = [codes.player(a.pid), codes.club(a.club), codes.pos(a.pid)];
    if (!m || !a.minutes || code === undefined || club === undefined || !pos || finalClub.get(a.pid)?.club !== a.club) continue;
    const t = (players[code] ??= {
      club,
      pos,
      minutes: 0,
      xg: 0,
      xa: 0,
      goals: 0,
      assists: 0,
      clubXg: 0,
      penalties: codes.penalties(a.pid),
    });
    t.minutes += a.minutes;
    t.xg += a.xg;
    t.xa += a.xa;
    t.goals += a.goals;
    t.assists += a.assists;
    t.clubXg += (m.xg * a.minutes) / 90;
  }
  for (const t of Object.values(players)) for (const key of TOTALS) t[key] = round(t[key]);
  const matches = h.matches.flatMap((m): SeasonSummary['matches'] => {
    const [home, away] = [codes.club(m.club), codes.club(m.opp)];
    if (!m.home || home === undefined || away === undefined) return [];
    return [[home, away, round(m.xg), round(m.xga), m.goals, match.get(`${m.fixture}:${m.opp}`)?.goals ?? 0]];
  });
  return { season, players, matches };
}

/** A season's summary from the build's own data: its finished gameweeks, each player at the club he is at now. */
export function summariseSeason(season: Season, name: string): SeasonSummary {
  const input = modelInput(season);
  const clubCode = new Map(season.boot.teams.map((t) => [t.id, t.code]));
  return summarise(name, readHistory(input.feeds, input.players), {
    player: (pid) => season.elements.get(pid)?.code,
    club: (club) => clubCode.get(club),
    pos: (pid) => input.players.get(pid)?.pos,
    penalties: (pid) => input.players.get(pid)?.penalties ?? null,
  });
}

/** A summary in this season's ids: its players still at the same club, and its matches (a club not in the league now as minus its code). */
export function lastSeasonIn(summary: SeasonSummary, elements: Map<number, Element>, teams: { id: number; code: number }[]): LastSeason {
  const idOf = new Map(teams.map((t) => [t.code, t.id]));
  const codeOf = new Map(teams.map((t) => [t.id, t.code]));
  const players = new Map<number, SeasonTotals>();
  for (const el of elements.values()) {
    const { club, ...totals } = summary.players[el.code] ?? {};
    if (club !== undefined && club === codeOf.get(el.team)) players.set(el.id, totals as SeasonTotals);
  }
  const id = (code: number) => idOf.get(code) ?? -code;
  const matches = summary.matches.flatMap(([home, away, homeXg, awayXg, homeGoals, awayGoals], fixture): ClubMatch[] => [
    { gw: 0, fixture, club: id(home), opp: id(away), home: true, xg: homeXg, xga: awayXg, goals: homeGoals },
    { gw: 0, fixture, club: id(away), opp: id(home), home: false, xg: awayXg, xga: homeXg, goals: awayGoals },
  ]);
  return { players, matches };
}

const summaryFile = (dir: string, season: string) => path.join(dir, 'model', `${seasonSlug(season)}.json`);

/** The summary of `season` in `dir` (public/seasons), if there is one. */
export async function readSummary(dir: string, season: string): Promise<SeasonSummary | null> {
  return readFile(summaryFile(dir, season), 'utf8').then(
    (text) => JSON.parse(text) as SeasonSummary,
    () => null,
  );
}

export async function writeSummary(dir: string, summary: SeasonSummary): Promise<boolean> {
  await mkdir(path.join(dir, 'model'), { recursive: true });
  return writeIfChanged(summaryFile(dir, summary.season), summary);
}
