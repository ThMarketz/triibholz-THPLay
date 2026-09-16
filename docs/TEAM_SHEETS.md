# Teams & team sheets

Before every Swiss water-polo match each team hands the officials' table its
**Offizielle Spielaufstellung** — a one-page form with the club, league, date, every player's
licence number and the staff signatures (Reglement 5.1.1, Art. 6.1: a player may only play if
listed on it before the start). This feature builds that form from a coach's own teams and
downloads it as a real Word or PDF file.

- **Coaches** (and trainers, admins) get a **Teams** tab: several teams, each with a roster, a
  sheet layout and staff; a new sheet per match, checked against the regulations, previewed,
  and downloaded.
- **Players** get **My player card** on My Development: their licence number and what wpmatch.ch
  holds for them.

## Where the data comes from

### Licence numbers are public — they are the wpmatch player `slug`

`https://wpmatch.ch/player/<licence>/` — the licence number is the SportsPress `slug`, **not**
the post id (`/players/<licence>` returns `rest_post_invalid_id`). Verified two independent ways:

- the official Game Report PDFs (Swiss WP Timing) carry a "License" column: 157 licence↔name
  matches across 7 reports, 0 contradictions;
- a real club team sheet from 2023: 12 of 13 licence numbers resolve to the right surname; the
  13th has no public record.

`/players?slug=a,b,c` is honoured, so a whole roster loads in **one request** (~1.5 s). Every
team filter (`?teams=`, `?current_teams=`, `?sp_team=`) is **silently ignored** — the total
stays at 2572 — so "find this team's players" is a sequential crawl of all ~26 pages filtered
client-side (about a minute; parallel requests make wpmatch answer with an HTML error page).

### Never fetch `date`

On wpmatch, a player record's `date` is that player's **full date of birth**, public, for ~2560
people, many of them minors. `WPMATCH.PLAYER_FIELDS` never requests it and `normPlayer()` never
reads it; both are tested. (Worth reporting to Swiss Aquatics: waterpolo@swiss-aquatics.ch.)

### Traps handled

| Trap | What it would have done | Handling |
| --- | --- | --- |
| ~100 people have **two** records — an old *Inactive License* number and a new active one | the sheet carries a stale licence | `dedupePlayers()` keeps the active one; two *active* namesakes both stay |
| Titles are "First Last", but a third word makes the split a guess | surname and first name swapped on the form | split, flagged `nameGuessed`, shown with a **?** for the coach to fix; a coach's correction survives every refresh |
| `_TEMP` records | an unconfirmed licence on the form | stripped from the name and flagged |
| `number` is the **cap** number | mistaken for the licence | read as cap only |
| wpmatch has no positions | no goalkeepers known | the coach ticks GK once per player |

The eligibility status is `metrics.Eligibility`, with exactly five values across all records:
*Swiss*, *Swiss Sport Nationality*, *Swiss Sport Experience*, *Ausländer/Étranger*,
*Inactive License*.

## Who can play, and inviting the players

A sheet carries the coach's own note on who can play this match: ✓ can play, ✕ cannot, ? not asked.
**Build the line-up from those in** fills the form from that pool (keeper still in cap 1), and
auto-fill never places someone marked ✕. "Not asked" is stored as nothing at all, never as an
answer, and the card says in plain words what this is: *nobody has been asked and nothing is sent*.

Asking the players themselves — a real invitation they answer — needs accounts, and lands with
slice 4 of [ACCOUNTS.md](ACCOUNTS.md); the server side (club join links, per-person invites) is
already built. Until then **Invite players to the app** on the sheet shows the club's join code and
its QR: the player scans it, lands in the app and joins the team. The code now travels **after the
`#`**, which a browser never sends to a server, so it stays out of server, proxy and tunnel logs —
and each install makes its own code once instead of every install sharing one built into the app.

## Where the data is stored — on the device, and nowhere else unless a coach says so

Rosters are licence numbers, names, birth years and nationality status, much of it for minors.
Everything lives on the device that made it:

