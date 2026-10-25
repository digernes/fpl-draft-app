import { drawIntoNothing } from './fixtures/browser.ts';

import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';

import { runAction } from '../src/app/actions.ts';
import { applyLatestLive } from '../src/app/live-scores.ts';
import { pageMatch } from '../src/app/pages/match.ts';
import { href, type Route } from '../src/app/router.ts';
import { statsFor } from '../src/app/stats-files.ts';
import { setData, setLive, state } from '../src/app/state.ts';
import type { Data, Match } from '../src/shared/data.ts';
import { cardTitled, cardTitles, listRows, text, tiles } from './fixtures/html.ts';
import { match } from './fixtures/league.ts';
import { annVBobLive, bobVCy, statsFile } from './fixtures/match.ts';

// GW 2's stats file comes at once and GW 1's isn't there; the others, and the relay's
// polls, never answer.
before(async () => {
  drawIntoNothing();
  Object.assign(globalThis, {
    fetch: (url: string) =>
      url.startsWith('stats/2.json')
        ? Promise.resolve({ ok: true, json: async () => statsFile() })
        : url.startsWith('stats/1.json')
          ? Promise.resolve({ ok: false, status: 404 })
          : new Promise(() => {}),
  });
  setData(bobVCy());
  state.route = { page: 'home', tab: '' };
  statsFor(1);
  statsFor(2);
  await new Promise((resolve) => setImmediate(resolve));
});

const due = (gw: number, home: number, away: number): Match => ({
  ...match(gw, home, away, 0, 0, false),
  homePts: null,
  awayPts: null,
  started: false,
});

// See bobVCy(); and GW 4 to come, with Bob at home to Cy again.
function data(): Data {
  const d = bobVCy();
  d.matches.push(due(4, 2, 3));
  return d;
}

beforeEach(() => {
  setData(data());
  setLive(null);
  Object.assign(state, { myTeam: null, commentaryBench: false, odds: 'decimal', tableMode: 'short' });
});

const page = (gw: number, home: number, away: number, tab: Route['tab'] = 'facts') => pageMatch({ page: 'match', tab, gw, home, away });
const bobCy = (tab: Route['tab'] = 'facts') => page(2, 2, 3, tab);

describe('a head-to-head’s page', () => {
  it('says so when there is no such match in the league', () => {
    const view = page(2, 1, 3);
    assert.equal(view.title, 'Match');
    assert.match(view.body, /No such match in this league/);
    assert.equal(view.header!.title, 'Office League');
  });

  it('heads it with both sides, the score and who scored most for each, and the tabs', () => {
    const { title, header } = bobCy();
    assert.equal(title, 'Bob v Cy · GW 2');
    const poster = header!.poster!;
    assert.match(poster, /<span class="mh-score">9 - 18<\/span><span class="mh-status">Full time<\/span>/);
    assert.ok(poster.includes(`<a class="mh-back" href="${href.home(2)}">`));
    const [home, away] = poster.split('<div class="mh-scorers">')[1].split('<div class="away">');
    assert.equal(text(home), 'Palmer 7');
    assert.equal(text(away), 'Salah 13');
    assert.deepEqual(
      header!.tabs!.map((t) => t.label),
      ['Facts', 'Commentary', 'Lineup', 'Table', 'Stats', 'Head-to-head'],
    );
    assert.equal(header!.tabs![4].href, href.match({ gw: 2, home: 2, away: 3 }, 'stats'));
  });

  it('heads a match to come with its deadline in place of the score', () => {
    const poster = page(4, 2, 3).header!.poster!;
    assert.match(poster, /<div class="mh pre">/);
    assert.match(poster, /<div class="mh-date">Gameweek 4 · deadline [^<]+<\/div>/);
    assert.match(poster, /<span class="mh-status">Deadline<\/span>/);
    assert.doesNotMatch(poster, /mh-scorers/);
  });

  it('has the lineups on one pitch and each side’s form on the Facts tab', () => {
    const { body } = bobCy();
    assert.deepEqual(cardTitles(body).slice(-2), ['Lineup', 'Team form']);
    // Bob's GW 1 defeat by Ann; Cy's GW 1 draw with her.
    const form = cardTitled(body, 'Team form');
    assert.match(text(form), /AN Ann 50 - 40 BO Bob CY Cy 30 - 30 AN Ann$/);
    assert.match(form, /<span class="tf-score L">50 - 40<\/span>/);
    assert.match(form, /<span class="tf-score D">30 - 30<\/span>/);
  });

  it('has the predicted lineups before kick-off, once there are odds with them', () => {
    const html = cardTitled(page(4, 2, 3).body, 'Predicted lineup');
    assert.match(html, /They come with the odds, three gameweeks out/);
    assert.notEqual(cardTitled(page(4, 2, 3).body, 'Team form'), '');
  });

  it('has the table with both sides picked out, and the Stats tab', () => {
    const table = bobCy('table').body;
    assert.match(table, /<div class="trow {2}featured qual" data-key="m-3"/);
    assert.match(table, /<div class="trow {2}featured qual" data-key="m-2"/);
    assert.match(bobCy('stats').body, /<h3 class="st-head">Where the points came from<\/h3>/);
    assert.match(bobCy('lineup').body, /<h2 class="card-title">Lineup<\/h2>/);
  });
});

