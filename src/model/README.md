# Expected points model

The site's own expected points (xP) for every player in a gameweek. It is built only from
FPL's data:

- each finished gameweek's live feed: minutes, xG, xA, goals, assists, defensive actions,
  saves, bonus and cards, match by match;
- the Draft game's scoring rules and FPL's injury flags.

It replaces FPL's own expected points, which are only form times the chance of playing.
Form is a player's average over the gameweeks of the last 30 days, so it has nothing for
the opponent, the minutes he gets or his xG.

In short:

```
points = his minutes × (his goals and assists per xG of his club's × his club's expected goals against this opponent)
       + clean sheets, goals conceded and saves from the goals his club can expect to concede
       + defensive contributions and cards from his rates per 90
       + penalties, for his club's takers
       + bonus from what his goals, assists, clean sheets and the rest earn in it
```

## The parts

- **History** (`history.ts`). Every club's matches, with its xG for and against, and every
  player's appearances, match by match. A double gameweek's stats are split by minutes. A
  player's club is his current one, so the matches he played for a club he has since left
  are left out.
- **Team strength** (`teams.ts`). A Poisson model fitted by Newton steps: a club's expected
  goals against an opponent are `exp(base + home + attack − opponent's defence)`.
  - The target is 85% xG, 15% goals, the blend AIrsenal uses for player shares.
  - A match ten gameweeks back counts half.
  - Each rating starts from last season's, 80% of the way from the league average (a
    promoted club from the league average itself), with a prior worth 6 xG, about four
    matches, so the first weeks of a season don't swing it.
  - Home advantage starts from +16% with a prior worth 20 xG.
- **Player rates** (`players.ts`).
  - **Goals and assists:** his share of his club's xG while he is on the pitch, as goals
    and FPL assists per club xG.
    - Shares come 85% from xG and xA, 15% from actual goals and assists.
    - They're pulled towards his own share last season if he was at the same club, and
      his position's average if not, by a prior worth GK 700, DEF 15, MID 6 and FWD 15
      xG of his club's. Those are AIrsenal's tuned values but for forwards,
      whose 60 is fitted on several seasons of data: on one season's it held the best
      forwards back, and 15 forecast forwards better in 2024/25 and 2025/26 (below).
  - **xG to goals:** defenders' chances (headers, mostly) convert at 0.85 goals per xG,
    season after season; everyone else's at 1.
  - **xA to FPL assists:** FPL gives more assists than xA suggests, for rebounds,
    deflections and penalties won.
    - The whole-season ratios are DEF 1.29, MID 1.33 and FWD 2.11.
    - This season's ratios are pulled towards those by 10 xA.
  - **Other rates:** defensive actions and yellow cards per 90, pulled towards the
    position's rate by 10 matches' worth.
  - **Saves:** a goalkeeper's saves against the league's line of 1.41 + 0.99 × xG
    conceded per 90, pulled towards it by 10 saves.
- **Expected minutes** (`players.ts`).
  - **Scenarios.** His minutes in each of his club's last 10 matches (0 when he didn't
    play) are scenarios, each weighing 0.7 of the one after it. So a regular starter, a
    rotation risk and someone who has lost his place each come out as they should. The
    minutes that matter count scenario by scenario: 60 for a clean sheet and the second
    appearance point, and enough to reach the defensive threshold.
  - **Missed matches** count 0.7 of a played one. Often it was an injury or a ban that
    is over, or his flag would still say so, so a regular who missed a week is still a
    regular.
  - **Absence.** Even an unflagged regular has a 3.5% chance of not playing (a knock, a
    rest). With these, each club's expected minutes come to about 980 a match, as many as
    its players have played on average this season.
  - **Flags.** FPL's chance of playing scales him, a little below its face value: to
    the power 1.25, so 75% becomes 0.70 and 50% becomes 0.42. AIrsenal counts 50% or
    less as out, but nobody has published how often flagged players do play. So the
    build keeps every deadline's flags (data.json's `flags`), and once a season's worth
    are in, the discount can come from them. The minutes a flag takes away go to his
    **stand-ins**: his club's other players who could fill his role. Most go to those
    with room to play more, who have been in the side lately and play the most like him.
    Midfielders and forwards stand in for each other, since FPL's line between them
    doesn't follow the wings.
    - **Role** is how a player's attacking output (goals and assists per club xG)
      compares with his defensive actions, as an angle. A winger stands in for a
      winger, a holding midfielder for a holding midfielder.
    - **Starting chance.** Each stand-in gets his share as a chance of starting (85
      minutes for a defender, 80 for a midfielder, 78 for a forward, 90 for a
      goalkeeper).
    - **Example.** With Saka out for GW 9, Madueke goes from 39 expected minutes to 69,
      the most at Arsenal. Arsenal's holding players gain less, about half of it from
      Tzolis, who is out too.
