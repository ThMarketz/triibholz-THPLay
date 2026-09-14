# Matches & results — wpmatch.ch

The club's real fixtures, results, box scores and league table, inside Season.

wpmatch.ch is the **official Swiss Aquatics water polo match centre**. Pick your team
once and the app shows upcoming fixtures, recent results with the score read from your
side, a full box score for any played match, and the league table with your row
highlighted — plus one button to push the fixtures into the season calendar that already
exports `.ics` and publishes a subscribable feed.

## Why there is no backend and no API key

wpmatch.ch is WordPress + the SportsPress plugin, and that plugin's REST API is public,
unauthenticated, and returns permissive CORS headers. The browser can call it directly.
No key, no account, no approval, no proxy.

It is also **undocumented and unsupported** — a plugin default, not an open-data
programme. Nothing obliges it to keep working. That shapes the whole design: every
response is normalised in `js/wpmatch.js`, nothing raw reaches a renderer, and every
fetch is cached so an outage degrades to *stale but stamped* rather than blank or wrong.

There is no terms-of-use or robots restriction on the site (robots.txt disallows only
`/wp-admin/`), but there is also no written permission. Send Swiss Aquatics a courtesy
note before relying on it, and keep the attribution line the UI already shows.

## Traps, and what we do about them

Each of these was verified against the live API. They are listed because every one of
them fails *silently* — the screen looks fine and the data is wrong.

| Trap | What actually happens | Defence |
|---|---|---|
| `?team=` / `?teams=` / `?sp_team=` | Silently ignored — you get the full 2547-event list, i.e. **another club's matches**, looking perfectly plausible | Filter on `teams[]` client-side; only `search`/`leagues`/`seasons`/`include`/`slug`/`_fields` are real |
| `teams/{id}.events` | Looks exactly like a per-team fixture index. It is a global 2000-id list, **byte-identical for every team** | Never used |
| `main_results` | They are **strings**, so `"7" > "17"` is true — the wrong winner in **43% of played matches** | `Number()` both sides in `resultFor()` |
| `performance` field | Makes the response start with a literal `Array`, **once per returned item**, while claiming `application/json` | `/^(?:Array)+/` stripped on every parse; `_fields` without it also cuts a page from ~1.1 MB to ~29 KB |
| `date_gmt` | Has no `Z`, so it parses as *local* time — every match 1–2 h out in a subscribed calendar | `date_gmt + 'Z'`; `date` is Zurich wall-clock, display only |
| `"0"` keys | `results`, `performance` and table `data` each carry a `"0"` **label row** | Skipped everywhere; player labels are read from `performance["0"]`, the only one that is actually populated |
| Fourth quarter | Spelled `fourrdquarter` in their schema | Matched verbatim |
| `day` | Not a two-value enum — some events have `''` | Treated as `unknown`, never assumed played |
| 0–0 `ENDED` | 72 of them; unrecorded matches, not draws | Score suppressed, excluded from results |
| Team id `-1` | A "to be decided" placeholder | Surfaced as such, never rendered as a team |
| Placeholder dates | Next season's fixtures sit at 2027-12-31T23:00 with no venue | Flagged **date TBC**, excluded from calendar import (an all-day marker if imported anyway, never a 23:00 alarm) |
| Stale duplicate tables | League+season does *not* identify one table — a real ranking sits beside an "NLA TEST" with different numbers | `pickTable()` drops `/test/i` and requires our team in the rows |
| Stat values | Exclusion fouls arrive as ``1 (13 <b>1. 0:16</b>')`` — with markup inside | `statNumber()` for the count, `statDetail()` (tags stripped) as a tooltip |
| Entity-encoded titles | `SC Horgen &#8211; Lugano` | Decoded with a regex table — never via `innerHTML`, which would materialise third-party markup — then escaped at render as usual |

## Caching

| Data | Key | TTL | Why |
|---|---|---|---|
| Fixtures | `thplay.wpmatch.cache.fx.<teamId>` | 6 h | Source rebuilds daily |
| League table | `…cache.tbl.<teamId>` | 6 h | Same |
| Box score | `…cache.box.<gameId>` | 30 d | A played match never changes |
| Venue names | `…cache.venues` | 7 d | A taxonomy that barely moves |

The service worker deliberately ignores cross-origin requests, so this cache **is** the
offline story. The view always paints from cache first and refreshes behind it, stamping
how old the data is.

The origin is bare nginx — no cache headers, no CDN, ~1 s per request, and it slows under
rapid sequential calls. Fetch once, cache, refresh in the background; never crawl on every
open.

## Honest limits

- **One team at a time.** A club with 15 team records (Horgen has exactly that) picks one;
  switching is a button, not a multi-team dashboard.
- **Fixtures are found by searching the club name** and then filtering on team id. Verified
  at 49/49 recall with zero false positives, but it is a text search — a club that renames
  itself mid-season needs the team picked again.
- **No player-level season stats yet.** SportsPress exposes them (`/lists` is team-scoped),
  and that is the obvious next step; this pass covers fixtures, results, box scores and
  the table.
- **Nothing is written back.** This is read-only, and the app is not affiliated with
  wpmatch.ch or Swiss Aquatics.
