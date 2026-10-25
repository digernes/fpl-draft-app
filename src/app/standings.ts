// The draft league's standings from a set of matches, and as they stand while a gameweek
// is played, with the live score, the live dot and the next opponent for its columns.

import type { FormRow, Match, OverallRow, Result } from '../shared/data.ts';
import { avatar } from './components.ts';
import { esc } from './format.ts';
import { first } from './lookups.ts';
import { href } from './router.ts';
import { D } from './state.ts';
import { resultOf } from './table.ts';

interface LiveMatch {
  pf: number;
  pa: number;
  match: Match;
}

// The match being played, as it stands; it opens the match.
export function livePill(live: LiveMatch | undefined) {
  if (!live) return '';
  const res = resultOf(live.pf, live.pa);
  return `<a class="livep ${res}" href="${href.match(live.match)}">${live.pf}-${live.pa}</a>`;
}

// Or just a dot in its colour, as fotmob.com's live table has it, the score and who
// against in its tip.
const STANDING: Record<Result, string> = { W: 'Winning', L: 'Losing', D: 'Level' };

export function liveDot(id: number, live: LiveMatch | undefined) {
  if (!live) return '';
  const res = resultOf(live.pf, live.pa);
  const how = STANDING[res];
  const opp = live.match.home === id ? live.match.away : live.match.home;
  return `<a class="live-res ${res}" href="${href.match(live.match)}" data-tip="${how} ${live.pf}–${live.pa} vs ${esc(first(opp))}"></a>`;
}

// The next opponent, a link to that match.
export function nextLink(r: StandingRow) {
  if (!r.next) return '';
  const m = D.matches.find((x) => x.gw === r.next!.gw && (x.home === r.id || x.away === r.id));
  return m ? `<a href="${href.match(m)}">${avatar(r.next.opp)}</a>` : avatar(r.next.opp);
}

export interface TableFromRow {
  id: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  pf: number;
  pa: number;
  pts: number;
  rank: number;
  liveMatch?: LiveMatch;
}

export type StandingRow = (OverallRow | FormRow) & { liveMatch?: LiveMatch };

// The table as it would stand if every live score ended as it is now (fotmob.com's
// live table): finished matches plus the ones being played.
export function liveStandings(): StandingRow[] {
  const official = new Map(D.tables.overall.map((r) => [r.id, r]));
  return tableFrom(D.matches.filter((x) => x.started)).map((r) => ({ ...official.get(r.id)!, ...r }));
}

// Standings from a set of matches, ranked like the real table: points, then points scored.
export function tableFrom(matches: Match[]): TableFromRow[] {
  const { win, draw, loss } = D.meta.scoring;
  const rows = new Map<number, Omit<TableFromRow, 'rank'>>(
    D.managers.map((m) => [m.id, { id: m.id, played: 0, won: 0, drawn: 0, lost: 0, pf: 0, pa: 0, pts: 0 }]),
  );
  for (const m of matches) {
    const sides = [
      [m.home, m.homePts, m.awayPts],
      [m.away, m.awayPts, m.homePts],
    ] as [number, number, number][];
    for (const [id, pf, pa] of sides) {
      const r = rows.get(id);
      if (!r) continue;
      r.played++;
      r.pf += pf;
      r.pa += pa;
      if (pf > pa) [r.won, r.pts] = [r.won + 1, r.pts + win];
      else if (pf === pa) [r.drawn, r.pts] = [r.drawn + 1, r.pts + draw];
      else [r.lost, r.pts] = [r.lost + 1, r.pts + loss];
      if (!m.finished) r.liveMatch = { pf, pa, match: m };
    }
  }
  return [...rows.values()].sort((a, b) => b.pts - a.pts || b.pf - a.pf).map((r, i) => ({ ...r, rank: i + 1 }));
}
