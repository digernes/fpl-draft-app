// What a player did, as icons around his photo on the pitches, placed the way
// fotmob.com's lineups place them: substitutions at the top left, cards at the middle
// left, assists at the bottom left, goals and saved penalties at the bottom right and
// missed penalties at the middle right. A list row has them in one line instead.

import type { PlayerEvents } from '../shared/live.ts';
import { plural } from './format.ts';
import { ballSvg, bootSvg, cardSvg, gloveSvg, missSvg, ownGoalSvg, subSvg } from './icons.ts';

/** HTML for each place around the photo. */
export interface EventSlots {
  topLeft?: string;
  middleLeft?: string;
  middleRight?: string;
  bottomLeft?: string;
  bottomRight?: string;
}

const icon = (svg: string, tip: string) => `<span class="ev" data-tip="${tip}">${svg}</span>`;
const times = (n: number | undefined, svg: string, tip: string) => icon(svg, tip).repeat(n ?? 0);

function icons(ev: PlayerEvents) {
  return {
    subs:
      (ev.on ? icon(subSvg(true), `Came on · played ${plural(ev.min ?? 0, 'minute')}`) : '') +
      (ev.off ? icon(subSvg(false), `Taken off after ${plural(ev.min ?? 0, 'minute')}`) : ''),
    cards: times(ev.yellow, cardSvg(false), 'Yellow card') + times(ev.red, cardSvg(true), 'Red card'),
    assists: times(ev.assists, bootSvg(), 'Assist'),
    goals: times(ev.goals, ballSvg(), 'Goal') + times(ev.ownGoals, ownGoalSvg, 'Own goal') + times(ev.pensSaved, gloveSvg, 'Penalty saved'),
    missed: times(ev.pensMissed, missSvg, 'Penalty missed'),
  };
}

export function eventSlots(ev: PlayerEvents | undefined): EventSlots {
  if (!ev) return {};
  const { subs, cards, assists, goals, missed } = icons(ev);
  return { topLeft: subs, middleLeft: cards, middleRight: missed, bottomLeft: assists, bottomRight: goals };
}

export function eventRow(ev: PlayerEvents | undefined) {
  if (!ev) return '';
  const { subs, cards, assists, goals, missed } = icons(ev);
  const all = subs + assists + goals + cards + missed;
  return all ? `<span class="ev-row">${all}</span>` : '';
}

// The season's best XI counts goals and assists instead, in pills.
export function totalSlots(goals: number, assists: number, starts: number): EventSlots {
  const pill = (svg: string, n: number, what: string) =>
    `<span class="ev-total" data-tip="${plural(n, what)} in ${plural(starts, 'start')}">${svg}${n}</span>`;
  return {
    bottomLeft: assists ? pill(bootSvg('var(--text)'), assists, 'assist') : '',
    bottomRight: goals ? pill(ballSvg('var(--text)', 'transparent'), goals, 'goal') : '',
  };
}
