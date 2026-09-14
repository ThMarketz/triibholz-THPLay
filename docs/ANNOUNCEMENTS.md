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

- **Whole team** or **One player** (picked from the approved roster)
- a title and a message
- optionally *"for the match on…"*, chosen from upcoming matches already in the calendar
- optionally **attach plays** from their own library (up to 6), packed with the same
  `SHARE.pack` format the share-link and `.thplay.json` export already use — so the play
  travels inside the announcement and needs nothing else to arrive intact.

Composing is limited to coach / trainer / super-admin (`canEdit()`); everyone can read.

## API

| Method | Route | Notes |
|---|---|---|
| POST | `/api/announcements` | create; 400 on bad scope / missing title-body / player scope without a valid `to` email |
| GET | `/api/announcements?team=…&for=…` | only what that reader may see, newest first, plus an `unread` count |
| GET | `/api/announcements/:id` | the full announcement, body and attached plays included |
| POST | `/api/announcements/:id/read` | `{ by: email }` — idempotent |

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
- **Identity is the app's simulated sign-in**, same as the rest of the prototype. The
  server trusts the email a client sends in `for=`; this is a club tool on a trusted
  network, not a hardened multi-tenant service. Anyone who can reach the backend could
  ask for another player's notes. That is a deliberate, documented limit of the current
  auth model — not a property of this feature specifically.
- **Announcements are kept, not pruned.** There is no delete or retention policy yet; the
  list endpoint caps at the newest 100 per reader.
- Attached plays are copies, not links. Editing the original later does not change what a
  player already imported.