- **Last season** (`last-season.ts`). Where shares and club ratings start, from a summary
  of the season before: each player's minutes, xG, xA, goals and assists at the club he
  ended it at, with his club's xG while he was on, and every match's xG and goals. The
  model works out last season's shares and ratings from those its own way (shrunk like
  this season's, over the whole season).
  - Only a player still at the same club starts from his own share, and a club promoted
    since from the league average: a signing starts from his position's average, as
    everyone did before.
  - The pull is the same as the averages had, so last season counts for about half in the
    first weeks, and later for about a quarter of a regular midfielder's share and 40% of a
    forward's (recent matches count most, so this season's never wholly take over).
  - The summaries are in `public/seasons/model/`, by FPL's codes for players and clubs,
    which stay the same from season to season while the ids don't. The build writes each
    finished season's (`src/build/last-season.ts`) and the workflow commits it with the
    season's archive. 2025/26's, from before the site's first season, comes from vaastav's
    match data (`node scripts/season-summary.ts 2025-26`).
- **Bonus** (`bonus.ts`). FPL gives bonus to a match's three best BPS, which mostly follow
  goals, assists and clean sheets, so bonus comes from the match rather than a flat rate.
  - **What earns it.** What a goal, an assist, a clean sheet, a defensive contribution and
    three saves have been worth in bonus at each position this season, by least squares on
    every appearance (weighted by age like the rates above, and pulled a little towards
    none so the first gameweeks stay steady).
  - **His own.** Each player's bonus beyond what his events earned, per 90, pulled towards
    none by 10 matches' worth: a playmaker's passing and chances created, say.
  - **Shared out.** A match hands out the same bonus whoever plays in it (3, 2 and 1, more
    with ties), so its players share the season's average per match, about 6.3, each in
    proportion to what he can expect.
  - A flat rate per 90 pulled towards the position's average left the best players short,
    since what they score is what earns it.
- **Points** (`points.ts`). FPL's scoring from the Draft bootstrap, applied to a match:
  - appearance points by minutes;
  - goals and assists from his rates × his club's expected goals × his minutes;
  - a clean sheet (60 minutes or more) as the chance of no goals while he is on;
  - goals conceded (−1 per 2) and a goalkeeper's saves (+1 per 3) in expectation;
  - the defensive contribution (+2 for 10 tackles, clearances, blocks and interceptions
    in defence, or 12 with recoveries elsewhere) as the chance his count reaches it;
  - bonus from the match (above), and cards at his rate;
  - **penalties.** A club wins about 0.12 a match, scaled by the xG it can expect
    against this opponent, since a club's own penalty count is too noisy to go on. They
    go to its takers in FPL's order (from FPL's main game: the Draft one leaves it empty),
    each taking them when nobody ahead of him is on the pitch. 79% go in (a penalty's xG),
    for the goal's points, and the rest cost 2. A goalkeeper saves about 15% of those he
    faces, for 5 points. A first-choice taker's share of his club's attack leaves out the
    penalties he could expect to have taken, so they aren't counted twice.

  Goals are a negative binomial of size 10 rather than a Poisson, since a club's rate is
  itself uncertain (a Poisson with an uncertain rate is a negative binomial). Defensive
  actions vary more than a Poisson allows too, so they are one of size 6.

- **Forecast** (`forecast.ts`). The parts together for a gameweek's fixtures, learning
  only from the gameweeks before it, summed over a double gameweek. `DEFAULT_OPTIONS`
  holds every number above.

The build uses it from the second gameweek on (`src/build/expected.ts`): for the projected
XIs, the pre-match odds and the live gameweek's expected points. Before any gameweek has
been played it falls back on FPL's.

## How well it does

`node src/model/backtest.ts` forecasts each finished gameweek from the third and scores it
against the points that came. It learns only from the gameweeks before the one it
forecasts, and doesn't know who was flagged at the time (FPL doesn't keep old flags).

