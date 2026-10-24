// Escaping, numbers and dates.

import type { Price } from '../shared/data.ts';
import { state } from './state.ts';

export function esc(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const maxOf = <T>(items: T[], score: (item: T) => number) =>
  items.reduce<T | undefined>((best, item) => (best === undefined || score(item) > score(best) ? item : best), undefined);
export const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
export const pct = (p: number) => `${Math.round(p * 100)}%`;
export const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
export function ordinal(n: number) {
  const v = n % 100;
  const suffix = ['th', 'st', 'nd', 'rd'][(v - 20) % 10] || ['th', 'st', 'nd', 'rd'][v] || 'th';
  return `${n}${suffix}`;
}

const dateFormat = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, options);
export const fmtDay = dateFormat({ weekday: 'long', day: 'numeric', month: 'long' });
export const fmtDate = dateFormat({ day: 'numeric', month: 'long', year: 'numeric' });
export const fmtShortDay = dateFormat({ weekday: 'short', day: 'numeric', month: 'short' });
export const fmtWeekday = dateFormat({ weekday: 'short' });
export const fmtTime = dateFormat({ hour: '2-digit', minute: '2-digit' });
export const fmtStamp = dateFormat({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function ago(iso: string) {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [unit, size] of units) if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  return 'just now';
}

export function countdown(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  const days = Math.floor(ms / 864e5);
  const hours = Math.floor(ms / 36e5) % 24;
  const minutes = Math.floor(ms / 6e4) % 60;
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function priceText(price: Price) {
  return state.odds === 'fractional' ? price.frac : price.dec.toFixed(2);
}
