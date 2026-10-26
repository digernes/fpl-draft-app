// Small components shared across the views.

import type { MatchResult, XpParts } from '../shared/data.ts';
import { onAction } from './actions.ts';
import { esc, figure, ordinal, plural } from './format.ts';
import { caretSvg, chevronSvg, infoSvg, triangleSvg } from './icons.ts';
import { club, mgr, player, slotOf } from './lookups.ts';
import { href } from './router.ts';
import { D } from './state.ts';

// The Premier League keeps photos in two places: newer signings only on the first,
// some older players only on the second.
const photoUrls = (code: number) => [
  `https://resources.premierleague.com/premierleague25/photos/players/40x40/${Number(code)}.png`,
  `https://resources.premierleague.com/premierleague/photos/players/40x40/p${Number(code)}.png`,
];

export function avatar(id: number | null | undefined, size = 18) {
  const m = mgr(id);
  if (!m) return `<span class="av av-${size} m0"></span>`;
  return `<span class="av av-${size} m${slotOf(m.id)}" data-tip="${esc(m.first)} · ${esc(m.team)}" role="img" aria-label="${esc(m.first)}">${esc(m.initials)}</span>`;
}

/** A player's name and his photo, as links to his page; a manager's first name, a link to their team. */
export const playerName = (pid: number) => `<a href="${href.player(pid)}">${esc(player(pid)?.name ?? '?')}</a>`;
export const playerPhoto = (pid: number, size = 32) => `<a class="photo-link" href="${href.player(pid)}">${photo(pid, size)}</a>`;
export const teamName = (id: number) => `<a href="${href.team(id)}">${esc(mgr(id)?.first ?? '?')}</a>`;

export function managerCell(id: number) {
  const m = mgr(id)!;
  return `<span class="who">${avatar(id)}<span class="who-name">${esc(m.first)}</span><span class="who-team">${esc(m.team)}</span></span>`;
}

export function crest(clubId: number, size = 18) {
  const c = club(clubId);
  if (!c) return '';
  return `<img class="crest" src="${esc(c.logo)}" width="${size}" height="${size}" alt="" loading="lazy" data-tip="${esc(c.name)}">`;
}

export function clubCell(clubId: number) {
  const c = club(clubId);
  return `<span class="who">${crest(clubId)}<span class="who-name">${esc(c.name)}</span></span>`;
}

// Behind every photo sits a silhouette in the club's shirt colours, which shows while
// the picture loads and when the Premier League has none (see onPhotoError).
function kitSvg(clubId: number | undefined) {
  const [shirt, trim] = club(clubId)?.kit ?? ['var(--kit-none)', 'var(--kit-none-trim)'];
  return `<svg class="kit" viewBox="0 0 40 40" aria-hidden="true"><circle class="kit-head" cx="20" cy="15" r="7.5"/><path d="M4.5 41c0-8.6 6.2-14.2 15.5-14.2S35.5 32.4 35.5 41Z" fill="${esc(shirt)}" stroke="var(--kit-edge)" stroke-width="1"/><path d="M15.4 27.5 20 32.6l4.6-5.1" fill="none" stroke="${esc(trim)}" stroke-width="2.2" stroke-linejoin="round"/></svg>`;
}

export function photo(pid: number | string, size = 32) {
  const p = player(pid as number);
  const [src, fallback] = p ? photoUrls(p.code) : [];
  const img = p ? `<img src="${src}" data-fallback="${fallback}" alt="" loading="lazy">` : '';
  return `<span class="photo" style="--s:${size}px">${kitSvg(p?.club)}${img}</span>`;
}

// Run on fresh HTML before it is drawn: photos still on their way show the silhouette
// instead of a blank disc (the Premier League's server can be slow). A cached photo is
// complete as soon as it is added, so a re-render doesn't flash it.
export function markLoadingPhotos(root: ParentNode) {
  for (const img of root.querySelectorAll<HTMLImageElement>('.photo img')) if (!img.complete) img.classList.add('loading');
}

// A table's header apart from its rows, so that it can stay under the top bar as the page
// scrolls (a header inside a box that scrolls sideways can't): the header follows the rows
// sideways. Where the browser can tie that to the scroll itself, a scroll-driven animation
// (player-stats.css), it only needs to know how far they go; elsewhere it's moved along on
// every scroll of the rows. Run after each render and resize, and on those scrolls (chrome.ts).
export function alignHeads(root: ParentNode = document) {
  for (const rows of root.querySelectorAll<HTMLElement>('.split-rows')) alignHead(rows);
}

