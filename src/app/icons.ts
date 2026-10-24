// Inline SVG icons.

export const trophySvg = `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="24" fill="var(--brand-solid)"/><path d="M16 13h16v3h4v3a6 6 0 0 1-5.2 5.95A8 8 0 0 1 25.5 30v3H30v3H18v-3h4.5v-3a8 8 0 0 1-5.3-5.05A6 6 0 0 1 12 19v-3h4v-3Zm0 6v-.5h-1.5V19a3 3 0 0 0 1.6 2.66A8 8 0 0 1 16 21v-2Zm16 2c0 .23-.01.45-.03.67A3 3 0 0 0 33.5 19v-.5H32V21Z" fill="#fff"/></svg>`;
export const swapSvg = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2 1 5.5 4.5 9V6.5H11v-2H4.5V2Zm7 5v2.5H5v2h6.5V14L15 10.5 11.5 7Z" fill="currentColor"/></svg>`;
export const infoSvg = `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.75" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 7v4.25" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="4.9" r="1" fill="currentColor"/></svg>`;
export const triangleSvg = `<svg class="tri" viewBox="0 0 8 8" aria-hidden="true"><path d="M4 1.5 7.5 6.5h-7Z" fill="currentColor"/></svg>`;
// fotmob.com's mark under a table's sorted column: both arrows, the way it's sorted brighter.
export const sortSvg = (asc: boolean) =>
  `<svg class="sort-mark" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5 9.2 5H2.8Z" fill="currentColor" opacity="${asc ? 1 : 0.35}"/><path d="M6 10.5 2.8 7h6.4Z" fill="currentColor" opacity="${asc ? 0.35 : 1}"/></svg>`;
export const arrowSvg = `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5 10.5 7H7.5v3.5h-3V7h-3L6 1.5Z" fill="currentColor"/></svg>`;
// fotmob.com's previous and next arrow: square ends, a sharp point and arms that thicken
// towards it, sitting a little towards the way it points.
export function chevronSvg(direction: 'left' | 'right') {
  const paths = {
    left: 'M8.85 2.2 3.9 8 8.85 13.8 10.35 12.5 7.4 8 10.35 3.5Z',
    right: 'M7.15 2.2 12.1 8 7.15 13.8 5.65 12.5 8.6 8 5.65 3.5Z',
  };
  return `<svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="${paths[direction]}" fill="currentColor"/></svg>`;
}
// And its caret, on dropdowns and on rows that open: a small triangle with rounded corners.
export const caretSvg = `<svg class="caret" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.2 6.8h5.6L8 9.6Z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`;

// What a player did, for the icons around his photo on the pitches (see event-icons.ts).
// A real ball's panels (one pentagon facing us), white with a dark rim so it stands out
// on a light or a dark chip (red for an own goal); the season's goals have it
// see-through, in the text colour.
export const ballSvg = (ink = '#222', face = '#fff') =>
  `<svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.55" fill="${face}"/><path d="M5.93 8.47L8.07 8.47L8.73 6.44L7 5.18L5.27 6.44ZM8.07 11.42L9.14 11.76L10.87 10.51L10.87 9.38L9.14 9.94ZM5.27 2.8L7 3.36L8.73 2.8L8.07 1.89L5.93 1.89ZM1.81 6.44L2.47 7.35L3.54 5.88L3.54 4.06L2.47 4.4ZM10.46 5.88L11.53 7.35L12.19 6.44L11.53 4.4L10.46 4.06ZM4.86 11.76L5.93 11.42L4.86 9.94L3.13 9.38L3.13 10.51Z" fill="${ink}"/><path d="M8.07 8.47L9.14 9.94M8.07 8.47L8.73 6.44M8.07 8.47L5.93 8.47M9.14 9.94L10.87 9.38M9.14 9.94L8.07 11.42M5.27 2.8L3.54 4.06M5.27 2.8L7 3.36M3.54 4.06L3.54 5.88M7 5.18L5.27 6.44M7 5.18L8.73 6.44M7 5.18L7 3.36M5.27 6.44L5.93 8.47M5.27 6.44L3.54 5.88M8.73 2.8L7 3.36M8.73 2.8L10.46 4.06M2.47 7.35L3.54 5.88M2.47 7.35L3.13 9.38M10.46 5.88L11.53 7.35M10.46 5.88L8.73 6.44M10.46 5.88L10.46 4.06M11.53 7.35L10.87 9.38M4.86 9.94L5.93 11.42M4.86 9.94L5.93 8.47M4.86 9.94L3.13 9.38M5.93 11.42L8.07 11.42" fill="none" stroke="${ink}" stroke-width=".55" stroke-linecap="round"/><circle cx="7" cy="7" r="5.55" fill="none" stroke="${ink}" stroke-width="1.1"/></svg>`;
