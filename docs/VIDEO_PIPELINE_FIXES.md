# Triibholz (THPLAY) — Video pipeline fixes, phased (2026‑09‑15)

Where this came from: fixing the `[3g]` auto-scout test in `tests/server.mjs`, which failed
inside the release image (`triibholz-analysis:latest`, node 22.23.2 + ffmpeg 8.1.2). Three
server bugs were fixed that day (Phase 0). Probing the scout with real files in the image
then turned up the problems below. Every finding here was reproduced, not guessed.

**How to verify any phase** — both must be all green:

    node tests/server.mjs                                  # host (this Mac has no ffmpeg)
    bash scripts/docker-build.sh
    docker run --rm -v /private/tmp/triibholz-build:/app -w /app -e NODE_NO_WARNINGS=1 \
      triibholz-analysis:latest node tests/server.mjs      # image (has ffmpeg)

The host run can't exercise the video path at all (no ffmpeg), so **the image run is the
only gate for Phases 1–4**. Test videos are generated inside the image with ffmpeg's
built-in `lavfi` test source, so nothing needs downloading. Fault-inject each new check
(revert the fix, watch it fail) before trusting it.

---

## Status

| Phase | What | Size | Status |
|-------|------|------|--------|
| 0 | Land the three fixes already made | S | ☑ committed; both gates green on the commit |
| 1 | Long videos analysed as 0.5 s and reported "done" | M | ☑ done |
| 2 | Partly unreadable videos look like complete ones | M | ☑ done |
| 3 | Coaches see raw error codes, in every language | S | ☐ |
| 4 | Test and documentation gaps | S | ☐ |
| 5 | Browser gate | S | ☑ gate fixed (ea826cc); Phase 2 UI checks in; Phase 0/3 UI checks still to add |

---

## Phase 0 — Land what is already fixed

Fixed and verified 2026‑09‑15 (host 84/84, image 84/84, smoke 652/652, fault-injected):

1. `server/engine.js` `videoToScout` — a file with no decodable frames reported
   `field-not-found`, even with fixed corners where the field is never searched. Now
   `no-frames`.
2. `server/index.js` `hasFfmpeg` — was always `true`. `spawnSync` does not throw when the
   binary is missing, so `/api/health` said `ffmpeg: true` on a Mac without it. Because of
   that, the Film Room's "backend has no ffmpeg" message (`js/film.js:557`) could never show.
3. `server/index.js` `/api/clip` — checked ffmpeg before the video, so an unknown video got
   503 instead of 404 on hosts without ffmpeg.

Plus `tests/server.mjs`: the `[3g]` job check now expects exactly `no-frames` (ffmpeg
present) or `ffmpeg-unavailable` (absent), and a new `[1]` check tests the health flag
against the real host.

**Done 2026‑09‑15.** Committed on their own, with this plan. Accounts work in progress (slice 3:
`server/auth.js`, `db.js`, `identity.js`, `tests/identity.mjs`) stayed out. Both gates ran
on an export of exactly that commit, not the working tree.

Still open, your call: the running `triibholz` / `triibholz-analysis` containers were last
rebuilt from the working tree before this commit, with Accounts slice 2 included.
`scripts/docker-build.sh` stages the working tree, so rebuilding now would also ship the
unfinished slice 3. Rebuild once that work is in a state you want running.

---

## Phase 1 — Long videos analysed as 0.5 s and reported "done"

**Evidence.** In the image, a 45‑second WebM written to a pipe, so it has no length header.
Browser recordings (`MediaRecorder`) and streamed files typically come out the same way:

| File (45 s) | Result | Seconds analysed |
|-------------|--------|------------------|
| `real.mp4` | done | 45 |
| `piped.webm` | **done** | **0.5** |

ffmpeg prints `Duration: N/A` for that file. `probeDuration` then returns 0,
`videoToScout` clamps the length to `Math.max(0.5, 0)`, decodes one half-second chunk and
returns a scout report. The coach gets a result for the first half-second of the match
and no warning.

**Fix.** When the length is unknown, keep decoding chunk after chunk until one comes back
short or empty, with a hard cap (e.g. 3 h) so a broken stream can't run forever. Report
`meta.seconds` from the frames actually decoded, not the probe. Progress can't show a
percentage when the length is unknown, so report seconds done instead.

**Tests (image).** Generate the 45 s piped WebM in the test and expect `done` with
`meta.seconds` ≈ 45. Keep an mp4 alongside it so both paths stay covered. On a host without
ffmpeg, print the check as skipped. Don't count it as passed.

**Done when** the WebM row above reads 45, and reverting the fix makes the check fail.

**Done 2026‑09‑15.** The WebM row now reads 45.

