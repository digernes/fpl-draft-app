import './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { fmtDate } from '../src/app/format.ts';
import { slotOf } from '../src/app/lookups.ts';
import { flag, pagePlayer, yearsOld } from '../src/app/pages/player.ts';
import { href } from '../src/app/router.ts';
import { setData, setLive, setSeasons, state } from '../src/app/state.ts';
import type { Data, PlMatch } from '../src/shared/data.ts';
import { cardTitled, listRows, text, tiles } from './fixtures/html.ts';
import { lineup, season } from './fixtures/league.ts';

// The stats files never come in.
Object.assign(globalThis, { fetch: () => new Promise(() => {}) });

// After GW 2 (see season()). GW 1: Arsenal beat Chelsea 3-1, Saka scoring and making one,
// Isak on for the last 25 minutes. GW 2: Arsenal won 2-1 at Chelsea, Isak scoring. Cy, who
// had Isak on the bench both weeks, dropped him for Watkins on waivers before GW 3, when
// Arsenal play Liverpool, still to come; Chelsea are at home to Man City in GW 4.
const played = (
  id: number,
  gw: number,
  home: number,
  away: number,
  score: [number, number],
  lineups: PlMatch['lineups'],
  events: PlMatch['events'],
): PlMatch => ({
  id,
  gw,
  home,
  away,
  ko: `2026-08-${15 + 7 * (gw - 1)}T14:00:00Z`,
  score,
  done: true,
  lineups,
  events,
});

function data(): Data {
  const d = season();
  d.plMatches = [
    played(
      1,
      1,
      1,
      2,
      [3, 1],
      [
        [
          [12, 90, 10, 1],
          [11, 90, 2, 1],
        ],
        [
          [13, 90, 8, 1],
          [16, 25, 2, 0],
        ],
      ],
      { 12: { goals: 1, assists: 1 } },
    ),
    played(
      2,
      2,
      2,
      1,
      [1, 2],
      [
        [
          [16, 90, 5, 1],
          [13, 90, 2, 1],
        ],
        [
          [12, 90, 3, 1],
          [11, 90, 6, 1],
        ],
      ],
      { 16: { goals: 1 } },
    ),
    { id: 3, gw: 3, home: 1, away: 3, ko: new Date(Date.now() + 864e5).toISOString() },
    { id: 4, gw: 4, home: 2, away: 4, ko: '2026-09-12T14:00:00Z' },
  ];
  d.transfers.moves = [{ type: 'waiver', manager: 3, in: 17, out: 16, gw: 3, at: '2026-08-28T10:00:00Z' }];
  d.players[16].xs = [1.23, 0.4, 9.5];
  return d;
}

beforeEach(() => {
  setData(data());
  setLive(null);
  state.xp = 'model';
});

afterEach(() => {
  setSeasons([]);
  state.season = null;
});