The benchmarks:

- **FPL's expected points** as they stood at that deadline, rebuilt from form. The rebuilt
  form matches FPL's own for 667 of 668 players.
- **Points per gameweek** so far.

Errors are per player and gameweek. The model is scored on RMSE, since expected points are
a mean, which is what minimises the squared error.

GW 3–7 of 2026/27, RMSE (MAE in brackets):

|                                   | n     | Model           | FPL form    | Points per gameweek |
| --------------------------------- | ----- | --------------- | ----------- | ------------------- |
| The league's squads               | 600   | **3.28** (2.57) | 3.88 (2.96) | 3.72 (2.92)         |
| Everyone who has played           | 2,014 | **2.63** (1.83) | 3.05 (2.02) | 2.93 (1.99)         |
| Everyone who played 60+ that week | 1,026 | **3.28** (2.43) | 3.78 (2.81) | 3.65 (2.73)         |

- **Every gameweek, every position.** It beats both benchmarks in every gameweek, by the
  most in the early ones, when form is a week or two of luck. By position, its RMSE is
  11–16% below form's.
- **From a single gameweek.** Forecast from GW 1 alone, GW 2's RMSE was 3.70 against
  form's 5.02 over the squads.
- **Against last season.** On players who played 60+ in 2025/26 (GW 8–38), a trailing
  four-gameweek average had an RMSE of 3.74, and the season's average 3.55. Those are
  other players in another season, so only a rough guide.

The parts against what came, over everyone who has played:

|                         | Forecast | Actual |
| ----------------------- | -------- | ------ |
| Appearance              | 2,569    | 2,463  |
| Goals                   | 673      | 640    |
| Penalties               | 44       | 6      |
| Assists                 | 385      | 381    |
| Clean sheets            | 657      | 713    |
| Goals conceded          | −269     | −241   |
| Defensive contributions | 348      | 344    |
| Saves                   | 62       | 61     |
| Bonus                   | 319      | 317    |
| Cards                   | −186     | −194   |

The appearance points come out high because the backtest has no flags: it gives some
minutes to players who were injured at the time. FPL doesn't say which goals were
penalties, so the actual penalties are only the misses and saves, and the scored ones are
in goals. Over the league's squads it comes out 0.06 points a week low.

Without last season (as the model was before), the squads' RMSE was 3.30 and everyone's
2.64, and the squads came out 0.15 a week low: those are mostly good players, and every
share and club rating started from the averages.

### On whole past seasons

Five gameweeks can't tell small changes apart, so the model was also run on 2024/25 and
2025/26 from vaastav's match data: each gameweek from the fourth forecast from the ones
before it, without flags and with each club's penalty order at the end of the season.

