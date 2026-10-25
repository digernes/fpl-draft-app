import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { fetchRelayed, recordInPlay } from '../src/build/in-play.ts';
import type { Data, InPlayRecord, Match } from '../src/shared/data.ts';
import { inPlayOddsIn, liveExpectedIn, MOVE, scoreLive, withRecord } from '../src/shared/in-play.ts';
import { annVBobLive, gw3Stats } from './fixtures/match.ts';

// GW 3's deadline is 17:30 on the Friday; Liverpool v Man City kicked off at 14:00 the next day.
const DEADLINE = Date.parse('2026-08-28T17:30:00Z');
const minutesIn = (minutes: number) => DEADLINE + minutes * 60_000;
const NOW = 1230 + 30; // half an hour into Liverpool v Man City
const game = (d: Data) => d.matches.find((m) => m.gw === 3)!;
const earlier: InPlayRecord[] = [
  [1080, 700, 200, 11, 2],
  [1240, 650, 250, 11, 4],
];
// The last build's data.json, with what it had recorded for the match.
const previous = (d: Data, records = earlier): Partial<Data> => ({ meta: d.meta, matches: [{ ...game(d), inPlay: records }] });

// The live odds as the page has them with the site's expected points, in thousandths, and the score.
function asThePageHasIt(d: Data, minutes: number): InPlayRecord {
  const feed = d.live!;
  const [home, away] = [scoreLive(d, 1, 3, feed)!, scoreLive(d, 2, 3, feed)!];
  const { p } = inPlayOddsIn(
    d,
    [home, away],
    feed,
    liveExpectedIn(d, 3, false, (f) => gw3Stats().matches[f]),
  );
  return [minutes, Math.round(p[0] * 1000), Math.round(p[2] * 1000), home.pts, away.pts];
}

describe('recording the live odds at each build', () => {
  it('gives each head-to-head being played the live odds now, as the page has them, and the score', () => {
    const d = annVBobLive();
    recordInPlay(d, null, gw3Stats(), minutesIn(NOW));
    const record = asThePageHasIt(d, NOW);
    assert.deepEqual(game(d).inPlay, [record]);
    assert.deepEqual(record.slice(3), [11, 7]);
    assert.ok(record[1] > 0 && record[2] > 0 && record[1] + record[2] <= 1000);
    // The other gameweeks' matches have none.
    assert.ok(d.matches.every((m) => m.gw === 3 || !m.inPlay));
  });

  it('adds it to what the last build recorded, which it keeps', () => {
    const d = annVBobLive();
    recordInPlay(d, previous(d), gw3Stats(), minutesIn(NOW));
    assert.deepEqual(game(d).inPlay, [...earlier, asThePageHasIt(d, NOW)]);
  });

  it('keeps a finished match’s records, with nothing added', () => {
    const d = annVBobLive();
    game(d).finished = true;
    recordInPlay(d, previous(d), gw3Stats(), minutesIn(NOW));
    assert.deepEqual(game(d).inPlay, earlier);
  });

  it('keeps them once the gameweek is over and there’s no live feed, as in an archive', () => {
    const d = annVBobLive();
    delete d.live;
    recordInPlay(d, previous(d), undefined, minutesIn(NOW));
    assert.deepEqual(game(d).inPlay, earlier);
  });

  it('records nothing before the deadline', () => {
    const d = annVBobLive();
    recordInPlay(d, null, gw3Stats(), minutesIn(-1));
    assert.equal(game(d).inPlay, undefined);
    // From the deadline on, though.
    recordInPlay(d, null, gw3Stats(), minutesIn(0));
    assert.equal(game(d).inPlay?.[0][0], 0);
  });

  it('records nothing for a match not started, in another gameweek, or without both lineups', () => {
    const notStarted = annVBobLive();
    game(notStarted).started = false;
    recordInPlay(notStarted, null, gw3Stats(), minutesIn(NOW));
    assert.equal(game(notStarted).inPlay, undefined);

    const elsewhere = annVBobLive();
    elsewhere.live!.gw = 4;
    recordInPlay(elsewhere, null, gw3Stats(), minutesIn(NOW));
    assert.ok(elsewhere.matches.every((m) => !m.inPlay));

    const noPicks = annVBobLive();
    delete noPicks.lineups[2][3].picks;
    recordInPlay(noPicks, previous(noPicks), gw3Stats(), minutesIn(NOW));
    assert.deepEqual(game(noPicks).inPlay, earlier);
  });

  it('keeps nothing from another season’s data.json, whose matches may share the keys', () => {
    const d = annVBobLive();
    const last = previous(d);
    last.meta = { ...d.meta, season: '2025/26' };
    recordInPlay(d, last, gw3Stats(), minutesIn(NOW));
    assert.deepEqual(game(d).inPlay, [asThePageHasIt(d, NOW)]);
    // A data.json without its meta is taken as this season's.
    const bare = annVBobLive();
    recordInPlay(bare, { matches: [{ ...game(bare), inPlay: earlier }] as Match[] }, gw3Stats(), minutesIn(NOW));
    assert.equal(game(bare).inPlay!.length, 3);
  });

  it('works out the stats file’s defensive contributions only for its own gameweek', () => {
    const [withStats, otherWeek] = [annVBobLive(), annVBobLive()];
    recordInPlay(withStats, null, gw3Stats(), minutesIn(NOW));
    recordInPlay(otherWeek, null, { ...gw3Stats(), gw: 2 }, minutesIn(NOW));
    const none = annVBobLive();
    recordInPlay(none, null, undefined, minutesIn(NOW));
    assert.deepEqual(game(otherWeek).inPlay, game(none).inPlay);
    assert.notDeepEqual(game(withStats).inPlay, game(none).inPlay);
  });
});

