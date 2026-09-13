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

## Privacy

This is the player's own record. It is visible to the player and to coach/trainer/
super-admin roles — never to teammates. A coach can view any approved player's record
through a roster picker; a player only ever sees their own.

## Import / export

- **Export** is CSV, for both the test log and the swim weeks — every spreadsheet app
  opens and saves it natively.
- **Import** accepts a real club workbook (`.xlsx`) or a `.csv`, matched to the team
  roster by player name. Column headers are recognised in **English or German**
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
