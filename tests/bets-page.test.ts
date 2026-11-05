import { drawIntoNothing } from './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { runAction } from '../src/app/actions.ts';
import { betting, returnsText } from '../src/app/betting.ts';
import { betSlip } from '../src/app/bet-slip.ts';
import { oddsRow } from '../src/app/match-odds.ts';
import '../src/app/chrome.ts';
import { pageBets } from '../src/app/pages/bets.ts';
import { navItems, pageHtml } from '../src/app/render.ts';
import { href, parseRoute } from '../src/app/router.ts';
import { D, setData, setLive, state } from '../src/app/state.ts';
import type { Bet, Board, Me } from '../src/shared/bets.ts';
import type { Data } from '../src/shared/data.ts';
import { cardTitled, text } from './fixtures/html.ts';
import { squads } from './fixtures/league.ts';

drawIntoNothing();

// The small league with GW 4 (Ann v Bob, Cy v Ann) priced, its deadline a day off.
function data(): Data {
  const d = squads();
  d.gameweeks[3].deadline = new Date(Date.now() + 864e5).toISOString();
  const price = (dec: number) => ({ dec, frac: '1/1' });
  const odds = {
    p: [0.5, 0.05, 0.45] as [number, number, number],
    prices: [price(1.9), price(17), price(2.1)] as never,
    expected: [45, 44] as [number, number],
  };
  d.matches.push(
    { gw: 4, home: 1, away: 2, homePts: null, awayPts: null, started: false, finished: false, odds },
    { gw: 4, home: 3, away: 1, homePts: null, awayPts: null, started: false, finished: false, odds },
  );
  return d;
}

const bet = (more: Partial<Bet> = {}): Bet => ({
  id: 1,
  name: 'Ola',
  season: '2026-27',
  gw: 4,
  home: 1,
  away: 2,
  pick: 0,
  stake: 200,
  price: 1.9,
  at: 0,
  ...more,
});

// The relay's book as fetch answers it: what each path answers, and what was asked of it.
let asked: { path: string; body?: Record<string, unknown>; auth: string | null }[];
function relay(answers: Record<string, [number, unknown]>) {
  asked = [];
  mock.method(globalThis, 'fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    const headers = (init.headers ?? {}) as Record<string, string>;
    // The Bet tab asks for the counts as it draws: only what's done counts here.
    if (path !== '/bets/board')
      asked.push({ path, body: init.body ? JSON.parse(String(init.body)) : undefined, auth: headers.Authorization ?? null });
    const [status, body] = answers[path] ?? [404, { error: 'Not found' }];
    return Response.json(body, { status });
  });
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
const act = (action: string, value = '') => runAction({ dataset: { action, value } } as unknown as HTMLElement);
const body = (tab = 'bet') => pageBets({ page: 'bets', tab }).body;
const me = (bets: Bet[] = [], team: number | null = null): Me => ({ name: 'Ola', team, bets });

beforeEach(() => {
  setData(data());
  setLive(null);
  state.route = { page: 'bets', tab: 'bet' };
  Object.assign(betting, {
    token: '',
    me: null,
    meAt: 0,
    board: null,
    boardAt: 0,
    offline: false,
    mode: 'signup',
    teamTaken: false,
    name: '',
    pin: '',
    formNote: null,
    slip: null,
    placed: null,
    stake: '',
    busy: false,
    note: null,
  });
  relay({});
});
afterEach(() => mock.restoreAll());

