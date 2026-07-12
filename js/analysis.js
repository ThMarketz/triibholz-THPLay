/* ============================================================
   analysis.js — Tier 3 Phase 0: the cloud-ready contract.

   The whole point of Tier 3 is that the app never has to care WHICH
   engine analysed a video — offline (Tier 1/2) or a future cloud
   GPU pipeline — as long as they all speak one shape. This module
   is that contract:

     · Result schema + validateResult / normalizeResult — the shape
       every engine returns (tracks · events · board frames).
     · submit(job, opts) — one call that routes to a REMOTE endpoint
       when one is configured, and otherwise to the on-device engine
       (injected by the caller). Swap the engine, keep the UI.
     · buildReview — turns a Result into a human-in-the-loop review
       list: the coach confirms what's right, and that confirmation
       is both the action AND (later) the training label.

   Pure and unit-tested. No backend exists yet; the remote transport
   is wired and ready for when Phase 1 stands one up.
   ============================================================ */
const ANALYSIS = (() => {
  const ENDPOINT_KEY = 'thplay.analysis.endpoint';
  const CLASSES = ['white', 'dark', 'keeper', 'ball'];
  const EVENT_TYPES = ['shot', 'goal', 'exclusion', 'possession', 'counter', 'turnover', 'formation'];
  const VERSION = 1;

  const clamp01 = v => Math.max(0, Math.min(1, typeof v === 'number' && isFinite(v) ? v : 0));

  function emptyResult(engine) {
    return { engine: engine || 'on-device', version: VERSION, tracks: [], events: [], frames: [] };
  }

  /* Coerce a partial/loose object into a valid Result (offline engines
     fill only a subset; a cloud engine fills it all). */
  function normalizeResult(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const out = emptyResult(r.engine);
    if (typeof r.version === 'number') out.version = r.version;
    if (Array.isArray(r.tracks)) out.tracks = r.tracks.map((t, i) => ({
      id: t && t.id != null ? t.id : i + 1,
      cls: CLASSES.indexOf(t && t.cls) >= 0 ? t.cls : 'white',
      path: Array.isArray(t && t.path) ? t.path.map(p => ({ t: +p.t || 0, x: +p.x || 0, y: +p.y || 0, conf: clamp01(p.conf) })) : [],
    }));
    let ev = 0;
    if (Array.isArray(r.events)) out.events = r.events.map(e => ({
      id: e && e.id != null ? e.id : 'ev' + (++ev),
      t: +(e && e.t) || 0,
      type: EVENT_TYPES.indexOf(e && e.type) >= 0 ? e.type : 'formation',
      team: e && e.team || null,
      pos: e && e.pos || null,
      zone: e && e.zone || null,
      conf: clamp01(e && e.conf),
      frame: e && e.frame || null,
    }));
    if (Array.isArray(r.frames)) out.frames = r.frames
      .filter(f => f && f.boardFrame)
      .map(f => ({ t: +f.t || 0, boardFrame: f.boardFrame }));
    return out;
  }

  function isBoardFrame(f) {
    return f && typeof f === 'object' && f.att && f.def && f.gk && f.ball;
  }
  /* validateResult(obj) → { ok, errors[] } */
  function validateResult(r) {
    const errors = [];
    if (!r || typeof r !== 'object') return { ok: false, errors: ['result is not an object'] };
    if (typeof r.version !== 'number') errors.push('missing version');
    if (!Array.isArray(r.tracks)) errors.push('tracks must be an array');
    else r.tracks.forEach((t, i) => { if (CLASSES.indexOf(t.cls) < 0) errors.push(`track ${i}: bad cls`); if (!Array.isArray(t.path)) errors.push(`track ${i}: path not array`); });
    if (!Array.isArray(r.events)) errors.push('events must be an array');
    else r.events.forEach((e, i) => { if (typeof e.t !== 'number') errors.push(`event ${i}: t not number`); if (EVENT_TYPES.indexOf(e.type) < 0) errors.push(`event ${i}: bad type`); if (e.conf < 0 || e.conf > 1) errors.push(`event ${i}: conf out of range`); });
    if (!Array.isArray(r.frames)) errors.push('frames must be an array');
    else r.frames.forEach((f, i) => { if (!isBoardFrame(f.boardFrame)) errors.push(`frame ${i}: not a board frame`); });
    return { ok: errors.length === 0, errors };
  }

  /* adapter: an offline board frame (Tier 1/2) → a minimal Result */
  function resultFromBoardFrame(frame, t, conf) {
    t = +t || 0;
    return normalizeResult({
      engine: 'on-device', version: VERSION,
      frames: [{ t, boardFrame: frame }],
      events: [{ t, type: 'formation', conf: conf == null ? 0.6 : conf, frame }],
    });
  }

  /* ---- endpoint config (where a future cloud pipeline lives) ---- */
  function getEndpoint() { try { return localStorage.getItem(ENDPOINT_KEY) || ''; } catch (e) { return ''; } }
  function setEndpoint(url) { try { url ? localStorage.setItem(ENDPOINT_KEY, url) : localStorage.removeItem(ENDPOINT_KEY); } catch (e) {} }
  function status() { const ep = getEndpoint(); return { mode: ep ? 'cloud' : 'offline', endpoint: ep }; }

  function remoteTransport(endpoint) {
    return async (job) => {
      const r = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(job) });
      if (!r.ok) throw new Error('cloud-http-' + r.status);
      return r.json();
    };
  }

  /* submit(job, opts) → Promise<Result>
     opts.transport overrides routing (tests pass a mock); otherwise a
     configured endpoint → remote, else opts.local (the on-device engine). */
  async function submit(job, opts) {
    opts = opts || {};
    const ep = opts.endpoint !== undefined ? opts.endpoint : getEndpoint();
    const transport = opts.transport || (ep ? remoteTransport(ep) : opts.local);
    if (typeof transport !== 'function') throw new Error('no-transport');
    const raw = await transport(job);
    // a real engine returns an object; anything else (null, a string, an
    // HTML error page) or an {error} envelope is a failure, not a result.
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid-result: not a result object');
    if (raw.error) throw new Error('cloud-error: ' + raw.error);
    // lenient by design: offline engines send only a subset, normalize fills the rest.
    return normalizeResult(raw);
  }

  /* ---- human-in-the-loop review model ---- */
  const EVENT_LABEL = { shot: 'Shot', goal: 'Goal', exclusion: 'Exclusion', possession: 'Possession', counter: 'Counter-attack', turnover: 'Turnover', formation: 'Formation snapshot' };
  function fmtT(t) { const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m}:${String(s).padStart(2, '0')}`; }
  function buildReview(result) {
    const r = normalizeResult(result);
    const items = r.events.map((e, i) => ({
      id: e.id || 'ev' + i,
      type: e.type,
      t: e.t,
      label: `${EVENT_LABEL[e.type] || e.type} @ ${fmtT(e.t)}`,
      conf: e.conf,
      state: 'pending',       // pending | confirmed | rejected
      frame: e.frame || null,
      event: e,
    }));
    return { engine: r.engine, items, counts: { pending: items.length, confirmed: 0, rejected: 0 } };
  }
  function setItemState(model, id, state) {
    model.items.forEach(it => { if (it.id === id) it.state = state; });
    model.counts = { pending: 0, confirmed: 0, rejected: 0 };
    model.items.forEach(it => { model.counts[it.state] = (model.counts[it.state] || 0) + 1; });
    return model;
  }

  return {
    CLASSES, EVENT_TYPES, VERSION,
    emptyResult, normalizeResult, validateResult, resultFromBoardFrame,
    getEndpoint, setEndpoint, status, submit,
    buildReview, setItemState,
  };
})();
