// Fakes a gameweek in progress in public/data.json, to try the live views without
// waiting for a match day. The latest gameweek's fixtures, by kick-off: the first half
// finished, one in play at 63 minutes and the rest still to come, with FPL's real points
// for everyone who has played. Build the real data first (`npm run data`); it is kept
// in .cache/ until it is put back.
//
//   node scripts/fake-live.ts             fake it
//   node scripts/fake-live.ts --restore   put the real data.json back
//
// Open the page with ?relay=off (say http://localhost:8765/?relay=off#/), or the
// live relay replaces the faked scores with the real, finished ones.

import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

import type { Data } from '../src/shared/data.ts';
import { LiveFeed } from '../src/shared/fpl-api.ts';
import { slimLive } from '../src/shared/live.ts';

const DATA = 'public/data.json';
const REAL = '.cache/data.real.json';

async function restore() {
  if (!existsSync(REAL)) throw new Error(`Nothing to put back: ${REAL} is missing`);
  await copyFile(REAL, DATA);
  await rm(REAL);
  console.log(`Put the real ${DATA} back.`);
}

async function fake() {
  if (existsSync(REAL)) throw new Error(`Already faked: run with --restore first (the real data is in ${REAL})`);
  const d: Data = JSON.parse(await readFile(DATA, 'utf8'));
  const gw = d.meta.currentGw;
  if (!d.meta.currentGwFinished) throw new Error(`GW ${gw} is being played for real`);

  // The same feed the relay passes on (worker/index.ts).
  const res = await fetch(`https://draft.premierleague.com/api/event/${gw}/live`);
  if (!res.ok) throw new Error(`FPL answered ${res.status}`);
  const feed = slimLive(LiveFeed.parse(await res.json()));

  const fixtures = [...feed.fixtures].sort((a, b) => (a.ko ?? '').localeCompare(b.ko ?? ''));
  const inPlay = Math.floor(fixtures.length / 2);
  const tomorrow = new Date(Date.now() + 86400e3).toISOString();
  const toCome = new Set<number>();
  fixtures.forEach((f, i) => {
    if (i === inPlay) Object.assign(f, { done: false, min: 63 });
    if (i <= inPlay) return;
    Object.assign(f, { started: false, done: false, ko: tomorrow });
    delete f.min;
    delete f.bps;
    toCome.add(f.h).add(f.a);
  });
  // What happened in matches still to come hasn't happened yet, and nobody in the match
  // in play has gone off yet, as slimLive only decides that at full time.
  const playing = new Set([fixtures[inPlay].h, fixtures[inPlay].a]);
  const events = feed.events ?? {};
  for (const [pid, p] of Object.entries(d.players)) {
    if (toCome.has(p.club)) {
      delete feed.elements[pid];
      delete events[pid];
    } else if (playing.has(p.club) && events[pid]?.off) {
      delete events[pid].off;
      if (!events[pid].on) delete events[pid].min;
    }
  }

  d.meta.currentGwFinished = false;
  d.meta.lastFinishedGw = gw - 1;
  for (const g of d.gameweeks) if (g.id === gw) g.finished = false;
  for (const m of d.matches) if (m.gw === gw) m.finished = false;
  const picked = new Set<number>();
  for (const byGw of Object.values(d.lineups)) {
    const l = byGw[gw];
    if (!l) continue;
    l.picks = [...l.xi, ...l.bench];
    for (const pid of l.picks) picked.add(pid);
  }
  d.live = { gw, elements: feed.elements, events, fixtures, ep: Object.fromEntries([...picked].map((pid) => [pid, d.players[pid].ep])) };

  await mkdir('.cache', { recursive: true });
  await copyFile(DATA, REAL);
  await writeFile(DATA, JSON.stringify(d));
  console.log(`GW ${gw} faked: ${inPlay} fixtures finished, one in play, ${fixtures.length - inPlay - 1} to come.`);
}

await (process.argv.includes('--restore') ? restore() : fake());
