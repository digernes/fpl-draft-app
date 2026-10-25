// Proves a change leaves the site as it was, for refactors and anything else that should
// look the same: renders every page (each route, with the settings that change what they
// show, before and during the live gameweek) from this checkout and from another commit,
// both against the same public/data.json, and compares them. With the API responses in
// .cache/ (`npm run data -- --cache .cache`) it also rebuilds data.json offline from both
// and runs the model's backtest on both.
//
//   node scripts/snapshot.ts                   this checkout against main
//   node scripts/snapshot.ts --against HEAD    against the last commit: the uncommitted changes
//   node scripts/snapshot.ts --pages           the pages alone, without the build and backtest
//
// Where pages differ, both versions go to .cache/snapshot/, a tag to a line, to diff.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Data } from '../src/shared/data.ts';
import { parseArgs } from '../src/build/util.ts';

const args = parseArgs(process.argv.slice(2));
const arg = (name: string) => (typeof args[name] === 'string' ? args[name] : undefined);
const SELF = import.meta.filename;
const REPO = path.resolve(import.meta.dirname, '..');
const OUT = path.join(REPO, '.cache', 'snapshot');

// --- In a child process: one checkout's pages or build -------------------------------

// The pages read the clock (countdowns, kick-offs) and the build stamps it: both runs see
// the moment data.json was built.
function freezeClock(now: number) {
  const RealDate = Date;
  globalThis.Date = class extends RealDate {
    constructor(...args: unknown[]) {
      super(...((args.length ? args : [now]) as [number]));
    }
    static override now() {
      return now;
    }
  } as DateConstructor;
}

const readData = (fixture: string): Data => JSON.parse(readFileSync(path.join(fixture, 'data.json'), 'utf8'));

// What the page's modules touch of the browser: enough to load them and draw the pages as
// HTML. Anything on the document is a no-op, and fetch reads the fixture's files.
function fakeBrowser(fixture: string, pending: Promise<unknown>[]) {
  const nothing: unknown = new Proxy(function () {}, {
    get: (_t, key) => (key === Symbol.toPrimitive ? () => '' : key === 'then' ? undefined : nothing),
    apply: () => nothing,
    construct: () => nothing as object,
  });
  Object.assign(globalThis, {
    location: { search: '?relay=off', hash: '', href: 'http://localhost/?relay=off', pathname: '/' },
    document: nothing,
    window: nothing,
    localStorage: { getItem: () => null, setItem() {} },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    requestAnimationFrame: () => 0,
    // What the page checks elements against: nothing here is one.
    Element: class {},
    HTMLElement: class {},
    HTMLDialogElement: class {},
    HTMLImageElement: class {},
  });
  Math.random = () => 0.5;
  globalThis.fetch = ((url: string) => {
    const file = path.join(fixture, String(url).split('?')[0]);
    const res = Promise.resolve(
      existsSync(file)
        ? { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file, 'utf8')) }
        : { ok: false, status: 404, json: async () => ({}) },
    );
    pending.push(res);
    return res;
  }) as typeof fetch;
}

// Every address the site has for this data.
function routes(d: Data) {
  const gws = d.gameweeks.map((g) => g.id);
  return [
    ['#/', '#/transfers', '#/teams'],
    gws.map((gw) => `#/round/${gw}`),
    ['overview', 'table', 'stats', 'transfer-stats', 'draft'].map((tab) => `#/league/${tab}`),
    gws.map((gw) => `#/league/fixtures/${gw}`),
    ['overview', 'fixtures', 'table', 'players'].map((tab) => `#/premier-league/${tab}`),
    Object.keys(d.clubs).map((id) => `#/premier-league/players/${id}`),
    d.managers.flatMap((m) => ['overview', 'squad', 'fixtures', 'transfers', 'stats'].map((tab) => `#/team/${m.id}/${tab}`)),
    d.matches.flatMap((m) =>
      ['facts', 'commentary', 'lineup', 'table', 'stats', 'h2h'].map((tab) => `#/match/${m.gw}/${m.home}-${m.away}/${tab}`),
    ),
    (d.plMatches ?? []).flatMap((m) => ['facts', 'player-stats'].map((tab) => `#/premier-league/match/${m.id}/${tab}`)),
    Object.keys(d.players).map((id) => `#/player/${id}`),
  ].flat();
}

