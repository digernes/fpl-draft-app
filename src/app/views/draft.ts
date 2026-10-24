// The Draft tab: original squads, the draft board, steals, busts and hauls.

import type { DraftPick } from '../../shared/data.ts';
import { onAction } from '../actions.ts';
import { squadStrip } from '../cards.ts';
import { avatar, card, crest, listRow, playerName, playerPhoto, tag, teamName } from '../components.ts';
import { esc, pct } from '../format.ts';
import { caretSvg } from '../icons.ts';
import { club, first, mgr, player, slotOf } from '../lookups.ts';
import { renderView } from '../render.ts';
import { href } from '../router.ts';
import { D, state } from '../state.ts';

onAction('squad', (value) => {
  state.openSquad = state.openSquad === value ? null : value;
  renderView();
});

export function viewDraft() {
  return `${originalSquadCard()}${draftBoardCard()}
  <div class="cols cols-even">
    <div class="col">${draftListCard('Steals', 'Second-half picks who have scored the most', stealPicks())}</div>
    <div class="col">${draftListCard('Busts', 'First three rounds, fewest points', bustPicks(), { highlight: false })}${draftHaulCard()}</div>
  </div>`;
}

function originalSquadCard() {
  const rows = [...D.draft.retention].sort((a, b) => b.kept.length - a.kept.length || b.originalShare - a.originalShare);
  const labels = D.gameweeks.filter((g) => g.id >= D.meta.firstGw && g.id <= D.meta.currentGw).map((g) => `GW ${g.id}`);
  const body = rows
    .map((r) => {
      const open = state.openSquad === String(r.id);
      const values = [...r.byGw, r.kept.length];
      const playerChip = (pid: number, owner?: number | null) => {
        const p = player(pid);
        const where = owner === undefined ? '' : owner ? avatar(owner) : tag('FA', 'Free agent now');
        return `<a class="pchip" href="${href.player(pid)}">${crest(p.club, 14)}${esc(p.name)} <span class="muted">${p.total}</span>${where}</a>`;
      };
      const detail = open
        ? `<div class="squad-detail">
            <div><div class="squad-head">Still there · ${r.kept.length}</div><div class="pchips">${r.kept.map((pid) => playerChip(pid)).join('') || '<span class="muted">Nobody</span>'}</div></div>
            <div><div class="squad-head">Gone · ${r.gone.length}</div><div class="pchips">${r.gone.map((g) => playerChip(g.player, g.owner)).join('') || '<span class="muted">Nobody, yet</span>'}</div></div>
            <div><div class="squad-head">Signed since · ${r.newcomers.length}</div><div class="pchips">${r.newcomers.map((pid) => playerChip(pid)).join('') || '<span class="muted">Nobody</span>'}</div></div>
          </div>`
        : '';
      return `<div class="squad-row${open ? ' open' : ''}">
        <button type="button" class="squad-summary" data-action="squad" data-value="${r.id}" aria-expanded="${open}">
          <span class="squad-who">${avatar(r.id, 32)}<span><span class="squad-name">${first(r.id)}</span><span class="squad-team">${esc(mgr(r.id)!.team)}</span></span></span>
          <span class="squad-count"><strong>${r.kept.length}</strong>/${r.size}</span>
          ${squadStrip(r)}
          ${sparkline(values, [...labels, 'Now'], r.size, slotOf(r.id))}
          <span class="squad-share" data-tip="Share of points scored in the XI by original draft picks">${pct(r.originalShare)} <span class="muted">of points</span></span>
          ${caretSvg}
        </button>
        ${detail}
      </div>`;
    })
    .join('');
  return card({
    title: 'Original squad',
    body: `<div class="squads">${body}</div>`,
  });
}

