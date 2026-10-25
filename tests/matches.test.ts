import './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { matchList, roundSubtitle, showsOdds } from '../src/app/matches.ts';
import { setData, setLive } from '../src/app/state.ts';
import type { Data, LiveData, Match } from '../src/shared/data.ts';
import { league, lineup, match, player } from './fixtures/league.ts';
import { text } from './fixtures/html.ts';

type Fixture = LiveData['fixtures'][number];

// The league in GW 3, Ann and Bob's match under way, the Premier League's matches as given.
function playing(fixtures: Partial<Fixture>[]): Data {
  const d = league();
  d.matches.push(match(3, 1, 2, 10, 12, false));
  d.live = { gw: 3, elements: {}, fixtures: fixtures.map((f, i) => ({ id: i + 1, h: 1, a: 2, ...f })) } as unknown as LiveData;
  return d;
}

const inHours = (h: number) => new Date(Date.now() + h * 36e5 + 30e3).toISOString();

beforeEach(() => setLive(null));

describe('the round’s line while it’s played', () => {
  it('names the gameweek live, in green, with how many matches are over and how many are on', () => {
    setData(playing([{ started: true, done: true }, { started: true, done: true }, { started: true, done: false }, { ko: inHours(2) }]));
    const line = roundSubtitle(3);
    assert.match(line, /^<span class="round-live"><i class="live-dot"><\/i>Gameweek 3 live<\/span>/);
    assert.equal(text(line), 'Gameweek 3 live · 2 of 4 matches played · 1 on now');
  });

  it('says when the next kicks off while none is on', () => {
    setData(playing([{ started: true, done: true }, { ko: inHours(26) }, { ko: inHours(1.5) }]));
    assert.equal(text(roundSubtitle(3)), 'Gameweek 3 live · 1 of 3 matches played · next in 1h 30m');
  });

  it('says it in short under a title that names the gameweek', () => {
    setData(
      playing([
        { started: true, done: true },
        { started: true, done: false },
      ]),
    );
    assert.equal(text(roundSubtitle(3, { short: true })), 'Live · 1 of 2 played · 1 on now');
  });

  it('says it plainly once every match is over and FPL has still to confirm the points', () => {
    setData(
      playing([
        { started: true, done: true },
        { started: true, done: true },
      ]),
    );
    const line = roundSubtitle(3);
    assert.doesNotMatch(line, /round-live|live-dot/);
    assert.equal(line, 'Gameweek 3 · all 2 matches played · points provisional until FPL confirms them');
    assert.equal(roundSubtitle(3, { short: true }), 'All 2 played · points provisional');
  });

  it('shows its head-to-heads full time, starred, while FPL has still to confirm the points', () => {
    const d = playing([{ started: true, done: true }]);
    d.gameweeks = [{ id: 3, deadline: '2026-08-29T10:00:00Z', finished: false, doubles: [], checked: false }];
    setData(d);
    assert.match(matchList(d.matches.filter((m) => m.gw === 3)), />FT\*<\/span>/);
    // Starred too when the last build has no word from FPL yet.
    delete d.gameweeks[0].checked;
    setData(d);
    assert.match(matchList(d.matches.filter((m) => m.gw === 3)), />FT\*<\/span>/);
  });

  it('shows odds before kick-off and while it’s played, none once it’s over or every match is', () => {
    const due = { ...match(4, 1, 2, 0, 0, false), started: false, odds: { p: [0.5, 0.1, 0.4], prices: [] } } as unknown as Match;
    const on = playing([{ started: true, done: false }]);
    on.players[12] = player('Saka', 'MID', 1, 0, 1);
    on.lineups = { 1: { 3: lineup([12]) }, 2: { 3: lineup([]) } };
    setData(on);
    assert.equal(showsOdds(due), true);
    assert.equal(showsOdds({ ...due, odds: undefined }), false);
    assert.equal(showsOdds(match(3, 1, 2, 10, 12, false)), true);
    assert.equal(showsOdds(match(2, 1, 2, 10, 12)), false);
    setData(playing([{ started: true, done: true }]));
    assert.equal(showsOdds(match(3, 1, 2, 10, 12, false)), false);
  });

  it('keeps the live line to the gameweek being played', () => {
    setData(playing([{ started: true, done: false }]));
    assert.doesNotMatch(roundSubtitle(4), /live/);
  });
});

describe('a head-to-head’s chip between match days', () => {
  // Ann and Bob's GW 3 under way, Ann's Saka (Arsenal, club 1) still to play at `ko`.
  function waiting(ko: string): Data {
    const d = playing([{ id: 1, h: 1, a: 2, ko }]);
    d.players[12] = player('Saka', 'MID', 1, 0, 1);
    d.lineups = { 1: { 3: lineup([12]) }, 2: { 3: lineup([]) } };
    return d;
  }
  const chip = (d: Data) => {
    setData(d);
    const html = matchList(d.matches.filter((m) => m.gw === 3));
    return html.match(/<span class="status-slot">(.*?)<\/span><span class="side/)?.[1] ?? '';
  };

  it('shows the time of the next kick-off when it’s today, green as the gameweek is under way', () => {
    const at = new Date(Date.now() + 2 * 36e5);
    if (at.toDateString() !== new Date().toDateString()) return; // too near midnight to tell
    assert.match(
      chip(waiting(at.toISOString())),
      /^<span class="status-dot live" data-tip="Next match [^"]+">\d\d:\d\d(?: [AP]M)?<\/span>$/,
    );
  });

  it('shows the short day when it’s another day', () => {
    const at = new Date(Date.now() + 3 * 864e5);
    const day = new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(at);
    assert.match(chip(waiting(at.toISOString())), new RegExp(`>${day}</span>$`));
  });

  it('keeps Live while one of their players is on, and FT once it’s over', () => {
    const live = waiting(new Date().toISOString());
    live.live!.fixtures[0] = { ...live.live!.fixtures[0], started: true, min: 30 } as never;
    live.live!.elements = { 12: [2, 30] } as never;
    assert.match(chip(live), /Live/);
    const over = league();
    assert.match(matchList(over.matches.filter((m) => m.gw === 1)), /class="status-dot">FT</);
  });
});

describe('a head-to-head’s chip once its matches are over', () => {
  const over = (checked?: boolean) => {
    const d = league();
    d.gameweeks = [{ id: 1, deadline: '2026-08-21T17:30:00Z', finished: true, doubles: [], ...(checked === undefined ? {} : { checked }) }];
    setData(d);
    return matchList(d.matches.filter((m) => m.gw === 1));
  };

  it('says FT* until FPL has checked the gameweek’s stats, and what can still change', () => {
    assert.match(
      over(false),
      /<span class="status-dot"><span data-tip="Until FPL has checked the gameweek’s stats, [^"]+">FT\*<\/span><\/span>/,
    );
  });

  it('says FT once it has, or when it isn’t known', () => {
    assert.match(over(true), /class="status-dot">FT</);
    assert.match(over(), /class="status-dot">FT</);
  });
});
