// Every team in the league, in table order with the one the visitor follows first: the
// bottom bar's Teams.

import { avatar, card, formPills } from '../components.ts';
import { esc, ordinal, plural } from '../format.ts';
import { first, mgr } from '../lookups.ts';
import type { PageView } from '../render.ts';
import { href } from '../router.ts';
import { D, state } from '../state.ts';
import { followButton } from './team.ts';

export function pageTeams(): PageView {
  const order = D.tables.overall.length ? D.tables.overall.map((r) => r.id) : D.managers.map((m) => m.id);
  const sorted = [...order].sort((a, b) => Number(b === state.myTeam) - Number(a === state.myTeam));
  const rows = sorted.map((id) => {
    const row = D.tables.overall.find((r) => r.id === id);
    return `<div class="team-row${id === state.myTeam ? ' mine' : ''}">
      <a class="team-link" href="${href.team(id)}">${avatar(id, 40)}<span class="team-text"><span class="team-title">${esc(mgr(id)!.team)}</span><span class="team-meta">${first(id)}${row ? ` · ${ordinal(row.rank)} · ${plural(row.pts, 'pt')}` : ''}</span></span></a>
      ${row ? formPills(row.form) : ''}
      ${followButton(id)}
    </div>`;
  });
  return {
    title: 'Teams',
    body: card({
      title: 'Teams',
      sub: `${esc(D.meta.name)} · ${plural(D.managers.length, 'team')}`,
      body: `<div class="teams-list">${rows.join('')}</div>`,
    }),
  };
}
