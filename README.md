# FotMob Draft League

A fotmob.com-style page for our FPL Draft league (#23793): table with form, fixtures with odds,
top gameweeks, transfer stats, original squads and each manager's Premier League twin.

## What's on it

The site follows fotmob.com: a home page, then a page for the draft league, each team, each
match, the Premier League and each player, with tabs where fotmob.com has them. Links are
addresses (`#/team/123`, `#/match/9/123-456`, `#/player/351`), so the back button works and any
page can be shared. The old tab links (`#table`, `#squads/123`) still land in the right place.

- **Home**: like fotmob.com's front page. In the middle the round, with arrows and a picker for any gameweek (the current one says so): the draft league's head-to-heads (a softly blinking dot by the gameweek while it's under way, between its matches too) with 1 X 2 odds (live during a round, with in-play odds), then the real Premier League matches day by day, each row with fotmob.com's status chip at its left (FT, or Live or the minute). On the left the leagues, with the team you follow under them (or a link to all the teams and how to follow one), and the prize for the highest scoring gameweek (each score leading to its match); on the right the next deadline, the waivers' or the gameweek's own, whichever comes first, the table (while a gameweek is played the live table, a dot by each team for how its match stands, as fotmob.com's, the score and who against in its tip), the recent transfers (this gameweek's big names first) and Manager of the Month. Until the left column comes in (it does from 1120px wide, as fotmob.com's), the prize sits after the table and the leagues are left to the top and bottom bars. On a phone the right column goes under the round, and a bottom bar leads to the draft league, the Premier League, the Transfer center and the teams.
- **Draft league**, with the tabs that were the whole site before:
  - **Overview**: the table with form, the latest gameweek's review, this round's matches, the prize race, Manager of the Month (the most table points from the month's matches, by FPL's own months, with the winners before and the points each scored), the recent transfers and the original-squad tracker.
  - **Table**: All · Form (last 5 GWs) · xG (like FotMob's xG table) · Luck (every week against the league average) · Simulated (how often each manager finishes 1st, 2nd … last over 10,000 runs of the rest of the season) · Total points · PL parallel (the real PL table with managers slotted in on their H2H points), plus the PL twins and a luck card beside it. Phones get a Short/Form switch. A live score or a form pill opens its match.
  - **Fixtures**: every gameweek's matches, its review and the earlier meetings of its pairs.
  - **Stats**: top 10 gameweeks, season records, points heatmap, MVPs, bench points.
  - **Transfer stats**: per-manager table, awards, best pickups, the ones that got away, most-contested waivers, hot potatoes.
  - **Draft**: how much of each original squad is left and how many points it produced, the draft board, steals and busts.
- **Transfer center**, as fotmob.com's: every player who has moved, from whom to whom (a team or free agency), by gameweek, and the trade offers; on the left filters for the team, for the players in, out or both, for a gameweek, for the kind of move (waivers, free agents, trades) and for the position, the season's numbers and the waiver order. On a phone the filters are in a sheet behind a button at the top, and the numbers and the waiver order are left out.
- **Match** (a head-to-head), as fotmob.com's match page: both sides around the score (or the deadline) with each side's top scorers under it, Live or Full time under the score, or between match days the countdown to the next real match either squad has a player in. Then:
  - **Facts**: the momentum, the lead through the gameweek as a smooth area in each side's colour (hover anywhere along it for its kick-off slot's results, the score after it, its matches and who scored what, a line marking the minute under the pointer and a dot the lead there, as fotmob.com marks it; dotted lines between match days, as fotmob.com's at half-time; the automatic substitutes' points in a step of their own after the last match, when FPL makes the substitutions); both XIs on one pitch; each side's last five head-to-heads before it, as fotmob.com's Team form (the score between the two, coloured by how it went for the side, the latest first). Beside the header and every tab, as on fotmob.com (the header heads the left column), the same right column: the odds (pre-match, settled after full time the way fotmob.com shows them, and live during the round), the round's other matches, a match report written from the numbers, as fotmob.com's insights (who won and how, an upset, the player who made the difference, a comeback, an automatic substitute who came good, a bench that had the win in it, a haul left on a bench; while it's on, who leads, the chances and the leader's top scorer's share), the top stats, the top players and the benches. Before the deadline: fotmob.com's Who will win?, each side's chance under its avatar and the draw's under an X, with the odds under them and the projected score they come from; the projected XIs as fotmob.com's predicted lineup, the rest of each squad on its bench (its goalkeeper first, then the most expected); and a preview in the report's place. On one column (a phone's) the odds come first, and the rest of the right column under the lineup; the other tabs go without it.
  - **Commentary**, as fotmob.com's: everything either side's XI did in the gameweek's Premier League matches, the latest first, from each kick-off to its full time: goals and assists (and the goals conceded they cost a keeper or defender), cards, substitutions, an hour played, and at full time the clean sheets, saves, defensive contributions and bonus. Each comes with its minute, its match and score, the points it was worth, roughly when it happened in your own time, and the head-to-head's score after it. While a match is on it keeps up with the live relay. An automatic substitute comes in when the substitution is made (once his starter is sure not to play, at the full time of his club's last match or the kick-off of one he isn't in the squad for), with what he'd scored by then, and a chip adds the benches, whose points don't count.
  - **Lineup**: both XIs on one pitch, as on fotmob.com (side by side, or one above the other on a phone; green in the light theme, grey in the dark), with points (bonus shown as 10+3, coloured as fotmob.com's ratings: red for none, orange up to 5, green from 6, and blue for the best of both XIs once the match is over, the higher BPS on a tie, as for the best of both clubs on a Premier League match's; while his gameweek is played, hovering a player's points says where it's heading, as the live odds see it), what each player did (goals, assists, cards, penalties saved and missed, own goals, coming on and going off with the minute, as fotmob.com's icons around the photo), auto-subs, DGW flags and the minute during a round, and the benches below. A finished gameweek gets fotmob.com-style lineup filters that swap the points for each player's xP, xG, xA or xCS (expected clean sheets), and so does one being played, for those who have played, from the live relay. Hovering an xP takes it apart, as the expected points' tooltip does: what he scored for playing, penalties, defensive contributions, saves, bonus and cards, and what his xG, xA, xCS and xGC were worth in place of his goals, assists, clean sheets and goals conceded; the XI's total, its players' together. Before kick-off, in the next three gameweeks, the projected XIs behind the odds. Players still to play show when they kick off once a gameweek is on, and their expected points before it, which a Projected filter swaps; with it, each XI's total is where its score is heading, as the live odds see it. It shares one row with the underlying-number filters, one of them chosen at a time, and tapping the chosen one again goes back to the default.
  - **Table**, **Stats** (both XIs side by side, as fotmob.com's: points, xP, xPTS, the projected score and win chance at the deadline, bench points; goals, assists, xG, xA, bonus; clean sheets, xCS, xGC, saves, defensive contributions, penalties saved; minutes, players who played, automatic substitutions; cards, own goals, penalties missed) and **Head-to-head** (as fotmob.com's: the wins and draws, then every meeting this season, played or to come).
- **Team**, as fotmob.com's team pages, with a **Follow** button: the followed team (remembered on the device) has its match first on the home page, stands out in the tables, and gets a My team link in the top and bottom bars.
  - **Overview**: team form, the next match, the table with the team picked out, its record against every opponent (best and worst, and its nemesis: the opposing player with the most points against it), fotmob.com's starting XI on a pitch for the last gameweek (live during a round, with the same icons and filters as a match) or the season's best XI by the points players scored for the team, and the fixtures around now.
  - **Squad**: by position with the gameweeks each player has been in it, this gameweek's points (live during a round, with each player's minute, FT or kick-off), expected points for the next gameweek and the points they've scored in the team's XI; tap a column to sort, or switch to All-time for everyone it has ever owned. Beside it, points by position and the original squad: who's still there, who went where, who came in.
  - **Fixtures**, **Transfers** (every move, or just the players in or out, with what each has scored since; the waiver claims won and lost; the trade offers) and **Stats** (best and worst gameweek, closest calls, longest winning run, the top scorers in its XI, the points left on the bench by each player and the automatic substitutions).
- **Premier League**, just the real football: the table with each club's form, every round's results and kick-offs, and Player stats, everyone's season as the match's player stats have it (by category, sorted by any column, by club, position or just the free agents, which on one column are in a sheet behind a Filter pill, as the Transfer center's, each in his owner's colours; goals, assists, xG and xA a column each, where a match's top stats pair them). A club's own, `#/premier-league/players/<club>`, is where its name leads in the table, on a player's page and in a match's header. Each match has its page: the score, and under each side its goals, a line each with the minute and who made it, its red cards and its missed penalties; both lineups in their real formations (from the Premier League's match centre, so they're there once the clubs name them, before kick-off too; a plain list where it has none), with the substitutes, each player's FPL points, and an owned player's name in his manager's colours (only outlined when he's on his manager's bench); what each draft team took from the match; every team's players in it; and the round's other matches. Its Player stats tab (the right column, on one column, left to the Facts tab) has everyone who played with FPL's numbers for the match, as fotmob.com's player stats: by category (top stats, expected (his xP, xG, xA, xCS and xGC, beside his points), attack, defence, goalkeeping and FPL's own, from BPS to the ICT index, and for the season a projected one, the site's model's: his expected points over the next five gameweeks, which it opens sorted by, then in each of them (who against in each one's tip), with the minutes, goals and assists behind them and the points from clean sheets, defensive contributions and bonus; the player column as wide whatever the category, the rest sharing the width equally, as fotmob.com's, and the headings staying under the top bar as the page scrolls), sorted by any column; the unused substitutes at the bottom; above the Facts tab's lineups, who led the way on points, goals and assists, xG and xA, BPS, defensive contributions and saves, with a link to the rest.
- **Player**: everything the league has done with him. His season in numbers; one timeline, the latest first: every gameweek he was in a squad (his match, minutes, what he did and his points, and whether he started, sat on the bench, came on automatically or didn't play), each waiver claim for him that didn't go through (who it would have dropped, and who signed him first, or who the manager signed instead), the claims that tried to drop him but didn't go through, the drops, signings, trades and trade offers, each spell as a free agent in one line (and how long nobody claimed him), down to the draft (or, for one FPL added after it, the gameweek he was added in, his story starting there); the points he scored for each owner; his next three matches with expected points; and the players most like him.
- **Search**, as fotmob.com's: players, matches (head-to-heads by manager or team, the Premier League's by club, the nearest to now first), teams and leagues, each a chip of its own or all together, and before anything is typed the pages opened last (of the chip's kind, then its usual suggestions).
- Search players and teams in the top bar; before anything is typed it suggests the pages opened last. Under the cog: light/dark theme, decimal/fractional odds, and whose expected points to show, the site's own or FPL's form (which also picks the projected XIs and drives the live odds; the pre-match odds stay on the site's).
- The draft league's header counts down to the waiver run and the deadline, and shows "Live" while a gameweek is being played.
- During a gameweek the table gets fotmob.com's Live column and live positions, with rows sliding as they change. With the live relay set up (below), the scores keep up within 30 seconds.
- Installable: on Android Chrome use the menu → Install app (on iPhone, Share → Add to Home Screen).
- The table marks the prize places (1st and 2nd) and last place, whose penalty is still to be decided. Managers appear by first name only, since the page is public.
- Finished seasons are kept: the season chip becomes a picker once there is more than one.

## How it works

```
FPL Draft API ──► scripts/build-data.ts ──► public/data.json ──► GitHub Pages
                  (GitHub Actions, started by the Worker's timer: hourly,
                   every 10 min while matches are on, and after transfers)
```

The browser can't call the FPL API itself (no CORS), so a GitHub Actions job builds `data.json`
and the page is a static site in `public/`. Besides the FPL Draft API it reads the main FPL game's
bootstrap and fixtures, and the Premier League's match centre for each match's formations (once per
match, from two hours before kick-off; later builds keep them) and what happened in it when (at every
build while it's on, and once after full time). While it's open, the page re-checks `data.json` every
2 minutes during a live gameweek or while a build for a new transfer is on its way, and every
10 minutes otherwise.

The job is started by the Worker's timer on Cloudflare (`worker/timer.ts`), because GitHub's own
schedule runs late, skips runs and pauses after 60 days without commits; a GitHub schedule every
3 hours stays as a fallback. The 10-minute runs follow the usual Premier League slots (Saturday,
Sunday and weekday evenings, UTC, in both BST and GMT). Games at odd times, like Boxing Day, still
get the hourly run. In between, every 10 minutes the timer compares FPL's owners with the live
`data.json`'s and starts a build if a transfer has gone through, so the projected XIs and the odds
follow a move within about 10 minutes rather than an hour. That matters most just before a
deadline, when the odds freeze.

`data.json` isn't kept in git. Each run starts from the copy on the live site (for the pre-match
odds it froze), builds a new one and deploys only if something changed.

When a season's last gameweek finishes, the build freezes it into `public/seasons/2026-27.json` and
lists it in `public/seasons/index.json`; that archive is the one data file the job commits. For next season, point `LEAGUE_ID` at the new league and the old one
stays browsable from the season picker. `--archive` freezes the current season by hand.

## Live scores (optional, free)

Live scores already update with `data.json`, every 10 minutes during matches. For near
real-time, the page can poll a tiny Cloudflare Worker (`worker/`) that relays the FPL live
feed, which browsers can't call themselves. It answers only two things: `/live/<gameweek>`
(the live feed, slimmed from ~450 KB to ~5 KB, with everyone's FPL stats in the matches being
played and their moments from the Premier League's match centre, one fetch per 20 seconds
shared by everyone watching) and `/transfers` (this league's moves, trades and owners, refreshed every minute), so
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
gameweek into one in progress; open http://localhost:8765/?relay=off#/ (so the live relay
doesn't replace it with the real scores), and `node scripts/fake-live.ts --restore` afterwards.

## Code

TypeScript throughout, in strict mode. Node 24 runs the build scripts as they are; esbuild bundles
the page, its styles and the service worker; Wrangler bundles the Worker. CLAUDE.md has the working notes.

```
scripts/build-data.ts   builds data.json (entry point)
scripts/build-site.ts   bundles src/app (script and styles) and src/sw.ts into public/
scripts/fake-live.ts    fakes a gameweek in progress, to try the live views
src/build/              the build, one module per part of data.json
src/app/                the page: its pages in src/app/pages/, the draft league's tabs in src/app/views/,
                        its styles in src/app/styles/, one file per area
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
- Constants in `src/build/config.ts`: `DGW_PENALTY`, `TOP_GAMEWEEKS`, `FORM_LENGTH`, and for the odds `ODDS_OVERROUND`, `ODDS_GAMEWEEKS`, `PROJECTED_GAMEWEEKS`, `MIN_SCORE_SPREAD`.

## How the numbers are made

- **Top gameweeks and the highest-gameweek prize**: the score minus 4 for every player in the scoring XI (after auto-subs) whose club has two fixtures that gameweek. The best adjusted score holds the prize; on a tie the earlier week wins, and two managers level in the same week share it. Only finished gameweeks count. The list gives every manager's best week a place and fills the rest with the highest remaining scores; weeks only there because of that get a "Best GW" tag.
- **Pre-match odds**: when a match starts, the build keeps the odds from its last run before the deadline. Matches that started before this existed (GW1–7 of 2026/27) show what the model would have priced with only the gameweeks before them (from each side's squad that week, without the injury flags of the time), and say so.
- **Odds**: a manager's expected score is the league average plus how far their best projected XI that gameweek sits from the league's average one (by expected points, below), from today's squads, for each of the next three gameweeks. Past scores don't come into it: this season, a manager's form has said nothing about their next score. FPL's injury flags count for the next gameweek. By a later one a doubt has cleared, and an injured or banned player is back if FPL's news gives a return date before its deadline. The spread comes from how far this season's scores land from each week's average (at least 13 points). A draw is both sides landing on the same integer. Prices carry a 5% margin and are rounded down: fractional onto the standard UK ladder, filled in from 1/2 to 4/1 with the in-between fractions some books use (3/4, 20/21, 7/5, 85/40, 13/5…) and with every whole price from 10/1 to 100/1 added (so 46/1 rather than 40/1), decimal onto an exchange-style one (steps of 0.01 up to 2.00, wider beyond), which is finer still: 10/11 covers every chance from 48.8% to 49.9%.
- **Luck**: every week is played against the league average, and scoring above it is a win. Beating the league average is the same as beating everyone else's average. Luck is your real table points minus those points: what the fixture list gave or took.
- **Live scores**: each scoring XI's live points with the bonus as it stands: FPL's own live bonus once it has one, or else the top three BPS in a match get 3, 2 and 1 until the real bonus is in (ties share). A starter sure not to play makes way for the first bench player who played and keeps the formation legal, as FPL does at the end of the gameweek: sure once all his club's matches are over without him getting on, or once the Premier League has named the teams and he isn't in his club's squad for those still to come. A bench player who may still play holds the queue, and one left out of his club's squad is passed over. Replaying GW1–7 this way reproduces every official score and all 30 automatic substitutions; `tests/live.test.ts` keeps it that way. The live table ranks everyone as if the live scores were final.
- **Expected points (xP)**: the site's own model (`src/model`, whose README has the details). A player's expected points start from his minutes, from what he played in his club's last ten matches (a match he missed counting less, and a part of one spread about ten minutes either way, since whether he next reaches the hour is no surer than that), scaled by FPL's injury flag. Multiply by his share of his club's attack (from his xG and xA) and by the goals his club can expect against this opponent (a Poisson model of every club's attack and defence, mostly from xG). Both start from last season: his share from his own at the same club, a club's ratings most of the way from last season's (a signing and a promoted club start from the averages), and this season's matches take over as they come. On top come clean sheets, goals conceded and saves from the goals his club can expect to concede, defensive contributions from the chance his tackles, clearances, blocks and interceptions (and recoveries, outside defence) reach FPL's threshold, and cards at his rate. Bonus comes from what his goals, assists, clean sheets and the rest have earned in it at his position this season, plus his own beyond them, and each match's is shared out to the bonus a match hands out (3, 2 and 1). A club's penalties (about 0.12 a match, more for a stronger attack) go to its takers in FPL's order, worth the goal 79% of the time and −2 when missed; a keeper gets 5 for the ones he saves. Each rate is pulled towards his position's average by a few matches' worth. A flagged player's minutes go to his stand-ins, the teammates in his position most likely to come in. Hovering an xP takes it apart: his expected minutes and who against, then the points from playing, goals, penalties, assists, a clean sheet, goals conceded, defensive contributions, saves, bonus and cards. Tested on GW 3–7, its error per player and gameweek was 15% below FPL's own expected points (RMSE 3.28 against 3.88 over the league's squads). FPL's are a player's form (his average over the last 30 days' gameweeks) times his chance of playing; they stand in until the season's first gameweek has been played.
- **Live odds**: while a match is being played, each side's projected final score is its live score plus what each of its XI can still add, from where his match stands:
  - Still to kick off: his expected points for the gameweek. Once his club names its team (about an hour before), a starter's are his expected points given he plays, a substitute's are a two-in-three chance of coming on for 1.3 points, and one left out has none.
  - On the pitch: his goals, assists and the rest at his expected rate a minute, for the time he's likely to stay on. Goals come more often late in a match (56% after half-time), so the last half-hour holds 7/18 of them rather than a third. Appearance points and clean sheets arrive at 1 and 60 minutes, so those are worked out from where it stands: the chance he reaches 60 minutes, and of keeping a clean sheet (or still getting one) to the end, with none once a goal has gone in. Both start at kick-off from his expected points given he plays, so a starter's projection doesn't move when the match starts or when FPL adds the points at 60 minutes. His bonus comes from the BPS race: his chance of finishing first, second or third, from his gap to each of the others and how far their BPS and his can still move (one player's varies by about 12 from one full match to the next, this season, less as the match runs down), level players sharing a place as FPL's do. For the time left he's nudged towards his usual bonus, so at kick-off it's that.
  - Not on the pitch while his match is on: the chance he still comes on, fading from half an hour before the end. One who has gone off has nothing more to come, but the others in the BPS race can still take his bonus.
  - The minute comes from the players' minutes, since FPL leaves the match's own at 0 while it's on. In a double gameweek his expected points are split between his two matches.
  - A starter who won't play (no minutes once his matches are over, left out of his club's squad, or ruled out by FPL as injured, suspended or unavailable) counts the bench player FPL's auto-sub rules would bring on, before the live score has him in; one who may not play (on his club's bench, not on the pitch with his match on, or doubtful before his club has named its team) counts that player by the chance he won't.
  - Only a change in someone's chance of playing moves the expected points while the gameweek is played, since the model learns from finished gameweeks only; FPL's, standing in before the first gameweek, are kept as they were at the deadline, since its form drops then.
  - Each player still to play adds uncertainty (a spread of 3 points over a full match), so the odds firm up as the games finish. A clean sheet at stake adds more, since it's all or nothing: one goal against costs every one of the club's players on the pitch their clean sheet (and a keeper or defender his provisional bonus) at once, so a lead resting on one club's defence late in a round is less safe than its points look. Same margin and ladders as the pre-match odds.
  - Replayed over the gameweeks so far, between kick-offs and at half-time, these call the head-to-heads better than the plain share of each player's expected points did.
- **Who is still to play**: in a live gameweek each player shows his match minute (in green with a softly blinking dot while he's on the pitch, in grey while his match goes on without him, and his own minutes once he has gone off), FT, or his kick-off time, with the opponent in its tip.
- **Coming on and going off**: FPL doesn't list substitutions, so they come from the minutes in each match. A player who played in more matches than he started came on; a starter with under 90 minutes in a finished match went off, unless he was sent off. While a match is on, everyone still on the pitch has its minute, so a starter more than a minute behind them has gone off; one sent off, starter or substitute, is off the pitch as soon as FPL has the red card, with nothing more to come. A sub came on at the match's minute less his own minutes.
- **Simulated season**: every unfinished match is played 10,000 times with the odds model. Each score is drawn around the manager's expected score with this season's spread, from that gameweek's projected XI, for every gameweek left: today's squads against that week's fixtures (FPL's main game has the whole season's; the Draft game lists only the next few), so a run of easy fixtures, a blank or a double, and a player back from injury on the date FPL's news gives land in the weeks they fall in (one with no return date stays out). A per-run offset (±3 points a week, typically) stands for how good they really are, since squads change and projections are only a guide. Ties on points go to points scored, as in the real table. The random numbers are seeded, so the same data always gives the same percentages and the scheduled job only commits real changes. A match still being played is simulated from scratch, with each side's average over the gameweeks to come.
- **xG table**: each player's points with goals, assists, clean sheets and goals conceded swapped for what their xG, xA and xGC were worth (a clean sheet counts as e^−xGC per full game). Minutes, bonus, saves, cards and defensive contributions stay as scored. xPF adds that up over each scoring XI and xPA does the same for your opponents. xPTS decides every match with a normal model around both expected scores, with the spread of actual minus expected (about 7 points). Sorted by xPTS, as FotMob does. Each finished match shows its own xP and xPTS, which add up to the table, and the lineup filters show each player's share: his xP, xG, xA and xCS (that e^−xGC per full game, for positions where a clean sheet scores).
- **PL twin**: the Premier League club on the same points (or the closest). Managers level on points share out the level clubs in table order. The PL table is rebuilt from the same API's fixtures.
- **Transfer net**: points scored by the player brought in minus the player let go, from that gameweek on. "Banked" is what the new player actually scored in the XI.
- **Original squad**: draft picks still owned today. "% of points" is the share of XI points that came from original picks.
- **Premier League matches**: from the same live feeds as the scores. Each match's players, their minutes and their FPL points come from FPL's breakdown per match (bonus once it is awarded). FPL counts starts for the gameweek, so in a double gameweek a start goes to the match he played longer in, and a side that doesn't come to eleven starters that way gets the eleven with the most minutes. His side is the one the match's BPS list has him on, or his club's. Substitutions come from the minutes, as above. His owner that week is whoever had him in their lineup.
- **Momentum**: the lead over playing time. Each kick-off slot (the matches that start together) takes 90 minutes, over which its matches' points (from those same points per match) come in evenly, and a monotone curve joins the lead after each slot, so it never overshoots. Once the bonus is in, its end is the final score. The x-axis is dotted, as fotmob.com's, and while a match is being played a dot pulses at the end of the curve, the lead as it stands: a match under way (or over since the last build) comes from the live feed, as the score does, its players' points so far less those of their club's matches before it. The automatic substitutes' points come last, in half a slot of their own, once the gameweek's last match is over.
- **Live and FT**: a head-to-head is Live while a club with a player in either squad is playing, and FT once every one of them is done; between match days it counts down to the next kick-off among them.
- **Formations**: the Premier League's match centre lists each XI line by line from the goalkeeper, each line from the right of the team to its left, by the same player codes FPL uses; the pitch turns them to face the right way.
- **Top transfers**: a move of a big name, one of the first 50 picks in the league's draft or of the season's 50 top scorers so far; the gameweek's biggest come first, by whichever of the two ranks him higher.
- **Player stats**: FPL gives most of a player's stats for the whole gameweek, and lists only some match by match (goals, assists, cards, saves, bonus, BPS, defensive contributions and the like). So someone who played twice in a double gameweek has just those for each match, and a dash for the rest. While a match is on (and until a build after full time has it) they all come from the live relay, as fresh as the scores; xG, xA, xP and xCS in a gameweek being played are worked out from them the way the build does once it's over, and so are a match's xP and xCS; the season's are its gameweeks' added up. The season's Projected category looks five gameweeks ahead, about a month of fixtures, beyond which a player's projections barely move; its goals and assists are as many as the points the model expects of them stand for, the penalties he'd take included. The points xP keeps as scored are FPL's own explanation of them once a gameweek is over, and while it's played worked out from his stats as FPL scores them (which gives FPL's own, for every player in a single match this season).
- **Similar players**: the same position, nearest on season points and on expected points for the next gameweek.
- **Match report**: "thrashed" is a win by 25 or more, "edged" one by 3 or fewer. An upset is a winner who had under a 35% chance at the deadline. The winner's top scorer made the difference when he scored more than the margin (while it's on, his share of the leader's points is given instead, from 5 points); a comeback is from 5 points or more behind after any Premier League match; an automatic substitute is mentioned from 5 points, and the loser's bench when the best XI the squad had (the formation kept, in hindsight) would have won. A haul left on a bench is 10 points or more.
- **Manager of the Month**: FPL's own months (its main game's phases; August is GW 1–2, September GW 3–5 …). Manager of the Month has the most table points from the month's head-to-heads, then the most points scored.
- **A player's story**: his owner each week is the manager whose lineup he was in at the deadline. An unclaimed week is one as a free agent with no waiver claim for him. A claim that would have dropped him and didn't go through (the player wanted went to someone with better priority, or was already gone) counts as a near miss, unless another claim dropped him anyway.

## Notes

- The FPL Draft API is unofficial and undocumented. If it changes, the schemas in `src/shared/fpl-api.ts` say where, and `src/build/` is the only place to fix.
- The look follows fotmob.com's colours and layout. The real font (GT Walsheim) is licensed, so the page uses it only if it's installed and otherwise falls back to DM Sans.
- Player photos and club crests are loaded from the Premier League's image servers; nothing comes from FotMob.
