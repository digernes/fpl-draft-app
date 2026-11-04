// The betting's side of the page: the account signed in on this device (its token kept in
// localStorage), its bets and the leaderboard from the relay's book (worker/bets.ts), the
// betslip being filled in, and the odds a match takes a bet at, worked out as the book does
// (shared/bets.ts) so the slip shows what the book will take.

import { NAME, NAME_RULE, oddsNow, PIN, type Bet, type Board, type Me, type Outcome } from '../shared/bets.ts';
import type { Match } from '../shared/data.ts';
import type { SlimLive } from '../shared/live.ts';
import { onAction } from './actions.ts';
import { renderView } from './render.ts';
import { D, live, LIVE_URL, state, store } from './state.ts';
import { statsFor } from './stats-files.ts';

const TOKEN = 'draft.betToken';
const AGAIN_MS = 60_000; // the account and the leaderboard, asked again at most this often

export interface SlipPick {
  gw: number;
  home: number;
  away: number;
  pick: Outcome;
  /** The book's price, when it turned the page's down: taken if placed again. */
  price?: number;
}

/** Everything the betting shows that isn't data.json's. */
export const betting = {
  token: store.get(TOKEN, ''),
  me: null as Me | null,
  meAt: 0,
  board: null as Board | null,
  boardAt: 0,
  /** The relay couldn't be reached. */
  offline: false,
  /** Whether the account's followed team has been taken up on this visit (adopt). */
  teamTaken: false,
  /** The sign-in form: signing up or in, its fields, kept as they're typed for the page's redraws, and what came of it. */
  mode: 'signup' as 'signup' | 'signin',
  name: '',
  pin: '',
  formNote: null as string | null,
  slip: null as SlipPick | null,
  stake: '',
  busy: false,
  /** Why the last bet tried wasn't taken. */
  note: null as string | null,
  /** The bet just placed, which the slip shows until it's closed or another price tapped. */
  placed: null as Bet | null,
};

type Answer = { status: number; body: Record<string, unknown> };

