// Where the page is scrolled, kept for each history entry: the page draws itself from the
// address, so the browser's own restoring has nothing to hold on to by the time it's drawn.
// Back and forward land where you were, a link starts at the top, and another tab of the
// same page keeps its tabs in sight. As the same view redraws (a sort, a filter, a live
// score), the boxes that scroll sideways keep their place too.

export type Arrival = 'back' | 'tab' | 'new';

/**
 * Where an entry lands: `back` (or forward) where it was left, `new` at the top, and `tab`
 * (another of the page's tabs) where it was, or with the tabs just under the top bar if they
 * had scrolled away, rather than back up at the page's header (`tabs` is that scroll; none
 * without tabs).
 */
export function landing(arrival: Arrival, { y, saved, tabs }: { y: number; saved?: number; tabs?: number }) {
  if (arrival === 'back') return saved ?? 0;
  if (arrival === 'new') return 0;
  return tabs === undefined ? y : Math.min(y, tabs);
}

const STORED = 'draft.scroll';
const positions = new Map<string, number>(); // by entry
let current = '';
// Where the page should be once it's tall enough: a page that loads more after it's drawn
// (a gameweek's stats file) or a reload, until the visitor scrolls themselves.
let wanted: number | null = null;

const entryKey = (): string | undefined => (history.state as { scroll?: string } | null)?.scroll;

function keyEntry() {
  const key = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  history.replaceState({ ...history.state, scroll: key }, '');
  return key;
}

function hold() {
  if (wanted === null) return;
  window.scrollTo(0, wanted);
  if (Math.abs(window.scrollY - wanted) < 1) wanted = null;
}

function scrollToKept(y: number) {
  wanted = y;
  hold();
}

// Kept in the tab's session too: a phone reloads a page it put away, and so does coming
// back from another site.
function persist() {
  positions.set(current, window.scrollY);
  try {
    sessionStorage.setItem(STORED, JSON.stringify([...positions]));
  } catch {
    // private browsing: only this visit's entries are kept
  }
}

export function bindScroll() {
  history.scrollRestoration = 'manual';
  try {
    for (const [key, y] of JSON.parse(sessionStorage.getItem(STORED) ?? '[]') as [string, number][]) positions.set(key, y);
  } catch {
    // nothing kept
  }
  current = entryKey() ?? keyEntry();
  const saved = positions.get(current);
  if (saved) scrollToKept(saved); // a reload: as the page is drawn
  new ResizeObserver(hold).observe(document.getElementById('app')!);
  for (const type of ['wheel', 'touchstart', 'keydown', 'mousedown']) {
    window.addEventListener(type, () => (wanted = null), { passive: true, capture: true });
  }
  window.addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', () => document.hidden && persist());
}

/**
 * Moves to the entry the address now names: `render` draws it and says whether it's the page
 * shown before (another of its tabs), then the page lands where it should.
 */
export function changeEntry(render: () => boolean) {
  const y = window.scrollY; // where the entry left was: the browser leaves the scroll to us
  positions.set(current, y);
  const known = entryKey();
  current = known ?? keyEntry();
  const samePage = render();
  const arrival: Arrival = known ? 'back' : samePage ? 'tab' : 'new';
  scrollToKept(landing(arrival, { y, saved: positions.get(current), tabs: tabsAt() }));
}

// The scroll that puts the page's tabs just under the top bar.
function tabsAt() {
  const tabs = document.querySelector('#app .page-header .tabs');
  if (!tabs) return undefined;
  const bar = document.querySelector<HTMLElement>('.topbar')?.offsetHeight ?? 0;
  return tabs.getBoundingClientRect().top + window.scrollY - bar;
}

// What scrolls sideways: the wide tables, the heatmap, the draft board and the filter and tab
// bars, each known by its class and its place among those with that class.
const SIDEWAYS = '.split-rows, .table-scroll, .heatmap, .board, .filter-bar, .tabs';

function sideways(root: ParentNode) {
  const seen = new Map<string, number>();
  return [...root.querySelectorAll<HTMLElement>(SIDEWAYS)].map((box) => {
    const n = seen.get(box.className) ?? 0;
    seen.set(box.className, n + 1);
    return [`${box.className} ${n}`, box] as const;
  });
}

/** Redraws the same view, its sideways scrolls where they were (a tapped column heading stays under the finger). */
export function keepingSideways(root: ParentNode, redraw: () => void) {
  const was = new Map(sideways(root).map(([key, box]) => [key, box.scrollLeft]));
  redraw();
  for (const [key, box] of sideways(root)) {
    const left = was.get(key);
    if (left) box.scrollLeft = left;
  }
}
