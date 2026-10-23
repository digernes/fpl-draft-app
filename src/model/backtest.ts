// How well the model forecasts the gameweeks already played: for each one from the third,
// it learns from the gameweeks before, forecasts it and is scored against the points that
// came, next to two benchmarks: FPL's expected points as they stood at that deadline (its
// form: the average over the gameweeks of the 30 days before) and points per gameweek so
// far. Run it with `node src/model/backtest.ts`, from the cache `npm run data -- --cache
// .cache` keeps, or `--cache <dir>`; it fetches whatever isn't cached.

import { parseArgs } from 'node:util';

import { fetchLeague } from '../build/api.ts';
import { POSITIONS } from '../build/config.ts';
import { modelInput } from '../build/expected.ts';
import { readSeason, type Season } from '../build/season.ts';
import { DEFAULT_OPTIONS, forecast, type ModelOptions } from './forecast.ts';
import { PARTS, readScoring, type Parts } from './points.ts';

export interface Score {
  n: number;
  mae: number;
  rmse: number;
  /** Mean forecast minus mean points: positive when too high. */
  bias: number;
}

/**
 * Who is scored: the league's squads that gameweek, everyone who had played before it,
 * and everyone who played 60 minutes or more in it (the usual benchmark, though it
 * picks the players after the fact).
 */
export const POPULATIONS = ['squads', 'played', 'sixty'] as const;
type Population = (typeof POPULATIONS)[number];
type Method = 'model' | 'form' | 'perGw';
const METHODS: Method[] = ['model', 'form', 'perGw'];
type Tally = Record<(typeof PARTS)[number] | 'other', { forecast: number; actual: number }>;

export interface Backtest {
  /** By gameweek, then overall: the model and both benchmarks for each population. */
  rows: ({ gw: number | 'all' } & Record<Population, Record<Method, Score>>)[];
  /** The model's parts against what came, summed for each population. */
  parts: Record<Population, Tally>;
}

export function backtest(season: Season, options: ModelOptions = DEFAULT_OPTIONS, from = 3): Backtest {
  const input = modelInput(season);
  const scoring = readScoring(input.scoring);
  const deadline = (gw: number) => Date.parse(season.events.find((e) => e.id === gw)!.deadline_time);
  const tally = () => Object.fromEntries([...PARTS, 'other'].map((part) => [part, { forecast: 0, actual: 0 }])) as Tally;
  const parts = Object.fromEntries(POPULATIONS.map((p) => [p, tally()])) as Record<Population, Tally>;
  const weeks: Record<Population, Record<Method, [number, number][]>>[] = [];
  const gws = season.finishedGws.filter((gw) => gw >= from);

  for (const gw of gws) {
    const forecasts = forecast(input, gw, season.live[gw].fixtures, options);
    const before = season.finishedGws.filter((g) => g < gw);
    const window = before.filter((g) => deadline(gw) - deadline(g) < 30 * 864e5);
    const average = (gameweeks: number[]) => (pid: number) =>
      gameweeks.length ? gameweeks.reduce((t, g) => t + season.pointsIn(pid, g), 0) / gameweeks.length : 0;
    const guesses: Record<Method, (pid: number) => number> = {
      model: (pid) => forecasts.points.get(pid) ?? 0,
      form: average(window),
      perGw: average(before),
    };
    const minutes = (g: number) => Object.entries(season.live[g].elements).map(([id, e]) => [Number(id), e.stats.minutes] as const);
    const who: Record<Population, Set<number>> = {
      squads: new Set(Object.values(season.picks).flatMap((byGw) => byGw[gw]?.picks.map((p) => p.element) ?? [])),
      played: new Set(before.flatMap((g) => minutes(g).flatMap(([pid, m]) => (m > 0 ? [pid] : [])))),
      sixty: new Set(minutes(gw).flatMap(([pid, m]) => (m >= 60 ? [pid] : []))),
    };
    const fresh = (): Record<Method, [number, number][]> => ({ model: [], form: [], perGw: [] });
    const week = { squads: fresh(), played: fresh(), sixty: fresh() };
    for (const population of POPULATIONS) {
      for (const pid of who[population]) {
        const actual = season.pointsIn(pid, gw);
        for (const method of METHODS) week[population][method].push([guesses[method](pid), actual]);
        const mine = forecasts.parts.get(pid);
        const got = actualParts(season, scoring, pid, gw);
        for (const part of PARTS) {
          parts[population][part].forecast += mine?.[part] ?? 0;
          parts[population][part].actual += got[part];
        }
        parts[population].other.actual += actual - PARTS.reduce((t, part) => t + got[part], 0);
      }
    }
    weeks.push(week);
  }

  const score = (list: [number, number][]): Score => {
    const n = list.length || 1;
    const errors = list.map(([f, a]) => f - a);
    return {
      n: list.length,
      mae: errors.reduce((t, e) => t + Math.abs(e), 0) / n,
      rmse: Math.sqrt(errors.reduce((t, e) => t + e * e, 0) / n),
      bias: errors.reduce((t, e) => t + e, 0) / n,
    };
  };
  const scored = (gw: number | 'all', pick: (p: Population, m: Method) => [number, number][]) => ({
    gw,
    ...(Object.fromEntries(POPULATIONS.map((p) => [p, Object.fromEntries(METHODS.map((m) => [m, score(pick(p, m))]))])) as Record<
      Population,
      Record<Method, Score>
    >),
  });
  return {
    rows: [...weeks.map((week, i) => scored(gws[i], (p, m) => week[p][m])), scored('all', (p, m) => weeks.flatMap((w) => w[p][m]))],
    parts,
  };
}

