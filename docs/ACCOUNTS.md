# Accounts, devices and clubs

Real sign-in replaces the simulated one: the same account on any number of devices, and a player
on several teams under different coaches — in one club (U12 and U14) or in different clubs
(double licences). Rosters, sheets and templates move to the server once, and only once,
authorization exists for every route.

- **Sign-in:** passkeys (WebAuthn), no passwords, no email. A second device is added by scanning
  a QR code on a device that is already signed in.
- **Clubs:** a person is one account; memberships and roles are per club. A club never learns
  which other clubs its players play for.

This design went through a five-lens adversarial review (WebAuthn, web security, authorization,
account lifecycle, operations) before any code was written. What the review changed is part of
the rules below, not a footnote.

## Build order and status

| Slice | What | Status |
| --- | --- | --- |
| 0 | API on the app's own origin (`/api` via nginx), service worker never caches `/api`, `no-store` everywhere, port 4200 loopback-only | **done** (9d96100) |
| 1 | Database, migrations, `tx()`, configuration checks, operator CLI, last-admin rule | **done** |
| 2 | Passkey registration and sign-in, sessions, behind `ACCOUNTS=1`; nothing depends on it yet | next |
| 3 | Clubs and memberships: invites, join codes, approvals, roles, removal, step-up, UV for staff | |
| 4 | The switch, in one release: the app signs in for real; every existing endpoint authorized | |
| 5 | Teams, rosters, sheets, templates on the server; read-only offline copy for staff | |
| 6 | Devices: QR pairing with approval on the old device, devices page, revocation | |
| 7 | Recovery with a hold period; player and guardian links | |
| 8 | Release hardening: chunked uploads through the tunnel, FADP package, backups, staging rehearsal | |

Until slice 4 ships, the backend stays exactly as unauthenticated as before, and **nothing with
personal data moves onto it**: rosters and sheets stay on the coach's device.

## Topology (slice 0)

- The app calls `/api/…` on its own origin. nginx proxies it to the analysis container
  (`location ^~ /api/`, streaming both ways, 4 GB body, 300 s timeouts). The upstream is resolved
  per request, so the app still loads when the backend is down.
- There is no setting for another backend host. A URL stored by an older build turns "Analyse on
  the club server" on, but its host is never used (`js/api.js`).
- The service worker never touches `/api/` and caches only complete `200` same-origin answers.
- Every API answer is `Cache-Control: no-store`.
- nginx sets `X-Real-IP` and `X-Forwarded-For` to the connecting peer, overwriting whatever the
  client sent (verified with a header-echo stand-in: `6.6.6.6` sent, peer address received).
- Port 4200 is bound to `127.0.0.1`: from the network only `:8088` answers.

## Configuration (slice 1)

Accounts are off unless `ACCOUNTS=1`. When on, the server **refuses to start** on any of these,
listing all of them at once:

| Setting | Rule |
| --- | --- |
| `RP_ID` | required; a lowercase host name; not an IP address; not a bare TLD |
| `APP_ORIGINS` | required; comma-separated exact origins (no path); each on `RP_ID` or a subdomain of it — `notexample.ch` is not under `example.ch` |
| http | only `localhost`, only with `DEV=1` and `RP_ID=localhost` |
| mixing | http and https origins together are refused |
| `DEV=1` | refused with any `RP_ID` other than `localhost` |

The cookie mode comes from `APP_ORIGINS`, **never from request headers**: behind Cloudflare →
cloudflared → nginx every request arrives as plain http. Any https origin → `__Host-thp`
(`Secure; HttpOnly; SameSite=Lax; Path=/`) and a plain `thp` cookie is ignored entirely.

Local development:

```
ACCOUNTS=1 DEV=1 RP_ID=localhost APP_ORIGINS=http://localhost:8088
```

**Passkeys are bound to `RP_ID` forever.** Changing the domain later means every person
re-registers. Choose it once (see owner decisions).

## Storage (slice 1)

One SQLite file, `DATA_DIR/triibholz.db` (`node:sqlite`, WAL, foreign keys on), in the existing
`analysis-data` volume. Migrations are append-only, each in its own transaction; a database
written by a newer build is refused.

