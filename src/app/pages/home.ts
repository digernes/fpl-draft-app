// The home page, as fotmob.com's front page: the round in the middle (the draft league's
// head-to-heads, then the Premier League's matches), the leagues (with the team followed)
// and the prize on the left, and on the right the next deadline, the table, the recent
// transfers and the monthly awards. Phones get the sidebars under the round.

import { avatar, card, gwNav } from '../components.ts';
import { countdown, esc, fmtShortDay, fmtTime, ordinal } from '../format.ts';
import { leagueSvg, premierLeagueSvg, shirtSvg } from '../icons.ts';
import { first, isArchive, mgr } from '../lookups.ts';
import { featuredGw, matchList, oddsToggle, roundSubtitle } from '../matches.ts';
import { plRound, plRoundList } from '../pl.ts';
import type { PageView } from '../render.ts';
import { href, type Route } from '../router.ts';
import { D, state } from '../state.ts';
import { awardsCard, gwPrizeCard, tableCard } from '../views/overview.ts';
import { recentTransfersCard } from './transfers.ts';

export function pageHome(route: Route): PageView {
  const { meta } = D;
  const gw = Math.min(Math.max(route.gw ?? featuredGw(), meta.firstGw), meta.lastGw);
  const nav = card({
    header: `<div class="round-nav">${gwNav(gw, meta.firstGw, meta.lastGw, href.home, { current: featuredGw() })}</div>`,
    body: `<div class="round-sub"><span>${roundSubtitle(gw) || '&nbsp;'}</span>${D.matches.some((m) => m.gw === gw && m.odds) ? oddsToggle() : ''}</div>`,
    cls: 'round-card',
  });
  return {
    body: `<div class="front">
      <div class="front-main">${nav}${draftGroup(gw)}${plGroup(gw)}</div>
      <aside class="front-right">${deadlineCard()}${tableCard({ compact: true })}${recentTransfersCard()}${awardsCard()}</aside>
      <aside class="front-left">${leaguesCard()}${gwPrizeCard()}</aside>
    </div>`,
  };
}

// A league's group of matches, as on fotmob.com's front page: its name, then the matches.
const groupHead = (icon: string, name: string, to: string, note = '') =>
  `<a class="group-head" href="${to}"><span class="group-icon">${icon}</span><span class="group-name">${name}</span>${note ? `<span class="group-note">${note}</span>` : ''}</a>`;

function draftGroup(gw: number) {
  const list = D.matches.filter((m) => m.gw === gw);
  return card({
    header: groupHead(leagueSvg, esc(D.meta.name), href.league(), `Gameweek ${gw}`),
    body: matchList(list),
    cls: 'match-group',
  });
}

// The round's real matches, day by day.
function plGroup(gw: number) {
  if (!plRound(gw).length) return '';
  return card({
    header: groupHead(premierLeagueSvg, 'Premier League', href.pl('fixtures', gw), `Round ${gw}`),
    body: plRoundList(gw),
    cls: 'match-group',
  });
}

// The next of the gameweek's deadlines, whichever comes first: waivers or the gameweek's
// own, both in its tip. (Trades are rare enough to leave out.)
function deadlineCard() {
  const { meta } = D;
  if (isArchive() || !meta.nextDeadline) return '';
  const at = (iso: string) => `${fmtShortDay.format(new Date(iso))}, ${fmtTime.format(new Date(iso))}`;
  const all = (
    [
      [`Waivers for gameweek ${meta.nextGw}`, meta.nextWaivers],
      [`Gameweek ${meta.nextGw}`, meta.nextDeadline],
    ] as [string, string | null][]
  ).filter((d): d is [string, string] => Boolean(d[1]));
  const next = all.find(([, iso]) => countdown(iso)) ?? all.at(-1)!;
  const tip = all.map(([what, iso]) => `${what}: ${at(iso)}`).join('\n');
  return card({
    body: `<div class="deadline">
      <div class="deadline-main"><span>Next deadline</span><strong class="countdown">${countdown(next[1]) ?? 'Passed'}</strong></div>
      <div class="deadline-sub" data-tip="${esc(tip)}">${next[0]} · ${at(next[1])}</div>
    </div>`,
  });
}

// The leagues, then the team followed, or the way to all of them and how to follow one.
function leaguesCard() {
  const row = (icon: string, name: string, to: string) =>
    `<a class="side-link" href="${to}"><span class="group-icon">${icon}</span><span>${name}</span></a>`;
  const id = state.myTeam !== null && mgr(state.myTeam) ? state.myTeam : null;
  const standing = id === null ? undefined : D.tables.overall.find((r) => r.id === id);
  const team =
    id === null
      ? `${row(shirtSvg, 'All teams', href.teams())}<p class="side-hint">Follow your team from its page to keep it here.</p>`
      : `<a class="side-link" href="${href.team(id)}">${avatar(id, 24)}<span class="side-link-text"><span>${esc(mgr(id)!.team)}</span><span class="muted">${first(id)}${standing ? ` · ${ordinal(standing.rank)}` : ''}</span></span>${standing ? `<span class="side-link-value">${standing.pts}</span>` : ''}</a>`;
  return card({
    title: 'Leagues',
    body: `<div class="side-links">${row(leagueSvg, esc(D.meta.name), href.league())}${row(premierLeagueSvg, 'Premier League', href.pl())}</div>
      <div class="card-header side-head"><div class="card-title">Your team</div></div><div class="side-links">${team}</div>`,
  });
}
