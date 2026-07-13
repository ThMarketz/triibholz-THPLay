# Water-Polo Detector — Dataset & Training Guide

Scope for the one external piece the app is waiting for: a **trained detector**.
Everything downstream of detection — calibration (homography), tracking (ByteTrack),
board mapping, and event detection — is already built, deterministic, and tested.
So the ML effort is deliberately narrow.

> **The model only has to do per-frame detection.** It does **not** need to track,
> identify players by number, understand events, or know the pool geometry. Feed it a
> frame, get back boxes. That is the whole job — which keeps the dataset and the model
> small and cheap relative to a full "video understanding" system.

---

## 1. The contract the model must satisfy

The app already defines exactly what a detector returns (see `web-model/README.md`
and `server/detector.js`):

```
detect(frame, W, H)  →  [ { x, y, w, h, cls, conf }, … ]
  frame : RGBA pixels (W×H), a single video frame at analysis resolution (≈320×180)
  x,y   : box CENTRE in frame-pixel space      w,h : box size (px)
  cls   : 'white' | 'dark' | 'keeper' | 'ball'  conf: 0..1
```

- **`white`** = the lighter-cap team, **`dark`** = the darker-cap team, **`keeper`** =
  red cap (goalkeeper, by rule), **`ball`** = the ball.
- Team is **relative luminance**, not a fixed colour — caps are white/blue/black/etc.
  across leagues. Map "the lighter team" → `white`, "the darker team" → `dark`.
- Output is in **frame-pixel space**. The app's homography turns that into board
  coordinates; the model never sees the pool geometry.

That contract is the same for the server (ONNX Runtime Node) and on-device
(`WEBDETECTOR.register`, ONNX Runtime Web / TF.js). **One model, two deployments.**

---

## 2. What to label (annotation guidelines)

### Label caps (heads), not bodies
Only the **cap / head** is reliably above water and it is what fixes a player's
position on the board. Draw a tight box around the **visible cap**. Do **not** try to
box the whole (mostly submerged, occluded) body. This is the single most important
rule — it makes labels consistent and fast.

### Classes (4)
| Class | What to box |
|-------|-------------|
| `white` | Every lighter-team cap in the water |
| `dark`  | Every darker-team cap in the water |
| `keeper`| The red goalkeeper cap(s) |
| `ball`  | The ball, whenever ≥ ~40% visible |

### Do label
- All in-water players **in the field of play**, including at the wings and 2 m.
- Caps ≥ ~30% visible (partially turned away, mid-stroke, low in the water).
- The ball in flight, on the water, or in a hand if clearly visible.

### Do NOT label
- Players/subs/coaches/referees **on the deck** or in the substitution area.
- Reflections, splash, lane ropes, caps of officials — these are **negative examples**;
  leaving them unlabeled teaches the model to ignore them.
- Cap **numbers** — identity is recovered by the tracker, so numbers are out of scope
  (this removes a huge amount of annotation cost).
- The ball when fully underwater / invisible. Optionally add a frame-level
  `ball_occluded` flag for analytics, but do not box an invisible ball.

### Hard cases (write these into the annotator spec)
- **Scrums at 2 m** — box each cap you can distinguish; skip fully hidden ones.
- **Two keepers** — both red caps are `keeper`; the app picks the relevant one.
- **Colour ambiguity** — decide "lighter vs darker team" per match and stay consistent
  within the match. If both teams are dark (rare), use the assigned game caps.
- **Motion blur on the ball** — still box it; blur is a real deployment condition.

### Quality control
- Double-label a 5–10% sample; measure inter-annotator IoU agreement (target ≥ 0.7 for
  caps). Reconcile disagreements into the guideline.
- A senior reviewer audits a random slice per batch.

---

## 3. Data collection

| Dimension | Aim for diversity across… |
|-----------|---------------------------|
| Venue     | indoor/outdoor, clear vs green/turbid water, tiled vs dark pools |
| Lighting  | daylight, floodlit, glare, shadows |
| Camera    | fixed high cam (ideal), pool-deck GoPro, broadcast (has cuts) |
| Play      | men/women, youth→senior, even, man-up/down, counters |
| Caps      | white/blue/black/other colour pairings |

- **Consent first.** Match footage contains identifiable people, often **minors** —
  secure explicit consent for training use and record it. Keep an opt-out path. (See
  the privacy section of the test plan.)
- **Fixed-camera club footage is the best value** — no shot cuts to handle.
- **Broadcast** needs shot-boundary handling before frames are usable; lower priority
  for a first model.

