import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { DGW_PENALTY, FORM_LENGTH, ODDS_OVERROUND, SCHEMA } from '../src/build/config.ts';
import {
  buildClubs,
  buildMeta,
  buildMonths,
  buildPlayers,
  readPrevious,
  seasonName,
  seasonSlug,
  writeIfChanged,
  writeSeasonIndex,
} from '../src/build/output.ts';
import { readSeason } from '../src/build/season.ts';
import type { Meta, SeasonIndex, XpParts } from '../src/shared/data.ts';
import { build, fetched, LEAGUE_ID } from './fixtures/build-league.ts';

describe('players', () => {
  const { season, lineups } = build();
  const drafted = Array.from({ length: 60 }, (_, i) => i + 1);
  const parts: XpParts = [80.04, 1.86, 0.44, 0, 0.31, 0.25, 0, 0.12, 0, 0.21, -0.07];
  const players = buildPlayers(
    season,
    drafted,
    lineups,
    (pid) => pid / 3,
    (pid) => pid / 7,
    (pid) => (pid === 13 ? parts : undefined),
    [{ points: (pid) => pid / 4, parts: () => parts }],
  );

  it('lists every player with his name, position, club and points', () => {
    assert.equal(Object.keys(players).length, 64);
    const p = players[13];
    assert.deepEqual([p.name, p.full, p.pos, p.club, p.code, p.status], ['P13', 'Player Number 13', 'FWD', 2, 1013, 'a']);
    assert.equal(p.total, season.elements.get(13)?.total_points);
    assert.equal(p.owner, 101);
    assert.equal(players[61].owner, null);
  });

  it('gives gameweek-by-gameweek points only to the players in the league’s story', () => {
    assert.deepEqual(
      players[13].pts,
      [1, 2, 3].map((gw) => season.pointsIn(13, gw)),
    );
    assert.ok(players[62].pts); // claimed, if not won
    assert.equal(players[61].pts, undefined); // nobody's ever wanted him
  });

  it('sums the season’s xG, xA and expected points over the finished gameweeks he played', () => {
    const [xg, xa, xp] = players[13].xs!;
    assert.equal(xg, 0.85); // a goal's 0.55 in the first, 0.3 in the second
    assert.ok(xa > 0 && xp > 0);
    assert.equal(players[9].xs, undefined); // never on the pitch
  });

  it('marks a player FPL added after the draft with the first gameweek he could be picked for, and keeps any news', () => {
    assert.equal(players[61].added, 3);
    assert.equal(players[1].added, undefined);
    assert.equal(players[20].news, 'Knee injury - Unknown return date');
    assert.equal(players[1].news, undefined);
  });

  it('rounds the expected points, and takes them apart and looks ahead only for owned players', () => {
    assert.equal(players[13].ep, 4.3);
    assert.equal(players[13].fpl, 1.9);
    assert.deepEqual(players[13].parts, [80, 1.9, 0.4, 0, 0.3, 0.3, 0, 0.1, 0, 0.2, -0.1]);
    assert.deepEqual(players[13].ahead, [{ ep: 3.3, parts: [80, 1.9, 0.4, 0, 0.3, 0.3, 0, 0.1, 0, 0.2, -0.1] }]);
    assert.equal(players[14].parts, undefined);
    assert.equal(players[61].ahead, undefined);
    assert.equal(players[61].ep, 20.3);
  });

  it('leaves out FPL’s and the parts and what’s ahead when there are none', () => {
    const plain = buildPlayers(season, drafted, lineups, () => 0)[13];
    assert.equal(plain.ep, 0);
    assert.ok(!('fpl' in plain) && !('parts' in plain) && !('ahead' in plain));
  });
});

