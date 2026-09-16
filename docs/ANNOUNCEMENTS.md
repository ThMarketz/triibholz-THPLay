# Announcements — a coach's note to one player, or the whole team

Two things a coach asked for, built as one feature:

1. **"What do you need to do at the next game"** — a note addressed to **one player**,
   which only that player ever sees.
2. **"Here's the tactic before the game"** — a message to the **whole team**, optionally
   tied to an upcoming match and carrying one or more **plays from the playbook**, which a
   player can import into their own library with one tap.

## Why this one lives on the server

Almost everything else in this app is per-device: plays, the calendar, the development log
and the home-training streak all live in that browser's own `localStorage`. That works
because those are *your* data on *your* device.

An announcement is the opposite: the coach writes it on their device, and a player has to
read it on **theirs**. So an announcement is stored on the analysis backend — one JSON file
per announcement in `DATA_DIR/announcements/`, exactly the shape the existing team-debriefs
store uses — and scoped by the team's own invite code (`state.user.teamCode`, the same code
the QR/join link carries).

If the backend isn't reachable, the panel says so plainly instead of showing an empty list.

## What a player sees

A 🔔 bell in the top bar with an unread count. Opening it lists everything addressed to
them — team broadcasts and their own personal notes, newest first, unread ones highlighted.
Opening one marks it read (per person, server-side, so it stays read on their other devices
too) and shows the full message, the match it belongs to if any, and an **import** button
per attached play.

## What a coach sees

The same bell, plus **＋ New**:

- **Whole team** or **One player** — with accounts on the list is the club's approved members,
  fetched from the server as `{ memberRef, name }` (the coach is never offered themselves);
  without accounts it is the local approved roster, by e-mail
- a title and a message
- optionally *"for the match on…"*, chosen from upcoming matches already in the calendar
- optionally **attach plays** from their own library (up to 6), packed with the same
  `SHARE.pack` format the share-link and `.thplay.json` export already use — so the play
  travels inside the announcement and needs nothing else to arrive intact.

Composing is limited to coach / trainer / super-admin (`canEdit()`); everyone can read.

## A moment from the Film Room

A coach watching a video in the Film Room can send one tagged moment out of it — to the whole
club, or to one player — without leaving the page. On each tagged moment there is a **✂ Send**
button (staff only, and only for a video the app has the file for):

1. the video is uploaded once and remembered for the rest of the session, so sending a second
   moment from the same match cuts straight away;
2. `POST /api/clip` cuts the seconds of that moment into a small mp4 (the same cut the game plan
   and the debrief already use);
3. the cut travels as `clip` on an ordinary announcement, carrying **what was already marked on
   that moment** — the tactic recognised, the zone, the outcome — plus whatever the coach types.

The player opens the bell and the clip plays inline, with those marks under it. Nothing is
downloaded and nothing is shared outside the club.

**Who may watch the cut.** A clip belongs to whoever cut it and to the club's staff. A player may
watch one only because something they are allowed to read already shows it to them: a debrief of
their club, or a note sent to them or to the whole club (`clipShownTo()` in `server/index.js`,
used by `requireAssetRead()`). A club-mate the note was not addressed to gets the same `404` a
stranger does, and a club cannot attach a clip cut from another club's video — the server checks
the clip's `assets` row against the poster's club before the note is stored.

`GET /api/clubs/:club/addressees` is what fills the **To** list: approved members of that club as
`{ memberRef, name, role }`, staff only, from a user-verified session — no request numbers, no
history. It is an interim: slice 5 of `ACCOUNTS.md` narrows it to the teams that coach actually
has.

## API

| Method | Route | Notes |
|---|---|---|
| POST | `/api/announcements` | create; 400 on bad scope / missing title-body / player scope without a valid `to` email |
| GET | `/api/announcements?team=…&for=…` | only what that reader may see, newest first, plus an `unread` count |
| GET | `/api/announcements/:id` | the full announcement, body and attached plays included |
| POST | `/api/announcements/:id/read` | `{ by: email }` — idempotent; with accounts on the reader comes from the session and the body is ignored |
| GET | `/api/clubs/:club/addressees` | who a coach may write to: `{ memberRef, name, role }`, staff only |

A `clip` on an announcement is `{ url, title, start, end, marks[] }`. `ANNOUNCE.sanitize()`
refuses anything whose `url` is not `/api/clips/<id>.mp4` (`bad-clip` — an outside URL can never
be smuggled into a note and played inside the app), keeps at most 8 marks of 80 characters, and
`summarize()` reports `hasClip` so the bell can show which notes carry a moment to watch.

Visibility is decided in one place, `ANNOUNCE.visibleTo()` in `js/announce.js`, a pure
module the server `require`s directly (like `calendar.js` and `privacy.js` already do) so
the client and the server can never drift on who is allowed to see what:

```js
a.team === reader.team && (a.scope === 'team' || a.to === reader.email)
```

## Honest limits

- **No push notification.** The badge updates when the app is opened and when the bell
  panel is opened. There is no OS-level push anywhere in this app, and adding it would
  need infrastructure (and, on iOS, an installed PWA or a native wrapper) that doesn't
  exist yet.
- **Identity depends on whether accounts are on.** With `ACCOUNTS=1` (slice 4 of
  `docs/ACCOUNTS.md`) the club, the author and the reader all come from the session: `team=`
  and `for=` are ignored, `from` is stamped with the signed-in person's name, a note may only
  be addressed to an approved member of the poster's own club, and another club sees nothing.
  With accounts off the server still trusts the email a client sends in `for=` — a club tool
  on a trusted network, not a hardened service. That is the pre-accounts mode, kept so a
  development build works with no database at all.
- **Announcements are kept, not pruned.** There is no delete or retention policy yet; the
  list endpoint caps at the newest 100 per reader.
- Attached plays are copies, not links. Editing the original later does not change what a
  player already imported.
