# FotMob Draft League

A fotmob.com-style page for our FPL Draft league (#23793): table with form, fixtures with odds,
top gameweeks, transfer stats, original squads and each manager's Premier League twin.

## What's on it

- **Overview**: next gameweek with 1 X 2 odds, table with form, the highest-gameweek prize race, PL twins, latest transfers, original-squad tracker.
- **Table**: All · Form (last 5 GWs) · xG (like FotMob's xG table) · Luck (every week against the league average) · Simulated (how often each manager finishes 1st, 2nd … last over 10,000 runs of the rest of the season) · Total points · PL parallel (the real PL table with managers slotted in on their H2H points), plus a luck card beside it. Phones get a Short/Form switch.
- **Fixtures**: every gameweek. Tap a match for both XIs with points, auto-subs and DGW flags. Upcoming matches show win probability and projected XIs.
- **Stats**: top 10 gameweeks, season records, points heatmap, MVPs, bench points.
- **Transfers**: per-manager table, awards, best pickups, the ones that got away, most-contested waivers, trades, waiver order, hot potatoes, full log.
- **Draft**: how much of each original squad is left and how many points it produced, the draft board, steals and busts.
- Search ("Who owns…?") in the top bar, light/dark theme and decimal/fractional odds under the cog.
- The table marks the prize places (1st and 2nd) and last place, whose penalty is still to be announced. Managers appear by first name only, since the page is public.
- Finished seasons are kept: the season chip becomes a picker once there is more than one.

## How it works

```
FPL Draft API ──► scripts/build-data.mjs ──► data.json ──► GitHub Pages
                  (GitHub Actions: hourly, and every 10 min while matches are on)
```

The browser can't call the FPL API itself (no CORS), so a scheduled job builds `data.json` and the
page is plain HTML/CSS/JS with no build step. While it's open, the page re-checks `data.json` every
2 minutes during a live gameweek and every 10 minutes otherwise.

The 10-minute runs follow the usual Premier League slots (Saturday, Sunday and weekday evenings, UTC,
in both BST and GMT). Games at odd times, like Boxing Day, still get the hourly run.

When a season's last gameweek finishes, the build freezes it into `seasons/2026-27.json` and lists
it in `seasons/index.json`. For next season, point `LEAGUE_ID` at the new league and the old one
stays browsable from the season picker. `--archive` freezes the current season by hand.

## Run locally

```bash
node scripts/build-data.mjs
python3 -m http.server 8000
```

Then open http://localhost:8000. Add `--cache .cache` to the build to reuse raw API responses
between runs while you hack on it.

## Put it online (free)

1. Create a GitHub repo and push this folder to `main`. Public is simplest: everything in it comes from the public API.
2. In the repo: Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. Push, or run Actions → **Update data and deploy** → Run workflow.
4. The site is at `https://<user>.github.io/<repo>/`. After that it refreshes itself on the schedule above and only redeploys when the data changed.

Public repos get unlimited Actions minutes, so this costs nothing. Pages on a private repo needs a
paid GitHub plan (and the site is still public to anyone with the link), and the schedule uses
roughly 1,500 of the 2,000 free minutes a month before deploys, so trim the match windows if you go
private. Any other static host (Cloudflare Pages, Netlify) works too, as long as the Action keeps
`data.json` fresh.

## Tweaking

- League: set the `LEAGUE_ID` repo variable (Settings → Secrets and variables → Actions → Variables). Defaults to 23793.
- Constants at the top of `scripts/build-data.mjs`: `DGW_PENALTY`, `TOP_GAMEWEEKS`, `FORM_LENGTH`, and for the odds `ODDS_OVERROUND`, `FORM_WEIGHT`, `PROJECTION_WEIGHT`, `MIN_SCORE_SPREAD`.

## How the numbers are made

- **Top gameweeks and the highest-gameweek prize**: the score minus 4 for every player in the scoring XI (after auto-subs) whose club has two fixtures that gameweek. The best adjusted score holds the prize; on a tie the earlier week wins, and two managers level in the same week share it. Only finished gameweeks count. The list gives every manager's best week a place and fills the rest with the highest remaining scores; weeks only there because of that get a "Best GW" tag.
- **Odds**: a manager's expected score is the league average, plus 60% of how far their recency-weighted form sits from it, plus (next gameweek only) 30% of how far their best projected XI sits from the league's average projection (FPL's own expected points). The spread comes from this season's scores (at least 13 points). A draw is both sides landing on the same integer. Prices carry a 5% margin and are rounded down onto the standard fractional ladder, so decimal and fractional always agree.
- **Luck**: every week is played against the league average, and scoring above it is a win. Beating the league average is the same as beating everyone else's average. Luck is your real table points minus those points: what the fixture list gave or took.
- **Simulated season**: every unfinished match is played 10,000 times with the odds model. Each score is drawn around the manager's expected score with this season's spread, plus a per-run offset (±3 points a week, typically) for how good they really are, since a few weeks of form is only a rough guide. Ties on points go to points scored, as in the real table. The random numbers are seeded, so the same data always gives the same percentages and the scheduled job only commits real changes. A match still being played is simulated from scratch.
- **xG table**: each player's points with goals, assists, clean sheets and goals conceded swapped for what their xG, xA and xGC were worth (a clean sheet counts as e^−xGC per full game). Minutes, bonus, saves, cards and defensive contributions stay as scored. xPF adds that up over each scoring XI and xPA does the same for your opponents. xPTS decides every match with a normal model around both expected scores, with the spread of actual minus expected (about 7 points). Sorted by xPTS, as FotMob does.
- **PL twin**: the Premier League club on the same points (or the closest). Managers level on points share out the level clubs in table order. The PL table is rebuilt from the same API's fixtures.
- **Transfer net**: points scored by the player brought in minus the player let go, from that gameweek on. "Banked" is what the new player actually scored in the XI.
- **Original squad**: draft picks still owned today. "% of points" is the share of XI points that came from original picks.

## Notes

- The FPL Draft API is unofficial and undocumented. If it changes, `scripts/build-data.mjs` is the only place to fix.
- The look follows fotmob.com's colours and layout. The real font (GT Walsheim) is licensed, so the page uses it only if it's installed and otherwise falls back to DM Sans.
- Player photos and club badges are hotlinked from the Premier League and FotMob image CDNs.
