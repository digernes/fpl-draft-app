// What the live odds said through each head-to-head being played, for the momentum card's
// win chance: worked out at every build as the page works out its live odds
// (shared/in-play.ts), with the site's own expected points, added to the records the last
// build's data.json had, and put together with those the relay's Worker records every minute
// (worker/in-play.ts), so they grow build by build and stay once the match is over.

import type { Data, InPlayRecord, Match, PlStats } from '../shared/data.ts';
import { mergeRecords, parseRecords, recordKey, recordsNow, withRecord } from '../shared/in-play.ts';
import { seasonSlug } from './output.ts';

/** The Worker's records of a gameweek, by recordKey (fetchRelayed). */
export interface Relayed {
  gw: number;
  records: Record<string, InPlayRecord[]>;
}

const keyOf = (m: Match) => `${m.gw}:${m.home}:${m.away}`;

/**
 * Gives every match the records the last build's data.json had for it (that season's), and
 * each one being played (started, not finished, in the gameweek of the live feed) the live
 * odds now: `now` is the build's clock. Then the Worker's records of its gameweek, where the
 * relay had them, go in with them (mergeRecords).
 */
export function recordInPlay(
  data: Data,
  previous: Partial<Data> | null,
  stats: PlStats | undefined,
  now: number,
  relayed?: Relayed | null,
) {
  const sameSeason = !previous?.meta || previous.meta.season === data.meta.season;
  const kept = new Map(sameSeason ? (previous?.matches ?? []).flatMap((m) => (m.inPlay ? [[keyOf(m), m.inPlay] as const] : [])) : []);
  const gw = data.live?.gw;
  const recorded = data.live
    ? recordsNow(data, data.live, now, (fixture) => (stats && stats.gw === gw ? stats.matches[fixture] : undefined))
    : {};
  for (const m of data.matches) {
    let records = kept.get(keyOf(m));
    const record = m.gw === gw ? recorded[recordKey(m)] : undefined;
    if (record) records = withRecord(records ?? [], record);
    if (relayed?.gw === m.gw) records = mergeRecords(records, relayed.records[recordKey(m)]);
    if (records?.length) m.inPlay = records;
  }
}

/** The relay's answer, in milliseconds: a build doesn't wait on it for long. */
const RELAY_TIMEOUT = 10_000;

/**
 * The Worker's records of the gameweek being played, or of the one the last build's
 * data.json was playing (for the records after that build), from the relay at `relay`; null
 * without one, or when the relay doesn't answer with them (down, not deployed yet, offline),
 * when the build's own records are all there are, as before the Worker kept any.
 */
export async function fetchRelayed(relay: string, data: Data, previous: Partial<Data> | null): Promise<Relayed | null> {
  const sameSeason = !previous?.meta || previous.meta.season === data.meta.season;
  const gw = data.live?.gw ?? (sameSeason ? previous?.live?.gw : undefined);
  if (!relay || gw === undefined) return null;
  try {
    const res = await fetch(`${relay}/in-play/${seasonSlug(data.meta.season)}/${gw}`, { signal: AbortSignal.timeout(RELAY_TIMEOUT) });
    const records = res.ok ? parseRecords(await res.json()) : null;
    return records ? { gw, records } : null;
  } catch {
    return null;
  }
}
