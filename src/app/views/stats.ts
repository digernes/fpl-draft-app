// The Stats tab: records, top and worst gameweeks, the heatmap and season leaders.

import type { Decided } from '../../shared/data.ts';
import { resultText } from '../cards.ts';
import { avatar, card, crest, empty, listRow, photo, tag } from '../components.ts';
import { esc } from '../format.ts';
import { first, mgr, player, seasonStat } from '../lookups.ts';
import { D } from '../state.ts';

const HEAT_STEPS = [35, 45, 55, 65]; // gameweek score bands for the heatmap

export function viewStats() {
  return `${recordsCard()}
  <div class="cols">
    <div class="col">${topGameweeksCard(D.topGameweeks.length)}${heatmapCard()}</div>
    <div class="col">${mvpCard()}${worstGameweeksCard()}${benchCard()}</div>
  </div>`;
}

function topGameweeksCard(limit: number) {
  const list = D.topGameweeks.slice(0, limit);
  if (!list.length) return card({ title: 'Top gameweeks', body: empty('No finished gameweeks yet') });
  const rows = list.map((g, i) => {
    const result = resultText(g);
    const star = g.star ? `${esc(player(g.star.player).name)} ${g.star.pts}` : '';
    const best = g.guaranteed ? tag('Best GW', `${mgr(g.id)!.first}’s best week, included so every manager makes the list`) : '';
    const prize = g.rank === 1 ? tag('Prize', 'Holds the highest-gameweek prize', 'tag-prize') : '';
    const penalty = g.dgw
      ? `<span class="lrow-sub" data-tip="${g.dgw} double-gameweek ${g.dgw === 1 ? 'player' : 'players'} × −${D.meta.dgwPenalty}">${g.pts} − ${g.dgw * D.meta.dgwPenalty}</span>`
      : '';
    return listRow({
      rank: g.rank,
      lead: avatar(g.id, 32),
      title: `${first(g.id)} <span class="muted">GW ${g.gw}</span>${prize}${best}`,
      meta: [result, star].filter(Boolean).join(' · '),
      value: `${g.adj}${penalty}`,
      top: i === 0,
    });
  });
  return card({
    title: 'Top gameweeks',
    sub: `−${D.meta.dgwPenalty} per double-gameweek player in the XI · earlier week wins a tie · every manager included`,
    body: `<div class="list">${rows.join('')}</div>`,
    footer: limit < D.topGameweeks.length ? { href: '#stats', label: 'All top gameweeks' } : null,
  });
}

function recordsCard() {
  const r = D.records;
  const tile = (label: string, value: string | number, meta: string, tip = '') =>
    `<div class="tile"${tip ? ` data-tip="${esc(tip)}"` : ''}><div class="tile-label">${label}</div><div class="tile-value">${value}</div><div class="tile-meta">${meta}</div></div>`;
  const match = (d: Decided) => `${first(d.winner)} ${d.winPts}-${d.losePts} ${first(d.loser)} · GW ${d.gw}`;
  const tiles = [
    r.highest && tile('Highest score', r.highest.pts, `${first(r.highest.id)} · GW ${r.highest.gw}`),
    r.lowest && tile('Lowest score', r.lowest.pts, `${first(r.lowest.id)} · GW ${r.lowest.gw}`),
    r.biggestWin && tile('Biggest win', `+${r.biggestWin.margin}`, match(r.biggestWin)),
    r.narrowestWin && tile('Narrowest win', `+${r.narrowestWin.margin}`, match(r.narrowestWin)),
    r.unluckiest &&
      tile(
        'Best losing score',
        r.unluckiest.losePts,
        `${first(r.unluckiest.loser)} lost to ${first(r.unluckiest.winner)} · GW ${r.unluckiest.gw}`,
      ),
    r.luckiest &&
      tile('Worst winning score', r.luckiest.winPts, `${first(r.luckiest.winner)} beat ${first(r.luckiest.loser)} · GW ${r.luckiest.gw}`),
    r.benchMax && tile('Most points on the bench', r.benchMax.pts, `${first(r.benchMax.id)} · GW ${r.benchMax.gw}`),
    r.longestWinRun && tile('Longest winning run', r.longestWinRun.streak.bestWin, first(r.longestWinRun.id)),
    r.draws > 0 && tile('Draws', r.draws, 'Level scores so far'),
  ].filter(Boolean);
  return card({ title: 'Season records', body: `<div class="tiles">${tiles.join('')}</div>` });
}

