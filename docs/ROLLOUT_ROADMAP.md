# Rollout Roadmap — one club first, then Switzerland

Goal: prove Triibholz in **one club (SC Horgen pilot)**, then scale to clubs across
**Switzerland**. Phase 0–6 below is the operational launch — what to do, in what order, to get
real coaches and parents signed in. Phase B is the strategic step after that.

> **This document was written before accounts existed and has been corrected.** Its original
> Phase A called for "Apple + Google OAuth". That is not what was built: sign-in is **passkeys**
> (WebAuthn), with no e-mail, no password and no third-party identity provider. Anything you read
> elsewhere about OAuth in this project is out of date.

---

## Where the code actually is

| Was blocking | Now |
|---|---|
| Real sign-in | **Done** — passkeys, sessions, step-up, club memberships (`docs/ACCOUNTS.md` slices 0–4) |
| Authorization on every endpoint | **Done** — one switch, `ACCOUNTS=1`; everything answers the same 404 to anyone who may not see it |
| Server-side persistence per club | **Done for teams and rosters** (slice 5). Sheets, templates and availability stay on the device on purpose |
| Hardening | **Partly** — same-origin API, no CORS, `no-store`, Origin + content-type rules, rate limits. Slice 8 has the rest |
| Public address | **Still a laptop.** See Phase 1 |
| Consent & privacy (FADP) | **Not started.** Blocking before real rosters — see Phase 4 |

Still to build: device pairing (slice 6), recovery and guardian links (slice 7), release
hardening (slice 8). RSVP, notifications and the parent channel remain the highest-value
features after launch.

---

## Phase 0 — the domain. Do this first, and do not rush it

**Recommended: `triibholz.ch`** — with `treibholz.ch` bought alongside it and redirected, if it is
free. See "Choosing the domain" at the foot of this document for the reasoning and the
alternatives.

A passkey is bound permanently to its domain (`RP_ID`). **Change the domain later and every coach
and every parent has to register again.** This is the one decision in the whole launch that cannot
be undone cheaply, so it comes before hosting, before accounts, before anything.

- **A dedicated domain**, not a subdomain of an unrelated site. A passkey's scope is the
  registrable domain, so `app.some-other-site.ch` ties the club's sign-in to whatever else lives
  there. ~CHF 15/year.
- **No Cloudflare Access in front of the app hostname.** Passkeys *are* the sign-in. Access would
  mean two logins, and it would break invite and join links arriving from a phone.
- **Not a LAN IP.** Passkeys need a real domain; sign-in over `192.168.x.x` is unsupported.
- Settle the rest of the **Owner decisions** table in `docs/ACCOUNTS.md` at the same time — age
  threshold, session lengths, retention. They all have recommendations already.

Set up a **staging hostname with its own `RP_ID`** too. Rehearsing pairing and recovery against
production would mint real passkeys you then have to clean up.

## Phase 1 — hosting that is not your laptop

Today the site is a `cloudflared` container on a Mac: it is down whenever Docker is off, which is
documented and fine for a demo, not for a season.

- A small VM, the image pinned by digest, the test suites run inside it.
- Backups off the volume (`VACUUM INTO`), restore rehearsed at least once.
- A runbook: the hostname, DNS, certificates, and the operator CLI break-glass.

## Phase 2 — turn accounts on

`ACCOUNTS=1` is a single switch, and everything behind it is already authorized. It is deliberately
all-or-nothing: a half-authorized server is worse than either state.

**Invite-only is not something to build — it is what the app already is.** There is no public
sign-up anywhere in it. The operator CLI creates the club and its first admin; every other account
comes from a per-person invite or a team join code, and codes travel after the `#` so they stay out
of server, proxy and tunnel logs.

```
node admin.js create-club "SC Horgen"      # prints the club id
node admin.js club-admin-invite <club-id>  # the first admin, single use, 24 h
node admin.js legacy                       # what predates accounts — then adopt <club-id> or forget --yes
node admin.js demo                         # a sandbox club to look at; demo-remove when done
```

## Phase 3 — the first circle: three or four coaches

Per-person staff invites, approved by their four-digit request number read out loud.

Rehearse the things that actually happen, not a happy path: one coach on **two devices**; a coach
who **loses** a device; print a real team sheet; scout a real opponent; sync a roster and take a
player back off it. This is also where you find out whether the German wording works — the app is
in four languages and only one of them has been read by a Swiss coach.

## Phase 4 — the club

Join links per team, approvals by request number, roles assigned by the club admin.

**The FADP paperwork is blocking before real rosters go up**, not after:

- privacy notice in DE/FR/IT/EN, naming Cloudflare as a disclosure abroad;
- a processing agreement — the club is the controller, the operator is the processor;
- a record of processing and a risk assessment for minors' data and match video;
- guardian consent below the age threshold;
- per-club export and erasure, and the retention purge.

Slice 6 (device pairing) matters here: a coach with a phone *and* an iPad is the ordinary case.

## Phase 5 — "install" it: the web link that behaves like an app

No App Store, no developer account, no review. The app is already a PWA — `display: standalone`,
maskable icons, Apple meta tags — so this works today:

| Device | How |
|---|---|
| iPhone / iPad | Safari → Share → **Add to Home Screen** |
| Mac | Safari 17+ (Sonoma) → File → **Add to Dock** |
| Android | Chrome → **Install app** |

