# Rollout Roadmap — one club first, then Switzerland

Goal: prove Triibholz in **one club (Schorgen pilot)**, then scale to clubs across
**Switzerland**. This is what to add, in the order that de‑risks each step. The code
grade and gaps it responds to are in `CODE_AUDIT.md`.

---

## Phase A — Club pilot (Schorgen): "one club, many devices"
*Objective: every coach and player in the club uses the same, live playbook.*

**Must‑have (blocking)**
1. **Real sign‑in** — Apple + Google OAuth (the buttons exist, currently simulated), sessions, and **authorization on every backend endpoint** (the analysis/calendar/insights APIs are open today).
2. **Server‑side persistence** — plays, users, approvals, calendar, insights stored per **club (tenant)** instead of one device's localStorage; multi‑device sync; nightly backups. This is the single biggest unlock.
3. **Hardening** — nginx security headers (CSP, X‑Frame‑Options, nosniff, HSTS), CORS scoped to the app origin, rate limiting, lock down per‑request provider bases.
4. **Public address** — the calendar‑subscribe and analysis features need a reachable URL (LAN IP works on the club Wi‑Fi; a tunnel/hosted domain for everyone). Your cloudflared tunnel is the natural route.
5. **Consent & privacy (FADP)** — consent capture for match video (minors!), privacy notice in DE/FR/IT, data export + delete.

**High‑value for the pilot**
6. **Attendance / RSVP on calendar events** — players (and parents) confirm training/match presence; coach sees the squad list per event. This is the #1 daily‑use feature for clubs and the parent channel you asked about.
7. **Notifications** — push/email for new match, changed time, cancelled training; digest for parents.
8. **Player profiles & simple stats** — attendance %, trivia, plays studied, load from the season plan; a per‑player "know your role" list.
9. **Coach‑to‑team messaging** on an event ("bring dark caps", "meet 17:30").
10. **Onboarding polish** — Swiss‑German first (default `de`), club logo/colours, QR join already exists.

**Success criteria to leave Phase A:** 2+ coaches and the squad on the same live playbook for 6+ weeks; RSVP used for every event; zero data loss; no security findings open.

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
Phase A items 1–3 (auth, persistence/tenancy, hardening) are the gate to *everything* else — build them first, then RSVP + notifications (the features clubs feel daily), then scale.
