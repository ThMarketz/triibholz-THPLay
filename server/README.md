# Triibholz Analysis Backend — Tier 3 Phase 1 (MVP)

A dependency-free Node service that runs the **same** water-polo vision engine
as the browser (`js/vision.js` · `js/track.js` · `js/analysis.js`) — server-side,
with more compute — and returns the shared **Result** schema.

## Run

    # local (frames mode works without ffmpeg; video mode needs ffmpeg on PATH)
    cd server && node index.js            # → http://localhost:4200

    # containerised (ffmpeg bundled)
    docker compose up -d analysis         # from the repo root

The app reaches it at `/api` on its own address: nginx proxies it, so there is no endpoint to
type in. Film Room → **Auto-scout** uses it, and so does **Cloud analysis** when "Analyse on the
club server" is ticked.

## API

| Method | Path                     | Purpose |
|--------|--------------------------|---------|
| GET    | `/api/health`            | `{ ok, accounts, engine, detector, ffmpeg, videoProvider, queued, running, maxUploadMB }` (`ffmpeg` is whether the binary really runs) |
| POST   | `/api/analyse`           | sync. JSON `{mode:'frames',frames,w,h,calibration}` **or** raw video bytes + `X-Calibration` / `X-Opts` headers → a **Result** (or `{error}`) |
| POST   | `/api/upload`            | raw video bytes, streamed to disk (up to `MAX_UPLOAD`) → `{ videoRef, bytes }` |
| POST   | `/api/jobs`              | enqueue `{ videoRef, calibration, scout: true, us, opts }` (or frames) → `{ id, status }` |
| GET    | `/api/jobs/:id`          | `{ id, status, error }` |
| GET    | `/api/jobs/:id/result`   | the **Result** once `done` (409 `not-ready` before) |
| POST   | `/api/clip`              | `{ videoRef, start, end }` (≤ 60 s) → `{ id, clipUrl, start, end, bytes }`, an MP4 cut from an uploaded video |
| GET    | `/api/clips/:file`       | the clip, with range requests, `no-store` |

Other routes (calendar feeds, anonymous insights, debriefs, announcements, and `auth` / `clubs` /
`join` behind `ACCOUNTS=1`) are in `index.js`.

**A scout job's Result** carries `meta.seconds`, the seconds actually read. It can also carry
`meta.expectedSeconds` (the length from the file header, when there is one), `meta.damagedChunks`
(chunks that came back short or too long) and `meta.capped` (a file without a length still going
at 12 h). `meta.field` is `{ mode: 'fixed' }` or the auto-field stats. The Film Room warns above
the report when less than 95 % was read.

### Error codes

The same codes appear on a failed job (`GET /api/jobs/:id` → `error`) and in `{ error }` answers.
The Film Room turns each into a sentence for the coach (`errorReason` in `js/film.js`), and
`tests/smoke.mjs` fails if a code has none.

| Code | HTTP | Meaning |
|------|------|---------|
| `bad-calibration` | 422 | fixed camera but no corners / homography |
| `no-frames` | 422 | nothing decodable: not a video, empty, or cut before the first frame. The job **file** keeps ffmpeg's reason in `detail` |
| `field-not-found` | 422 | frames were read but no pool was found in any of them (auto mode). Never guessed |
| `ffmpeg` | 422 / 500 | ffmpeg failed to start or to decode (sync analyse), or a clip couldn't be cut |
| `ffmpeg-unavailable` | 422 / 501 / 503 | no working ffmpeg on this host (job / raw analyse / clip) |
| `video-not-found` | 422 / 404 | the `videoRef` isn't on the server (job / clip) |
| `no-input` | 422 | neither frames nor a `videoRef` |
| `model` | 422 | the served detector (`MODEL_ENDPOINT`) didn't answer |
| `clip-empty` | 422 | nothing to cut there: past the end, or a part a cut-off file lacks. Never cached |
| `too-large` | 413 | body over `MAX_BODY`, or upload over `MAX_UPLOAD` (answer includes `maxUploadMB`) |
| `empty-body` / `bad-json` | 400 | as named |

Damaged parts of a video that still produced a report are listed in the job **file** as
`decodeIssues`, with position, frame counts and ffmpeg's error lines. They never appear in an API
answer.

- **Queue**: in-process FIFO (`CONCURRENCY`, default 1). Swap for Redis at scale.
- **Storage**: jobs, videos and clips on disk under `DATA_DIR` (`/data` in the container).
- **Env**: `PORT` `DATA_DIR` `CONCURRENCY` `MAX_BODY` `MAX_UPLOAD` `FFMPEG` `MODEL_ENDPOINT`.
- **Accounts** (being built, off unless `ACCOUNTS=1`): `RP_ID` `APP_ORIGINS` `DEV` —
  checked at startup; `node admin.js help` for the operator commands. See `docs/ACCOUNTS.md`.
- **Reached at** `/api` on the app's own address through nginx; port 4200 is loopback-only.

## Tests

    node tests/server.mjs     # API gate. Without ffmpeg on the host, every VIDEO check prints SKIPPED
    node tests/identity.mjs   # accounts foundation: config, migrations, codes, CLI
    node tests/auth.mjs       # passkey sign-in: CBOR, real browser captures, every ceremony over HTTP
    node tests/clubs.mjs      # clubs and memberships: codes, requests, roles, removal, step-up, audit

The video path (real MP4/WebM files made in-test with ffmpeg's `lavfi`: whole-length reads, damaged
files, clips, auto field) only runs where ffmpeg is. Run the suite inside the analysis image, as
releases do:

    bash scripts/docker-build.sh
    docker run --rm -v /private/tmp/triibholz-build:/app -w /app -e NODE_NO_WARNINGS=1 \
      triibholz-analysis:latest node tests/server.mjs

## Scope

This is the **Phase 1 MVP** from the Tier 3 plan: a real backend running the
existing engine at full resolution. It is not yet the ML detector (Phase 2),
event detection (Phase 3) or the training flywheel (Phase 4). It plugs into the
same `submit()` contract, so the app doesn't change as those land.
