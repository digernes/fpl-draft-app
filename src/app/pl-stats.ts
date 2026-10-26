// A Premier League match's player stats, as fotmob.com's at the bottom of a match's Stats
// tab, with the Facts tab's taste of them, and the same for the whole season on the Premier
// League's page: the table is stats-table.ts's, the numbers stats-files.ts's.

import { PL_STATS, type Player, type PlSeasonStats } from '../shared/data.ts';
import { onAction } from './actions.ts';
import { avatar, card, chip, empty, seg, sheet } from './components.ts';
import { esc, plural } from './format.ts';
import { slidersSvg } from './icons.ts';
import { player } from './lookups.ts';
import { renderView } from './render.ts';
import { href } from './router.ts';
import { D, state } from './state.ts';
import { matchUnderlying, seasonFile, statsFor } from './stats-files.ts';
import { COLUMNS, nameOf, photoOf, shown, statsTable, type StatsRow } from './stats-table.ts';

onAction('players-pos', (value) => {
  state.playersPos = value;
  renderView();
});
// One choice of whose players, as the lineup's chips: the chosen one again goes back to everyone.
onAction('players-owner', (value) => {
  state.playersOwner = state.playersOwner === value ? 'all' : value;
  renderView();
});
onAction('players-all', () => {
  state.playersAll = true;
  renderView();
});

const noughts = PL_STATS.map(() => 0);

/** The card, for a match that has kicked off (`rows` empty before then). */
export function playerStatsCard(gw: number, match: number, rows: StatsRow[]) {
  const title = 'Player stats';
  if (!rows.length) return card({ title, body: empty('They come in once the match kicks off') });
  const file = statsFor(gw);
  if (file === 'loading') return card({ title, body: empty('Loading…') });
  if (file === 'missing') return card({ title, body: empty('Not in yet: they come with the next update') });
  const cells = file.matches[match] ?? {};
  const why = (r: StatsRow) =>
    cells[r.pid] ? 'FPL gives it only for the whole gameweek, and he played twice in it' : 'Not in yet: it comes with the next update';
  const cellsOf = (r: StatsRow) => cells[r.pid] ?? (r.unused ? noughts : undefined);
  const withExpected = rows.map((r) => {
    const u = matchUnderlying(r.pid, cellsOf(r), r.min, r.pts);
    return { ...r, xp: u?.xp ?? null, xcs: u?.xcs ?? null };
  });
  return card({ title, body: statsTable(withExpected, cellsOf, why).html, cls: 'ps-card' });
}

/** The Premier League's Player stats tab: everyone who has played this season, as the match's, of one club (the address has it), by position, and the free agents or one manager's alone if wanted. */
export function seasonStatsCard(clubId?: number) {
  const title = 'Player stats';
  const file = seasonFile();
  if (file === 'loading') return card({ title, body: empty('Loading…') });
  if (file === 'missing') return card({ title, body: empty('Not in yet: they come with the next update') });
  const { html, count } = statsTable(
    seasonRows(file, clubId),
    (r) => file.players[r.pid]?.slice(1),
    () => '',
    {
      season: true,
      limit: state.playersAll ? Infinity : SHOWN,
      gws: file.projected?.gws,
    },
  );
  const filters = seasonFilters(clubId);
  return card({
    title,
    sub: `${count} ${count === 1 ? 'player' : 'players'} this season`,
    action: filters.pill,
    body: `${filters.bar}${html}${sheet('ps-sheet', 'Filter', filters.form, `Show ${plural(count, 'player')}`)}`,
    footer:
      count > SHOWN && !state.playersAll
        ? { href: href.pl('players', clubId), label: `Show all ${count}`, attrs: 'data-action="players-all"' }
        : null,
    cls: 'ps-card',
  });
}

export function seasonRows(file: PlSeasonStats, clubId: number | undefined) {
  return Object.entries(file.players).flatMap(([id, row]): StatsRow[] => {
    const p = player(Number(id));
    if (!p || !filteredIn(p, clubId)) return [];
    const [xp = null, xcs = null] = row.slice(1 + PL_STATS.length);
    return [{ pid: Number(id), club: p.club, min: row[0] ?? 0, pts: p.total, owner: p.owner, xp, xcs, ahead: aheadOf(file, id) }];
  });
}

// The address's club, the position chosen and, if asked, the free agents or one manager's alone.
function filteredIn(p: Player, clubId: number | undefined) {
  if (clubId !== undefined && p.club !== clubId) return false;
  if (state.playersPos !== 'all' && p.pos !== state.playersPos) return false;
  const owner = state.playersOwner;
  return owner === 'all' || p.owner === (owner === 'free' ? null : Number(owner));
}

const POSITIONS: [string, string][] = [
  ['all', 'All'],
  ['GKP', 'GK'],
  ['DEF', 'DEF'],
  ['MID', 'MID'],
  ['FWD', 'FWD'],
];

