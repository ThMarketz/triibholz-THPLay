# Try the video analysis — a 60-second demo

There's a ready-made demo clip in this folder so you can drive the whole pipeline
(calibration → tracking → board → events) without hunting for real footage.

**File:** [`docs/demo/triibholz-demo-clip.mp4`](demo/triibholz-demo-clip.mp4) — a short
stylised passage: white = attackers, dark = defenders, red = keeper, orange = ball. The
ball is held, passed, then shot at the goal.

> It's stylised on purpose (flat cap colours) so the offline colour engine detects it
> cleanly. Real match footage works the same way but is harder — that's what the trained
> model in [`DATASET_AND_TRAINING.md`](DATASET_AND_TRAINING.md) is for.

---

## A. In the app (the full experience)

1. **Open the app** — Firefox Private Window → <http://localhost:8088> → **Coach demo**.
   *(Private window avoids the PWA cache serving an old build.)*
2. **Film Room** → in *Matches*, type a title (e.g. "Demo"), then **Upload video** and
   pick `docs/demo/triibholz-demo-clip.mp4`.

### Position tracking — on-device, offline (Tier 1/2)
3. Under **📍 Position tracking**, click **Calibrate pool**. A still of the clip appears —
   click its **four corners in order: top-left, top-right, bottom-right, bottom-left**.
   (Here the whole frame is the pool, so just click the video's corners.)
4. Click **Track positions**. The board fills with discs read straight from the clip —
   white attackers, dark defenders, red keeper, orange ball. Drag any disc to correct it,
   then **Open as a play** to drop it in your Playbook. *This runs entirely on your
   device — nothing leaves it.*

### Auto-tagged events — via the backend (Tier 3)
5. Under **☁️ Cloud analysis**, set the endpoint to **`http://localhost:4200`** and click
   **Save endpoint** — the chip flips to *☁️ Cloud*.
6. Make sure the clip is at **0:00**, then click **Run analysis**. The video is sent to the
   backend, which decodes it full-res and returns an **auto-tagged timeline**:
   *formation*, *shot*, *possession*. Each row → **Confirm → play** (opens it on the board
   to fine-tune and save) or **Dismiss**. *Confirming is exactly what a trained model would
   learn from — the flywheel.*

> No backend running? Leave the endpoint **blank** and press **Run analysis** — it uses
> the on-device engine and lists the detected formation to confirm (no events; those need
> the backend). Start the backend with `docker compose up -d analysis`.

---

## B. Straight against the API (no browser)

The backend is at `http://localhost:4200`. Analyse the demo clip in one call:

```bash
curl -s -X POST http://localhost:4200/api/analyse \
  -H 'content-type: application/octet-stream' \
  -H 'x-calibration: {"corners":[{"x":0,"y":0},{"x":320,"y":0},{"x":320,"y":180},{"x":0,"y":180}]}' \
  -H 'x-opts: {"start":0,"winSec":2.6,"fps":12}' \
  --data-binary @docs/demo/triibholz-demo-clip.mp4
```

You'll get back the shared **Result** (`engine:"server"`, a time-series of board `frames`,
and `events`). Health check: `curl -s http://localhost:4200/api/health`.

*(The server analyses at 320×180, so the calibration corners above are that frame's
corners. In the app, calibrating the on-screen canvas produces the same mapping for you.)*

---

## What "good" looks like

On the demo clip the pipeline detects **5 attackers, 3 defenders, a keeper and the ball**,
and auto-tags a **shot** and **possession**. Events are heuristic and always
coach-confirmed — never blind. See [`TEST_PLAN.md`](TEST_PLAN.md) for how each stage is
validated.
