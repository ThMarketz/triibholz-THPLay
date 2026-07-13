# Triibholz (THPLAY) — Test Plan

How the product and its analysis pipeline are validated: what is automated today, what
gets added when the trained model lands, and the release gates. Written to be run, not
just read.

---

## 1. Objectives & scope

Validate that:
1. **The app works** — auth/roles, playbook + editor, Solutions Lab, commands, trivia,
   Film Room, i18n, PWA/offline.
2. **The analysis pipeline is correct** — calibration → detection → tracking → board →
   events → review, on-device and on the backend, all speaking the one Result schema.
3. **The model meets bar** — once a trained detector exists (external), it is evaluated
   against frozen data before it ships.
4. **Non-functional quality** — performance, offline, privacy/consent, accessibility,
   i18n, cross-browser.

Out of scope until built: real OAuth, the trained model itself, the Phase-4 retraining
infra. These are noted as **gaps** with the tests that will cover them.

---

## 2. Test levels & current coverage

| Level | Suite | What it covers | Status |
|-------|-------|----------------|--------|
| Unit / component | `tests/smoke.mjs` (jsdom) | pure engines: pool, data, animate, DRAFT, COMMANDS, SOLVER, VISION (classify/homography/detect/board), TRACK (CC + tracker), BYTETRACK (two-stage), EVENTS (possession/turnover/shot/goal), WEBDETECTOR (NMS/postprocess/register), ANALYSIS (schema/validate/submit/review); full app flow | **175 checks, green** |
| Backend API | `tests/server.mjs` (Node) | `/api/health`, `/api/analyse` (frames + errors), async job queue lifecycle, served-model seam via a mock model server, Phase-3 events end-to-end, error handling (400/422/404) | **23 checks, green** |
| System / E2E | `tests/browser.mjs` (Playwright + Firefox) | real DOM, real mouse drags, calibration clicks, Tier-2 toggle, cloud panel + endpoint status, review area, mobile overflow, **zero app console errors** | **73 steps, green** |
| Model eval | *(new — §4)* | detector + downstream accuracy on frozen data | **pending a model** |
| UAT | *(manual — §6)* | coaches on real footage | **per release** |

**Run locally**
```
node tests/smoke.mjs        # headless, fast
node tests/server.mjs       # backend API (spawns the service on a tmp dir)
node tests/browser.mjs      # needs the app container up (scripts/docker-build.sh)
```

Every code change keeps all three green before it ships — this has held every release
(v1.0.0 → v1.18.0).

---

## 3. Pipeline test cases (functional, largely automated)

| Area | Cases | Where |
|------|-------|-------|
| Colour classification | white/dark/keeper/ball vs blue/teal water → null | smoke |
| Calibration / homography | 4-corner solve maps corners & centre exactly; 4-click UI flow | smoke + browser |
| Detection | connected-component blobs, area filter rejects splash speckle, per-blob confidence | smoke |
| Tracking (ByteTrack) | recover low-conf frame, reject phantom births, class isolation, per-frame series | smoke |
| Board mapping | detections → attackers/defenders/keeper/ball, clamped to water | smoke |
| Events | possession, turnover, shot (speed→goal), goal (reaches mouth); each carries a frame | smoke + server e2e |
| Backend | frames-mode + video (ffmpeg) analyse, queue submit→poll→result, CORS | server + live container |
| Detector seam | served-model (mock) drives the board; unreachable model → clean 422 | server |
| On-device seam | `WEBDETECTOR.register` flips detector; model dets flow per-class; colour fallback | smoke |
| Errors / robustness | bad JSON, no input, empty frames, unknown job/route, tainted (cross-origin) video, oversized body | server + smoke |

---

## 4. Model evaluation plan (add when the trained model exists)

Detection accuracy alone is **not** the acceptance signal — a jittery ball with decent
mAP still produces bad events. Evaluate **detection and downstream** on the **frozen
test set** (see `DATASET_AND_TRAINING.md` §4, §7).

**Datasets**
- Frozen held-out matches (never seen in training).
- A "hard" set: splash, low light, occlusion, unseen venue + cap-colour pairing.
- Synthetic fixtures (already used by the suites) for deterministic regression.

**Metrics & bars** (starting points; tune with data)

| Metric | Bar |
|--------|-----|
| Cap mAP@0.5 (white/dark/keeper) | ≥ 0.80 |
| Ball recall @ conf 0.3 | ≥ 0.60 |
| Board-position error (median, caps) | ≤ ~0.5 m |
| Track ID stability IDF1 (per possession) | ≥ 0.70 |
| Event precision — shot / goal / possession vs coach truth | ≥ 0.70 |
| Event recall — shot / goal | reported, trend up |
| Latency (server per video-minute; on-device per 2–3 s passage) | within budget |

