// The live projection shared by the page: where a lineup's points are heading while a
// gameweek is played, from what each player can still add and the bench who'd come on.

import { PL_STATS, type Formation, type PlStats, type Position, type XpParts } from './data.ts';
import {
  canReplace,
  clubFixtures,
  DEFAULT_FORMATION,
  isOn,
  minutesOf,
  offIn,
  pointsOf,
  provisionalBonus,
  type Named,
  type PlayerInfo,
  type Scored,
  type SlimFixture,
  type SlimLive,
} from './live.ts';
import { jumpsMean, normalCdf, type Jump } from './odds.ts';

/** Spread of one player's points over a full gameweek, for the live odds. */
export const PLAYER_POINTS_SD = 3;

/**
 * What a player will almost surely still add for each match he has left, for the live odds'
 * floor: nothing should he not play, and a point for it should he, so nothing. What he can
 * lose all at once, a card or an own goal, comes as its own chance (rareDrops), and a clean
 * sheet at stake as another (liveProjection).
 */
export const PLAYER_FLOOR = 0;

/**
 * A player's chances of a yellow card (one that stays yellow), a red (second yellows among
 * them) and an own goal over a full match: this season's, 296, 14 and 10 in about 1,670
 * matches' worth of players' minutes over the first eight gameweeks.
 */
export const YELLOW_CARD_RATE = 0.178;
export const RED_CARD_RATE = 0.008;
export const OWN_GOAL_RATE = 0.006;

/** Where a player stands for his drops: booked already, or yet to play, when the point for playing comes with any of them. */
export type Standing = 'booked' | 'yet to play' | undefined;

/**
 * A player's drops for the share of a full match he has still to play, by FPL's rules: his
 * cards, a yellow or a red (one already booked can only be sent off, and loses his yellow's
 * point back, as FPL scores a second yellow), and an own goal. One yet to play has the point
 * for playing with any of them, so a yellow costs him nothing below the floor.
 */
export function rareDrops(share: number, rules: Record<string, number> = {}, standing?: Standing): Jump[] {
  if (!(share > 0)) return [];
  const played = standing === 'yet to play' ? (rules.short_play ?? 1) : 0;
  const [yellow, red] = [rules.yellow_cards ?? -1, rules.red_cards ?? -3];
  const card = (points: number, rate: number) => (points + played < 0 ? [{ points: points + played, chance: rate * share }] : []);
  return [
    standing === 'booked' ? card(red - yellow, RED_CARD_RATE) : [...card(yellow, YELLOW_CARD_RATE), ...card(red, RED_CARD_RATE)],
    card(rules.own_goals ?? -2, OWN_GOAL_RATE),
  ];
}

/** A player's floor and drops for the share of a full match he has still to play (see rareDrops). */
export const stillToPlay = (share: number, rules?: Record<string, number>, standing?: Standing) => ({
  floor: PLAYER_FLOOR * share,
  jumps: rareDrops(share, rules, standing),
});

const RULED_OUT = new Set(['i', 's', 'u', 'n']);

/** What a projection knows of each player's gameweek. */
export interface Expected {
  /** His expected points for the whole gameweek. */
  points: (id: number) => number;
  /** Those taken apart, when the site's model gave them: his minutes, and his appearance, clean-sheet, defensive-contribution and bonus points among them. */
  parts?: (id: number) => XpParts | undefined;
  /** Points for a clean sheet, by position. */
  cleanSheet?: Partial<Record<Position, number>>;
  /** Who each club has named for its fixtures, once the Premier League has the teams. */
  named?: Named;
  /** FPL's scoring rules (meta.rules), for the defensive contribution's threshold and points. */
  rules?: Record<string, number>;
  /** A match's stats as they stand while it's played, each player's in PL_STATS order; the relay's stand in without them. */
  stats?: (fixture: number) => MatchStats | undefined;
}

type MatchStats = PlStats['matches'][string];

// A substitute comes on in about two matches in three, for a point or so, and the later it
// gets the less likely: from half an hour before the end the chance fades. Once his club has
// named him among its substitutes, his position says more: a forward comes on three times
// in four, a midfielder three in five, a defender two in five and a keeper hardly ever.
// (From the clubs' named substitutes this season, those expected to score at all.)
const SUB_ON = 0.65;
const NAMED_SUB_ON: Record<Position, number> = { GKP: 0.02, DEF: 0.4, MID: 0.6, FWD: 0.75 };
const SUB_POINTS = 1.3;
const subOn = (named: ReturnType<Named>, pos: Position | undefined) => (named === 'bench' ? NAMED_SUB_ON[pos ?? 'MID'] : SUB_ON);