// What a player's points in a gameweek were made of, in the model's parts.
function actualParts(season: Season, s: ReturnType<typeof readScoring>, pid: number, gw: number): Parts {
  const e = season.live[gw].elements[pid];
  const pos = POSITIONS[season.elements.get(pid)?.element_type ?? 0];
  const got = Object.fromEntries(PARTS.map((part) => [part, 0])) as Parts;
  if (!e || !pos) return got;
  for (const [stats] of e.explain ?? []) {
    const value = (stat: string) => stats.find((x) => x.stat === stat)?.value ?? 0;
    const minutes = value('minutes');
    if (minutes > 0) got.appearance += minutes >= s.longPlayLimit ? s.longPlay : s.shortPlay;
    got.goals += s.goal[pos] * value('goals_scored');
    got.assists += s.assist * value('assists');
    got.cleanSheet += s.cleanSheet[pos] * value('clean_sheets');
    got.conceded += s.conceded[pos] * Math.floor(value('goals_conceded') / s.concedeLimit);
    if (stats.some((x) => x.stat === 'defensive_contribution')) got.defcon += s.defcon[pos];
    got.saves += s.saves * Math.floor(value('saves') / s.savesLimit);
    got.bonus += value('bonus');
    got.cards += s.yellow * value('yellow_cards');
  }
  return got;
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { cache: { type: 'string', default: '.cache' }, league: { type: 'string', default: '23793' } } });
  const season = readSeason(await fetchLeague(Number(values.league), values.cache));
  const { rows, parts } = backtest(season);
  const cell = (s: Score) => `${s.mae.toFixed(2)} / ${s.rmse.toFixed(2)} / ${s.bias >= 0 ? '+' : ''}${s.bias.toFixed(2)}`;
  const titles: Record<Population, string> = {
    squads: "The league's squads (15 each)",
    played: 'Everyone who has played this season',
    sixty: 'Everyone who played 60 minutes or more that gameweek',
  };
  console.log('MAE / RMSE / bias per player and gameweek: model, FPL form, points per gameweek');
  for (const population of POPULATIONS) {
    console.log(`\n${titles[population]}`);
    for (const r of rows) {
      const s = r[population];
      console.log(
        `  GW ${String(r.gw).padEnd(3)} n=${String(s.model.n).padEnd(4)} ${cell(s.model).padEnd(22)} ${cell(s.form).padEnd(22)} ${cell(s.perGw)}`,
      );
    }
  }
  console.log(`\nParts, forecast against actual: ${POPULATIONS.map((p) => titles[p].toLowerCase()).join('; ')}`);
  for (const part of [...PARTS, 'other'] as const) {
    const pair = (x: { forecast: number; actual: number }) => `${x.forecast.toFixed(0).padStart(5)} ${x.actual.toFixed(0).padStart(5)}`;
    console.log(`  ${part.padEnd(11)} ${POPULATIONS.map((p) => pair(parts[p][part])).join('   ')}`);
  }
}
