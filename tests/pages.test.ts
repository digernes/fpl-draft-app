import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { monthlyAwards } from '../src/app/awards.ts';
import { commentary } from '../src/app/commentary.ts';
import { matchReport, type ReportContext } from '../src/app/match-report.ts';
import { momentum } from '../src/app/momentum.ts';
import { playerHistory } from '../src/app/player-history.ts';
import { href, legacyRedirect, parseRoute } from '../src/app/router.ts';
import type { SlimLive } from '../src/shared/live.ts';
import {
  PL_STATS,
  type Claim,
  type Data,
  type Lineup,
  type Match,
  type Move,
  type PlMatch,
  type PlStats,
  type Player,
} from '../src/shared/data.ts';

describe('router', () => {
  it('reads every page and tab', () => {
    assert.deepEqual(parseRoute(''), { page: 'home', tab: '' });
    assert.deepEqual(parseRoute('#/round/9'), { page: 'home', tab: '', gw: 9 });
    assert.deepEqual(parseRoute('#/league'), { page: 'league', tab: 'overview', arg: undefined });
    assert.deepEqual(parseRoute('#/league/fixtures/8'), { page: 'league', tab: 'fixtures', gw: 8 });
    assert.deepEqual(parseRoute('#/league/stats/transfers'), { page: 'league', tab: 'stats', arg: 'transfers' });
    assert.deepEqual(parseRoute('#/premier-league/table'), { page: 'pl', tab: 'table', gw: undefined });
    assert.deepEqual(parseRoute('#/premier-league/match/64'), { page: 'pl-match', tab: 'facts', id: 64 });
    assert.deepEqual(parseRoute('#/premier-league/match/64/player-stats'), { page: 'pl-match', tab: 'player-stats', id: 64 });
    assert.deepEqual(parseRoute('#/premier-league/players'), { page: 'pl', tab: 'players', id: undefined });
    assert.deepEqual(parseRoute('#/premier-league/players/14'), { page: 'pl', tab: 'players', id: 14 });
    assert.equal(href.pl('players', 14), '#/premier-league/players/14');
    assert.deepEqual(parseRoute('#/team/123/squad'), { page: 'team', tab: 'squad', id: 123 });
    assert.deepEqual(parseRoute('#/match/9/1-2/stats'), { page: 'match', tab: 'stats', gw: 9, home: 1, away: 2 });
    assert.deepEqual(parseRoute('#/transfers'), { page: 'transfers', tab: '' });
    assert.deepEqual(parseRoute('#/player/351'), { page: 'player', tab: '', id: 351 });
  });

  it('falls back to a page’s first tab, and to the home page', () => {
    assert.equal(parseRoute('#/team/123/nonsense').tab, 'overview');
    assert.equal(parseRoute('#/player/abc').page, 'home');
    assert.equal(parseRoute('#/nowhere').page, 'home');
  });

  it('builds links that read back as the same page', () => {
    const links = [
      href.home(9),
      href.league('fixtures', 8),
      href.pl('table'),
      href.team(5, 'stats'),
      href.match({ gw: 3, home: 1, away: 2 }, 'h2h'),
      href.plMatch(7),
      href.player(8),
    ];
    assert.deepEqual(
      links.map((link) => parseRoute(link).page),
      ['home', 'league', 'pl', 'team', 'match', 'pl-match', 'player'],
    );
    assert.equal(href.team(5), '#/team/5');
    assert.equal(href.league(), '#/league');
    assert.equal(href.plMatch(7), '#/premier-league/match/7');
    assert.equal(parseRoute(href.plMatch(7, 'player-stats')).tab, 'player-stats');
  });

  it('sends the old tabs to their new pages', () => {
    assert.equal(legacyRedirect('#table'), '#/league/table');
    assert.equal(legacyRedirect('#fixtures/8'), '#/league/fixtures/8');
    assert.equal(legacyRedirect('#squads/123'), '#/team/123');
    assert.equal(legacyRedirect('#stats/transfers'), '#/league/transfer-stats');
    assert.equal(legacyRedirect('#transfers'), '#/transfers');
    assert.equal(legacyRedirect('#overview'), '#/');
    assert.equal(legacyRedirect('#/team/1'), null);
    assert.equal(legacyRedirect(''), null);
  });
});