describe('the betting page', () => {
  it('has its own address and tabs, and a link in the bars', () => {
    assert.deepEqual(parseRoute('#/bets'), { page: 'bets', tab: 'bet' });
    assert.deepEqual(parseRoute('#/bets/leaderboard'), { page: 'bets', tab: 'leaderboard' });
    assert.equal(href.bets('feed'), '#/bets/feed');
    const page = pageBets({ page: 'bets', tab: 'bet' });
    assert.deepEqual(
      page.header!.tabs!.map((t) => t.label),
      ['Bet', 'Leaderboard', 'Feed'],
    );
    assert.ok(navItems({ page: 'bets', tab: 'bet' }).some((i) => i.label === 'Bets' && i.on && i.top));
  });

  it('offers the next gameweek’s matches at their pre-match odds before the deadline', () => {
    const html = cardTitled(body(), 'Gameweek 4');
    assert.ok(text(html).includes('Pre-match odds until the deadline'));
    assert.ok(text(html).includes('Ann v Bob 1 1.90 X 17.00 2 2.10'));
    assert.match(html, /data-action="bet-pick" data-value="4:1:2:2" aria-pressed="false"/);
  });

  it('has nothing to bet on once the deadline has passed and before the gameweek is live', () => {
    deadlineIn(-1);
    assert.ok(text(body()).includes('Nothing to bet on just now'));
  });

  it('asks a visitor to sign up, with what the name and the PIN are for', () => {
    const html = cardTitled(body(), 'Join the betting');
    assert.ok(text(html).includes('Name Everyone sees it on the leaderboard'), text(html));
    assert.ok(text(html).includes('It can’t be reset, so keep it somewhere safe'));
    assert.match(html, /autocomplete="new-password"/);
    assert.match(html, />Create account</);
    assert.ok(cardTitled(body(), 'How it works'));
  });

  it('switches the form to signing in on another device', () => {
    act('bet-mode', 'signin');
    const html = cardTitled(body(), 'Sign in');
    assert.ok(text(html).includes('With the name and PIN you signed up with'));
    assert.match(html, /autocomplete="current-password"/);
    assert.ok(!text(html).includes('Everyone sees it'));
  });

  it('checks the name and PIN before asking the relay', () => {
    act('bet-name', 'O');
    act('bet-enter');
    assert.equal(betting.formNote, 'A name is 3 to 16 letters, digits, - or _');
    act('bet-name', 'Ola');
    act('bet-pin', '12a456');
    act('bet-enter');
    assert.equal(betting.formNote, 'A PIN is six digits');
    assert.ok(text(body()).includes('A PIN is six digits'));
    assert.equal(asked.length, 0);
  });

  it('keeps the token from a sign-up and shows what’s left to stake', async () => {
    relay({ '/bets/signup': [200, { token: 'a'.repeat(64), me: me() }] });
    act('bet-name', 'Ola');
    act('bet-pin', '123456');
    act('bet-enter');
    await settle();
    assert.deepEqual(asked[0], { path: '/bets/signup', body: { name: 'Ola', pin: '123456' }, auth: null });
    assert.equal(betting.token, 'a'.repeat(64));
    assert.equal(betting.pin, '');
    assert.ok(text(cardTitled(body(), 'Ola')).includes('1,000 left in GW 4'));
  });

  it('follows the account’s team once signed in, on any device', async () => {
    state.myTeam = null;
    relay({ '/bets/login': [200, { token: 'a'.repeat(64), me: me([], 2) }] });
    Object.assign(betting, { mode: 'signin', name: 'Ola', pin: '123456' });
    act('bet-enter');
    await settle();
    assert.equal(state.myTeam, 2);
  });

  it('keeps this device’s team on an account that follows none yet, and any team followed later', async () => {
    state.myTeam = 3;
    relay({ '/bets/signup': [200, { token: 'a'.repeat(64), me: me() }], '/bets/team': [200, me([], 3)] });
    Object.assign(betting, { name: 'Ola', pin: '123456' });
    act('bet-enter');
    await settle();
    assert.equal(state.myTeam, 3);
    assert.deepEqual(asked[1], { path: '/bets/team', body: { team: 3 }, auth: `Bearer ${'a'.repeat(64)}` });
    act('follow', '1');
    assert.equal(state.myTeam, 1);
    assert.deepEqual(asked.at(-1)!.body, { team: 1 });
    state.myTeam = null;
  });

  it('shows what the account has won all-time, and a gameweek', () => {
    Object.assign(betting, {
      token: 'a'.repeat(64),
      me: me([bet({ payout: 380, result: 0 }), bet({ gw: 3, stake: 100, payout: 0, result: 2 })]),
    });
    assert.ok(text(cardTitled(body(), 'Ola')).includes('+80 won all-time +40 a gameweek'), text(body()));
  });

  it('signs in, and says why it couldn’t', async () => {
    relay({ '/bets/login': [401, { error: 'Wrong name or PIN' }] });
    Object.assign(betting, { mode: 'signin', name: 'Ola', pin: '000000' });
    act('bet-enter');
    await settle();
    assert.equal(asked[0].path, '/bets/login');
    assert.equal(betting.token, '');
    assert.ok(text(body()).includes('Wrong name or PIN'));
  });
});

