import './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { applyLatestLive } from '../src/app/live-scores.ts';
import {
  inPlayOdds,
  modelOdds,
  oddsRow,
  oddsToggle,
  preMatchOdds,
  projectedPill,
  projectionFor,
  winChances,
} from '../src/app/match-odds.ts';
import { live, setData, setLive, state } from '../src/app/state.ts';
import type { Data, LiveData, Match, Odds } from '../src/shared/data.ts';
import { drawIntoNothing } from './fixtures/browser.ts';
import { text } from './fixtures/html.ts';
import { lineup, match, season } from './fixtures/league.ts';

const odds: Odds = {
  p: [0.3, 0.2, 0.5],
  prices: [
    { dec: 3.2, frac: '11/5' },
    { dec: 4.8, frac: '19/5' },
    { dec: 1.9, frac: '9/10' },
  ],
  expected: [44.2, 51.7],
};
const due: Match = { ...match(4, 2, 3, 0, 0, false), homePts: null, awayPts: null, started: false, odds };

// The live odds count the defensive contributions from the gameweek's stats file, which
// isn't there: asked for, it redraws into nothing.
drawIntoNothing();
globalThis.fetch = (async () => ({ ok: false, status: 404 })) as unknown as typeof fetch;

beforeEach(() => {
  setData(season());
  setLive(null);
  Object.assign(state, { odds: 'decimal', xp: 'model' });
});

// Each selection as a reader sees it, struck through when it lost, and its tip.
const selections = (html: string) =>
  [...html.matchAll(/<span class="odd( lost)?" data-tip="([^"]+)">(.*?)<\/span><\/span>/g)].map(
    ([, lost, tip, inside]) => `${text(inside)}${lost ? ' (lost)' : ''} · ${tip}`,
  );

describe('a head-to-head’s odds', () => {
  it('prices a home win, the draw and an away win, as decimals or fractions', () => {
    assert.deepEqual(selections(oddsRow(odds, due)), [
      '1 3.20 · Bob to win · 30% chance',
      'X 4.80 · Draw · 20% chance',
      '2 1.90 · Cy to win · 50% chance',
    ]);
    state.odds = 'fractional';
    assert.deepEqual(
      selections(oddsRow(odds, due)).map((s) => s.split(' · ')[0]),
      ['1 11/5', 'X 19/5', '2 9/10'],
    );
  });

  it('strikes out the selections that lost, and says when the odds are live', () => {
    assert.deepEqual(
      selections(oddsRow(odds, due, 2)).map((s) => s.split(' · ')[0]),
      ['1 3.20 (lost)', 'X 4.80 (lost)', '2 1.90'],
    );
    const html = oddsRow(odds, due, null, true);
    assert.match(html, /^<div class="odds in-play">/);
    assert.match(selections(html)[0], /30% chance \(live\)$/);
  });

  it('settles the pre-match odds once the match is over, a draw leaving only the X', () => {
    const level: Match = { ...match(2, 2, 3, 50, 50), odds };
    assert.deepEqual(
      selections(preMatchOdds(level)).map((s) => s.split(' · ')[0]),
      ['1 3.20 (lost)', 'X 4.80', '2 1.90 (lost)'],
    );
    assert.match(preMatchOdds(level), /data-tip="The odds at the deadline">· at the deadline</);
    assert.equal(preMatchOdds({ ...level, odds: undefined }), '');
  });

  it('says when the odds were worked out afterwards, and fades them under the live odds while it’s played', () => {
    const later: Match = { ...match(3, 2, 3, 20, 25, false), odds: { ...odds, afterwards: true } };
    const html = preMatchOdds(later);
    assert.match(html, /^<div class="detail-odds faded">/);
    assert.match(html, /· worked out afterwards</);
    assert.ok(selections(html).every((s) => !s.includes('(lost)')));
  });
});