// Once named to start, a player who often comes on or goes off early still plays about 75
// minutes (a keeper the whole match) and reaches the hour 86% of the time, as this season's
// named starters have: more than his expected minutes given he plays, which count his
// appearances from the bench too.
const STARTER = { minutes: 75, keeper: 90, hour: 0.86 };
const stillToCome = (minute: number) => Math.min(1, Math.max(0, (90 - minute) / 30)) ** 0.7;

// The chance he plays at all, from his expected appearance points (2 for a regular). As
// this season's players have: one expected to earn 1.5 plays about 86% of the time, and
// even the surest only about 95%.
const playsGiven = (appearance: number) => Math.min(0.95, Math.max(0, appearance / 2) ** 0.6);

// His chance of reaching 60 minutes should he play, from his expected appearance points.
const hourGiven = (appearance: number, plays: number) => Math.min(1, Math.max(0.1, appearance / Math.max(plays, 0.01) - 1));

// A named starter's expected points and their parts: those given he plays, with a starter's
// minutes and chance of the hour where his own fall short. What comes at a rate a minute
// grows with the minutes, the clean sheet with the hour; a regular's stay as they were.
function asStarter(ep: number, parts: XpParts, pos: Position | undefined): [number, XpParts] {
  const plays = Math.max(playsGiven(parts[1]), 0.01);
  const given = parts.map((v) => v / plays) as XpParts;
  const [minutes, appearance, , , , cleanSheet] = given;
  const hour = hourGiven(parts[1], plays);
  const h = Math.max(hour, STARTER.hour);
  const least = pos === 'GKP' ? STARTER.keeper : STARTER.minutes;
  const longer = minutes > 0 ? Math.max(1, least / minutes) : 1;
  const starts = given.map((v) => v * longer) as XpParts;
  starts[0] = Math.max(minutes, least);
  starts[1] = h > hour ? 1 + h : appearance;
  starts[5] = cleanSheet * (h / hour);
  const points = ep / plays + (longer - 1) * (ep / plays - appearance - cleanSheet) + (starts[1] - appearance) + (starts[5] - cleanSheet);
  return [points, starts];
}

// Goals come more often as a match goes on, about 56% of them after half-time: the share
// of a match's goals (and of all that comes of them) still to come at a minute.
const stillToScore = (minute: number) => {
  const gone = Math.min(1, Math.max(0, minute / 90));
  return (1 - gone) * (1 + gone / 4);
};

/**
 * What a player can still add to his points, by where it would come from: keyed as FPL's
 * stats are (as the points so far are taken apart on the page), from playing to cards as
 * his expected points' parts are; `coming_on` for a substitute's chance of coming on,
 * `expected` for expected points that come whole (FPL's), and `other` for any without parts.
 */
export type ToCome = Partial<Record<ToComeKey, number>>;
type ToComeKey = (typeof PART_KEYS)[number] | 'coming_on' | 'expected' | 'other';

// XpParts' points, from playing on, in their order.
const PART_KEYS = [
  'minutes',
  'goals_scored',
  'penalties',
  'assists',
  'clean_sheets',
  'goals_conceded',
  'defensive_contribution',
  'saves',
  'bonus',
  'cards',
] as const;
const partsOf = (parts: XpParts) => PART_KEYS.map((key, i): [ToComeKey, number] => [key, parts[i + 1]]);

// `total` taken apart by the parts it comes from, each worth `scale` times its own: what they
// don't account for (expected points come in tenths, their parts in hundredths) shared out by
// their size, so that they add up to it without one changing sign.
function apart(total: number, weights: [ToComeKey, number][], scale = 1): ToCome {
  const size = weights.reduce((t, [, w]) => t + Math.abs(w), 0);
  if (!size) return total ? { other: total } : {};
  const left = total - scale * weights.reduce((t, [, w]) => t + w, 0);
  return Object.fromEntries(weights.flatMap(([key, w]) => (w ? [[key, scale * w + (left * Math.abs(w)) / size]] : [])));
}