| Table | Holds |
| --- | --- |
| `users` | id, display name, `webauthn_user_handle` (32 random bytes, one per person, reused for every passkey) |
| `credentials` | passkey id, public key (JWK), algorithm (-7 ES256, -8 Ed25519, -257 RS256), sign count, UV/backup flags, status `active / pending / suspect / revoked` |
| `sessions` | SHA-256 of the cookie token (the token is never stored), UV, step-up time, sliding and absolute expiry |
| `clubs`, `club_members` | per-club role `admin / coach / trainer / player` and status `pending / approved / denied / removed` |
| `challenges` | kind fixed by the endpoint; user, club and code come from this row, never the request body |
| `link_codes` | hash of single-use codes: `club-admin`, `staff-invite`, `pair`, `recover`, `player-link` |
| `audit` | ids and actions — never names, never codes |

Rules enforced in the database itself, so no code path can skip them:

- **A club keeps an approved admin.** Triggers refuse demoting, removing or deleting the last one,
  including by deleting the account and including raw SQL. A pending admin does not count.
- Roles, statuses, credential algorithms and the 32-byte handle are `CHECK` constraints.

Writes that touch more than one row go through `tx(db, fn)`. `fn` must be synchronous — an
`await` inside a transaction would let another request's writes interleave — and `tx` refuses a
function that returns a promise, rolling back what it had already written.

### Codes

128 random bits, shown as 26 Crockford base32 characters in groups of five
(`7K3MX-…`). Typing is forgiving: lower case, spaces and dashes are ignored, `O` reads as `0`, `I`
and `L` as `1`. Only a hash is stored. A code is claimed with a conditional
`UPDATE … WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > now`: of two claims racing
for one code, exactly one wins. The claim happens inside the transaction that grants what the
code is for, so if granting fails the code is not used up. A wrong code simply matches nothing,
so there is no attempts counter.

| Kind | Lives | Issued by |
| --- | --- | --- |
| `club-admin` | 24 h | operator CLI only |
| `staff-invite` | 72 h | a club admin, per person (slice 3) |
| `pair` | 10 min | the person, on a signed-in device, with step-up (slice 6) |
| `recover` | 24 h | operator, or a club admin within strict limits (slice 7) |
| `player-link` | 10 min | shown on the player's or guardian's device, entered by the coach in person (slice 7) |

Codes travel in the URL **fragment** (`#invite=…`), never a `?query`, so they stay out of server,
proxy and tunnel logs.

## The operator CLI (slice 1)

There is no web bootstrap. The only way to create a club and give it its first admin is a person
who can already run commands on the server:

```bash
docker exec triibholz-analysis node admin.js create-club "SC Example"
docker exec triibholz-analysis node admin.js club-admin-invite c_…
docker exec triibholz-analysis node admin.js clubs
docker exec triibholz-analysis node admin.js members c_…
docker exec triibholz-analysis node admin.js recover u_…
docker exec triibholz-analysis node admin.js end-sessions u_…
docker exec triibholz-analysis node admin.js revoke-codes u_…|c_…
docker exec triibholz-analysis node admin.js purge
```

Every command writes an `operator` audit row. A code is printed once; lost means issue a new one.
`clubs` flags clubs with no admin yet and clubs with only one.

## Passkeys (slice 2) — verification rules

Registration options: `rp {id: RP_ID}`, `user.id` = the person's 32-byte handle,
`residentKey: required`, `userVerification: preferred`, `attestation: none`, algorithms -7, -8,
-257, `excludeCredentials` = the person's existing passkeys.

Verification, in order — every step a rejection on failure:

1. Challenge looked up by id **and** kind (the endpoint fixes the kind); consumed by a conditional
   `UPDATE` (`changes === 1`), not expired.
2. `clientDataJSON`: `type` exactly `webauthn.create` / `webauthn.get`; `challenge` equal; `origin`
   exactly one of `APP_ORIGINS`; `crossOrigin` not true.
3. CBOR: `decodeOne(buf, offset) → {value, end}`; definite lengths only; no tags, floats,
   duplicate map keys; lengths checked against the buffer before slicing; 64 kB cap.
4. Any attestation `fmt` is accepted; `attStmt` is never verified and never stored. AAGUID and the
   backup flags are self-reported: display only.
5. `authData`: `rpIdHash = sha256(RP_ID)`; UP set; AT set on registration; the COSE key plus
   extensions (only if ED) end exactly at `authData.length`; the credential id equals `rawId`.