- the coach's teams, rosters, templates and sheets: `localStorage['thplay.teams.v1']`;
- the player's card: `localStorage['thplay.mycard.v1']`, on the player's own device, read live
  from wpmatch by licence number.

**Nothing is sent anywhere automatically.** A test spies on `fetch` while a sheet is built and
fails if a licence number or a name leaves the device (fault-injected: posting the roster on save
fails it).

### Sending a team to the club, on purpose

Once the club runs a server with accounts on — real passkeys, real memberships, every endpoint
authorized (slice 5 of [ACCOUNTS.md](ACCOUNTS.md)) — a coach can press **Sync with the club** and
put their teams there, so a roster survives a lost phone and follows the coach to a second device.
It is a button, pressed by a person, every time. There is no background sync and no "on by default".

What travels is fixed by `js/teamsync.js`, which the **server enforces on the same payload**, so a
rule cannot be kept on one side and forgotten on the other. It is a whitelist — anything else is
refused rather than dropped:

| Sent | Kept on the device |
|---|---|
| surname, first name, licence number, cap number, goalkeeper flag | a **date of birth** — never fetched, never stored, and refused by name and by a SQLite `typeof` CHECK |
| the team's name, category, season and league label | a licensed player's **birth year and gender** — wpmatch supplies both here, from a licence that is already public |
| | **nationality status** ("Ausländer-Étranger", "Inactive License") — a statement about a named child that anyone holding the public licence can re-derive in one request |
| | **availability** — an opinion about a child's body |
| | **the sheets themselves**, so the sheet builder keeps working at a pool with no signal |

A player whose licence is still pending is the one exception: their birth year and gender do travel,
because nothing else can supply them.

Three stores, kept apart on purpose: `thplay.teams.v1` is the coach's own, still fully editable
offline; `thplay.teams.mirror.v1` is what the club's server said, read-only; `thplay.teams.sync.v1`
records which team reached the club and when. The mirror is never merged into the coach's own
store — two editable copies of one roster is how a child ends up on the wrong sheet at a pool.

**Signing out wipes all four keys** (including the player card), whether or not the server could be
reached. A shared laptop at a club is the ordinary case, not the exotic one.

**Consequence:** a coach's rosters follow them to a second device once the club's server is on and
they have synced. Their past sheets do not — those stay where they were made.

## The eligibility check

`js/eligibility.js`, pure and tested. Sources, read in full from swiss-aquatics.ch:
Reglement 5.1.1 *Wettkampfbestimmungen Water Polo* (01.09.2025 and **01.09.2026** editions),
Reglement 5.1 WR-WB (Art. 4, 17), World Aquatics rule 2.1, and the 2025/26 youth handout.

**Warn, don't block.** The texts contradict themselves in places (the Swiss Sport Nationality
age cut-off is worded three ways), licences are issued late, and an app that stops a legal
player from playing is worse than one that raises a doubt. So:

- **errors** — only what the *form itself* makes unambiguous: more than 14 players, no
  goalkeeper, more than 2 goalkeepers, a missing or duplicated licence number. Downloading with
  errors asks for confirmation.
- **checks** (warnings) — everything read out of a regulation, each citing its article.
- **notes** — what cannot be checked (unknown birth year or status).

| Rule | Where |
| --- | --- |
| Season runs 1 Sep – 31 Aug; age counts the year the season **ends** | Art. 6.6 |
| Youth birth-year windows: U10 ≤10 · U12 10–12 · U14 12–14 · U16 14–16 · U18 16–18 | Art. 6.6 b–h |
| Up to 3 younger players per team, reported to the league | Art. 6.6 |
| Girls may be one year over the youth limit | Anhänge 13–15 |
| U14: girls at most 50% of the list — **from 2026/27 only** | Anhang 13A |
| At most 14 players, at most 2 goalkeepers, at least 1 | WR-WB Art. 4; WA 2.1 |
| Red caps 1 and 13 (2026); in U10–U14 only cap 1 | Art. 4.1 |
| NLA / NLB / Swiss Cup men: 2 foreigners + 1 Swiss Sport Experience (2026/27) | Anhänge 1, 3, 16 |
| NLD, Swiss Cup women: 1 foreigner | Anhänge 7, 16 |
| Regionalliga, Promotionalliga Damen: no foreigner limit | Anhänge 4, 8 |
| **Swiss Trophy — only Swiss and Swiss Sport Nationality** (SSE also barred from 2026/27) | Anhang 2 |
| A valid licence is required | Art. 6.4 |