function together(all: ToCome[]): ToCome {
  const sum: ToCome = {};
  for (const one of all) for (const [key, x] of Object.entries(one) as [ToComeKey, number][]) sum[key] = (sum[key] ?? 0) + x;
  return sum;
}

/** Where a player's gameweek is heading. */
interface Outlook {
  /** What he can still add to his points, and the same by where it would come from. */
  add: number;
  toCome: ToCome;
  /** The chance he doesn't play at all, when the bench player next in line comes on for him. */
  absent: number;
  /** How much of his gameweek is still to come, for the spread. */
  share: number;
  /** What he'll almost surely still add (none, or less should he be expected to lose some), for the live odds' floor. */
  floor: number;
  /** His rare drops still to come: a red card and an own goal. */
  jumps?: Jump[];
  /** His clean sheets at stake in matches on. */
  stakes?: Stake[];
}

/** A match's bonus while it's on: each player's as it stands, and as the BPS race would leave it by full time. */
interface BonusRace {
  now: Map<number, number>;
  end: Map<number, number>;
}

// The BPS as they stand in a match being played: FPL's list while its bonus is still to
// come, or once FPL has put a live bonus in its points, the relay's stats for the match.
function bonusRace(f: SlimFixture, feed: SlimLive): BonusRace | undefined {
  if (f.bps?.length) return { now: provisionalBonus([f]), end: raceEnd(f, f.bps) };
  const rows = Object.entries(feed.matches?.[f.id] ?? {});
  const at = (name: (typeof PL_STATS)[number]) => PL_STATS.indexOf(name);
  const bps = rows.flatMap(([pid, r]): [number, number][] => (r[at('bps')] == null ? [] : [[Number(pid), r[at('bps')]!]]));
  if (!bps.length) return undefined;
  return { now: new Map(rows.map(([pid, r]) => [Number(pid), r[at('bonus')] ?? 0])), end: raceEnd(f, bps) };
}

// Each player's bonus by full time, from his chance of finishing first, second or third in
// the BPS: from his gap to each of the others and how far theirs and his can still move. One
// player's BPS varies by about 12 from one full match to the next (this season's, for those
// who played them through), so that much over a whole match, less as it runs down (as goals
// do); one who has gone off has his for good. BPS come in whole points, and those level at
// the end share the place, so another has to finish at least one ahead.
const BPS_SWING = 12;

function raceEnd(f: SlimFixture, bps: [number, number][]): Map<number, number> {
  const share = stillToScore(f.min ?? 0);
  const swing = (id: number) => (offIn(f, id) ? 0 : BPS_SWING ** 2 * share);
  const end = new Map<number, number>();
  for (const [id, his] of bps) {
    // The chances that none, one or two of the others finish ahead of him.
    let [none, one, two] = [1, 0, 0];
    for (const [other, theirs] of bps) {
      if (other === id) continue;
      const sd = Math.sqrt(swing(id) + swing(other));
      const ahead = sd > 0 ? normalCdf((theirs - his - 0.5) / sd) : theirs > his ? 1 : 0;
      [none, one, two] = [none * (1 - ahead), one * (1 - ahead) + none * ahead, two * (1 - ahead) + one * ahead];
    }
    end.set(id, 3 * none + 2 * one + two);
  }
  return end;
}

/** What a player on the pitch would lose should his club concede before the end, and the chance it does. */
interface Stake {
  /** The match and the club, whose players on the pitch all lose it to the same goal. */
  key: string;
  points: number;
  concede: number;
}

/** A player in one of his club's fixtures not yet over, as fixtureOutlook sees him. */
interface InFixture {
  id: number;
  f: SlimFixture;
  /** His minutes this gameweek, and the match's (0 until kick-off). */
  played: number;
  minute: number;
  /** His expected points for the fixture, and their parts when the site's model gave them. */
  ep: number;
  parts: XpParts | undefined;
  /** The chance he plays at all. */
  plays: number;
  named: ReturnType<Named>;
  /** His bonus in the match as it stands, and its BPS race while it's on. */
  bonusNow: number;
  race: BonusRace | undefined;
  /** He came on as a substitute this gameweek, so stays on to the end. */
  cameOn: boolean;
  /** His defensive contributions so far in the match, when its stats have them. */
  defcons: number | undefined;
  /** He has a yellow card, so a red would cost him less. */
  booked: boolean;
}

