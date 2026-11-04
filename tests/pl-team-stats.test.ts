import { drawIntoNothing } from './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { runAction } from '../src/app/actions.ts';
import { pagePremierLeague } from '../src/app/pages/premier-league.ts';
import { cleanSheetChance, expectedGoals, perMatch, strengthRows, teamStatsTab, verdict } from '../src/app/pl-team-stats.ts';
import { parseRoute } from '../src/app/router.ts';
import { D, setData, state } from '../src/app/state.ts';
import type { ClubRow, ClubStrength, Data, PlMatch } from '../src/shared/data.ts';
import { cardTitled, text } from './fixtures/html.ts';
import { squads } from './fixtures/league.ts';

// Four clubs: Arsenal (1) strong at both ends, Chelsea (2) average, Liverpool (3) all
// attack and Man City (4) weak. A club's goals are exp(base + home + attack − defence).
const strength = (): ClubStrength => ({
  gw: 4,
  base: 0.2,
  home: 0.2,
  ratings: { 1: [0.3, 0.4], 2: [0, 0], 3: [0.4, -0.2], 4: [-0.3, -0.3] },
  size: 10,
  season: { 1: [3, 6, 2.4], 2: [3, 3.9, 3.9], 3: [3, 5.1, 4.5], 4: [2, 1.6, 3.2] },
});

const pl = (id: number, gw: number, home: number, away: number): PlMatch => ({ id, gw, home, away, ko: null });

function data(): Data {
  const d = squads();
  d.clubStrength = strength();
  d.plMatches = [
    pl(1, 3, 1, 2), // played: before the ratings' gameweek
    pl(2, 4, 1, 4),
    pl(3, 4, 2, 3),
    pl(4, 5, 3, 1),
    pl(5, 5, 4, 2),
    pl(6, 6, 1, 2), // a double gameweek for Arsenal, and none for Liverpool
    pl(7, 6, 4, 1),
    ...[7, 8, 9].flatMap((gw) => [pl(gw * 10, gw, 1, 3), pl(gw * 10 + 1, gw, 2, 4)]),
  ];
  return d;
}

const ex = (n: number) => Math.exp(n);

describe('the club ratings’ maths', () => {
  it('gives a club exp(base + home + attack − the opponent’s defence) goals', () => {
    const s = strength();
    assert.ok(Math.abs(expectedGoals(s, 1, 4, true) - ex(0.2 + 0.2 + 0.3 + 0.3)) < 1e-9);
    assert.ok(Math.abs(expectedGoals(s, 4, 1, false) - ex(0.2 - 0.3 - 0.4)) < 1e-9);
    // A club the ratings don't know is an average one.
    assert.ok(Math.abs(expectedGoals(s, 9, 2, false) - ex(0.2)) < 1e-9);
  });

  it('takes a clean sheet’s chance from the model’s spread, a little above a Poisson’s', () => {
    const s = strength();
    assert.ok(Math.abs(cleanSheetChance(s, 1) - (10 / 11) ** 10) < 1e-9);
    assert.ok(cleanSheetChance(s, 1) > Math.exp(-1));
    assert.ok(Math.abs(cleanSheetChance({ ...s, size: 1e9 }, 1) - Math.exp(-1)) < 1e-6);
    assert.equal(cleanSheetChance(s, 0), 1);
  });

  it('averages a club’s matches against each of the others, home and away', () => {
    const s = strength();
    const { xg, xga } = perMatch(s, 2);
    const others = [1, 3, 4];
    const mean = (f: (opp: number) => number) => others.reduce((t, o) => t + f(o), 0) / 3;
    assert.ok(Math.abs(xg - mean((o) => (ex(0.4 - s.ratings[o][1]) + ex(0.2 - s.ratings[o][1])) / 2)) < 1e-9);
    assert.ok(Math.abs(xga - mean((o) => (ex(0.4 + s.ratings[o][0]) + ex(0.2 + s.ratings[o][0])) / 2)) < 1e-9);
  });
});

