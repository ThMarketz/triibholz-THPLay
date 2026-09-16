# My Development — a player's own test log, self target and home training

Built directly on a real club's own process: SC Horgen — Damen Dolphins, "Project 30"
individual test logbook. The catalogue of tests, the season-by-season targets, and the
swim-week structure below are taken from that real document, not invented.

## What it is

- **Profile & self target** — name, birth year, band, position, goalkeeper flag, Swiss
  Olympic Talent Card level and validity, last PISTE test date, a season tier (which
  benchmark column applies), a short goal for this training block, and a longer goal in
  the player's own words.
- **Test results**, logged against season targets. Four field tests and two goalkeeper
  tests are shared with the official Swiss Aquatics PISTE test:

  | Field test | U14 target | Test | GK test | U14 target |
  |---|---|---|---|---|
  | 25 m freestyle | ≤16.0 s | PISTE | Push-up height, eggbeater | baseline |
  | 50 m freestyle | ≤36.0 s | PISTE | Side shuttle 4×5 m | ≤22 s |
  | 100 m freestyle | ≤1:22 | PISTE | Lunge steps / 30 s | ≥12 |
  | 200 m | ≤2:50 | | Ball overhead hold (3 kg) | ≥1:45 | PISTE |
  | 8×25 m drop-off | <2.0 s | | Throw over halfway | 18 m |
  | Passing distance | 20 m | | Catch / save rate | baseline |
  | Ball overhead hold (3 kg) | ≥1:30 | PISTE | Penalty 5 m (of 20) | ≥3 | PISTE |
  | Jumps to crossbar / 30 s | ≥14 | | | |
  | Swimming per week | 3.75 km | | | |

- **Swim weeks** — metres at the club and metres self/home, side by side, plus sessions
  attended out of possible. Home training has always counted in this club's own process.
- **Home training + the mascot.** Six weekly activities (wall passing, mobility, a
  shoulder-band routine, bodyweight strength, ball feel, watching matches), each with its
  own weekly target. Log a session and the mascot notices; a fully-kept week reads as
  **Thriving**, a quiet one reads as **Neglected** — honestly, not as a guilt trip.

## How it's presented

The default view is a glance, not a form: a hero card (mascot mood, name, season tier,
current goal, streak), a four-number stat strip (tests at target, this week's home-training
compliance, this week's swim total, tests logged all-time), the home-training checklist
inline, and a benchmark **card** per test with a fill bar instead of a table row. Editing
the profile, logging a test result and logging a swim week are each a short modal — not
permanent on-screen forms. Raw history (every logged test, every logged week) is still all
there, just tucked behind a "history" disclosure so it doesn't dominate the page. A coach's
roster picker and team-import tool live behind a collapsed "Coach tools" disclosure so a
player's own view stays player-sized.

## Who vouches for a number

A player can log anything on their own record — self-tracking is the point, and an honest
bad number is worth more than a missing one. But a self-entered result is stored as
**self-reported** and counts for nothing official until a coach confirms it:

- the benchmark card stays grey and the bar does not move;
- the "tests at target" count ignores it;
- the player still sees their own number on the card, marked as waiting.

A coach confirms (or rejects) from the player's record, reached through the squad view.
A coach's own entries — and any bulk `.xlsx`/`.csv` import, which is coach-only by
construction — land confirmed immediately. If a player self-logged a number and the coach
later imports the same row from the club workbook, the existing entry is **upgraded** rather
than skipped as a duplicate.

Two deliberate decisions worth knowing:

- **Nothing is retroactively invalidated.** A result stored before this existed counts as
  confirmed. What marks it as never-coach-signed is an empty "Verified by", not a downgrade.
- **This is a fairness mechanism, not a security control.** The record lives in the
  browser's own storage, so a determined player could edit it in devtools. What is
  guaranteed is that there is no *path in the app* to self-verification.

## The squad view

Coaches and trainers land on a squad table instead of their own (meaningless) record: one
row per approved player — tier, tests at target, when they were last tested, home-training
compliance this week with the mascot mood, streak, and metres. Sort by any of the "lowest
first" orders to see who needs attention. Tapping a row opens that player's full record,
exactly as the player sees it.

Self-reported results are shown separately (`+2 self-reported`) and never colour a row as
progress. Players who have never opened the view read as "No record yet" rather than as a
misleading zero, and are excluded from the squad averages.

### The charts

Above the table, the same numbers are drawn (`js/chart.js`, hand-drawn SVG, no library):

- **One dot per player per test**, placed against the target for **their own** tier — which is why
  the scale reads "% of my target" and not seconds: a U14 and a U18 keeper cannot share a seconds
  axis honestly. The raw result travels with the dot. Better is always to the right, including for
  times, where the smaller number is the better one. A hollow dot is self-reported, a filled one
  coach-confirmed. Tests nobody has done are one line of text, not empty rows.
- **Where the squad is furthest behind** — the same normalised gaps that feed the season plan,
  each player counted once per focus so a focus with three tests cannot outweigh one with a single
  test.
- **Training attendance, lowest first** (see below).
- **A player's own test over time**, on their record, with the target as a rule across the chart:
  the first place in the app where a result is more than a row in a table.

Every chart says what it does **not** know. The card states how many of the squad have a record on
this device and how many results are confirmed against self-reported, because these records live
on each device: a chart here speaks for the players whose record is here and for nobody else.

### Training attendance (Spond)

Spond has no interface other apps may use, so attendance arrives as **Spond's own admin export**,
imported with the same button as the test logbook. The squad table gains an attendance column for
the last 90 days, and the charts show it per player, lowest first. Late counts as at training and
is shown as such; an excused absence is not attendance and is counted beside it. See
[SPOND.md](SPOND.md) for what was researched, what the club must decide, and why there is no live
connection.

## Feeding the season plan

The Season planner can read the signed-in player's own test log (**Use my test results**,
on by default when there is anything to use). Whatever they are furthest behind on gets
extra sessions in the weekly mix *and* the first — freshest — session of each week, and the
plan states which test drove it: *"⬆ more speed & power — 50 m freestyle: 1.4s to go"*.

