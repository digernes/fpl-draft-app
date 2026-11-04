// The betslip: a panel over the foot of every page (at the bottom right from 769px, above the
// bottom bar on a phone) once a price is tapped, wherever the odds are, with the stake and what
// it returns, and once the bet is placed, that it was. The account and the calls are betting.ts's.

import { ALLOWANCE, leftIn, seasonSlug, type Bet } from '../shared/bets.ts';
import { account, betting, returnsText, slipMatch, slipPrice } from './betting.ts';
import { first } from './lookups.ts';
import { esc } from './format.ts';
import { href } from './router.ts';
import { D, state } from './state.ts';

export const coins = (n: number) => Math.round(n).toLocaleString('en-GB');
export const signedCoins = (n: number) => (n > 0 ? `+${coins(n)}` : n < 0 ? `−${coins(-n)}` : '0');
export const pickName = (b: Pick<Bet, 'home' | 'away' | 'pick'>) => [`${first(b.home)} to win`, 'Draw', `${first(b.away)} to win`][b.pick];

const QUICK = [50, 100, 250];

const panel = (body: string) =>
  `<aside class="bet-slip-panel" aria-label="Betslip"><div class="bsp-head"><span class="bsp-title">Betslip</span><button type="button" class="bsp-close" data-action="bet-clear" aria-label="Close the betslip">×</button></div>${body}</aside>`;

const noteLine = () => (betting.note ? `<p class="bet-note" role="status">${esc(betting.note)}</p>` : '');

/** The panel, or nothing while the slip is empty. */
export function betSlip() {
  const done = betting.placed;
  if (done && !betting.slip)
    return panel(`<div class="bet-slip">
      <p class="bet-placed">Bet placed</p>
      <div class="bet-slip-pick"><b>${pickName(done)}</b><span class="bet-slip-price">${done.price.toFixed(2)}</span></div>
      <div class="bet-slip-match">${coins(done.stake)} to return ${coins(Math.round(done.stake * done.price))} · GW ${done.gw}</div>
      ${state.route.page === 'bets' ? '' : `<a class="bet-button" href="${href.bets()}">Your bets</a>`}
    </div>`);
  const s = betting.slip;
  const m = s && slipMatch(s);
  if (!s || !m) return '';
  const price = slipPrice(s);
  const me = account();
  const left = me ? leftIn(me.bets, seasonSlug(D), s.gw) : ALLOWANCE;
  const quick = [...QUICK.filter((n) => n < left), left]
    .map(
      (n) => `<button type="button" class="chip" data-action="bet-quick" data-value="${n}">${n === left ? `Max ${coins(n)}` : n}</button>`,
    )
    .join('');
  const signIn =
    state.route.page === 'bets' && state.route.tab === 'bet'
      ? '<p class="bet-hint">Sign up or sign in above to place it.</p>'
      : `<a class="bet-button primary" href="${href.bets()}">Sign up or sign in to bet</a>`;
  const place = !betting.token
    ? signIn
    : !me
      ? '<p class="bet-hint">Loading your account…</p>'
      : !price
        ? '<p class="bet-hint">This match takes no bets just now.</p>'
        : left <= 0
          ? `<p class="bet-hint">Nothing left to stake in gameweek ${s.gw}.</p>`
          : `<label class="bet-stake">Stake<input id="bet-stake" data-action="bet-stake" value="${esc(betting.stake)}" inputmode="numeric" pattern="[0-9]*" placeholder="Coins" autocomplete="off"></label>
            <div class="bet-quick">${quick}</div>
            <div class="bet-returns" id="bet-returns">${returnsText(betting.stake, price)}</div>
            <button type="submit" class="bet-button primary" data-action="bet-place"${betting.busy ? ' disabled' : ''}>Place bet</button>`;
  return panel(`<form class="bet-slip">
    <div class="bet-slip-pick"><b>${pickName(s)}</b><span class="bet-slip-price">${price ? price.toFixed(2) : '–'}</span></div>
    <div class="bet-slip-match">${first(m.home)} v ${first(m.away)} · GW ${m.gw}${m.started ? ' · live odds' : ''}${me ? ` · ${coins(left)} left` : ''}</div>
    ${place}
  </form>${noteLine()}`);
}