describe('the Premier League’s Team stats tab', () => {
  beforeEach(() => {
    setData(data());
    drawIntoNothing();
    state.route = { page: 'pl', tab: 'team-stats' };
    Object.assign(state, { plFixtures: 'goals', plTeamSort: 'diff', plTeamFlip: false, plFixturesSort: 'total', plFixturesFlip: false });
  });

  it('is a tab of the Premier League’s page, at its own address', () => {
    assert.deepEqual(parseRoute('#/premier-league/team-stats'), { page: 'pl', tab: 'team-stats', gw: undefined });
    const page = pagePremierLeague({ page: 'pl', tab: 'team-stats' });
    assert.equal(page.title, 'Team stats · Premier League');
    assert.ok(page.header!.tabs!.some((t) => t.label === 'Team stats' && t.href === '#/premier-league/team-stats'));
    assert.ok(cardTitled(page.body, 'Team strength'));
  });

  it('ranks the clubs on the goals they can expect beyond what they concede', () => {
    const html = cardTitled(teamStatsTab(), 'Team strength');
    const names = [...html.matchAll(/<span class="who-name">([^<]+)</g)].map((m) => m[1]);
    assert.deepEqual(names, ['Arsenal', 'Liverpool', 'Chelsea', 'Man City']);
    const { xg, xga } = perMatch(D.clubStrength!, 1);
    assert.ok(text(html).includes(`1 Arsenal ${xg.toFixed(2)} ${xga.toFixed(2)} +${(xg - xga).toFixed(2)}`));
    assert.ok(text(html).includes('Goals per match against an average side, before gameweek 4'));
  });

  it('shows each club’s xG for and against per match so far', () => {
    const html = text(cardTitled(teamStatsTab(), 'Team strength'));
    assert.ok(html.includes('2.00 0.80')); // Arsenal: 6 and 2.4 over 3
    assert.ok(html.includes('0.80 1.60')); // Man City: 1.6 and 3.2 over 2
  });

  it('writes a club worse at both ends with a real minus sign', () => {
    const html = text(cardTitled(teamStatsTab(), 'Team strength'));
    const { xg, xga } = perMatch(D.clubStrength!, 4);
    assert.ok(html.includes(`4 Man City ${xg.toFixed(2)} ${xga.toFixed(2)} −${(xga - xg).toFixed(2)}`));
  });

  const sort = (action: string, value: string) => runAction({ dataset: { action, value } } as unknown as HTMLElement);
  const order = () => [...cardTitled(teamStatsTab(), 'Team strength').matchAll(/<span class="who-name">([^<]+)</g)].map((m) => m[1]);

  it('sorts by any column, best first: the fewest conceded for Def and xGA', () => {
    sort('pl-team-sort', 'xga');
    const byDef = strengthRows(D.clubStrength!).sort((a, b) => a.xga - b.xga);
    assert.deepEqual(
      order(),
      byDef.map((r) => D.clubs[r.club].name),
    );
    sort('pl-team-sort', 'seasonXg');
    assert.deepEqual(order(), ['Arsenal', 'Liverpool', 'Chelsea', 'Man City']); // 2.00, 1.70, 1.30, 0.80
    const html = cardTitled(teamStatsTab(), 'Team strength');
    assert.match(html, /data-value="seasonXg" aria-pressed="true"[^>]*>xG<svg class="sort-mark"/);
    assert.match(html, /data-value="diff" aria-pressed="false"[^>]*>Diff<\/button>/);
  });

  it('turns the sorted column round, and numbers the clubs as they stand', () => {
    sort('pl-team-sort', 'diff');
    assert.deepEqual(order(), ['Man City', 'Chelsea', 'Liverpool', 'Arsenal']);
    assert.ok(text(cardTitled(teamStatsTab(), 'Team strength')).includes('1 Man City'));
    sort('pl-team-sort', 'diff');
    assert.deepEqual(order(), ['Arsenal', 'Liverpool', 'Chelsea', 'Man City']);
  });

  it('says in a line who scores the most and who concedes the fewest', () => {
    const intro = text(cardTitled(teamStatsTab(), 'Team strength').split('</p>')[0]);
    assert.ok(intro.endsWith('Arsenal score the most and concede the fewest.'), intro);
    D.clubStrength!.ratings[3] = [0.7, -0.2];
    assert.equal(verdict(strengthRows(D.clubStrength!)), 'Liverpool score the most, Arsenal concede the fewest.');
  });

  it('names the club whose place in the table is furthest from its strength, once a few matches are in', () => {
    // Seven clubs, three of them average.
    const s = D.clubStrength!;
    s.ratings = { ...s.ratings, 5: [0, 0], 6: [0, 0], 7: [0, 0] };
    D.clubs = { ...D.clubs, 5: D.clubs[2], 6: D.clubs[2], 7: D.clubs[2] };
    const strength = strengthRows(s).map((r) => r.club);
    const table = (clubs: number[]) => {
      D.tables = { premierLeague: clubs.map((club, i) => ({ club, rank: i + 1 }) as ClubRow) } as Data['tables'];
    };
    // Man City, bottom on strength, top the table.
    assert.equal(strength.at(-1), 4);
    table([4, ...strength.slice(0, -1)]);
    const best = 'Liverpool score the most, Arsenal concede the fewest.';
    // Three matches each: too few for the table to say much.
    assert.equal(verdict(strengthRows(s)), best);
    for (const c of [1, 2, 3, 4]) s.season[c][0] = 5;
    assert.equal(
      verdict(strengthRows(s)),
      `${best} Man City are 1st in the table but 7th on strength, their results running ahead of their chances.`,
    );
    // Arsenal, top on strength, bottom of the table.
    table([...strength.slice(1), 1]);
    assert.equal(
      verdict(strengthRows(s)),
      `${best} Arsenal are 7th in the table but 1st on strength, their results lagging behind their chances.`,
    );
    // Nobody further than three places off.
    table([strength[1], strength[0], ...strength.slice(2)]);
    assert.equal(verdict(strengthRows(s)), best);
  });

  it('says when there are no ratings yet', () => {
    delete D.clubStrength;
    assert.ok(text(teamStatsTab()).includes('The ratings come once the first gameweek has been played.'));
  });
});