/** What fixtureOutlook knows of the feed and the player beyond the fixture. */
interface FixtureContext {
  bonus: Map<number, number>;
  races: Map<number, BonusRace>;
  events?: SlimLive['events'];
  matches?: SlimLive['matches'];
  cameOn: boolean;
}

const DEFCON = PL_STATS.indexOf('defensive_contribution');
const YELLOW = PL_STATS.indexOf('yellow_cards');

// His defensive contributions so far in a match, from its stats as they stand: none while
// he isn't in them yet, and unknown without them, or for one who has played twice that
// gameweek, whose FPL counts for the whole week.
function defconsIn(stats: MatchStats | undefined, id: number) {
  if (!stats) return undefined;
  const row = stats[id];
  return row ? (row[DEFCON] ?? undefined) : 0;
}

// Whether he has a yellow card in a match: from its stats as they stand, or without his row
// there, from what he did in the gameweek.
const bookedIn = (stats: MatchStats | undefined, id: number, ctx: FixtureContext) =>
  (stats?.[id]?.[YELLOW] ?? ctx.events?.[id]?.yellow ?? 0) > 0;

// One on the pitch whose point for playing the feed doesn't have yet will have it with any drop.
const standingOf = (p: InFixture): Standing => (p.booked ? 'booked' : p.played ? undefined : 'yet to play');

// His bonus in a match as it stands: FPL's live bonus or the top three BPS.
const bonusAsItStands = (id: number, f: SlimFixture, race: BonusRace | undefined, ctx: FixtureContext) =>
  race?.now.get(id) ?? (f.bps ? ctx.bonus.get(id) : ctx.events?.[id]?.bonus) ?? 0;

// One fixture's outlook for a player with `played` minutes so far, from his expected
// points and their parts for it. Before kick-off: those, or once his club has named its
// team, what a starter can expect (asStarter) or a substitute at his position.
// Once it's on, if he's on the pitch: his goals, assists and the rest at his rate a minute
// for the time he's likely to stay on, the appearance point still to come at 60 minutes,
// the chance of keeping (or still getting) a clean sheet and of reaching the defensive
// contribution's threshold from those he has made, and his bonus as the BPS race would
// leave it. All of it starts at kick-off where a starter's expected points left it.
// If he isn't on the pitch, the chance he still comes on; once he's gone off, only the race
// can change his points. FPL's own expected points come whole, so without the parts a
// player on the pitch has a share of them.
function fixtureOutlook(
  id: number,
  f: SlimFixture,
  played: number,
  [ep, parts]: [number, XpParts | undefined],
  info: PlayerInfo,
  expected: Expected,
  ctx: FixtureContext,
): Outlook {
  if (f.done) return { add: 0, toCome: {}, absent: played > 0 ? 0 : 1, share: 0, floor: 0 };
  const race = ctx.races.get(f.id);
  const bonusNow = bonusAsItStands(id, f, race, ctx);
  if (offIn(f, id)) {
    const add = race ? (race.end.get(id) ?? bonusNow) - bonusNow : 0;
    return { add, toCome: { bonus: add }, absent: 0, share: 0, floor: 0 };
  }
  const named = expected.named?.(id, f.id);
  // A named starter's are a starter's, and he plays for sure.
  const starter = named === 'xi' && parts ? asStarter(ep, parts, info(id).pos) : undefined;
  const stats = expected.stats?.(f.id) ?? ctx.matches?.[f.id];
  const p: InFixture = {
    id,
    f,
    played,
    minute: f.started ? (f.min ?? 0) : 0,
    ep: starter?.[0] ?? ep,
    parts: starter?.[1] ?? parts,
    plays: parts && !starter ? playsGiven(parts[1]) : 1,
    named,
    bonusNow,
    race,
    cameOn: ctx.cameOn,
    defcons: defconsIn(stats, id),
    booked: bookedIn(stats, id, ctx),
  };
  return f.started ? inPlay(p, info, expected) : beforeKickOff(p, info, expected.rules);
}

