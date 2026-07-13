# Triibholz Analysis Backend — Tier 3 Phase 1 (MVP)

A dependency-free Node service that runs the **same** water-polo vision engine
as the browser (`js/vision.js` · `js/track.js` · `js/analysis.js`) — server-side,
with more compute — and returns the shared **Result** schema.

## Run

    # local (frames mode works without ffmpeg; video mode needs ffmpeg on PATH)
    cd server && node index.js            # → http://localhost:4200

    # containerised (ffmpeg bundled)
    docker compose up -d analysis         # from the repo root

Then in the app: **Film Room → ☁️ Cloud analysis → endpoint** = `http://localhost:4200`.

## API

| Method | Path                     | Purpose |
|--------|--------------------------|---------|
| GET    | `/api/health`            | `{ ok, engine, ffmpeg, queued, running }` |
| POST   | `/api/analyse`           | sync. JSON `{mode:'frames',frames,w,h,calibration}` **or** raw video bytes + `X-Calibration` / `X-Opts` headers → a **Result** (or `{error}`) |
| POST   | `/api/jobs`              | enqueue → `{ id, status }` |
| GET    | `/api/jobs/:id`          | `{ id, status, error }` |
| GET    | `/api/jobs/:id/result`   | the **Result** once `done` |

- **Queue**: in-process FIFO (`CONCURRENCY`, default 1). Swap for Redis at scale.
- **Storage**: jobs + videos on disk under `DATA_DIR` (`/data` in the container).
- **Env**: `PORT` `DATA_DIR` `CONCURRENCY` `MAX_BODY` `FFMPEG`.

## Tests

    node tests/server.mjs     # frames-mode API gate (no ffmpeg needed)

## Scope

This is the **Phase 1 MVP** from the Tier 3 plan: a real backend running the
existing engine at full resolution. It is not yet the ML detector (Phase 2),
event detection (Phase 3) or the training flywheel (Phase 4). It plugs into the
same `submit()` contract, so the app doesn't change as those land.