describe('a new record', () => {
  const at = (minutes: number, home: number, away: number, score: [number, number] = [10, 10]): InPlayRecord => [
    minutes,
    home,
    away,
    ...score,
  ];

  it('starts the records, and takes a place of its own after the first', () => {
    assert.deepEqual(withRecord([], at(1, 400, 300)), [at(1, 400, 300)]);
    assert.deepEqual(withRecord([at(1, 400, 300)], at(11, 401, 300)), [at(1, 400, 300), at(11, 401, 300)]);
  });

  it('takes the latest’s place when neither side’s chance moved by half a point since the last kept for a move', () => {
    const records = [at(1, 400, 300), at(11, 402, 300)];
    assert.deepEqual(withRecord(records, at(21, 404, 296)), [at(1, 400, 300), at(21, 404, 296)]);
    // Moved enough since the first: it stays, and the next is measured from it.
    const moved = withRecord(records, at(21, 400 + MOVE, 300));
    assert.deepEqual(moved, [at(1, 400, 300), at(21, 405, 300)]);
    const next = withRecord(moved, at(31, 405, 300 - MOVE + 1, [12, 10]));
    assert.deepEqual(next, [at(1, 400, 300), at(21, 405, 300), at(31, 405, 296, [12, 10])]);
    assert.deepEqual(withRecord(next, at(41, 405, 297)), [at(1, 400, 300), at(21, 405, 300), at(41, 405, 297)]);
    // A move from the last kept for one, in the latest's place, which wasn't.
    assert.deepEqual(withRecord(next, at(41, 405, 290)), [at(1, 400, 300), at(21, 405, 300), at(41, 405, 290)]);
  });

  it('changes nothing when the chances and the score are as they were', () => {
    const records = [at(1, 400, 300), at(11, 450, 300)];
    assert.equal(withRecord(records, at(21, 450, 300)), records);
    // A new score is news, if not a move.
    assert.deepEqual(withRecord(records, at(21, 450, 300, [12, 10])), [...records, at(21, 450, 300, [12, 10])]);
  });
});

