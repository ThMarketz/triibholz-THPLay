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
| 1 | Database, migrations, `tx()`, configuration checks, operator CLI, last-admin rule | **done** (02d9042) |
| 2 | Passkey registration and sign-in, sessions, behind `ACCOUNTS=1`; nothing depends on it yet | **done** — server only; the app still signs in the simulated way |
| 3 | Clubs and memberships: invites, join codes, approvals, roles, removal, step-up, UV for staff | **done** — server only |
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

## Passkeys (slice 2)

### Routes

All behind `ACCOUNTS=1`; with accounts off they answer `404 accounts-off`.

| Route | Does |
| --- | --- |
| `POST /api/auth/register/options` `{code, displayName}` | checks the invite without using it; returns creation options and the club and role it is for |
| `POST /api/auth/register/verify` `{challengeId, credential}` | verifies; in one transaction creates the person, claims the invite, stores the passkey, adds the membership, starts a session (and ends any session the browser still carried) |
| `POST /api/auth/login/options` `{}` | request options for a discoverable passkey (no username) |
| `POST /api/auth/login/verify` `{challengeId, credential}` | verifies; starts a new session and ends the one the request came with |
| `POST /api/auth/logout` `{}` | ends the session, clears the cookie |
| `GET /api/auth/me` | the person, their clubs and roles, the session — or `401 signed-out` |

In this slice only an operator's `club-admin` invite creates an account. Every POST needs an
`Origin` from `APP_ORIGINS` (a missing one counts as foreign → `403`), `application/json`
(→ `415`), at most 64 kB (→ `413`), arriving within 10 seconds (→ `408`). No CORS headers at all,
so a CORS preflight gets no permission. The server reads the clock **after** the body has
arrived, so a client holding its body back cannot slip past a challenge's expiry. A client that
hangs up mid-request is not logged as a server error.

Challenges live 5 minutes. The two kinds are built differently on purpose:

- **Registration challenges are rows**, and are **used up before the response is verified** — a
  failed attempt cannot be retried with it. The route fixes the kind, and the invite, name and
  handle are read back from the row. Only someone holding a valid invite can create one.
- **Sign-in challenges are stateless:** 16 random bytes, the expiry, and an HMAC under a server
  secret made on first start (`server_keys`). Anonymous option requests therefore write nothing,
  so nobody can flood the database or fill the open-challenge limit without an invite. A sign-in
  challenge is recorded as used once a correctly signed response arrives, and checked for reuse
  **before** the signature counter is looked at — a replayed response is refused as a replay,
  never mistaken for a cloned passkey. Used ones are kept until they expire.

A challenge of one kind presented to the other route is refused. The invite is claimed only in
the transaction that creates the account: a refused response never uses it up, and an invite
revoked between options and verification leaves no account behind.

Sign-in failures say only `sign-in-failed`. The one exception, `reason:
user-verification-required`, is given only when the signature and user handle were valid — a
staff member's own authenticator skipped verification — so nobody holding just a credential id
can learn whether its owner is staff.

### Limits

| What | Limit |
| --- | --- |
| option requests per client address | 60 / minute |
| verifications per client address | 60 / minute |
| open registration challenges, everyone together | 5000 → `503 busy` |
| failed sign-ins on one passkey | never a lock-out; the 10th within 15 minutes writes one `credential.failures` audit row |

A correct signature is never refused because of earlier failures: a signature cannot be guessed,
and a lock-out would let anyone who learns a credential id lock its owner out.

Counters live in SQLite (`rate_limits`) so a restart does not reset them; housekeeping runs every
minute. The client address is `X-Real-IP` only when the connection comes from a private or
loopback address (nginx), otherwise the socket address. IPv6 addresses count per /64.

