import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildMonths } from '../src/build/output.ts';
import { buildPlSeasonStats, buildPlStats, fetchFormations, fromFeed } from '../src/build/premier-league.ts';
import type { Season } from '../src/build/season.ts';
import { PL_STATS, type PlMatch, type PlMoment, type XpParts } from '../src/shared/data.ts';
import type { LiveFeed } from '../src/shared/fpl-api.ts';
import { withFplAssists } from '../src/shared/match-stats.ts';

type Element = LiveFeed['elements'][string];
type Explain = NonNullable<Element['explain']>[number];

const zero = { total_points: 0, minutes: 0, goals_scored: 0, assists: 0, clean_sheets: 0, goals_conceded: 0 };
const played = (fixture: number, minutes: number, more: { stat: string; value: number; points: number }[] = []): Explain => [
  [{ stat: 'minutes', value: minutes, points: minutes >= 60 ? 2 : 1 }, ...more],
  fixture,
];
const element = (starts: number, ...explain: Explain[]): Element => ({ stats: { ...zero, starts }, explain });

const fixture = (bps: { h: number[]; a: number[] }) => ({
  id: 7,
  team_h: 1,
  team_a: 2,
  started: true,
  finished: true,
  finished_provisional: true,
  team_h_score: 1,
  team_a_score: 0,
  kickoff_time: '2026-10-17T14:00:00Z',
  stats: [{ s: 'bps', h: bps.h.map((element) => ({ element, value: 10 })), a: bps.a.map((element) => ({ element, value: 10 })) }],
});

describe('fromFeed', () => {
  // Eleven starters a side (1-11 home, 21-31 away), a home substitute (12) and an away one (32).
  const elements: Record<string, Element> = {};
  for (let pid = 1; pid <= 11; pid++) elements[pid] = element(1, played(7, 90));
  for (let pid = 21; pid <= 31; pid++) elements[pid] = element(1, played(7, 90));
  elements[9] = element(1, played(7, 70, [{ stat: 'goals_scored', value: 1, points: 5 }]));
  elements[12] = element(0, played(7, 20, [{ stat: 'yellow_cards', value: 1, points: -1 }]));
  elements[32] = element(0, played(7, 5));
  elements[40] = element(0, played(7, 0)); // on the bench all match
  const feed = { elements, fixtures: [] } as unknown as LiveFeed;
  const home = Array.from({ length: 12 }, (_, i) => i + 1);
  const away = [...Array.from({ length: 11 }, (_, i) => i + 21), 32];

  it('puts everyone who played on his side, starters first, with his points', () => {
    const m = fromFeed(fixture({ h: home, a: away }), 8, feed, () => undefined);
    assert.deepEqual(m.score, [1, 0]);
    assert.equal(m.done, true);
    const [h, a] = m.lineups!;
    assert.deepEqual(
      h.map(([pid]) => pid),
      [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 9, 12],
    );
    assert.deepEqual(h.at(-2), [9, 70, 7, 1]);
    assert.deepEqual(h.at(-1), [12, 20, 0, 0]);
    assert.equal(a.length, 12);
    assert.deepEqual(m.events, { 9: { goals: 1 }, 12: { yellow: 1 } });
  });

  it('goes by his club when the BPS list leaves him out', () => {
    const m = fromFeed(fixture({ h: home.slice(1), a: away }), 8, feed, (pid) => (pid === 1 ? 1 : 2));
    assert.ok(m.lineups![0].some(([pid]) => pid === 1));
  });

  it('gives a double gameweek’s one start to the match with more minutes', () => {
    const doubled = { ...elements, 5: element(1, played(7, 30), played(8, 90)), 12: element(0, played(7, 80)) };
    const m = fromFeed(fixture({ h: home, a: away }), 8, { elements: doubled, fixtures: [] } as unknown as LiveFeed, () => undefined);
    const starters = m.lineups![0].filter(([, , , started]) => started).map(([pid]) => pid);
    // Player 5's start went to match 8, which leaves ten: the eleven with the most minutes started.
    assert.equal(starters.length, 11);
    assert.ok(starters.includes(12) && !starters.includes(5));
  });

  it('has only the kick-off before a ball is kicked', () => {
    const m = fromFeed({ ...fixture({ h: [], a: [] }), started: false, team_h_score: null, team_a_score: null }, 9, feed, () => undefined);
    assert.deepEqual(m, { id: 7, gw: 9, home: 1, away: 2, ko: '2026-10-17T14:00:00Z' });
  });
});