describe('the Worker’s records in data.json', () => {
  afterEach(() => mock.restoreAll());
  // Every minute from 10 to 40 minutes into Liverpool v Man City, Ann's chance easing.
  const worker: InPlayRecord[] = Array.from({ length: 31 }, (_, i) => [1240 + i, 650 - i * 5, 250 + i * 5, 11, 7]);
  const relayed = (records: InPlayRecord[] = worker, gw = 3) => ({ gw, records: { '1-2': records } });

  it('puts them in among the build’s, the Worker’s taking the place of any within ten minutes', () => {
    const d = annVBobLive();
    // The build's at 1080 (far from any of the Worker's) and 1240, and its new one at 1260.
    recordInPlay(d, previous(d), gw3Stats(), minutesIn(NOW), relayed());
    assert.deepEqual(game(d).inPlay, [earlier[0], ...worker]);
  });

  it('keeps the build’s where the Worker has a gap, thinned as the records always are', () => {
    const d = annVBobLive();
    game(d).finished = true; // nothing new from the build itself
    const gap: InPlayRecord[] = [
      [1100, 700, 200, 11, 2],
      [1300, 300, 600, 11, 9],
    ];
    const own: InPlayRecord[] = [
      [1150, 700, 200, 11, 2], // as the Worker's before it: thinned away
      [1200, 500, 400, 11, 4], // a move in the gap: kept
      [1295, 310, 590, 11, 9], // within ten minutes of the Worker's: the Worker's wins
    ];
    recordInPlay(d, previous(d, own), undefined, minutesIn(NOW), relayed(gap));
    assert.deepEqual(game(d).inPlay, [gap[0], own[1], gap[1]]);
  });

  it('gives the build the same records again when the Worker has nothing new', () => {
    const d = annVBobLive();
    recordInPlay(d, previous(d), gw3Stats(), minutesIn(NOW), relayed());
    const again = annVBobLive();
    recordInPlay(again, { meta: d.meta, matches: [game(d)] }, gw3Stats(), minutesIn(NOW), relayed());
    assert.deepEqual(game(again).inPlay, game(d).inPlay);
  });

  it('records as before without the Worker’s, or with another gameweek’s, or none for the match', () => {
    const before = annVBobLive();
    recordInPlay(before, previous(before), gw3Stats(), minutesIn(NOW));
    for (const other of [null, relayed(worker, 4), { gw: 3, records: { '2-1': worker } }, relayed([])]) {
      const d = annVBobLive();
      recordInPlay(d, previous(d), gw3Stats(), minutesIn(NOW), other);
      assert.deepEqual(game(d).inPlay, game(before).inPlay, JSON.stringify(other));
    }
  });

  it('copies them into a match the build itself didn’t record, as once the gameweek is over', () => {
    const d = annVBobLive();
    game(d).finished = true;
    delete d.live;
    recordInPlay(d, null, undefined, minutesIn(NOW), relayed());
    assert.deepEqual(game(d).inPlay, worker);
  });

  const RELAY = 'https://relay.example';

  it('asks the relay for the gameweek being played, without a User-Agent of its own', async () => {
    const asked = mock.method(globalThis, 'fetch', async () => Response.json({ '1-2': worker }));
    assert.deepEqual(await fetchRelayed(RELAY, annVBobLive(), null), relayed());
    const [url, init] = asked.mock.calls[0].arguments as unknown as [string, RequestInit];
    assert.equal(url, `${RELAY}/in-play/2026-27/3`);
    assert.equal(init.headers, undefined);
    assert.ok(init.signal); // it doesn't wait for long
  });

  it('asks for the gameweek the last build was playing, once it’s over, for the records after that build', async () => {
    const asked = mock.method(globalThis, 'fetch', async () => Response.json({}));
    const d = annVBobLive();
    const last = { meta: d.meta, live: d.live } as Partial<Data>;
    delete d.live;
    assert.deepEqual(await fetchRelayed(RELAY, d, last), { gw: 3, records: {} });
    // Not last season's, nor with nothing being played.
    assert.equal(await fetchRelayed(RELAY, d, { ...last, meta: { ...d.meta, season: '2025/26' } }), null);
    assert.equal(await fetchRelayed(RELAY, d, null), null);
    assert.equal(await fetchRelayed('', annVBobLive(), null), null);
    assert.equal(asked.mock.callCount(), 1);
  });

  it('does without them when the relay is down, not deployed, offline or answers oddly', async () => {
    const answers = [
      () => new Response('Not found', { status: 404 }),
      () => new Response('<html>', { status: 200 }),
      () => Response.json({ '1-2': [[1, 2, 3]] }),
      () => Response.json([worker]),
      () => {
        throw new Error('offline: https://relay.example/in-play/2026-27/3');
      },
    ];
    for (const answer of answers) {
      mock.restoreAll();
      mock.method(globalThis, 'fetch', async () => answer());
      assert.equal(await fetchRelayed(RELAY, annVBobLive(), null), null, String(answer));
    }
  });
});
