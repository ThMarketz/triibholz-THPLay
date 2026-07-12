/* ============================================================
   vision.js — Tier 1 offline video analysis engine.

   Pure, dependency-free maths that turn an uploaded clip into
   positions on the tactics board — no ML, no server:
     · rgb2hsv / classifyCap  — read the standardised cap + ball
       colours (white attack, dark defence, RED keeper, orange ball)
     · detect                 — cluster classified pixels into blobs
     · solveHomography/project — a one-time 4-point pool calibration
       maps video pixels onto the board's own coordinate system
     · toBoardFrame           — assemble detected blobs into a
       scenario frame the playbook/board can render & save

   Everything here is deterministic and unit-tested; the browser
   glue (sampling frames, capturing clicks) lives in film.js.
   ============================================================ */
const VISION = (() => {

  /* board water rectangle (matches pool.js viewBox 320×262) */
  const BOARD = { x0: 26, y0: 32, x1: 294, y1: 188 };
  // destination corners for calibration, in click order: TL, TR, BR, BL
  function boardCorners() {
    return [
      { x: BOARD.x0, y: BOARD.y0 }, { x: BOARD.x1, y: BOARD.y0 },
      { x: BOARD.x1, y: BOARD.y1 }, { x: BOARD.x0, y: BOARD.y1 },
    ];
  }
  const clampBoard = p => ({
    x: Math.max(BOARD.x0, Math.min(BOARD.x1, p.x)),
    y: Math.max(BOARD.y0, Math.min(BOARD.y1, p.y)),
  });

  /* ---------------- colour ---------------- */
  function rgb2hsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return { h, s: mx ? d / mx : 0, v: mx };
  }
  // → 'white' | 'dark' | 'keeper' | 'ball' | null
  function classifyCap(r, g, b) {
    const { h, s, v } = rgb2hsv(r, g, b);
    if (v > 0.45 && s > 0.45 && (h >= 12 && h <= 45)) return 'ball';      // orange ball
    if (v > 0.35 && s > 0.5 && (h < 12 || h >= 342)) return 'keeper';     // red cap
    if (v > 0.72 && s < 0.22) return 'white';                            // white cap
    if (v < 0.30 && !(h >= 170 && h <= 250 && s > 0.35)) return 'dark';  // dark cap (not blue water)
    return null;
  }

  /* ---------------- blob detection ----------------
     Classify a downsampled frame, bucket hits into a coarse grid,
     then merge nearby cell-centroids into blobs (video-pixel space). */
  function detect(data, W, H, opts) {
    opts = opts || {};
    const step = opts.step || 2;
    const gx = opts.gridX || 40, gy = opts.gridY || 24;
    const minCell = opts.minCell || 3;
    const merge = opts.mergeDist || Math.max(W, H) / 12;
    const cells = {}; // class -> Map(cellIndex -> {sx,sy,n})
    ['white', 'dark', 'keeper', 'ball'].forEach(c => cells[c] = new Map());
    const cw = W / gx, ch = H / gy;
    for (let y = 0; y < H; y += step) {
      for (let x = 0; x < W; x += step) {
        const i = (y * W + x) * 4;
        const cls = classifyCap(data[i], data[i + 1], data[i + 2]);
        if (!cls) continue;
        const ci = Math.floor(y / ch) * gx + Math.floor(x / cw);
        const m = cells[cls]; const e = m.get(ci);
        if (e) { e.sx += x; e.sy += y; e.n++; } else m.set(ci, { sx: x, sy: y, n: 1 });
      }
    }
    const out = {};
    ['white', 'dark', 'keeper', 'ball'].forEach(cls => {
      const pts = [];
      cells[cls].forEach(e => { if (e.n >= minCell) pts.push({ x: e.sx / e.n, y: e.sy / e.n, n: e.n }); });
      out[cls] = mergeBlobs(pts, merge);
    });
    return out;
  }
  // greedy weighted merge of points within `dist`
  function mergeBlobs(pts, dist) {
    const sorted = pts.slice().sort((a, b) => b.n - a.n);
    const used = new Array(sorted.length).fill(false);
    const blobs = [];
    for (let i = 0; i < sorted.length; i++) {
      if (used[i]) continue;
      let sx = sorted[i].x * sorted[i].n, sy = sorted[i].y * sorted[i].n, n = sorted[i].n;
      used[i] = true;
      for (let j = i + 1; j < sorted.length; j++) {
        if (used[j]) continue;
        if (Math.hypot(sorted[j].x - sx / n, sorted[j].y - sy / n) <= dist) {
          sx += sorted[j].x * sorted[j].n; sy += sorted[j].y * sorted[j].n; n += sorted[j].n; used[j] = true;
        }
      }
      blobs.push({ x: sx / n, y: sy / n, n });
    }
    return blobs.sort((a, b) => b.n - a.n);
  }

  /* ---------------- homography (4-point DLT) ---------------- */
  function solveLinear(A, b, n) {           // Gaussian elimination, partial pivot
    for (let col = 0; col < n; col++) {
      let piv = col;
      for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
      if (Math.abs(A[piv][col]) < 1e-12) return null;
      [A[col], A[piv]] = [A[piv], A[col]]; [b[col], b[piv]] = [b[piv], b[col]];
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const f = A[r][col] / A[col][col];
        for (let c = col; c < n; c++) A[r][c] -= f * A[col][c];
        b[r] -= f * b[col];
      }
    }
    return b.map((v, i) => v / A[i][i]);
  }
  // src[4],dst[4] → H (length 9, row-major, H[8]=1) mapping src → dst
  function solveHomography(src, dst) {
    if (!src || !dst || src.length < 4 || dst.length < 4) return null;
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const { x, y } = src[i], X = dst[i].x, Y = dst[i].y;
      A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]); b.push(X);
      A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]); b.push(Y);
    }
    const h = solveLinear(A, b, 8);
    if (!h) return null;
    return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  }
  function project(H, x, y) {
    const d = H[6] * x + H[7] * y + H[8] || 1e-9;
    return { x: (H[0] * x + H[1] * y + H[2]) / d, y: (H[3] * x + H[4] * y + H[5]) / d };
  }

  /* ---------------- assemble a board frame ----------------
     Project detected blobs to board space and lay them out as a
     scenario frame (white→attackers, dark→defenders, red→GK,
     orange→ball). Caps limited to 6 a side; extras dropped. */
  function toBoardFrame(det, H) {
    const proj = arr => (arr || []).map(b => ({ ...clampBoard(project(H, b.x, b.y)), n: b.n }));
    const white = proj(det.white).slice(0, 6);
    const dark = proj(det.dark).slice(0, 6);
    const keeper = proj(det.keeper)[0] || null;
    const ball = proj(det.ball)[0] || null;
    const label = list => { const o = {}; list.sort((a, b) => a.y - b.y).forEach((p, i) => o[i + 1] = { x: +p.x.toFixed(1), y: +p.y.toFixed(1) }); return o; };
    const frame = {
      att: label(white),
      def: label(dark),
      gk: keeper ? { x: +keeper.x.toFixed(1), y: +keeper.y.toFixed(1) } : { x: 292, y: 110 },
      ball: ball ? { carrier: null, x: +ball.x.toFixed(1), y: +ball.y.toFixed(1) } : { carrier: null, x: 250, y: 110 },
      extra: [],
    };
    const counts = { white: white.length, dark: dark.length, keeper: keeper ? 1 : 0, ball: ball ? 1 : 0 };
    return { frame, counts };
  }

  return { BOARD, boardCorners, clampBoard, rgb2hsv, classifyCap, detect, mergeBlobs, solveHomography, project, toBoardFrame };
})();
