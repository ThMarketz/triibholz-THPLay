# Triibholz · THPLAY

**Triibholz** (code **THPLAY**) is a tactics trainer for water polo. Coaches build possession scenarios and
movement patterns; every player (positions **1–6** + **goalkeeper**) sees
exactly what to do — for the whole team or just their own position — across
every situation: **6v6, 6v5, 5v4, 4v3, 3v2, 2v1, 1v1, and 1‑on‑GK**.

## Field convention (from your board photos)
- **Attack** = white discs · **Defence** = black discs
- **Goalkeeper** = red · **Ball** = orange
- Markings: goal lines, 2 m (red), 5 m (yellow), 6 m (green), half‑distance line,
  **red goal‑area box** in front of each goal, corner **re‑entry/exclusion** arcs,
  goal judges, official table.
- Two waiting lanes below the field hold **multiple players**:
  **Flying Substitution** and **Exclusion / Re‑entry** (e.g. an excluded defender
  waits there during a 6‑on‑5).
- The attacking team always attacks the **right‑hand goal** (defended by the red GK).

## Roles & access
- **Super Admin** — approves logins, manages roles, and sees a live activity feed.
- **Coach / Trainer** — record & adjust plays (build movement, capture steps, edit anytime).
- **Player** — views plays (team or just their position) and takes trivia.

**Login approval:** Coaches, Trainers and Players land in **“waiting for approval”**
until a Super Admin approves them in the **Admin** console. (In this single‑browser
prototype, sign in and choose **Super Admin** to get in and approve the others —
two demo requests are pre‑loaded in the queue. With a real backend this becomes a
proper cross‑device gate so only **designated users** get in.)

## How to open it
**Easiest:** double‑click `index.html` (it runs entirely in the browser — no install).

**Or run the bundled server** (recommended for Safari, which restricts `file://`):
```bash
python3 serve.py        # then open http://localhost:4173
```

## Using it
- **Sign in** with Apple or Google (prototype = simulated sign‑in; real OAuth is
  wired at deploy time — that needs an Apple Developer account + a hosted domain).
- Pick your **role** (and **position** if you’re a player), then request access.
- **Nav:** **Dashboard** (your personal overview) · **Playbook** · **Trivia** ·
  **Admin** (Super Admin only).
- **Playbook:** top tabs = the 8 situations · **Offense / Defense** toggle ·
  left = scenario library · center = pool with **Play / step ◀ ▶ / scrub** and
  **Team vs My‑position** views · right = per‑position assignments.
- **Coaches/Trainers** press **“+ New”** (or **Edit**) to build/adjust a play:
  drag players & the ball, **“Capture step”** to record each movement step,
  add **waiting players** with **+ Sub / + Excluded**, set per‑position notes, save.
  Saved movement is replayable by anyone, anytime, and editable again later.
- **Trivia:** a scored water‑polo quiz; your best score is saved to your profile.

## Files
| File | Purpose |
|------|---------|
| `index.html` | App shell (auth, app, editor) |
| `css/styles.css` | Styling |
| `js/pool.js` | Accurate pool + player/ball SVG |
| `js/data.js` | Situations, formations, sample plays, users/approvals, activity, trivia bank, localStorage |
| `js/animate.js` | Keyframe interpolation + playback (incl. waiting players) |
| `js/app.js` | Auth/approvals, nav, dashboards, trivia, admin console, library, viewer, editor |
| `serve.py` | Tiny static server (honors `$PORT`) |

Data is stored locally in your browser (localStorage). Sample plays are seeded
for every situation; your own saved plays are tagged **“yours”**.

## Next steps for production
- Real Apple/Google OAuth + a backend so the roster and plays sync across devices
  and only **designated users** can sign in.
- Coach‑managed team roster / invitations.
- Video or PDF export of a play.
