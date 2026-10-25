import { drawIntoNothing } from './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { runAction } from '../src/app/actions.ts';
import { myVote, pollClosed, pollHtml, pollResults, whoWillWin } from '../src/app/match-poll.ts';
import { LIVE_URL, setData, setSeasons, state } from '../src/app/state.ts';
import { parsePollPath, pollPath } from '../src/shared/poll.ts';
import type { Data, Match } from '../src/shared/data.ts';
import { text } from './fixtures/html.ts';
import { league, season } from './fixtures/league.ts';

const ahead: Match = { gw: 4, home: 1, away: 2, homePts: null, awayPts: null, started: false, finished: false };

beforeEach(() => {
  const d = league();
  d.gameweeks = [{ id: 4, deadline: d.meta.nextDeadline!, finished: false, doubles: [] }];
  setData(d);
});

describe('Who will win?’s poll', () => {
  it('has an address the relay reads back', () => {
    assert.equal(pollPath('2026/27', 4, 1, 2), '/poll/2026-27/4/1-2');
    assert.deepEqual(parsePollPath('/poll/2026-27/4/1-2'), { season: '2026-27', gw: 4, home: 1, away: 2 });
  });

  it('closes at the deadline', () => {
    assert.equal(pollClosed(ahead), false);
    assert.equal(pollClosed(ahead, Date.now() + 2 * 864e5), true);
    assert.equal(pollClosed({ ...ahead, gw: 5 }), true); // no deadline known
  });

  it('offers the three choices until the visitor has voted', () => {
    const html = pollHtml(ahead, [3, 1, 0], null, true);
    assert.deepEqual(
      [...html.matchAll(/data-action="vote" data-value="(\w+)"/g)].map((m) => m[1]),
      ['home', 'draw', 'away'],
    );
    assert.match(html, /aria-label="Vote: Ann to win"/);
    assert.doesNotMatch(html, /%|votes/); // no shares before voting
  });

  it('then shows each share, the visitor’s own, and the votes in all', () => {
    const html = pollHtml(ahead, [3, 1, 0], 'home', true);
    assert.doesNotMatch(html, /data-action/);
    assert.deepEqual(
      [...html.matchAll(/>(\d+%)</g)].map((m) => m[1]),
      ['75%', '25%', '0%'],
    );
    assert.match(html, /class="poll-side mine">.*Ann to win · your vote/);
    assert.match(html, /<div class="poll-total">4 votes<\/div>/);
    assert.match(pollHtml(ahead, [0, 1, 0], null, false), /1 vote</);
  });
});

// --- The poll on a match's page, with the relay ---------------------------------------------

// The relay's votes by poll, and its answer to a vote: the votes with it counted, or a refusal.
let votes: Record<string, unknown> = {};
let accepts = true;
const posted: { url: string; body: { voter: string; choice: string } }[] = [];
// This browser's storage.
const stored = new Map<string, string>();
drawIntoNothing();
Object.assign(globalThis, {
  localStorage: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) },
  fetch: async (url: string, init?: { method?: string; body?: string }) => {
    const path = url.replace(LIVE_URL, '');
    if (init?.method === 'POST') {
      const body = JSON.parse(init.body!) as { voter: string; choice: 'home' | 'draw' | 'away' };
      posted.push({ url: path, body });
      const counted = (votes[path] as number[]).map((n, i) => n + (['home', 'draw', 'away'][i] === body.choice ? 1 : 0));
      return accepts
        ? { ok: true, json: async () => ({ votes: counted, choice: body.choice }) }
        : { ok: false, status: 429, json: async () => ({}) };
    }
    const answer = votes[path];
    if (answer instanceof Error) throw answer;
    return answer === undefined ? { ok: false, status: 404, json: async () => ({}) } : { ok: true, json: async () => ({ votes: answer }) };
  },
});
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};

