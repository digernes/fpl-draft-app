import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { bindScroll, changeEntry, keepingSideways, landing } from '../src/app/scroll.ts';

describe('where a page lands', () => {
  it('goes back to where it was left, or the top when that wasn’t kept', () => {
    assert.equal(landing('back', { y: 900, saved: 340 }), 340);
    assert.equal(landing('back', { y: 900 }), 0);
  });

  it('starts a page opened from a link at the top', () => {
    assert.equal(landing('new', { y: 900, saved: 340, tabs: 200 }), 0);
  });

  it('keeps another tab of the page where it was, or its tabs just under the top bar once they had scrolled away', () => {
    assert.equal(landing('tab', { y: 120, tabs: 200 }), 120);
    assert.equal(landing('tab', { y: 900, tabs: 200 }), 200);
    assert.equal(landing('tab', { y: 900 }), 900);
  });
});

// --- In a browser: a window that scrolls as far as the page is tall, its history entries,
// the tab's session storage and what the page has drawn -----------------------------------

const listeners = new Map<string, () => void>();
const resized: (() => void)[] = [];
let pageHeight = 5000;
const win = {
  scrollY: 0,
  scrollTo(_x: number, y: number) {
    win.scrollY = Math.min(y, pageHeight);
  },
  addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
};
const history = {
  state: null as Record<string, unknown> | null,
  scrollRestoration: 'auto',
  replaceState(state: Record<string, unknown>) {
    history.state = state;
  },
};
const session = new Map<string, string>();
// Where the page's tabs are, from the top of the page, when it has any.
let tabsTop: number | null = null;
const doc = {
  hidden: false,
  getElementById: () => ({}),
  querySelector: (selector: string) =>
    selector === '.topbar'
      ? { offsetHeight: 56 }
      : selector.includes('.tabs') && tabsTop !== null
        ? { getBoundingClientRect: () => ({ top: tabsTop! - win.scrollY }) }
        : null,
  addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
};

before(() => {
  session.set('draft.scroll', JSON.stringify([['kept', 640]]));
  history.state = { scroll: 'kept' };
  Object.assign(globalThis, {
    window: win,
    history,
    document: doc,
    sessionStorage: {
      getItem: (key: string) => session.get(key) ?? null,
      setItem: (key: string, value: string) => session.set(key, value),
    },
    ResizeObserver: class {
      constructor(callback: () => void) {
        resized.push(callback);
      }
      observe() {}
    },
  });
  // A reload, of a page not yet tall enough to scroll to where it was.
  pageHeight = 300;
  bindScroll();
});

// Goes to a new address, as a link does: a history entry of its own, without a scroll yet.
function follow(samePage: boolean) {
  history.state = null;
  changeEntry(() => samePage);
}

describe('scrolling between the history’s entries', () => {
  it('takes the scroll over from the browser, and on a reload goes back to where it was once the page is tall enough', () => {
    assert.equal(history.scrollRestoration, 'manual');
    assert.equal(win.scrollY, 300);
    pageHeight = 5000;
    for (const callback of resized) callback();
    assert.equal(win.scrollY, 640);
  });

  it('starts a new page at the top, and keeps where the last one was for going back', () => {
    const left = history.state;
    win.scrollY = 900;
    follow(false);
    assert.equal(win.scrollY, 0);
    assert.match(String(history.state?.scroll), /^[0-9a-z]+$/);
    history.state = left;
    changeEntry(() => false);
    assert.equal(win.scrollY, 900);
  });

  it('keeps another tab of the page where it was, or brings its tabs up under the top bar', () => {
    win.scrollY = 120;
    tabsTop = 456;
    follow(true);
    assert.equal(win.scrollY, 120);
    win.scrollY = 1200;
    follow(true);
    assert.equal(win.scrollY, 400); // the tabs at 456, under the top bar's 56
    tabsTop = null;
  });

  it('stops going for where it was once the visitor scrolls themselves', () => {
    win.scrollY = 2000;
    const there = history.state;
    follow(false);
    pageHeight = 1000;
    history.state = there;
    changeEntry(() => false);
    assert.equal(win.scrollY, 1000);
    listeners.get('wheel')!();
    pageHeight = 5000;
    for (const callback of resized) callback();
    assert.equal(win.scrollY, 1000);
  });

  it('keeps the positions in the tab’s session when the page is put away', () => {
    win.scrollY = 777;
    doc.hidden = true;
    listeners.get('visibilitychange')!();
    const kept = new Map(JSON.parse(session.get('draft.scroll')!) as [string, number][]);
    assert.equal(kept.get(String(history.state?.scroll)), 777);
    assert.equal(kept.get('kept'), 120); // where the reloaded page was last left
  });
});

describe('redrawing a view', () => {
  // A box that scrolls sideways, as the page has drawn it.
  const box = (className: string, scrollLeft = 0) => ({ className, scrollLeft });
  const root = (boxes: ReturnType<typeof box>[]) => ({ querySelectorAll: () => boxes });

  it('keeps each box that scrolls sideways where it was, by its class and its place among those with it', () => {
    let boxes = [box('table-scroll', 120), box('table-scroll', 0), box('filter-bar', 40)];
    const page = { querySelectorAll: () => boxes };
    keepingSideways(page as unknown as ParentNode, () => {
      boxes = [box('table-scroll'), box('table-scroll'), box('filter-bar'), box('heatmap')];
    });
    assert.deepEqual(
      boxes.map((b) => b.scrollLeft),
      [120, 0, 40, 0],
    );
    assert.doesNotThrow(() => keepingSideways(root([]) as unknown as ParentNode, () => {}));
  });
});
