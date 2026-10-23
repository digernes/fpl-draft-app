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

// What a player did, for the icons around his photo on the pitches (see event-icons.ts).
// A white ball with the pattern in ink (red for an own goal), whatever the theme.
export function ballSvg(own = false) {
  const ink = own ? 'var(--lose)' : 'var(--ball-ink)';
  return `<svg viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="6" fill="#fff" stroke="${ink}"/><path d="M7 4.6 9.28 6.26 8.41 8.94H5.59L4.72 6.26Z" fill="${ink}"/><path d="M7 4.6V1.2M9.28 6.26l3.2-1.04M8.41 8.94l2 2.7M5.59 8.94l-2 2.7M4.72 6.26 1.52 5.22" fill="none" stroke="${ink}"/></svg>`;
}
export const bootSvg = `<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3.4 2.2h3q1 0 1 1v2.2q0 .8.8 1l3 .8q1.6.5 1.6 2.1v.7q0 .9-.9.9H2.6q-.9 0-.9-.9 0-4 .7-7 .2-.8 1-.8ZM2.6 11.3H4v1.3H2.6Zm3.2 0h1.4v1.3H5.8Zm4 0h1.4v1.3H9.8Z" fill="currentColor"/></svg>`;
export const cardSvg = (red: boolean) =>
  `<svg viewBox="0 0 14 14" aria-hidden="true"><rect x="3.5" y="1.5" width="7" height="11" rx="1.5" fill="var(${red ? '--red-card' : '--yellow-card'})"/></svg>`;
export const gloveSvg = `<svg viewBox="0 0 14 14" aria-hidden="true" fill="currentColor"><rect x="4.3" y="2.6" width="1.5" height="5" rx=".75"/><rect x="6.1" y="1.5" width="1.5" height="6" rx=".75"/><rect x="7.9" y="1.9" width="1.5" height="5.6" rx=".75"/><rect x="9.7" y="3.1" width="1.5" height="4.5" rx=".75"/><rect x="4.3" y="6" width="6.9" height="4.6" rx="1.6"/><path d="M4.9 9.4 2.4 6.6a.95.95 0 0 1 1.4-1.3L6 7.6Z"/><rect x="4.7" y="11.1" width="6.1" height="1.8" rx=".5"/></svg>`;
export const missSvg = `<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M1.8 11V4.2q0-1 1-1h8.4q1 0 1 1V11" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="m5.3 6.6 3.4 3.4m0-3.4-3.4 3.4" stroke="var(--lose)" stroke-width="1.5" stroke-linecap="round"/></svg>`;
export const subSvg = (on: boolean) =>
  `<svg viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="7" fill="var(${on ? '--win' : '--lose'})"/><path d="${on ? 'M3.6 7h6.2M7.2 4.2 10 7l-2.8 2.8' : 'M10.4 7H4.2M6.8 4.2 4 7l2.8 2.8'}" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