- **Seeking checked before building.** Chunk seeks in a header-less WebM are frame-exact, same as
  MP4. They don't re-scan the file either: about 200 ms per chunk at 0, 5 and 10 minutes into
  a 188 MB file. So the chunk loop stays. The alternative, one long ffmpeg stream, wasn't needed.
- **How the end is found.** When the length is unknown, `videoToScout` reads until an empty
  chunk follows a short or empty one. A non-video costs two quick empty reads and still ends
  `no-frames`.
- **Cap.** 12 h, overridable by `opts.maxSec`. A file on disk always ends, so the cap only
  guards against a container whose seeks never do. Hitting it sets `meta.capped: true`, which
  `js/analysis.js` now keeps (service worker cache → v66). **Showing it to the coach is
  Phase 2.**
- **`meta.seconds`.** Now counts frames actually read, for every file. `meta.chunks` counts
  chunks that had frames.
- **Progress.** Nothing passes `onProgress` today (no caller in `server/` or `js/`), so no
  percentage was shown before either. The callback now gets `(fraction, or null when the
  length is unknown, seconds read)` for whoever wires it up.
- **Tests.** `tests/server.mjs` `[3g2]` runs 5 checks in the image. Real 45 s MP4 and
  header-less WebM files go through upload → job → result, plus the cap and the
  "known length is never capped" case. On a host without ffmpeg they print as SKIPPED, and
  the summary counts them separately. A smoke check covers `meta.capped` in the normalizer.
  Fault-injected three ways, each caught: the old engine, `capped` never set, and
  end-of-video detection removed.
- **A longer file.** A 10-minute header-less WebM (75 MB) went through the scout in 4.4 s:
  600 s read, 30 chunks.

---

## Phase 2 — Partly unreadable videos look like complete ones

**Evidence.** `decodeChunk` (`server/engine.js`) ignores ffmpeg's exit code and turns any
failure into "no frames for this chunk". The loop then skips the chunk silently. The job
keeps only the error *code* (`job.error = e.code || e.message`), so ffmpeg's own
explanation is lost.

**Fix.**
- Record coverage in the result: `meta.decodedSeconds`, `meta.expectedSeconds` (when
  known), and how many chunks failed.
- Keep the last few lines of ffmpeg's error output on the job as `detail`, for the server
  log and debugging only. Don't show it to coaches.
- Film Room: when coverage is under ~95 %, show "analysed X of Y min" next to the report.

**Tests (image).** Make a video with a middle chunk that fails. A quick try at zeroing
bytes mid-mp4 still gave a full 45 s, and I didn't confirm the bytes were actually
overwritten, so treat that as untested. A file cut short is the reliable case: half an mp4
already gives `no-frames`. Expect `done` with coverage below 100 % and a failed-chunk count.

**Done 2026‑09‑15.** First I measured how damage actually shows up (image, 45 s fixtures). Two
of the plan's assumptions were wrong:

| Damage | ffmpeg exit | What shows it |
|--------|-------------|---------------|
| MP4 cut in half, index at the front (header still says 45 s) | 0 | chunks come back 113 → 0 → 0 frames |
| WebM with index, cut in half | 0 | 120 → 14 → 0 frames |
| Garbage over 25 % of the middle (WebM / MP4 / MPEG-TS) | 0 | chunks come back **too long** (156, 183 frames for a 120-frame chunk), or short |

The exit code is useless, and ffmpeg's error output is unreliable: 281 lines for one file, 0 for
another with the same damage. So damage is judged by **frame counts**. Only an MP4 with its
index at the end gives `no-frames` when cut; one with the index at the front plays its first part.

