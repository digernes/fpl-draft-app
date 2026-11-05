// The betting's page side for tests: a small league with GW 4 (Ann v Bob, Cy v Ann) priced,
// its deadline a day off; bets; the relay's book as fetch answers it; and the account state
// cleared before each test.

import { afterEach, beforeEach, mock } from 'node:test';

import { runAction } from '../../src/app/actions.ts';
import { betting } from '../../src/app/betting.ts';
import { setData, setLive, state } from '../../src/app/state.ts';
import type { Bet, Me } from '../../src/shared/bets.ts';
import type { Data } from '../../src/shared/data.ts';
import { squads } from './league.ts';

export function data(): Data {
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

export const bet = (more: Partial<Bet> = {}): Bet => ({
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

export const me = (bets: Bet[] = [], team: number | null = null): Me => ({ name: 'Ola', team, bets });

/** What was asked of the relay, but for the leaderboard the Bet tab asks for as it draws. */
export const asked: { path: string; body?: Record<string, unknown>; auth: string | null }[] = [];

/** The relay's book as fetch answers it: what each path answers. */
export function relay(answers: Record<string, [number, unknown]>) {
  asked.length = 0;
  mock.restoreAll();
  mock.method(globalThis, 'fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    const headers = (init.headers ?? {}) as Record<string, string>;
    if (path !== '/bets/board')
      asked.push({ path, body: init.body ? JSON.parse(String(init.body)) : undefined, auth: headers.Authorization ?? null });
    const [status, body] = answers[path] ?? [404, { error: 'Not found' }];
    return Response.json(body, { status });
  });
}

export const settle = () => new Promise((resolve) => setImmediate(resolve));
export const act = (action: string, value = '') => runAction({ dataset: { action, value } } as unknown as HTMLElement);

/** Before each test: the league, nobody signed in, and a relay that knows nothing. */
export function freshBetting() {
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
}
