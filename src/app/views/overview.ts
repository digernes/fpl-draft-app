// The Overview tab: this round, the latest review and table, the prize and the market.

import { feed, feedRow, gameweekReviewCard, resultText, squadStrip } from '../cards.ts';
import { avatar, card, empty, listRow } from '../components.ts';
import { esc } from '../format.ts';
import { first, isLive, lineupFor, player } from '../lookups.ts';
import { featuredGw, matchList, oddsToggle, roundSubtitle } from '../matches.ts';
import { D } from '../state.ts';
import { standingsTable, tableModeToggle } from '../table.ts';

export function viewOverview() {
  const reviewGw = D.meta.lastFinishedGw;
  const review = reviewGw
    ? gameweekReviewCard(reviewGw, { limit: 5, footer: { href: `#fixtures/${reviewGw}`, label: 'Full review' } })
    : '';
  return `<div class="cols">
    <div class="col">${roundCard()}${review}${tableCard()}</div>
    <div class="col">${gwPrizeCard()}${latestMovesCard()}${retentionMiniCard()}</div>
  </div>`;
}

function roundCard() {
  const gw = featuredGw();
  const list = D.matches.filter((m) => m.gw === gw);
  return card({
    title: `Gameweek ${gw}`,
    sub: roundSubtitle(gw),
    action: list.some((m) => m.odds) ? oddsToggle() : '',
    body: matchList(list),
    footer: { href: `#fixtures/${gw}`, label: 'All fixtures' },
  });
}

function tableCard() {
  return card({
    title: 'Table',
    action: tableModeToggle('overall'),
    body: standingsTable('overall'),
    footer: { href: '#table', label: 'Full table' },
  });
}

function gwPrizeCard() {
  const title = 'Highest gameweek prize';
  const sub = `Best score after −${D.meta.dgwPenalty} per double-gameweek player · earlier week wins a tie`;
  const holders = D.topGameweeks.filter((g) => g.rank === 1);
  if (!holders.length) return card({ title, sub, body: empty('Up for grabs once the first gameweek finishes') });
  const seasonOver = D.gameweeks.every((g) => g.finished);
  const label = seasonOver ? 'Winner' : holders.length > 1 ? 'Joint holders' : 'Current holder';
  const hero = holders
    .map((g) => {
      const adjusted = g.dgw
        ? `<span class="prize-adj" data-tip="${g.dgw} double-gameweek ${g.dgw === 1 ? 'player' : 'players'} × −${D.meta.dgwPenalty}">${g.pts} − ${g.dgw * D.meta.dgwPenalty}</span>`
        : '';
      const star = g.star ? `${esc(player(g.star.player).name)} ${g.star.pts}` : '';
      return `<div class="prize">
        ${avatar(g.id, 48)}
        <div class="prize-main">
          <div class="prize-label">${label}</div>
          <div class="prize-name">${first(g.id)} <span class="muted">GW ${g.gw}</span></div>
          <div class="prize-meta">${[resultText(g), star].filter(Boolean).join(' · ')}</div>
        </div>
        <div class="prize-score"><span>${g.adj}</span>${adjusted}</div>
      </div>`;
    })
    .join('');
  // Anyone beating the record in a gameweek that is still being played (a tie
  // would lose to the earlier week, so it has to be strictly higher).
  const record = holders[0].adj;
  const threats = isLive()
    ? D.managers.map((m) => ({ id: m.id, l: lineupFor(m.id, D.meta.currentGw) })).filter((x) => x.l && x.l.adj > record)
    : [];
  const live = threats.length
    ? `<div class="prize-live">${threats.map((x) => `<span>${avatar(x.id)} ${first(x.id)} is on ${x.l!.adj} in GW ${D.meta.currentGw}, live</span>`).join('')}</div>`
    : '';
  const chasers = D.topGameweeks
    .filter((g) => g.rank > 1)
    .slice(0, 3)
    .map((g) =>
      listRow({
        rank: g.rank,
        lead: avatar(g.id, 24),
        title: `${first(g.id)} <span class="muted">GW ${g.gw}</span>`,
        meta: resultText(g),
        value: g.adj,
      }),
    );
  return card({
    title,
    sub,
    body: `${hero}${live}${chasers.length ? `<div class="date-head"><span>Chasing</span></div><div class="list">${chasers.join('')}</div>` : ''}`,
    footer: { href: '#stats', label: 'All top gameweeks' },
  });
}

function latestMovesCard() {
  const items = feed().slice(0, 6);
  return card({
    title: 'Latest transfers',
    body: items.length ? `<div class="list">${items.map(feedRow).join('')}</div>` : empty('No transfers yet'),
    footer: { href: '#transfers', label: 'All transfer stats' },
  });
}

function retentionMiniCard() {
  const rows = [...D.draft.retention].sort((a, b) => b.kept.length - a.kept.length || b.originalShare - a.originalShare);
  return card({
    title: 'Original squad',
    sub: 'Draft picks still in the squad',
    body: `<div class="list">${rows
      .map((r) => listRow({ lead: avatar(r.id, 24), title: `${first(r.id)}`, meta: squadStrip(r), value: `${r.kept.length}/${r.size}` }))
      .join('')}</div>`,
    footer: { href: '#draft', label: 'Original squads' },
  });
}
