// The league header and the current tab.

import { markLoadingPhotos } from './components.ts';
import { esc, countdown, fmtShortDay, fmtStamp, fmtTime, plural } from './format.ts';
import { chevronSvg, trophySvg } from './icons.ts';
import { isArchive, isLive, seasonLabel, seasonSlug } from './lookups.ts';
import { D, seasons, state, TABS } from './state.ts';
import { viewDraft } from './views/draft.ts';
import { viewFixtures } from './views/fixtures.ts';
import { viewOverview } from './views/overview.ts';
import { viewSquads } from './views/squads.ts';
import { viewStats } from './views/stats.ts';
import { viewTable } from './views/table.ts';
import { viewTransfers } from './views/transfers.ts';

// Between rounds the waiver run comes first, then the deadline; during a live
// gameweek the live chip replaces the deadline.
export function statusChips() {
  const { meta } = D;
  const at = (iso: string) => `${fmtShortDay.format(new Date(iso))}, ${fmtTime.format(new Date(iso))}`;
  const waivers = meta.nextWaivers && countdown(meta.nextWaivers);
  const deadline = meta.nextDeadline && countdown(meta.nextDeadline);
  return [
    isLive() && `<span class="status-chip live"><i></i>Live · GW ${meta.currentGw}</span>`,
    waivers &&
      `<span class="status-chip" data-tip="GW ${meta.nextGw} waivers process ${at(meta.nextWaivers!)}">Waivers in <strong>${waivers}</strong></span>`,
    !isLive() &&
      deadline &&
      `<span class="status-chip" data-tip="GW ${meta.nextGw} deadline ${at(meta.nextDeadline!)}">GW ${meta.nextGw} deadline in <strong>${deadline}</strong></span>`,
  ]
    .filter(Boolean)
    .join('');
}

function leagueHeader() {
  const { meta } = D;
  return `<section class="league-header">
    <div class="poster">
      <div class="league-logo">${trophySvg}</div>
      <div class="poster-text">
        <h1 class="league-name">${esc(meta.name)}</h1>
        <div class="league-sub">Premier League Draft · ${plural(D.managers.length, 'manager')}${isArchive() ? ' · final standings' : ''}</div>
      </div>
      <div class="poster-side">${statusChips()}${seasonChip()}</div>
    </div>
    <nav class="tabs" role="tablist">
      ${TABS.map((t) => `<a class="tab" role="tab" href="#${t.id}" data-tab="${t.id}" aria-selected="${state.tab === t.id}">${t.label}</a>`).join('')}
      <span class="tab-indicator"></span>
    </nav>
  </section>`;
}

// FotMob's season chip; it turns into a picker once there is more than one season.
export function seasonChip() {
  if (seasons.length < 2) return `<span class="season-chip">${seasonLabel(D.meta.season)}</span>`;
  const options = seasons
    .map(
      (s) =>
        `<option value="${esc(seasonSlug(s.season))}"${s.season === D.meta.season ? ' selected' : ''}>${seasonLabel(s.season)}</option>`,
    )
    .join('');
  return `<label class="season-chip season-select"><select data-action="season" aria-label="Season">${options}</select>${chevronSvg('down')}</label>`;
}

export function renderAll() {
  document.getElementById('app')!.innerHTML = `${leagueHeader()}<div class="view" id="view"></div>`;
  document.getElementById('updated')!.textContent = `Updated ${fmtStamp.format(new Date(D.meta.generatedAt!))}`;
  renderView();
}

export function renderView() {
  const views: Record<string, () => string> = {
    overview: viewOverview,
    table: viewTable,
    fixtures: viewFixtures,
    squads: viewSquads,
    stats: viewStats,
    transfers: viewTransfers,
    draft: viewDraft,
  };
  for (const tab of document.querySelectorAll<HTMLElement>('.tab'))
    tab.setAttribute('aria-selected', String(tab.dataset.tab === state.tab));
  const view = document.getElementById('view')!;
  view.innerHTML = views[state.tab]();
  markLoadingPhotos(view);
  revealPickedChips();
  document.title = state.tab === 'overview' ? D.meta.name : `${TABS.find((t) => t.id === state.tab)!.label} · ${D.meta.name}`;
  placeTabIndicator();
  syncSettings();
}

// A re-render starts the filter bars scrolled back to the left, which on a phone can
// hide the chip that is picked (say, the Squads tab opened from the last row of the table).
function revealPickedChips() {
  for (const bar of document.querySelectorAll<HTMLElement>('#view .filter-bar')) {
    const chip = bar.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!chip) continue;
    const left = chip.getBoundingClientRect().left - bar.getBoundingClientRect().left;
    if (left < 0 || left + chip.offsetWidth > bar.clientWidth) bar.scrollLeft = left - (bar.clientWidth - chip.offsetWidth) / 2;
  }
}

export function placeTabIndicator() {
  const active = document.querySelector<HTMLElement>('.tab[aria-selected="true"]');
  const bar = document.querySelector<HTMLElement>('.tab-indicator');
  if (!active || !bar) return;
  bar.style.width = `${active.offsetWidth}px`;
  bar.style.left = `${active.offsetLeft}px`;
}

export function syncSettings() {
  for (const button of document.querySelectorAll<HTMLElement>('#settings-menu [data-action]')) {
    button.setAttribute('aria-pressed', String(state[button.dataset.action as keyof typeof state] === button.dataset.value));
  }
}