### Sampling
- Sample **~1 frame/second**, not every frame (adjacent frames are near-duplicates and
  waste annotation budget).
- **Oversample hard moments**: shots, scrums at 2 m, counters, man-up sets — these are
  where detection fails and where events matter most.

### Rough volume (starting points, not guarantees)
- **v1 fine-tune:** ~3,000–8,000 labelled frames across ~30–60 matches.
- **Robust v2:** tens of thousands of frames, wider venue/lighting diversity.
- The **ball** likely needs proportionally more positive examples than caps — it is the
  scarce, hard class.

---

## 4. Splits (avoid leakage — this is easy to get wrong)

- Split **by match/venue**, never by frame. Frames from one match must not appear in
  more than one split (they are near-identical and would inflate scores).
- **Train / Val / Test** by match, e.g. 70 / 15 / 15.
- Keep a **frozen "hard" test set** (splashy, low-light, heavy occlusion, an unseen
  venue and an unseen cap-colour pairing). Every model version is judged on this same
  frozen set so scores are comparable over time.

---

## 5. Model choice

- **Recommended:** a compact real-time detector fine-tuned on caps+ball — **YOLO
  (n/s size)** or **RT-DETR**. Reasons: strong speed/accuracy, small enough to run
  on-device, and exports cleanly to **ONNX** (server) and **ONNX Runtime Web / TF.js
  WebGPU** (browser T2b) from one set of weights.
- **Transfer learning:** start from COCO-pretrained weights and fine-tune; caps are not
  a COCO class, but low-level features transfer. Expect to train the head heavily.
- **Input size:** the **ball is a small-object problem** — use a higher input
  resolution (e.g. 640–960 on the long side) or a dedicated ball head/branch. Budget
  for the ball being the accuracy bottleneck; a **separate ball model** is a valid
  option if the joint model underperforms on it.
- **Quantise** the web build (int8/fp16) to keep the on-device download and latency
  sane; keep the server build full precision.

### Augmentation (match the water domain)
- Synthetic **splash / glare / ripple** overlays, **motion blur**, brightness/contrast.
- **Cap-colour jitter** so the model generalises across leagues (don't overfit to one
  white/blue pairing).
- Horizontal flip is fine for detection (class is colour, not side of pool).

---

## 6. The flywheel (Phase 4) — turning the app into a data engine

The human-in-the-loop **review loop already collects labels**: every time a coach
**Confirms** or **edits** an auto-detected position/event, that is a corrected label.

```
auto-detect → coach confirms / edits → store (frame + corrected boxes)
   → periodic retrain → evaluate on the frozen test set → promote if better
```

- **Active learning:** prioritise frames the model was **uncertain** about or where the
  coach **corrected** it — those are the highest-value labels.
- **Versioning & rollback:** every model is versioned; promote only if it beats the
  current one on the frozen set; keep the ability to roll back.
- **Governance:** using customer footage for training must be **opt-in** and
  per-tenant; honour deletion. Never mix tenants' data without consent.

---

## 7. Acceptance criteria (feed into the test plan)

Proposed starting bars — tune with real data:

| Signal | Starting target |
|--------|-----------------|
| Cap detection mAP@0.5 (white/dark/keeper) | ≥ 0.80 |
| Ball recall @ conf 0.3 | ≥ 0.60 (it's hard; measure honestly) |
| Board-position error after homography | ≤ ~0.5 m median for caps |
| Track ID stability (IDF1) over a possession | ≥ 0.70 |
| Event precision (shot/goal/possession) vs coach truth | ≥ 0.70 |
| Latency — server | within per-video-minute budget |
| Latency — on-device | tracking a 2–3 s passage stays interactive |
| Flywheel health — % auto-tags accepted unedited | rises release over release |

---

## 8. Effort & cost (rough, honest)

- **Annotation is the dominant early cost.** Boxing caps+ball on N frames × several
  boxes/frame × a few seconds/box × QC overhead. Plan the annotation tool + guideline +
  QC loop before scaling.
- **Compute:** a few GPU-days for a v1 fine-tune of a small detector; recurring for the
  flywheel.
- **Ongoing:** MLOps (training, versioning, monitoring, the frozen-set gate), plus
  storage/consent management for footage.

None of this can be built or validated inside the app repo — it is a data + ML + infra
programme. The app is fully wired for its output: implement the §1 contract, point the
server (`MODEL_ENDPOINT`) or the browser (`WEBDETECTOR.register`) at it, and it takes
over the pipeline with zero code change.