export function alignHead(rows: HTMLElement) {
  const head = rows.previousElementSibling;
  if (!(head instanceof HTMLElement) || !head.matches('.split-head')) return;
  head.style.setProperty('--shift', `${rows.scrollWidth - rows.clientWidth}px`);
  if (!tiedToScroll) head.scrollLeft = rows.scrollLeft;
}

const tiedToScroll = typeof CSS !== 'undefined' && CSS.supports('animation-timeline: --a');

// Points coloured as fotmob.com colours its ratings: red for nothing (or less), orange up to
// 5, green from 6 (a goal, or a defender's clean sheet), and blue for the best in a match once
// it's over (`top` in ptsPill), whatever he scored.
export const pointsTier = (pts: number) => (pts >= 6 ? 'p2' : pts >= 1 ? 'p1' : 'p0');

/**
 * The best in a match by `value`, for the blue, and none when the best is nothing. Of those
 * level, the one ahead by each tiebreak in turn (all of them still level after the last).
 */
export function bestOf(ids: number[], value: (id: number) => number | undefined, ...tiebreaks: ((id: number) => number | undefined)[]) {
  const top = (list: number[], by: (id: number) => number | undefined) => {
    const best = Math.max(...list.map((id) => by(id) ?? -Infinity));
    return best === -Infinity ? list : list.filter((id) => by(id) === best);
  };
  if (!ids.some((id) => (value(id) ?? 0) > 0)) return new Set<number>();
  let level = top(ids, value);
  for (const by of tiebreaks) if (level.length > 1) level = top(level, by);
  return new Set(level);
}

// With bonus points, the way FPL shows them: 10+3 rather than 13. The tip takes them apart
// by where they came from (`from`, stats-files.ts' pointsRows), and while his gameweek is
// played says where they're heading (`projected`).
// The points in a pill's tip: so far and where they're heading while his gameweek is
// played, else just the points, when they're taken apart below.
const pointsSaid = (pts: number, projected: number | undefined, parts: boolean) =>
  projected === undefined ? [parts && plural(pts, 'point')] : [`${plural(pts, 'point')} so far`, `${tenths(projected)} projected`];

export function ptsPill(
  pts: number,
  bonus = 0,
  {
    top = false,
    projected,
    from = [],
    toCome = [],
  }: { top?: boolean; projected?: number; from?: [string, number][]; toCome?: [string, number][] } = {},
) {
  const tip = [...pointsSaid(pts, projected, from.length > 0), top && 'the match’s best'].filter(Boolean).join(' · ');
  const rows = pointsTipRows(from, toCome);
  const attr = tip ? ` data-tip="${tip[0].toUpperCase()}${tip.slice(1)}"${rows ? ` data-tip-rows="${esc(rows)}"` : ''}` : '';
  return `<span class="ptsp ${top ? 'top' : pointsTier(pts)}"${attr}>${bonus ? `${figure(pts - bonus)}+${bonus}` : figure(pts)}</span>`;
}

// A points tip's rows: what he has, by where it came from, then while his gameweek is played
// what's still to come (`toCome`, in tenths) under a heading of its own, a row without a
// value (tooltips.ts).
export function pointsTipRows(from: [string, number][], toCome: [string, number][] = []) {
  const rows = from.map(([label, n]) => `${label}\t${figure(n)}`);
  if (toCome.length) rows.push('Still to come', ...toCome.map(([label, x]) => `${label}\t${tenths(x)}`));
  return rows.join('\n');
}

const XP_PARTS = ['Playing', 'Goals', 'Penalties', 'Assists', 'Clean sheet', 'Conceded', 'Defcon', 'Saves', 'Bonus', 'Cards'];
export const tenths = (x: number) => (x < 0 ? `−${(-x).toFixed(1)}` : x.toFixed(1));

// Projected points (called that rather than xP, which is what chances already taken were
// worth), with a tip that takes them apart when the site's model gave the parts (FPL's form
// has none): his expected minutes, who against on the line below, then every part worth a
// tenth or more, as rows the tooltip lines up (tooltips.ts).
export function xpPill(xp: number, parts?: XpParts, against = '', note = '') {
  if (!parts) return `<span class="ptsp xp" data-tip="${esc(`${tenths(xp)} projected points${note}`)}">${xp.toFixed(1)}</span>`;
  return `<span class="ptsp xp"${xpTip(xp, parts, against)}>${xp.toFixed(1)}</span>`;
}

// The pill's tip alone, as attributes, for numbers shown without the pill (the Projected columns).
export function xpTip(xp: number, parts: XpParts, against = '') {
  const rows = parts
    .slice(1)
    .flatMap((x, i) => (Math.abs(x) >= 0.05 ? [`${XP_PARTS[i]}\t${tenths(x)}`] : []))
    .join('\n');
  const head = `${tenths(xp)} projected · ${Math.round(parts[0])} avg mins${against ? `\n${against}` : ''}`;
  return ` data-tip="${esc(head)}" data-tip-rows="${esc(rows)}"`;
}

