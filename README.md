# Triibholz · THPLAY — v1.0.0

**Triibholz** (code **THPLAY**) is a water polo tactics trainer. Coaches build
possession scenarios and movement patterns; every player (positions **1–6** +
**goalkeeper**) sees exactly what to do — for the whole team or just their own
position — across every situation: **6v6, 6v5, 5v4, 4v3, 3v2, 2v1, 1v1, and
1‑on‑GK**. Installable, offline‑capable, in four languages.

## Try it in 10 seconds
```bash
docker compose up -d          # or: bash scripts/docker-build.sh
# open http://localhost:8088 → tap a demo persona (Coach / Player / Admin)
```
No sign‑up needed — the login screen has one‑tap **demo personas** with a
pre‑seeded team, plays, activity and progress.

## The field (2025 World Aquatics rules)
- **25 m × 20 m** goal line to goal line — men and women alike.
- Key match numbers: **4 × 8 min** quarters · **28 s** possession · **18 s** exclusion
  (ends early on a goal or awarded turnover) · **2 × 1 min** timeouts (possession only) ·
  penalty from the **5 m line**.
- **Attack = white**, **defence = black**, **goalkeeper = red**, **ball = orange**.
- Lines: goal line (white), **2 m red**, **5 m yellow** (penalty), **6 m green**,
  dotted white **centre line**.
- **Red goal box**: 2 m deep, 1 m beyond each post.
- **Exclusion / re‑entry**: red corner brackets in **all four corners** against
  the goal lines, inside the 2 m zone — an excluded player waits at a corner of
  their own defensive end (18 s / awarded turnover / goal).
- **Official table** + goal judges on top; **flying‑substitution** areas along
  the bottom — one half per team (own goal line → centre line). Waiting players (subs, excluded) render as smaller discs and can
  be stacked in the staging zones.

## Features
| Area | What you get |
|------|--------------|
| **Playbook** | Scenario library per situation & phase (offense/defense), animated playback + step‑by‑step, scrubbing, **Team vs My‑position** focus view, per‑position assignments |
| **Problem → Solution** | Freeze any play as a *problem* (assignments masked), then **Reveal solution ▶** animates the answer — players default to problem mode |
| **Editor** (coach/trainer/admin) | Drag players & ball, **capture steps** to record movement, add **waiting subs / excluded players**, per‑position notes; replay & re‑edit anytime |
| **Roles & approval** | Super Admin / Coach / Trainer / Player; new sign‑ins wait for **Super Admin approval** (console with queue, role management, live activity feed) |
| **Dashboards** | Per‑role home: player progress (XP, 🔥 streaks, badges), coach squad + invite card, admin approvals & activity |
| **Onboarding** | Team code + copy‑link + **QR code** invite; players join by tapping their cap number; first‑run guided tour |
| **Basics** | Water polo fundamentals, **Players / Coach / Referee responsibilities**, colour legend |
| **Rule books** | Official rule books auto‑tracked weekly from **worldaquatics.com** (Competition Regulations + WP 4x4) and **Swiss Aquatics** by a GitHub Action (`scripts/update-rules.mjs` → `data/rules.json`) — links + version dates, no copyrighted text reproduced |
| **Trivia & Challenge** | 16‑question scored quiz with explanations; auto‑generated **play challenges** (“who finishes this play?”); best scores saved |
| **Playful layer** | Polo the mascot, confetti celebrations, opt‑in sound (default off), XP/badges tied to real study |
| **Languages** | **EN / DE / FR / IT**, auto‑detected, flag switcher (tactical play content stays English‑first) |
| **PWA** | Installable on phones/tablets, fully offline via service worker |

## Run / deploy
- **Docker** (recommended): `bash scripts/docker-build.sh` — stages a clean copy
  and (re)builds `triibholz-thplay:latest`, serving on **:8088** via
  nginx‑alpine. *(Use the script, not `docker compose build` — iCloud Drive
  folders confuse Docker's build context.)*
- **No install**: `python3 serve.py` → http://localhost:4173, or host the
  folder on any static host (GitHub Pages / Netlify / Cloudflare Pages).
- See **DEPLOY.md** for registry push & hosting details.

## Repository map
| Path | Purpose |
|------|---------|
| `index.html`, `css/styles.css` | App shell & styling |
| `js/pool.js` | Regulation field renderer + discs/ball + staging zones |
| `js/data.js` | Situations, formations, sample plays, users/approvals, activity, trivia, gamification |
| `js/animate.js` | Keyframe interpolation, playback engine |
| `js/app.js` | Auth/approvals, nav, dashboards, playbook, editor, trivia, challenge, admin, onboarding |
| `js/i18n.js` | EN/DE/FR/IT runtime |
| `js/qr.js` | Dependency‑free QR encoder (invite codes) |
| `js/fx.js` | Mascot, confetti, sound |
| `scripts/update-rules.mjs` | World Aquatics + Swiss Aquatics rule‑book tracker (`npm run update-rules`) |
| `scripts/docker-build.sh` | Reliable container build |
| `.github/workflows/update-rules.yml` | Weekly rule‑book refresh |
| `handouts/` | “ÜSI 14” locker‑room poster (Schweizerdeutsch, PNG + print PDF) |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA |

## Quality gates
- **Headless regression suite**: 82 checks (auth → approvals → playbook →
  editor → trivia → challenge → i18n → demo mode).
- **Real‑browser QA** (Playwright + Firefox): 21‑step walkthrough of every
  persona and view, desktop + 375 px mobile, zero console errors.

## Known limits (v1 prototype scope)
- Accounts, approvals and saved plays live in the **browser (localStorage)** —
  per device. Real Apple/Google OAuth + a small backend is the next milestone
  and makes approvals/rosters sync across devices.
- Simulated sign‑in; the approval flow is fully functional within one browser.
- Tactical content (play names, coaching notes, basics text) is English‑first.
