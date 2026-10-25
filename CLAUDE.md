# CLAUDE.md

How the code fits together and how to work on it, for coding agents and anyone else. What the
site shows and how its numbers are made is in README.md.

## Commands

```bash
npm run check                     # type-check, lint (ESLint + Prettier) and test: run before every commit
npm run data -- --cache .cache    # build public/data.json from the FPL Draft API; .cache/ keeps the raw responses
npm run dev                       # bundle, rebuild on every change and serve public/ on :8765 (PORT=… to move it)
npm run build                     # the minified bundles, as the deploy makes them
node --test tests/odds.test.ts    # one test file
npm run coverage                  # the tests, with how much of each file they run
npm run snapshot                  # every page, the data build and the backtest, against main: did anything change?
node scripts/fake-live.ts         # fake a gameweek in progress (see Live mode); --restore undoes it
node src/model/backtest.ts        # how the expected-points model would have done this season (reads .cache)
node scripts/live-odds-check.ts   # how the live odds would have called this season's head-to-heads, skewed against normal (reads .cache)
node scripts/season-summary.ts 2025-26  # a season from before the site's first, summed up for the model (public match archive)
```

Node 24 runs the TypeScript as it is (type stripping), so imports name the `.ts` file, type-only
imports use `import type`, and only erasable syntax works: no enums, namespaces or parameter
properties. Only the browser code is bundled (esbuild).

Locally, `npm run data` starts from whatever `public/data.json` is there, for the pre-match odds it
froze. The deploy starts from the live site's copy; to match it, download that first:
`curl -o public/data.json https://digernes.github.io/fpl-draft-app/data.json`.

## Layout

