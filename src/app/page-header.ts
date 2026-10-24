// The card at the top of every page but the home page, as on fotmob.com: a logo, the
// page's name and what it is, anything that goes on the right (status chips, a Follow
// button), and the page's tabs with a bar under the one picked. A match has its own
// middle instead (the sides and the score).

import { esc } from './format.ts';

export interface Tab {
  id: string;
  label: string;
  href: string;
}

export interface Header {
  logo?: string;
  title?: string;
  /** Where the title leads, as the league's name leads to its overview. */
  titleHref?: string;
  sub?: string;
  side?: string;
  /** In place of the logo, title, sub and side. */
  poster?: string;
  tabs?: Tab[];
  tab?: string;
  cls?: string;
}

export function pageHeader(h: Header) {
  const poster =
    h.poster ??
    `<div class="poster-logo">${h.logo ?? ''}</div>
    <div class="poster-text"><h1 class="poster-name">${h.titleHref ? `<a href="${esc(h.titleHref)}">${h.title ?? ''}</a>` : (h.title ?? '')}</h1>${h.sub ? `<div class="poster-sub">${h.sub}</div>` : ''}</div>
    ${h.side ? `<div class="poster-side">${h.side}</div>` : ''}`;
  const tabs = h.tabs?.length
    ? `<nav class="tabs" role="tablist">${h.tabs
        .map((t) => `<a class="tab" role="tab" href="${esc(t.href)}" aria-selected="${t.id === h.tab}">${t.label}</a>`)
        .join('')}<span class="tab-indicator"></span></nav>`
    : '';
  return `<section class="page-header ${h.cls ?? ''}"><div class="poster">${poster}</div>${tabs}</section>`;
}