// The settings (state.ts) that change what a page shows, a value or a few each, tried one
// at a time on the pages that read them ('' for all of them).
const variants = (d: Data): [page: string, key: string, values: unknown[]][] => [
  ['team', 'squadScope', ['all']],
  ['team', 'squadSort', ['gw', 'xp', 'total']],
  ['team', 'lineupView', ['all']],
  ['team', 'moves', ['in', 'out']],
  ['', 'lineupStat', ['xp', 'xg', 'xa', 'xcs']],
  ['', 'due', ['xp', 'ko']],
  ['', 'xp', ['fpl']],
  ['', 'odds', ['fractional']],
  ['', 'tableMode', ['form', 'full']],
  ['', 'myTeam', [d.managers[1]?.id]],
  ['pl', 'statsCategory', ['expected', 'projected', 'attack', 'defence', 'goalkeeping', 'fpl']],
  ['pl', 'statsAsc', [true]],
  ['pl', 'playersPos', ['GKP', 'FWD']],
  ['pl', 'playersOwner', ['free', String(d.managers[0]?.id)]],
  ['pl', 'playersAll', [true]],
  ['league', 'tableView', ['form', 'xg', 'luck', 'sim', 'points', 'parallel']],
  ['league', 'openSquad', [String(d.managers[0]?.id)]],
  ['transfers', 'logManager', [String(d.managers[0]?.id)]],
  ['transfers', 'moveType', ['waiver', 'free', 'trade']],
  ['transfers', 'movePos', ['MID']],
  ['match', 'commentaryBench', [true]],
  ['match', 'momentumView', ['chance']],
];