function beforeKickOff({ id, named, ep, parts, plays }: InFixture, info: PlayerInfo, rules: Expected['rules']): Outlook {
  const { pos, status } = info(id);
  if (named === 'out') return { add: 0, toCome: {}, absent: 1, share: 0, floor: 0 };
  const sub = subOn(named, pos);
  const share = named === 'bench' ? sub : 1;
  const rest = { share, ...stillToPlay(share, rules, 'yet to play') };
  if (named === 'bench') return { add: sub * SUB_POINTS, toCome: { coming_on: sub * SUB_POINTS }, absent: 1 - sub, ...rest };
  const toCome = parts ? apart(ep, partsOf(parts)) : { expected: ep };
  if (named === 'xi') return { add: ep, toCome, absent: 0, ...rest };
  // Until then a manager has picked him knowing the news, so only FPL's doubt counts.
  return { add: ep, toCome, absent: status === 'd' ? 1 - plays : 0, ...rest };
}

function inPlay(p: InFixture, info: PlayerInfo, expected: Expected): Outlook {
  const onPitch = p.played > 0 || (p.named === 'xi' && p.minute < 3); // the feed's minutes lag at kick-off
  if (!onPitch) return p.minute < 3 ? beforeKickOff(p, info, expected.rules) : fromTheBench(p, info(p.id).pos, expected.rules);
  if (!p.parts) {
    const share = stillToScore(p.minute);
    const add = p.ep * share;
    return { add, toCome: { expected: add }, absent: 0, share, ...stillToPlay(share, expected.rules, standingOf(p)) };
  }
  return onPitchOutlook(p, p.parts, info, expected);
}

function fromTheBench({ named, minute }: InFixture, pos: Position | undefined, rules: Expected['rules']): Outlook {
  if (named === 'out') return { add: 0, toCome: {}, absent: 1, share: 0, floor: 0 };
  const comesOn = subOn(named, pos) * stillToCome(minute);
  const add = comesOn * SUB_POINTS;
  const share = (comesOn * Math.max(0, 90 - minute)) / 90;
  return { add, toCome: { coming_on: add }, absent: 1 - comesOn, share, ...stillToPlay(share, rules, 'yet to play') };
}

/** How long a player on the pitch is likely to stay on, and his chance of reaching 60 minutes. */
interface Staying {
  /** The minutes he's likely on from kick-off, weighted by when goals come, and from now. */
  from: number;
  onFor: number;
  /** The minutes he still needs for 60, by his expected points his chance of the hour if he plays, and of getting there now. */
  need: number;
  hour: number;
  sixty: number;
}

function onPitchOutlook(p: InFixture, parts: XpParts, info: PlayerInfo, expected: Expected): Outlook {
  const [minutes, appearance, , , , cleanSheet, , defcon, , bonus] = parts;
  const stays = p.cameOn ? 1 : Math.min(1, minutes / Math.max(p.plays, 0.01) / 90);
  const from = 90 * stays;
  const onFor = from * stillToScore(p.minute);
  const rest = p.ep - appearance - cleanSheet - bonus;
  const defcons = defconToCome(p, defcon, minutes, from, info(p.id).pos, expected.rules);
  const rate = minutes > 0 ? ((defcons === undefined ? rest : rest - defcon) / minutes) * onFor : 0;
  let add = rate;
  add += defcons ?? 0;
  // A point for playing, one the feed may not have given him yet, and another at 60 minutes.
  if (!p.played) add += 1;
  const hour = hourGiven(appearance, p.plays);
  const need = 60 - Math.min(p.played, p.minute); // a double gameweek's other match aside
  const sixty = reachesSixty(hour, need, Math.max(0, 90 - p.minute));
  if (need > 0) add += sixty;
  const kept = cleanSheetOutlook(p, cleanSheet, info, expected, { from, onFor, need, hour, sixty });
  if (kept) add += kept.add;
  const still = stillToScore(p.minute);
  const bonusAdd = bonusToCome(p, bonus / Math.max(p.plays, 0.01), still);
  add += bonusAdd;
  // The same apart: the rate a minute is his goals, assists and the rest of his parts', each at its own.
  const byRate = partsOf(parts).filter(([key]) => !NOT_BY_RATE.has(key) && !(key === 'defensive_contribution' && defcons !== undefined));
  const toCome = together([
    minutes > 0 ? apart(rate, byRate, onFor / minutes) : {},
    {
      minutes: (p.played ? 0 : 1) + (need > 0 ? sixty : 0),
      clean_sheets: kept?.add ?? 0,
      bonus: bonusAdd,
      ...(defcons === undefined ? {} : { defensive_contribution: defcons }),
    },
  ]);
  return { add, toCome, absent: 0, share: still, ...stillToPlay(still, expected.rules, standingOf(p)), stakes: kept ? [kept.stake] : [] };
}