describe('the fixtures ahead', () => {
  beforeEach(() => {
    setData(data());
    drawIntoNothing();
    state.route = { page: 'pl', tab: 'team-stats' };
    Object.assign(state, { plFixtures: 'goals', plTeamSort: 'diff', plTeamFlip: false, plFixturesSort: 'total', plFixturesFlip: false });
  });

  const card = () => cardTitled(teamStatsTab(), 'Fixtures ahead');
  const rows = (html: string) =>
    html
      .split('<div class="hm-row')
      .slice(2)
      .map((row) => text(`<div${row}`));

  it('has the five gameweeks from the ratings’ one, each club’s opponents in them', () => {
    const html = card();
    assert.ok(text(html).includes('GW 4 GW 5 GW 6 GW 7 GW 8 xG'));
    assert.ok(!html.includes('GW 9'));
    const ars = rows(html).find((r) => r.startsWith('ARS'))!;
    assert.ok(ars.startsWith('ARS MCI (H) LIV (A) CHE (H) MCI (A) LIV (H) LIV (H)'), ars);
  });

  it('puts the easiest run first, by the goals over those gameweeks', () => {
    const s = D.clubStrength!;
    const totals = [1, 2, 3, 4].map((c) => {
      const ms = (D.plMatches ?? []).filter((m) => m.gw >= 4 && m.gw <= 8 && (m.home === c || m.away === c));
      return { c, total: ms.reduce((t, m) => t + expectedGoals(s, c, m.home === c ? m.away : m.home, m.home === c), 0) };
    });
    const order = totals.sort((a, b) => b.total - a.total).map((t) => D.clubs[t.c].short);
    assert.deepEqual(
      rows(card()).map((r) => r.split(' ')[0]),
      order,
    );
    const first = totals[0];
    assert.ok(rows(card())[0].endsWith(first.total.toFixed(1)));
  });

  it('marks a gameweek without a match, and has both of a double gameweek’s', () => {
    const html = card();
    assert.ok(html.includes('data-tip="LIV · GW 6: no match">–<'));
    const s = D.clubStrength!;
    const tip = `ARS · GW 6: CHE (H): ${expectedGoals(s, 1, 2, true).toFixed(2)} · MCI (A): ${expectedGoals(s, 1, 4, false).toFixed(2)}`;
    assert.ok(html.includes(`data-tip="${tip}"`), tip);
  });

  it('shades a cell by the goals a match brings, a double gameweek’s by its average', () => {
    const html = card();
    // Arsenal at home to Man City: exp(1.0) = 2.72 goals, the top band.
    assert.match(html, /<span class="hm-cell h4" data-tip="ARS · GW 4: MCI \(H\): 2\.72"/);
    // Man City away at Arsenal: exp(−0.5) = 0.61, the bottom one.
    assert.match(html, /<span class="hm-cell h0" data-tip="MCI · GW 4: ARS \(A\): 0\.61"/);
  });

  it('switches to the chance of a clean sheet', () => {
    runAction({ dataset: { action: 'pl-fixtures', value: 'clean' } } as unknown as HTMLElement);
    assert.equal(state.plFixtures, 'clean');
    const html = card();
    assert.ok(text(html).includes('Each club’s chance of a clean sheet'));
    assert.ok(text(html).includes('GW 8 xCS'));
    const s = D.clubStrength!;
    const chance = cleanSheetChance(s, expectedGoals(s, 4, 1, false));
    assert.ok(html.includes(`data-tip="ARS · GW 4: MCI (H): ${Math.round(chance * 100)}%"`));
    assert.ok(text(html).includes('<20% 20%–25% 25%–30% 30%–35% 35%+'));
  });

  it('sorts by one gameweek, the most goals in it first, and back again', () => {
    const sort = (value: string) => runAction({ dataset: { action: 'pl-fixtures-sort', value } } as unknown as HTMLElement);
    // GW 4: Arsenal at home to Man City (2.72 goals) first, Man City (0.61) last, and
    // Chelsea and Liverpool level (1.82) in the order of their whole runs.
    const total = rows(card()).map((r) => r.split(' ')[0]);
    sort('4');
    const byGw = rows(card()).map((r) => r.split(' ')[0]);
    assert.equal(byGw[0], 'ARS');
    assert.equal(byGw[3], 'MCI');
    assert.deepEqual(
      byGw.slice(1, 3),
      total.filter((c) => c === 'CHE' || c === 'LIV'),
    );
    assert.match(card(), /data-value="4" aria-pressed="true"[^>]*>GW 4<svg/);
    sort('4');
    assert.deepEqual(rows(card()).map((r) => r.split(' ')[0])[0], 'MCI');
    assert.equal(rows(card()).at(-1)!.split(' ')[0], 'ARS');
    // A gameweek past the card's goes back to the whole run.
    state.plFixturesSort = '12';
    assert.match(card(), /data-value="total" aria-pressed="true"/);
  });

  it('leaves the card out once no gameweek is left, as in a finished season', () => {
    D.clubStrength!.gw = 39;
    assert.equal(card(), '');
    assert.ok(cardTitled(teamStatsTab(), 'Team strength'));
  });
});
