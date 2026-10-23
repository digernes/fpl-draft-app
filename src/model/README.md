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
       + defensive contributions, bonus and cards from his rates per 90
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
  - Each rating starts from the league average with a prior worth 6 xG, about four
    matches, so the first weeks of a season don't swing it.
  - Home advantage starts from +16% with a prior worth 20 xG.
- **Player rates** (`players.ts`).
  - **Goals and assists:** his share of his club's xG while he is on the pitch, as goals
    and FPL assists per club xG.
    - Shares come 85% from xG and xA, 15% from actual goals and assists.
    - They're pulled towards his position's average by a prior worth GK 700, DEF 15, MID 6
      and FWD 60 xG of his club's (AIrsenal's tuned values).
  - **xG to goals:** defenders' chances (headers, mostly) convert at 0.85 goals per xG,
    season after season; everyone else's at 1.
  - **xA to FPL assists:** FPL gives more assists than xA suggests, for rebounds,
    deflections and penalties won.
    - The whole-season ratios are DEF 1.29, MID 1.33 and FWD 2.11.
    - This season's ratios are pulled towards those by 10 xA.
  - **Other rates:** defensive actions, bonus and yellow cards per 90, pulled towards the
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
- **Points** (`points.ts`). FPL's scoring from the Draft bootstrap, applied to a match:
  - appearance points by minutes;
  - goals and assists from his rates × his club's expected goals × his minutes;
  - a clean sheet (60 minutes or more) as the chance of no goals while he is on;
  - goals conceded (−1 per 2) and a goalkeeper's saves (+1 per 3) in expectation;
  - the defensive contribution (+2 for 10 tackles, clearances, blocks and interceptions
    in defence, or 12 with recoveries elsewhere) as the chance his count reaches it;
  - bonus and cards at his rates.

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
| The league's squads               | 600   | **3.28** (2.55) | 3.88 (2.96) | 3.72 (2.92)         |
| Everyone who has played           | 2,014 | **2.63** (1.83) | 3.05 (2.02) | 2.93 (1.99)         |
| Everyone who played 60+ that week | 1,026 | **3.30** (2.44) | 3.78 (2.81) | 3.65 (2.73)         |

- **Every gameweek, every position.** It beats both benchmarks in every gameweek, by the
  most in the early ones, when form is a week or two of luck. By position, its RMSE is
  11–14% below form's.
- **From a single gameweek.** Forecast from GW 1 alone, GW 2's RMSE was 3.74 against
  form's 5.02 over the squads.
- **Against last season.** On players who played 60+ in 2025/26 (GW 8–38), a trailing
  four-gameweek average had an RMSE of 3.74, and the season's average 3.55. Those are
  other players in another season, so only a rough guide.

The parts against what came, over everyone who has played:

|                         | Forecast | Actual |
| ----------------------- | -------- | ------ |
| Appearance              | 2,569    | 2,463  |
| Goals                   | 707      | 640    |
| Assists                 | 378      | 381    |
| Clean sheets            | 647      | 713    |
| Goals conceded          | −269     | −241   |
| Defensive contributions | 348      | 344    |
| Saves                   | 62       | 61     |
| Bonus                   | 320      | 317    |
| Cards                   | −186     | −194   |

The appearance points come out high because the backtest has no flags: it gives some
minutes to players who were injured at the time. Over the league's squads it comes out
0.17 points a week low. Those are mostly good players, and pulling every rate towards the
position's average costs them most in bonus.

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
  forecasts nothing until he plays. In the first gameweeks everyone starts at the league
  average. Possible starts:
  - FPL's `element-summary/{id}` has each player's past seasons (`history_past`), and the
    community archive (vaastav's) has them match by match. AIrsenal starts a season from
    last season's minutes and three seasons of team data.
  - A promoted club could start at the league average, as AIrsenal's does, or below it.
- **Players who change clubs mid-season** lose their old club's matches (see History).
- **Bonus from the match.** Bonus follows goals, assists, clean sheets and defensive
  contributions, so it could come from the forecast ones instead of a flat rate. It would
  need refitting on 2026/27, since the bonus points system changed.
- **Opponents in the minor parts.** Defensive actions (tested here: no gain yet) and
  cards are flat rates for now.
- **Penalties and set pieces.** FPL lists the takers (`penalties_order` and so on). A new
  taker's penalty xG, about 0.1 a match, would come before his shots do.

## Sources

- AIrsenal's models: [xG models](https://github.com/alan-turing-institute/AIrsenal/blob/main/docs/xg-models.md) and [how it works](https://github.com/alan-turing-institute/AIrsenal/blob/main/docs/how-it-works.md)
- [OpenFPL](https://arxiv.org/html/2508.09992v1)
- The Premier League on [defensive contributions](https://www.premierleague.com/en/news/4361991) and [assists](https://www.premierleague.com/en/news/4362187)
- [The Analyst on xG](https://theanalyst.com/articles/what-is-expected-goals-xg)
- FPL's 2024/25–2025/26 match data, as archived by [vaastav/Fantasy-Premier-League](https://github.com/vaastav/Fantasy-Premier-League), for the whole-season ratios above
