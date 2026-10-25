import './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { matchStatus, matchStatusText } from '../src/app/matches.ts';
import { href } from '../src/app/router.ts';
import { pointsRows, toComeRows } from '../src/app/stats-files.ts';
import { setData, state } from '../src/app/state.ts';
import { tableFrom } from '../src/app/standings.ts';
import { viewFixtures } from '../src/app/views/fixtures.ts';
import { viewStats } from '../src/app/views/stats.ts';
import { viewTable } from '../src/app/views/table.ts';
import { tradesCard, transferStats, waiverOrderCard } from '../src/app/views/transfers.ts';
import type { Match, Move, ScoredMove, TransferSummary } from '../src/shared/data.ts';
import { cardTitled, listRows, text, tiles } from './fixtures/html.ts';
import { league, match, season } from './fixtures/league.ts';

beforeEach(() => setData(league()));

describe('points by source', () => {
  it('lists the points sources that scored, in FPL’s order', () => {
    assert.deepEqual(pointsRows({ bonus: 2, minutes: 2, goals_scored: 0, assists: 3 }), [
      ['Playing', 2],
      ['Assists', 3],
      ['Bonus', 2],
    ]);
    assert.deepEqual(pointsRows(undefined), []);
  });

  it('lists what’s still to come by the same sources, those worth a tenth when rounded, either way', () => {
    assert.deepEqual(toComeRows({ bonus: 0.4, minutes: 0.92, goals_scored: 0.04, clean_sheets: -0.3, cards: -0.049 }), [
      ['Playing', 0.92],
      ['Clean sheet', -0.3],
      ['Bonus', 0.4],
    ]);
    assert.deepEqual(toComeRows({ coming_on: 0.78 }), [['Coming on', 0.78]]);
    assert.deepEqual(toComeRows({ expected: 2.3 }), [['Expected points', 2.3]]);
    assert.deepEqual(toComeRows({ other: 0.1 }), [['Other', 0.1]]);
    assert.deepEqual(toComeRows(undefined), []);
  });
});

describe('tableFrom', () => {
  it('ranks on points, then points scored', () => {
    const rows = tableFrom(league().matches);
    assert.deepEqual(
      rows.map((r) => [r.id, r.pts, r.pf, r.rank]),
      [
        [3, 4, 90, 1],
        [1, 4, 80, 2],
        [2, 0, 85, 3],
      ],
    );
  });

  it('counts a match being played as it stands, and says which it is', () => {
    const live = match(3, 1, 2, 10, 12, false);
    const rows = tableFrom([live]);
    assert.equal(rows[0].id, 2);
    assert.deepEqual(rows[0].liveMatch, { pf: 12, pa: 10, match: live });
  });
});

describe('a head-to-head’s state', () => {
  it('is over once finished, and due before it starts or without live scores', () => {
    const [done] = league().matches;
    assert.equal(matchStatus(done), 'done');
    assert.equal(matchStatusText(done), 'Full time');
    assert.equal(matchStatus({ ...done, started: false, finished: false }), 'due');
    assert.equal(matchStatus({ ...done, finished: false }), 'due');
  });
});

describe('the transfer center’s cards', () => {
  it('lists the waiver order for the next gameweek, team names escaped', () => {
    const html = waiverOrderCard();
    assert.match(html, /For gameweek 4/);
    assert.ok(html.indexOf('Cy United') < html.indexOf('Ann’s &#38; Co'));
    assert.ok(html.indexOf('Ann’s &#38; Co') < html.indexOf('Bob FC'));
  });

  it('says so when nobody has traded', () => {
    assert.match(tradesCard(), /No trades yet/);
  });
});

