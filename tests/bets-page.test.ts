import { drawIntoNothing } from './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { beforeEach, describe, it, mock } from 'node:test';

import { betting, returnsText } from '../src/app/betting.ts';
import { betSlip } from '../src/app/bet-slip.ts';
import { oddsRow } from '../src/app/match-odds.ts';
import { pageBets } from '../src/app/pages/bets.ts';
import { navItems, pageHtml } from '../src/app/render.ts';
import { href, parseRoute } from '../src/app/router.ts';
import { D, setData, state } from '../src/app/state.ts';
import type { Board } from '../src/shared/bets.ts';
import { act, asked, bet, data, freshBetting, me, relay, settle } from './fixtures/betting.ts';
import { cardTitled, text } from './fixtures/html.ts';

drawIntoNothing();
freshBetting();

const body = (tab = 'bet') => pageBets({ page: 'bets', tab }).body;

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

  it('shows what the account has won all-time, and a gameweek', () => {
    Object.assign(betting, {
      token: 'a'.repeat(64),
      me: me([bet({ payout: 380, result: 0 }), bet({ gw: 3, stake: 100, payout: 0, result: 2 })]),
    });
    assert.ok(text(cardTitled(body(), 'Ola')).includes('+80 won all-time +40 a gameweek'), text(body()));
  });

  it('sends a visitor to the Account page to sign up or in', () => {
    assert.match(cardTitled(body(), 'Bet with fake money'), /<a class="bet-button primary" href="#\/account">Sign up or sign in<\/a>/);
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

  it('sends a visitor who isn’t signed in to the Account page', () => {
    Object.assign(betting, { token: '', me: null });
    act('bet-pick', '4:1:2:0');
    state.route = { page: 'home', tab: '' };
    assert.match(betSlip(), /<a class="bet-button primary" href="#\/account">Sign up or sign in to bet<\/a>/);
    state.route = { page: 'bets', tab: 'bet' }; // for the redraws still to come of earlier answers
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
