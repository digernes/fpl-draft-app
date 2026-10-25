import './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { pageTransfers, recentTransfersCard } from '../src/app/pages/transfers.ts';
import { href } from '../src/app/router.ts';
import { setData, state } from '../src/app/state.ts';
import type { Data, Move } from '../src/shared/data.ts';
import { cardTitled, text } from './fixtures/html.ts';
import { player, squads } from './fixtures/league.ts';

const move = (type: Move['type'], manager: number, inId: number, out: number, gw: number, day: number, partner?: number): Move => ({
  type,
  manager,
  ...(partner ? { partner } : {}),
  in: inId,
  out,
  gw,
  at: `2026-08-${day}T10:00:00Z`,
});

// Newest first, as data.json has them: in GW 3 Bob traded Palmer to Ann for Saka (a leg each)
// and Ann signed Gabriel for White; in GW 2 Cy won Watkins off waivers for Isak, a claim Ann lost.
function data(): Data {
  const d = squads();
  d.transfers.moves = [
    move('trade', 2, 12, 13, 3, 29, 1),
    move('trade', 1, 13, 12, 3, 29, 2),
    move('free', 1, 18, 19, 3, 28),
    move('waiver', 3, 17, 16, 2, 21),
  ];
  d.transfers.claims = [
    { manager: 3, in: 17, out: 16, gw: 2, priority: 1, outcome: 'won', winner: 3 },
    { manager: 1, in: 17, out: 19, gw: 2, priority: 1, outcome: 'lost', winner: 3 },
  ];
  d.transfers.trades = [
    { gw: 3, offeredBy: 2, offeredTo: 1, state: 'p', at: '2026-08-29T10:00:00Z', items: [{ gives: 13, gets: 12 }] },
    { gw: 3, offeredBy: 3, offeredTo: 2, state: 'r', at: '2026-08-27T10:00:00Z', items: [{ gives: 14, gets: 15 }] },
  ];
  return d;
}

beforeEach(() => {
  setData(data());
  Object.assign(state, { logManager: 'all', moveType: 'all', moveGw: 'all', movePos: 'all', moves: 'all' });
});

const allTransfers = () => cardTitled(pageTransfers().body, 'All transfers');
// Each row's team (both, for a trade) and how, then from → to: the player out and the player in, each pair a trade swapped.
const rows = (html: string) =>
  html
    .split('<div class="tc-row">')
    .slice(1)
    .map((row) => {
      const team = text(row.split('<span class="tc-swaps">')[0].replace(/<span class="tc-meta">.*?<\/span>/, ''));
      const how = text(row.split('<span class="tc-how">')[1].split('</span>')[0]);
      const swaps = [...row.matchAll(/<span class="tc-move">([\s\S]*?)<\/a><\/span>/g)].map((m) => text(m[1] + '</a>'));
      return `${team}, ${how}: ${swaps.join(', ')}`;
    });