describe('the league’s Transfer stats tab', () => {
  it('leads from the market at a glance to every move in the Transfer center', () => {
    const d = league();
    const summary = (id: number): TransferSummary => ({
      id,
      moves: id,
      waivers: 0,
      free: id,
      trades: 0,
      claims: 0,
      lost: 0,
      void: 0,
      net: 0,
      banked: 0,
      best: null,
      worst: null,
    });
    Object.assign(d.transfers, {
      summary: [1, 2, 3].map(summary),
      contested: [],
      hotPotatoes: [],
      mostDropped: [],
      bestPickups: [],
      regrets: [],
      byGw: [{ gw: 1, waiver: 0, free: 6, trade: 0 }],
    });
    d.draft = { picks: [], retention: [] } as unknown as typeof d.draft;
    setData(d);
    const market = transferStats().split('<div class="cols">')[0];
    assert.match(market, /Transfer market/);
    assert.match(market, /<a [^>]*href="#\/transfers"[^>]*>All transfers/);
  });
});

// --- The league's tabs, after GW 2 ----------------------------------------------------------

const stats = () => {
  setData(season());
  return viewStats();
};

describe('the Stats tab', () => {
  beforeEach(() => {
    state.myTeam = null;
  });

  it('has the season’s records, each with who and when', () => {
    assert.deepEqual(tiles(cardTitled(stats(), 'Season records')), [
      'Highest score: 60 · Cy · GW 2',
      'Lowest score: 30 · Ann · GW 1',
      'Biggest win: +15 · Cy 60-45 Bob · GW 2',
      'Narrowest win: +10 · Ann 50-40 Bob · GW 1',
      'Best losing score: 45 · Bob lost to Cy · GW 2',
      'Worst winning score: 50 · Ann beat Bob · GW 1',
      'Most points on the bench: 6 · Ann · GW 1',
      'Longest winning run: 1 · Cy',
      'Draws: 1 · Level scores so far',
    ]);
  });

  it('leaves out the records nobody holds yet, and the draws while there are none', () => {
    const d = season();
    d.records = { ...d.records, biggestWin: null, narrowestWin: null, unluckiest: null, luckiest: null, benchMax: null, draws: 0 };
    setData(d);
    assert.deepEqual(
      tiles(cardTitled(viewStats(), 'Season records')).map((t) => t.split(':')[0]),
      ['Highest score', 'Lowest score', 'Longest winning run'],
    );
  });

  it('ranks the top gameweeks, the prize to the first and a tag on a week there only as its manager’s best', () => {
    const html = cardTitled(stats(), 'Top gameweeks');
    assert.deepEqual(listRows(html), [
      '1 CY Cy GW 2 Prize Won 60-45 vs Bob · Salah 9 60',
      '2 AN Ann GW 1 Won 50-40 vs Bob · Saka 10 50',
      '3 BO Bob GW 2 Best GW Lost 45-60 vs Cy 45',
    ]);
    assert.match(html, /data-tip="Bob’s best week, included so every manager makes the list"/);
  });

  it('takes the double gameweek’s penalty off a top score and picks out the followed team', () => {
    const d = season();
    d.topGameweeks[0] = { ...d.topGameweeks[0], pts: 68, dgw: 2, adj: 60 };
    setData(d);
    state.myTeam = 1;
    const html = cardTitled(viewStats(), 'Top gameweeks');
    assert.match(html, /60<span class="lrow-sub" data-tip="2 double-gameweek players × −4">68 − 8<\/span>/);
    assert.equal(html.match(/<div class="lrow mine">/g)?.length, 1);
    assert.match(text(html.split('<div class="lrow mine">')[1]), /^2 AN Ann/);
  });

  it('says so before any gameweek has finished', () => {
    const d = season();
    d.topGameweeks = [];
    setData(d);
    assert.match(cardTitled(viewStats(), 'Top gameweeks'), /No finished gameweeks yet/);
  });

  it('shades each finished gameweek’s score in the heatmap, the week’s best marked, with each manager’s average', () => {
    const d = season();
    d.lineups[3][1].pts = 66;
    delete d.lineups[2][2];
    setData(d);
    const html = cardTitled(viewStats(), 'Points per gameweek');
    assert.match(html, /<span>1<\/span><span>2<\/span><span>Avg<\/span>/);
    assert.match(html, /<span class="hm-cell h4 best" data-tip="Cy · GW 1: 66 \(week’s best\)">66<\/span>/);
    assert.match(html, /<span class="hm-cell h0" data-tip="Ann · GW 2: 9">9<\/span>/);
    assert.match(html, /<span class="hm-cell">–<\/span>/); // Bob had no lineup in GW 2
    assert.deepEqual(
      [...html.matchAll(/<span class="hm-avg">([^<]+)<\/span>/g)].map((m) => m[1]),
      ['45', '40', '42.5'],
    );
    assert.match(html, /<i class="h0"><\/i><35<\/span>.*35–44.*45–54.*55–64.*65\+.*Week’s best/);
  });

  it('leaves the heatmap out before a gameweek has finished', () => {
    const d = season();
    d.gameweeks.forEach((g) => (g.finished = false));
    setData(d);
    assert.equal(cardTitled(viewStats(), 'Points per gameweek'), '');
  });

  it('lists each manager’s most valuable player, the best first', () => {
    assert.deepEqual(listRows(cardTitled(stats(), 'Most valuable players')), [
      'Salah For Cy · MID 21',
      'Haaland For Bob · FWD 15',
      'Saka For Ann · MID 13',
    ]);
  });

  it('lists the worst gameweeks, and the points left on the bench, the most first', () => {
    const html = stats();
    assert.deepEqual(listRows(cardTitled(html, 'Worst gameweeks')), ['1 AN Ann GW 1 30', '2 CY Cy GW 1 30', '3 BO Bob GW 1 40']);
    assert.deepEqual(listRows(cardTitled(html, 'Points left on the bench')), ['1 CY Cy 7', '2 AN Ann 7', '3 BO Bob 0']);
  });
});

