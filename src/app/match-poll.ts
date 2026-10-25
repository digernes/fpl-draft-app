// A head-to-head's Who will win?, as fotmob.com's poll: before the deadline a visitor picks
// a home win, the draw or an away win, one tap, and then sees each choice's share of the
// votes and how many there are, as everyone does once voting has closed. The votes are
// kept by the live relay (worker/poll.ts), asked for only on the match's own page; without
// it (not deployed, ?relay=off, an archive) the card is the odds model's alone, as before.

import type { Match } from '../shared/data.ts';
import { CHOICES, isVotes, pollPath, type Choice, type PollAnswer, type Votes } from '../shared/poll.ts';
import { onAction } from './actions.ts';
import { avatar } from './components.ts';
import { pct, plural } from './format.ts';
import { first, gwInfo, isArchive } from './lookups.ts';
import { modelOdds, winChances } from './match-odds.ts';
import { renderView } from './render.ts';
import { D, LIVE_URL, state, store } from './state.ts';

const REFRESH_MS = 60 * 1000; // others' votes, while the page is redrawn

// By poll path: the votes as last heard (null until they're in), or that the relay hasn't any.
const polls = new Map<string, { votes: Votes | null; at: number; failed?: true; voting?: true }>();

const pathOf = (m: Match) => pollPath(D.meta.season, m.gw, m.home, m.away);
const voteKey = (m: Match) => `draft.vote:${pathOf(m).slice('/poll/'.length)}`;

/** The visitor's choice in a match's poll, remembered in this browser. */
export const myVote = (m: Match): Choice | null => {
  const choice = store.get(voteKey(m), '') as Choice;
  return CHOICES.includes(choice) ? choice : null;
};

/** Voting closes at the gameweek's deadline. */
export function pollClosed(m: Match, now = Date.now()) {
  const deadline = gwInfo(m.gw)?.deadline;
  return m.started || !deadline || now >= Date.parse(deadline);
}

// A random id for this browser, so the relay counts one vote from it per match; nothing else.
function voterId() {
  const kept = store.get('draft.voter', '');
  if (/^[0-9a-f]{32}$/.test(kept)) return kept;
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  store.set('draft.voter', id);
  return id;
}

/** The match's votes, asked of the relay the first time they're wanted and again a minute on; null while there are none to show. */
function votesFor(m: Match): Votes | null {
  if (!LIVE_URL || isArchive()) return null;
  const path = pathOf(m);
  const poll = polls.get(path);
  if (!poll || (!poll.failed && !poll.voting && Date.now() - poll.at > REFRESH_MS)) void load(path);
  return polls.get(path)?.votes ?? null;
}

async function load(path: string) {
  const poll = polls.get(path) ?? { votes: null, at: 0 };
  poll.at = Date.now();
  polls.set(path, poll);
  let votes: unknown;
  try {
    const res = await fetch(`${LIVE_URL}${path}`, { cache: 'no-store' });
    votes = res.ok ? ((await res.json()) as Partial<PollAnswer>).votes : null;
  } catch {
    // Offline, or a relay that isn't there.
  }
  // A relay without polls: the model's card stays, and it isn't asked again.
  if (!isVotes(votes)) poll.failed = true;
  else if (!poll.voting && String(votes) !== String(poll.votes)) {
    poll.votes = votes;
    renderView();
  }
}

onAction('vote', (value) => {
  const { gw, home, away } = state.route;
  const m = D.matches.find((x) => x.gw === gw && x.home === home && x.away === away);
  const choice = value as Choice;
  const poll = m && polls.get(pathOf(m));
  if (!m || !poll?.votes || poll.voting || !CHOICES.includes(choice) || myVote(m) || pollClosed(m)) return;
  // Counted at once, and put right by the relay's answer, or taken back if it refuses.
  const before = poll.votes;
  poll.votes = before.map((n, i) => n + (CHOICES[i] === choice ? 1 : 0)) as Votes;
  poll.voting = true;
  store.set(voteKey(m), choice);
  renderView();
  fetch(`${LIVE_URL}${pathOf(m)}`, { method: 'POST', body: JSON.stringify({ voter: voterId(), choice }) })
    .then(async (res) => {
      const answer = (await res.json()) as Partial<PollAnswer>;
      if (!res.ok || !isVotes(answer.votes) || !answer.choice) throw new Error(`Vote refused: ${res.status}`);
      poll.votes = answer.votes;
      store.set(voteKey(m), answer.choice);
    })
    .catch(() => {
      poll.votes = before;
      store.set(voteKey(m), '');
    })
    .finally(() => {
      poll.voting = undefined;
      renderView();
    });
});

/** Who will win?'s card before kick-off: the poll once its votes are in, the model's chances until then. */
export function whoWillWin(m: Match) {
  const votes = votesFor(m);
  const open = !pollClosed(m);
  if (!votes || (!open && !votes.some(Boolean))) return winChances(m);
  return `${pollHtml(m, votes, myVote(m), open)}${modelOdds(m, true)}`;
}

/** Once the match is on, what the visitors voted, if anyone did. */
export function pollResults(m: Match) {
  const votes = votesFor(m);
  if (!votes?.some(Boolean)) return '';
  return `<div><div class="detail-label">Who will win?</div>${pollHtml(m, votes, myVote(m), false)}</div>`;
}

/**
 * The three choices: to pick from while voting is open and the visitor hasn't, and after
 * that each one's share of the votes, with a bar, the visitor's own in green, and the total.
 */
export function pollHtml(m: Match, votes: Votes, mine: Choice | null, open: boolean) {
  const faces = [avatar(m.home, 48), '<span class="poll-x">X</span>', avatar(m.away, 48)];
  const names = [first(m.home), 'Draw', first(m.away)]; // escaped
  const who = [`${names[0]} to win`, 'Draw', `${names[2]} to win`];
  if (open && !mine)
    return `<div class="poll">${CHOICES.map(
      (choice, i) =>
        `<button type="button" class="poll-side poll-pick${i === 1 ? ' draw' : ''}" data-action="vote" data-value="${choice}" aria-label="Vote: ${who[i]}">${faces[i]}<span>${names[i]}</span></button>`,
    ).join('')}</div>`;
  const total = votes[0] + votes[1] + votes[2];
  const sides = CHOICES.map((choice, i) => {
    const share = total ? votes[i] / total : 0;
    const own = choice === mine;
    return `<div class="poll-side${i === 1 ? ' draw' : ''}${own ? ' mine' : ''}">${faces[i]}<span data-tip="${who[i]}${own ? ' · your vote' : ''}">${pct(share)}</span><span class="poll-bar"><span style="width: ${Math.round(share * 100)}%"></span></span></div>`;
  });
  return `<div class="poll voted">${sides.join('')}</div><div class="poll-total">${plural(total, 'vote')}</div>`;
}