// The parts that come at their own times rather than at a rate a minute.
const NOT_BY_RATE = new Set<ToComeKey>(['minutes', 'clean_sheets', 'bonus']);

// The defensive contribution, taken as the clean sheet is: FPL gives its points once he
// reaches a threshold of defensive actions in the match, so nothing more once he has (they're
// in his points), and otherwise the chance he still gets there from those he has made. His
// rate of them is the one that gives his expected part for the time he's likely on from
// kick-off, so at kick-off he has that part as before; they come about evenly through a
// match, not as goals do. Without his count, it stays in his rate a minute.
function defconToCome(
  p: InFixture,
  defcon: number,
  minutes: number,
  from: number,
  pos: Position | undefined,
  rules = {} as Record<string, number>,
) {
  const limit = rules[`defensive_contribution_limit_${pos}`] ?? 0;
  const points = rules[`defensive_contribution_${pos}`] ?? 0;
  if (p.defcons === undefined || !(limit > 0 && points > 0 && defcon > 0 && minutes > 0)) return undefined;
  if (p.defcons >= limit) return 0;
  const reaches = Math.min(0.999, ((defcon / minutes) * from) / points);
  const left = poissonMeanFor(limit, reaches) * Math.max(0, 1 - p.minute / 90); // the actions he's likely still to make
  return points * atLeast(limit - p.defcons, left);
}

// The chance of `k` or more from a Poisson count with mean `mean`.
function atLeast(k: number, mean: number) {
  let [term, below] = [Math.exp(-mean), 0];
  for (let i = 0; i < k; i++) {
    below += term;
    term *= mean / (i + 1);
  }
  return Math.max(0, 1 - below);
}

