// The betting page: fake money on the draft league's head-to-heads, as betmobapp.com has it.
// Its Bet tab has the matches that take a bet now with their prices (before the deadline the
// pre-match odds, while the gameweek is played the live ones), the account, the betslip and
// your bets; the Leaderboard ranks everyone on what they've won, and the Feed has the bets
// once they're settled. The accounts and bets are the relay's (betting.ts).

import { ALLOWANCE, leadersOf, leftIn, OUTCOMES, profitOf, seasonSlug, type Bet, type Leader } from '../../shared/bets.ts';
import type { Match } from '../../shared/data.ts';
import { coins, pickName, signedCoins } from '../bet-slip.ts';
import { account, betting, board, oddsFor } from '../betting.ts';
import { avatar, card, empty, seg } from '../components.ts';
import { countdown, esc, fmtShortDay, fmtTime } from '../format.ts';
import { coinsSvg } from '../icons.ts';
import { first, isArchive, isLive } from '../lookups.ts';
import type { PageView } from '../render.ts';
import { BETS_TABS, href, type Route } from '../router.ts';
import { D, LIVE_URL } from '../state.ts';
import { dataTable, posCol, type Column } from '../table.ts';

const LABELS: Record<(typeof BETS_TABS)[number], string> = { bet: 'Bet', leaderboard: 'Leaderboard', feed: 'Feed' };

export function pageBets(route: Route): PageView {
  const tab = route.tab as (typeof BETS_TABS)[number];
  const body = !LIVE_URL
    ? card({ title: 'Betting', body: empty('Betting needs the live relay, which this visit is without.') })
    : tab === 'leaderboard'
      ? leaderboardCard()
      : tab === 'feed'
        ? feedCard()
        : betTab();
  return {
    title: tab === 'bet' ? 'Bets' : `${LABELS[tab]} · Bets`,
    header: {
      logo: `<span class="bets-logo">${coinsSvg}</span>`,
      title: 'Bets',
      titleHref: href.bets(),
      sub: `Fake money on the head-to-heads · ${coins(ALLOWANCE)} to stake each gameweek`,
      tabs: BETS_TABS.map((t) => ({ id: t, label: LABELS[t], href: href.bets(t) })),
      tab,
    },
    body,
  };
}

// --- Bet -------------------------------------------------------------------------------

function betTab() {
  if (isArchive()) return card({ title: 'Bets', body: empty('Betting is on the season being played.') });
  const me = account();
  return `<div class="cols"><div class="col">${accountCard()}${roundCards()}</div><div class="col">${me ? myBetsCard(me.bets) : howCard()}</div></div>`;
}

// The gameweek being played, live, and the next before its deadline: each with its matches.
function roundCards() {
  const now = Date.now();
  const deadline = (gw: number) => D.gameweeks.find((g) => g.id === gw)?.deadline ?? '';
  const playing = isLive() ? D.meta.currentGw : null;
  const next = Date.parse(deadline(D.meta.nextGw)) > now && D.matches.some((m) => m.gw === D.meta.nextGw && m.odds) ? D.meta.nextGw : null;
  const cards = [
    playing && roundCard(playing, 'Live odds, as they stand the moment you bet'),
    next &&
      roundCard(
        next,
        `Pre-match odds until the deadline, ${fmtShortDay.format(new Date(deadline(next)))} ${fmtTime.format(new Date(deadline(next)))} (in ${countdown(deadline(next))})`,
      ),
  ].filter(Boolean);
  return cards.length
    ? cards.join('')
    : card({ title: 'Matches', body: empty('Nothing to bet on just now: the next gameweek’s odds come with its squads.') });
}

function roundCard(gw: number, sub: string) {
  const matches = D.matches.filter((m) => m.gw === gw);
  return card({ title: `Gameweek ${gw}`, sub, body: `<div class="bet-matches">${matches.map(matchRow).join('')}</div>` });
}

function matchRow(m: Match) {
  const odds = oddsFor(m);
  const s = betting.slip;
  const score = m.started && m.homePts !== null ? `${m.homePts} - ${m.awayPts}` : 'v';
  const side = (id: number, cls: string) => `<span class="bet-side ${cls}">${avatar(id, 24)}<span>${first(id)}</span></span>`;
  const prices =
    typeof odds === 'string'
      ? `<div class="bet-closed">${esc(odds)}</div>`
      : `<div class="bet-odds">${OUTCOMES.map((pick) => {
          const on = s?.gw === m.gw && s.home === m.home && s.away === m.away && s.pick === pick;
          const tip = `${pickName({ ...m, pick })} · ${Math.round(odds.p[pick] * 100)}% chance${odds.live ? ' (live)' : ''}`;
          return `<button type="button" class="bet-odd" data-action="bet-pick" data-value="${m.gw}:${m.home}:${m.away}:${pick}" aria-pressed="${on}" data-tip="${esc(tip)}"><span class="odd-label">${['1', 'X', '2'][pick]}</span><span class="odd-price">${odds.prices[pick].toFixed(2)}</span></button>`;
        }).join('')}</div>`;
  return `<div class="bet-match"><a class="bet-teams" href="${href.match(m)}">${side(m.home, 'home')}<span class="bet-score">${score}</span>${side(m.away, 'away')}</a>${prices}</div>`;
}