describe('the Transfer center', () => {
  it('counts the season’s moves, a trade once, and says when the next waivers are', () => {
    const { header } = pageTransfers();
    assert.match(header!.sub!, /^3 moves this season · next waivers /);
    const d = data();
    d.meta.nextWaivers = null;
    setData(d);
    assert.equal(pageTransfers().header!.sub, '3 moves this season');
  });

  it('lists every move by gameweek as the game makes it: from the player a team let go to the one it brought in, a trade once', () => {
    const html = allTransfers();
    assert.match(html, /<div class="card-sub">3 moves<\/div>/);
    assert.deepEqual(
      [...html.matchAll(/<div class="date-head"><span>([^<]+)<\/span><span class="muted">([^<]+)<\/span>/g)].map((m) => `${m[1]}: ${m[2]}`),
      ['Gameweek 3: 2 moves', 'Gameweek 2: 1 move'],
    );
    assert.deepEqual(rows(html), ['Bob ⇄ Ann, Trade: Palmer → Saka', 'Ann, Free agent: White → Gabriel', 'Cy, Waiver: Isak → Watkins']);
  });

  it('puts all of a trade’s players in its one row', () => {
    const d = data();
    d.transfers.moves.splice(2, 0, move('trade', 2, 14, 15, 3, 29, 1), move('trade', 1, 15, 14, 3, 29, 2));
    setData(d);
    assert.deepEqual(rows(allTransfers())[0], 'Bob ⇄ Ann, Trade: Palmer → Saka, Haaland → Salah');
    assert.match(pageTransfers().header!.sub!, /^3 moves this season/);
  });

  it('narrows the list to a team’s moves, a trade as its side of it', () => {
    state.logManager = '3';
    assert.deepEqual(rows(allTransfers()), ['Cy, Waiver: Isak → Watkins']);
    state.logManager = '1';
    assert.deepEqual(rows(allTransfers()), ['Ann ⇄ Bob, Trade: Saka → Palmer', 'Ann, Free agent: White → Gabriel']);
  });

  it('narrows the list to a kind of move, a gameweek or a position of the player in or out', () => {
    const teams = () => rows(allTransfers()).map((r) => r.split(':')[0]);
    state.moveType = 'trade';
    assert.deepEqual(teams(), ['Bob ⇄ Ann, Trade']);
    state.moveType = 'all';
    state.moveGw = '2';
    assert.deepEqual(teams(), ['Cy, Waiver']);
    state.moveGw = 'all';
    state.movePos = 'DEF';
    assert.deepEqual(teams(), ['Ann, Free agent']);
  });

  it('says so when no transfer is like that, the sheet’s button too', () => {
    Object.assign(state, { logManager: '3', moveType: 'trade' });
    const { body } = pageTransfers();
    assert.match(cardTitled(body, 'All transfers'), /No transfers like that yet/);
    assert.match(body, /<button type="button" class="sheet-done" data-action="sheet-close" data-value="tc-sheet">Show 0 moves<\/button>/);
  });

  it('offers the teams, escaped, and only the gameweeks with moves, newest first, the current choices picked', () => {
    state.logManager = '1';
    state.moveGw = '2';
    state.movePos = 'MID';
    const filter = cardTitled(pageTransfers().body, 'Filter');
    assert.match(filter, /<option value="1" selected>Ann · Ann’s &#38; Co<\/option>/);
    assert.match(filter, /<option value="all">All teams<\/option>/);
    assert.deepEqual(
      [...filter.matchAll(/<option value="(\d)"(?: selected)?>Gameweek \d<\/option>/g)].map((m) => Number(m[1])),
      [3, 2],
    );
    assert.match(filter, /<option value="2" selected>Gameweek 2<\/option>/);
    assert.match(filter, /data-action="move-pos" data-value="MID" aria-pressed="true"/);
    assert.match(filter, /data-action="move-pos" data-value="all" aria-pressed="false"/);
  });

  it('sums the season up: waivers won and claimed, free agents, trades done and offered, claims lost', () => {
    const numbers = text(cardTitled(pageTransfers().body, 'This season'));
    assert.match(
      numbers,
      /Waivers won 1 2 claims Free agents 1 First come, first served Trades 1 2 offers Claims lost 1 To better priority/,
    );
  });

  it('keeps the waiver order and the trade offers beside the transfers', () => {
    const { body } = pageTransfers();
    assert.notEqual(cardTitled(body, 'Waiver order'), '');
    assert.ok(body.indexOf('All transfers') < body.indexOf('<h2 class="card-title">Trades'));
  });
});

describe('the home page’s recent transfers', () => {
  it('says so when nobody has moved yet, and still leads to the Transfer center', () => {
    const d = data();
    d.transfers.moves = [];
    d.transfers.trades = [];
    setData(d);
    const html = recentTransfersCard();
    assert.match(html, /No transfers yet/);
    assert.ok(html.includes(`href="${href.transfers()}"`));
  });

  it('leads with the gameweek’s biggest names on the move, then the other moves, none twice', () => {
    const d = data();
    // Fifty better scorers, so that only the first two picks of the draft are big names.
    for (let i = 0; i < 50; i++) d.players[100 + i] = player(`Star ${i}`, 'MID', 4, 200 + i);
    setData(d);
    const html = recentTransfersCard();
    assert.match(html, /<div class="card-sub">Gameweek 3<\/div>/);
    const listed = html.split('<div class="lrow">').slice(1);
    assert.deepEqual(
      listed.map((row) => row.includes('top-move')),
      [true, true, false, false],
    );
    assert.equal(text(listed[0]), 'Saka Ann → Bob · trade 40 pts');
    assert.equal(text(listed[1]), 'Palmer Bob → Ann · trade 55 pts');
    // The trade isn't listed again; Gabriel's signing and Watkins's claim are, newest first.
    assert.match(text(listed[2]), /^Gabriel White · Free agent · /);
    assert.match(text(listed[3]), /^Watkins Isak · Waiver · /);
  });

  it('shows no more than five', () => {
    const d = data();
    for (let i = 0; i < 6; i++) d.transfers.moves.push(move('free', 2, 15, 14, 1, 10 + i));
    setData(d);
    assert.equal(recentTransfersCard().match(/<div class="lrow">/g)?.length, 5);
  });
});