async function ask(path: string, body?: object): Promise<Answer> {
  const headers: Record<string, string> = betting.token ? { Authorization: `Bearer ${betting.token}` } : {};
  try {
    const res = await fetch(`${LIVE_URL}${path}`, {
      method: body ? 'POST' : 'GET',
      body: body ? JSON.stringify(body) : undefined,
      headers,
      cache: 'no-store',
    });
    betting.offline = false;
    return { status: res.status, body: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
  } catch {
    betting.offline = true;
    return { status: 0, body: { error: 'Can’t reach the betting just now' } };
  }
}

const errorOf = (a: Answer) => (typeof a.body.error === 'string' ? a.body.error : 'Something went wrong: try again');

/** The followed team, kept on the account so every device it's signed in on follows it. */
export function saveTeam() {
  if (betting.token && LIVE_URL) void ask('/bets/team', { team: state.myTeam });
}

// Once a visit, and at each sign-in: the account's team is followed here, or this device's
// is kept on an account that has none yet.
function adopt(me: Me) {
  if (betting.teamTaken) return;
  betting.teamTaken = true;
  if (me.team === null) return state.myTeam !== null ? saveTeam() : undefined;
  state.myTeam = me.team;
  store.set('draft.myTeam', String(me.team));
}

function signOut() {
  betting.token = '';
  betting.me = null;
  store.set(TOKEN, '');
}

/** The account signed in here, asked of the relay when it's due; null while signed out or loading. */
export function account(): Me | null {
  if (betting.token && LIVE_URL && Date.now() - betting.meAt > AGAIN_MS) {
    betting.meAt = Date.now();
    void ask('/bets/me').then((a) => {
      if (a.status === 200) adopt((betting.me = a.body as unknown as Me));
      else if (a.status === 401) signOut();
      renderView();
    });
  }
  return betting.me;
}

/** The leaderboard and the settled bets, asked of the relay when they're due; null while loading. */
export function board(): Board | null {
  if (LIVE_URL && Date.now() - betting.boardAt > AGAIN_MS) {
    betting.boardAt = Date.now();
    void ask('/bets/board').then((a) => {
      if (a.status === 200) betting.board = a.body as unknown as Board;
      renderView();
    });
  }
  return betting.board;
}

// The gameweek's live feed: the relay's while it's played, else the last build's.
const feedFor = (gw: number): SlimLive | null => (live?.gw === gw ? live.feed : D.live?.gw === gw ? D.live : null);

/** The odds a match takes a bet at now, or why it doesn't, as the book works them out. */
export function oddsFor(m: Match) {
  return oddsNow(D, m, Date.now(), feedFor(m.gw), (fixture) => {
    const file = statsFor(m.gw);
    return typeof file === 'object' ? file.matches[fixture] : undefined;
  });
}

export const slipMatch = (s: SlipPick) => D.matches.find((m) => m.gw === s.gw && m.home === s.home && m.away === s.away);

/** The slip's price: the book's when it turned the page's down, else the page's own now; null when the match takes no bet. */
export function slipPrice(s: SlipPick): number | null {
  const m = slipMatch(s);
  const odds = m && oddsFor(m);
  if (!odds || typeof odds === 'string') return null;
  return s.price ?? odds.prices[s.pick];
}

onAction('bet-name', (value) => (betting.name = value));
onAction('bet-pin', (value) => (betting.pin = value));

async function enter() {
  const name = betting.name.trim();
  if (!NAME.test(name)) betting.formNote = `A name is ${NAME_RULE}`;
  else if (!PIN.test(betting.pin)) betting.formNote = 'A PIN is six digits';
  else {
    [betting.busy, betting.formNote] = [true, null];
    renderView();
    const a = await ask(betting.mode === 'signup' ? '/bets/signup' : '/bets/login', { name, pin: betting.pin });
    betting.busy = false;
    if (a.status === 200) {
      betting.token = String(a.body.token);
      store.set(TOKEN, betting.token);
      betting.me = a.body.me as Me;
      betting.meAt = Date.now();
      betting.pin = '';
      betting.teamTaken = false;
      adopt(betting.me);
    } else betting.formNote = errorOf(a);
  }
  renderView();
}

onAction('bet-mode', (value) => {
  [betting.mode, betting.formNote] = [value === 'signin' ? 'signin' : 'signup', null];
  renderView();
});
onAction('bet-enter', () => void enter());
onAction('bet-signout', () => {
  void ask('/bets/logout', {});
  signOut();
  betting.note = null;
  renderView();
});

// A price tapped: on the slip, or off it when it's there already.
onAction('bet-pick', (value) => {
  const [gw, home, away, pick] = value.split(':').map(Number);
  const s = betting.slip;
  betting.slip =
    s && s.gw === gw && s.home === home && s.away === away && s.pick === pick ? null : { gw, home, away, pick: pick as Outcome };
  betting.note = null;
  renderView();
});
onAction('bet-clear', () => {
  [betting.slip, betting.placed, betting.note] = [null, null, null];
  renderView();
});

/** What a stake pays back at a price, as the slip shows it. */
export const returnsText = (stake: string, price: number | null) =>
  price && /^\d+$/.test(stake) && Number(stake) > 0 ? `Returns ${Math.round(Number(stake) * price).toLocaleString('en-GB')}` : '';

// Typed: only the returns change, so the field keeps its focus.
onAction('bet-stake', (value) => {
  betting.stake = value;
  const returns = document.getElementById('bet-returns');
  if (returns && betting.slip) returns.textContent = returnsText(value, slipPrice(betting.slip));
});
onAction('bet-quick', (value) => {
  betting.stake = value;
  renderView();
});

onAction('bet-place', async () => {
  const s = betting.slip;
  const price = s && slipPrice(s);
  if (!s || !price || betting.busy) return;
  if (!/^\d+$/.test(betting.stake) || Number(betting.stake) < 1) {
    betting.note = 'Stake a whole number of coins';
    return renderView();
  }
  betting.busy = true;
  renderView();
  const a = await ask('/bets/bet', { gw: s.gw, home: s.home, away: s.away, pick: s.pick, stake: Number(betting.stake), price });
  betting.busy = false;
  if (a.status === 200) {
    betting.me = a.body.me as Me;
    [betting.placed, betting.note, betting.slip, betting.stake] = [a.body.bet as Bet, null, null, ''];
  } else {
    if (a.status === 401) signOut();
    const prices = a.body.prices as number[] | undefined;
    if (prices) betting.slip = { ...s, price: prices[s.pick] };
    betting.note = prices ? `${errorOf(a)}: place it again to take them` : errorOf(a);
  }
  renderView();
});