const player = (pts: number[], owner: number | null = null): Player => ({
  name: 'P',
  full: 'P',
  pos: 'MID',
  club: 1,
  code: 1,
  total: pts.reduce((a, b) => a + b, 0),
  pts,
  owner,
  status: 'a',
  ep: 0,
});
const lineup = (xi: number[], bench: number[] = [], subs: number[] = [], off: number[] = []): Lineup =>
  ({ pts: 0, adj: 0, dgw: 0, benchPts: 0, xi, bench, subs, off, xpf: 0 }) as Lineup;
const move = (type: Move['type'], manager: number, inId: number, out: number, gw: number): Move => ({
  type,
  manager,
  in: inId,
  out,
  gw,
  at: `2026-0${gw}-01T00:00:00Z`,
});
const claim = (manager: number, inId: number, out: number, gw: number, outcome: Claim['outcome'], winner: number | null): Claim => ({
  manager,
  in: inId,
  out,
  gw,
  priority: 1,
  outcome,
  winner,
});

describe('playerHistory', () => {
  // Player 7: drafted by 10, started GW 1, auto-subbed off in GW 2, benched in GW 3; 10
  // tried to drop him for 8 in GW 3 but 20 got 8; 10 dropped him for 9 in GW 4; free in
  // GW 4 and 5, claimed by 20 and 30 in GW 5 (lost to... nobody: void), then 30 signed
  // him as a free agent for GW 6, still with 30.
  function data(): Data {
    return {
      meta: { firstGw: 1, currentGw: 6 },
      managers: [{ id: 10 }, { id: 20 }, { id: 30 }],
      players: { 7: player([6, 0, 2, 5, 1, 3], 30), 8: player([]), 9: player([]), 11: player([]) },
      lineups: {
        10: { 1: lineup([7]), 2: lineup([11], [7], [11], [7]), 3: lineup([], [7]), 4: lineup([9]), 5: lineup([9]), 6: lineup([9]) },
        30: { 6: lineup([7]) },
      },
      draft: { picks: [{ overall: 3, round: 1, pick: 3, manager: 10, player: 7, auto: false }], retention: [] },
      transfers: {
        moves: [move('waiver', 10, 9, 7, 4), move('free', 30, 7, 12, 6)],
        claims: [claim(10, 8, 7, 3, 'lost', 20), claim(20, 7, 13, 5, 'void', null), claim(30, 7, 14, 5, 'void', null)],
        trades: [],
      },
    } as unknown as Data;
  }

  it('follows him spell by spell', () => {
    const h = playerHistory(data(), 7);
    assert.deepEqual(
      h.spells.map((s) => [s.owner, s.from, s.to]),
      [
        [10, 1, 3],
        [null, 4, 5],
        [30, 6, null],
      ],
    );
    assert.equal(h.pick?.manager, 10);
  });

  it('tells a start from an automatic substitution and a week on the bench', () => {
    const h = playerHistory(data(), 7);
    assert.deepEqual(
      h.weeks.slice(0, 3).map((w) => [w.role, w.auto ?? '', w.counted]),
      [
        ['xi', '', true],
        ['xi', 'off', false],
        ['bench', '', false],
      ],
    );
    assert.deepEqual(
      h.owners.find((o) => o.owner === 10),
      { owner: 10, weeks: 3, starts: 1, xiPts: 6, benched: 1, benchPts: 2 },
    );
  });

  it('puts each event in its spell: the claim that nearly dropped him, the drop, each claim for him, the signing', () => {
    const h = playerHistory(data(), 7);
    const kinds = h.spells.map((s) => s.events.map((e) => `${e.kind}@${e.gw}`));
    assert.deepEqual(kinds, [['subOff@2', 'kept@3'], ['dropped@4', 'claim@5', 'claim@5'], ['signed@6']]);
    const claims = h.spells[1].events.flatMap((e) => (e.kind === 'claim' ? [[e.manager, e.out, e.outcome]] : []));
    assert.deepEqual(claims, [
      [20, 13, 'void'],
      [30, 14, 'void'],
    ]);
    assert.equal(h.claims.length, 2);
  });

  it('counts the weeks nobody claimed him', () => {
    assert.deepEqual(playerHistory(data(), 7).free, { weeks: 2, unclaimed: 1, pts: 6 });
  });

  it('names who a manager signed instead, when his claim dropping the same player went first', () => {
    const d = data();
    d.transfers.claims.push(claim(20, 15, 13, 5, 'won', 20));
    const claims = playerHistory(d, 7).spells[1].events.flatMap((e) => (e.kind === 'claim' ? [[e.manager, e.instead]] : []));
    assert.deepEqual(claims, [
      [20, 15],
      [30, undefined],
    ]);
  });

  it('starts one FPL added after the draft in the gameweek he was added', () => {
    const d = data();
    d.players[8] = { ...player([0, 0, 0, 2, 4, 1]), added: 4 };
    const h = playerHistory(d, 8);
    assert.equal(h.added, 4);
    assert.deepEqual(
      h.spells.map((s) => [s.owner, s.from, s.to]),
      [[null, 4, null]],
    );
    assert.deepEqual(h.free, { weeks: 3, unclaimed: 3, pts: 7 });
  });
});