- `src/build/` builds data.json, one module per part; `config.ts` holds the numbers worth tuning. `scripts/build-data.ts` runs it. `premier-league.ts` also asks the Premier League's match centre for each match's formations, once a match's lineups are out, and keeps them from the last build's data.json after that, and writes everyone's FPL stats in each match to `public/stats/<gw>.json` (beside data.json, and gitignored like it), which a Premier League match's Player stats tab loads, and everyone's season so far to `public/stats/season.json`, for the Premier League's own Player stats tab. Those files also hold each match's moments (goals with their minute and assister, cards, substitutions), asked of the match centre at every build while a match is on and once after full time, then kept from the last build's files: the deploy downloads them from the live site first, as it does data.json.
- `src/build/in-play.ts` records each head-to-head's live odds at every build while it's played (`Match.inPlay`, kept from the last data.json as the pre-match odds are), for the momentum card's win chance, and puts in among them those the relay's Worker recorded every minute (`/in-play/<season>/<gw>` from `RELAY_URL` in `config.ts`; without them when it can't be reached, as offline); the build writes the stats files' contents before data.json for it. Working the odds out, thinning the records and putting the two recorders' together are in `src/shared/in-play.ts`, for the page, the build and the Worker alike.
- `src/model/` is the expected-points model the build uses (`src/build/expected.ts`), with its own README and backtest; its tuning numbers are `DEFAULT_OPTIONS` in `forecast.ts`. It starts each season from a summary of the last one in `public/seasons/model/` (`src/build/last-season.ts`), which the build writes when a season ends.
- `src/shared/` is code used by more than one of the build, the page and the Worker: data.json's types (`data.ts`), Zod schemas for every FPL API response (`fpl-api.ts`), live scoring (`live.ts`, whose auto-subs come before FPL's once the Premier League's teams leave a starter out), where a lineup's points are heading while a gameweek is played (`live-projection.ts`) and a head-to-head's live odds from data.json and a feed (`in-play.ts`, which the page shows and the build records), each player's stats in a match and its moments (`match-stats.ts`), xG-based expected points (`underlying.ts`), the odds maths (`odds.ts`: the live odds take each side's points still to come as a gamma above the projection's floor), the best-XI picker.
- `src/app/` is the page: `pages/` has one module per page (a big one with a module per tab or part beside it: `team.ts` with `team-overview.ts`, `team-squad.ts`, `team-transfers.ts` and `team-stats.ts`; `match.ts` with `match-momentum.ts` and `match-stats.ts`), `views/` the draft league's tabs, `styles/` the CSS. `src/sw.ts` is the service worker.
- `worker/` is the Cloudflare Worker: the live relay (`index.ts`, with `feed.ts` for the FPL API and the slim live feed), which also passes on everyone's stats in the matches being played and their moments from the match centre (by player codes; the page knows the ids); Who will win?'s votes (`poll.ts`, a Durable Object per head-to-head); the timer, which fires every minute, starting the data build every tenth minute as `timer.ts` decides; and the win chance's records (`in-play.ts`): each minute the timer asks FPL Draft's game state cheaply which gameweek is being played and, while one is (current and not finished), calls the gameweek's Durable Object (`<season>:<gw>`) once, which reads the relay's live feed and, when a match is on or just over (`recentFixtures` in `feed.ts`), works out and keeps each head-to-head's live odds from the site's data.json and that feed, served at `/in-play/<season>/<gw>`; with nothing on it writes nothing. On the free plan the timer has 10 ms of CPU, so anything heavier belongs in the Durable Object (30 seconds), and at most one Durable Object request a minute. The Worker asks only draft.premierleague.com of FPL: FPL's main game (fantasy.premierleague.com) turns Cloudflare's addresses away. While a gameweek is played the page lays the relay's matches over the stats file (`statsFor` in `stats-files.ts`) and reads each match's lines live (`match-lines.ts`), so the momentum, the commentary, the player stats and the lineup filters keep up with the score.
- `public/` is the site as deployed. The bundles and data.json in it are built, and gitignored.

## The page

No framework: each page is a function in `src/app/pages/` that returns its header (logo, title, side, tabs) and body as HTML strings, and a match's page its right column too (`aside`), when the header heads the body's column as on fotmob.com; the draft league's tabs are functions in `src/app/views/`.

- `router.ts` reads the address into `state.route` (`#/`, `#/round/9`, `#/league/table`, `#/team/<id>/squad`, `#/match/<gw>/<home>-<away>/lineup`, `#/premier-league/match/<fixture>/player-stats`, `#/player/<id>`), builds links (`href`), and sends the old tab addresses (`#table`, `#squads/<id>`) to their pages. Links are plain `<a href="#/…">`.
- `render.ts` puts the page in `#app`, with its header (`page-header.ts`), and rebuilds it after every change; between tabs of one page the bar under the tabs slides. `navigate(to, { replace: true })` moves without a history entry, as a gameweek's arrows do. It also lights the top bar's links and the phones' bottom bar. `scroll.ts` keeps the scroll for each history entry (back and forward land where you were, a link starts at the top, another tab of the page keeps its tabs in sight), and a redraw of the same view keeps whatever scrolls sideways where it was. Keep history entries' state (`history.replaceState(history.state, …)`): it holds the entry's key.
- Clicks: elements carry `data-action` (and `data-value`). Each module registers its actions with `onAction` (`actions.ts`) next to the markup that uses them, and the one delegated handler in `chrome.ts` (with the search in `search.ts` and the tooltips in `tooltips.ts`) runs them; a link inside an element with an action wins. `go` navigates to its value without a history entry.
- `state.ts` holds `state` (the route, view state and settings, like the followed team) and `D` (the loaded data.json). `live-scores.ts` loads and refreshes data.json and polls the relay.
- Shared pieces: `components.ts` (avatars, crests, photos, links to a player or a team, cards, chips, segmented switches, tiles, pills, the round picker, the matches-in-the-round card), `matches.ts` (the head-to-head list, fotmob.com's FT/Live chip and where a match stands), `match-odds.ts` and `match-lineups.ts` (a head-to-head's odds, and its lineups on the pitch, as played or projected), `in-play-records.ts` (the live odds recorded through a head-to-head: data.json's, with the relay's since the last build while it's played), `win-chance.ts` and `smooth-curve.ts` (the momentum card's win chance, where a moment falls among the kick-off slots, and its smoothed curve), `pl.ts` (the real Premier League's matches, with the relay's live state, and their rows), `stats-files.ts` (the stats files: loading them, the relay's live matches laid over them, and what each player scored from), `stats-table.ts` and `pl-stats.ts` (the player stats table, and the cards that show it), `recent.ts` (the pages opened last, for the search), `pitch.ts` (with `event-icons.ts` for what each player did and `lineup-filters.ts` for the xP, xG, xA and xCS filters), `table.ts` (the general data table and its columns), `league-tables.ts` (the draft league's table views, with `standings.ts` and `simulation-table.ts`), `premier-league-table.ts`, `cards.ts`. `lookups.ts` reads the data (`player()`, `club()`, `first()`, `isLive()`, `isArchive()`); `format.ts` formats and escapes.
- Escape text from the data with `esc()`: team names and other strings are typed by FPL users.
- Stats that need only data.json are pure functions of `Data`, so `tests/` can check them without a browser: `manager-stats.ts`, `player-history.ts` (a player's story), `awards.ts` (Manager of the Month), `match-report.ts`, `momentum.ts` and `commentary.ts` (a head-to-head's commentary, from the stats files' moments).
- The rest of the page's modules can be tested in Node too: a test imports `tests/fixtures/browser.ts` first (what they read of the browser when they load), then sets the data with `setData` (`tests/fixtures/league.ts` has a small league to start from) and checks the HTML they return. Name a test file after the module it tests.
- A finished season stays browsable (`public/seasons/`), so pages must also work for an archive, where nothing is live.

Adding a page: give it a route in `router.ts` (`parseRoute` and `href`), write `pages/<page>.ts` returning a `PageView`, add it to `PAGES` in `render.ts`, register its actions with `onAction`, and give it a stylesheet in `src/app/styles/`. A new tab of the draft league is a function in `views/`, listed in `pages/league.ts` and `LEAGUE_TABS`.

## Styles

- One file per area in `src/app/styles/`. `index.css` imports them in cascade order (a later file wins a tie), and the build bundles them into `public/assets/styles.css`. A new file goes where its rules belong in that order: before `tooltip.css`, `hover.css` and `motion.css`, which stay last.
- Colours are tokens on `:root` in `tokens.css`, light first, then `:root[data-theme='dark']`. Use the tokens rather than raw colours so both themes work. Manager colours are `--m1` … `--m8`.
- Phones are `max-width: 599px`; wider layouts start at 769px, 992px and 1280px. Below 769px the bottom bar replaces the top bar's links. The home page follows fotmob.com's front page: its right column from 769px, its left from 1120px. Tables and the match pitch also use container queries.
- Every hover effect is in `hover.css`, under `(hover: hover)`, so a tap on a phone doesn't leave one behind.
- The look follows fotmob.com. For anything fotmob.com also has, check how it does it (sizes, spacing, colours) rather than guessing.

## Checking a change

- `npm run check`. For a change that should leave the site as it was (a refactor, a split, a rename), `npm run snapshot` proves it: it renders every page with each setting that changes what it shows, before and during the live gameweek, from this checkout and from main (`--against <rev>` for another commit, `HEAD` for uncommitted changes), against the same public/data.json, and with the API responses in .cache/ also rebuilds data.json offline and runs the model's backtest from both. Pages that differ are written to .cache/snapshot/ to diff. It doesn't run the page's DOM code (clicks, search, tooltips).
- Then look at anything visible in the dev server: at phone width (375px) and desktop, in light and dark (the cog's theme setting, or `data-theme` on `<html>`).
- The page doesn't reload itself after a rebuild, and a hash-only navigation keeps the old bundle: reload.
- In Claude Code the preview server is `draft-dev` (port 8766) in `.claude/launch.json`, which is gitignored. When the browser pane is hidden, the page's timers can slow to about once a minute: in page scripts, wait for events rather than `setTimeout`.

## Live mode

While a gameweek is being played the page polls the relay (`LIVE_URL` in `state.ts`) every 30 seconds. To try the live views on another day: build the data, run `node scripts/fake-live.ts`, and open the page with `?relay=off` (http://localhost:8765/?relay=off#/), or the relay replaces the faked scores with the real, finished ones. `node scripts/fake-live.ts --restore` puts the real data.json back.

## Deploying

- Pushing to `main` deploys: the "Update data and deploy" workflow checks the code, builds data.json, bundles the page and publishes `public/` to GitHub Pages in a minute or two. Other branches only get the Check workflow.
- The relay's timer (it fires every minute, for the win chance's records) starts the same workflow every 10 minutes during the usual match slots and hourly otherwise, and between those when FPL's owners differ from the live data.json's (a transfer since the last build). Those runs skip the check and only redeploy when data.json changed.
- Pre-match odds freeze at the last build before each deadline, so a change to the odds model only reaches matches whose deadline is still to come.
- The Worker deploys with `main` too, by its own workflow ("Deploy the Worker", `.github/workflows/worker.yml`) when a push changes `worker/` or `src/shared/`, once the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are set (without them it skips); by hand, `npx wrangler deploy` from `worker/`. A new Durable Object class needs a new `[[migrations]]` tag in `wrangler.toml` (never edit one that's deployed).

## Rules

- The repo and the site are public. Requests carry no custom or identifying User-Agent (GitHub's API insists on one, so the timer sends the generic `cloudflare-worker`), and managers appear by first name only.
- No secrets in the repo. The timer's GitHub token is the Cloudflare secret `GITHUB_TOKEN`: never print it, list it or ask for it.
- data.json isn't committed; only finished-season archives in `public/seasons/` are, by the workflow, with their summaries for the next season's model (`public/seasons/model/`).
- Pushing `main` deploys, so work on a branch, and merge and push only when asked. Keep commits few: a chat's changes land on `main` as one commit, related or not (`git merge --squash`), with no merge commit.
- Keep README.md's "What's on it" and "How the numbers are made" in step with what changes.

## Writing

- Every module opens with a comment on what it is for; other comments say why, not what.
- UI text is British English, in sentence case, with typographic apostrophes (’).
- Prettier: 140 columns, single quotes.
