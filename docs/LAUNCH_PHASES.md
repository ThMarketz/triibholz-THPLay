# Launch, one phase at a time

Nine phases, in the order the dependencies actually run. Each one says what it is, who has to do
it, and how we know it is finished — a phase is not done because the work happened, it is done when
the check passes.

## Where this really stands today

Verified on 18 September 2026, not recalled:

| | |
|---|---|
| `thplay.ch` | Owned, at GoDaddy, **serving a GoDaddy parking page**. Nameservers `domaincontrol.com`. `www` already 301s to the apex. The parking page asserts HSTS with `includeSubDomains; preload` for two years — so every subdomain must be HTTPS from the moment it exists |
| The app | Runs on the owner's Mac only, `127.0.0.1:8088`, two containers on one Docker network |
| `.env` | **Does not exist.** Only `.env.example`. So `ACCOUNTS`, `RP_ID`, `TRUSTED_PROXY` and `CANONICAL_HOST` are all unset |
| Tunnel | **None for Triibholz.** The `cloudflared` container on this machine belongs to another project |
| Accounts | Off. No passkey has ever been registered, so `RP_ID` is still free to choose |

That last row matters more than it looks: the database refuses to change domain once a real passkey
exists (`server/db.js` migration 8). Right now nothing is committed. After Phase 6 it is.

**So three of the seven "still open" blockers are not work — they are configuration of an edge that
does not exist yet.** `TRUSTED_PROXY`, the 100 MB body cap and the WAF rules all describe a tunnel
nobody has built. They cannot be done, or tested, before Phase 2. That is why they are Phase 3.

---

## Phase 1 — Nobody loses their work

**Needs nobody but me. Start here.**

Every coach using the app today has their work in `localhost:8088`'s storage. A browser keys storage
by origin, so the move to `thplay.ch` strands all of it, permanently and silently — the app will
simply look new.

`💾 Backup all my plays` is honestly named and backs up exactly that: plays. It does **not** cover
rosters (`thplay.teams.v1`), tagged moments and the cut library (`thplay.film.v1`), player test
histories (`thplay.testlog.*`), home training, calendar tokens, or the video blobs in the
`thplay-film` IndexedDB. A coach who presses it before moving will still lose a season.

- One **take everything with me** file: every `thplay.*` key and every IndexedDB store, versioned.
- Import that reads it back on a fresh origin, skipping what is already there rather than duplicating.
- Videos are the hard part — they are blobs and they are large. Either carried in the file or
  explicitly listed as *not* carried, so the coach knows before the move rather than after.
- A test that empties a device and restores it, and fails if a new store is added and not covered.

**Done when** a device can be emptied and brought back from one file, and the test proves it.

Riding along, because it is free and it currently points at a cliff: `.env.example` suggests running
staging on a subdomain. Any subdomain of `thplay.ch` is inside the passkey scope — staging
JavaScript can call `navigator.credentials.get({rpId: 'thplay.ch'})` and the browser will hand it
production credentials. The file should say so instead of suggesting it.

## Phase 2 — A home that is not a laptop

**Needs the owner: a hosting decision, and a DNS change at GoDaddy.**

- Choose where it runs. This is the one real decision and it is about money and who fixes it at
  02:00, not about code.
- Stand the host up, put the app on it, point `thplay.ch` at it, TLS.
- `CANONICAL_HOST=thplay.ch` so every other hostname 301s before the app is served.

**Done when** `https://thplay.ch` serves the app from the host, `www` and any bare address redirect
to it, and `scripts/test-nginx-canonical.sh` passes against that deployment.

## Phase 3 — The edge, told the truth

**Mine, once Phase 2 exists.** All three are silent failures: the app looks healthy and is not.

Nothing here is hurting today, and the roadmap's present tense misleads on that: every route with a
per-address limit is behind `ACCOUNTS`, which is off — `/api/auth/login/options` answers
`404 accounts-off` right now. These are preconditions for Phase 6, not live faults.

- **`TRUSTED_PROXY`** set to the tunnel's real address, so rate limits see visitors instead of one
  shared bucket. The exact numbers, read from `server/auth.js`: `options` and `verify` are **60 a
  minute per address**, and `accountsFromCodes` is **30 an hour per address**. Every passkey
  ceremony begins with an options call, so the one that bites first is 60 a minute — a team all
  joining at the end of a training session is enough — and onboarding then stalls at 30 an hour.
  The value must be a **pinned single address**, never a CIDR. That means declaring the network with
  a fixed subnet and giving the tunnel an `ipv4_address`, rather than trusting DHCP to hand out the
  same one twice — `.env.example` currently suggests `172.19.0.4`, which is right only by accident
  because compose declares no networks at all.

  **And the guard has a hole to close first.** `deploy/nginx-real-ip.sh` refuses `/0`–`/7` and
  non-addresses, but the obvious wrong answer — `172.19.0.0/16`, "just trust the Docker network" —
  passes it, and that range contains the bridge gateway `172.19.0.1` that *every* request through
  `127.0.0.1:8088` arrives from. Set it and anything on the Mac can forge `CF-Connecting-IP`, skip
  the rate limits and write a chosen address into the log, with nothing looking wrong. The comment
  in that file already says "never a range"; the code has to enforce it.

  **One ordering fault to fix while in there.** The 30-an-hour check sits at `server/auth.js:323`,
  *after* `verifyRegistration` has succeeded. The passkey is already on the player's phone when the
  server declines to make the account, so a refused player is left holding a credential for nothing
  and the coach sees "too many requests" at a QR onboarding. Check the limit before the ceremony.