const match = (gw: number, home: number, away: number, homePts: number, awayPts: number, finished = true): Match => ({
  gw,
  home,
  away,
  homePts,
  awayPts,
  started: true,
  finished,
});

describe('monthlyAwards', () => {
  it('ranks the month’s managers on table points, then points', () => {
    const plMatches: PlMatch[] = [
      { id: 1, gw: 1, home: 1, away: 2, ko: null, score: [1, 0], done: true, lineups: [[[5, 90, 12, 1]], [[6, 90, 2, 1]]] },
      { id: 2, gw: 2, home: 1, away: 2, ko: null, score: [0, 0], done: true, lineups: [[[5, 90, 2, 1]], [[6, 90, 13, 1]]] },
      { id: 3, gw: 3, home: 1, away: 2, ko: null, score: [0, 0], done: true, lineups: [[[6, 90, 20, 1]], []] },
    ];
    const d = {
      meta: {
        scoring: { win: 3, draw: 1, loss: 0 },
        months: [
          { name: 'August', from: 1, to: 2 },
          { name: 'September', from: 3, to: 4 },
        ],
      },
      managers: [{ id: 10 }, { id: 20 }],
      matches: [match(1, 10, 20, 50, 40), match(2, 20, 10, 45, 45), match(3, 10, 20, 30, 60)],
      gameweeks: [1, 2, 3, 4].map((id) => ({ id, finished: id < 4 })),
      lineups: { 10: { 1: lineup([5]), 2: lineup([5]) }, 20: { 1: lineup([], [6]) } },
      plMatches,
    } as unknown as Data;
    const [september, august] = monthlyAwards(d);
    assert.equal(september.over, false);
    assert.equal(september.managers[0].id, 20);
    assert.equal(august.over, true);
    assert.deepEqual(august.managers[0], { id: 10, pts: 4, pf: 95, won: 1, drawn: 1, lost: 0 });
  });
});