6. Keys: EC2 P-256 with 32-byte x and y; Ed25519; RSA ≥ 2048 bits with e = 65537; the COSE `alg`
   equals the negotiated one.
7. Assertion signature: `crypto.verify('sha256', authData ‖ sha256(clientDataJSON), key, sig)` —
   `authData` concatenated with the **hash** of the client data, hashed once by `verify`.
8. `userHandle` required and equal to the owner's handle (an empty buffer counts as missing).
9. Sign count: updated with `WHERE sign_count < new`; a regression (when counters are in use)
   marks the credential suspect, ends its sessions and alerts the club admins. Synced passkeys
   report 0 and are accepted.

**User verification.** Options say `preferred`; the session records whether UV happened.
Staff (admin, coach, trainer) need a UV session for anything touching rosters, sheets, members,
codes or recovery, and cannot enrol a passkey without UV. Sensitive actions — creating a pairing
code, approving a device, revoking a passkey, signing out everywhere, changing roles, issuing
recovery, exporting a roster, deleting an account — need a fresh UV assertion from the last
5 minutes (`stepup` challenge).

**Sessions.** Staff 14 days sliding, players 30 days sliding, 180 days absolute (owner decision).
Rotated on sign-in; sign-out deletes the row.

Tests: the Node software authenticator (`tests/softauthn.mjs`, written from the WebAuthn data
formats independently of the server, checked against RFC 8949 test vectors) for every negative
case; the Chromium virtual authenticator against the real page; frozen real-device fixtures
(Safari/iCloud, Chrome/Android, Windows Hello, Firefox, a security key).

## Clubs and membership (slice 3)

- **Club join code** (QR for a team's parents group): hashed, rotatable, expiring, in `#join=`,
  and it can only ever request the **player** role — the server ignores any higher role asked for.
- **Coach, trainer, admin** only through a single-use per-person invite from an admin (72 h).
- Pending requests show a request number the admin checks in person; they expire after 14 days,
  are capped per club, and a pending member sees nothing of the club.
- Joining first offers "Sign in with passkey" and adds the membership to an existing account; a
  new account is created only when the person says they have none (no duplicate accounts).
- **One authorization path:** every handler loads the resource and checks it through one helper
  that joins an **approved** membership in the resource's club. Refusals are `404`. Team staff
  rows are valid only for approved members of that club.
- **Removal is one transaction:** team staff rows deleted, uploads/clips/templates/announcements
  reassigned to the club, the person's open codes revoked, sessions ended if no approved
  membership remains.
- The hard-coded join code fallback `TRII-2026` is removed.

## The switch (slice 4)

One release, because half-authorized is worse than either state:

- The app signs in with passkeys and gates only on `/api/auth/me`; the simulated sign-in, its
  local user list and demo personas on production are gone.
- Every route needs a session except `/api/health`, the sign-in ceremonies and the calendar feed.
  `team=` and `for=` are no longer read from the request — they come from the session.
- Every non-GET request needs an `Origin` in `APP_ORIGINS`; JSON routes need
  `content-type: application/json`; video routes accept only `video/*` or octet-stream. CORS
  headers are removed.
- New resources get 128-bit random ids (today's announcement, debrief and job ids are clock-based
  and enumerable). Announcements and debriefs take team and author from the session.
- A clip is readable by its owner, the club's admins, and whoever may read a debrief that
  references it (stored server-side).
- **Calendar feeds** get server-issued, revocable tokens created by the team's staff; old
  client-made tokens are refused. No venue for youth training unless the club turns it on.
- Files already on the volume (announcements, debriefs, videos, clips, calendars) have no owner:
  they are quarantined as operator-only, with CLI commands to assign them to a club or purge them.
- Old installed apps get `426 Update the app`.
- Demo: a `DEMO=1` sandbox club with fictional users for tests; local-only on production.

## Server-side teams (slice 5)

- Player records are **per club**: `club_players(club_id, licence, …, UNIQUE(club_id, licence))`.
  Adding a licence never reveals whether another club has that player, and one club's name
  correction never changes another club's sheet.
- The two-teams-same-category check runs within the club only. Staff who are not on both teams are
  told "conflicts with another team list in this club" without the team's name.
- Uploading a device's local teams: approved staff only, into a club they pick, idempotent (the
  local ids are the key — a retried upload creates nothing new), confirmed by a server manifest
  before the device touches its copy. Never offered in a session that started from a pairing,
  join or recovery link.
