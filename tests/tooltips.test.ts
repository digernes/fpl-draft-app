import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import { bindTooltips, fillTip } from '../src/app/tooltips.ts';

// --- In a browser: elements with a class, their text and children, as fillTip makes them ----

interface Fake {
  className: string;
  textContent: string | null;
  children: Fake[];
  append(...nodes: Fake[]): void;
  replaceChildren(...nodes: Fake[]): void;
}

function element(): Fake {
  const el: Fake = {
    className: '',
    textContent: '',
    children: [],
    append: (...nodes) => el.children.push(...nodes),
    replaceChildren: (...nodes) => {
      el.children = nodes;
    },
  };
  return el;
}

// What the tip shows, a line to each element, a class before its text.
function shown(tip: Fake): string[] {
  if (!tip.children.length) return [tip.textContent ?? ''];
  return tip.children.flatMap((child) =>
    child.children.length
      ? [`[${child.className}]`, ...shown(child)]
      : [`${child.className ? `${child.className}: ` : ''}${child.textContent}`],
  );
}

// The page: the tooltip itself, a window 400 wide, and the listeners bindTooltips adds.
type Listener = (event: Record<string, unknown>) => void;
const listeners = new Map<string, Listener>();
const tooltip = Object.assign(element(), {
  hidden: true,
  offsetWidth: 120,
  offsetHeight: 40,
  below: false,
  classList: { toggle: (_name: string, on: boolean) => (tooltip.below = on) },
  style: { left: '', top: '', arrow: '', setProperty: (_name: string, value: string) => (tooltip.style.arrow = value) },
});
class Element {}
let focused: unknown = null;
Object.assign(globalThis, {
  Element,
  document: {
    createElement: element,
    getElementById: () => tooltip,
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    get activeElement() {
      return focused;
    },
  },
  window: { innerWidth: 400, addEventListener: (type: string, listener: Listener) => listeners.set(`window:${type}`, listener) },
});

// An element with a tip at `left`, `top`; `points`: its own points to show the tip at (.tip-at).
function tipped(tip: string, left: number, top: number, { info = false, points = [] as unknown[] } = {}) {
  const el = Object.assign(new Element(), {
    dataset: { tip },
    getAttribute: () => null,
    closest: () => el,
    matches: () => true,
    contains: (other: unknown) => other === el,
    querySelector: () => null,
    querySelectorAll: () => points,
    getBoundingClientRect: () => ({ left, top, width: 20, bottom: top + 20 }),
    classList: { contains: () => info },
  });
  return el;
}
const point = (left: number, top: number) => ({ getBoundingClientRect: () => ({ left, top, width: 0, bottom: top }) });
const fire = (type: string, event: Record<string, unknown>) =>
  listeners.get(type)!({ preventDefault: () => (event.prevented = true), ...event });

function fill(dataset: Record<string, string>) {
  const tip = element();
  fillTip(tip as unknown as HTMLElement, { dataset, getAttribute: () => null } as unknown as HTMLElement);
  return shown(tip);
}

describe('the tooltip', () => {
  it('shows a plain tip as it is, and one with a heading under it', () => {
    assert.deepEqual(fill({ tip: 'Playing now' }), ['Playing now']);
    assert.deepEqual(fill({ tip: 'Off after 60 minutes', tipHead: 'Saka' }), ['tip-head: Saka', 'Off after 60 minutes']);
  });

  it('lines up rows of labels and values under its first line, which heads it', () => {
    assert.deepEqual(fill({ tip: '5.2 projected · 80 avg mins\nChelsea (H)', tipRows: 'Playing\t1.9\nGoals\t1.5' }), [
      'tip-head: 5.2 projected · 80 avg mins',
      'Chelsea (H)',
      '[tip-rows]',
      'Playing',
      'tip-value: 1.9',
      'Goals',
      'tip-value: 1.5',
    ]);
  });

  it('heads the rows under a row without a value: what’s still to come of his points', () => {
    assert.deepEqual(fill({ tip: '9.3 projected · 7 points so far', tipRows: 'Goals\t5\nStill to come\nGoals\t0.6\nBonus\t0.4' }), [
      'tip-head: 9.3 projected · 7 points so far',
      '[tip-rows]',
      'Goals',
      'tip-value: 5',
      'tip-sub: Still to come',
      'Goals',
      'tip-value: 0.6',
      'Bonus',
      'tip-value: 0.4',
    ]);
  });
});