describe('beside a head-to-head', () => {
  const aside = (view = bobCy()) => view.aside!.html;

  it('has the odds, the round’s matches, the top stats above the report, the top players and the benches', () => {
    const html = aside();
    assert.deepEqual(cardTitles(html), ['Top stats', 'Match report', 'Top players', 'On the bench']);
    assert.match(
      html,
      /<div class="detail-label">Pre-match odds <span class="muted" data-tip="The odds at the deadline">· at the deadline<\/span><\/div>/,
    );
    // Cy won, so the home win and the draw are struck through.
    assert.deepEqual(
      [...html.matchAll(/<span class="odd( lost)?"/g)].map((m) => Boolean(m[1])),
      [true, true, false],
    );
    assert.equal(bobCy('stats').aside!.cls, 'cols-match');
    assert.equal(bobCy().aside!.cls, 'cols-match facts');
  });

  it('lists the round’s matches with this one picked out', () => {
    const round = aside().split('<section class="card round-matches">')[1].split('</section>')[0];
    assert.match(round, /<a class="rc-row this" href="#\/match\/2\/2-3">/);
    assert.match(text(round), /^Office League Gameweek 2 .*BO Bob 9 CY Cy 18 FT$/);
  });

  it('names each side’s top players, and its bench', () => {
    assert.deepEqual(listRows(cardTitled(aside(), 'Top players')), [
      'Palmer For Bob 7',
      'Haaland For Bob 2',
      'Salah For Cy 13',
      'Watkins For Cy 5',
    ]);
    assert.deepEqual(tiles(cardTitled(aside(), 'On the bench')), [
      'Bob’s bench: 0 · No automatic substitutions',
      'Cy’s bench: 5 · No automatic substitutions',
    ]);
    const d = data();
    d.lineups[3][2] = { ...d.lineups[3][2], subs: [16] };
    setData(d);
    assert.equal(tiles(cardTitled(aside(), 'On the bench'))[1], 'Cy’s bench: 5 · On automatically: Isak');
  });

  it('reports it as over once every player in it is done, before FPL finishes it, with no live odds', () => {
    const report = (d: Data) => {
      setData(d);
      setLive(null);
      applyLatestLive();
      const html = aside(page(3, 1, 2));
      return { html, lines: text(cardTitled(html, 'Match report')) };
    };
    const on = report(annVBobLive());
    assert.match(on.lines, /still to play/);
    assert.match(on.html, /class="odd/);
    const d = annVBobLive();
    d.live!.fixtures[1] = { ...d.live!.fixtures[1], done: true, min: 90 };
    d.plMatches![1].done = true;
    const over = report(d);
    assert.doesNotMatch(over.lines, /still to play|As it stands|so far/);
    assert.doesNotMatch(over.html, /class="odd/);
  });

  it('asks who will win before kick-off, with the model’s chances, and previews the match', () => {
    const d = data();
    d.matches.at(-1)!.odds = d.matches.find((m) => m.gw === 2)!.odds;
    setData(d);
    const html = aside(page(4, 2, 3));
    assert.deepEqual(cardTitles(html).slice(0, 1), ['Who will win?']);
    assert.match(text(cardTitled(html, 'Who will win?')), /BO 30% X 20% CY 50%/);
    assert.ok(!cardTitles(html).includes('Top players'));
  });
});

describe('a head-to-head’s commentary', () => {
  const commentary = (gw = 2, home = 2, away = 3) => cardTitled(page(gw, home, away, 'commentary').body, 'Commentary');
  // Each entry as a reader sees it, without its time of day.
  const entries = (html: string) =>
    html
      .split('<div class="cm-entry ')
      .slice(1)
      .map((e) => text(`<div class="${e}`.replace(/<span class="cm-time"[^>]*>[^<]*<\/span>/, '')));

  it('waits for the first kick-off, and for the gameweek’s stats file', () => {
    assert.match(commentary(4), /It starts with the gameweek’s first kick-off/);
    assert.match(commentary(1, 1, 2), /Not in yet: it comes with the next update/);
  });

  it('tells what either side’s players did, the latest first, with their points and the score it left', () => {
    assert.deepEqual(entries(commentary()), [
      'FT Full time MCI 0 - 0 ARS',
      '60’ An hour played MCI v ARS Haaland BO Bob +1 Bob 9 - 18 Cy',
      'HT Half-time MCI 0 - 0 ARS',
      'KO Kick-off MCI v ARS Haaland BO Bob +1 Bob 8 - 18 Cy',
      'FT Full time CHE 1 - 2 LIV Salah CY Bonus +3 Bob 7 - 18 Cy',
      '67’ Goal! CHE 1 - 2 LIV Watkins CY Goal +4 Salah CY Assist +3 Bob 7 - 15 Cy',
      '60’ An hour played CHE v LIV Palmer BO Bob +1 Salah CY Cy +1 Watkins CY Cy +1 Bob 7 - 8 Cy',
      '52’ Yellow card CHE v LIV Watkins CY Cy -1 Bob 6 - 6 Cy',
      'HT Half-time CHE 1 - 1 LIV',
      '41’ Goal! CHE 1 - 1 LIV Palmer BO Goal +5 Bob 6 - 7 Cy',
      '23’ Goal! CHE 0 - 1 LIV Salah CY Goal +5 Bob 1 - 7 Cy',
      'KO Kick-off CHE v LIV Palmer BO Bob +1 Salah CY Cy +1 Watkins CY Cy +1 Bob 1 - 2 Cy',
    ]);
    // A goal's minute in the colour of the side it's for.
    assert.match(commentary(), /<span class="cm-min m2">41’<\/span>/);
  });

  it('brings in the benches’ players with the switch', () => {
    assert.ok(!commentary().includes('href="#/player/16"'));
    assert.match(commentary(), /role="switch" aria-checked="false" data-action="commentary-bench" data-value="on"/);
    runAction({ dataset: { action: 'commentary-bench', value: 'on' } } as unknown as HTMLElement);
    assert.equal(state.commentaryBench, true);
    assert.ok(commentary().includes('href="#/player/16"'));
    assert.match(commentary(), /on the bench/);
  });
});

describe('a head-to-head’s meetings', () => {
  it('counts each side’s wins and the draws, and lists every meeting with this one picked out', () => {
    const d = data();
    d.matches.splice(-1, 0, match(3, 3, 2, 50, 50)); // before GW 4’s
    setData(d);
    const html = bobCy('h2h').body;
    assert.deepEqual(
      [...html.matchAll(/<span class="h2h-badge ([^"]+)">(\d+)<\/span><span class="h2h-label">(\w+)<\/span>/g)].map(
        (m) => `${m[3]} ${m[2]} ${m[1]}`,
      ),
      ['Wins 0 m2', 'Draws 1 draw', 'Wins 1 m3'],
    );
    const rows = [...html.matchAll(/<a class="h2h-row( this)?" href="([^"]+)">([\s\S]*?)<\/a>/g)].map(
      (m) => `${m[2]}${m[1] ? ' (this)' : ''}: ${text(m[3])}`,
    );
    assert.equal(rows.length, 3);
    assert.match(rows[0], /^#\/match\/2\/2-3 \(this\): Gameweek 2 · .* Office League Bob BO 9 - 18 CY Cy$/);
    assert.match(rows[1], /^#\/match\/3\/3-2: Gameweek 3 · .* Office League Cy CY 50 - 50 BO Bob$/);
    assert.match(rows[2], /^#\/match\/4\/2-3: Gameweek 4 · .* Office League Bob BO .+ CY Cy$/);
  });
});