**Process**
- Ground truth from the annotation set (caps+ball) and coach-tagged events.
- **No regression:** a new model must not drop on the frozen set vs the shipping model.
- Report per-class + per-condition (venue/lighting) so weaknesses are visible.
- Wire as a CI job triggered on model-version change; it produces a scorecard and a
  promote/hold decision.

**Flywheel validation:** track **% of auto-tags accepted without edit** over time — it
should rise as the model retrains on coach corrections.

---

## 5. Non-functional testing

### Performance & load
- Backend: throughput (jobs/min), latency per video-minute, queue behaviour under
  concurrent submits, memory over long runs; set `CONCURRENCY` and verify no leak.
- On-device: time to track a 2–3 s passage stays interactive; memory bounded; large
  uploads handled (respect `MAX_BODY`).

### Offline / PWA
- App loads and functions offline (service worker shell).
- SW cache version bumps on release (currently `triibholz-v27`) and old caches evict.
- Cross-origin analysis calls (:4200) bypass the SW (they must not be cached).

### Privacy & security *(gains weight as real backend/OAuth land)*
- **Consent** required before match video is uploaded/stored; opt-out honoured.
- **Per-tenant isolation** of videos/results; deletion + retention enforced.
- No personal data in URLs/query strings; CORS scoped for production (currently `*`
  for local dev — tighten before public deploy).
- Input validation & limits (`MAX_BODY`, JSON parse guards, path sanitisation on
  `videoRef`).
- Auth: when real OAuth replaces the simulated sign-in, add authorization/session/role tests
  (approval gate, role-restricted views).
- Instruction-boundary: uploaded/observed content is data, never commands.

### Accessibility & i18n
- Keyboard operation (playbook Space/←/→, Esc closes modals), visible focus, colour
  contrast on both light/dark, basic screen-reader labels.
- All four locales render (EN/DE/FR/IT); no raw i18n keys leak (a smoke check already
  guards the Solutions nav label).

### Cross-browser / device
- Current gate: **Firefox** (Playwright) + mobile viewport overflow.
- Before public release: add **Chrome** and **Safari/iOS** passes (WebGPU availability
  matters for the on-device model).

---

## 6. UAT (coaches, per release)

- 3–5 coaches analyse **real** clips end-to-end: upload → calibrate → track → review →
  confirm → play in the playbook.
- Collect: detection/event usefulness, false-positive annoyance, calibration ease,
  time saved vs manual tagging, trust in auto-tags.
- Exit: no severe usability blockers; median "would use this weekly" ≥ agreed bar.

---

## 7. Release gates (entry → exit)

A release ships only when:
1. `smoke.mjs`, `server.mjs`, `browser.mjs` all **green**, **zero app console errors**.
2. A live container smoke (health + one real analyse) passes.
3. If the model changed: the **model scorecard** meets §4 bars with **no regression** on
   the frozen set.
4. UAT sign-off (for coach-facing changes).
5. Privacy checklist passes (for anything touching stored video / tenants).

**CI mapping**
- On PR: smoke + server + browser.
- On model change: + model eval scorecard.
- On release tag: + live container smoke + privacy checklist + (periodic) UAT.

---

## 8. Risk-based priorities & known gaps

| Risk / gap | Why | Test emphasis |
|------------|-----|---------------|
| **Ball detection** | small, fast, occluded — the accuracy bottleneck | dedicated ball recall metric; oversample ball frames |
| **Exclusions not detected** | a referee decision, not readable from positions | documented gap; needs model/ref signal + its own eval later |
| **Broadcast cuts** | break tracking | shot-boundary handling + its tests before broadcast support |
| **Calibration quality** | wrong corners → wrong positions | UI guidance + homography accuracy tests; consider auto-calibration eval |
| **Colour engine limits** | struggles in splash/low-light/crowds | this is *why* the model exists; hard-set metrics quantify the gap |
| **Consent / minors** | legal + ethical | consent gating is a hard release gate for stored video |
| **Simulated auth** | not production security | real-OAuth test suite before public launch |

---

## 9. Traceability (feature → test)

| Feature | Primary tests |
|---------|---------------|
| Playbook / editor / commands / draft | smoke §5, §6d, §6e; browser §3,§3c,§3d |
| Solutions Lab | smoke §6f; browser §3e |
| Trivia (fair shuffle) | smoke §4 |
| Film Room tagging / insights | smoke §8; browser §4b |
| Tier 1 calibration + colour | smoke §6h; browser §3e |
| Tier 2 hardened tracking | smoke §6i, §6k |
| Events (Phase 3) | smoke §6l; server §3c |
| Analysis contract (Phase 0) | smoke §6j |
| Backend (Phase 1) + detector seam (Phase 2) | server §1–§4 |
| On-device model seam (T2b) | smoke §6m; browser §3e |
| PWA / offline / i18n | smoke (i18n, help); manual offline check |