export function tag(text: string, tip = '', cls = '') {
  return `<span class="tag ${cls}"${tip ? ` data-tip="${esc(tip)}"` : ''}>${text}</span>`;
}

export function chip(label: string, action: string, value: string | number, active: boolean, extra = '') {
  return `<button type="button" class="chip" data-action="${action}" data-value="${esc(value)}" aria-pressed="${active}" ${extra}>${label}</button>`;
}

export function seg(action: string, options: [string, string][], current: string) {
  return `<div class="seg seg-sm" role="group">${options
    .map(
      ([value, label]) =>
        `<button type="button" data-action="${action}" data-value="${value}" aria-pressed="${current === value}">${label}</button>`,
    )
    .join('')}</div>`;
}

// A bottom sheet over the page, as fotmob.com's on a phone: opened by a button with the
// `sheet-open` action and the sheet's id, and closed by its own button, a tap on the page
// around it (chrome.ts) or Escape.
onAction('sheet-open', (id) => {
  const sheet = document.getElementById(id);
  if (!(sheet instanceof HTMLDialogElement)) return;
  sheet.classList.remove('kept');
  sheet.showModal();
});
onAction('sheet-close', (id) => (document.getElementById(id) as HTMLDialogElement | null)?.close());

export function sheet(id: string, title: string, body: string, done: string) {
  return `<dialog class="sheet" id="${id}" aria-label="${esc(title)}"><div class="sheet-panel">
    <div class="sheet-handle" aria-hidden="true"></div>
    <div class="sheet-title" tabindex="-1" autofocus>${title}</div>
    <div class="sheet-body">${body}</div>
    <div class="sheet-foot"><button type="button" class="sheet-done" data-action="sheet-close" data-value="${id}">${done}</button></div>
  </div></dialog>`;
}

export interface Footer {
  href: string;
  label: string;
  attrs?: string;
}

interface CardOptions {
  title?: string;
  sub?: string;
  action?: string;
  header?: string;
  body: string;
  footer?: Footer | null;
  cls?: string;
}

export function card({ title = '', sub = '', action = '', header: custom = '', body, footer = null, cls = '' }: CardOptions) {
  const heading =
    custom || `<div class="card-heading"><h2 class="card-title">${title}</h2>${sub ? `<div class="card-sub">${sub}</div>` : ''}</div>`;
  const header = title || custom ? `<header class="card-header">${heading}${action}</header>` : '';
  const foot = footer ? `<a class="card-footer" href="${footer.href}"${footer.attrs ?? ''}>${footer.label}</a>` : '';
  return `<section class="card ${cls}">${header}${body}${foot}</section>`;
}

// An ⓘ whose tip explains the thing beside it. A tap keeps it up long enough to read.
export const infoButton = (tip: string, label: string) =>
  `<button type="button" class="info-btn" data-tip="${esc(tip)}" aria-label="${label}">${infoSvg}</button>`;

interface ListRowOptions {
  lead?: string;
  title: string;
  meta?: string;
  value?: string | number;
  top?: boolean;
  rank?: number | null;
  /** The followed team's row, picked out. */
  mine?: boolean;
}

export function listRow({ lead = '', title, meta = '', value = '', top = false, rank = null, mine = false }: ListRowOptions) {
  return `<div class="lrow${mine ? ' mine' : ''}">
    ${rank != null ? `<span class="lrow-rank">${rank}</span>` : ''}
    ${lead}
    <div class="lrow-main"><div class="lrow-title">${title}</div>${meta ? `<div class="lrow-meta">${meta}</div>` : ''}</div>
    ${value !== '' ? `<span class="lrow-value${top ? ' top' : ''}">${value}</span>` : ''}
  </div>`;
}

export const empty = (text: string) => `<div class="empty">${text}</div>`;

export const tile = (label: string, value: string | number, meta: string, tip = '') =>
  `<div class="tile"${tip ? ` data-tip="${esc(tip)}"` : ''}><div class="tile-label">${label}</div><div class="tile-value">${value}</div><div class="tile-meta">${meta}</div></div>`;

// The last results, each a link to its match.
export function formPills(form: MatchResult[]) {
  if (!form.length) return '<span class="form"></span>';
  return `<span class="form">${form
    .map((f, i) => {
      const tip = `GW ${f.gw}: ${f.pf} - ${f.pa} vs ${mgr(f.opp)?.first ?? '?'}`;
      const m = D.matches.find((x) => x.gw === f.gw && (x.home === f.opp || x.away === f.opp));
      return `<a class="pill ${f.res}${i === form.length - 1 ? ' latest' : ''}" data-tip="${esc(tip)}"${m ? ` href="${href.match(m)}"` : ''}>${f.res}</a>`;
    })
    .join('')}</span>`;
}