Four things to tell people, because each one causes a support call:

1. **On iOS the installed app has its own storage, separate from Safari.** Sign in *inside* the
   installed app. Signing in in Safari does not carry over, and neither do a coach's teams.
2. **A QR code scanned with the iPhone camera opens Safari, not the installed app.** Invite links
   land in Safari.
3. **WhatsApp's and Instagram's in-app browsers can fail passkey registration.** Send invites where
   they will open in a real browser, or say "open this in Safari".
4. **There are no push notifications.** iOS allows web push only for an installed PWA, and the app
   has none yet — the bell updates when the app is opened. This is the one real gap versus a native
   app, and the reason notifications sit high on the post-launch list.

## Phase 6 — native apps, only if something forces it

Realistically only push notifications would force it, and web push for an installed PWA closes most
of that. A native app costs an Apple Developer membership (~USD 99/year), review, and a second
thing to keep working. **Not planned.**

---

## Phase B — Switzerland: "many clubs, one platform"
*Objective: onboard any Swiss club in under an hour, safely isolated, learning together.*

1. **Multi‑club tenancy + club admin** — self‑serve club creation, roles per club, isolation enforced in the API and storage, per‑club branding.
2. **Federation layer (Swiss Aquatics)** — league/age‑group structures, official calendars imported (the rule‑book updater already pulls from Swiss Aquatics), referee/rules quiz **certification** mode.
3. **Shared drill & play library with confidentiality** — clubs publish plays as 🌐 public to a national library; 👥/🔒 stay inside the club. The visibility model shipped in v1.22 is the foundation.
4. **Cross‑club anonymous insights** — the k‑anonymous aggregator (`/api/insights`) pooled nationally: "what wins in 6v5 at U15 level" without exposing any club's tactics. Raise k for national pools.
5. **Billing & plans** — free player tier, paid club tier; invoicing in CHF.
6. **Ops** — monitoring/alerting, uptime SLA, audit log, GDPR/FADP processes at scale, status page.
7. **Cross‑browser + accessibility** — Chrome/Safari/iOS passes in the gate, a11y audit (contrast, screen readers).
8. **The ML flywheel** — once footage + consent exist at scale: train the water‑polo detector (see `DATASET_AND_TRAINING.md`), then Tier 3 Phases 2–4 go live on real data.

---

## Also worth adding (any phase)
- **Injury / load monitoring** — derive weekly load (RPE × minutes) from the season plan; flag spikes.
- **Video library** per club with tags, linked to plays (Film Room → Playbook already exists).
- **Parent portal** — read‑only calendar + RSVP + messages, no tactics.
- **Offline first stays** — the PWA already works offline; keep sync conflict‑safe.
- **Romansh** is not needed (EN/DE/FR/IT covers Swiss clubs); Swiss‑German UI strings would be a nice touch.

## Sequencing summary

The gate items — sign-in, authorization, per-club persistence — are **built**. What now stands
between the code and real users is Phases 0–4: a permanent domain, hosting that is not a laptop,
the accounts switch, a handful of coaches, and the FADP paperwork.

Order matters in exactly one place: **the domain comes first**, because it is the only step that
cannot be redone without asking every person to register again.

After launch, the features clubs feel daily are RSVP on calendar events, notifications, and the
parent channel — in that order.


---

## Choosing the domain

The passkey domain is permanent in a way nothing else here is, so it is worth a paragraph.

**What actually matters**

1. **You will never change it.** Not "unlikely to" — changing it re-registers every person.
2. **It must survive the club.** The roadmap is Horgen first, then Switzerland, so it must not be
   `sc-horgen-*`. A club-specific domain would have to be abandoned exactly when things go well.
3. **Someone reads it aloud to a parent once.** After that they arrive by clicking an invite link —
   the code travels in the `#` fragment — so typing happens rarely. This matters less than it feels
   like it should.
4. It must not imply it is Swiss Aquatics or wpmatch.ch. It is neither.

**The recommendation: `triibholz.ch`**

The name is already everywhere — the repository, the containers, the app title, four languages of
interface. Renaming the product is a bigger decision than choosing a domain, and it should not be
made as a side effect of buying one.

The honest objection is the spelling: a parent who hears "Triibholz" types *Treibholz*, the standard
German word. Buy `treibholz.ch` too and redirect it — but **the redirect must never be the
`RP_ID`**, or you have two passkey domains and people are registered on whichever they happened to
use. One domain is the sign-in; the other is a signpost.

**Alternatives, if the name is up for discussion anyway**

| Domain | For | Against |
|---|---|---|
| `thplay.ch` | short, unambiguous to type | hard to say aloud, and means nothing to a parent |
| `triibholz.app` | `.app` is HSTS-preloaded, so browsers refuse plain HTTP to it | less familiar than `.ch` to a Swiss club; marginal, as HTTPS is enforced anyway |
| `triibholz.swiss` | unmistakably Swiss | `.swiss` has eligibility rules and costs more |

**Availability, checked 2026-09-17 and not authoritative.** `triibholz.ch`, `thplay.ch`,
`triibholz.app`, `thplay.app` and `triibholz.swiss` have **no nameservers**, which usually means
free; `wasserball.ch` is taken. SWITCH blocks command-line whois, so this is a DNS inference, not a
registry answer — confirm at <https://www.nic.ch/whois/> before buying.