- A read-only offline copy of the teams a coach is staff of stays on the device for pools without
  signal (team sheets must work offline), shows when it was last synced, and is wiped on sign-out
  and never kept in shared-device mode.

## Devices (slice 6)

Pairing is two steps, because a code alone is a bearer secret that mints a permanent passkey:

1. The new device claims the code and receives only a pending request. It shows "You are adding
   this device to *name*'s account" and needs a tap before any passkey prompt.
2. The signed-in device shows the new device, the time and a short match number, and approves with
   a fresh UV assertion. Only then does the new device get registration options.

Also: a devices page (passkeys and sessions, labelled), revocation and sign-out-everywhere behind
step-up, "end all sessions" for a member by an admin, detection of in-app browsers (WhatsApp,
Instagram) with "Open in Safari/Chrome", and the iOS note that a QR opens Safari, not the
installed app.

## Recovery and player links (slice 7)

- A club admin may start recovery only when every approved membership of that person is in the
  admin's club and the person is not an admin there; otherwise the operator (or an admin of each
  club involved). Never for pending, denied or removed members. Recovering an admin needs a second
  admin or the operator. Issuing needs step-up.
- Recovery never deletes other passkeys. The new passkey is pending for a hold period, during
  which the person's existing sessions show "Recovery started by *admin* — cancel". When the hold
  ends, the old passkeys are revoked and every session ends. The person sees the audit entry.
- **Player and guardian links** are per club: `club_player_links(club_player_id, user_id,
  relation self | guardian)`. Approval uses a one-time code shown on the player's or guardian's
  device and entered by the coach in person — knowing a licence number (public on wpmatch and on
  printed sheets) is never enough. A guardian may have several children and a child several
  guardians; a guardian acts inside their own session and the audit records both.

## Release hardening (slice 8)

- Cloudflare rejects request bodies over 100 MB and cuts responses after 100 s: resumable chunked
  uploads (~50 MB authenticated chunks) and asynchronous analysis only, with `/api/health`
  reporting the real limits.
- FADP: privacy notice in DE/FR/IT/EN naming Cloudflare as a disclosure abroad; processing
  agreement (club = controller, operator = processor); record of processing; risk assessment for
  minors' data and match videos; guardian consent under the age threshold; per-club export and
  erasure; retention purge jobs; account deletion is a hard delete.
- Pinned image (`node:22.23.2-alpine` or digest) with the test suites run inside it; backups with
  `VACUUM INTO` copied off the volume; a runbook covering the hostname, Access and the CLI
  break-glass; the two-device pairing flow rehearsed on a staging hostname with its own `RP_ID`.
  Sign-in over a LAN IP address is unsupported (passkeys need a domain).

## Owner decisions

None blocks local development. All are needed before real people sign in.

| Decision | Recommendation |
| --- | --- |
| The permanent passkey domain (`RP_ID`) | a dedicated domain (~CHF 15/year), not a subdomain of an unrelated site |
| Cloudflare Access in front of the app | no Access on the app hostname — passkeys are the sign-in |
| Who creates clubs | the operator CLI only |
| Age below which a player has only a guardian account | under 14 |
| Recovery hold period | 24 h for staff |
| Session lengths | staff 14 days with UV; players 30 days sliding, 180 days absolute |
| Rosters on devices for offline use | read-only copy for staff, wiped on sign-out |
| Retention | videos 12 months after the season; roster rows 24 months after a player leaves; audit 24 months |
| Demo personas on production | local-only |

## Tests

- `tests/smoke.mjs` [16] — the real `sw.js` in a VM: `/api/` never intercepted, only `200` cached.
- `tests/server.mjs` — `no-store` on JSON, errors, calendar, full and ranged clips.
- `tests/identity.mjs` — configuration refusals (15 cases), migrations (idempotent, atomic, newer
  database refused), `tx()` (rollback, async refused, nested), users and clubs (random ids,
  handles carry nothing of the id, CHECKs), codes (format, hash-only on disk, forgiving input,
  single use, expiry, revocation, a race between two connections, a failed grant returns the
  code), the last-admin rule (demote, remove, delete, raw SQL, pending admin), sessions and purge,
  the CLI as a real process, and server startup refusing a bad configuration. Also run inside the
  production image (Node 22.23.2). Every protection was fault-injected: removing it fails a check.