// A value with FotMob's superscript of actual minus expected; green when it went the manager's way.
export function withDiff(value: number, diff: number, tip: string, { lowerIsGood = false } = {}) {
  const d = Math.round(diff);
  const tone = d === 0 ? 'even' : d > 0 !== lowerIsGood ? 'good' : 'bad';
  return `<span class="xv" data-tip="${esc(tip)}">${value}<sup class="diff ${tone}">${d > 0 ? '+' : ''}${d}</sup></span>`;
}

// A simulated finishing chance, shaded by how likely it is.
export function simCell(p: number) {
  const label = p === 0 ? '–' : p < 0.005 ? '<1%' : p > 0.995 && p < 1 ? '>99%' : `${Math.round(p * 100)}%`;
  const shade = Math.sqrt(p); // lifts the small chances off the background
  return `<span class="simp${shade >= 0.6 ? ' strong' : ''}" style="--shade:${(shade * 100).toFixed(0)}%">${label}</span>`;
}

export const PRIZE_MARKS: Record<number, string> = { 1: 'var(--qual-top)', 2: 'var(--qual-europe)' };
export const markedHeader = (label: string, color: string | null) =>
  color ? `<span class="qmark" style="--q:${color}">${label}</span>` : label;

// Real table position against the expected one, as in FotMob's xG table.
export function rankDelta(r: { tableRank: number | undefined; rank: number }) {
  const tableRank = r.tableRank as number;
  const d = tableRank - r.rank;
  const tone = d === 0 ? 'even' : d > 0 ? 'bad' : 'good';
  const tip = `${ordinal(tableRank)} in the real table, ${ordinal(r.rank)} on expected points`;
  return `<span class="rank-delta ${tone}" data-tip="${tip}">${d > 0 ? '+' : ''}${d}${d ? triangleSvg : ''}</span>`;
}

// fotmob.com's round picker: the previous and next arrows, and every round in between,
// the current one as fotmob.com's Today is. `to` gives each one's address.
export function gwNav(
  gw: number,
  from: number,
  last: number,
  to: (gw: number) => string,
  { label = 'Gameweek', short = 'GW', current = 0 } = {},
) {
  const options = Array.from({ length: last - from + 1 }, (_, i) => from + i)
    .map(
      (g) =>
        `<option value="${to(g)}"${g === gw ? ' selected' : ''}>${g === current ? `Current (${short} ${g})` : `${label} ${g}`}</option>`,
    )
    .join('');
  return `<div class="gw-nav">
    <button type="button" class="gw-step" data-action="go" data-value="${to(gw - 1)}" ${gw <= from ? 'disabled' : ''} aria-label="Previous ${label.toLowerCase()}">${chevronSvg('left')}</button>
    <label class="gw-select"><select data-action="go" aria-label="${label}">${options}</select>${caretSvg}</label>
    <button type="button" class="gw-step" data-action="go" data-value="${to(gw + 1)}" ${gw >= last ? 'disabled' : ''} aria-label="Next ${label.toLowerCase()}">${chevronSvg('right')}</button>
  </div>`;
}

export interface RoundRow {
  href: string;
  /** Home's line and away's: a crest or avatar, the name, and the score once there is one. */
  lines: [{ icon: string; name: string; score?: number }, { icon: string; name: string; score?: number }];
  /** On the right: FT, a Live chip or the minute, or the kick-off. */
  status: string;
  current?: boolean;
}

// fotmob.com's matches-in-the-round card on a match's page: the league and round over the
// matches, each a team on a line with its score and the status on the right, the page's
// own match picked out.
export function roundCard({ title, sub, logo, to, rows }: { title: string; sub: string; logo: string; to: string; rows: RoundRow[] }) {
  const line = (l: RoundRow['lines'][number]) =>
    `<span class="rc-line">${l.icon}<span class="rc-name">${l.name}</span><span class="rc-score">${l.score ?? ''}</span></span>`;
  const body = rows
    .map(
      (r) =>
        `<a class="rc-row${r.current ? ' this' : ''}" href="${r.href}"><span class="rc-teams">${line(r.lines[0])}${line(r.lines[1])}</span><span class="rc-status">${r.status}</span></a>`,
    )
    .join('');
  return `<section class="card round-matches"><a class="rc-head" href="${to}"><span><span class="rc-title">${title}</span><span class="rc-sub">${sub}</span></span><span class="rc-logo">${logo}</span></a>${body}</section>`;
}
