// A head-to-head's Who will win? poll, as the page and the Worker both see it: its address
// on the relay, the choices and what the relay answers.

export const CHOICES = ['home', 'draw', 'away'] as const;
export type Choice = (typeof CHOICES)[number];

/** The votes for home, the draw and away. */
export type Votes = [number, number, number];

/** What the relay answers for a poll, and after a vote with the choice that counted. */
export interface PollAnswer {
  votes: Votes;
  choice?: Choice;
}

/** A match's poll on the relay: /poll/<season>/<gw>/<home>-<away>, the season as its slug ("2026-27"). */
export const pollPath = (season: string, gw: number, home: number, away: number) =>
  `/poll/${season.replace('/', '-')}/${gw}/${home}-${away}`;

/** The season's slug, the gameweek and both sides from a poll's path, if it is one. */
export function parsePollPath(path: string): { season: string; gw: number; home: number; away: number } | null {
  const m = path.match(/^\/poll\/(20\d\d-\d\d)\/([1-9]|[12]\d|3[0-8])\/([1-9]\d{0,9})-([1-9]\d{0,9})$/);
  return m && m[3] !== m[4] ? { season: m[1], gw: Number(m[2]), home: Number(m[3]), away: Number(m[4]) } : null;
}

export const isVotes = (x: unknown): x is Votes => Array.isArray(x) && x.length === 3 && x.every((n) => Number.isInteger(n) && n >= 0);