**Behind a tunnel, set `TRUSTED_PROXY`.** Through Cloudflare → cloudflared → nginx every visitor
reaches nginx from cloudflared's address, and the per-address limits would become one limit for
the whole world — one noisy client could block every sign-in. With `TRUSTED_PROXY` set to the
tunnel's own address, nginx takes the visitor's address from `CF-Connecting-IP`, and believes
that header only on connections from that address (`deploy/nginx-real-ip.sh`, run at container
start; it refuses to start on anything that is not an address or CIDR, or on ranges like
`0.0.0.0/0`). For that to be safe: put cloudflared on the compose network with a fixed address,
trust exactly that address, and publish `:8088` on `127.0.0.1` only. Never trust a shared address
— on Docker Desktop `192.168.65.1` is every host-routed connection, the LAN included.
`scripts/test-nginx-realip.sh` proves the behaviour with the real nginx image.

A cloned passkey — a signature counter that did not move forward — is marked `suspect`, its
sessions end, it can no longer sign in, and the event is audited; the admins of every club where
the person is approved see the alarm on the club page and in the staff log (slice 3). The trade-off, accepted: if two sign-ins from one *counting* security key
(not a synced passkey, which reports 0) reach the server out of order, the key is treated as
cloned; the operator's `recover` or `club-admin-invite` restores access. Allowing a tolerance
window instead would let a clone that signs in first keep its session while the owner is refused.

### Verification rules

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
5. `authData`: `rpIdHash = sha256(RP_ID)`; UP set; backed up (BS) never without backup
   eligibility (BE); AT set on registration and never on sign-in; the COSE key plus extensions
   (only if ED) end exactly at `authData.length`; the credential id equals `rawId`.
6. Keys: EC2 P-256 with 32-byte x and y; Ed25519; RSA 2048–4096 bits with e = 65537; the COSE
   `alg` matches the key type. CBOR text is decoded byte-exactly (a leading U+FEFF is kept).
7. Assertion signature: `crypto.verify('sha256', authData ‖ sha256(clientDataJSON), key, sig)` —
   `authData` concatenated with the **hash** of the client data, hashed once by `verify`.
8. `userHandle` required and equal to the owner's handle (an empty buffer counts as missing).
   User verification, when required, is judged only after the signature and handle.
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
formats independently of the server) for every negative case, and **15 real captures** from
py_webauthn's test suite (`tests/fixtures/webauthn-real.json`, BSD licence kept with them):
registrations from a synced passkey, a phone over caBLE, a YubiKey on Firefox, an Apple passkey,
three Windows Hello TPMs (RS256), an Android key and FIDO U2F keys; sign-ins with EC2, RSA and
Ed25519 keys, plus a wrong key and a missing user verification. Still to do: the Chromium virtual
authenticator against the real page (needs a Playwright browser download).

## Clubs and membership (slice 3)

Before a line was written, the draft spec was attacked from three sides (an attacker and a careless
insider, authorization, and real club life with volunteer admins and parents of minors) and
merged into 18 decisions. The code was then reviewed again (4 lenses, each finding reproduced or
refuted): 17 confirmed issues, all fixed, below.

### Who is what

- **`player` is the ordinary member level.** Parents of young players hold it too, until guardian
  links arrive (slice 7). There is no separate parent role.
- **Two ways to become coach, trainer or admin**, both an admin's deliberate act:
  1. someone **new to the club** gets a single-use **staff invite** (72 h). Using it creates a
     *pending* request for that role — not the role. An admin approves it with a fresh step-up,
     after comparing the request number, and the person must own a passkey with user verification;
  2. someone **already approved** gets their role changed (`…/members/:m/role`, step-up, same
     passkey rule). The same route lowers a role.
- **Approving grants exactly what was asked for** — a role in the request body is ignored — so a
  join link can only ever produce a player.
- An operator's club-admin code used by a person who already has an account makes them admin at
  once, but only from a verified session with a fresh step-up (a child tapping a link on a parent's
  tablet makes nobody admin).
- **Acting as staff needs a verified session.** A session made without user verification (a
  player, promoted since) gets `403 user-verification-required` until a step-up upgrades it.

### Codes

