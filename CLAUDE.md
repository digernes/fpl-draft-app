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
node scripts/fake-live.ts         # fake a gameweek in progress (see Live mode); --restore undoes it
node src/model/backtest.ts        # how the expected-points model would have done this season (reads .cache)
node scripts/season-summary.ts 2025-26  # a season from before the site's first, summed up for the model (public match archive)
```

Node 24 runs the TypeScript as it is (type stripping), so imports name the `.ts` file, type-only
imports use `import type`, and only erasable syntax works: no enums, namespaces or parameter
properties. Only the browser code is bundled (esbuild).

Locally, `npm run data` starts from whatever `public/data.json` is there, for the pre-match odds it
froze. The deploy starts from the live site's copy; to match it, download that first:
`curl -o public/data.json https://digernes.github.io/fpl-draft-app/data.json`.

## Layout

- `src/build/` builds data.json, one module per part; `config.ts` holds the numbers worth tuning. `scripts/build-data.ts` runs it.
- `src/model/` is the expected-points model the build uses (`src/build/expected.ts`), with its own README and backtest; its tuning numbers are `DEFAULT_OPTIONS` in `forecast.ts`. It starts each season from a summary of the last one in `public/seasons/model/` (`src/build/last-season.ts`), which the build writes when a season ends.
- `src/shared/` is code used by more than one of the build, the page and the Worker: data.json's types (`data.ts`), Zod schemas for every FPL API response (`fpl-api.ts`), live scoring (`live.ts`), the odds maths, the best-XI picker.
- `src/app/` is the page, `src/app/styles/` its CSS, `src/sw.ts` the service worker.
- `worker/` is the Cloudflare Worker: the live relay (`index.ts`) and the timer that starts the data build (`timer.ts`).
- `public/` is the site as deployed. The bundles and data.json in it are built, and gitignored.

## The page

No framework: each tab is a function in `src/app/views/` that returns an HTML string.

- `state.ts` holds the tabs (`TABS`), constants, `state` (view state and settings) and `D` (the loaded data.json). `live-scores.ts` loads and refreshes data.json and polls the relay.
- `render.ts` puts the current view in `#view`, and rebuilds the whole view after every change.
- One delegated click handler in `chrome.ts`: elements carry `data-action` (and `data-value`), the handler updates `state` and calls `renderView()`. Routing is the hash (`#fixtures/8`, `#squads/<id>`, `#stats/transfers`), read in `readRoute()` there too.
- Shared pieces: `components.ts` (avatars, crests, photos, cards, chips, segmented switches, tiles, pills), `matches.ts`, `pitch.ts` (with `event-icons.ts` for what each player did and `lineup-filters.ts` for the xP, xG, xA and xCS filters), `table.ts`, `cards.ts`. `lookups.ts` reads the data (`player()`, `club()`, `first()`, `isLive()`, `isArchive()`); `format.ts` formats and escapes.
- Escape text from the data with `esc()`: team names and other strings are typed by FPL users.
- Stats that need only data.json are pure functions of `Data` (like `manager-stats.ts`), so `tests/` can check them without a browser.
- A finished season stays browsable (`public/seasons/`), so views must also work for an archive, where nothing is live.

Adding a tab: add it to `TABS`, write `views/<tab>.ts`, add it to the map in `render.ts`, add its actions to `chrome.ts` and any new state to `state.ts`, and give it a stylesheet in `src/app/styles/`.

## Styles

- One file per area in `src/app/styles/`. `index.css` imports them in cascade order (a later file wins a tie), and the build bundles them into `public/assets/styles.css`. A new file goes where its rules belong in that order: before `tooltip.css`, `hover.css` and `motion.css`, which stay last.
- Colours are tokens on `:root` in `tokens.css`, light first, then `:root[data-theme='dark']`. Use the tokens rather than raw colours so both themes work. Manager colours are `--m1` … `--m8`.
- Phones are `max-width: 599px`; wider layouts start at 769px, 992px and 1280px. Tables and the match pitch also use container queries.
- Every hover effect is in `hover.css`, under `(hover: hover)`, so a tap on a phone doesn't leave one behind.
- The look follows fotmob.com. For anything fotmob.com also has, check how it does it (sizes, spacing, colours) rather than guessing.

## Checking a change

- `npm run check`, then look at anything visible in the dev server: at phone width (375px) and desktop, in light and dark (the cog's theme setting, or `data-theme` on `<html>`).
- The page doesn't reload itself after a rebuild, and a hash-only navigation keeps the old bundle: reload.
- In Claude Code the preview server is `draft-dev` (port 8766) in `.claude/launch.json`, which is gitignored. When the browser pane is hidden, the page's timers can slow to about once a minute: in page scripts, wait for events rather than `setTimeout`.

## Live mode

While a gameweek is being played the page polls the relay (`LIVE_URL` in `state.ts`) every 30 seconds. To try the live views on another day: build the data, run `node scripts/fake-live.ts`, and open the page with `?relay=off` (http://localhost:8765/?relay=off#fixtures), or the relay replaces the faked scores with the real, finished ones. `node scripts/fake-live.ts --restore` puts the real data.json back.

## Deploying

- Pushing to `main` deploys: the "Update data and deploy" workflow checks the code, builds data.json, bundles the page and publishes `public/` to GitHub Pages in a minute or two. Other branches only get the Check workflow.
- The relay's timer starts the same workflow every 10 minutes during the usual match slots and hourly otherwise, and between those when FPL's owners differ from the live data.json's (a transfer since the last build). Those runs skip the check and only redeploy when data.json changed.
- Pre-match odds freeze at the last build before each deadline, so a change to the odds model only reaches matches whose deadline is still to come.
- The Worker deploys on its own: `npx wrangler deploy` from `worker/`.

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