A team can override its category preset — "only Swiss players may play" — for a special event.

**Mapping the club's names:** "top division" → NLA (men) / NLD (women); "second division" →
NLB; "third division" → **Regionalliga**; "Promotion League" → **Promotionalliga Damen, which is
a women's league**; "only local citizens" → Swiss Trophy rules.

**Open questions the regulations do not settle** (surfaced as notes, never enforced):
the exact Swiss Sport Nationality age cut-off; whether "+3 younger" is per team or per club;
the U14 Damen birth-year rule; whether *Inactive License* on wpmatch always means ineligible.

## The documents

`js/sheetdoc.js` — one layout model, three renderers, **zero dependencies**:

- **.docx**: a stored ZIP (CRC-32) of WordprocessingML, Verdana like the official form. Keeps
  every character exactly.
- **.pdf**: the four standard Helvetica faces, WinAnsiEncoding, Adobe AFM widths measured from
  the system font. Nothing embedded; a sheet is a few kB.
- **HTML**: the on-screen preview and the print fallback.

Verified by parsers not written here: `unzip -t` (every CRC), macOS `textutil` reading the Word
file, PDFKit reading the PDF — and in the test suite, `testlog.js`'s existing ZIP reader
checking the new ZIP writer, and every PDF xref offset asserted (a one-byte shift fails it).

**Honest limit — the PDF character set.** WinAnsi covers every Latin-1 name (Müller, Gonçalves,
Élise) but not **Ł, Đ, ć**. Those are transliterated (Łukaszewicz → Lukaszewicz) and the app
tells the coach which letters changed and to use the Word file for exact spelling. Values too
long for a column shrink to 7 pt, then are cut with an ellipsis — also reported.

## Templates

`js/teamsheet.js`. Two built-in layouts, never edited in place:

- **Swiss Aquatics — official form (2025)**: the current `Formular_Off.Spielaufstellung.doc`
  (saved 18.12.2025) — 14 rows, licence number in the **last** column, *Trainer:in*.
- **Classic layout**: 13 rows, licence number **first** — what older club sheets look like.

A coach duplicates either and changes rows (1–30), header fields (club, league, date,
opponent, venue, match number, cap colour), player columns and their order and width, staff
rows, the label languages and the footer note. A broken saved template still renders:
unknown columns are dropped, the licence column is restored, widths are rescaled.

**Row n is cap n.** The form has no cap-number column because the coach shows the player
passes to the table in cap order (Anhang 35).

**Languages:** the official form exists only in German and French — there is no Italian
version; Ticino clubs use the DE/FR one. Italian and English labels exist so a coach *can*
build such a layout, and the preview warns that it is unofficial.

**No federation logo, on purpose.** Swiss Aquatics offers its logos to member clubs under its
CD manual, with no grant covering software that generates forms. A club that is entitled to
the logo can add it to the Word file after downloading.

## Tests

- `tests/smoke.mjs` [12] documents · [13] eligibility · [14] wpmatch players + templates ·
  [15] the coach flow in the DOM, including the network spy.
- `tests/browser.mjs` [12] a real coach in Firefox downloads real files and checks them on disk.
  **Could not run on 2026-09-15:** after the upgrade to macOS 27.0, Playwright's bundled Firefox
  (build 1532) hangs at launch (content sandbox and software compositor both fail), and the
  installed Chromium (1223) no longer matches Playwright 1.61 (expects 1228). Fixing it means
  downloading a newer browser build (`npx playwright install firefox`). The flow was verified
  manually in the in-app browser instead: roster, sheet, findings in DE/FR/IT/EN, the template
  editor, the player card, downloads captured as real `.docx`/`.pdf` bytes, and no page overflow
  at 375 px.