async function renderPages(tree: string, fixture: string, out: string, only?: Set<string>) {
  const d0 = readData(fixture);
  freezeClock(Date.parse(d0.meta.generatedAt ?? '') || Date.now());
  const pending: Promise<unknown>[] = [];
  fakeBrowser(fixture, pending);
  const load = (file: string) => import(pathToFileURL(path.join(tree, 'src/app', file)).href);
  const st = await load('state.ts');
  const { parseRoute } = await load('router.ts');
  const { pageHeader } = await load('page-header.ts');
  const { applyLatestLive } = await load('live-scores.ts');
  const pages = {
    home: (await load('pages/home.ts')).pageHome,
    league: (await load('pages/league.ts')).pageLeague,
    pl: (await load('pages/premier-league.ts')).pagePremierLeague,
    transfers: (await load('pages/transfers.ts')).pageTransfers,
    teams: (await load('pages/teams.ts')).pageTeams,
    team: (await load('pages/team.ts')).pageTeam,
    match: (await load('pages/match.ts')).pageMatch,
    'pl-match': (await load('pages/pl-match.ts')).pagePlMatch,
    player: (await load('pages/player.ts')).pagePlayer,
  };
  const hashes = routes(d0);
  const result: Record<string, string> = {};

  const renderAll = (mode: string, keep: boolean) => {
    const defaults = { ...st.state };
    const one = (setting: string, hash: string) => {
      const key = `${mode} ${setting} ${hash}`;
      if (only && !only.has(key)) return;
      const route = parseRoute(hash);
      st.state.route = route;
      let html: string;
      try {
        const view = pages[route.page as keyof typeof pages](route);
        // As render.ts lays them out, the same in every commit to compare with.
        html = [view.title, view.header && pageHeader(view.header), view.body, view.aside?.html, view.aside?.cls].join('\n');
      } catch (e) {
        html = `Threw: ${(e as Error).message}`; // not the stack, which names the checkout
      }
      if (keep) result[key] = html;
    };
    for (const hash of hashes) one('', hash);
    for (const [page, setting, values] of variants(d0))
      for (const value of values) {
        Object.assign(st.state, defaults, { [setting]: value });
        for (const hash of hashes) if (!page || parseRoute(hash).page === page) one(`${setting}=${String(value)}`, hash);
      }
    Object.assign(st.state, defaults);
  };
  // A first pass asks for the stats files the pages need; the second draws them in.
  const settled = async (mode: string) => {
    renderAll(mode, false);
    // The files are in once their reads have run too, a turn of the event loop after the fetches.
    while (pending.length) {
      await Promise.allSettled(pending.splice(0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    renderAll(mode, true);
  };

  st.setData(readData(fixture));
  await settled('static');
  st.setData(readData(fixture));
  applyLatestLive();
  await settled('live');

  const sha = (s: string) => createHash('sha1').update(s).digest('hex');
  writeFileSync(out, JSON.stringify(only ? result : Object.fromEntries(Object.entries(result).map(([k, v]) => [k, sha(v)]))));
}

async function build(fixture: string, out: string) {
  freezeClock(Date.parse(readData(fixture).meta.generatedAt ?? '') || Date.now());
  globalThis.fetch = (async (url: string) => {
    throw new Error(`offline: ${url}`);
  }) as typeof fetch;
  cpSync(fixture, out, { recursive: true, dereference: true });
  process.argv = [process.argv[0], 'build-data.ts', '--cache', '.cache', '--out', path.join(out, 'data.json')];
  await import(pathToFileURL(path.join(process.cwd(), 'scripts/build-data.ts')).href);
}

// --- The comparison ----------------------------------------------------------------

function run(argv: string[], cwd: string, quiet = true): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, argv, { cwd, stdio: ['ignore', 'pipe', quiet ? 'ignore' : 'inherit'] });
    let stdout = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout }));
  });
}

const filesIn = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)))
    .sort();

function differingFiles(a: string, b: string) {
  const names = [...new Set([...filesIn(a), ...filesIn(b)])];
  return names.filter(
    (n) =>
      !existsSync(path.join(a, n)) || !existsSync(path.join(b, n)) || !readFileSync(path.join(a, n)).equals(readFileSync(path.join(b, n))),
  );
}

async function comparePages(base: string, tmp: string, fixture: string) {
  const renders = (tree: string, name: string) =>
    run([SELF, '--render', tree, '--fixture', fixture, '--out', path.join(tmp, name)], REPO, false);
  await Promise.all([renders(base, 'base.json'), renders(REPO, 'here.json')]);
  const read = (name: string): Record<string, string> => JSON.parse(readFileSync(path.join(tmp, name), 'utf8'));
  const [before, after] = [read('base.json'), read('here.json')];
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const differ = keys.filter((k) => before[k] !== after[k]);
  console.log(`Pages: ${keys.length} renders, ${differ.length} differ`);
  if (!differ.length) return true;

  // The pages themselves, for the first few that differ.
  const shown = differ.slice(0, 20);
  writeFileSync(path.join(tmp, 'keys.json'), JSON.stringify(shown));
  const dump = (tree: string, name: string) =>
    run([SELF, '--render', tree, '--fixture', fixture, '--out', path.join(tmp, name), '--keys', path.join(tmp, 'keys.json')], REPO);
  await Promise.all([dump(base, 'base-pages.json'), dump(REPO, 'here-pages.json')]);
  const [was, now] = [read('base-pages.json'), read('here-pages.json')];
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const lines = (html = '(not rendered)') => html.replace(/></g, '>\n<');
  shown.forEach((key, i) => {
    writeFileSync(path.join(OUT, `${i + 1}.before.html`), lines(was[key]));
    writeFileSync(path.join(OUT, `${i + 1}.after.html`), lines(now[key]));
    console.log(`  ${i + 1}. ${key}`);
  });
  if (differ.length > shown.length) console.log(`  … and ${differ.length - shown.length} more`);
  console.log(
    `  Both versions are in ${path.relative(REPO, OUT)}/: diff ${path.relative(REPO, OUT)}/1.before.html ${path.relative(REPO, OUT)}/1.after.html`,
  );
  return false;
}

