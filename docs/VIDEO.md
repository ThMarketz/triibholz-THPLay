# Play → Video

Two ways to turn a described play into a clip, behind one **🎬 Generate video** panel
in the play editor.

## 1. Animated video (offline, free, accurate) — default

Write the play in **✍️ Draft from words** (one action per line), then
**Generate animated video**. The app interpolates the keyframes and renders a clean
top-down clip — pool lines, caps in team colours, the ball, movement arrows and a caption —
to a canvas, and records it with the browser's `MediaRecorder` into a **downloadable video**
(WebM, or MP4 where the browser supports it).

- Runs **entirely on the device** — nothing is uploaded, no cost, works offline.
- Shows **exactly** the movement you described (it's your play, animated).
- Understands coach phrasing, including defenders and sides, e.g.:

  ```
  white cap 2 has the ball
  white cap 2 drives to 2m on the right hand side
  defender 6 tries to foul 2
  2 passes to 4
  4 shoots far corner from the left
  ```

## 2. Photoreal (optional — a paid provider you supply)

To get life-like footage instead of the animation, add a **text-to-video provider**
(endpoint + optional API key) under the panel's *Photoreal* section. The app builds a
prompt from the play and `POST`s it to your provider.

### Provider contract
```
POST <endpoint>
  headers: content-type: application/json[, authorization: Bearer <key>]
  body:    { prompt, seconds }
  → { url }                      // a ready video URL, or
    { status:'pending', jobId }  // an async job you poll, or
    { error }                    // a failure the app surfaces
```

Wrap whatever service you use (Runway, Luma, Kling, Veo, Sora-class APIs, or your own
proxy) behind that shape.

### Honest limitations
- It's a **paid external service** — API key, network and per-clip cost are yours.
- **Tactical accuracy is not guaranteed.** Today's text-to-video models produce
  realistic-looking footage that often does **not** follow the described tactics
  (wrong positions, wrong count, no real 2 m line or pass). For coaching precision the
  **animated** clip is the reliable option; photoreal is a "looks impressive" extra.
- Making photoreal both realistic **and** tactically correct needs *conditioning* the
  video model on a control signal (e.g. the animation as a pose/motion guide) — advanced
  and still imperfect; a future direction, not shipped.

## Status chip
The panel shows **● animation (offline)** by default, or **● photoreal: provider** once a
provider is saved.
