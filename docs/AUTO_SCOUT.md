# Auto‑scout — the system watches the video and writes the playbook

**Goal:** analyse a 1‑minute clip or a 1‑hour match *without a human tagging anything*,
recognise the tactics being played (ours, or an opponent's), and produce a scouting
summary plus a playbook of the plays it saw.

## What's built (v1.23.0)

`js/tactics.js` — a pure, unit‑tested tactics‑intelligence layer that runs on the
tracked positions the pipeline already produces:

| Stage | What it does |
|---|---|
| **segment** | Cuts the match into **possessions** — who holds the ball (nearest player), ended by a turnover, a shot/goal, a keeper touch at the goal, or the ball vanishing. |
| **distill** | Boils a noisy possession down to **≤ 6 clean keyframes** — start, every pass, every real drive, the shot — with **stable player labels** (nearest‑neighbour matching between frames, because the tracker re‑labels by height every frame). Output = a real, editable play (frames + per‑player notes + step text like *"1 has the ball → 1 drives in → 1 passes to 3 → 3 shoots"*). |
| **recognize** | Scores the play against tactic **signatures**: drive & kick · hole entry (feed 2 m) · pick & roll · perimeter swing · wing isolation · counter‑attack · man‑up 4‑2 / 3‑3 · set offence — and the defence it met (press / drop / zone). Returns a label + **confidence**; below 0.5 it says **unclassified** rather than guessing. |
| **profile** | Per team: possessions, shot rate, shot zones, avg passes, tempo, man‑up count, dominant formation, **tendencies with percentages**. |
| **summary** | A scouting report in plain sentences — for *both* teams, so it reads our own movements or what the opponent is trying to play (pick "we are white/dark caps"). |
| **buildPlaybook** | The distinct recognised plays (grouped by tactic + situation + shot zone) as ready‑to‑save scenarios: *"Drive & kick · seen 4× (auto‑scout)"*. Plays under 80 % confidence are flagged **needs review**. |

**Backend** — `videoToScout()` decodes the **whole** video in 20 s chunks (bounded
memory, continuous timestamps), tracks each chunk, runs event detection on the joined
series, then scouts it. Long videos run as a **background job**
(`POST /api/upload` → `POST /api/jobs {videoRef, calibration, scout:true, us}` → poll →
result with `scout`). Frames‑mode `/api/analyse` with `scout:true` works synchronously
(that's what the tests use).

**App** — Film Room → **🧠 Auto‑scout → Scout this video** → summary + tendencies + the
recognised plays → **Add plays to my playbook** (Team visibility, review‑flagged).

## Honest accuracy statement

The tactics layer is **model‑agnostic and deterministic** — it will not get better or
worse on its own. Its accuracy on real footage is bounded by what feeds it:

- Today's **colour detector** (caps + orange ball) works well on clean, steady, fixed‑camera
  footage with clear cap colours, and degrades in splash, low light, crowded 2 m scrums,
  and broadcast cuts. Expect good possession/pass/shot structure and reasonable tactic
  labels on such footage; expect **unclassified** and missed possessions on messy footage.
- The **trained detector** (`DATASET_AND_TRAINING.md`, Phase 2 seam) is what lifts this
  to broadcast‑grade — the same tactic layer then sees clean tracks. Nothing here needs
  rewriting when it lands.
- Player **identity by cap number** is not attempted (labels are positional within a play).
- **Exclusions** are still not inferred (referee decision).

Everything is confidence‑gated and reviewable; the system never fabricates a play it
didn't see.

## How to test it
1. Film Room → **Upload video** with `docs/demo/triibholz-demo-clip.mp4` (or any clip) → Calibrate.
   A match added as a YouTube / Veo / other **link** shows the panel greyed out: the analyser needs
   the file itself, so download the match from the camera platform and upload it.
2. **🧠 Scout this video** → read the summary and plays → **Add plays**.
3. API: `POST /api/analyse` with `mode:'frames'` + `scout:true` returns `result.scout`
   (`possessions`, `plays`, `profile`, `summary`, `playbook`).

## Game plan → plan vs reality → team debrief (v1.24.0)

**What we asked vs what happened.** On a match, tick under **🎯 Game plan** the instructions
given to the players (18 in the library: drive & kick, feed the hole, pick & roll, swing,
wing iso, counter, man‑up 4‑2 / 3‑3, shoot high / low, quick / patient attacks; press, drop,
zone, deny the hole feed, stop the drive & kick, concede no counters). After
**Scout this video** the report shows a **Plan vs reality** table, per instruction:

| Asked | Attacks | Followed | When followed (shots/goals) | When not | Verdict |
|---|---|---|---|---|---|
| ⚔ Drive & kick | 14 (2 unread) | 64 % | 5 / 3 in 9 | 1 / 0 in 3 | largely followed — and it worked better |

`js/gameplan.js` is pure and unit‑tested (`GAMEPLAN.compliance(planIds, scout.plays, {us})`).
"Followed" means the recognised tactic matched the instruction; "unread" attacks (the
detector could not classify them) are always counted, never hidden.

**Every attack** is listed with time, side, tactic, confidence and result. **▶ Clip** cuts
that possession out of the uploaded match on the backend (`POST /api/clip` → h264, 640 px,
served with range requests from `/api/clips/…`); **Board ⚡** opens it as an animated play in
the editor.

**📣 Share debrief with the team** publishes summary + plan table + up to 12 attacks (clip +
board play + "asked / followed") to `POST /api/debriefs`. Everyone on the same backend sees
**Team debriefs** at the bottom of the Film Room, replays each play on the board, watches the
clip, and comments per play or on the whole match (`POST /api/debriefs/:id/comments`).
Debriefs are stored per team in the backend data directory — one club per backend today;
the multi‑club tenancy layer from the rollout roadmap takes over later.

**Synthetic demo clip:** `docs/demo/triibholz-demo-attack.mp4` (20 s, white drive & kick
then a dark possession) is generated, not filmed — it proves the pipeline end‑to‑end and
produces a recognised drive & kick, not a benchmark of real‑footage accuracy.
