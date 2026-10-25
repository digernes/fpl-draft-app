// A draft team's Stats tab: the season's numbers in tiles, who has scored the team's points
// and the points left on the bench.

import { card, crest, empty, listRow, photo, tile } from '../components.ts';
import { esc, plural, signed, sum } from '../format.ts';
import { first, gwPoints, lineupFor, player, seasonStat } from '../lookups.ts';
import { closeCalls, gameIn } from '../manager-stats.ts';
import { href } from '../router.ts';
import { D } from '../state.ts';
import { playerWho, resultOf } from './team-overview.ts';
import { xiRecord } from './team-squad.ts';

const VERBS = { W: 'Won', L: 'Lost', D: 'Drew' };

export function seasonCard(id: number) {
  const s = seasonStat(id);
  if (!s?.high || !s.low) return '';
  const weeks = Object.keys(D.lineups[id] ?? {}).length;
  const tiles = [
    tile('Best gameweek', s.high.pts, gameweekResult(id, s.high.gw)),
    tile('Worst gameweek', s.low.pts, gameweekResult(id, s.low.gw)),
    s.mvp && tile('Top scorer', playerWho(s.mvp.player), `${s.mvp.pts} pts in your XI`),
    tile('On the bench', s.bench, weeks ? `${Math.round(s.bench / weeks)} a week left out` : ''),
    ...closeCallTiles(id),
    tile('Longest winning run', s.streak.bestWin, s.streak.current ? `Current run ${s.streak.current}` : ''),
    transfersTile(id),
  ].filter(Boolean);
  return card({ title: 'Season', body: `<div class="tiles">${tiles.join('')}</div>` });
}

function gameweekResult(id: number, gw: number) {
  const g = gameIn(D, id, gw);
  if (!g) return `GW ${gw}`;
  return `${VERBS[resultOf(g.pf, g.pa)]} ${g.pf}-${g.pa} vs ${first(g.opp)} · GW ${gw}`;
}

// The highest score that lost and the lowest that won.
function closeCallTiles(id: number) {
  const { bestDefeat, worstWin } = closeCalls(D, id);
  return [
    bestDefeat &&
      tile('Best losing score', bestDefeat.pf, `Lost ${bestDefeat.pf}-${bestDefeat.pa} to ${first(bestDefeat.opp)} · GW ${bestDefeat.gw}`),
    worstWin && tile('Worst winning score', worstWin.pf, `Beat ${first(worstWin.opp)} ${worstWin.pf}-${worstWin.pa} · GW ${worstWin.gw}`),
  ];
}

function transfersTile(id: number) {
  const moves = D.transfers.summary.find((t) => t.id === id);
  if (!moves) return '';
  return tile(
    'Transfers',
    moves.moves,
    moves.moves ? `${signed(moves.net)} net points` : 'None yet',
    'Waivers, free agents and trades; net is what came in minus what went out, since each move',
  );
}

// Who has scored the team's points: each player's points in its XI, with starts, goals and assists.
export function scorersCard(id: number) {
  const rows = [...xiRecord(id)]
    .filter(([pid, r]) => player(pid) && r.pts)
    .sort((a, b) => b[1].pts - a[1].pts)
    .map(([pid, r], i) =>
      listRow({
        rank: i + 1,
        lead: `<a href="${href.player(pid)}">${photo(pid)}</a>`,
        title: `<a href="${href.player(pid)}">${esc(player(pid).name)}</a> ${crest(player(pid).club, 14)}`,
        meta: `${plural(r.starts, 'start')} · ${plural(r.goals, 'goal')} · ${plural(r.assists, 'assist')}`,
        value: r.pts,
        top: i === 0,
      }),
    );
  return card({
    title: 'Top scorers',
    sub: 'Points in the XI',
    body: rows.length ? `<div class="list">${rows.join('')}</div>` : empty('No points yet'),
  });
}

// The points each player has scored on the bench, and the automatic substitutions.
export function benchCard(id: number) {
  const bench = new Map<number, { pts: number; weeks: number }>();
  let subs = 0;
  for (let gw = D.meta.firstGw; gw <= D.meta.currentGw; gw++) {
    const l = lineupFor(id, gw);
    subs += l?.subs.length ?? 0;
    for (const pid of l?.bench ?? []) {
      const b = bench.get(pid) ?? { pts: 0, weeks: 0 };
      b.pts += gwPoints(pid, gw);
      b.weeks++;
      bench.set(pid, b);
    }
  }
  const rows = [...bench]
    .filter(([pid, b]) => player(pid) && b.pts > 0)
    .sort((a, b) => b[1].pts - a[1].pts)
    .slice(0, 8)
    .map(([pid, b]) =>
      listRow({
        lead: `<a href="${href.player(pid)}">${photo(pid)}</a>`,
        title: `<a href="${href.player(pid)}">${esc(player(pid).name)}</a>`,
        meta: `${plural(b.weeks, 'week')} on the bench`,
        value: b.pts,
      }),
    );
  const total = sum([...bench.values()].map((b) => b.pts));
  return card({
    title: 'Left on the bench',
    sub: `${total} pts on the bench · ${plural(subs, 'automatic substitution')}`,
    body: rows.length ? `<div class="list">${rows.join('')}</div>` : empty('Nothing on the bench yet'),
  });
}