async function compareBuild(base: string, tmp: string, fixture: string) {
  const builds = (tree: string, name: string) => run([SELF, '--build', '--fixture', fixture, '--out', path.join(tmp, name)], tree);
  const [a, b] = await Promise.all([builds(base, 'base-build'), builds(REPO, 'here-build')]);
  if (a.code || b.code) {
    console.log(`Build: failed (${a.code ? 'theirs' : 'this checkout’s'}); run it alone to see why`);
    return false;
  }
  const differ = differingFiles(path.join(tmp, 'base-build'), path.join(tmp, 'here-build'));
  console.log(`Build: ${differ.length ? `differs in ${differ.join(', ')} (in ${tmp})` : 'the same'}`);
  return differ.length === 0;
}

async function compareBacktest(base: string) {
  const backtest = (tree: string) => run(['src/model/backtest.ts'], tree);
  const [a, b] = await Promise.all([backtest(base), backtest(REPO)]);
  const same = a.code === 0 && b.code === 0 && a.stdout === b.stdout;
  console.log(`Backtest: ${same ? 'the same' : 'differs'}`);
  return same;
}

async function compare() {
  if (!existsSync(path.join(REPO, 'public/data.json')))
    throw new Error('No public/data.json: build it, or download the live one (see CLAUDE.md)');
  const against = arg('against') ?? 'main';
  const tmp = mkdtempSync(path.join(tmpdir(), 'snapshot-'));
  const base = path.join(tmp, 'base');
  const gitRun = (...argv: string[]) =>
    new Promise<number>((resolve) => spawn('git', argv, { cwd: REPO, stdio: 'ignore' }).on('close', (code) => resolve(code ?? 1)));
  if ((await gitRun('worktree', 'add', '--detach', base, against)) !== 0) throw new Error(`git couldn’t check out ${against}`);
  try {
    for (const dir of ['node_modules', '.cache'])
      if (existsSync(path.join(REPO, dir))) symlinkSync(path.join(REPO, dir), path.join(base, dir));
    // Both read the same data: a copy, as the build writes over its own. The files
    // themselves, never a link (a worktree's public/data.json may be one), or the build
    // would write through it.
    const fixture = path.join(tmp, 'fixture');
    for (const part of ['data.json', 'stats', 'seasons'])
      if (existsSync(path.join(REPO, 'public', part)))
        cpSync(path.join(REPO, 'public', part), path.join(fixture, part), { recursive: true, dereference: true });
    console.log(`Comparing this checkout with ${against}…`);
    const offline = !args.pages && existsSync(path.join(REPO, '.cache'));
    const ok = [await comparePages(base, tmp, fixture)];
    if (offline) ok.push(await compareBuild(base, tmp, fixture), await compareBacktest(base));
    else if (!args.pages) console.log('Build and backtest: skipped, without the API responses in .cache/');
    process.exitCode = ok.every(Boolean) ? 0 : 1;
  } finally {
    await gitRun('worktree', 'remove', '--force', base);
    // Kept when something differs, for the build's files.
    if (!process.exitCode) rmSync(tmp, { recursive: true, force: true });
  }
}

const fixture = arg('fixture');
if (args.render && fixture) {
  const keys = arg('keys');
  await renderPages(String(args.render), fixture, arg('out')!, keys ? new Set(JSON.parse(readFileSync(keys, 'utf8'))) : undefined);
  process.exit(0); // the pages' timers would keep it running
} else if (args.build && fixture) {
  await build(fixture, arg('out')!);
} else {
  await compare();
}