- **Join links** (for a team's parents group): multi-use, player only, 128-bit, hashed, in
  `#join=`, 1–90 days (30 by default), at most 10 active per club, and each with its own cap on
  open requests (`maxPending`, 60 by default, 1–200). Revoking one can also deny, in the same step,
  every open request that came through it (`denyPending`, step-up) — also after it was revoked
  plainly or has run out.
- **Staff invites**: single-use, role coach/trainer/admin, 72 h, with an admin's label ("Anna – U14
  coach") shown only to admins. The invite list shows *who used* an invite whose request is still
  open — the tripwire when the real invitee says "my link doesn't work".
- A code's short ref (8 hex of its hash) is unique within its club.
- `POST /api/join/peek` (no session) says only the club name, the role, and — when signed in — the
  name of the person joining. Unknown, used, revoked, expired: one identical `400 invalid-code`.

### Requests

- A request gets a **4-digit request number**, unique among the club's open requests. Approve and
  deny must give it: the row changes only if it is still that request (`409 request-changed`
  otherwise — a stale screen, a racing admin, an expiry).
- Asking again after a refusal or removal **reuses the same row** (same member ref) and keeps what
  happened last time; the admin sees "previously denied/removed". One immediate retry is free; after
  a second refusal in a row, one request per 30 days (`409 ask-your-admin`).
- A pending person may **take their request back**. That never counts as a refusal — and never
  erases one: a request made after a refusal puts the refusal back. The same for a request that
  expires (14 days).
- Using the same join link while already pending or approved changes nothing (`already: true`).
- Limits: 5 requests per person per club per day; 200 open requests per club; the link's own
  `maxPending`; 50 open registrations per club (not counting operator codes); 30 accounts made from
  codes per client address per hour (a parents' evening shares one address). `429` comes with
  `Retry-After`.

### Privacy between clubs

- A club sees a person by **`member_ref`**, a random id per club — never the account id — so two
  clubs comparing lists cannot match people.
- Every refusal for something a person may not see is the **same 404 body**, whether the club, the
  person or the right is missing, and whatever the target's state.
- The member list (admins only, verified session) marks requests whose names read the same
  (NFKC, case and accents folded) and names mixing Latin with Cyrillic or Greek letters. Denied and
  removed people are not listed.
- The audit log names people only while they are pending or approved *here*. Anyone else is a
  "former member" with a ref derived from a keyed hash of the ids — so it does not change when a
  row or an account is deleted (a vanishing ref would tell the club about that person's activity
  elsewhere). Details never carry passkey id fragments. Cloned-passkey alarms appear for people
  approved in the club, without detail.
- Coaches do not see the member list before teams exist (slice 5): with no teams it would be every
  family in every age group.

### Losing a role

- **Removal and leaving** are one transaction: the membership ends; the staff invites that person
  issued are revoked and open requests that came through any of them are denied; their step-up no
  longer counts; if they have no approved membership left anywhere, all their sessions end. The
  answer and the club's log say nothing about sessions or other clubs. A removal may also revoke
  the join links they created (`revokeJoinCodes`); otherwise links belong to the club and stay.
- **Losing admin by a role change** runs the same invite cascade.
- The last approved admin can neither leave, be removed, nor be demoted (`409 last-admin`,
  enforced by the database).
- Team staff rows (slice 5) and pair/recover codes (slices 6, 7) join the cascade in those slices.

### Step-up

A fresh assertion with user verification from the same session, valid 5 minutes, needed for:
creating join links and staff invites, bulk deny, approving staff requests, role changes, removal,
staff leaving, renaming the club, and redeeming an operator code into an existing account. The
step-up challenge is bound to the session that asked for it (another session of the same person
cannot finish it), at most 3 open per session. A success also marks that session and that passkey
as verified.

### Housekeeping (every minute, and `admin.js purge`)

Requests unanswered for 14 days expire (audited). Accounts that were **never approved anywhere**,
have nothing pending, and have asked for nothing for **45 days** are deleted with their passkeys
and sessions — the leftovers of a flood, or someone who never came back. An account that was
approved once is never collected here (retention: slice 8).

### Routes

| Route | Who |
| --- | --- |
| `GET /api/clubs/:club` | any approved member; admins also get adminCount, pendingCount, alerts |
| `POST /api/clubs/:club/name` | admin, step-up |
| `GET /api/clubs/:club/members` | admin |
| `POST /api/clubs/:club/members/:m/approve` `{requestNo}` · `…/deny` `{requestNo}` | admin; staff approvals step-up |
| `POST /api/clubs/:club/members/:m/role` `{role}` · `…/remove` `{revokeJoinCodes?}` | admin, step-up |
| `POST /api/clubs/:club/leave` | the member (staff: step-up); pending: takes the request back |
| `GET/POST /api/clubs/:club/join-codes` · `POST …/join-codes/:ref/revoke` `{denyPending?}` | admin; create and bulk deny: step-up |
| `GET/POST /api/clubs/:club/invites` · `POST …/invites/:ref/revoke` | admin; create: step-up |
| `GET /api/clubs/:club/audit?category=staff\|requests&before=` | admin; 100 per page |
| `POST /api/join/peek` `{code}` | anyone |
| `POST /api/join` `{code}` | a signed-in person |
| `POST /api/auth/stepup/options` · `…/verify` | a signed-in person |
| registration | also accepts join links (pending player) and staff invites (pending role) |

Slice 4 still has to: make joining offer "Sign in with passkey" first and create an account only
when the person says they have none, and never submit a join straight from a `#join=` link without
a tap. (The hard-coded `TRII-2026` team code is already gone: each install makes its own code once,
and the invite link carries it in the fragment — see [TEAM_SHEETS.md](TEAM_SHEETS.md).)

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
- `tests/auth.mjs` — the CBOR decoder (RFC 8949 vectors and every refusal), the 15 real
  captures, 3000 mutated real responses (refused or accepted, never a crash), and over real HTTP:
  request rules, account creation, 8 registration refusals that leave the invite intact, a
  challenge race, a revoked invite, sign-in and sign-out, session rotation, 13 sign-in refusals,
  a cloned passkey, failures that never lock out, address limits (IPv6 per /64), secure-mode
  cookies, session sliding, absolute expiry and revocation, and [11] the fixes from the
  adversarial review: stateless sign-in challenges (forged, expired, far-future, bit-flipped),
  a replayed response refused as a replay rather than a clone alarm (also after housekeeping),
  hang-ups not logged, stalled bodies cut off, a body held back past expiry refused. 46 protections
  fault-injected; each fails a check. Two are deliberately layered and fail only with both layers
  removed: ending a cloned passkey's sessions (sessions also refuse any passkey that is not active),
  and the replay check before verification (the used-challenge insert refuses it again).
- `scripts/test-nginx-realip.sh` — the real nginx image: `CF-Connecting-IP` believed only from
  `TRUSTED_PROXY`, ignored without it or from any other address; bad values refuse to start.

The design was reviewed a second time after slice 2 was written: 4 lenses (WebAuthn conformance,
HTTP and sessions, transactions, hostile input), each finding reproduced with a script or refuted.
9 confirmed, all fixed; 5 refuted, with the reasoning kept where it changed a rule.
- `tests/clubs.mjs` — slice 3 over real HTTP (127): join links, staff invites, request numbers,
  approvals and refusals, the 30-day wait, taking a request back, roles, removal and leaving with
  their cascades, floods and every cap, step-up bound to its session, operator codes for existing
  accounts, housekeeping through the real timer and the CLI, the audit (names, stable former-member
  refs, alarms, categories, paging), identical 404s, an admin demoted while their approval is in
  flight, and a denial or expiry committed on another connection. 30 protections fault-injected;
  each fails a check.
- `tests/identity.mjs` — configuration refusals (15 cases), migrations (idempotent, atomic, newer
  database refused), `tx()` (rollback, async refused, nested), users and clubs (random ids,
  handles carry nothing of the id, CHECKs), codes (format, hash-only on disk, forgiving input,
  single use, expiry, revocation, a race between two connections, a failed grant returns the
  code), the last-admin rule (demote, remove, delete, raw SQL, pending admin), sessions and purge,
  the CLI as a real process, and server startup refusing a bad configuration. Also run inside the
  production image (Node 22.23.2). Every protection was fault-injected: removing it fails a check.