function heatmapCard() {
  const gws = D.gameweeks.filter((g) => g.finished && g.id >= D.meta.firstGw).map((g) => g.id);
  if (!gws.length) return '';
  const order = D.tables.overall.map((r) => r.id);
  const scoreOf = (id: number, gw: number) => D.lineups[id]?.[gw]?.pts;
  const best = Object.fromEntries(gws.map((gw) => [gw, Math.max(...order.map((id) => scoreOf(id, gw) ?? -Infinity))]));
  const band = (pts: number) => HEAT_STEPS.filter((step) => pts >= step).length;
  const head = `<div class="hm-row hm-head"><span></span>${gws.map((gw) => `<span>${gw}</span>`).join('')}<span>Avg</span></div>`;
  const rows = order.map((id) => {
    const cells = gws.map((gw) => {
      const pts = scoreOf(id, gw);
      if (pts == null) return '<span class="hm-cell">–</span>';
      const top = pts === best[gw];
      return `<span class="hm-cell h${band(pts)}${top ? ' best' : ''}" data-tip="${first(id)} · GW ${gw}: ${pts}${top ? ' (week’s best)' : ''}">${pts}</span>`;
    });
    return `<div class="hm-row"><span class="hm-who">${avatar(id)}<span>${first(id)}</span></span>${cells.join('')}<span class="hm-avg">${seasonStat(id)!.avg}</span></div>`;
  });
  const labels = [`<${HEAT_STEPS[0]}`, ...HEAT_STEPS.slice(0, -1).map((s, i) => `${s}–${HEAT_STEPS[i + 1] - 1}`), `${HEAT_STEPS.at(-1)}+`];
  const legend = `<div class="legend">${labels.map((l, i) => `<span class="legend-item"><i class="h${i}"></i>${l}</span>`).join('')}<span class="legend-item"><i class="best-key"></i>Week’s best</span></div>`;
  return card({
    title: 'Points per gameweek',
    body: `<div class="heatmap" style="--gws:${gws.length}"><div class="hm-grid">${head}${rows.join('')}</div></div>${legend}`,
  });
}

function mvpCard() {
  const rows = [...D.seasonStats].filter((s) => s.mvp).sort((a, b) => b.mvp!.pts - a.mvp!.pts);
  return card({
    title: 'Most valuable players',
    sub: 'Most points scored in each manager’s XI',
    body: `<div class="list">${rows
      .map((s, i) => {
        const p = player(s.mvp!.player);
        return listRow({
          lead: photo(s.mvp!.player),
          title: `${esc(p.name)} ${crest(p.club, 14)}`,
          meta: `For ${first(s.id)} · ${p.pos}`,
          value: s.mvp!.pts,
          top: i === 0,
        });
      })
      .join('')}</div>`,
  });
}

function worstGameweeksCard() {
  return card({
    title: 'Worst gameweeks',
    body: `<div class="list">${D.worstGameweeks
      .map((g, i) =>
        listRow({ rank: i + 1, lead: avatar(g.id, 24), title: `${first(g.id)} <span class="muted">GW ${g.gw}</span>`, value: g.pts }),
      )
      .join('')}</div>`,
  });
}

function benchCard() {
  const rows = [...D.seasonStats].sort((a, b) => b.bench - a.bench);
  return card({
    title: 'Points left on the bench',
    body: `<div class="list">${rows.map((s, i) => listRow({ rank: i + 1, lead: avatar(s.id, 24), title: first(s.id), value: s.bench, top: i === 0 })).join('')}</div>`,
  });
}
