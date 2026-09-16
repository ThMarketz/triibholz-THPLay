# Training attendance from Spond

> **Parked (16 September 2026).** Exporting attendance needs admin rights in the club's Spond
> group, which we do not have. The importer and the coach's attendance view are built and tested
> against a synthetic file; they stay in the app, unused, until someone with those rights exports a
> real file. Nothing else waits on this.


The club runs training in Spond. A coach asked to see that attendance here, beside the test
results. This is how it works, and why it is a file and not a live connection.

## There is no interface to Spond, and there will not be one soon

Researched September 2026:

- **No public API, no partner programme, no webhooks.** Spond publishes no developer
  documentation and offers no integration to clubs on any plan, including Spond Club.
- **No calendar feed for a group.** What Spond calls calendar synchronisation is its own mobile
  app writing events into the phone's calendar, for events that person is invited to. There is no
  webcal/ICS address a club can subscribe to.
- **The unofficial client is not an option for this app.** A reverse-engineered client
  (`spond.com/api/2.1`) exists. It signs in with the coach's real Spond email and password sent as
  plain JSON — no tokens, no read-only scope, and the community's answer to two-factor
  authentication is to switch it off on the account that holds children's data. Spond has locked
  accounts out after repeated attempts and blocked addresses, and in May 2026 a silent change to
  the login endpoint broke every such integration for days. It also runs against Spond's terms
  (interference with the service, sharing credentials, using other people's personal data for
  something other than running the group), with account closure as the stated remedy.

So: **no credentials of yours are stored anywhere in this app, and nothing here talks to Spond.**

## What does work: Spond's own export

Spond's admin export is an `.xlsx` file with one row per person per event — the person, the event
and its date, and what happened (attended, invited, declined, waiting list, late, valid absence).
That is exactly the detail a coach needs, so the app reads that file.

**The loop:** someone in the club exports attendance from Spond → the coach imports the file under
*My Development → ⬆ Import team logbook* → the squad table shows attendance for the last 90 days
and the charts show it per player, lowest first. It is as current as the last import; the app says
so on screen. Nobody has to remember a password, and there is nothing to break when Spond changes
its app.

The reader accepts English and German column names, `06.09.2026` and `2026-09-06` dates, and the
words Spond uses for attendance in both languages. A row it cannot understand is dropped, never
guessed at: an unknown word counts for nothing. The same session twice in one file counts once.
Late counts as at training, and is reported separately. An excused absence is **not** attendance,
and is shown beside the rate so a coach can see the difference.

Names are matched against the roster, exactly as the test-logbook import already does. Anyone in
the file who is not on the roster is reported in the import message — never invented as a player.

## Two things this needs from the club

1. **A real export file.** The column names above are pinned to Spond's English and German
   exports as documented; they have not yet been checked against an export from your own group.
   One file (names removed, or a small sample) makes the importer exact instead of careful.
2. **A decision, and a person.** The moment attendance is copied here, the club — not Spond —
   is responsible for that copy: a line to parents saying it exists, a retention rule (a season
   plus a year is the obvious one), and someone whose job it is to do the export. Without that
   last part the feature quietly dies, because nothing is automatic.

Worth doing once, in writing: ask Spond for a data-sharing arrangement. They have no partner
programme, but Spond Club already runs with the club as data controller, so it is a coherent ask —
and a written refusal settles the question and shows the club asked.