// The Poisson mean that reaches `k` with chance `chance` (below 1), by bisection: cheap
// enough for every player on the pitch at every poll.
function poissonMeanFor(k: number, chance: number) {
  let [lo, hi] = [0, 4 * k + 20];
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (atLeast(k, mid) < chance) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// His chance of reaching 60 minutes with `need` still to play and `left` in the match: his
// chance of the hour if he plays, rising to 1 as he gets there.
const reachesSixty = (hour: number, need: number, left: number) => (need <= 0 ? 1 : need > left ? 0 : hour ** (need / 60));

const conceded = (f: SlimFixture, club: number | undefined) => f.score?.[f.h === club ? 1 : 0] ?? 0;

// A clean sheet he can still keep (or still get), while his club hasn't conceded: what it
// adds, and what a goal against would take from him.
function cleanSheetOutlook(p: InFixture, cleanSheet: number, info: PlayerInfo, expected: Expected, t: Staying) {
  const { pos, club } = info(p.id);
  const perCleanSheet = expected.cleanSheet?.[pos ?? 'FWD'] ?? 0;
  if (conceded(p.f, club) || !(perCleanSheet > 0 && cleanSheet > 0)) return undefined;
  // His chance of no goal against while he's on, as his expected clean sheet has it (that
  // needs the hour too), for the time he's still on.
  const unbeaten = Math.min(0.95, cleanSheet / perCleanSheet / Math.max(0.3, p.plays) / t.hour);
  const keepsIt = unbeaten ** (t.onFor / Math.max(t.from, 1));
  // A goal against takes the clean sheet, and with it a keeper's or defender's bonus as it stands.
  const atRisk = pos === 'GKP' || pos === 'DEF' ? p.bonusNow : 0;
  return {
    add: t.need <= 0 ? perCleanSheet * (keepsIt - 1) : perCleanSheet * t.sixty * keepsIt, // FPL shows it from 60 minutes
    stake: { key: `${p.f.id}:${club}`, points: perCleanSheet * t.sixty + atRisk, concede: 1 - keepsIt },
  };
}

// Bonus: where the BPS race would leave him, and for the time left a nudge towards his
// usual bonus from a fair share of the match's 6 among those in it. Without the race, his
// bonus as it stands drawn towards his usual by the share of the match still to come.
function bonusToCome({ id, race, bonusNow }: InFixture, usual: number, still: number) {
  if (!race) return still * (usual - bonusNow);
  const fair = 6 / Math.max(race.end.size, 22);
  return (race.end.get(id) ?? fair) + still * (usual - fair) - bonusNow;
}

// His outlook over the gameweek: each of his club's fixtures, two in a double gameweek with
// his expected points split between them, and he's absent only if he misses them all.
function outlook(
  id: number,
  feed: SlimLive,
  info: PlayerInfo,
  expected: Expected,
  { bonus, races }: { bonus: Map<number, number>; races: Map<number, BonusRace> },
): Outlook {
  const fixtures = clubFixtures(feed, info(id).club);
  if (!fixtures.length) return { add: 0, toCome: {}, absent: 1, share: 0, floor: 0 }; // a blank
  const played = minutesOf(feed, id);
  const n = fixtures.length;
  const parts = expected.parts?.(id)?.map((v) => v / n) as XpParts | undefined;
  const ctx = { bonus, races, events: feed.events, matches: feed.matches, cameOn: (feed.events?.[id]?.on ?? 0) > 0 };
  const each = fixtures.map((f) => fixtureOutlook(id, f, played, [expected.points(id) / n, parts], info, expected, ctx));
  const add = each.reduce((t, o) => t + o.add, 0);
  const jumps = each.flatMap((o) => o.jumps ?? []);
  const stakes = each.flatMap((o) => o.stakes ?? []);
  // Whatever he's expected to add once his drops are set aside, the floor is no higher: one
  // gone off whose bonus others are likely to overtake, a defender's goals against.
  const rest = add - jumpsMean(jumps) + stakes.reduce((t, s) => t + s.concede * s.points, 0);
  return {
    add,
    toCome: together(each.map((o) => o.toCome)),
    absent: played > 0 ? 0 : each.reduce((t, o) => t * o.absent, 1),
    share: each.reduce((t, o) => t + o.share, 0) / n,
    floor: Math.min(
      each.reduce((t, o) => t + o.floor, 0),
      rest,
    ),
    jumps,
    stakes,
  };
}

// A feed's provisional bonus and bonus races, worked out once for all who ask of it.
const contexts = new WeakMap<SlimLive, { bonus: Map<number, number>; races: Map<number, BonusRace> }>();
function contextOf(feed: SlimLive) {
  const known = contexts.get(feed);
  if (known) return known;
  const races = new Map(
    feed.fixtures.flatMap((f) => {
      const race = isOn(f) ? bonusRace(f, feed) : undefined;
      return race ? [[f.id, race] as const] : [];
    }),
  );
  const ctx = { bonus: provisionalBonus(feed.fixtures), races };
  contexts.set(feed, ctx);
  return ctx;
}

/**
 * Where one player's gameweek is heading, as liveProjection sees it: his points so far and
 * what he can still add, and that by where it would come from, for the page's tips.
 */
export function playerOutlook(id: number, feed: SlimLive, info: PlayerInfo, expected: Expected) {
  const ctx = contextOf(feed);
  const o = outlook(id, feed, info, expected, ctx);
  return { projected: pointsOf(feed, id) + (ctx.bonus.get(id) ?? 0) + o.add, toCome: o.toCome };
}

/** The same, the projection alone. */
export const playerProjection = (id: number, feed: SlimLive, info: PlayerInfo, expected: Expected) =>
  playerOutlook(id, feed, info, expected).projected;

// A lineup's clean sheets at stake, by match and club: one goal against costs every one of
// the club's players on the pitch at once, so their stakes add up before they're squared.
function addStakes(atStake: Map<string, { points: number; concede: number }>, o: Outlook, weight: number) {
  for (const { key, points, concede } of o.stakes ?? []) {
    const was = atStake.get(key);
    atStake.set(key, { points: (was?.points ?? 0) + weight * points, concede: Math.max(was?.concede ?? 0, concede) });
  }
}

// Each player's outlook, worked out once; whether he's sure not to play, with no minutes once
// his matches are over or ruled out by FPL; and the chance he doesn't play, when the bench
// player next in line comes on for him.
function lineupOutlooks(feed: SlimLive, info: PlayerInfo, expected: Expected) {
  const ctx = contextOf(feed);
  const outlooks = new Map<number, Outlook>();
  const outlookOf = (id: number) => outlooks.get(id) ?? outlooks.set(id, outlook(id, feed, info, expected, ctx)).get(id)!;
  const out = (id: number) => minutesOf(feed, id) === 0 && (outlookOf(id).share === 0 || RULED_OUT.has(info(id).status ?? ''));
  const missing = (id: number) => (out(id) ? 1 : minutesOf(feed, id) > 0 ? 0 : outlookOf(id).absent);
  return { outlookOf, out, missing };
}

// The bench as liveProjection calls on it, against the XI as it stands: the first who is
// free, may play and can come on for the starter, by the chance he's needed, so that each
// is called on once in all between the starters he stands in for.
function benchCalls(bench: number[], xi: number[], out: (id: number) => boolean, info: PlayerInfo, formation: Formation) {
  const free = new Map(bench.map((id) => [id, 1])); // how much of each is still to be called on
  return (starter: number, chance: number) => {
    const sub = bench.find((c) => (free.get(c) ?? 0) > 0 && !out(c) && canReplace(starter, c, xi, info, formation));
    if (sub === undefined) return undefined;
    const called = chance * free.get(sub)!;
    free.set(sub, free.get(sub)! - called);
    return { sub, called };
  };
}

// Where a lineup's score is heading: the points so far plus what each of the XI can still
// add (fixtureOutlook). A starter sure not to play, with no minutes once his matches are
// over or ruled out by FPL, has the bench player who'd come on for him by scoreLineup's
// rules counted instead, ahead of the auto-sub itself (which waits until that player has
// played); one who may not play has that player counted by the chance he won't. The spread
// is each player's for the share of his gameweek still to come, and a clean sheet at stake
// on top: all or nothing, and one goal against costs every one of the club's players on
// the pitch at once, so their stakes add up before they're squared. The floor is what the
// lineup will almost surely still have, for the live odds: the points so far and what each of
// the XI will almost surely add (Outlook's floor), or his bench player should he come on
// instead. Below it are the jumps, each a rare chance of losing points at once: each player's
// red card and own goal by the chance he plays, and each club's clean sheet at stake.
export function liveProjection(scored: Scored, feed: SlimLive, info: PlayerInfo, expected: Expected, formation = DEFAULT_FORMATION) {
  const { outlookOf, out, missing } = lineupOutlooks(feed, info, expected);
  const xi = [...scored.xi];
  const callOn = benchCalls(scored.bench, xi, out, info, formation);
  // A bench player, should he come on: his points so far and what he can still add.
  const worth = (id: number) => scored.points(id) + outlookOf(id).add;
  const atStake = new Map<string, { points: number; concede: number }>();
  const jumps: Jump[] = [];
  let mean = scored.pts;
  let variance = 0;
  let floor = scored.pts;
  // `weight` of a player: what he adds to the mean, and his spread for the share of his gameweek still to come.
  const count = (o: Outlook, weight: number, gain: number) => {
    mean += gain;
    variance += weight * o.share * PLAYER_POINTS_SD ** 2;
    addStakes(atStake, o, weight);
    for (const jump of o.jumps ?? []) jumps.push(jump.map(({ points, chance }) => ({ points, chance: weight * chance })));
  };
  for (const starter of scored.xi) {
    const sure = out(starter);
    const o = outlookOf(starter);
    if (!sure) count(o, 1, o.add);
    const chance = missing(starter);
    const call = chance > 0 ? callOn(starter, chance) : undefined;
    // The worst of him playing (or nobody, should he not), and his bench player coming on.
    const alone = sure ? 0 : o.floor;
    if (!call) {
      floor += alone;
      continue;
    }
    if (sure) xi.splice(xi.indexOf(starter), 1, call.sub);
    const gain = worth(call.sub) - (sure ? scored.points(starter) : 0);
    count(outlookOf(call.sub), call.called, call.called * gain);
    const subbed = gain - outlookOf(call.sub).add + outlookOf(call.sub).floor;
    floor += sure && call.called > 1 - 1e-9 ? subbed : Math.min(alone, subbed);
  }
  const stakes = [...atStake.values()];
  jumps.push(...stakes.map(({ points, concede }) => [{ points: -points, chance: concede }]));
  return {
    mean,
    variance: stakes.reduce((v, { points, concede }) => v + concede * (1 - concede) * points ** 2, variance),
    // Never above where the rest of the mean, the drops aside, puts it.
    floor: Math.min(floor, mean - jumpsMean(jumps)),
    jumps,
  };
}
