// Zod schemas for the FPL API responses the build and the live relay read. Only the
// fields in use are listed (Zod drops the rest), and anything the API leaves empty at
// some point in a season is nullable, so a parse failure means FPL really changed shape.

import { z } from 'zod';

const id = z.number().int();
/** Some numeric stats come back as strings ("0.45"). */
const numeric = z.union([z.number(), z.string()]);

// --- Draft: league/{id}/details ----------------------------------------------

export const LeagueDetails = z.object({
  league: z.object({
    name: z.string(),
    start_event: id,
    stop_event: id,
    draft_tz_show: z.string().nullish(),
  }),
  league_entries: z.array(
    z.object({
      id,
      /** Empty for a place nobody has joined yet. */
      entry_id: id.nullable(),
      entry_name: z.string(),
      short_name: z.string(),
      player_first_name: z.string(),
      player_last_name: z.string(),
      waiver_pick: z.number(),
    }),
  ),
  matches: z.array(
    z.object({
      event: id,
      league_entry_1: id,
      league_entry_2: id,
      league_entry_1_points: z.number(),
      league_entry_2_points: z.number(),
      started: z.boolean(),
      finished: z.boolean(),
    }),
  ),
  standings: z.array(
    z.object({
      league_entry: id,
      rank: z.number(),
      last_rank: z.number().nullable(),
      matches_won: z.number(),
      matches_drawn: z.number(),
      matches_lost: z.number(),
      points_for: z.number(),
      points_against: z.number(),
      total: z.number(),
    }),
  ),
});

// --- Draft: bootstrap-static -------------------------------------------------

export const Fixture = z.object({
  id,
  team_h: id,
  team_a: id,
  started: z.boolean().nullable(),
  finished: z.boolean(),
  finished_provisional: z.boolean(),
  team_h_score: z.number().nullable(),
  team_a_score: z.number().nullable(),
});

const positionLimits = Object.fromEntries(
  ['GKP', 'DEF', 'MID', 'FWD'].flatMap((pos) => [
    [`min_play_${pos}`, z.number()],
    [`max_play_${pos}`, z.number()],
  ]),
) as Record<`${'min' | 'max'}_play_${'GKP' | 'DEF' | 'MID' | 'FWD'}`, z.ZodNumber>;

export const Bootstrap = z.object({
  events: z.object({
    data: z.array(
      z.object({
        id,
        finished: z.boolean(),
        deadline_time: z.string(),
        waivers_time: z.string().nullable(),
        trades_time: z.string().nullable(),
      }),
    ),
  }),
  elements: z.array(
    z.object({
      id,
      code: id,
      team: id,
      element_type: z.number(),
      web_name: z.string(),
      first_name: z.string(),
      second_name: z.string(),
      total_points: z.number(),
      status: z.string(),
      news: z.string().nullish(),
      form: numeric.nullish(),
      chance_of_playing_next_round: z.number().nullable(),
    }),
  ),
  teams: z.array(z.object({ id, code: id, name: z.string(), short_name: z.string() })),
  /** Upcoming fixtures by gameweek. */
  fixtures: z.record(z.string(), z.array(Fixture)).nullish(),
  settings: z.object({
    league: z.object({ h2h_win: z.number(), h2h_draw: z.number(), h2h_lose: z.number() }),
    // Points per position are looked up by name (goals_scored_DEF and so on).
    scoring: z.object({ long_play_limit: z.number(), concede_limit: z.number(), assists: z.number() }).catchall(z.unknown()),
    squad: z.object({ play: z.number(), ...positionLimits }),
  }),
});

// --- Draft: game -------------------------------------------------------------

export const Game = z.object({
  current_event: id.nullable(),
  current_event_finished: z.boolean(),
  next_event: id.nullable(),
});

// --- Draft: transactions, trades, draft choices, element status -------------

export const Transactions = z.object({
  transactions: z.array(
    z.object({
      entry: id,
      element_in: id,
      element_out: id,
      event: id,
      /** "w" waiver, "f" free agent. */
      kind: z.string(),
      /** "a" accepted; for waivers "di"/"do" when the player in or out was already gone. */
      result: z.string(),
      added: z.string(),
      index: z.number().nullable(),
      priority: z.number().nullable(),
    }),
  ),
});

export const Trades = z.object({
  trades: z.array(
    z.object({
      event: id,
      offered_entry: id,
      received_entry: id,
      offer_time: z.string(),
      response_time: z.string().nullable(),
      /** "p" processed (went through). */
      state: z.string(),
      tradeitem_set: z.array(z.object({ element_in: id, element_out: id })),
    }),
  ),
});

export const DraftChoices = z.object({
  choices: z.array(
    z.object({
      element: id.nullable(),
      entry: id,
      index: z.number(),
      round: z.number(),
      pick: z.number(),
      was_auto: z.boolean(),
    }),
  ),
});

export const ElementStatus = z.object({
  element_status: z.array(z.object({ element: id, owner: id.nullable() })),
});

// --- Draft: event/{gw}/live ----------------------------------------------------

const statList = z.array(z.object({ element: id, value: z.number() }));

export const LiveFeed = z.object({
  elements: z.record(
    z.string(),
    z.object({
      stats: z.object({
        total_points: z.number(),
        minutes: z.number(),
        goals_scored: z.number(),
        assists: z.number(),
        clean_sheets: z.number(),
        goals_conceded: z.number(),
        expected_goals: numeric.nullish(),
        expected_assists: numeric.nullish(),
        expected_goals_conceded: numeric.nullish(),
      }),
    }),
  ),
  fixtures: z.array(
    Fixture.extend({
      stats: z.array(z.object({ s: z.string(), h: statList, a: statList })).nullish(),
    }),
  ),
});

// --- Draft: entry/{id}/event/{gw} ----------------------------------------------

export const EntryPicks = z.object({
  picks: z.array(z.object({ element: id, position: z.number() })),
  subs: z.array(z.object({ element_in: id, element_out: id })).nullish(),
});

// --- Main FPL game: bootstrap-static (projections only) -----------------------

export const FplBootstrap = z.object({
  elements: z.array(z.object({ code: id, ep_next: numeric.nullable() })),
});

export type LeagueDetails = z.infer<typeof LeagueDetails>;
export type Bootstrap = z.infer<typeof Bootstrap>;
export type Element = Bootstrap['elements'][number];
export type Fixture = z.infer<typeof Fixture>;
export type Game = z.infer<typeof Game>;
export type Transaction = z.infer<typeof Transactions>['transactions'][number];
export type Trade = z.infer<typeof Trades>['trades'][number];
export type DraftChoice = z.infer<typeof DraftChoices>['choices'][number];
export type LiveFeed = z.infer<typeof LiveFeed>;
export type EntryPicks = z.infer<typeof EntryPicks>;
export type FplBootstrap = z.infer<typeof FplBootstrap>;