describe('the Table tab', () => {
  beforeEach(() => {
    setData(season());
    Object.assign(state, { tableView: 'overall', tableMode: 'short', myTeam: null });
  });

  const names = (html: string) => [...html.matchAll(/<span class="who-name">([^<]+)<\/span>/g)].map((m) => m[1]);
  const pressed = (html: string, action: string) =>
    [...html.matchAll(new RegExp(`data-action="${action}" data-value="(\\w+)" aria-pressed="(\\w+)"`, 'g'))].map(
      (m) => `${m[1]}${m[2] === 'true' ? '*' : ''}`,
    );

  it('offers every table, the one picked pressed, and shows it', () => {
    state.tableView = 'points';
    const html = viewTable();
    assert.deepEqual(pressed(html, 'table-view'), ['overall', 'form', 'xg', 'luck', 'sim', 'points*', 'parallel']);
    assert.match(html, /Ranked on fantasy points scored, as if this were a classic league/);
    assert.deepEqual(names(html), ['Cy', 'Bob', 'Ann']);
  });

  it('puts each manager beside the Premier League club on their points', () => {
    assert.deepEqual(listRows(cardTitled(viewTable(), 'Parallel Premier League')), [
      'CY Cy 4 pts Liverpool, 2nd with 4',
      'AN Ann 4 pts Liverpool, 2nd with 4',
      'BO Bob 0 pts Closest: Chelsea, 4th with 0',
    ]);
  });

  it('names the clubs level with a manager’s twin, and opens the merged table from the card', () => {
    const d = season();
    d.plTwins[0].also = [4, 2];
    setData(d);
    const html = cardTitled(viewTable(), 'Parallel Premier League');
    assert.match(listRows(html)[0], /Liverpool, 2nd with 4 · level with MCI, CHE$/);
    assert.match(html, /<a class="card-footer" href="#\/league\/table" data-action="table-view" data-value="parallel">Merged table<\/a>/);
  });

  it('ranks the luck by how much the fixture list helped, the luckiest first', () => {
    assert.deepEqual(listRows(cardTitled(viewTable(), 'Luck')), [
      'AN Ann 4 pts, 0 against the average · above it 0 of 2 weeks +4',
      'CY Cy 4 pts, 6 against the average · above it 2 of 2 weeks -2',
      'BO Bob 0 pts, 3 against the average · above it 1 of 2 weeks -3',
    ]);
  });

  it('shows the xG table with how far each side ran above or below what was expected', () => {
    state.tableView = 'xg';
    const html = viewTable();
    assert.deepEqual(names(html), ['Ann', 'Cy', 'Bob']);
    assert.match(html, /<span class="xv" data-tip="84.4 expected, 80 scored">84<sup class="diff bad">-4<\/sup><\/span>/);
    assert.match(html, /<span class="xv" data-tip="66.1 expected, 70 conceded">66<sup class="diff bad">\+4<\/sup><\/span>/);
    assert.match(html, /data-tip="2nd in the real table, 1st on expected points">\+1/);
    assert.match(html, /Like FotMob’s xG table/);
  });

  it('plays the rest of the season out in the simulated table, with how it’s worked out', () => {
    state.tableView = 'sim';
    const html = viewTable();
    assert.deepEqual(names(html), ['Cy', 'Ann', 'Bob']);
    assert.match(html, /The rest of the season played 10,000 times: 2 gameweeks to go/);
    assert.match(html, /aria-label="How this is worked out"/);
    const d = season();
    d.simulation.gameweeksLeft = 0;
    setData(d);
    assert.match(viewTable(), /The season is over, so these are the final positions/);
  });

  it('drops each manager into the real Premier League table on their points, picked out', () => {
    state.tableView = 'parallel';
    const html = viewTable();
    assert.deepEqual(names(html), ['Arsenal', 'Liverpool', 'Cy', 'Ann', 'Man City', 'Chelsea', 'Bob']);
    assert.match(html, /<div class="trow featured" data-key="m-3" data-action="manager" data-value="3">/);
    assert.match(html, /data-tip="Where Cy would sit">2</);
    assert.match(html, /Draft manager/);
  });

  it('notes how many gameweeks the form table covers, and how the luck table is played', () => {
    state.tableView = 'form';
    assert.match(viewTable(), /Table over the last 5 gameweeks/);
    state.tableView = 'luck';
    assert.match(viewTable(), /Every week played against the league average/);
  });

  it('offers the phones’ Form mode for the standings only', () => {
    state.tableMode = 'form';
    assert.deepEqual(pressed(viewTable(), 'table-mode'), ['short', 'form*', 'full']);
    state.tableView = 'xg';
    assert.deepEqual(pressed(viewTable(), 'table-mode'), ['short*', 'full']);
  });
});

