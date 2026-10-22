// The Fixtures tab: one gameweek's matches, its review and earlier meetings.

import { gameweekReviewCard } from '../cards.ts';
import { avatar, card, listRow } from '../components.ts';
import { esc, fmtDay } from '../format.ts';
import { chevronSvg } from '../icons.ts';
import { club, first, gwInfo } from '../lookups.ts';
import { featuredGw, matchList, oddsToggle, roundSubtitle } from '../matches.ts';
import { D, state } from '../state.ts';

export function viewFixtures() {
  const { meta } = D;
  const gw = Math.min(Math.max(state.gw ?? featuredGw(), meta.firstGw), meta.lastGw);
  state.gw = gw;
  const list = D.matches.filter((m) => m.gw === gw);
  const info = gwInfo(gw);
  const options = D.gameweeks
    .filter((g) => g.id >= meta.firstGw && g.id <= meta.lastGw)
    .map((g) => `<option value="${g.id}"${g.id === gw ? ' selected' : ''}>Gameweek ${g.id}</option>`)
    .join('');
  const nav = `<div class="gw-nav">
    <button type="button" class="icon-btn" data-action="gw" data-value="${gw - 1}" ${gw <= meta.firstGw ? 'disabled' : ''} aria-label="Previous gameweek">${chevronSvg('left')}</button>
    <label class="gw-select"><select data-action="gw-select" aria-label="Gameweek">${options}</select>${chevronSvg('down')}</label>
    <button type="button" class="icon-btn" data-action="gw" data-value="${gw + 1}" ${gw >= meta.lastGw ? 'disabled' : ''} aria-label="Next gameweek">${chevronSvg('right')}</button>
  </div>`;
  const day = info?.deadline ? fmtDay.format(new Date(info.deadline)) : '';
  const groupHead = `<div class="date-head"><span>${day}</span><span class="muted">${roundSubtitle(gw)}</span></div>`;
  const doubles = info?.doubles?.length
    ? `<div class="table-note">Double gameweek for ${info.doubles.map((c) => esc(club(c).name)).join(', ')}</div>`
    : '';
  return `<div class="cols">
    <div class="col">${card({ header: nav, action: list.some((m) => m.odds) ? oddsToggle() : '', body: `${groupHead}${matchList(list)}${doubles}` })}</div>
    <div class="col">${gameweekReviewCard(gw)}${headToHeadCard(gw)}</div>
  </div>`;
}

function headToHeadCard(gw: number) {
  // Every past meeting of this gameweek's pairs, newest first.
  const pairs = D.matches.filter((m) => m.gw === gw);
  const rows = pairs.map((m) => {
    const past = D.matches.filter(
      (x) => x.finished && x.gw !== gw && ((x.home === m.home && x.away === m.away) || (x.home === m.away && x.away === m.home)),
    );
    const wins = (id: number) => past.filter((x) => (x.home === id ? x.homePts! > x.awayPts! : x.awayPts! > x.homePts!)).length;
    const meta = past.length
      ? past.map((x) => `GW ${x.gw}: ${x.home === m.home ? `${x.homePts}-${x.awayPts}` : `${x.awayPts}-${x.homePts}`}`).join(' · ')
      : 'First meeting';
    return listRow({
      lead: `<span class="stack">${avatar(m.home, 24)}${avatar(m.away, 24)}</span>`,
      title: `${first(m.home)} ${wins(m.home)} – ${wins(m.away)} ${first(m.away)}`,
      meta,
    });
  });
  return card({ title: 'Head to head', sub: 'Earlier meetings this season', body: `<div class="list">${rows.join('')}</div>` });
}