Gaps are compared across units by normalising against the catalogue's own tier ladder, so
"how many steps behind" means the same thing whether the test is in seconds, metres or reps
— 6 m short of a passing target outranks 1.4 s on the 50 free, which a raw delta would get
backwards. Self-reported results are discounted to 70%, not excluded. At most two focus
areas ever lean, and a gap can never inject a session type the phase does not train (a
strength gap stays out of a Taper week).

The test catalogue measures physical qualities only, so **shooting and tactics can never be
driven by test data** for an outfield player — the plan says so rather than implying it is
fully data-driven.

## Privacy

This is the player's own record. It is visible to the player and to coach/trainer/
super-admin roles — never to teammates. A coach can view any approved player's record
through a roster picker; a player only ever sees their own.

## Import / export

- **Export** is CSV, for both the test log and the swim weeks — every spreadsheet app
  opens and saves it natively.
- **Import** accepts a real club workbook (`.xlsx`), a Spond attendance export (`.xlsx`), or a
  `.csv` of any of them, matched to the team roster by player name. A file is recognised by the
  columns it carries, never by its name; a name that is not on the roster is reported, never
  invented. Column headers are recognised in **English or German**
  (Datum/Name/Test/Resultat/Einheit/Getestet von/Bemerkung and the Schwimm-Wochen
  equivalents), because that is the real header language of the source document this
  was built against.
- The `.xlsx` reader is hand-rolled (a small ZIP central-directory parser + the
  platform's own `DecompressionStream` + minimal OOXML cell parsing) to keep the whole
  app dependency-free. It **reads** workbooks; it does not write them — export stays CSV,
  which is simpler to get right and opens back into Excel just as well. Verified against
  a real exported club logbook during development (not committed to this repository —
  it is a real club's private player data).

## Honest limits

- The XLSX reader is not a full spreadsheet engine. It expects one header row per sheet
  and simple cell values; formulas, merged cells and styling are not evaluated (values
  only). If a workbook genuinely can't be read, the app says so rather than guessing.
- Season tiers are generic labels (U14/U16/U18‑A/U18‑B) with a club's real target values
  seeded in; a club can relabel the season names, the numbers stay what they measured.
