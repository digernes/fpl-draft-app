// Small components shared across the views.

import type { MatchResult } from '../shared/data.ts';
import { esc, ordinal } from './format.ts';
import { triangleSvg } from './icons.ts';
import { club, mgr, player, slotOf } from './lookups.ts';

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

// Behind every photo sits a silhouette in the club's shirt colours, which shows when
// the Premier League has no picture of the player (see onPhotoError).
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

export function ptsPill(pts: number) {
  const tier = pts >= 10 ? 'p4' : pts >= 6 ? 'p3' : pts >= 3 ? 'p2' : pts >= 1 ? 'p1' : 'p0';
  return `<span class="ptsp ${tier}">${pts}</span>`;
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

interface ListRowOptions {
  lead?: string;
  title: string;
  meta?: string;
  value?: string | number;
  top?: boolean;
  rank?: number | null;
}

export function listRow({ lead = '', title, meta = '', value = '', top = false, rank = null }: ListRowOptions) {
  return `<div class="lrow">
    ${rank != null ? `<span class="lrow-rank">${rank}</span>` : ''}
    ${lead}
    <div class="lrow-main"><div class="lrow-title">${title}</div>${meta ? `<div class="lrow-meta">${meta}</div>` : ''}</div>
    ${value !== '' ? `<span class="lrow-value${top ? ' top' : ''}">${value}</span>` : ''}
  </div>`;
}

export const empty = (text: string) => `<div class="empty">${text}</div>`;

export const tile = (label: string, value: string | number, meta: string, tip = '') =>
  `<div class="tile"${tip ? ` data-tip="${esc(tip)}"` : ''}><div class="tile-label">${label}</div><div class="tile-value">${value}</div><div class="tile-meta">${meta}</div></div>`;

export function formPills(form: MatchResult[]) {
  if (!form.length) return '<span class="form"></span>';
  return `<span class="form">${form
    .map((f, i) => {
      const tip = `GW ${f.gw}: ${f.pf} - ${f.pa} vs ${mgr(f.opp)?.first ?? '?'}`;
      return `<button type="button" class="pill ${f.res}${i === form.length - 1 ? ' latest' : ''}" data-tip="${esc(tip)}" data-action="match" data-value="${f.gw}" data-a="${f.opp}" data-go="1">${f.res}</button>`;
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
