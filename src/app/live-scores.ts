// Loading data.json, refreshing it, and live scores and new transfers from the relay.

import type { Data, SeasonEntry } from '../shared/data.ts';
import { scoreLive } from '../shared/in-play.ts';
import { provisionalBonus, type SlimLive } from '../shared/live.ts';
import { mergeTransfers, type SlimTransfers } from '../shared/transfers.ts';
import { refreshInPlay } from './in-play-records.ts';
import { gwInfo, isArchive, isLive, player, seasonEntry, seasonSlug } from './lookups.ts';
import { renderAll, renderView } from './render.ts';
import {
  D,
  live,
  LIVE_IDLE_MS,
  LIVE_POLL_MS,
  LIVE_REFRESH_MS,
  LIVE_URL,
  REFRESH_MS,
  seasons,
  setData,
  setLive,
  setSeasons,
  state,
  TRANSFERS_POLL_MS,
  type LiveLineup,
} from './state.ts';
import { withRowMoves } from './table.ts';

let lastFetch = 0;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let liveTimer: ReturnType<typeof setTimeout> | undefined;
let transfersTimer: ReturnType<typeof setTimeout> | undefined;
let latestTransfers: SlimTransfers | null = null;
// The relay has owners data.json hasn't caught up with, so the Worker is starting a build:
// look for it as often as in a live gameweek.
let behind = false;

export async function loadSeasons() {
  try {
    const res = await fetch(`seasons/index.json?v=${Date.now()}`, { cache: 'no-store' });
    setSeasons(res.ok ? ((await res.json()) as { seasons: SeasonEntry[] }).seasons : []);
  } catch {
    setSeasons([]); // no archive yet: just the current season
  }
  const wanted = new URL(location.href).searchParams.get('season');
  state.season = seasons.some((s) => seasonSlug(s.season) === wanted && !s.current) ? wanted : null;
}

export async function loadData() {
  const res = await fetch(`${seasonEntry()?.file ?? 'data.json'}?v=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data: Data = await res.json();
  lastFetch = Date.now();
  const changed = !D || data.meta.generatedAt !== D.meta.generatedAt;
  setData(data);
  return changed;
}

// Re-scores every live lineup from the relay's feed and patches the live matches.
function applyLive(feed: SlimLive) {
  const gw = D.meta.currentGw;
  const doubles = new Set(gwInfo(gw)?.doubles ?? []);
  const lineups: Record<number, LiveLineup> = {};
  let points: (id: number) => number = () => 0;
  for (const m of D.managers) {
    const scored = scoreLive(D, m.id, gw, feed);
    if (!scored) continue;
    const l = D.lineups[m.id][gw];
    const dgw = scored.xi.filter((pid) => doubles.has(player(pid)?.club)).length;
    points = scored.points;
    lineups[m.id] = {
      ...l,
      ...scored,
      dgw,
      adj: scored.pts - D.meta.dgwPenalty * dgw,
      benchPts: scored.bench.reduce((t, pid) => t + scored.points(pid), 0),
    };
  }
  const provisional = provisionalBonus(feed.fixtures);
  const bonus = (id: number) => (feed.events?.[id]?.bonus ?? 0) + (provisional.get(id) ?? 0);
  setLive({ gw, feed, lineups, points, bonus });
  for (const m of D.matches) {
    if (m.gw !== gw || !m.started || m.finished) continue;
    m.homePts = lineups[m.home]?.pts ?? m.homePts;
    m.awayPts = lineups[m.away]?.pts ?? m.awayPts;
  }
}

// The freshest feed for the gameweek being played: the relay's, if it runs, otherwise
// the one data.json came with.
export function applyLatestLive() {
  const gw = D.meta.currentGw;
  const feed = LIVE_URL && live?.gw === gw ? live.feed : D.live?.gw === gw ? D.live : null;
  if (feed && !isArchive()) applyLive(feed);
  else if (isArchive()) setLive(null); // an archived season has nothing live
}

const liveScores = () => JSON.stringify(D.matches.filter((m) => m.gw === D.meta.currentGw).map((m) => [m.homePts, m.awayPts]));
// What the pages show of a gameweek beyond its scores: what each player did, his stats in
// the matches being played, and their moments.
const liveDetail = () => JSON.stringify([live?.feed.events, live?.feed.matches, live?.feed.moments]);

export async function pollLive() {
  clearTimeout(liveTimer);
  if (!LIVE_URL || isArchive() || !isLive()) return;
  if (!document.hidden) {
    try {
      const res = await fetch(`${LIVE_URL}/live/${D.meta.currentGw}`, { cache: 'no-store' });
      if (res.ok) {
        const [scores, detail] = [liveScores(), liveDetail()];
        applyLive(await res.json());
        if (liveScores() !== scores) withRowMoves(renderView);
        else if (liveDetail() !== detail) renderView();
      }
    } catch {
      // Keep the last scores; data.json still refreshes on its own.
    }
    await refreshInPlay();
  }
  const playing = live?.feed.fixtures.some((f) => f.started && !f.done);
  liveTimer = setTimeout(pollLive, playing ? LIVE_POLL_MS : LIVE_IDLE_MS);
}

// Checked before the relay's owners are merged in, which makes them match.
const ownersAhead = (slim: SlimTransfers) =>
  Object.keys(slim.owners).length > 0 && Object.entries(D.players).some(([pid, p]) => (slim.owners[pid] ?? null) !== p.owner);

// Moves made since data.json was built, so the feed and "Who owns…?" keep up between builds.
export function applyLatestTransfers() {
  return latestTransfers && !isArchive() ? mergeTransfers(D, latestTransfers) : false;
}

export async function pollTransfers() {
  clearTimeout(transfersTimer);
  if (!LIVE_URL || isArchive()) return;
  if (!document.hidden) {
    try {
      const res = await fetch(`${LIVE_URL}/transfers`, { cache: 'no-store' });
      if (res.ok) {
        latestTransfers = (await res.json()) as SlimTransfers;
        if (!behind && ownersAhead(latestTransfers)) {
          behind = true;
          scheduleRefresh();
        }
        if (applyLatestTransfers()) renderView();
      }
    } catch {
      // The next build brings them anyway.
    }
  }
  transfersTimer = setTimeout(pollTransfers, TRANSFERS_POLL_MS);
}

export function scheduleRefresh() {
  clearTimeout(refreshTimer);
  if (isArchive()) return; // archived seasons never change
  refreshTimer = setTimeout(
    async () => {
      await refresh();
      scheduleRefresh();
    },
    isLive() || behind ? LIVE_REFRESH_MS : REFRESH_MS,
  );
}

export async function refresh() {
  if (document.hidden || isArchive() || Date.now() - lastFetch < 60 * 1000) return;
  try {
    if (await loadData()) {
      applyLatestLive();
      behind = latestTransfers !== null && ownersAhead(latestTransfers);
      applyLatestTransfers();
      renderAll();
      pollLive();
    }
  } catch {
    // Keep showing the data we already have.
  }
}