- **The body cap.** Cloudflare refuses bodies above 100 MB on the plans this would run on, while
  `/api/health` advertises 4 GB. A phone's match video is routinely larger. The coach must be told
  the real limit *before* uploading, by the app, not by an edge error page it cannot see.
- **WAF and bot challenge** excluded from the passkey paths, with a test that a real sign-in
  survives the edge — run before a coach is invited, not after one is locked out.

**Done when** a sign-in and an over-cap upload both behave correctly from outside the network.

## Phase 4 — Survive a bad day

**Mine, once there is a host. Needs one decision: where backups go.**

- The database, and the video, clip, job, debrief, announcement and calendar directories.
- Encrypted, off the host, on a schedule.
- **A restore that has actually been performed**, onto a clean host, including the deployment-identity
  lock — a restore onto a different domain must be understood before it is discovered.

**Done when** a restore has been rehearsed and the app came up with its data. Not when a backup exists.

## Phase 5 — Consent and privacy, before a single child's name

**Mine to draft, the owner's to approve.** The roadmap has carried this as *not started* while
calling it blocking, which it is: these are minors' names, licence numbers and video.

- What is collected, where it lives, who can see it, how long it is kept, how it is deleted.
- The privacy notice, in the four languages the app already speaks.
- Consent for video of minors, which is its own question and not covered by a general notice.
- If the support bot in Phase 9 is built, the notice must name Anthropic as a processor. Better to
  write it once, now, than to amend it after clubs have signed.

**Done when** a parent could read it and know what happens to their child's data.

## Phase 6 — Turn it on — and it does not turn back off

**One-way door.** Passkeys bind to `RP_ID`, and the database then refuses any other domain.

- `ACCOUNTS=1`, `RP_ID=thplay.ch`, `APP_ORIGINS=https://thplay.ch`.
- Reissue every calendar feed; client-made tokens are refused once accounts are on, and a parent's
  calendar goes blank without an error. They have to be handed the new links.
- The owner registers the first passkey and signs in from a second device.

**Done when** the owner can sign in on two devices and the rosters follow.

## Phase 7 — The first circle

Three or four coaches at SC Horgen, invite-only, with their real teams — which is only allowed once
Phase 5 is signed off.

**Done when** a coach who is not the owner has run a real match through it: added the match, cut a
situation, tagged it, and put a play in the playbook.

## Phase 8 — Money

- The plan and entitlement model per club — **buildable now, needs no keys**, so it can be pulled
  earlier if you want it in parallel.
- Stripe Checkout, card and TWINT. bexio invoice after payment. 20 CHF per club per month, the
  three-year plan at 600 CHF later.
- Keys live in `.env` and are the owner's. I never hold them and never enter card details.

**Done when** a club can subscribe and receives an invoice.

## Phase 9 — The tail

In no particular order, none of them blocking:

- Staging, on a **different registrable domain** — not a subdomain. `staging.thplay.ch` would let
  staging ask the browser for `rpId: 'thplay.ch'` and be given a real coach's credentials. It also
  needs its own compose override: the current file pins `container_name` and host ports, so a second
  instance cannot start beside the first.
- Device pairing (`docs/ACCOUNTS.md` slice 6, designed and unbuilt).
- Docs for the cut tool and the cut library, which exist and are undocumented.
- Analysing a moment **in place** — the engine already honours `opts.start`/`opts.winSec` and stamps
  match time, so a tagged moment can be scouted without cutting first.
- The 60-second cut cap, which is right for one situation and wrong for a passage.
- 3D underwater rendering.

---

## What this ordering is for

Phase 1 is first because it is the only one where waiting costs something that cannot be recovered:
every day the app is used at the old origin is more work that the move will strand.

Phases 2–4 are before 6 because turning accounts on is irreversible, and doing it before there is a
host, a correct edge and a rehearsed restore means the first real problem arrives with no way back.

Phase 5 is before 7 because the thing that makes the first circle valuable — real teams — is exactly
the thing that needs consent first.