- **The best players came out low.** Those priced £8.5m or more at the start of the
  season (FPL's main game; the model never sees prices) scored 0.2–0.5 a week more than
  forecast, and those under £5.5m 0.15 less. Per appearance, their clubs' xG while they
  were on came out 4–8% low, their share of it about right for goals but 10–20% low for
  assists, and their bonus lowest of all: 0.37 forecast against 0.52 a week in 2025/26, and
  0.50 against 0.65 in 2024/25.
- **Bonus from the match**, with the forwards' prior at 15, lowered the RMSE from 2.4857 to
  2.4846 in 2025/26 and from 2.3266 to 2.3248 in 2024/25, with each position's bonus within
  0.02 a week of what came. The best players' bonus rose only a little (to 0.39 and 0.52):
  their clubs and shares are the rest, and those need more than this season's matches.
- **Last season** (2024/25 for 2025/26, 2023/24 for 2024/25) lowered it further, to
  2.4823 and 2.3211, most in the first gameweeks. The best players now come out right:
  3.68 a week forecast against 3.68 in 2025/26, and 4.56 against 4.51 in 2024/25. The five
  or so dearest of all come out a little high (0.2–0.4 a week), and those whose last season
  was poor or short start low (2025/26's Isak, say).
- **Tried, and no better:** a model of each player's BPS (his baseline, plus what each event
  is worth, through the curve of bonus by BPS, which hardly changes from season to season);
  pulling every rate less; last season's matches as more history (aged out by
  mid-season); and starting a promoted club below the league average, like the clubs that
  went down (better one season, worse the other).

**Stand-ins** can't be tested on FPL's real flags, so they were tested on perfect ones: every
player who played the week before but not that week. Handing their minutes on lowered the
RMSE for everyone else from 2.687 to 2.676, and weighting the stand-ins by role to 2.670.
Each club's expected minutes then come back from 886 a match to 971.

Five gameweeks is little to tune on, and most settings barely move the error. The numbers
will move as the season goes on, and two choices are worth testing again:

- **Goals in the team ratings.** AIrsenal found that actual goals in the team ratings hurt
  over whole seasons. Here, half goals did slightly better (squads' RMSE 3.27 against
  3.28), since GW 1–2 had far more xG than goals: 1.64 a club per match, against about
  1.45 since. That's too few weeks to go against whole seasons, so the ratings lean on xG.
- **Minutes.** AIrsenal uses the last three matches with equal weight. Here it is the
  last ten, each counting 0.7 of the one after it, and a missed match 0.7 of a played
  one. The backtest can't judge these well, since it has no flags: it can only tell who
  is still injured from the matches he has just missed. The flags kept at each deadline
  will test them.

## For v2

- **New players and new seasons.** A signing has no minutes with his club yet, so he
  forecasts nothing until he plays, and nobody has minutes before the season's first
  gameweek. AIrsenal starts a season from last season's minutes, and the summaries could
  carry those too. A signing could also start from his share at his old club, scaled to
  his new one's.
- **Two seasons back.** Only last season is used; one more, counting for less, is untested.
- **Players who change clubs mid-season** lose their old club's matches (see History).
- **Opponents in the minor parts.** Defensive actions (tested here: no gain yet) and
  cards are flat rates for now.
- **Set pieces.** FPL lists the corner and free-kick takers too
  (`corners_and_indirect_freekicks_order`, `direct_freekicks_order`), which could lift
  their assists and direct free-kick goals the way the penalty order does for penalties.

## Sources

- AIrsenal's models: [xG models](https://github.com/alan-turing-institute/AIrsenal/blob/main/docs/xg-models.md) and [how it works](https://github.com/alan-turing-institute/AIrsenal/blob/main/docs/how-it-works.md)
- [OpenFPL](https://arxiv.org/html/2508.09992v1)
- The Premier League on [defensive contributions](https://www.premierleague.com/en/news/4361991) and [assists](https://www.premierleague.com/en/news/4362187)
- [The Analyst on xG](https://theanalyst.com/articles/what-is-expected-goals-xg) and [on penalties](https://theanalyst.com/articles/football-newsletter-penalties-bruno-fernandes)
- FPL's 2023/24–2025/26 match data, as archived by [vaastav/Fantasy-Premier-League](https://github.com/vaastav/Fantasy-Premier-League), for the whole-season ratios and the tests on past seasons above
- Fantasy Football Scout on [baseline bonus](https://www.fantasyfootballscout.co.uk/2023/10/13/who-are-the-bonus-point-kings-in-fpl/), and the Premier League on [the bonus points system](https://www.premierleague.com/en/news/106533)
