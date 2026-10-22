// Inline SVG icons.

export const trophySvg = `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="24" fill="var(--brand-solid)"/><path d="M16 13h16v3h4v3a6 6 0 0 1-5.2 5.95A8 8 0 0 1 25.5 30v3H30v3H18v-3h4.5v-3a8 8 0 0 1-5.3-5.05A6 6 0 0 1 12 19v-3h4v-3Zm0 6v-.5h-1.5V19a3 3 0 0 0 1.6 2.66A8 8 0 0 1 16 21v-2Zm16 2c0 .23-.01.45-.03.67A3 3 0 0 0 33.5 19v-.5H32V21Z" fill="#fff"/></svg>`;
export const swapSvg = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2 1 5.5 4.5 9V6.5H11v-2H4.5V2Zm7 5v2.5H5v2h6.5V14L15 10.5 11.5 7Z" fill="currentColor"/></svg>`;
export const infoSvg = `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.75" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 7v4.25" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="4.9" r="1" fill="currentColor"/></svg>`;
export const triangleSvg = `<svg class="tri" viewBox="0 0 8 8" aria-hidden="true"><path d="M4 1.5 7.5 6.5h-7Z" fill="currentColor"/></svg>`;
export const arrowSvg = `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5 10.5 7H7.5v3.5h-3V7h-3L6 1.5Z" fill="currentColor"/></svg>`;
export function chevronSvg(direction: 'left' | 'right' | 'down') {
  const paths = { left: 'M10 3 5 8l5 5', right: 'M6 3l5 5-5 5', down: 'M3 6l5 5 5-5' };
  return `<svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="${paths[direction]}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