// The filters above the table: the club and the position on a line, whose players on one
// under it; on one column, as the Transfer center's, in a sheet behind a pill at the card's
// top right, saying how many are on, and the categories left on the card.
function seasonFilters(clubId: number | undefined) {
  const positions = seg('players-pos', POSITIONS, state.playersPos);
  const owners = ownerChips();
  const on = Number(clubId !== undefined) + Number(state.playersPos !== 'all') + Number(state.playersOwner !== 'all');
  return {
    bar: `<div class="ps-filters"><div class="ps-filter-row">${clubPicker(clubId, ' ps-club')}${positions}</div><div class="ps-filter-row">${owners}</div></div>`,
    pill: `<button type="button" class="tc-edit" data-action="sheet-open" data-value="ps-sheet">Filter${on ? ` · ${on}` : ''}${slidersSvg}</button>`,
    form: `<div class="tc-filter">
      <label class="tc-label">Club${clubPicker(clubId)}</label>
      <div class="tc-label">Position</div>${positions}
      <div class="tc-label">Players</div><div class="ps-owners">${owners}</div>
    </div>`,
  };
}

// Everyone, the free agents or a manager's squad: one choice, as a player is one or the
// other. A manager's chip has their avatar, as elsewhere, whose tip names their team too.
function ownerChips() {
  const chosen = (value: string) => state.playersOwner === value;
  return [
    chip('All players', 'players-owner', 'all', chosen('all')),
    chip('Free agents', 'players-owner', 'free', chosen('free')),
    ...D.managers.map((m) =>
      chip(
        `${avatar(m.id, 20)}<span>${esc(m.first)}</span>`,
        'players-owner',
        m.id,
        chosen(String(m.id)),
        `aria-label="${esc(m.first)}’s players"`,
      ),
    ),
  ].join('');
}

function clubPicker(clubId: number | undefined, cls = '') {
  const clubs = Object.entries(D.clubs).sort(([, a], [, b]) => a.name.localeCompare(b.name));
  return `<span class="tc-select${cls}"><select data-action="go" aria-label="Club">${[
    `<option value="${href.pl('players')}">All clubs</option>`,
    ...clubs.map(
      ([id, c]) => `<option value="${href.pl('players', Number(id))}"${Number(id) === clubId ? ' selected' : ''}>${esc(c.name)}</option>`,
    ),
  ].join('')}</select></span>`;
}

const SHOWN = 50; // the season's table, until all are asked for

// His projections from the season's file: each gameweek's points, then the rest.
function aheadOf(file: PlSeasonStats, id: string): StatsRow['ahead'] {
  const [n, row] = [file.projected?.gws.length ?? 0, file.projected?.players[id]];
  if (!row) return undefined;
  const [minutes, goals, assists, cleanSheet, defcon, bonus] = row.slice(n);
  return { points: row.slice(0, n), minutes, goals, assists, cleanSheet, defcon, bonus, parts: file.projected?.parts?.[id] };
}

// The Facts tab's taste of them, above the lineups: who led the way on each of a few, as
// fotmob.com's top stats lead to its Stats tab.
const LEADS: [key: string, label: string][] = [
  ['points', 'Most points'],
  ['goalsAssists', 'Most goals and assists'],
  ['xgXa', 'Most xG and xA'],
  ['bps', 'Top of the BPS'],
  ['defcon', 'Most defensive contributions'],
  ['saves', 'Most saves'],
];

/** For a match that has kicked off; `all` is the link to the Player stats tab. */
export function playerLeadsCard(gw: number, match: number, rows: StatsRow[], all: string) {
  const played = rows.filter((r) => !r.unused);
  if (!played.length) return '';
  const title = 'Player stats';
  const footer = { href: all, label: 'All player stats' };
  const file = statsFor(gw);
  if (file === 'loading') return card({ title, body: empty('Loading…'), footer });
  if (file === 'missing') return card({ title, body: empty('Not in yet: they come with the next update'), footer });
  const cells = file.matches[match] ?? {};
  const items = LEADS.flatMap(([key, label]) => {
    const best = played
      .map((r) => ({ r, v: COLUMNS[key].value(r, cells[r.pid]) }))
      .filter((x): x is { r: StatsRow; v: number } => x.v !== null && x.v > 0)
      .sort((a, b) => b.v - a.v || b.r.pts - a.r.pts)[0];
    if (!best) return [];
    const { r, v } = best;
    return [
      `<a class="ps-lead" href="${href.player(r.pid)}"><span class="ps-lead-label">${label}</span><span class="ps-lead-who">${photoOf(r, 24)}${nameOf(r)}<span class="ps-lead-value">${shown(COLUMNS[key], r, cells[r.pid], v)}</span></span></a>`,
    ];
  });
  return items.length ? card({ title, body: `<div class="ps-leads">${items.join('')}</div>`, footer }) : '';
}