describe('clubs, seasons and the meta block', () => {
  const season = readSeason(fetched());

  it('gives each club its badge and kit colours, if known', () => {
    const clubs = buildClubs(season);
    assert.deepEqual(clubs[1], {
      name: 'Arsenal',
      short: 'ARS',
      logo: 'https://resources.premierleague.com/premierleague/badges/t3.svg',
      kit: ['#ef0107', '#ffffff'],
    });
    assert.equal(clubs[4].kit, null);
  });

  it('names the season from its first deadline', () => {
    assert.equal(seasonName(season.events), '2026/27');
    assert.equal(seasonName(season.events, 1), '2025/26');
    assert.equal(seasonName([{ deadline_time: '2099-08-10T10:00:00Z' }]), '2099/00');
    assert.match(seasonName([]), /^\d{4}\/\d{2}$/);
    assert.equal(seasonSlug('2026/27'), '2026-27');
  });

  it('describes the league, the gameweeks and the rules', () => {
    const meta = buildMeta(season, LEAGUE_ID, true);
    const { generatedAt, rules, months, ...rest } = meta;
    assert.ok(Date.parse(generatedAt!) > 0);
    assert.deepEqual(rest, {
      schema: SCHEMA,
      leagueId: LEAGUE_ID,
      name: 'Test League',
      season: '2026/27',
      tz: 'Europe/Oslo',
      firstGw: 1,
      lastGw: 6,
      currentGw: 3,
      currentGwFinished: false,
      lastFinishedGw: 2,
      nextGw: 4,
      nextDeadline: '2026-09-05T10:00:00.000Z',
      nextWaivers: '2026-09-03T22:00:00.000Z',
      nextTrades: '2026-09-04T10:00:00.000Z',
      scoring: { win: 3, draw: 1, loss: 0 },
      dgwPenalty: DGW_PENALTY,
      formLength: FORM_LENGTH,
      oddsOverround: ODDS_OVERROUND,
      hasProjections: true,
      formation: { DEF: 3, MID: 2, FWD: 1 },
      xiLimits: { GKP: [1, 1], DEF: [3, 5], MID: [2, 5], FWD: [1, 3] },
    });
    assert.equal(rules?.goals_scored_MID, 5);
    assert.deepEqual(months, [
      { name: 'August', from: 1, to: 3 },
      { name: 'September', from: 4, to: 6 },
    ]);
  });

  it('falls back on London time without the league’s time zone, and has no next deadline after the last gameweek', () => {
    const last = { ...season, league: { ...season.league, draft_tz_show: null }, nextEvent: undefined } as typeof season;
    const meta = buildMeta(last, LEAGUE_ID, false);
    assert.equal(meta.tz, 'Europe/London');
    assert.deepEqual([meta.nextDeadline, meta.nextWaivers, meta.nextTrades], [null, null, null]);
  });

  it('puts each gameweek in the month of its deadline without the main game’s months', () => {
    const months = buildMonths({ ...season, fplBoot: null });
    assert.deepEqual(months, [
      { name: 'August', from: 1, to: 3 },
      { name: 'September', from: 4, to: 6 },
    ]);
  });
});

describe('writing data.json', () => {
  const dirs: string[] = [];
  const tempDir = async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'build-output-'));
    dirs.push(dir);
    return dir;
  };
  after(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

  it('reads the last build’s output, or nothing', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'data.json');
    assert.equal(await readPrevious(file), null);
    await writeFile(file, JSON.stringify({ meta: { nextGw: 4 } }));
    assert.deepEqual(await readPrevious(file), { meta: { nextGw: 4 } });
  });

  it('rewrites the file only when more than its timestamp has changed', async () => {
    const file = path.join(await tempDir(), 'data.json');
    const data = (generatedAt: string, name = 'Test League') => ({ meta: { generatedAt, name }, matches: [1, 2] });
    assert.equal(await writeIfChanged(file, data('2026-10-01T10:00:00Z')), true);
    assert.equal(await writeIfChanged(file, data('2026-10-01T10:10:00Z')), false);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).meta.generatedAt, '2026-10-01T10:00:00Z');
    assert.equal(await writeIfChanged(file, data('2026-10-01T10:20:00Z', 'Renamed')), true);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).meta.name, 'Renamed');
    // Files without a meta block compare whole.
    const plain = path.join(path.dirname(file), 'plain.json');
    assert.equal(await writeIfChanged(plain, { a: 1 }), true);
    assert.equal(await writeIfChanged(plain, { a: 1 }), false);
  });

  it('lists the current season and the archived ones, newest first', async () => {
    const dir = await tempDir();
    const archive = (season: string, schema?: number) => ({ meta: { season, name: `League ${season}`, ...(schema ? { schema } : {}) } });
    await writeFile(path.join(dir, '2024-25.json'), JSON.stringify(archive('2024/25')));
    await writeFile(path.join(dir, '2025-26.json'), JSON.stringify(archive('2025/26', 1)));
    await writeFile(path.join(dir, '2026-27.json'), JSON.stringify(archive('2026/27', 1))); // this season, archived early
    await writeFile(path.join(dir, 'notes.json'), '{}');
    const current = { season: '2026/27', name: 'Test League' } as Meta;
    await writeSeasonIndex(dir, 'public/data.json', current);
    const index = JSON.parse(await readFile(path.join(dir, 'index.json'), 'utf8')) as SeasonIndex;
    assert.deepEqual(index.seasons, [
      { season: '2026/27', name: 'Test League', file: 'data.json', current: true },
      { season: '2025/26', name: 'League 2025/26', file: 'seasons/2025-26.json', schema: 1 },
      { season: '2024/25', name: 'League 2024/25', file: 'seasons/2024-25.json', schema: 0 },
    ]);
  });
});