export const ownGoalSvg = ballSvg('var(--lose)');
// A boot, toe up, with small studs and its laces cut out of the instep.
export const bootSvg = (ink = 'var(--event-ink)') =>
  `<svg aria-hidden="true" width="13" height="13" viewBox="0 0 14 14"><g transform="rotate(-28 7 7.4)" fill="${ink}"><path fill-rule="evenodd" d="M1.8 5Q1.9 4.4 2.5 4.5L3.6 4.9Q4.7 5.9 5.8 4.7L10.4 6.4Q12.6 7 13.1 8.7Q13.3 9.6 12.4 9.8H2.4Q1.8 9.8 1.8 9.2ZM6.51 5.32L6.87 5.35L6.81 6.05L6.45 6.02ZM7.53 5.7L7.89 5.73L7.82 6.43L7.47 6.39ZM8.54 6.07L8.9 6.1L8.84 6.8L8.48 6.77Z"/><path d="M2.6 9.8h1v.8h-1Zm2.5 0h1v.8h-1Zm3.4 0h1v.8h-1Zm2.2 0h1v.8h-1Z"/></g></svg>`;
// A referee's card, held at a slight angle.
export const cardSvg = (red: boolean) =>
  `<svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14"><rect x="3.6" y="1.6" width="6.8" height="10.8" rx="1.3" transform="rotate(12 7 7)" fill="var(${red ? '--lose' : '--card-yellow'})"/></svg>`;
// Coming on and going off: an arrow in or out of a coloured disc.
export const subSvg = (on: boolean) =>
  `<svg aria-hidden="true" width="12" height="12" viewBox="0 0 14 14"><circle cx="7" cy="7" r="6.5" fill="var(${on ? '--event-green' : '--lose'})"/><path d="${on ? 'M4.1 7h5.6M7.6 4.8 9.8 7l-2.2 2.2' : 'M9.9 7H4.3M6.4 4.8 4.2 7l2.2 2.2'}" fill="none" stroke="#fff" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
// A missed penalty: the goal, with a red cross in it.
export const missSvg = `<svg aria-hidden="true" width="12" height="12" viewBox="0 0 14 14"><path d="M1.5 11.5V3.9q0-1 1-1h9q1 0 1 1v7.6" fill="none" stroke="var(--event-ink)" stroke-width="1.5" stroke-linecap="round"/><path d="m5.2 6.1 3.6 3.6m0-3.6-3.6 3.6" stroke="var(--lose)" stroke-width="1.5" stroke-linecap="round"/></svg>`;
// A saved penalty: the keeper's glove.
export const gloveSvg = `<svg aria-hidden="true" width="12" height="12" viewBox="0 0 14 14"><g transform="rotate(-12 7 7)" fill="var(--event-ink)"><rect x="4.5" y="2.4" width="1.4" height="5.4" rx=".7"/><rect x="6.05" y="1.5" width="1.4" height="6.3" rx=".7"/><rect x="7.6" y="1.9" width="1.4" height="5.9" rx=".7"/><rect x="9.15" y="3" width="1.4" height="4.8" rx=".7"/><rect x="4.5" y="6.3" width="6.05" height="4.6" rx="1.5"/><rect x="2.4" y="5.6" width="1.5" height="4.2" rx=".75" transform="rotate(-38 3.15 7.7)"/><rect x="4.3" y="11.3" width="6.45" height="1.9" rx=".5"/></g></svg>`;

// The bottom bar's: a ball for the home page's matches, a trophy for the draft league, a
// shield for the Premier League and a shirt for the teams.
export const matchesSvg = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m12 7.6 3.8 2.8-1.5 4.4H9.7l-1.5-4.4Z" fill="currentColor"/><path d="M12 7.6V3.2m3.8 7.2 4.1-1.4m-5.6 5.8 2.6 3.6m-7.2-3.6-2.6 3.6m-1.5-8 4.1 1.4" stroke="currentColor" stroke-width="1.6"/></svg>`;
export const leagueSvg = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h10v2.2h3v1.8a4 4 0 0 1-3.6 4A5.5 5.5 0 0 1 13 15.2v2.6h3.2v2.7H7.8v-2.7H11v-2.6a5.5 5.5 0 0 1-3.4-3.7A4 4 0 0 1 4 7.5V5.7h3Zm0 4v-.1H5.8v.1a2.2 2.2 0 0 0 1.3 2Zm10 0v2a2.2 2.2 0 0 0 1.2-2v-.1H17Z" fill="currentColor"/></svg>`;
export const premierLeagueSvg = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8 19.5 5.6v6c0 4.6-3.2 8.2-7.5 9.6-4.3-1.4-7.5-5-7.5-9.6v-6Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8.5 9.5h7M8.5 12.5h7M10 15.5h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
export const shirtSvg = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.8 3.5 4 5.8 2.6 10.2l3.2 1.3.9-1.4v10.4h10.6V10.1l.9 1.4 3.2-1.3L20 5.8l-4.8-2.3a3.4 3.4 0 0 1-6.4 0Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
// fotmob.com's Follow star, outlined until it's on.
export const slidersSvg = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4.5h6.5m4 0H14M2 11.5h1.5m4 0H14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="10.5" cy="4.5" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="5.5" cy="11.5" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
export const starSvg = (on: boolean) =>
  `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m8 1.6 1.9 4.1 4.5.5-3.4 3 1 4.4L8 11.3l-4 2.3 1-4.4-3.4-3 4.5-.5Z" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
