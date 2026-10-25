// The draft league's Overview tab, laid out as fotmob.com's league overview: the table and
// the latest review, then this round's matches, the prize, Manager of the Month, the recent
// transfers and the original squads.

import type { TopGameweek } from '../../shared/data.ts';
import { monthlyAwards } from '../awards.ts';
import { dgwRule, gameweekReviewCard, resultText, squadStrip } from '../cards.ts';
import { avatar, card, empty, infoButton, listRow, teamName } from '../components.ts';
import { esc, plural } from '../format.ts';
import { first, isLive, isSettling, lineupFor } from '../lookups.ts';
import { oddsToggle } from '../match-odds.ts';
import { featuredGw, matchList, roundSubtitle, showsOdds } from '../matches.ts';
import { recentTransfersCard } from '../pages/transfers.ts';
import { href } from '../router.ts';
import { D, state } from '../state.ts';
import { standingsTable, tableModeToggle } from '../league-tables.ts';

export function viewOverview() {
  const reviewGw = D.meta.lastFinishedGw;
  const review = reviewGw
    ? gameweekReviewCard(reviewGw, { limit: 5, footer: { href: href.league('fixtures', reviewGw), label: 'Full review' } })
    : '';
  return `<div class="cols">
    <div class="col">${tableCard()}${review}</div>
    <div class="col">${roundCard()}${gwPrizeCard()}${awardsCard()}${recentTransfersCard()}${retentionMiniCard()}</div>
  </div>`;
}

export function roundCard(gw = featuredGw()) {
  const list = D.matches.filter((m) => m.gw === gw);
  return card({
    title: `Gameweek ${gw}`,
    sub: roundSubtitle(gw, { short: true }),
    action: list.some(showsOdds) ? oddsToggle() : '',
    body: matchList(list),
    footer: { href: href.league('fixtures', gw), label: 'All fixtures' },
  });
}

/** The table; the home page's sidebar has it without the switch and the legend. */
// `compact` on the front page: there, in its narrow column, the Short columns whatever the
// phones' table mode, and while a gameweek is played the live table with a dot for how each
// team's match stands rather than its score.
export function tableCard({ compact = false } = {}) {
  return card({
    title: compact && isLive() && !isSettling() ? 'Live table' : 'Table',
    action: compact ? '' : tableModeToggle('overall'),
    body: standingsTable('overall', { compact }),
    footer: { href: href.league('table'), label: 'Full table' },
  });
}

// Manager of the Month: the month, its manager and the table points they took from it, as
// the prize card has its holder, then the months before. `compact` on the front page.
export function awardsCard({ compact = false } = {}) {
  const months = monthlyAwards(D);
  if (!months.length) return '';
  const [now, ...before] = months;
  const span = (a: (typeof months)[number]) => (a.month.from === a.month.to ? `GW ${a.month.from}` : `GW ${a.month.from}–${a.month.to}`);
  const top = now.managers[0];
  const hero = `<div class="prize">
    ${avatar(top.id, compact ? 32 : 48)}
    <div class="prize-main">
      <div class="prize-label">${esc(now.month.name)}${now.over ? '' : ' so far'}</div>
      <div class="prize-name">${teamName(top.id)}</div>
      <div class="prize-meta">W${top.won} D${top.drawn} L${top.lost} · ${top.pf} points scored</div>
    </div>
    <div class="prize-score"><span>${top.pts}</span><span class="prize-unit">pts</span></div>
  </div>`;
  const earlier = before.map((a) =>
    listRow({
      lead: avatar(a.managers[0].id, 32),
      title: `<strong>${esc(a.month.name)}</strong>`,
      meta: `${teamName(a.managers[0].id)} · ${span(a)} · ${a.managers[0].pf} points scored`,
      value: `${a.managers[0].pts} pts`,
    }),
  );
  return card({
    title: 'Manager of the Month',
    sub: span(now),
    cls: compact ? 'prize-compact' : '',
    action: infoButton('The most table points from the month’s matches, then the most points scored', 'How it is decided'),
    body: `${hero}${
      earlier.length
        ? `<div class="date-head"><span>Earlier</span><span class="muted">${plural(earlier.length, 'month')}</span></div><div class="list">${earlier.join('')}</div>`
        : ''
    }`,
  });
}

