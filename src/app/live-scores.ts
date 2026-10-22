// Loading data.json, refreshing it, and live scores from the relay.

import type { Data, SeasonEntry } from '../shared/data.ts';
import { scoreLineup, type SlimLive } from '../shared/live.ts';
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
  type LiveLineup,
} from './state.ts';
import { withRowMoves } from './table.ts';

let lastFetch = 0;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let liveTimer: ReturnType<typeof setTimeout> | undefined;

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
    const l = D.lineups[m.id]?.[gw];
    if (!l?.picks) continue;
    const scored = scoreLineup(l.picks, feed, (pid) => player(pid) ?? { pos: undefined, club: undefined }, D.meta.formation);
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
  setLive({ gw, feed, lineups, points });
  for (const m of D.matches) {
    if (m.gw !== gw || !m.started || m.finished) continue;
    m.homePts = lineups[m.home]?.pts ?? m.homePts;
    m.awayPts = lineups[m.away]?.pts ?? m.awayPts;
  }
}

const liveScores = () => JSON.stringify(D.matches.filter((m) => m.gw === D.meta.currentGw).map((m) => [m.homePts, m.awayPts]));

export async function pollLive() {
  clearTimeout(liveTimer);
  if (!LIVE_URL || isArchive() || !isLive()) return;
  if (!document.hidden) {
    try {
      const res = await fetch(`${LIVE_URL}/live/${D.meta.currentGw}`, { cache: 'no-store' });
      if (res.ok) {
        const before = liveScores();
        applyLive(await res.json());
        if (liveScores() !== before) withRowMoves(renderView);
      }
    } catch {
      // Keep the last scores; data.json still refreshes on its own.
    }
  }
  const playing = live?.feed.fixtures.some((f) => f.started && !f.done);
  liveTimer = setTimeout(pollLive, playing ? LIVE_POLL_MS : LIVE_IDLE_MS);
}

export function scheduleRefresh() {
  clearTimeout(refreshTimer);
  if (isArchive()) return; // archived seasons never change
  refreshTimer = setTimeout(
    async () => {
      await refresh();
      scheduleRefresh();
    },
    isLive() ? LIVE_REFRESH_MS : REFRESH_MS,
  );
}

export async function refresh() {
  if (document.hidden || isArchive() || Date.now() - lastFetch < 60 * 1000) return;
  try {
    if (await loadData()) {
      if (live?.gw === D.meta.currentGw) applyLive(live.feed);
      renderAll();
      pollLive();
    }
  } catch {
    // Keep showing the data we already have.
  }
}
