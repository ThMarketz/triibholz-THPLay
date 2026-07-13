# On-device model pack (T2b) — the seam, and how to fill it

The app runs detection through a **pluggable on-device detector** (`js/webdetector.js`).
By default it uses the **colour engine** (cap/ball colours + connected components).
A *model pack* replaces that with a real neural detector — **entirely on the user's
device, still offline** — by registering an inference function.

## What a model pack is
A separate script you load after the app (it is NOT bundled, because a runtime +
weights is a large download) that:

1. Pulls an in-browser inference runtime (e.g. **onnxruntime-web** or **TensorFlow.js**,
   WASM or WebGPU) and your trained water-polo weights. Host these yourself; mind the
   PWA cache size and the app's CSP.
2. Implements inference against the contract and registers it:

   ```js
   // infer(frame, W, H): frame = RGBA Uint8ClampedArray (W*H*4)
   //   → returns detections in FRAME-PIXEL space:
   //     [{ x, y, w, h, cls:'white'|'dark'|'keeper'|'ball', conf }]
   WEBDETECTOR.register(async (frame, W, H) => {
     const input = preprocess(frame, W, H);      // to your model's tensor layout
     const out   = await session.run(input);     // your ORT/TF.js session
     return decode(out);                          // boxes → the contract above
   }, 'wp-detector-v1');
   ```

`webdetector.js` handles the model-agnostic rest: **score thresholding, class
mapping and non-max suppression** (`postprocess`), then the detections flow into the
**same ByteTrack + board pipeline** the colour engine uses. Call
`WEBDETECTOR.register(null)` to fall back to colour.

## Status
The Film Room's Position-tracking panel shows the active on-device detector
(`● colour` or `● model: <name>`). Training and hosting the actual weights is the
external ML step — the app is ready for them today.