describe('the betslip', () => {
  beforeEach(() => Object.assign(betting, { token: 'b'.repeat(64), me: me(), meAt: Date.now() }));

  const slip = () => text(betSlip());

  it('puts a tapped price on the slip, over any page, and takes it off again', () => {
    assert.equal(betSlip(), '');
    act('bet-pick', '4:3:1:2');
    assert.ok(slip().startsWith('Betslip × Ann to win 2.10 Cy v Ann · GW 4 · 1,000 left'), slip());
    assert.match(body(), /data-value="4:3:1:2" aria-pressed="true"/);
    assert.ok(pageHtml(pageBets({ page: 'bets', tab: 'leaderboard' })).includes('class="bet-slip-panel"'));
    act('bet-pick', '4:3:1:2');
    assert.equal(betting.slip, null);
    act('bet-pick', '4:3:1:2');
    act('bet-clear');
    assert.equal(betSlip(), '');
  });

  it('works out the returns, and offers stakes up to what’s left', () => {
    assert.equal(returnsText('100', 2.1), 'Returns 210');
    assert.equal(returnsText('', 2.1), '');
    assert.equal(returnsText('1.5', 2.1), '');
    betting.me = me([bet({ stake: 900 })]);
    act('bet-pick', '4:1:2:0');
    assert.ok(slip().includes('Stake 50 Max 100'), slip());
  });

  it('sends a visitor who isn’t signed in to the Bets page', () => {
    Object.assign(betting, { token: '', me: null });
    act('bet-pick', '4:1:2:0');
    state.route = { page: 'home', tab: '' };
    assert.match(betSlip(), /<a class="bet-button primary" href="#\/bets">Sign up or sign in to bet<\/a>/);
    state.route = { page: 'bets', tab: 'bet' };
    assert.ok(slip().includes('Sign up or sign in above to place it.'));
  });

  it('places the bet with its price, says so, and shows it among yours', async () => {
    const placed = bet({ pick: 2, price: 2.1, stake: 150 });
    relay({ '/bets/bet': [200, { bet: placed, me: me([placed]) }] });
    act('bet-pick', '4:1:2:2');
    act('bet-stake', '150');
    act('bet-place');
    await settle();
    assert.deepEqual(asked[0], {
      path: '/bets/bet',
      body: { gw: 4, home: 1, away: 2, pick: 2, stake: 150, price: 2.1 },
      auth: `Bearer ${'b'.repeat(64)}`,
    });
    assert.equal(betting.slip, null);
    assert.ok(slip().includes('Bet placed Bob to win 2.10 150 to return 315 · GW 4'), slip());
    const mine = text(cardTitled(body(), 'Your bets'));
    assert.ok(mine.includes('Bob to win at 2.10'), mine);
    assert.ok(mine.includes('150 Open'));
    assert.ok(text(cardTitled(body(), 'Ola')).includes('850 left in GW 4'));
  });

  it('takes the book’s price when the odds have moved, for the next try', async () => {
    relay({ '/bets/bet': [409, { error: 'The odds have moved to 1.85', prices: [1.85, 17, 2.15] }] });
    act('bet-pick', '4:1:2:0');
    act('bet-stake', '100');
    act('bet-place');
    await settle();
    assert.equal(betting.slip?.price, 1.85);
    assert.equal(betting.note, 'The odds have moved to 1.85: place it again to take them');
    assert.ok(slip().includes('Ann to win 1.85'));
    assert.ok(slip().endsWith('The odds have moved to 1.85: place it again to take them'));
  });

  it('wants a whole stake before asking', () => {
    act('bet-pick', '4:1:2:0');
    act('bet-stake', '2.5');
    act('bet-place');
    assert.equal(asked.length, 0);
    assert.equal(betting.note, 'Stake a whole number of coins');
  });

  it('signs out when the relay no longer knows the token', async () => {
    relay({ '/bets/bet': [401, { error: 'Sign in first' }] });
    act('bet-pick', '4:1:2:0');
    act('bet-stake', '100');
    act('bet-place');
    await settle();
    assert.equal(betting.token, '');
    assert.equal(betting.me, null);
  });
});