// A top gameweek's result and score lead to the head-to-head it was scored in.
function toMatch(g: TopGameweek, html: string, cls = '') {
  const m = D.matches.find((x) => x.gw === g.gw && (x.home === g.id || x.away === g.id));
  const attr = cls ? ` class="${cls}"` : '';
  return m ? `<a${attr} href="${href.match(m)}">${html}</a>` : cls ? `<div${attr}>${html}</div>` : html;
}

/** `compact` on the front page, where the holder shouldn't draw the eye from the matches. */
export function gwPrizeCard({ compact = false } = {}) {
  const title = 'Highest scoring GW';
  const action = infoButton(`Highest gameweek score. Ties go to the earlier week. ${dgwRule()}`, 'Rules');
  const holders = D.topGameweeks.filter((g) => g.rank === 1);
  if (!holders.length) return card({ title, action, body: empty('Up for grabs once the first gameweek finishes') });
  const seasonOver = D.gameweeks.every((g) => g.finished);
  const label = seasonOver ? 'Winner' : holders.length > 1 ? 'Joint holders' : 'Current holder';
  const hero = holders
    .map((g) => {
      const adjusted = g.dgw
        ? `<span class="prize-adj" data-tip="${g.dgw} double-gameweek ${g.dgw === 1 ? 'player' : 'players'} × −${D.meta.dgwPenalty}">${g.pts} − ${g.dgw * D.meta.dgwPenalty}</span>`
        : '';
      return `<div class="prize${g.id === state.myTeam ? ' mine' : ''}">
        ${avatar(g.id, compact ? 32 : 48)}
        <div class="prize-main">
          <div class="prize-label">${label}</div>
          <div class="prize-name"><a href="${href.team(g.id)}">${first(g.id)}</a> <span class="muted">GW ${g.gw}</span></div>
          <div class="prize-meta">${toMatch(g, resultText(g))}</div>
        </div>
        ${toMatch(g, `<span>${g.adj}</span>${adjusted}`, 'prize-score')}
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
    ? `<div class="prize-live">${threats.map((x) => `<span>${avatar(x.id)} ${first(x.id)} is on ${x.l!.adj} in GW ${D.meta.currentGw}, ${isSettling() ? 'provisional' : 'live'}</span>`).join('')}</div>`
    : '';
  const chasers = D.topGameweeks
    .filter((g) => g.rank > 1)
    .slice(0, 3)
    .map((g) =>
      listRow({
        rank: g.rank,
        lead: avatar(g.id, 24),
        title: `${teamName(g.id)} <span class="muted">GW ${g.gw}</span>`,
        meta: toMatch(g, resultText(g)),
        value: toMatch(g, String(g.adj)),
        mine: g.id === state.myTeam,
      }),
    );
  return card({
    title,
    action,
    cls: compact ? 'prize-compact' : '',
    body: `${hero}${live}${chasers.length ? `<div class="date-head"><span>Closest</span></div><div class="list">${chasers.join('')}</div>` : ''}`,
    footer: { href: href.league('stats'), label: 'All top gameweeks' },
  });
}

function retentionMiniCard() {
  const rows = [...D.draft.retention].sort((a, b) => b.kept.length - a.kept.length || b.originalShare - a.originalShare);
  return card({
    title: 'Original squad',
    sub: 'Draft picks still in the squad',
    body: `<div class="list">${rows
      .map((r) => listRow({ lead: avatar(r.id, 24), title: teamName(r.id), meta: squadStrip(r), value: `${r.kept.length}/${r.size}` }))
      .join('')}</div>`,
    footer: { href: href.league('draft'), label: 'Original squads' },
  });
}