// GW 4, its deadline a day off: Ann v Bob, Bob v Cy and Cy v Ann, each poll its own.
const due = (home: number, away: number): Match => ({ gw: 4, home, away, homePts: null, awayPts: null, started: false, finished: false });
function data(): Data {
  const d = season();
  d.gameweeks[3].deadline = d.meta.nextDeadline!;
  d.matches.push(due(1, 2), due(2, 3), due(3, 1));
  return d;
}
const vote = (choice: string) => runAction({ dataset: { action: 'vote', value: choice } } as unknown as HTMLElement);

describe('Who will win? on a match’s page', () => {
  beforeEach(() => {
    setData(data());
    setSeasons([]);
    state.season = null;
    accepts = true;
    posted.length = 0;
  });

  it('shows the model’s chances until the relay’s votes are in, then the choices', async () => {
    votes = { '/poll/2026-27/4/1-2': [3, 1, 0] };
    assert.match(whoWillWin(due(1, 2)), /Odds go up three gameweeks before the deadline/);
    await settle();
    const html = whoWillWin(due(1, 2));
    assert.deepEqual(
      [...html.matchAll(/data-action="vote" data-value="(\w+)"/g)].map((m) => m[1]),
      ['home', 'draw', 'away'],
    );
  });

  it('counts a vote at once, keeps it in this browser and takes the relay’s count', async () => {
    votes = { '/poll/2026-27/4/2-3': [1, 0, 2] };
    whoWillWin(due(2, 3));
    await settle();
    state.route = { page: 'match', tab: 'facts', gw: 4, home: 2, away: 3 };
    votes['/poll/2026-27/4/2-3'] = [5, 0, 2]; // four more for Bob since the page asked
    vote('away');
    assert.equal(myVote(due(2, 3)), 'away');
    assert.match(text(whoWillWin(due(2, 3))), /^BO 25% X 0% CY 75% 4 votes/);
    await settle();
    assert.equal(posted.length, 1);
    assert.equal(posted[0].url, '/poll/2026-27/4/2-3');
    assert.match(posted[0].body.voter, /^[0-9a-f]{32}$/);
    assert.equal(stored.get('draft.voter'), posted[0].body.voter);
    assert.match(text(whoWillWin(due(2, 3))), /^BO 63% X 0% CY 38% 8 votes/);
    // One vote a match: another tap does nothing.
    vote('home');
    assert.equal(posted.length, 1);
  });

  it('takes a vote the relay refuses back', async () => {
    votes = { '/poll/2026-27/4/3-1': [0, 0, 0] };
    whoWillWin(due(3, 1));
    await settle();
    accepts = false;
    state.route = { page: 'match', tab: 'facts', gw: 4, home: 3, away: 1 };
    vote('draw');
    assert.equal(myVote(due(3, 1)), 'draw');
    await settle();
    assert.equal(myVote(due(3, 1)), null);
    assert.match(whoWillWin(due(3, 1)), /data-action="vote"/);
  });

  it('keeps the model’s card when the relay has no poll, and in an archive', async () => {
    votes = { '/poll/2026-27/4/1-3': new Error('offline') };
    whoWillWin(due(1, 3));
    await settle();
    assert.match(whoWillWin(due(1, 3)), /Odds go up/);
    setSeasons([{ season: '2026/27', name: 'Office League', file: 'seasons/2026-27/data.json' }]);
    state.season = '2026-27';
    assert.match(whoWillWin(due(1, 2)), /Odds go up/);
  });

  it('shows what the visitors voted once the match is on, and nothing when nobody voted', async () => {
    const on: Match = { ...due(1, 2), started: true, homePts: 10, awayPts: 4 };
    votes = { '/poll/2026-27/4/1-2': [3, 1, 0] };
    assert.match(text(pollResults(on)), /^Who will win\? AN 75% X 25% BO 0% 4 votes$/);
    assert.doesNotMatch(pollResults(on), /data-action/);
    const d = data();
    d.gameweeks[2].deadline = d.meta.nextDeadline!;
    setData(d);
    const quiet: Match = { gw: 3, home: 1, away: 2, homePts: 5, awayPts: 5, started: true, finished: false };
    votes['/poll/2026-27/3/1-2'] = [0, 0, 0];
    pollResults(quiet);
    await settle();
    assert.equal(pollResults(quiet), '');
  });
});