describe('buildMonths', () => {
  const league = { start_event: 1, stop_event: 38 } as Season['league'];
  const events = [
    { id: 1, deadline_time: '2026-08-21T17:30:00Z' },
    { id: 2, deadline_time: '2026-08-29T10:00:00Z' },
    { id: 3, deadline_time: '2026-09-12T10:00:00Z' },
  ] as Season['events'];

  it('takes the main game’s months, within the league’s gameweeks', () => {
    const phases = [
      { name: 'Overall', start_event: 1, stop_event: 38 },
      { name: 'August', start_event: 1, stop_event: 2 },
      { name: 'September', start_event: 3, stop_event: 5 },
    ];
    const months = buildMonths({ league: { ...league, start_event: 2 }, events, fplBoot: { elements: [], phases } });
    assert.deepEqual(months, [
      { name: 'August', from: 2, to: 2 },
      { name: 'September', from: 3, to: 5 },
    ]);
  });

  it('goes by the deadlines without the main game', () => {
    assert.deepEqual(buildMonths({ league, events, fplBoot: null }), [
      { name: 'August', from: 1, to: 2 },
      { name: 'September', from: 3, to: 3 },
    ]);
  });
});

describe('fetchFormations', () => {
  // Club 1 (code 3) plays club 2 (code 11); players 10 and 20 have codes 100 and 200.
  const season = {
    boot: {
      teams: [
        { id: 1, code: 3 },
        { id: 2, code: 11 },
      ],
    },
    elements: new Map([
      [10, { id: 10, code: 100 }],
      [20, { id: 20, code: 200 }],
    ]),
    gws: [7],
    live: { 7: { fixtures: [{ id: 64, code: 555, team_h: 1, team_a: 2, started: true }] } },
    events: [],
    currentGw: 7,
    fixturesIn: () => [],
  } as unknown as Season;
  const lineups = [
    { teamId: '11', formation: '4-4-2', lineup: [['200'], ['999']], subs: [] },
    { teamId: '3', formation: '3-5-2', lineup: [['100']], subs: ['200'] },
  ];

  it('asks the match centre once, by FPL’s codes, home and away the right way round', async () => {
    const asked: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      asked.push(String(url));
      return new Response(JSON.stringify(lineups));
    }) as typeof fetch;
    try {
      const formations = await fetchFormations(season, null, null);
      assert.deepEqual(asked, ['https://sdp-prem-prod.premier-league-prod.pulselive.com/api/v1/matches/555/lineups']);
      assert.deepEqual(formations.get(64), [
        { shape: '3-5-2', lines: [[10]], subs: [20] },
        { shape: '4-4-2', lines: [[20]], subs: [] }, // the unknown code is left out
      ]);
      // A later build keeps them from the last one's data.json.
      asked.length = 0;
      const kept = await fetchFormations(season, { plMatches: [{ id: 64, formations: formations.get(64) }] } as never, null);
      assert.deepEqual(asked, []);
      assert.deepEqual(kept.get(64), formations.get(64));
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe('buildPlStats', () => {
  // Player 1 played only match 7; player 2 played matches 7 and 8 of a double gameweek.
  const stats = { ...zero, starts: 2, expected_goals: '0.45', bps: 30, tackles: 3, saves: 0 };
  const feed = {
    elements: {
      1: { stats: { ...stats, goals_scored: 1 }, explain: [played(7, 90)] },
      2: { stats: { ...stats, goals_scored: 2 }, explain: [played(7, 90), played(8, 90)] },
    },
    fixtures: [
      {
        id: 7,
        stats: [
          {
            s: 'goals_scored',
            h: [
              { element: 1, value: 1 },
              { element: 2, value: 1 },
            ],
            a: [],
          },
          { s: 'bps', h: [{ element: 2, value: 12 }], a: [] },
        ],
      },
    ],
  };
  const match = {
    id: 7,
    gw: 8,
    home: 1,
    away: 2,
    ko: null,
    lineups: [
      [
        [1, 90, 6, 1],
        [2, 90, 5, 1],
      ],
      [],
    ],
  } as PlMatch;
  const [gw] = buildPlStats({ live: { 8: feed } } as unknown as Season, [match, { id: 9, gw: 9, home: 1, away: 2, ko: null }]);
  const stat = (pid: number, name: (typeof PL_STATS)[number]) => gw.matches[7][pid][PL_STATS.indexOf(name)];

  it('gives a player of one match his gameweek’s stats', () => {
    assert.equal(gw.gw, 8);
    assert.deepEqual([stat(1, 'goals_scored'), stat(1, 'expected_goals'), stat(1, 'bps'), stat(1, 'tackles')], [1, 0.45, 30, 3]);
  });

  it('gives one who played twice only what the match lists, and nothing for the rest', () => {
    assert.deepEqual([stat(2, 'goals_scored'), stat(2, 'bps'), stat(2, 'saves')], [1, 12, 0]);
    assert.deepEqual([stat(2, 'expected_goals'), stat(2, 'tackles')], [null, null]);
  });
});

describe('buildPlSeasonStats', () => {
  const elements = new Map([
    [7, { id: 7, minutes: 450, goals_scored: 3, assists: 1, expected_goals: '2.456', bps: 120 }],
    [8, { id: 8, minutes: 0 }],
  ]);
  // A forward's gameweek: 90 minutes and a goal from 0.5 xG.
  const stats = { minutes: 90, total_points: 6, expected_goals: 0.5, expected_assists: 0, expected_goals_conceded: 1 };
  const explain = [
    [
      { stat: 'minutes', value: 90, points: 2 },
      { stat: 'goals_scored', value: 1, points: 4 },
    ],
    1,
  ];
  const season = {
    elements,
    gws: [1],
    live: { 1: { elements: { 7: { stats, explain: [explain] } } } },
    doubleClubs: { 1: [] },
    clubOf: () => 3,
    positionOf: () => 'FWD',
    boot: { settings: { scoring: { long_play_limit: 60, concede_limit: 2, assists: 3, goals_scored_FWD: 4, clean_sheets_FWD: 0 } } },
  } as unknown as Season;

  it('gives everyone who has played his minutes and season stats, in PL_STATS order', () => {
    const { players } = buildPlSeasonStats(season);
    assert.deepEqual(Object.keys(players), ['7']);
    const row = players[7];
    assert.equal(row[0], 450);
    assert.equal(row[1 + PL_STATS.indexOf('goals_scored')], 3);
    assert.equal(row[1 + PL_STATS.indexOf('expected_goals')], 2.46);
    assert.equal(row[1 + PL_STATS.indexOf('saves')], 0);
  });

  it('and then his xP and xCS, gameweek by gameweek: none for a forward’s clean sheets', () => {
    const row = buildPlSeasonStats(season).players[7];
    assert.deepEqual(row.slice(1 + PL_STATS.length), [4, null]); // 2 for playing, 2 for his xG
  });

  it('projects the gameweeks to come: each one’s points, then over them all his minutes, goals, assists and the rest', () => {
    // Each gameweek: 80 minutes, a goal's worth of points from his goals, 0.9 from assists,
    // 0.4 from defensive contributions and 0.5 bonus.
    const parts: XpParts = [80, 2, 4, 0, 0.9, 0, 0, 0.4, 0, 0.5, -0.1];
    const upcoming = [9, 10].map((gw) => ({ gw, points: () => 7.71, parts: () => parts }));
    const { projected } = buildPlSeasonStats(season, upcoming);
    assert.deepEqual(projected?.gws, [9, 10]);
    assert.deepEqual(projected?.players[7], [7.7, 7.7, 160, 2, 0.6, 0, 0.8, 1]);
  });

  it('takes each gameweek’s projection apart for the tips, owned or not: the minutes whole, the points to a tenth', () => {
    const parts: XpParts = [79.6, 2.04, 3.96, 0, 0.91, 0, 0, 0.4, 0, 0.52, -0.1];
    const upcoming = [
      { gw: 9, points: () => 7.7, parts: (pid: number) => (pid === 7 ? parts : undefined) },
      { gw: 10, points: () => 7.7 },
    ];
    const { projected } = buildPlSeasonStats(season, upcoming);
    assert.deepEqual(projected?.parts?.[7], [[80, 2, 4, 0, 0.9, 0, 0, 0.4, 0, 0.5, -0.1], null]);
    // Nobody without any, to keep the file small.
    assert.equal(Object.keys(projected?.parts ?? {}).length, 1);
  });
});

describe('withFplAssists', () => {
  // Home 1-3, away 4-6: 1 scored with 2 assisting, then 3 with no assister; 5 scored for the away side.
  const moments: PlMoment[] = [
    [10, 1, 'goal', 1, 2],
    [50, 2, 'goal', 3],
    [70, 2, 'goal', 5],
  ];
  const sides: [number[], number[]] = [
    [1, 2, 3],
    [4, 5, 6],
  ];

  it('gives a goal without an assister the one FPL assist its side has left over', () => {
    const assists = new Map([[2, 2]]);
    assert.deepEqual(withFplAssists(moments, sides, (pid) => assists.get(pid) ?? 0)[1], [50, 2, 'goal', 3, 2]);
  });

  it('gives an own goal for a side the one FPL assist its side has left over', () => {
    // 5, of the away side, puts it in his own net; FPL gives 2 the assist for it.
    const own: PlMoment[] = [
      [10, 1, 'goal', 1, 3],
      [17, 1, 'own', 5],
    ];
    const assists = new Map([
      [3, 1],
      [2, 1],
    ]);
    assert.deepEqual(withFplAssists(own, sides, (pid) => assists.get(pid) ?? 0)[1], [17, 1, 'own', 5, 2]);
  });

  it('leaves it when it isn’t clear whose it is, or no assist is left over', () => {
    const twoLeft = new Map([
      [2, 2],
      [1, 1],
    ]);
    assert.deepEqual(
      withFplAssists(moments, sides, (pid) => twoLeft.get(pid) ?? 0),
      moments,
    );
    const own = new Map([
      [2, 1],
      [5, 1],
    ]);
    assert.deepEqual(
      withFplAssists(moments, sides, (pid) => own.get(pid) ?? 0),
      moments,
    );
  });
});