describe('the Fixtures tab', () => {
  // GW 4, still to come: Ann at home to Bob, and Bob at home to Cy.
  const due = (gw: number, home: number, away: number): Match => ({
    ...match(gw, home, away, 0, 0, false),
    homePts: null,
    awayPts: null,
    started: false,
  });

  function data() {
    const d = season();
    d.matches.push(due(4, 1, 2), due(4, 2, 3));
    return d;
  }

  beforeEach(() => {
    setData(data());
    state.myTeam = null;
  });

  it('opens on the next gameweek, with its deadline and every round to pick from', () => {
    const html = viewFixtures();
    assert.match(html, /<option value="#\/league\/fixtures\/4" selected>Current \(GW 4\)<\/option>/);
    assert.ok(html.includes(`href="${href.match({ gw: 4, home: 1, away: 2 })}"`));
    assert.ok(html.includes(`href="${href.match({ gw: 4, home: 2, away: 3 })}"`));
    assert.match(html, /<div class="date-head"><span>[^<]+<\/span><span class="muted">Deadline /);
  });

  it('keeps to the season’s gameweeks', () => {
    assert.match(viewFixtures(99), /<option value="#\/league\/fixtures\/4" selected>/);
    assert.match(viewFixtures(-3), /<option value="#\/league\/fixtures\/1" selected>/);
  });

  it('has the odds switch only when a match has odds', () => {
    assert.doesNotMatch(viewFixtures(4), /data-action="odds"/);
    const d = data();
    const price = { dec: 2, frac: '1/1' };
    d.matches.at(-1)!.odds = { p: [0.5, 0.1, 0.4], prices: [price, price, price], expected: [50, 45] };
    setData(d);
    assert.match(viewFixtures(4), /data-action="odds"/);
  });

  it('names the clubs playing twice', () => {
    const d = data();
    d.gameweeks[3].doubles = [1, 4];
    setData(d);
    assert.match(viewFixtures(4), /<div class="table-note">Double gameweek for Arsenal, Man City<\/div>/);
  });

  it('lists the earlier meetings of each pair from the home side’s view, and a first meeting as such', () => {
    const d = data();
    d.matches.push(due(4, 3, 1));
    setData(d);
    assert.deepEqual(listRows(cardTitled(viewFixtures(4), 'Head to head')), [
      'AN BO Ann 1 – 0 Bob GW 1: 50-40',
      'BO CY Bob 0 – 1 Cy GW 2: 45-60',
      'CY AN Cy 0 – 0 Ann GW 1: 30-30',
    ]);
    d.matches = [due(4, 2, 1)];
    setData(d);
    assert.deepEqual(listRows(cardTitled(viewFixtures(4), 'Head to head')), ['BO AN Bob 0 – 0 Ann First meeting']);
  });

  it('reviews a finished gameweek beside its results', () => {
    const html = viewFixtures(2);
    assert.match(html, /<h2 class="card-title">Gameweek 2 review<\/h2>/);
    assert.match(html, /<span class="score">45 - 60<\/span>/);
  });
});

