// FPL's live feed for GW 3 of annVBobLive() (fixtures/match.ts), as the relay's Worker reads it.

// GW 3 (deadline 17:30 on Friday 28 August): Arsenal beat Chelsea at 11:30 on the Saturday,
// and Liverpool v Man City kicked off at 14:00, Haaland half an hour in with his tackles and
// clearances. Ann (Raya, Saka) v Bob (Palmer, Haaland), see annVBobLive().
export const KICK_OFF = Date.parse('2026-08-29T14:00:00Z');
export const NOW = KICK_OFF + 30 * 60_000;
const zero = { assists: 0, clean_sheets: 0, goals_conceded: 0 };
const played = (fixture: number, minutes: number, points: number) => [[[{ stat: 'minutes', value: minutes, points }], fixture]];

/** FPL's live feed for GW 3 at NOW, with Haaland's points and minutes as `haaland`. */
export function rawFeed(haaland: [number, number] = [2, 30]) {
  return {
    elements: {
      11: { stats: { total_points: 2, minutes: 90, goals_scored: 0, ...zero }, explain: played(30, 90, 2) },
      12: { stats: { total_points: 9, minutes: 90, goals_scored: 1, ...zero }, explain: played(30, 90, 2) },
      13: { stats: { total_points: 2, minutes: 90, goals_scored: 0, ...zero }, explain: played(30, 90, 2) },
      18: { stats: { total_points: 1, minutes: 90, goals_scored: 0, ...zero }, explain: played(30, 90, 2) },
      15: {
        stats: {
          total_points: haaland[0],
          minutes: haaland[1],
          goals_scored: 0,
          ...zero,
          tackles: 2,
          clearances_blocks_interceptions: 4,
          bps: 12,
        },
        explain: played(31, haaland[1], 1),
      },
    },
    fixtures: [
      fixture(30, 1, 2, '2026-08-29T11:30:00Z', { finished_provisional: true, team_h_score: 2, team_a_score: 0 }),
      fixture(31, 3, 4, '2026-08-29T14:00:00Z', { stats: [{ s: 'bps', h: [], a: [{ element: 15, value: 12 }] }] }),
    ],
  };
}

export function fixture(id: number, h: number, a: number, ko: string, rest: object = {}) {
  return {
    id,
    team_h: h,
    team_a: a,
    started: true,
    finished: false,
    finished_provisional: false,
    team_h_score: 0,
    team_a_score: 0,
    kickoff_time: ko,
    stats: [],
    ...rest,
  };
}