- **`server/engine.js`.** A damaged chunk is one that's short or empty but isn't the end
  (with an unknown length that's only known once something follows it), or one with more
  frames than its length. A slightly short *last* chunk doesn't count, because audio can
  outlast video. Over-long chunks are now **cut to their length**: before, their frames got
  timestamps that ran into the next chunk's. `meta.expectedSeconds` is set when the length
  is known, and `meta.damagedChunks` when above zero. `decodeChunk` runs with
  `-loglevel error` and returns its exit code and error tail.
- **`server/index.js`.** ffmpeg's words go in the job **file** only. That's `decodeIssues`
  (up to 20: position, frames/expected, exit code, error tail) and, for errors, `detail`.
  The server log gets one line. The job and result API answers don't carry them.
- **Film Room.** A warning **above** the report, including the "no possessions" view. The
  existing "Ns analysed" line is inside the collapsed "Go further" part, where a coach would
  miss it. Most serious first: capped ("only the first 12 h were read"), then under 95 % read
  ("Only 19 s of this 45 s video could be read (42%) …"), then damaged parts. EN/DE/FR/IT,
  i18n scan at 0. Service worker cache → v67.
- **Tests.** Server `[3g2]` +5 in the image: a clean file has `expectedSeconds` and no
  damage; MP4 cut in half; ffmpeg's words in the job file but not the API; garbage WebM
  with strictly increasing timestamps; a non-video's `detail`. Smoke +1: the normalizer
  keeps the new fields only as valid numbers. Browser +3 with a mocked club server: the
  partial warning above the report, the damaged-parts warning, no warning on a clean read.
  `tests/browser.mjs` now accepts `APP_URL`.
- **Verified** on HEAD plus exactly these files: image 94/94, host 84 + 10 skipped, smoke
  654/654, and browser 190/190 with zero console errors. The browser run used a separate
  stack on :8090 built from the export, so the running containers and the other session's
  unfinished work weren't involved. Fault-injected 5 ways, each caught: no frame cap, no
  damage count, details leaking to the API, no Film Room warning, and the normalizer
  dropping the fields.
  Accounts slice 3 (79f3e39) landed mid-way, touching `server/index.js`, so everything was
  re-run on 79f3e39 plus these files. All green again, including that session's
  `tests/identity.mjs` 79, `auth.mjs` 153 and `clubs.mjs` 127.

**Limits (known, not fixed):**
- A **header-less** file cut short can't be told apart from a shorter video, since there's
  no length to compare against.
- Damage ffmpeg **conceals** without changing the frame count (in the MPEG-TS, the chunk where the
  garbage began, around 18–20 s, still came back as a normal 120 frames) isn't seen.

---

## Phase 3 — Coaches see raw error codes, in every language

**Evidence.** In `js/film.js` (the auto-scout `catch`, ~line 573), any message not in the
short list falls through to `why = m`. So coaches see the raw code, untranslated in
EN/DE/FR/IT:

- `scout-no-frames` · `scout-field-not-found` · `scout-ffmpeg` · `scout-bad-calibration` ·
  `scout-video-not-found`
- `timed-out` · `job-500` · `upload-bad-json` · any other `upload-<status>`

The i18n ratchet (`tests/i18n-scan.mjs`) can't catch this, because the text is built at
runtime.

**Fix.** Give each code a plain-language reason in all four languages (e.g. no-frames →
"this file has no video we can read — is it a video, and did it finish uploading?";
field-not-found → "we couldn't find the pool — try marking the corners"). Keep one generic
fallback that never shows a raw code.

**Tests (smoke).** One check that every error code the server can send (`engine.js`,
`index.js`) maps to a translation key that exists in all four languages. This is a list
check, so it fails as soon as someone adds a new code without a message.

---

## Phase 4 — Test and documentation gaps

- **The success path with a real video.** Partly done in Phase 1: `[3g2]` runs real MP4
  and WebM files through upload → job → `done` with a `scout` block and the right length.
  Still missing: `meta.field.mode === 'fixed'`, and `/api/clip` on a real video returning an
  mp4. The fixtures `[3g2]` generates can be reused for both.
- **The clip check is loose.** "500 clip/ffmpeg or 503 no ffmpeg" accepts either on any
  host. Expect the exact status for the host, as the `[3g]` check now does.
- **Auto mode on the video path.** Frames decoded but no pool found should give
  `field-not-found` on the video path too. Today only frames mode checks this (`[3j]`).
- **Docs.** `server/README.md` lists no error codes, and its `/api/health` row misses
  `accounts`, `detector`, `videoProvider` and `maxUploadMB`. Add an error-code table. Add the image gate
  command to `docs/TEST_PLAN.md` release gates, noting that the host run doesn't cover video.

---

## Phase 5 — Browser gate

**Unblocked 2026‑09‑15.** `tests/browser.mjs` runs again: 187/187, zero console errors,
including `[12]`, which checks real Word/PDF downloads on disk and had never run before.

The macOS 27 upgrade wasn't the cause. The user's everyday Firefox (155.0.1) keeps
`~/Library/Application Support/Firefox`, and any other Firefox started with that home breaks.
Playwright's Firefox 151 (build 1532) hangs at launch, while Firefox 155 (build 1543) and even
a second stock Firefox exit with "Could not find profile folder." The gate now starts Firefox
with its own empty home (`HOME` + `CFFIXED_USER_HOME`). With that, both builds launch, inside
the command sandbox too. The fix also stopped the tests touching the user's real Firefox
profile folder. Fixing it also exposed a test bug from Accounts slice 0: the file's `URL`
constant hid the built-in, so line 308 crashed.

The gate still uses Playwright 1.61.1 / Firefox 151. Firefox 155 (build 1543, ~290 MB) was
downloaded while diagnosing and is in `~/Library/Caches/ms-playwright`. Moving `tests/` to
Playwright 1.63.0 would use it; otherwise it can be deleted.

**Still to do for this plan:** Film Room checks for Phase 0's no-ffmpeg message and the
Phase 3 messages. Phase 2's are in (the mocked club server in `[4b]`), and
`APP_URL=http://localhost:<port>/` points the gate at a stack other than the running containers.
