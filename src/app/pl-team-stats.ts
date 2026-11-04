// The Premier League's Team stats: every club's attack and defence as the expected-points
// model rates them (data.json's clubStrength), and the fixtures ahead as those make them look.

import type { ClubStrength, PlMatch } from '../shared/data.ts';
import { onAction } from './actions.ts';
import { card, clubCell, crest, empty, seg } from './components.ts';
import { esc, ordinal } from './format.ts';
import { sortSvg } from './icons.ts';
import { club } from './lookups.ts';
import { renderView } from './render.ts';
import { href } from './router.ts';
import { D, state } from './state.ts';
import { dataTable, posCol, type Column } from './table.ts';

/** How many gameweeks the fixtures card looks ahead. */
export const FIXTURE_GWS = 5;
// The bands its cells are shaded in: expected goals, and the chance of a clean sheet.
const GOAL_STEPS = [1.1, 1.35, 1.6, 1.85];
const CLEAN_STEPS = [0.2, 0.25, 0.3, 0.35];

onAction('pl-fixtures', (value) => {
  state.plFixtures = value;
  renderView();
});

/** The goals `club` can expect against `opp`. */
export function expectedGoals(s: ClubStrength, club: number, opp: number, home: boolean) {
  return Math.exp(s.base + (home ? s.home : 0) + (s.ratings[club]?.[0] ?? 0) - (s.ratings[opp]?.[1] ?? 0));
}

/** The chance of conceding none when `xga` are expected, with the model's spread. */
export const cleanSheetChance = (s: ClubStrength, xga: number) => (s.size / (s.size + xga)) ** s.size;

/** A club's goals for and against per match, against each of the others home and away. */
export function perMatch(s: ClubStrength, club: number) {
  const others = Object.keys(s.ratings)
    .map(Number)
    .filter((c) => c !== club);
  const mean = (f: (opp: number, home: boolean) => number) =>
    others.reduce((t, opp) => t + f(opp, true) + f(opp, false), 0) / Math.max(1, 2 * others.length);
  return {
    xg: mean((opp, home) => expectedGoals(s, club, opp, home)),
    xga: mean((opp, home) => expectedGoals(s, opp, club, !home)),
  };
}

export function teamStatsTab() {
  const s = D.clubStrength;
  if (!s) return card({ title: 'Team strength', body: empty('The ratings come once the first gameweek has been played.') });
  return strengthCard(s) + fixturesCard(s);
}

type StrengthRow = {
  type: 'club';
  club: number;
  rank: number;
  xg: number;
  xga: number;
  played: number;
  seasonXg: number;
  seasonXga: number;
};

const two = (n: number) => (n < 0 ? `−${(-n).toFixed(2)}` : n.toFixed(2));
const diff = (n: number) => (n > 0 ? `+${two(n)}` : two(Math.abs(n) < 0.005 ? 0 : n));

// The strength table's columns that sort, each best first (`low`: the fewest first).
const STRENGTH: Record<
  string,
  { label: string; tip: string; value: (r: StrengthRow) => number; low?: boolean; from?: 'sm'; text?: (n: number) => string }
> = {
  xg: { label: 'Att', tip: 'Goals it can expect per match against an average side', value: (r) => r.xg },
  xga: { label: 'Def', tip: 'Goals it can expect to concede per match against an average side', value: (r) => r.xga, low: true },
  diff: { label: 'Diff', tip: 'Goals it can expect per match beyond what it concedes', value: (r) => r.xg - r.xga, text: diff },
  seasonXg: { label: 'xG', tip: 'Its xG per match so far this season', value: (r) => r.seasonXg, from: 'sm' },
  seasonXga: { label: 'xGA', tip: 'The xG against it per match so far this season', value: (r) => r.seasonXga, low: true, from: 'sm' },
};

// The sorted column again turns it round; another sorts by that one, best first.
onAction('pl-team-sort', (value) => {
  if (state.plTeamSort === value) state.plTeamFlip = !state.plTeamFlip;
  else [state.plTeamSort, state.plTeamFlip] = [value, false];
  renderView();
});
onAction('pl-fixtures-sort', (value) => {
  if (state.plFixturesSort === value) state.plFixturesFlip = !state.plFixturesFlip;
  else [state.plFixturesSort, state.plFixturesFlip] = [value, false];
  renderView();
});

