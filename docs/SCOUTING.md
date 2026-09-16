# Scouting the other team

A coach preparing for Saturday presses **📋 Scout the opponent** on the team-sheet screen and gets
what the opposing squad has actually done this season: who scores at 6-on-6, who scores a man up,
who takes the penalties, and who concedes the most exclusions. The figures are published by
[wpmatch.ch](https://wpmatch.ch) and any club can look them up; this reads them and arranges them
around the decisions a coach has to make.

## The one rule

**Never invent a number.**

The request was "which one is likely to get excluded". The honest answer is a count and its
denominator — *11 exclusions conceded in 11 matches* — and never a probability, a risk score or a
red/amber/green badge. There is no exclusion-*opportunity* denominator anywhere in the data, so a
likelihood cannot be computed. One presented anyway would be believed, and a coach who believes it
sends a thirteen-year-old to swim at a named child on the strength of it.

Everything else follows:

- Every figure carries what it is out of. A rate never appears alone: *24 of this squad's 44*.
- **Below five matches played, counts only** — no rate, no rank, no place in a section. A player
  with 29 goals in two matches would top any rate in the league; a child with none in two would
  read as "not a scorer". They are listed plainly and said to be too few to read.
- Comparisons stay **inside the squad that was downloaded**. A league-wide claim would need every
  squad in the league, which this app will not crawl.
- The team-level line obeys the same floor: three matches into a season there is no
  "expect this many a match".

## What it says, and what it refuses to

| Section | Real column | Why a coach needs it |
|---|---|---|
| Mark in 6-on-6 | `goalon` | most of the game is even, so this is the marking decision |
| Your man-down must cover | `goalextraplayer` | a different defensive answer from the one above |
| Who takes the penalty | `penaltygoals` | on a 5 m the goalkeeper is alone; knowing the taker is the preparation |
| Most often excluded in this squad | `exclusionfoul` | what they have been called for — not a forecast |
| The team line | Σ `exclusionfoul` | roughly how many extra-player chances to expect |

**Exclusions here are the ones a player CONCEDED.** Verified against a box score in both
directions: a squad's summed `exclusionfoul` equals the opponent's man-up opportunity count
exactly. Who *draws* exclusions — the opponent your defenders foul out on, which is what a coach
instinctively wants — is not recorded anywhere in wpmatch, and the report says so on the screen
rather than letting the column be misread.

Not built, deliberately: a probability or risk badge; league-wide tiers (they would need the crawl
this app refuses); per-match form (the per-match columns are the *team's* scoreline, in reverse
date order, with no match id); any per-minute rate (`eventminutes` is exactly 32 × appearances — a
nominal game length multiplied out, never measured); positions or handedness (the taxonomy is
empty, and inferring a goalkeeper from a cap number is wrong in both directions).

## Where it is in the app

| What | Where |
|---|---|
| **Our own season figures** | Teams → the team → **Our season figures** → *Show season figures* |
| **One player's own line** | the **ⓘ** beside any name, on the roster and on the availability list |
| **The opponent** | Teams → the team → **Scout an opponent** (type the name) — or from a match sheet, where the fixture fills it in |
| Per-match figures | Season → a played fixture → the box score |
| Your club's own test results | My Development |

Scouting an opponent needs the opponent's name first. It sits on the team page with its own
**Opponent** box, and also on a match sheet, where picking the fixture fills the name in. It was
originally only on the sheet — which hid it completely, because **New team sheet is disabled until
the team has players**, so a coach setting a team up could not reach it at all. Pressing the button with that field empty used to search *our own* team's name
and hand back our own squad — which reads as wpmatch being broken rather than as a field not filled
in. It now says which one to do.

A squad that has been looked up can be **kept under a name of the coach's own** ("Saturday — Other
Town") and comes back as a button beside *Scout the opponent*. Five at most, nothing older than a
week, and the limit is printed beside the name box rather than left implicit.

The **ⓘ** is a resting panel under the heading, never a card over the rows — a floating card would
cover the two rows being compared on a phone. It is bound to hover, focus **and** tap, because
hover does not exist on the device this app is used on. It fetches nothing: it reads the squad
already loaded by *Show season figures*, and says so when that has not been pressed.

The join is the wpmatch player id and nothing else. Not the cap number — three players in one live
squad wear '1', so a cap join would print the keeper's record under another child's name on a sheet
that gets handed to the officials' table. Not the name either. A player added by hand has no id and
is told so, rather than shown zeros that read as "never scores".

It is deliberately **not** on the name in the line-up editor (that is `<option>` text inside a
native select, which cannot carry a card in any browser), not over the roster's name boxes (a card
would cover the field being typed in), and not in the printed sheet — `sheetdoc.js` is untouched,
so no stray glyph reaches the official form.

## Other clubs' children

The rows are about minors — the sample used while building this was ten years old. wpmatch
publishes `age`, `yearofbirth`, `gender`, `eligibility` (a nationality statement), `height` and
`weight` alongside the playing figures.

**None of those six ever leave the normaliser.** `js/wpmatch.js` `normSquad()` is an allowlist: it
emits the name, matches played and the nine playing figures, and nothing else — so no later code
has to remember not to store them. A scouted squad is cached on the device only, is never sent to
the club's own server, and is wiped with everything else on sign-out.

It lives in its own store and is **never** a row in `db.teams` or in the shared player map. The
sync uploads every team on the device, so an opponent's children would otherwise land on our own
club's server — and a scouted player in the shared map could be tapped onto an official team sheet.
`scouted` and `squad` are refused by name in `js/teamsync.js` as well, so a team carrying either is
a hard refusal at the server too.

That this data is already public is not permission from those children's clubs. Re-displaying a
squad's published totals is one thing; compiling and keeping them is another, which is why one
opponent is fetched at a time, on an explicit press, and why there is no league-wide view.

## Honest limits

- **wpmatch keeps only the current season.** Last season is deleted rather than archived — squads
  that played a full season and did not return come back with zero rows. So "last year scored 80
  goals" cannot be answered, and the app never prints a season or a year: every figure is captioned
  with its own denominator instead.
- **The figures are per SQUAD, not per player.** A player registered with two squads has a separate
  record in each and the totals differ. They are never summed, and every line names the squad.
- **Roughly one squad in six publishes nothing usable.** That is wpmatch answering, not a
  connection problem, and the two are worded differently on screen.
- No positions, no handedness, no shot placement, no assists and no save data. A goalkeeper reads
  as 0 goals, and that is not a judgement about him.
- Cap numbers are not in this data: the number wpmatch holds belongs to the person, not the cap
  worn on the day, and is not unique within a squad. Briefing "take number nine" from it would mark
  the wrong child.

## Where the parts live

`js/wpmatch.js` fetches and normalises (`fetchListIndex`, `resolveList`, `fetchSquad`, `normSquad`);
`js/scout.js` judges (`SCOUT.report`), pure and tested on its own; `js/teams.js` renders. The same
split as ELIGIBILITY and TEAMSHEET, and for the same reason: the judging is where the mistakes are.

Finding a squad's list is not obvious — a list carries no team field and `?team=` is silently
ignored. See [WPMATCH.md](WPMATCH.md) for that and the other traps.

Tests are in `tests/smoke.mjs` sections **[14b]** (what is kept and what is refused) and **[14c]**
(what the report will and will not say), against a frozen corpus of invented players: no real club,
child or licence number appears in a test.
