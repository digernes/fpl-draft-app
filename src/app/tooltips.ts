// The one tooltip: an element's data-tip (with its data-tip-head and data-tip-rows) on hover,
// focus or a press on a touch screen.

type Tipped = HTMLElement | SVGElement;

const line = (text: string, className = '') => Object.assign(document.createElement('div'), { className, textContent: text });

export function fillTip(tip: HTMLElement, el: Tipped) {
  tip.textContent = el.dataset.tip ?? el.getAttribute('data-tip');
  // A heading over it, when it has one.
  const heading = el.dataset.tipHead;
  if (heading) tip.replaceChildren(line(heading, 'tip-head'), line(tip.textContent ?? ''));
  // Label and value pairs under the tip, lined up in two columns (as text, never markup); a
  // row without a value heads those under it (what's still to come of a player's points).
  const rows = el.dataset.tipRows;
  if (!rows) return;
  const grid = Object.assign(document.createElement('div'), { className: 'tip-rows' });
  const cell = (textContent: string, className = '') => Object.assign(document.createElement('span'), { className, textContent });
  for (const row of rows.split('\n')) {
    const [label, ...values] = row.split('\t');
    grid.append(...(values.length ? [cell(label), ...values.map((v) => cell(v, 'tip-value'))] : [cell(label, 'tip-sub')]));
  }
  // The tip's first line heads it; any after it (who against) are plain.
  const [head, ...below] = (tip.textContent ?? '').split('\n');
  tip.replaceChildren(line(head, 'tip-head'), ...below.map((text) => line(text)), grid);
}

// At the point of the part of it under the pointer, when that has one (the momentum's
// minutes), else at its own last point, else at it.
function placeTip(tip: HTMLElement, el: Tipped, part?: EventTarget | null) {
  const point = (part instanceof Element && part.querySelector(':scope > .tip-at')) || [...el.querySelectorAll('.tip-at')].pop() || el;
  const r = point.getBoundingClientRect();
  const half = tip.offsetWidth / 2;
  const center = r.left + r.width / 2;
  const x = Math.min(Math.max(center, half + 8), window.innerWidth - half - 8);
  const below = r.top < tip.offsetHeight + 16;
  tip.classList.toggle('below', below);
  tip.style.left = `${x}px`;
  tip.style.top = `${below ? r.bottom : r.top}px`;
  tip.style.setProperty('--arrow', `${center - x}px`);
}

const tipped = (target: EventTarget | null) => (target as Element).closest<Tipped>('[data-tip]');
const isTipped = (el: EventTarget | null): el is Tipped => (el as Element | null)?.matches?.('[data-tip]') ?? false;

export function bindTooltips() {
  const tip = document.getElementById('tooltip')!;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  const show = (el: Tipped, part?: EventTarget | null) => {
    clearTimeout(hideTimer);
    fillTip(tip, el);
    tip.hidden = false;
    placeTip(tip, el, part);
  };
  const hide = () => {
    tip.hidden = true;
  };
  document.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'touch') return;
    const el = tipped(event.target);
    if (el) show(el, event.target);
  });
  document.addEventListener('pointerout', (event) => {
    const el = tipped(event.target);
    if (el && !el.contains(event.relatedTarget as Node | null)) hide();
  });
  document.addEventListener('pointerdown', (event) => {
    const el = tipped(event.target);
    if (event.pointerType !== 'touch' || !el) return hide();
    show(el);
    hideTimer = setTimeout(hide, el.classList.contains('info-btn') ? 10000 : 2500);
  });
  // Nor the phone's menu for the image or text under it (Android's comes as a contextmenu).
  document.addEventListener('contextmenu', (event) => {
    if ((event as PointerEvent).pointerType === 'touch' && tipped(event.target)) event.preventDefault();
  });
  document.addEventListener('focusin', (event) => isTipped(event.target) && show(event.target));
  document.addEventListener('focusout', (event) => isTipped(event.target) && hide());
  // Scrolling hides a hover tip, but a focused element (keyboard) keeps its tip in place.
  window.addEventListener('scroll', () => (!tip.hidden && isTipped(document.activeElement) ? show(document.activeElement) : hide()), {
    passive: true,
  });
}