// Signed out: the form to sign up, or to sign in on another device. Signed in: who, and
// what's left to stake.
function accountCard() {
  const me = betting.me;
  if (betting.token) {
    if (!me) return card({ title: 'Your account', body: empty('Loading…') });
    const season = seasonSlug(D);
    const open = [...new Set([isLive() ? D.meta.currentGw : null, D.meta.nextGw].filter((gw): gw is number => gw !== null))];
    const left = open.map((gw) => `<span class="bet-left"><b>${coins(leftIn(me.bets, season, gw))}</b> left in GW ${gw}</span>`).join('');
    // All-time, as the leaderboard counts it: settled bets only.
    const [mine] = leadersOf(me.bets);
    const won = mine
      ? `<span class="bet-left"><b>${signedCoins(mine.profit)}</b> won all-time</span><span class="bet-left"><b>${signedCoins(mine.profit / mine.gws)}</b> a gameweek</span>`
      : '';
    return card({
      title: esc(me.name),
      sub: 'Signed in on this device',
      action: '<button type="button" class="bet-link" data-action="bet-signout">Sign out</button>',
      body: `<div class="bet-balance">${left}${won}</div>`,
    });
  }
  const up = betting.mode === 'signup';
  const field = (id: string, label: string, hint: string, attrs: string) =>
    `<label class="bet-field" for="${id}"><span class="bet-label">${label}</span><input id="${id}" ${attrs}><span class="bet-help">${hint}</span></label>`;
  const busy = betting.busy ? ' disabled' : '';
  return card({
    title: up ? 'Join the betting' : 'Sign in',
    sub: up ? `Get ${coins(ALLOWANCE)} to bet with every gameweek` : 'With the name and PIN you signed up with',
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
        up ? 'Everyone sees it on the leaderboard: 3 to 16 letters, digits, - or _' : '',
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

// What a visitor gets, beside the form.
function howCard() {
  return card({
    title: 'How it works',
    body: `<ul class="bet-how">
      <li>${coins(ALLOWANCE)} fake coins to stake every gameweek, a fresh ${coins(ALLOWANCE)} each time.</li>
      <li>Tap any price, here or on a match, to put it on your betslip.</li>
      <li>Bet before the deadline at the pre-match odds, or while the gameweek is played at the live odds.</li>
      <li>Bets are settled once FPL has finished the gameweek, and the leaderboard ranks what everyone has won.</li>
    </ul>`,
  });
}

// A bet as a row: the pick and its price, the match, and what came of it.
function betRow(b: Bet, withName: boolean) {
  const outcome =
    b.payout === undefined
      ? '<span class="bet-result open">Open</span>'
      : b.payout > 0
        ? `<span class="bet-result won">Won ${signedCoins(profitOf(b))}</span>`
        : `<span class="bet-result lost">Lost ${coins(b.stake)}</span>`;
  const live = b.live ? ` · live at ${b.live[0]} - ${b.live[1]}` : '';
  const m = { gw: b.gw, home: b.home, away: b.away };
  return `<div class="bet-row">
    ${withName ? `<span class="bet-who">${esc(b.name)}</span>` : ''}
    <span class="bet-what"><b>${pickName(b)}</b> at ${b.price.toFixed(2)}</span>
    <a class="bet-where" href="${href.match(m)}">${avatar(b.home)}${avatar(b.away)}GW ${b.gw}${live}</a>
    <span class="bet-stakes">${coins(b.stake)}${b.payout ? ` → ${coins(b.payout)}` : ''}</span>
    ${outcome}
  </div>`;
}

function myBetsCard(bets: Bet[]) {
  const season = seasonSlug(D);
  const mine = bets.filter((b) => b.season === season);
  const won = mine.reduce((t, b) => t + profitOf(b), 0);
  return card({
    title: 'Your bets',
    sub: mine.some((b) => b.payout !== undefined) ? `${signedCoins(won)} this season` : '',
    body: mine.length ? `<div class="bet-rows">${mine.map((b) => betRow(b, false)).join('')}</div>` : empty('No bets yet this season.'),
  });
}

// --- Leaderboard and feed ----------------------------------------------------------------

type LeaderRow = Leader & { id: number; rank: number };

function leaderboardCard() {
  const b = board();
  if (!b) return card({ title: 'Leaderboard', body: empty(betting.offline ? 'Can’t reach the betting just now.' : 'Loading…') });
  const me = account()?.name;
  const rows: LeaderRow[] = b.leaders.map((l, i) => ({ ...l, id: i + 1, rank: i + 1 }));
  const cols: Column<LeaderRow>[] = [
    posCol,
    { label: '', w: 'minmax(0,1fr)', cls: 'c-team', cell: (r) => `<span class="bet-leader">${esc(r.name)}</span>` },
    { label: 'Won', w: '64px', cls: 'c-pts', tip: 'What the bets paid back, less what was staked', cell: (r) => signedCoins(r.profit) },
    { label: 'Avg', w: '52px', tip: 'Won per gameweek bet in', cell: (r) => signedCoins(r.profit / r.gws) },
    { label: 'GWs', w: '36px', from: 'sm', tip: 'Gameweeks bet in', cell: (r) => r.gws },
    { label: 'Bets', w: '36px', from: 'sm', cell: (r) => r.bets },
    { label: 'Hit', w: '40px', from: 'md', tip: 'Bets won', cell: (r) => `${Math.round((100 * r.won) / r.bets)}%` },
  ];
  return card({
    title: 'Leaderboard',
    sub: 'All-time, from the bets settled so far',
    body: rows.length
      ? dataTable(cols, rows, { rowClass: (r) => (r.name === me ? 'featured' : '') })
      : empty('Nobody’s bets have been settled yet: they are once FPL has finished the gameweek.'),
  });
}

function feedCard() {
  const b = board();
  if (!b) return card({ title: 'Feed', body: empty(betting.offline ? 'Can’t reach the betting just now.' : 'Loading…') });
  return card({
    title: 'Feed',
    sub: 'Everyone’s bets, once their matches are settled',
    body: b.feed.length ? `<div class="bet-rows">${b.feed.map((x) => betRow(x, true)).join('')}</div>` : empty('No bets settled yet.'),
  });
}