describe('the Transfer stats tab', () => {
  // Ann signed Gabriel for White in GW 2 and he has scored 4 since; Cy won Watkins off waivers
  // for Isak in GW 2, a claim Ann lost, and Watkins has outscored Isak; Bob has made no move.
  const scored = (type: Move['type'], manager: number, inId: number, out: number, inPts: number, outPts: number): ScoredMove => ({
    type,
    manager,
    in: inId,
    out,
    gw: 2,
    at: '2026-08-20T10:00:00Z',
    inPts,
    outPts,
    net: inPts - outPts,
    banked: inPts,
  });
  const gabriel = scored('free', 1, 18, 19, 4, 0);
  const watkins = scored('waiver', 3, 17, 16, 10, 5);

  function data() {
    const d = season();
    d.transfers.moves = [gabriel, watkins];
    d.transfers.claims = [
      { manager: 3, in: 17, out: 16, gw: 2, priority: 1, outcome: 'won', winner: 3 },
      { manager: 1, in: 17, out: 19, gw: 2, priority: 2, outcome: 'lost', winner: 3 },
    ];
    const [ann, bob, cy] = d.transfers.summary;
    d.transfers.summary = [
      { ...ann, moves: 1, free: 1, claims: 1, lost: 1, net: 4, best: gabriel },
      bob,
      { ...cy, moves: 1, waivers: 1, claims: 1, net: 5, best: watkins },
    ];
    d.transfers.byGw = [
      { gw: 1, waiver: 0, free: 0, trade: 0 },
      { gw: 2, waiver: 1, free: 1, trade: 0 },
    ];
    d.transfers.bestPickups = [watkins, gabriel];
    d.transfers.regrets = [watkins];
    d.transfers.contested = [{ gw: 2, player: 17, claimants: [3, 1], winner: 3, pts: 10 }];
    d.transfers.hotPotatoes = [{ player: 16, owners: [3], moves: 1 }];
    d.transfers.mostDropped = [{ player: 16, times: 1 }];
    return d;
  }

  beforeEach(() => setData(data()));

  it('sums up the market in tiles, the busiest gameweek with its moves', () => {
    assert.deepEqual(tiles(cardTitled(transferStats(), 'Transfer market')), [
      'Waivers won: 1 · 2 claims in total',
      'Free agents signed: 1 · First come, first served',
      'Trades: 0 · 0 offers',
      'Claims lost: 1 · Another manager had better waiver priority',
      'Busiest gameweek: GW 2 · 2 moves',
    ]);
  });

  it('ranks the managers on their moves, then the points they brought', () => {
    const html = cardTitled(transferStats(), 'Transfers by manager');
    assert.deepEqual(
      [...html.matchAll(/<span class="who-name">([^<]+)<\/span>/g)].map((m) => m[1]),
      ['Cy', 'Ann', 'Bob'],
    );
    const net = [...html.matchAll(/<div class="tc {2}from-xs">([^<]*)<\/div><div class="tc c-left from-lg">/g)].map((m) => m[1]);
    assert.deepEqual(net, ['+5', '+4', '–']);
  });

  it('draws the moves of each gameweek as bars against the busiest', () => {
    const html = cardTitled(transferStats(), 'Moves per gameweek');
    assert.match(html, /data-tip="GW 2: 1 waiver, 1 free agent, 0 trades"/);
    assert.deepEqual(
      [...html.matchAll(/--share:([\d.]+)/g)].map((m) => m[1]),
      ['0.000', '1.000'],
    );
  });

  it('hands out the awards, and names the most loyal to the draft', () => {
    assert.deepEqual(listRows(cardTitled(transferStats(), 'Awards')), [
      'AN Most active Ann · 1 move',
      'CY Waiver wire king Cy · 1 waiver won',
      'AN Unluckiest at the wire Ann · 1 claim lost on waiver priority',
      'CY Sharpest eye Cy · +5 net from moves',
      'BO Set and forget Bob · Not a single move',
      'BO Loyal to the draft Bob · 2 of 2 picks kept',
    ]);
  });

  it('lists the best pickups, the ones that got away, the most wanted and the hot potatoes', () => {
    const html = transferStats();
    assert.deepEqual(listRows(cardTitled(html, 'Best pickups')), [
      'Watkins Cy · GW 2 · for Isak · 10 pts banked +5',
      'Gabriel Ann · GW 2 · for White · 4 pts banked +4',
    ]);
    assert.deepEqual(listRows(cardTitled(html, 'The ones that got away')), ['Isak Dropped by Cy · GW 2 · for Watkins 5']);
    assert.deepEqual(listRows(cardTitled(html, 'Most wanted')), ['Watkins GW 2 · won by Cy · 10 pts since CY AN']);
    assert.deepEqual(listRows(cardTitled(html, 'Hot potatoes')), ['Isak Owned by Cy CY', 'Isak 12 pts this season 1×']);
  });

  it('says so where there’s nothing to show yet', () => {
    setData(season());
    const html = transferStats();
    assert.equal(tiles(cardTitled(html, 'Transfer market')).at(-1), 'Busiest gameweek: –');
    assert.equal(cardTitled(html, 'Moves per gameweek'), '');
    assert.match(cardTitled(html, 'Best pickups'), /Nothing scored yet/);
    assert.match(cardTitled(html, 'The ones that got away'), /Nothing scored yet/);
    assert.match(cardTitled(html, 'Most wanted'), /No contested claims yet/);
    assert.match(cardTitled(html, 'Hot potatoes'), /Nobody has changed hands yet/);
  });

  it('shows what each side of a trade has scored since, once its gameweek is over', () => {
    const d = data();
    d.transfers.trades = [
      { gw: 2, offeredBy: 2, offeredTo: 3, state: 'p', at: '2026-08-20T10:00:00Z', items: [{ gives: 13, gets: 14 }] },
      { gw: 3, offeredBy: 1, offeredTo: 2, state: 'o', at: '2026-08-27T10:00:00Z', items: [{ gives: 12, gets: 15 }] },
    ];
    setData(d);
    const [done, open] = tradesCard().split('<div class="trade">').slice(1).map(text);
    // Salah's 9 and 4 since GW 2 against Palmer's 2 and 0.
    assert.match(done, /^BO Bob CY Cy Processed Bob gets Salah \(\+11\) Cy gets Palmer \(-11\) GW 2/);
    assert.match(open, /^AN Ann BO Bob Offered Ann gets Haaland Bob gets Saka GW 3/);
  });
});
