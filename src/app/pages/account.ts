// The Account page: signing up and in with a name and a PIN, which works the same on every
// device, and once signed in, the team you follow (kept on the account, so every device follows
// it) and your betting. The account and its calls to the relay are betting.ts's.

import { ALLOWANCE } from '../../shared/bets.ts';
import { coins } from '../bet-slip.ts';
import { account, betting } from '../betting.ts';
import { avatar, card, empty, seg } from '../components.ts';
import { esc } from '../format.ts';
import { personSvg } from '../icons.ts';
import { first, mgr } from '../lookups.ts';
import type { PageView } from '../render.ts';
import { href } from '../router.ts';
import { D, LIVE_URL, state } from '../state.ts';
import { balance } from './bets.ts';
import { followButton } from './team.ts';

export function pageAccount(): PageView {
  const me = account();
  return {
    title: 'Account',
    header: {
      logo: `<span class="bets-logo">${personSvg}</span>`,
      title: me ? esc(me.name) : 'Account',
      sub: me ? 'Signed in on this device' : 'One account for your phone and your computer',
    },
    body: !LIVE_URL
      ? card({ title: 'Account', body: empty('Accounts need the live relay, which this visit is without.') })
      : !betting.token
        ? `<div class="cols"><div class="col">${formCard()}</div><div class="col">${whyCard()}</div></div>`
        : !me
          ? card({ title: 'Account', body: empty('Loading…') })
          : `<div class="cols"><div class="col">${teamCard()}</div><div class="col">${bettingCard()}${signOutCard()}</div></div>`,
  };
}

// Signing up, or in on another device: one form, switched between the two.
function formCard() {
  const up = betting.mode === 'signup';
  const field = (id: string, label: string, hint: string, attrs: string) =>
    `<label class="bet-field" for="${id}"><span class="bet-label">${label}</span><input id="${id}" ${attrs}><span class="bet-help">${hint}</span></label>`;
  const busy = betting.busy ? ' disabled' : '';
  return card({
    title: up ? 'Create an account' : 'Sign in',
    sub: up ? 'A name and a PIN, the same on every device' : 'With the name and PIN you signed up with',
    action: seg(
      'bet-mode',
      [
        ['signup', 'Sign up'],
        ['signin', 'Sign in'],
      ],
      betting.mode,
    ),
    body: `<form class="bet-form">
      ${field(
        'bet-name',
        'Name',
        up ? 'Everyone sees it on the betting leaderboard: 3 to 16 letters, digits, - or _' : '',
        `data-action="bet-name" value="${esc(betting.name)}" maxlength="16" autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="${up ? 'Pick a name' : 'Your name'}"`,
      )}
      ${field(
        'bet-pin',
        'PIN',
        up ? 'Six digits, to sign in with on your phone and your computer. It can’t be reset, so keep it somewhere safe.' : '',
        `data-action="bet-pin" value="${esc(betting.pin)}" type="password" inputmode="numeric" maxlength="6" pattern="[0-9]*" autocomplete="${up ? 'new-password' : 'current-password'}" placeholder="••••••"`,
      )}
      <button type="submit" class="bet-button primary" data-action="bet-enter"${busy}>${up ? 'Create account' : 'Sign in'}</button>
      ${betting.formNote ? `<p class="bet-note" role="alert">${esc(betting.formNote)}</p>` : ''}
    </form>`,
  });
}

function whyCard() {
  return card({
    title: 'What it’s for',
    body: `<ul class="bet-how">
      <li>The team you follow, on every device you sign in on.</li>
      <li>Betting fake money on the head-to-heads: ${coins(ALLOWANCE)} to stake every gameweek, on the <a href="${href.bets()}">Bets</a> page.</li>
      <li>Only your name is shown to anyone, on the betting leaderboard. Your PIN is never stored, only a scrambled copy of it.</li>
    </ul>`,
  });
}

// The league's teams, the one you follow first, each with its Follow button.
function teamCard() {
  const order = [...D.managers.map((m) => m.id)].sort((a, b) => Number(b === state.myTeam) - Number(a === state.myTeam));
  const rows = order.map(
    (id) => `<div class="team-row${id === state.myTeam ? ' mine' : ''}">
      <a class="team-link" href="${href.team(id)}">${avatar(id, 32)}<span class="team-text"><span class="team-title">${esc(mgr(id)!.team)}</span><span class="team-meta">${first(id)}</span></span></a>
      ${followButton(id)}
    </div>`,
  );
  return card({
    title: 'Your team',
    sub:
      state.myTeam && mgr(state.myTeam) ? 'Followed on every device you sign in on' : 'Follow yours, and every device you sign in on will',
    body: `<div class="teams-list">${rows.join('')}</div>`,
  });
}

function bettingCard() {
  return card({
    title: 'Betting',
    action: `<a class="bet-link" href="${href.bets()}">Bets</a>`,
    body: balance(betting.me!),
  });
}

function signOutCard() {
  return card({
    title: 'This device',
    body: `<div class="bet-slip"><button type="button" class="bet-button" data-action="bet-signout">Sign out</button></div>`,
  });
}
