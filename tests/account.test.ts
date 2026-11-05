import { drawIntoNothing } from './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { betting } from '../src/app/betting.ts';
import '../src/app/chrome.ts';
import { pageAccount } from '../src/app/pages/account.ts';
import { href, parseRoute } from '../src/app/router.ts';
import { state } from '../src/app/state.ts';
import { act, asked, bet, freshBetting, me, relay, settle } from './fixtures/betting.ts';
import { cardTitled, text } from './fixtures/html.ts';

drawIntoNothing();
freshBetting();

const body = () => pageAccount().body;

describe('the Account page, signed out', () => {
  it('has its own address', () => {
    assert.deepEqual(parseRoute('#/account'), { page: 'account', tab: '' });
    assert.equal(href.account(), '#/account');
    assert.equal(pageAccount().title, 'Account');
  });

  it('asks a visitor to sign up, with what the name and the PIN are for', () => {
    const html = cardTitled(body(), 'Create an account');
    assert.ok(text(html).includes('Name Everyone sees it on the betting leaderboard'), text(html));
    assert.ok(text(html).includes('It can’t be reset, so keep it somewhere safe'));
    assert.match(html, /autocomplete="new-password"/);
    assert.match(html, />Create account</);
    assert.ok(text(cardTitled(body(), 'What it’s for')).includes('The team you follow, on every device you sign in on.'));
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

describe('the Account page, signed in', () => {
  it('keeps the token from a sign-up, and shows the account', async () => {
    relay({ '/bets/signup': [200, { token: 'a'.repeat(64), me: me() }] });
    act('bet-name', 'Ola');
    act('bet-pin', '123456');
    act('bet-enter');
    await settle();
    assert.deepEqual(asked[0], { path: '/bets/signup', body: { name: 'Ola', pin: '123456' }, auth: null });
    assert.equal(betting.token, 'a'.repeat(64));
    assert.equal(betting.pin, '');
    assert.equal(pageAccount().header!.title, 'Ola');
    assert.ok(text(cardTitled(body(), 'Betting')).includes('1,000 left in GW 4'));
    assert.match(cardTitled(body(), 'This device'), /data-action="bet-signout">Sign out</);
  });

  it('lists the league’s teams to follow, the one followed first', () => {
    Object.assign(betting, { token: 'a'.repeat(64), me: me(), meAt: Date.now() });
    state.myTeam = 2;
    const html = text(cardTitled(body(), 'Your team'));
    assert.ok(html.startsWith('Your team Followed on every device you sign in on Bob FC Bob'), html);
    state.myTeam = null;
    assert.ok(text(cardTitled(body(), 'Your team')).includes('Follow yours, and every device you sign in on will'));
  });

  it('follows the account’s team once signed in, on any device', async () => {
    state.myTeam = null;
    relay({ '/bets/login': [200, { token: 'a'.repeat(64), me: me([], 2) }] });
    Object.assign(betting, { mode: 'signin', name: 'Ola', pin: '123456' });
    act('bet-enter');
    await settle();
    assert.equal(state.myTeam, 2);
    state.myTeam = null;
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

  it('shows what the account has won all-time', () => {
    Object.assign(betting, { token: 'a'.repeat(64), me: me([bet({ payout: 380, result: 0 })]), meAt: Date.now() });
    assert.ok(text(cardTitled(body(), 'Betting')).includes('+180 won all-time +180 a gameweek'));
  });
});
