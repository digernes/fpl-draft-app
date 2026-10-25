// The live odds as recorded through a head-to-head, for the momentum card's win chance:
// data.json's (the builds', with what the relay's Worker had recorded by then), and while
// its gameweek is played the relay's own, recorded every minute since (worker/in-play.ts),
// put together as the build puts them together (mergeRecords). The relay is asked only for
// a head-to-head's page of the gameweek being played, at most once a minute: the first time
// the card wants them and again with the live poll. Without it (?relay=off, not deployed,
// failing, an archive) the card has data.json's, as before.

import type { InPlayRecord, Match } from '../shared/data.ts';
import { mergeRecords, parseRecords, recordKey } from '../shared/in-play.ts';
import { isArchive, isLive, seasonSlug } from './lookups.ts';
import { renderView } from './render.ts';
import { D, LIVE_URL, state } from './state.ts';

/** At most this often, in ms. */
export const IN_PLAY_POLL_MS = 60 * 1000;

// The gameweek's records as the relay last answered, and when it was last asked.
let relayed: { season: string; gw: number; records: Record<string, InPlayRecord[]> } | null = null;
let asked: { season: string; gw: number; at: number } | null = null;

/** Forget what the relay said (for the tests). */
export function forgetRelayed() {
  relayed = asked = null;
}

const wanted = (gw: number | undefined) => Boolean(LIVE_URL) && !isArchive() && isLive() && gw === D.meta.currentGw;

/** A head-to-head's records: data.json's, with the relay's while its gameweek is played. */
export function recordsOf(m: Match): InPlayRecord[] | undefined {
  if (!wanted(m.gw)) return m.inPlay;
  void askRelay(m.gw);
  const more = relayed?.season === D.meta.season && relayed.gw === m.gw ? relayed.records[recordKey(m)] : undefined;
  return mergeRecords(m.inPlay, more);
}

/** With the live poll: asks again for the records when a head-to-head of the gameweek being played is open. */
export function refreshInPlay() {
  const { page, gw } = state.route;
  return page === 'match' && wanted(gw) ? askRelay(gw!) : Promise.resolve();
}

// Once a minute at most, a failed answer included; a new set of records redraws the page.
async function askRelay(gw: number, now = Date.now()) {
  const { season } = D.meta;
  if (asked?.season === season && asked.gw === gw && now - asked.at < IN_PLAY_POLL_MS) return;
  asked = { season, gw, at: now };
  let records: Record<string, InPlayRecord[]> | null = null;
  try {
    const res = await fetch(`${LIVE_URL}/in-play/${seasonSlug(season)}/${gw}`, { cache: 'no-store' });
    records = res.ok ? parseRecords(await res.json()) : null;
  } catch {
    // Offline, or a relay without them: data.json's records stay.
  }
  if (!records) return;
  const before = relayed;
  relayed = { season, gw, records };
  if (before?.season !== season || before.gw !== gw || JSON.stringify(before.records) !== JSON.stringify(records)) renderView();
}