const page = (pid: number) => pagePlayer({ page: 'player', tab: '', id: pid });
const flagText = (code: string) => text(flag(code));
// With Ann's squad picked for GW 3 too, as a build has the current gameweek's.
function inSquadsNow() {
  const d = data();
  d.lineups[1][3] = d.lineups[1][2];
  return d;
}
// His facts, as a reader sees them, before his position.
const facts = (pid: number) => text(page(pid).header!.foot!.split('<div class="bio-position">')[0]);
// The timeline's rows as a reader sees them, the latest first.
const timeline = (pid: number) =>
  cardTitled(page(pid).body, 'Timeline')
    .split(/<div class="tl-row /)
    .slice(1)
    .map((row) => text(`<div ${row}`));

describe('a player’s page', () => {
  it('says so when there is no such player this season', () => {
    const view = page(99);
    assert.equal(view.title, 'Player');
    assert.match(view.body, /No such player this season/);
  });

  it('heads the page with his name and club, and whose he is in his owner’s colours', () => {
    const { title, header } = page(12);
    assert.equal(title, 'Saka');
    assert.equal(header!.title, 'Saka');
    assert.equal(text(header!.sub!), 'Arsenal AN Ann’s &#38; Co');
    assert.ok(header!.sub!.includes(`href="${href.team(1)}"`));
    assert.ok(header!.sub!.includes(`href="${href.pl('players', 1)}"`));
    assert.match(header!.side!, /^<a class="owner-chip" href="#\/team\/1">.*<span>Ann<\/span><\/a>$/);
    assert.equal(header!.cls, `player-header m${slotOf(1)}`);
    // His photo cut out, his kit until it comes.
    assert.match(header!.logo!, /^<span class="photo cutout"><svg class="kit".*<img src="[^"]+\/110x140\/[^"]+" data-fallback=/);
    const free = page(16).header!;
    assert.equal(free.side, '<span class="owner-chip free">Free agent</span>');
    assert.equal(free.cls, 'player-header m0');
    assert.equal(text(free.sub!), 'Chelsea');
  });

  it('lists his facts under it, as fotmob.com’s: his age, country, club since when and owner since when', () => {
    const d = inSquadsNow();
    Object.assign(d.players[12], { born: '2001-09-05', nation: ['England', 'EN'], joined: '2019-07-01' });
    setData(d);
    const day = (iso: string) => fmtDate.format(new Date(`${iso}T12:00:00Z`));
    assert.equal(
      facts(12),
      `${yearsOld('2001-09-05')} years ${day('2001-09-05')} ${flagText('EN')} England Country ${day('2019-07-01')} Joined Arsenal AN Ann’s &#38; Co Since the draft`,
    );
  });

  it('leaves out what FPL doesn’t have, and says how long a free agent has been one', () => {
    setData(inSquadsNow());
    assert.equal(facts(12), 'AN Ann’s &#38; Co Since the draft');
    assert.equal(facts(18), 'AN Ann’s &#38; Co Since gameweek 1'); // signed before the first
    assert.equal(facts(16), 'Free agent Since gameweek 3'); // Cy dropped him before GW 3
    assert.equal(facts(19), 'Free agent Never in a squad');
  });

  it('puts his position on a pitch, attacking upwards', () => {
    const foot = page(12).header!.foot!;
    assert.ok(text(foot).endsWith('Position Primary Midfielder MID'), text(foot));
    assert.match(foot, /<span class="bio-spot" style="top:47%">MID<\/span>/);
    assert.match(page(11).header!.foot!, /style="top:88%">GK</);
    assert.match(page(16).header!.foot!, /style="top:18%">FWD</);
  });

  it('works out his age from his birthday', () => {
    assert.equal(yearsOld('2000-07-21', new Date('2026-07-20T23:00:00Z')), 25);
    assert.equal(yearsOld('2000-07-21', new Date('2026-07-21T00:00:00Z')), 26);
    assert.equal(yearsOld('2000-07-21', new Date('2026-12-31T12:00:00Z')), 26);
  });

  it('flags his country, the home nations with their own flags, Northern Ireland with none', () => {
    assert.equal(flagText('NO'), '🇳🇴');
    assert.equal(flagText('EN'), '🏴󠁧󠁢󠁥󠁮󠁧󠁿');
    assert.equal(flagText('S1'), '🏴󠁧󠁢󠁳󠁣󠁴󠁿');
    assert.equal(flagText('WA'), '🏴󠁧󠁢󠁷󠁬󠁳󠁿');
    assert.equal(flag('NN'), '');
    assert.equal(flag(''), '');
  });

  it('passes on FPL’s news of a flagged player', () => {
    const d = data();
    d.players[12] = { ...d.players[12], status: 'i', news: 'Hamstring injury - Expected back 30 Aug' };
    setData(d);
    assert.match(text(page(12).body), /^! Hamstring injury - Expected back 30 Aug/);
    d.players[12].news = undefined;
    setData(d);
    assert.match(text(page(12).body), /^! Flagged by FPL/);
    assert.doesNotMatch(page(13).body, /player-news/);
  });

  it('sums up his season from the Premier League’s matches, over what was expected of him', () => {
    assert.deepEqual(tiles(page(16).body).slice(0, 4), [
      'Points: 12 · 9.5 xP',
      'Goals: 1 · 1.23 xG',
      'Assists: 0 · 0.40 xA',
      'Minutes: 115 · 2 matches, 1 start',
    ]);
    assert.match(page(16).body, /<h2 class="card-title">Premier League 2026\/27<\/h2>/);
  });
});

describe('a player’s timeline', () => {
  it('tells his story the latest first: the free agent’s spell, the drop, his weeks on the bench, the draft', () => {
    assert.deepEqual(timeline(16), [
      'GW 3 A free agent for 1 gameweek, unclaimed throughout · 0 points',
      'GW 3 Cy dropped Isak for Watkins on waivers',
      'GW 2 Bench ARS (H) 1-2 90’ 5 CY',
      "GW 1 Bench ARS (A) 1-3 25’ 65' 2 CY",
      'Draft Drafted by Cy : round 2, 4th pick overall CY',
    ]);
  });

  it('leads each week’s match to its page, and its points to the owner’s head-to-head', () => {
    const html = cardTitled(page(12).body, 'Timeline');
    assert.ok(html.includes(`<a class="ml-match" href="${href.plMatch(1)}">`));
    assert.ok(html.includes(`<a href="${href.match({ gw: 1, home: 1, away: 2 })}" aria-label="Ann v Bob, gameweek 1">`));
    assert.match(
      timeline(12).find((r) => r.startsWith('GW 1'))!,
      /^GW 1 In starting XI CHE \(H\) 3-1 90’/,
    );
  });

  it('shows the expected points of a week whose match is still to come', () => {
    const d = data();
    d.lineups[1][3] = lineup([11, 12], [18]);
    d.players[12].pts = [10, 3, 0];
    d.players[12].ep = 5.5;
    setData(d);
    assert.match(timeline(12)[0], /^GW 3 In starting XI LIV \(H\)/);
    assert.match(cardTitled(page(12).body, 'Timeline'), /data-tip="5.5 projected points \(not played yet\)">5.5</);
  });

  it('tells who he came on for, and who came on for the one he replaced', () => {
    const d = data();
    d.lineups[3][2] = { ...lineup([14, 16], [17], 17), subs: [16], off: [17] };
    setData(d);
    assert.match(timeline(16)[2], /^GW 2 Came on for Watkins ARS \(H\) 1-2/);
    assert.match(
      timeline(17).find((r) => r.startsWith('GW 2'))!,
      /^GW 2 Didn’t play Isak came on No match/,
    );
    assert.match(tiles(page(16).body).at(-1)!, /^Automatic subs: 1/);
  });

  it('tells of trades made and offered', () => {
    const d = data();
    d.transfers.trades = [
      { gw: 3, offeredBy: 1, offeredTo: 2, state: 'p', at: '2026-08-28T10:00:00Z', items: [{ gives: 12, gets: 13 }] },
      { gw: 2, offeredBy: 3, offeredTo: 1, state: 'r', at: '2026-08-21T10:00:00Z', items: [{ gives: 14, gets: 12 }] },
    ];
    setData(d);
    const rows = timeline(12);
    assert.ok(rows.includes('GW 3 Ann traded Saka to Bob for Palmer'));
    assert.ok(rows.includes('GW 2 Cy offered Salah to Ann for Saka: rejected'));
  });

  it('tells of the claims for him that didn’t go through, and those to drop him', () => {
    const d = data();
    // In GW 2 Bob's claim for White was void, and Ann's lost to Cy's (which Cy never fielded).
    d.transfers.claims = [
      { manager: 2, in: 19, out: 13, gw: 2, priority: 1, outcome: 'void', winner: null },
      { manager: 1, in: 19, out: 12, gw: 2, priority: 1, outcome: 'lost', winner: 3 },
      { manager: 3, in: 19, out: 17, gw: 2, priority: 1, outcome: 'won', winner: 3 },
    ];
    setData(d);
    const rows = timeline(19);
    assert.ok(rows.includes('GW 2 Bob tried to swap Palmer for White on waivers, but it didn’t go through'));
    assert.ok(rows.includes('GW 2 Ann tried to swap Saka for White on waivers, but he had already signed for Cy'));
    assert.ok(timeline(12).includes('GW 2 Ann tried to swap Saka for White on waivers, but White had already signed for Cy'));
    assert.match(tiles(cardTitled(page(19).body, 'In the draft'))[1], /^Waiver claims: 3 · 1 waiver run$/);
  });

  it('starts the story of one added after the draft when FPL added him', () => {
    const d = data();
    d.players[19].added = 2;
    setData(d);
    assert.deepEqual(timeline(19), [
      'GW 2–3 A free agent for 2 gameweeks, unclaimed throughout · 0 points',
      'GW 2 Added to FPL after the draft',
    ]);
    assert.match(
      tiles(page(19).body).find((t) => t.startsWith('Drafted'))!,
      /^Drafted: – · Added after it, in GW 2$/,
    );
    delete d.players[19].added;
    setData(d);
    assert.equal(timeline(19).at(-1), 'Draft Not drafted');
  });
});

describe('beside a player’s timeline', () => {
  it('has what he scored for each owner, and as a free agent', () => {
    assert.deepEqual(listRows(cardTitled(page(16).body, 'Points for each owner')), [
      'CY Cy 2 gameweeks · 0 in the XI · 7 pts on the bench 0',
      'Free agent 1 gameweek · unclaimed in 1 0',
    ]);
  });

  it('counts his draft, the claims for him and the times he was dropped', () => {
    assert.deepEqual(tiles(cardTitled(page(16).body, 'In the draft')), [
      'Drafted: #4 · Round 2, by Cy',
      'Waiver claims: 0 · 0 waiver runs',
      'Dropped: 1 · Times let go',
      'Automatic subs: 0 · Came on from a bench',
    ]);
  });

  it('has his next matches with the expected points, but not in an archive or once the season is over', () => {
    const d = data();
    d.players[13].ep = 4.4;
    setData(d);
    const html = cardTitled(page(13).body, 'Next matches');
    assert.match(html, /<div class="card-sub">With expected points<\/div>/);
    assert.match(listRows(html)[0], /^Gameweek 4 Man City \(H\) · .+ 4\.4$/); // the deadline's day, as the reader's locale has it
    assert.match(cardTitled(page(16).body, 'Next matches'), /Expected points for the next gameweek/);
    d.meta.nextGw = 5;
    setData(d);
    assert.equal(cardTitled(page(13).body, 'Next matches'), '');
    setData(data());
    setSeasons([{ season: '2026/27', name: 'Office League', file: 'seasons/2026-27/data.json' }]);
    state.season = '2026-27';
    assert.equal(cardTitled(page(13).body, 'Next matches'), '');
  });

  it('says when a club has no match in a gameweek', () => {
    assert.match(listRows(cardTitled(page(14).body, 'Next matches'))[0], /^Gameweek 4 No match · /);
  });

  it('suggests the players in his position nearest him on points, and who has them', () => {
    assert.deepEqual(listRows(cardTitled(page(16).body, 'Similar players')), [
      'Watkins 25 pts · 0.0 projected next · with Cy CY',
      'Haaland 80 pts · 0.0 projected next · with Bob BO',
    ]);
    assert.match(cardTitled(page(16).body, 'Similar players'), /<div class="card-sub">Forwards on about the same points<\/div>/);
    const d = data();
    d.players[17].owner = null;
    setData(d);
    assert.match(listRows(cardTitled(page(16).body, 'Similar players'))[0], /free agent FA$/);
  });
});
