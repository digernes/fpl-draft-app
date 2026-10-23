# FotMob Draft League

A fotmob.com-style page for our FPL Draft league (#23793): table with form, fixtures with odds,
top gameweeks, transfer stats, original squads and each manager's Premier League twin.

## What's on it

- **Overview**: next gameweek with 1 X 2 odds, table with form, the highest-gameweek prize race, PL twins, latest transfers, original-squad tracker.
- **Table**: All · Form (last 5 GWs) · xG (like FotMob's xG table) · Luck (every week against the league average) · Simulated (how often each manager finishes 1st, 2nd … last over 10,000 runs of the rest of the season) · Total points · PL parallel (the real PL table with managers slotted in on their H2H points), plus a luck card beside it. Phones get a Short/Form switch.
- **Fixtures**: every gameweek. Tap a match for both XIs on one pitch, as on fotmob.com (side by side, or one above the other on a phone), with points (bonus shown as 10+3), what each player did (goals, assists, cards, penalties saved and missed, own goals, coming on and going off, as fotmob.com's icons around the photo), auto-subs, DGW flags and the minute during a round, the benches below, and the pre-match odds, settled after full time the way fotmob.com shows them. Upcoming matches show win probability and the projected XIs on the pitch.
- **Squads**: one manager at a time; tap any table row to open theirs. fotmob.com's starting XI on a pitch, for the last gameweek (with the same icons as a match, live during a round, with the minute and auto-subs) or the season's best XI by the points players scored for them, with the goals and assists they got in that XI. The squad by position with the gameweeks each player has been in it, this gameweek's points (live during a round, with each player's minute, FT or kick-off), FPL's expected points for the next gameweek and the points they've scored in that manager's XI; tap a column to sort, or switch to All-time for everyone they've ever owned. Then their record against every opponent, best and worst first, their nemesis (the opposing player with the most points against them), and season numbers: best and worst gameweek, top scorer, bench points, closest calls and points by position.
- **Stats**: top 10 gameweeks, season records, points heatmap, MVPs, bench points.
- **Transfers**: per-manager table, awards, best pickups, the ones that got away, most-contested waivers, trades, waiver order, hot potatoes, full log.
- **Draft**: how much of each original squad is left and how many points it produced, the draft board, steals and busts.
- Search ("Who owns…?") in the top bar, light/dark theme and decimal/fractional odds under the cog.
- The header counts down to the waiver run and the deadline, and shows "Live" while a gameweek is being played.
- During a gameweek the table gets fotmob.com's Live column and live positions, with rows sliding as they change. With the live relay set up (below), scores update every 30 seconds.
- Installable: on Android Chrome use the menu → Install app (on iPhone, Share → Add to Home Screen).
- The table marks the prize places (1st and 2nd) and last place, whose penalty is still to be announced. Managers appear by first name only, since the page is public.
- Finished seasons are kept: the season chip becomes a picker once there is more than one.

## How it works

```
FPL Draft API ──► scripts/build-data.ts ──► public/data.json ──► GitHub Pages
                  (GitHub Actions, started by the Worker's timer:
                   hourly, and every 10 min while matches are on)
```

The browser can't call the FPL API itself (no CORS), so a GitHub Actions job builds `data.json`
and the page is a static site in `public/`. While it's open, the page re-checks `data.json` every
2 minutes during a live gameweek and every 10 minutes otherwise.

The job is started by the Worker's timer on Cloudflare (`worker/timer.ts`), because GitHub's own
schedule runs late, skips runs and pauses after 60 days without commits; a GitHub schedule every
3 hours stays as a fallback. The 10-minute runs follow the usual Premier League slots (Saturday,
Sunday and weekday evenings, UTC, in both BST and GMT). Games at odd times, like Boxing Day, still
get the hourly run.

`data.json` isn't kept in git. Each run starts from the copy on the live site (for the pre-match
odds it froze), builds a new one and deploys only if something changed.

When a season's last gameweek finishes, the build freezes it into `public/seasons/2026-27.json` and
lists it in `public/seasons/index.json`; that archive is the one data file the job commits. For next season, point `LEAGUE_ID` at the new league and the old one
stays browsable from the season picker. `--archive` freezes the current season by hand.

## Live scores (optional, free)

Live scores already update with `data.json`, every 10 minutes during matches. For near
real-time, the page can poll a tiny Cloudflare Worker (`worker/`) that relays the FPL live
feed, which browsers can't call themselves. It answers only two things: `/live/<gameweek>`
(the live feed, slimmed from ~450 KB to ~5 KB, one fetch per 20 seconds shared by everyone
watching) and `/transfers` (this league's moves, trades and owners, refreshed every minute), so
new transfers show up within a couple of minutes instead of at the next build.
The page, the Worker and the build all score with `src/shared/live.ts`, which adds provisional
bonus and provisional auto-subs.

1. Deploy it once, with a free Cloudflare account:

   ```bash
   cd worker
   npx wrangler login
   npx wrangler deploy
   ```

2. Put the URL it prints (like `https://fpl-draft-live.<you>.workers.dev`) in `LIVE_URL` in `src/app/state.ts` and push. (This league's relay runs at `https://fpl-draft-live.digernes.workers.dev`.)
3. For the timer that starts the data build: create a fine-grained GitHub token (Settings →
   Developer settings → Fine-grained tokens) for just this repository, with **Actions: Read and
   write**, and store it in the Worker:

   ```bash
   npx wrangler secret put GITHUB_TOKEN
   ```

   Set `GITHUB_REPO` in `worker/wrangler.toml` if your repo has another name. Without the token,
   only GitHub's 3-hourly fallback builds the data.

The free plan allows 100,000 requests a day; a busy matchday here uses a few thousand.

## Run locally

Needs Node 24 or later (it runs the TypeScript build scripts directly).

```bash
npm install
npm run data -- --cache .cache
npm run dev
```

Then open http://localhost:8765. `npm run data` builds `public/data.json`; `--cache .cache` keeps the
raw API responses so later runs don't hit the API. `npm run dev` bundles the page with esbuild,
rebuilds it on every change and serves `public/`.

To try the live views on a day without matches, `node scripts/fake-live.ts` turns the latest
gameweek into one in progress; open http://localhost:8765/?relay=off#fixtures (so the live relay
doesn't replace it with the real scores), and `node scripts/fake-live.ts --restore` afterwards.

## Code

TypeScript throughout, in strict mode. Node 24 runs the build scripts as they are; esbuild bundles
the page, its styles and the service worker; Wrangler bundles the Worker. CLAUDE.md has the working notes.

```
scripts/build-data.ts   builds data.json (entry point)
scripts/build-site.ts   bundles src/app (script and styles) and src/sw.ts into public/
scripts/fake-live.ts    fakes a gameweek in progress, to try the live views
src/build/              the build, one module per part of data.json
src/app/                the page; its styles are in src/app/styles/, one file per area
src/shared/             data.json's types, the FPL API's Zod schemas, live scoring
src/sw.ts               the service worker
worker/                 the live relay
public/                 the site as deployed: HTML, icons, data.json, seasons/ and the bundles
tests/                  node --test
```

Every FPL API response is parsed with Zod (`src/shared/fpl-api.ts`) before the build or the
Worker uses it, so if FPL changes shape the build stops with the field that broke instead of
writing wrong numbers.

```bash
npm run check    # type-check, lint (ESLint + Prettier) and test
npm run format   # fix formatting and lint
```

CI runs `npm run check` on every push and pull request; scheduled data runs skip it.

## Put it online (free)

1. Create a GitHub repo and push this folder to `main`. Public is simplest: everything in it comes from the public API.
2. In the repo: Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. Push, or run Actions → **Update data and deploy** → Run workflow. It checks the code, builds the data, bundles the page and deploys `public/`.
4. The site is at `https://<user>.github.io/<repo>/`. After that it refreshes itself on the schedule above and only redeploys when the data changed.

Public repos get unlimited Actions minutes, so this costs nothing. Pages on a private repo needs a
paid GitHub plan (and the site is still public to anyone with the link), and the schedule uses
roughly 1,500 of the 2,000 free minutes a month before deploys, so trim the match windows if you go
private. Any other static host (Cloudflare Pages, Netlify) works too, as long as the Action keeps
`public/data.json` fresh.

## Tweaking

- League: set the `LEAGUE_ID` repo variable (Settings → Secrets and variables → Actions → Variables). Defaults to 23793.
- Constants in `src/build/config.ts`: `DGW_PENALTY`, `TOP_GAMEWEEKS`, `FORM_LENGTH`, and for the odds `ODDS_OVERROUND`, `FORM_WEIGHT`, `PROJECTION_WEIGHT`, `MIN_SCORE_SPREAD`.

## How the numbers are made

- **Top gameweeks and the highest-gameweek prize**: the score minus 4 for every player in the scoring XI (after auto-subs) whose club has two fixtures that gameweek. The best adjusted score holds the prize; on a tie the earlier week wins, and two managers level in the same week share it. Only finished gameweeks count. The list gives every manager's best week a place and fills the rest with the highest remaining scores; weeks only there because of that get a "Best GW" tag.
- **Pre-match odds**: when a match starts, the build keeps the odds from its last run before the deadline. Matches that started before this existed (GW1–7 of 2026/27) show what the model would have priced with only the results known before that gameweek, and say so.
- **Odds**: a manager's expected score is the league average, plus 60% of how far their recency-weighted form sits from it, plus (next gameweek only) 30% of how far their best projected XI sits from the league's average projection (FPL's own expected points). The spread comes from this season's scores (at least 13 points). A draw is both sides landing on the same integer. Prices carry a 5% margin and are rounded down: fractional onto the standard UK ladder, decimal onto an exchange-style one (steps of 0.01 up to 2.00, wider beyond), which is finer near evens, where 10/11 covers every chance from 47.6% to 49.9%.
- **Luck**: every week is played against the league average, and scoring above it is a win. Beating the league average is the same as beating everyone else's average. Luck is your real table points minus those points: what the fixture list gave or took.
- **Live scores**: each scoring XI's live points plus provisional bonus (the top three BPS in a match get 3, 2 and 1 until the real bonus is in; ties share). A starter who got no minutes once all his club's matches are over makes way for the first bench player who played and keeps the formation legal, as FPL does at the end of the gameweek. A bench player whose match is still to come holds the queue. Replaying GW1–7 this way reproduces every official score and all 30 automatic substitutions; `tests/live.test.ts` keeps it that way. The live table ranks everyone as if the live scores were final.
- **Live odds**: while a match is being played, each side's projected final score is its live score plus FPL's expected points for this gameweek for every XI player still to play, scaled by how much of their match is left (a player 60 minutes in has a third to go). Each player still to play adds uncertainty (a spread of 3 points over a full match), so the odds firm up as the games finish. Same margin and ladders as the pre-match odds.
- **Who is still to play**: in a live gameweek each player shows his match minute, FT, or his kick-off time.
- **Coming on and going off**: FPL doesn't list substitutions, so they come from the minutes in each match. A player who played in more matches than he started came on; a starter with under 90 minutes in a finished match went off, unless he was sent off. While a match is on nobody has 90 minutes yet, so going off shows at full time.
- **Simulated season**: every unfinished match is played 10,000 times with the odds model. Each score is drawn around the manager's expected score with this season's spread, plus a per-run offset (±3 points a week, typically) for how good they really are, since a few weeks of form is only a rough guide. Ties on points go to points scored, as in the real table. The random numbers are seeded, so the same data always gives the same percentages and the scheduled job only commits real changes. A match still being played is simulated from scratch.
- **xG table**: each player's points with goals, assists, clean sheets and goals conceded swapped for what their xG, xA and xGC were worth (a clean sheet counts as e^−xGC per full game). Minutes, bonus, saves, cards and defensive contributions stay as scored. xPF adds that up over each scoring XI and xPA does the same for your opponents. xPTS decides every match with a normal model around both expected scores, with the spread of actual minus expected (about 7 points). Sorted by xPTS, as FotMob does.
- **PL twin**: the Premier League club on the same points (or the closest). Managers level on points share out the level clubs in table order. The PL table is rebuilt from the same API's fixtures.
- **Transfer net**: points scored by the player brought in minus the player let go, from that gameweek on. "Banked" is what the new player actually scored in the XI.
- **Original squad**: draft picks still owned today. "% of points" is the share of XI points that came from original picks.

## Notes

- The FPL Draft API is unofficial and undocumented. If it changes, the schemas in `src/shared/fpl-api.ts` say where, and `src/build/` is the only place to fix.
- The look follows fotmob.com's colours and layout. The real font (GT Walsheim) is licensed, so the page uses it only if it's installed and otherwise falls back to DM Sans.
- Player photos and club crests are loaded from the Premier League's image servers; nothing comes from FotMob.