describe('where and when the tooltip shows', () => {
  bindTooltips();
  const away = { closest: () => null, matches: () => false };

  it('shows over the element under the pointer, kept inside the window, and goes when the pointer leaves', () => {
    const el = tipped('Playing now', 200, 300);
    fire('pointerover', { pointerType: 'mouse', target: el });
    assert.equal(tooltip.hidden, false);
    assert.deepEqual(shown(tooltip), ['Playing now']);
    assert.deepEqual([tooltip.style.left, tooltip.style.top, tooltip.below], ['210px', '300px', false]);
    // Moving within it keeps it; leaving it hides it.
    fire('pointerout', { target: el, relatedTarget: el });
    assert.equal(tooltip.hidden, false);
    fire('pointerout', { target: el, relatedTarget: null });
    assert.equal(tooltip.hidden, true);
    // Near the window's edge and top: inside it, below the element, its arrow still at it.
    fire('pointerover', { pointerType: 'mouse', target: tipped('Match over', 0, 10) });
    assert.deepEqual([tooltip.style.left, tooltip.style.top, tooltip.below, tooltip.style.arrow], ['68px', '30px', true, '-58px']);
  });

  it('points at the part under the pointer, else at the element’s last point', () => {
    const momentum = tipped('Saturday', 0, 300, { points: [point(100, 280), point(150, 290)] });
    fire('pointerover', { pointerType: 'mouse', target: momentum });
    assert.equal(tooltip.style.left, '150px');
    const minute = Object.assign(new Element(), { querySelector: () => point(120, 250), closest: () => momentum });
    fire('pointerover', { pointerType: 'mouse', target: minute });
    assert.equal(tooltip.style.left, '120px');
  });

  it('shows on a press on a touch screen for a while, an info button’s for longer, and not on a touch’s hover', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    fire('pointerdown', { pointerType: 'mouse', target: away });
    assert.equal(tooltip.hidden, true);
    fire('pointerover', { pointerType: 'touch', target: tipped('Playing now', 200, 300) });
    assert.equal(tooltip.hidden, true);
    fire('pointerdown', { pointerType: 'touch', target: tipped('Playing now', 200, 300) });
    assert.equal(tooltip.hidden, false);
    mock.timers.tick(2500);
    assert.equal(tooltip.hidden, true);
    fire('pointerdown', { pointerType: 'touch', target: tipped('How it works', 200, 300, { info: true }) });
    mock.timers.tick(2500);
    assert.equal(tooltip.hidden, false);
    mock.timers.tick(7500);
    assert.equal(tooltip.hidden, true);
    mock.timers.reset();
    // A press held on it doesn't open the phone's menu, as one elsewhere does.
    const held: Record<string, unknown> = { pointerType: 'touch', target: tipped('Playing now', 200, 300) };
    fire('contextmenu', held);
    assert.equal(held.prevented, true);
    const elsewhere: Record<string, unknown> = { pointerType: 'touch', target: away };
    fire('contextmenu', elsewhere);
    assert.equal(elsewhere.prevented, undefined);
  });

  it('follows the keyboard’s focus, and keeps a focused element’s tip in place on a scroll', () => {
    const el = tipped('Playing now', 200, 300);
    fire('focusin', { target: el });
    assert.equal(tooltip.hidden, false);
    focused = el;
    listeners.get('window:scroll')!({});
    assert.equal(tooltip.hidden, false);
    fire('focusout', { target: el });
    assert.equal(tooltip.hidden, true);
    // A hover tip goes on a scroll.
    focused = null;
    fire('pointerover', { pointerType: 'mouse', target: el });
    listeners.get('window:scroll')!({});
    assert.equal(tooltip.hidden, true);
    fire('focusin', { target: away });
    assert.equal(tooltip.hidden, true);
  });
});