describe('momentum and the match report', () => {
  // GW 5: 10 (players 1 and 2) beat 20 (player 3) 14-12, coming back from 10 down after
  // the first match; 20's bench (player 4) scored 6.
  const plMatches: PlMatch[] = [
    { id: 1, gw: 5, home: 1, away: 2, ko: '2026-10-03T11:30:00Z', score: [1, 0], done: true, lineups: [[[3, 90, 10, 1]], [[1, 90, 0, 1]]] },
    {
      id: 2,
      gw: 5,
      home: 3,
      away: 4,
      ko: '2026-10-03T14:00:00Z',
      score: [2, 2],
      done: true,
      lineups: [
        [
          [1, 90, 9, 1],
          [4, 90, 6, 1],
        ],
        [
          [2, 90, 5, 1],
          [3, 20, 2, 0],
        ],
      ],
    },
  ];
  const m = match(5, 10, 20, 14, 12);
  const d = {
    meta: { xiLimits: { GKP: [0, 1], DEF: [0, 5], MID: [0, 5], FWD: [0, 3] } },
    managers: [
      { id: 10, first: 'Kari' },
      { id: 20, first: 'Ola' },
    ],
    players: {
      1: { name: 'Salah', pos: 'MID' },
      2: { name: 'Saka', pos: 'MID' },
      3: { name: 'Haaland', pos: 'FWD' },
      4: { name: 'Palmer', pos: 'MID' },
    },
    matches: [m, match(3, 20, 10, 50, 40)],
    plMatches,
  } as unknown as Data;
  const lineups: Record<number, Lineup> = { 10: lineup([1, 2]), 20: { ...lineup([3], [4]), benchPts: 6 } };
  const points: Record<number, number> = { 1: 9, 2: 5, 3: 12, 4: 6 };

  it('adds up each side’s points match by match', () => {
    const steps = momentum(d, m, [lineups[10], lineups[20]]);
    assert.deepEqual(
      steps.map((s) => [s.gained, s.score]),
      [
        [
          [0, 10],
          [0, 10],
        ],
        [
          [14, 2],
          [14, 12],
        ],
      ],
    );
  });

  it('gives the automatic substitutes a step of their own after the last match', () => {
    // Ola's Palmer came on for Haaland, who didn't play.
    const subbed = { ...lineups[20], xi: [4], bench: [3], subs: [4], off: [3] };
    const steps = momentum(d, m, [lineups[10], subbed]);
    assert.deepEqual(
      steps.map((s) => [s.match?.id ?? 'subs', s.gained]),
      [
        [1, [0, 0]],
        [2, [14, 0]],
        ['subs', [0, 6]],
      ],
    );
    // Not while a match is still to be played.
    const on = { ...d, plMatches: [...plMatches, { id: 3, gw: 5, home: 5, away: 6, done: false }] } as unknown as Data;
    assert.ok(momentum(on, { ...m, finished: false }, [lineups[10], subbed]).every((s) => s.match));
  });

  it('takes a match being played from the live feed, as the score does', () => {
    const playing = {
      ...d,
      players: { ...d.players, 5: { name: 'Isak', pos: 'FWD', club: 5 }, 6: { name: 'Mateta', pos: 'FWD', club: 6 } },
      plMatches: [...plMatches, { id: 3, gw: 5, home: 5, away: 6, ko: '2026-10-03T16:30:00Z', done: false }],
    } as unknown as Data;
    // Salah's points are his gameweek's, but his club isn't in the match being played.
    const feed = {
      elements: { 1: [9, 90], 5: [7, 30], 6: [2, 30] },
      fixtures: [{ id: 3, h: 5, a: 6, started: true, done: false }],
    } as unknown as SlimLive;
    const steps = momentum(playing, m, [lineup([1, 2, 5]), lineup([3, 6], [4])], { feed, points: (pid) => feed.elements[pid]?.[0] ?? 0 });
    assert.deepEqual(
      steps.map((s) => s.gained),
      [
        [0, 10],
        [14, 2],
        [7, 2],
      ],
    );
  });

  it('says who won, what decided it and the comeback', () => {
    const ctx: ReportContext = {
      lineup: (id) => lineups[id],
      points: (pid) => points[pid],
      momentum: momentum(d, m, [lineups[10], lineups[20]]),
    };
    const lines = matchReport(d, m, ctx);
    const report = lines.map((l) => l.text);
    assert.deepEqual(lines[0], { text: 'Kari edged Ola 14–12.', side: 10 });
    assert.ok(report.includes('Salah made the difference: 9 points for Kari, more than the margin.'));
    assert.ok(report.includes('Kari came back from 10 points down.'));
    // Palmer's 6 on Ola's bench is more than the margin, but no better than Haaland's 12.
    assert.ok(!report.some((text) => text.includes('bench')));
  });

  it('tells of a bench that had the win in it, from the best XI the squad had', () => {
    const ctx: ReportContext = { lineup: (id) => lineups[id], points: (pid) => (pid === 4 ? 15 : points[pid]), momentum: [] };
    const bench = matchReport(d, m, ctx).find((l) => l.text.includes('bench'));
    assert.deepEqual(bench, { text: 'Ola’s bench had the win in it: Palmer for Haaland would have made it 15–14.', side: 20 });
  });

  it('while it is on, gives the leader’s top scorer his share rather than the result, and a haul on the bench', () => {
    const on = { ...m, finished: false };
    const ctx: ReportContext = { lineup: (id) => lineups[id], points: (pid) => (pid === 4 ? 13 : points[pid]), momentum: [] };
    const report = matchReport(d, on, ctx).map((l) => l.text);
    assert.ok(report.includes('Salah has 9 of Kari’s 14 points so far.'));
    assert.ok(!report.some((text) => text.includes('made the difference')));
    assert.ok(report.includes('Ola has Palmer on the bench, with 13 points.'));
    // Once it's over, the haul left on the bench, unless the bench had the win in it.
    assert.ok(matchReport(d, m, ctx).some((l) => l.text === 'Ola left Palmer on the bench, with 13 points.'));
    const won = matchReport(d, m, { ...ctx, points: (pid) => (pid === 4 ? 15 : points[pid]) }).map((l) => l.text);
    assert.deepEqual(
      won.filter((text) => text.includes('bench')),
      ['Ola’s bench had the win in it: Palmer for Haaland would have made it 15–14.'],
    );
  });

  it('previews a match to come from its odds and the last meeting', () => {
    const next = {
      ...match(9, 10, 20, 0, 0, false),
      started: false,
      homePts: null,
      awayPts: null,
      odds: { p: [0.6, 0.1, 0.3], expected: [48, 42] },
    } as unknown as Match;
    const report = matchReport({ ...d, matches: [...d.matches, next] }, next, { lineup: () => undefined, points: () => 0, momentum: [] });
    assert.deepEqual(
      report.map((l) => l.text),
      [
        'Kari is the favourite against Ola, with a 60% chance of winning.',
        'The model has it 48–42.',
        'When they met in gameweek 5, Kari won 14–12.',
      ],
    );
  });
});