function sparkline(values: number[], labels: string[], max: number, slot: number) {
  const w = 112;
  const h = 32;
  const pad = 5;
  const x = (i: number) => pad + (i * (w - 2 * pad)) / Math.max(1, values.length - 1);
  const y = (v: number) => h - pad - (v / max) * (h - 2 * pad);
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values.length - 1;
  const hits = values
    .map(
      (v, i) =>
        `<rect x="${(x(i) - 6).toFixed(1)}" y="0" width="12" height="${h}" fill="transparent" data-tip="${labels[i]}: ${v} of ${max}"/>`,
    )
    .join('');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Draft picks kept per gameweek">
    <line x1="${pad}" x2="${w - pad}" y1="${y(max)}" y2="${y(max)}" class="spark-grid"/>
    <polyline points="${points}" fill="none" stroke="var(--m${slot})" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(last).toFixed(1)}" cy="${y(values[last]).toFixed(1)}" r="4" fill="var(--m${slot})" stroke="var(--card)" stroke-width="2"/>
    ${hits}
  </svg>`;
}

function draftBoardCard() {
  const picks = D.draft.picks;
  if (!picks.length) return '';
  const order = picks
    .filter((p) => p.round === 1)
    .sort((a, b) => a.pick - b.pick)
    .map((p) => p.manager);
  const rounds = Math.max(...picks.map((p) => p.round));
  const kept = new Map(D.draft.retention.map((r) => [r.id, new Set(r.kept)]));
  const head = `<div class="db-row db-head"><span></span>${order.map((id) => `<span>${avatar(id, 24)}<span class="db-name">${first(id)}</span></span>`).join('')}</div>`;
  const rows = Array.from({ length: rounds }, (_, i) => {
    const round = i + 1;
    const cells = order.map((id) => {
      const pk = picks.find((p) => p.manager === id && p.round === round);
      if (!pk) return '<span class="db-cell"></span>';
      const p = player(pk.player);
      const still = kept.get(id)?.has(pk.player);
      const owner = p.owner && p.owner !== id ? avatar(p.owner) : '';
      const tip = `#${pk.overall} · ${p.full} · ${p.total} pts${still ? '' : p.owner ? ` · now with ${mgr(p.owner)?.first}` : ' · free agent now'}${pk.auto ? ' · auto-pick' : ''}`;
      return `<a class="db-cell pos-${p.pos}${still ? '' : ' gone'}" href="${href.player(pk.player)}" data-tip="${esc(tip)}"><span class="db-player">${esc(p.name)}</span><span class="db-meta">${esc(club(p.club).short)} · ${p.pos} ${owner}</span></a>`;
    });
    return `<div class="db-row"><span class="db-round">${round}</span>${cells.join('')}</div>`;
  }).join('');
  const legend = `<div class="legend">${['GKP', 'DEF', 'MID', 'FWD'].map((pos) => `<span class="legend-item"><i class="pos-${pos}"></i>${pos}</span>`).join('')}<span class="legend-item"><i class="gone-key"></i>No longer with the manager who picked him</span></div>`;
  return card({
    title: 'Draft board',
    body: `<div class="board" style="--managers:${order.length}"><div class="db-grid">${head}${rows}</div></div>${legend}`,
  });
}

function stealPicks() {
  const half = D.draft.picks.length / 2;
  return D.draft.picks
    .filter((p) => p.overall > half)
    .sort((a, b) => player(b.player).total - player(a.player).total)
    .slice(0, 6);
}

function bustPicks() {
  return D.draft.picks
    .filter((p) => p.round <= 3)
    .sort((a, b) => player(a.player).total - player(b.player).total)
    .slice(0, 6);
}

function draftListCard(title: string, sub: string, picks: DraftPick[], { highlight = true } = {}) {
  const rows = picks.map((pk, i) => {
    const p = player(pk.player);
    return listRow({
      lead: playerPhoto(pk.player),
      title: `${playerName(pk.player)} ${crest(p.club, 14)}`,
      meta: `Round ${pk.round}, pick ${pk.overall} · ${teamName(pk.manager)}`,
      value: p.total,
      top: highlight && i === 0,
    });
  });
  return card({ title, sub, body: `<div class="list">${rows.join('')}</div>` });
}

function draftHaulCard() {
  const rows = [...D.draft.retention].sort((a, b) => b.draftHaul - a.draftHaul);
  return card({
    title: 'Draft haul',
    sub: 'Season points of everyone each manager drafted, kept or not',
    body: `<div class="list">${rows.map((r, i) => listRow({ rank: i + 1, lead: avatar(r.id, 24), title: teamName(r.id), value: r.draftHaul, top: i === 0 })).join('')}</div>`,
  });
}