describe('who will win, as the odds model has it', () => {
  it('gives each side’s chance and the draw’s, the odds and the score they come from', () => {
    const html = winChances(due);
    assert.match(text(html), /^BO 30% X 20% CY 50% 1 3.20 X 4.80 2 1.90 Projected 44.2 – 51.7$/);
    assert.match(
      html,
      /data-tip="The model’s score: the league average, plus how far each side’s best projected XI sits from the average one"/,
    );
    const d = season();
    d.meta.hasProjections = false;
    setData(d);
    assert.match(winChances(due), /data-tip="The model’s score: the league average, until there are projections"/);
  });

  it('says when the odds go up, before they have', () => {
    assert.match(winChances({ ...due, odds: undefined }), /Odds go up three gameweeks before the deadline/);
    assert.equal(modelOdds({ ...due, odds: undefined }), '');
  });

  it('adds the model’s chances under a poll', () => {
    assert.match(text(modelOdds(due, true)), /Model 30% · 20% · 50% Projected 44.2 – 51.7$/);
    assert.doesNotMatch(modelOdds(due), /Model/);
  });

  it('offers the odds format, the one chosen pressed', () => {
    state.odds = 'fractional';
    assert.match(
      oddsToggle(),
      /data-value="decimal" aria-pressed="false">Decimal<\/button><button type="button" data-action="odds" data-value="fractional" aria-pressed="true">Fractional/,
    );
  });
});

describe('the live odds', () => {
  // GW 3, under way: Ann v Bob. Arsenal have beaten Chelsea, Saka with 9 points and Raya 2
  // for Ann, Palmer 2 for Bob; Liverpool v Man City is still to come, Haaland's expected 6
  // still to add for Bob.
  function playing(): Data {
    const d = season();
    d.matches.push(match(3, 1, 2, 0, 0, false));
    const picks = (xi: number[], bench: number[]) => ({ ...lineup(xi, bench), picks: [...xi, ...bench] });
    d.lineups[1][3] = picks([11, 12], [18]);
    d.lineups[2][3] = picks([13, 15], []);
    d.players[15].ep = 6;
    d.live = {
      gw: 3,
      ep: { 11: 3, 12: 5, 13: 4, 15: 6, 18: 3 },
      elements: { 11: [2, 90], 12: [9, 90], 13: [2, 90], 18: [1, 90] },
      fixtures: [
        { id: 30, h: 1, a: 2, started: true, done: true, score: [2, 0] },
        { id: 31, h: 3, a: 4, started: false, done: false, ko: '2026-08-30T15:30:00Z' },
      ],
    } as LiveData;
    return d;
  }

  it('makes the side ahead with its matches over the favourite, its chances adding up to one', () => {
    setData(playing());
    applyLatestLive();
    assert.equal(live?.gw, 3);
    const chances = inPlayOdds(playing().matches.at(-1)!)!;
    assert.ok(chances.p[0] > chances.p[2], `${chances.p}`);
    assert.ok(Math.abs(chances.p[0] + chances.p[1] + chances.p[2] - 1) < 1e-9);
    assert.equal(chances.prices.length, 3);
  });

  it('has none once every match is over, the points only waiting to be confirmed', () => {
    const d = playing();
    d.live!.fixtures[1] = { ...d.live!.fixtures[1], started: true, done: true, score: [1, 1] };
    setData(d);
    applyLatestLive();
    assert.equal(inPlayOdds(d.matches.at(-1)!), null);
  });

  it('has none without the live lineups of both sides', () => {
    assert.equal(inPlayOdds(match(3, 1, 2, 0, 0, false)), null);
  });

  it('says where a player’s gameweek is heading while it’s played, and nothing once it’s over for him', () => {
    setData(playing());
    applyLatestLive();
    assert.equal(projectionFor(12, 3), undefined); // Saka's match is over
    const { projected, toCome } = projectionFor(15, 3)!;
    assert.ok(projected > 0);
    // What's still to come, by where it would come from, adds up to the projection less his points so far.
    const sum = Object.values(toCome).reduce((t, x) => t + x, 0);
    assert.ok(Math.abs(projected - (live!.feed.elements[15]?.[0] ?? 0) - (live!.bonus(15) ?? 0) - sum) < 1e-9, `${projected} ${sum}`);
    assert.equal(projectionFor(15, 2), undefined);
    // As a points pill's options: the projection, and what's to come as its tip's rows.
    const options = projectedPill(15, 3);
    assert.equal(options.projected, projected);
    assert.ok(options.toCome!.length > 0 && options.toCome!.every(([label, x]) => typeof label === 'string' && Math.abs(x) >= 0.05));
    assert.deepEqual(projectedPill(12, 3), {});
    setLive(null);
    assert.equal(projectionFor(15, 3), undefined);
  });
});
