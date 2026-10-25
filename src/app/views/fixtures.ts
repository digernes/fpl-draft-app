// The draft league's Fixtures tab: one gameweek's matches, its review and earlier meetings.

import { gameweekReviewCard } from '../cards.ts';
import { avatar, card, gwNav, listRow } from '../components.ts';
import { esc, fmtDay } from '../format.ts';
import { club, first, gwInfo } from '../lookups.ts';
import { oddsToggle } from '../match-odds.ts';
import { deadlineNote, featuredGw, matchList } from '../matches.ts';
import { href } from '../router.ts';
import { D } from '../state.ts';

export function viewFixtures(wanted?: number) {
  const { meta } = D;
  const gw = Math.min(Math.max(wanted ?? featuredGw(), meta.firstGw), meta.lastGw);
  const list = D.matches.filter((m) => m.gw === gw);
  const info = gwInfo(gw);
  const nav = gwNav(gw, meta.firstGw, meta.lastGw, (g) => href.league('fixtures', g), { current: featuredGw() });
  const day = info?.deadline ? fmtDay.format(new Date(info.deadline)) : '';
  const groupHead = `<div class="date-head"><span>${day}</span><span class="muted">${deadlineNote(gw)}</span></div>`;
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