function sortButton(action: string, key: string, label: string, tip: string, on: boolean, asc: boolean) {
  return `<button type="button" class="th-sort" data-action="${action}" data-value="${key}" aria-pressed="${on}" data-tip="${esc(tip)}">${label}${on ? sortSvg(asc) : ''}</button>`;
}

export function strengthRows(s: ClubStrength): StrengthRow[] {
  return Object.keys(s.ratings)
    .map(Number)
    .map((c) => {
      const [played, xg, xga] = s.season[c] ?? [0, 0, 0];
      return {
        type: 'club' as const,
        club: c,
        rank: 0,
        ...perMatch(s, c),
        played,
        seasonXg: xg / (played || 1),
        seasonXga: xga / (played || 1),
      };
    })
    .sort((a, b) => b.xg - b.xga - (a.xg - a.xga))
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

function strengthCard(s: ClubStrength) {
  const all = strengthRows(s);
  const key = state.plTeamSort in STRENGTH ? state.plTeamSort : 'diff';
  const { value, low } = STRENGTH[key];
  const asc = Boolean(low) !== state.plTeamFlip;
  const rows = [...all]
    .sort((a, b) => (asc ? value(a) - value(b) : value(b) - value(a)) || a.rank - b.rank)
    .map((r, i) => ({ ...r, rank: i + 1 }));
  const cols: Column<StrengthRow>[] = [
    posCol,
    {
      label: '',
      w: 'minmax(0,1fr)',
      cls: 'c-team',
      cell: (r) => `<a class="club-link" href="${href.pl('players', r.club)}">${clubCell(r.club)}</a>`,
    },
    ...Object.entries(STRENGTH).map(([k, c]): Column<StrengthRow> => ({
      label: sortButton('pl-team-sort', k, c.label, c.tip, k === key, asc),
      w: k === 'diff' ? '50px' : '44px',
      from: c.from,
      cls: k === key ? 'c-pts' : undefined,
      cell: (r) => (c.text ?? two)(c.value(r)),
    })),
  ];
  return card({
    title: 'Team strength',
    sub: `Goals per match against an average side, before gameweek ${s.gw}`,
    body:
      `<p class="card-intro">${verdict(all)}</p>` +
      dataTable(cols, rows) +
      '<div class="table-note">Att and Def are what the projections expect, from each club’s xG for and against, recent matches counting more and last season’s early on. xG and xGA are its season so far.</div>',
  });
}

// The table in a sentence or two: the best attack and defence, and the club whose place in
// the real table is furthest from its strength.
export function verdict(rows: StrengthRow[]) {
  const name = (c: number) => esc(club(c).name);
  const top = (f: (r: StrengthRow) => number) => rows.reduce((a, b) => (f(b) > f(a) ? b : a));
  const [att, def] = [top((r) => r.xg), top((r) => -r.xga)];
  const best =
    att === def
      ? `${name(att.club)} score the most and concede the fewest.`
      : `${name(att.club)} score the most, ${name(def.club)} concede the fewest.`;
  const table = new Map((D.tables?.premierLeague ?? []).map((r) => [r.club, r.rank]));
  const gaps = rows.flatMap((r) => (table.has(r.club) ? [{ r, place: table.get(r.club)!, gap: table.get(r.club)! - r.rank }] : []));
  const far = gaps.length ? gaps.reduce((a, b) => (Math.abs(b.gap) > Math.abs(a.gap) ? b : a)) : null;
  // Only once a few matches have been played, when the table says something.
  if (!far || Math.abs(far.gap) < 4 || Math.max(...rows.map((r) => r.played)) < 5) return best;
  const run = far.gap < 0 ? 'their results running ahead of their chances' : 'their results lagging behind their chances';
  return `${best} ${name(far.r.club)} are ${ordinal(far.place)} in the table but ${ordinal(far.r.rank)} on strength, ${run}.`;
}

// Each club's matches in the gameweeks ahead, shaded by the goals it can expect, or its
// chance of a clean sheet, with their sum over those gameweeks: the easiest run first, or
// the easiest in one of them.
function fixturesCard(s: ClubStrength) {
  const gws = [...new Set((D.plMatches ?? []).map((m) => m.gw))].filter((gw) => gw >= s.gw).slice(0, FIXTURE_GWS);
  if (!gws.length) return '';
  const goals = state.plFixtures !== 'clean';
  const steps = goals ? GOAL_STEPS : CLEAN_STEPS;
  const value = (m: PlMatch, c: number) => {
    const home = m.home === c;
    const opp = home ? m.away : m.home;
    return goals ? expectedGoals(s, c, opp, home) : cleanSheetChance(s, expectedGoals(s, opp, c, !home));
  };
  const show = (v: number) => (goals ? v.toFixed(2) : `${Math.round(v * 100)}%`);
  const rows = Object.keys(s.ratings)
    .map(Number)
    .map((c) => {
      const ahead = gws.map((gw) => (D.plMatches ?? []).filter((m) => m.gw === gw && (m.home === c || m.away === c)));
      const sums = ahead.map((ms) => ms.reduce((t, m) => t + value(m, c), 0));
      return { c, ahead, sums, total: sums.reduce((t, v) => t + v, 0) };
    });
  // By the whole run, or one gameweek of it: the most goals, or clean sheets, first.
  const at = gws.indexOf(Number(state.plFixturesSort));
  const by = (r: (typeof rows)[number]) => (at >= 0 ? r.sums[at] : r.total);
  const asc = state.plFixturesFlip;
  rows.sort((a, b) => (asc ? by(a) - by(b) : by(b) - by(a)) || b.total - a.total);
  const heading = (key: string, label: string, tip: string) =>
    sortButton('pl-fixtures-sort', key, label, tip, (at >= 0 ? String(gws[at]) : 'total') === key, asc);
  const cell = (c: number, gw: number, matches: PlMatch[]) => {
    if (!matches.length) return `<span class="hm-cell" data-tip="${esc(club(c).short)} · GW ${gw}: no match">–</span>`;
    const v = matches.reduce((t, m) => t + value(m, c), 0);
    const band = steps.filter((step) => v / matches.length >= step).length;
    const opps = matches.map((m) => (m.home === c ? `${club(m.away).short} (H)` : `${club(m.home).short} (A)`));
    const tip = matches.map((m, i) => `${opps[i]}: ${show(value(m, c))}`).join(' · ');
    return `<span class="hm-cell h${band}" data-tip="${esc(`${club(c).short} · GW ${gw}: ${tip}`)}">${opps.map((o) => `<span>${esc(o)}</span>`).join('')}</span>`;
  };
  const what = goals ? 'the goals it can expect' : 'its chance of a clean sheet';
  const head = `<div class="hm-row hm-head"><span></span>${gws
    .map((gw) => heading(String(gw), `GW ${gw}`, `Sort by ${what} in gameweek ${gw}`))
    .join(
      '',
    )}${heading('total', goals ? 'xG' : 'xCS', goals ? 'The goals it can expect over these gameweeks' : 'The clean sheets it can expect over these gameweeks')}</div>`;
  const body = rows.map(
    (r) =>
      `<div class="hm-row"><a class="hm-who club-link" href="${href.pl('players', r.c)}">${crest(r.c)}<span>${esc(club(r.c).short)}</span></a>${r.ahead
        .map((matches, i) => cell(r.c, gws[i], matches))
        .join('')}<span class="hm-avg">${r.total.toFixed(goals ? 1 : 2)}</span></div>`,
  );
  const labels = [`<${show(steps[0])}`, ...steps.slice(0, -1).map((v, i) => `${show(v)}–${show(steps[i + 1])}`), `${show(steps.at(-1)!)}+`];
  const legend = `<div class="legend">${labels.map((l, i) => `<span class="legend-item"><i class="h${i}"></i>${l}</span>`).join('')}</div>`;
  return card({
    title: 'Fixtures ahead',
    sub: goals ? 'Goals each club can expect in its next matches' : 'Each club’s chance of a clean sheet in its next matches',
    action: seg(
      'pl-fixtures',
      [
        ['goals', 'Goals'],
        ['clean', 'Clean sheets'],
      ],
      goals ? 'goals' : 'clean',
    ),
    body: `<div class="heatmap fixtures-ahead" style="--gws:${gws.length}"><div class="hm-grid">${head}${body.join('')}</div></div>${legend}`,
  });
}