describe('the odds elsewhere', () => {
  it('put themselves on the slip where the match takes a bet at them', () => {
    const m = D.matches.find((x) => x.gw === 4 && x.home === 1)!;
    const row = oddsRow(m.odds!, m);
    assert.match(row, /<button type="button" class="odd pick" data-action="bet-pick" data-value="4:1:2:0" aria-pressed="false"/);
    act('bet-pick', '4:1:2:1');
    assert.match(oddsRow(m.odds!, m), /data-value="4:1:2:1" aria-pressed="true"/);
  });

  it('stay as they were where it doesn’t: settled, an earlier gameweek, or the pre-match odds of a match being played', () => {
    const m = D.matches.find((x) => x.gw === 4 && x.home === 1)!;
    assert.ok(!oddsRow(m.odds!, m, 0).includes('data-action'));
    assert.ok(!oddsRow(m.odds!, m, null, true).includes('data-action'));
    deadlineIn(-1);
    const after = D.matches.find((x) => x.gw === 4 && x.home === 1)!;
    assert.ok(!oddsRow(after.odds!, after).includes('data-action'));
  });
});

describe('the leaderboard and the feed', () => {
  const board: Board = {
    leaders: [
      { name: 'Ola', profit: 180, gws: 1, bets: 1, won: 1 },
      { name: 'Kari', profit: -300, gws: 2, bets: 3, won: 1 },
    ],
    feed: [
      bet({ name: 'Per', gw: 3, stake: 50 }),
      bet({ name: 'Kari', pick: 2, stake: 300, price: 2.1, result: 0, payout: 0 }),
      bet({ result: 0, payout: 380, live: [11, 7] }),
    ],
    counts: [{ gw: 4, players: 3, bets: 7, staked: 1450 }],
  };

  it('ranks everyone on what they’ve won, with the average per gameweek', async () => {
    relay({ '/bets/board': [200, board] });
    assert.ok(text(body('leaderboard')).includes('Loading…'));
    await settle();
    const html = text(body('leaderboard'));
    assert.ok(html.includes('1 Ola +180 +180 1 1 100%'), html);
    assert.ok(html.includes('2 Kari −300 −150 2 3 33%'), html);
  });

  it('lists the settled bets, won and lost, with a live bet’s score when it was made', async () => {
    relay({ '/bets/board': [200, board] });
    body('feed');
    await settle();
    const html = text(cardTitled(body('feed'), 'Feed'));
    assert.ok(html.includes('Kari Bob to win at 2.10'), html);
    assert.ok(html.includes('Lost 300'));
    assert.ok(html.includes('GW 4 · live at 11 - 7 200 → 380 Won +180'), html);
  });

  it('shows open bets too, once their deadline has passed', async () => {
    relay({ '/bets/board': [200, board] });
    body('feed');
    await settle();
    const html = text(cardTitled(body('feed'), 'Feed'));
    assert.ok(html.includes('Per Ann to win at 1.90'), html);
    assert.ok(html.includes('GW 3 50 Open'), html);
  });

  it('says on the Bet tab how many have bet on each gameweek', async () => {
    relay({ '/bets/board': [200, board] });
    body();
    await settle();
    assert.ok(text(cardTitled(body(), 'Gameweek 4')).includes('3 players · 7 bets · 1,450 staked'));
  });

  it('says so when the relay can’t be reached', async () => {
    mock.restoreAll();
    mock.method(globalThis, 'fetch', async () => {
      throw new Error('offline');
    });
    body('leaderboard');
    await settle();
    assert.ok(text(body('leaderboard')).includes('Can’t reach the betting just now.'));
  });
});

function deadlineIn(days: number) {
  const d = data();
  d.gameweeks[3].deadline = new Date(Date.now() + days * 864e5).toISOString();
  setData(d);
}
