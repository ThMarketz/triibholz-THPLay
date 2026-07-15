/* ============================================================
   videogen.js — turn a described play into a shareable VIDEO.

   Two paths behind one call:
   · ANIMATION (offline, free, accurate) — interpolates the play's
     keyframes and renders a clean top-down animated clip to a
     canvas, then records it to a downloadable video with
     MediaRecorder. No server, nothing leaves the device, and it
     shows EXACTLY the movement described.
   · PHOTOREAL (optional) — if a text-to-video provider is configured
     (endpoint + key), builds a prompt from the play and posts it.
     Wired + documented; the provider itself is a paid external
     service you supply (see docs/VIDEO.md).

   The pure maths (timing, interpolation, prompt, provider routing)
   are unit-tested; drawScene/record need a browser canvas.
   ============================================================ */
const VIDEOGEN = (() => {
  const SEC_PER_STEP = 1.6, END_HOLD = 1.0;
  // play region in board coords (matches the tactics board)
  const BX0 = 18, BY0 = 22, BX1 = 302, BY1 = 200;
  const COL = { water1: '#0f5f74', water2: '#0a4152', line: 'rgba(210,240,245,0.5)',
    red: '#e23b3b', yellow: '#f2c14e', green: '#3fae6b', white: '#f4f8fb', dark: '#1b2531',
    ball: '#ff8a2a', ink: '#eaf4fb', caption: 'rgba(6,16,22,0.82)' };

  const clamp01 = v => Math.max(0, Math.min(1, v));
  const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const lerp = (a, b, t) => a + (b - a) * t;
  const lerpPt = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });

  function ballPointOf(f) {
    const b = (f && f.ball) || {};
    if (b.carrier) {
      if (b.carrier === 'GK') return f.gk || { x: 250, y: 110 };
      const p = b.carrier.slice(1);
      return ((b.carrier[0] === 'D' ? f.def : f.att) || {})[p] || { x: 250, y: 110 };
    }
    return { x: b.x != null ? b.x : 250, y: b.y != null ? b.y : 110 };
  }
  function duration(play) {
    const n = (play && play.frames && play.frames.length) || 1;
    return Math.max(1, (n - 1) * SEC_PER_STEP + END_HOLD);
  }
  // interpolated scene at time t → { att, def, gk, ball, step, local }
  function sceneAt(play, t) {
    const frames = (play && play.frames) || [];
    if (!frames.length) return { att: {}, def: {}, gk: { x: 292, y: 110 }, ball: { x: 250, y: 110 }, step: 0, local: 0 };
    const segs = frames.length - 1;
    let i, local;
    if (segs <= 0 || t >= segs * SEC_PER_STEP) { i = Math.max(0, segs - 1); local = 1; }
    else { i = Math.floor(t / SEC_PER_STEP); local = ease(clamp01((t - i * SEC_PER_STEP) / SEC_PER_STEP)); }
    const A = frames[i], B = frames[Math.min(i + 1, frames.length - 1)];
    const mix = (mapA, mapB) => { const o = {}; Object.keys(mapB || {}).forEach(k => { o[k] = (mapA && mapA[k]) ? lerpPt(mapA[k], mapB[k], local) : mapB[k]; }); return o; };
    return {
      att: mix(A.att, B.att), def: mix(A.def, B.def),
      gk: A.gk && B.gk ? lerpPt(A.gk, B.gk, local) : (B.gk || A.gk),
      ball: lerpPt(ballPointOf(A), ballPointOf(B), local),
      step: i, local, from: A, to: B,
    };
  }

  /* ---------- canvas rendering (browser) ---------- */
  function mapper(W, H) {
    const pad = Math.round(W * 0.03);
    const sx = (W - 2 * pad) / (BX1 - BX0), sy = (H - 2 * pad - 34) / (BY1 - BY0);
    return (p) => ({ x: pad + (p.x - BX0) * sx, y: pad + (p.y - BY0) * sy });
  }
  function drawScene(ctx, play, t, W, H, opts) {
    opts = opts || {};
    const M = mapper(W, H), sc = sceneAt(play, t);
    // water
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, COL.water1); g.addColorStop(1, COL.water2);
    ctx.fillStyle = '#06121a'; ctx.fillRect(0, 0, W, H);
    const tl = M({ x: BX0, y: BY0 }), br = M({ x: BX1, y: BY1 });
    ctx.fillStyle = g; roundRect(ctx, tl.x, tl.y, br.x - tl.x, br.y - tl.y, 14); ctx.fill();
    // lines: 2m red, 5m yellow, 6m green, half dotted, goal right
    line(ctx, M({ x: 271, y: BY0 }), M({ x: 271, y: BY1 }), COL.red, 2);
    line(ctx, M({ x: 248, y: BY0 }), M({ x: 248, y: BY1 }), COL.yellow, 1.5);
    line(ctx, M({ x: 231, y: BY0 }), M({ x: 231, y: BY1 }), COL.green, 1.5);
    dline(ctx, M({ x: 160, y: BY0 }), M({ x: 160, y: BY1 }), COL.line);
    const gp1 = M({ x: 296, y: 96 }), gp2 = M({ x: 296, y: 124 });
    line(ctx, gp1, gp2, COL.white, 4);
    // movement arrows for the current segment
    if (sc.from && sc.to) {
      Object.keys(sc.to.att || {}).forEach(k => { const a = sc.from.att && sc.from.att[k], b = sc.to.att[k]; if (a && b && dist(a, b) > 8) arrow(ctx, M(a), M(b), 'rgba(244,248,251,0.5)'); });
    }
    // discs
    const R = Math.max(11, Math.round(W * 0.018));
    Object.keys(sc.att).forEach(k => disc(ctx, M(sc.att[k]), R, COL.white, COL.dark, k));
    Object.keys(sc.def).forEach(k => disc(ctx, M(sc.def[k]), R, COL.dark, COL.white, k));
    if (sc.gk) disc(ctx, M(sc.gk), R, COL.red, COL.white, 'GK');
    // ball
    const bp = M(sc.ball); ctx.beginPath(); ctx.arc(bp.x, bp.y, Math.round(R * 0.5), 0, 7); ctx.fillStyle = COL.ball; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
    // caption
    const cap = (opts.caption || (play && (play.title || play.description)) || '').toString();
    if (cap) {
      ctx.fillStyle = COL.caption; ctx.fillRect(0, H - 30, W, 30);
      ctx.fillStyle = COL.ink; ctx.font = `${Math.round(H * 0.036)}px -apple-system,system-ui,sans-serif`;
      ctx.textBaseline = 'middle'; ctx.fillText(clip(cap, 78), 14, H - 15);
    }
    ctx.fillStyle = 'rgba(234,244,251,0.55)'; ctx.font = `${Math.round(H * 0.03)}px -apple-system,system-ui,sans-serif`;
    ctx.textBaseline = 'top'; ctx.fillText('Triibholz · THPLAY', 12, 10);
  }
  // helpers
  function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function line(c, a, b, col, w) { c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); }
  function dline(c, a, b, col) { c.save(); c.setLineDash([5, 5]); line(c, a, b, col, 1.4); c.restore(); }
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function arrow(c, a, b, col) { line(c, a, b, col, 3); const ang = Math.atan2(b.y - a.y, b.x - a.x), s = 8; c.fillStyle = col; c.beginPath(); c.moveTo(b.x, b.y); c.lineTo(b.x - s * Math.cos(ang - 0.4), b.y - s * Math.sin(ang - 0.4)); c.lineTo(b.x - s * Math.cos(ang + 0.4), b.y - s * Math.sin(ang + 0.4)); c.closePath(); c.fill(); }
  function disc(c, p, r, fill, ink, label) {
    c.beginPath(); c.arc(p.x, p.y, r, 0, 7); c.fillStyle = fill; c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 1.5; c.stroke();
    c.fillStyle = ink; c.font = `bold ${Math.round(r * 1.05)}px -apple-system,system-ui,sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(label), p.x, p.y + 0.5); c.textAlign = 'left';
  }
  const clip = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;

  function pickMime() {
    const opts = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    if (typeof MediaRecorder === 'undefined') return 'video/webm';
    return opts.find(m => { try { return MediaRecorder.isTypeSupported(m); } catch (e) { return false; } }) || 'video/webm';
  }
  // record(play, opts) → { blob, url, duration, mime }  (browser only)
  async function record(play, opts) {
    opts = opts || {};
    const W = opts.width || 854, H = opts.height || 480, fps = opts.fps || 30;
    const canvas = opts.canvas || document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const dur = duration(play);
    const stream = canvas.captureStream(fps);
    const mime = pickMime();
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: opts.bitrate || 4000000 });
    const chunks = []; rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise(res => { rec.onstop = res; });
    drawScene(ctx, play, 0, W, H, opts);
    rec.start();
    const t0 = (typeof performance !== 'undefined' ? performance.now() : new Date().getTime());
    await new Promise(resolve => {
      const step = () => {
        const t = ((typeof performance !== 'undefined' ? performance.now() : new Date().getTime()) - t0) / 1000;
        drawScene(ctx, play, Math.min(t, dur), W, H, opts);
        if (t >= dur + 0.08) return resolve();
        (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame(step) : setTimeout(step, 1000 / fps));
      };
      step();
    });
    rec.stop(); await stopped;
    const blob = new Blob(chunks, { type: mime.split(';')[0] });
    return { blob, url: (typeof URL !== 'undefined' ? URL.createObjectURL(blob) : ''), duration: dur, mime: blob.type };
  }

  /* ---------- photoreal provider seam (optional) ---------- */
  const PROV_KEY = 'thplay.videogen.provider';
  function getProvider() { try { return JSON.parse(localStorage.getItem(PROV_KEY) || 'null'); } catch (e) { return null; } }
  function setProvider(cfg) { try { cfg && cfg.endpoint ? localStorage.setItem(PROV_KEY, JSON.stringify(cfg)) : localStorage.removeItem(PROV_KEY); } catch (e) {} }
  function providerStatus() { const p = getProvider(); return { mode: p && p.endpoint ? 'photoreal' : 'animation', name: (p && p.name) || '' }; }
  function promptFromPlay(play) {
    const parts = ['Top-down water polo, realistic pool.'];
    if (play && (play.title || play.description)) parts.push(String(play.description || play.title));
    if (play && play.notes) Object.keys(play.notes).forEach(k => parts.push(`Player ${k}: ${play.notes[k]}`));
    parts.push('White caps attack right; dark caps defend; red keeper; orange ball.');
    return parts.join(' ');
  }
  function defaultTransport(p) {
    return async (body) => {
      const r = await fetch(p.endpoint, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, p.key ? { authorization: 'Bearer ' + p.key } : {}), body: JSON.stringify(body) });
      if (!r.ok) throw new Error('provider-http-' + r.status);
      return r.json();
    };
  }
  // photoreal(play, opts) → provider's response ({url} | {status:'pending',jobId} | …)
  async function photoreal(play, opts) {
    opts = opts || {};
    const p = getProvider();
    const transport = opts.transport || (p && p.endpoint ? defaultTransport(p) : null);
    if (typeof transport !== 'function') throw new Error('no-provider');
    const out = await transport({ prompt: opts.prompt || promptFromPlay(play), seconds: opts.seconds || Math.round(duration(play)) });
    if (!out || typeof out !== 'object' || Array.isArray(out)) throw new Error('bad-provider-response');
    if (out.error) throw new Error('provider-error: ' + out.error);
    return out;
  }

  return { SEC_PER_STEP, duration, sceneAt, ballPointOf, drawScene, record, pickMime,
    getProvider, setProvider, providerStatus, promptFromPlay, photoreal };
})();

// Node/CommonJS interop (no-op in the browser)
if (typeof module !== "undefined" && module.exports) module.exports = VIDEOGEN;