describe('commentary', () => {
  // Club 1 beat club 2 1-0: 10's midfielder (1) scored and got 2 bonus, 20's defender (2)
  // was booked, and 10's substitute (3, on the bench) came on.
  const rules = {
    short_play: 1,
    long_play: 2,
    long_play_limit: 60,
    goals_scored_MID: 5,
    assists: 3,
    concede_limit: 2,
    goals_conceded_DEF: -1,
    yellow_cards: -1,
    bonus: 1,
  };
  const pm: PlMatch = {
    id: 7,
    gw: 5,
    home: 1,
    away: 2,
    ko: '2026-10-03T14:00:00Z',
    score: [1, 0],
    done: true,
    lineups: [
      [
        [1, 90, 9, 1],
        [3, 20, 1, 0],
      ],
      [[2, 90, 1, 1]],
    ],
  };
  const d = {
    meta: { rules },
    players: { 1: { pos: 'MID', club: 1 }, 2: { pos: 'DEF', club: 2 }, 3: { pos: 'MID', club: 1 } },
    plMatches: [pm],
  } as unknown as Data;
  const cells = (bonus: number) => PL_STATS.map((s) => (s === 'bonus' ? bonus : 0));
  const stats: PlStats = {
    gw: 5,
    matches: { 7: { 1: cells(2), 2: cells(0), 3: cells(0) } },
    moments: {
      7: [
        [23, 1, 'goal', 1],
        [55, 2, 'yellow', 2],
        [70, 2, 'sub', 3, 9],
      ],
    },
  };
  const m = match(5, 10, 20, 9, 1);
  const lineups = [lineup([1], [3]), lineup([2])] as [Lineup, Lineup];

  it('tells the match the latest first, with each moment’s points and the score after it', () => {
    const entries = commentary(d, stats, m, lineups);
    assert.deepEqual(
      entries.map((e) => [e.kind, e.score]),
      [
        ['fulltime', [9, 1]],
        ['hour', [7, 1]],
        ['yellow', [6, 0]],
        ['halftime', [6, 1]],
        ['goal', [6, 1]],
        ['kickoff', [1, 1]],
      ],
    );
    assert.deepEqual(
      entries[0].players.map((p) => [p.pid, p.what, p.pts]),
      [[1, 'Bonus', 2]],
    );
  });

  it('shows the benches only when asked, their points not counting', () => {
    const sub = commentary(d, stats, m, lineups, { bench: true }).find((e) => e.kind === 'sub');
    assert.deepEqual(
      sub?.players.map((p) => [p.pid, p.bench, p.pts]),
      [[3, true, 1]],
    );
    assert.deepEqual(sub?.score, [7, 1]);
  });

  it('brings an automatic substitute in at the kick-off his starter wasn’t in the squad for', () => {
    // 10's starter 4 (club 3) isn't in the squad for club 3's match the next day, so 3 comes in.
    const later: PlMatch = {
      id: 8,
      gw: 5,
      home: 3,
      away: 4,
      ko: '2026-10-04T14:00:00Z',
      formations: [
        { shape: '4-4-2', lines: [[40]], subs: [41] },
        { shape: '4-4-2', lines: [[50]], subs: [] },
      ],
    };
    const both = { ...d, players: { ...d.players, 4: { pos: 'MID', club: 3 } }, plMatches: [pm, later] } as unknown as Data;
    const [latest, ...rest] = commentary(both, stats, m, [lineup([1, 3], [4], [3], [4]), lineup([2])]);
    assert.deepEqual(
      [latest.kind, latest.minute, latest.match.id, latest.at, latest.score],
      ['autosub', 'KO', 8, Date.parse(later.ko!) + 1, [10, 1]],
    );
    assert.deepEqual(
      latest.players.map((p) => [p.pid, p.what, p.pts]),
      [
        [3, 'Came in', 1],
        [4, 'Not in the squad', 0],
      ],
    );
    assert.ok(!rest.some((e) => e.players.some((p) => p.pid === 3))); // on the bench until then
  });
});
