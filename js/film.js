/* ============================================================
   film.js — Film Room: match-video analysis.
   Watch a match (YouTube link or uploaded file), tag moments with
   a timestamp, shot origin (mini pool) and goal-mouth zone, mark
   what was right / wrong and which counter-measure would have
   stopped it — then rebuild any moment on the tactics board.
   Analysis (shot charts + insights) is computed from the coach's
   tags; automatic video tracking is a future server-side feature.
   ============================================================ */
const FILM = (() => {
  const KEY = 'thplay.film.v1';

  /* ---------------- storage ---------------- */
  const uid = () => 'f' + Math.random().toString(36).slice(2, 9);
  function seed() {
    return [{
      id: 'demo-match', title: 'film.demo.title', createdBy: 'Coach Ruiz',
      source: { kind: 'youtube', id: 'tQ2Qh7yFTyA' },
      events: [
        { id: uid(), t: 95,  type: 'goal-against', situation: 'man-down', pos: '5', zone: 'BL',
          origin: { x: 250, y: 150 }, verdict: 'wrong', counter: 'film.demo.c1',
          note: 'film.demo.n1' },
        { id: uid(), t: 152, type: 'goal-for', situation: 'man-up', pos: '2', zone: 'TR',
          origin: { x: 238, y: 84 }, verdict: 'right', counter: '',
          note: 'film.demo.n2' },
        { id: uid(), t: 241, type: 'shot-against-saved', situation: '6v6', pos: '6', zone: 'MC',
          origin: { x: 232, y: 110 }, verdict: 'right', counter: 'film.demo.c3',
          note: '' },
        { id: uid(), t: 312, type: 'goal-against', situation: 'counter', pos: '3', zone: 'BL',
          origin: { x: 262, y: 132 }, verdict: 'wrong', counter: 'film.demo.c4',
          note: 'film.demo.n4' },
        { id: uid(), t: 388, type: 'exclusion-against', situation: '6v6', pos: '4', zone: '',
          origin: null, verdict: 'wrong', counter: 'film.demo.c5',
          note: 'film.demo.n5' },
      ],
    }];
  }
  /* The demo match used to ship as English text and is already sitting in the localStorage of
     everyone who has opened the app. Swap that text for the keys so it picks up the language
     too — but ONLY where it still matches the original word for word. A coach who edited a
     note has authored something, and we do not overwrite that. */
  const DEMO_WAS = {
    'Sample match analysis (demo)': 'film.demo.title',
    'Block the near-side lane; keeper low on the near post': 'film.demo.c1',
    'Left wing left free — the slide from 4 came late.': 'film.demo.n1',
    '4-2 swing finished high far side — textbook.': 'film.demo.n2',
    'Good front on the hole; shot under pressure': 'film.demo.c3',
    'Sprint back — first man must stop the ball carrier': 'film.demo.c4',
    'Trailer arrived unmarked.': 'film.demo.n4',
    'Move the legs earlier — no wrestling at 2 m': 'film.demo.c5',
    'Late slide forced the foul.': 'film.demo.n5',
  };
  function migrateDemo(sessions) {
    let touched = false;
    (sessions || []).forEach(s => {
      if (!s || s.id !== 'demo-match') return;
      if (DEMO_WAS[s.title]) { s.title = DEMO_WAS[s.title]; touched = true; }
      (s.events || []).forEach(e => {
        if (DEMO_WAS[e.counter]) { e.counter = DEMO_WAS[e.counter]; touched = true; }
        if (DEMO_WAS[e.note]) { e.note = DEMO_WAS[e.note]; touched = true; }
      });
    });
    return touched;
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw === null) { const s = seed(); localStorage.setItem(KEY, JSON.stringify({ sessions: s })); return s; }
      const sessions = (JSON.parse(raw) || {}).sessions || [];
      if (migrateDemo(sessions)) save(sessions);
      return sessions;
    } catch (e) { return seed(); }
  }
  function save(sessions) { try { localStorage.setItem(KEY, JSON.stringify({ sessions })); } catch (e) {} }

  /* ---------------- uploaded videos (IndexedDB blobs) ---------------- */
  function idb() {
    return new Promise((res, rej) => {
      if (typeof indexedDB === 'undefined') return rej(new Error('no idb'));
      const rq = indexedDB.open('thplay-film', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('videos');
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  }
  async function putVideo(key, blob) {
    const db = await idb();
    return new Promise((res, rej) => {
      const tx = db.transaction('videos', 'readwrite');
      tx.objectStore('videos').put(blob, key);
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
    });
  }
  async function getVideo(key) {
    const db = await idb();
    return new Promise((res, rej) => {
      const rq = db.transaction('videos').objectStore('videos').get(key);
      rq.onsuccess = () => res(rq.result || null); rq.onerror = () => rej(rq.error);
    });
  }

  /* ---------------- helpers ---------------- */
  /* Translate. Called TX, not T: this file already uses `T` for three different locals
     (the teams block, and the event type in two render loops), and a module-scope `const T`
     next to a function-local one is the exact shape that threw a temporal-dead-zone error
     and blanked a whole view the last time. app.js switchView() re-renders this view on a
     language change, so reading the language at render time is enough. */
  const TX = (k, vars) => (typeof I18N !== 'undefined') ? I18N.t(k, vars) : k;
  const esc = s => (s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = t => { t = Math.max(0, Math.round(t||0)); return Math.floor(t/60) + ':' + String(t%60).padStart(2,'0'); };
  const parseT = s => { const m = String(s||'').trim().match(/^(\d+):(\d{1,2})$/); if (m) return (+m[1])*60 + (+m[2]); const n = parseFloat(s); return isNaN(n) ? 0 : n; };
  function parseSource(input) {
    const s = (input||'').trim();
    let m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/);
    if (m) return { kind: 'youtube', id: m[1] };
    if (/^https?:\/\//.test(s)) return { kind: 'link', url: s };
    return null;
  }

  const TYPES = [
    { id:'goal-for',           label:'film.typeGoalFor',            shot:true,  against:false },
    { id:'goal-against',       label:'film.typeGoalAgainst',        shot:true,  against:true  },
    { id:'shot-for-saved',     label:'film.typeShotForSaved',shot:true,  against:false },
    { id:'shot-against-saved', label:'film.typeShotAgainstSaved',   shot:true,  against:true  },
    { id:'exclusion-for',      label:'film.typeExclusionFor',        shot:false, against:false },
    { id:'exclusion-against',  label:'film.typeExclusionAgainst',   shot:false, against:true  },
    { id:'turnover',           label:'film.typeTurnover',             shot:false, against:false },
    { id:'note',               label:'film.typeNote',                 shot:false, against:false },
  ];
  const typeOf = id => TYPES.find(t=>t.id===id) || TYPES[7];
  /* A situation is STORED on the event as its id ('man-up'), so the id is the data and only
     the label is translated. Falls back to the raw id for anything not in the dictionary. */
  /* A recognised tactic's name is DATA — it is baked into saved play titles and into the
     stored scouting report, so tactics.js keeps it English. Only the on-screen name is
     translated, and it falls back to whatever the analysis produced. */
  /* The demo match ships as translation KEYS so a Swiss junior does not meet the Film Room
     in English. Every other session holds what a real coach actually typed, so this resolves
     a key when it finds one and passes any other text through untouched. Resolved at render,
     not at seed time — seeding the text would freeze whichever language ran first. */
  const dt = v => { const t = String(v == null ? '' : v); if (!t) return t; const x = TX(t); return x === t ? t : x; };
  const tacName = (id, fallback) => { const k = 'tac.' + id, v = TX(k); return v === k ? fallback : v; };
  const sitLabel = x => { if (!x) return ''; const k = 'film.sit.' + x, v = TX(k); return v === k ? x : v; };
  const SITUATIONS = ['6v6','man-up','man-down','penalty','counter','other'];
  const ZONES = ['TL','TC','TR','ML','MC','MR','BL','BC','BR'];
  const ZONE_HINTS = {
    TL:'film.zoneHintTL',
    TC:'film.zoneHintTC',
    TR:'film.zoneHintTR',
    ML:'film.zoneHintML',
    MC:'film.zoneHintMC',
    MR:'film.zoneHintMR',
    BL:'film.zoneHintBL',
    BC:'film.zoneHintBC',
    BR:'film.zoneHintBR',
  };
  const mapToBoard = s => s==='man-up' ? '6v5' : s==='man-down' ? '6v5' : s==='counter' ? '3v2' : s==='penalty' ? 'GK' : '6v6';

  /* ---------------- module state ---------------- */
  let sessions = null, cur = null, ctx = null, root = null;
  let yt = null, ytHostId = 0, fileUrl = null;
  let pickOrigin = null;      // {x,y} being edited
  let pickZone = '';
  // Tier 1 position tracking (per uploaded video)
  let vHomography = null, vCorners = [], vCalibW = 0, vCalibH = 0;

  function currentTime() {
    try { if (yt && yt.getCurrentTime) return yt.getCurrentTime(); } catch (e) {}
    const v = root && root.querySelector('#film-video');
    if (v && !isNaN(v.currentTime)) return v.currentTime;
    return null;
  }
  function seekTo(t) {
    try { if (yt && yt.seekTo) { yt.seekTo(t, true); return; } } catch (e) {}
    const v = root && root.querySelector('#film-video');
    if (v) { try { v.currentTime = t; v.play && v.play().catch(()=>{}); } catch (e) {} }
  }

  function loadYouTube(videoId) {
    const hostId = 'film-yt-' + (++ytHostId);
    const holder = root.querySelector('#film-player');
    holder.innerHTML = `<div class="film-frame"><div id="${hostId}"></div></div>`;
    yt = null;
    const boot = () => {
      try { yt = new window.YT.Player(hostId, { videoId, playerVars: { rel: 0, playsinline: 1 } }); }
      catch (e) { plainIframe(videoId, hostId); }
    };
    if (window.YT && window.YT.Player) { boot(); return; }
    plainIframe(videoId, hostId);   // show something immediately
    if (!window.__ytApiRequested) {
      window.__ytApiRequested = true;
      window.onYouTubeIframeAPIReady = () => { window.__ytApiReady = true; if (cur && cur.source.kind==='youtube') loadYouTube(cur.source.id); };
      const tag = document.createElement('script'); tag.src = 'https://www.youtube.com/iframe_api';
      tag.onerror = () => {};
      document.head.appendChild(tag);
    } else if (window.__ytApiReady) { boot(); }
  }
  function plainIframe(videoId, hostId) {
    const el = root.querySelector('#' + hostId) || root.querySelector('#film-player .film-frame div');
    if (el) el.outerHTML = `<iframe id="${hostId}" src="https://www.youtube.com/embed/${videoId}?enablejsapi=1&rel=0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
  }

  async function loadFile(session) {
    const holder = root.querySelector('#film-player');
    holder.innerHTML = `<div class="film-frame"><video id="film-video" controls playsinline></video></div>`;
    yt = null;
    try {
      const blob = await getVideo('film-' + session.id);
      if (blob) {
        if (fileUrl) URL.revokeObjectURL(fileUrl);
        fileUrl = URL.createObjectURL(blob);
        holder.querySelector('#film-video').src = fileUrl;
        return;
      }
    } catch (e) {}
    holder.innerHTML = `<div class="film-frame film-missing"><p>${TX('film.videoNotStored', { name: esc(session.source.name||'video') })}</p>
      ${ctx.canEdit?`<label class="btn-ghost sm film-reattach">${TX('film.reattachVideo')}<input type="file" accept="video/*" hidden></label>`:''}</div>`;
    const inp = holder.querySelector('input[type=file]');
    if (inp) inp.onchange = async () => { if (inp.files[0]) { await putVideo('film-'+session.id, inp.files[0]).catch(()=>{}); openSession(session.id); } };
  }

  /* ---------------- analysis ---------------- */
  function shotEvents(s, against) { return s.events.filter(e => typeOf(e.type).shot && typeOf(e.type).against===against); }
  function insights(s) {
    const out = [];
    const ga = s.events.filter(e=>e.type==='goal-against');
    if (ga.length) {
      const byZone = {};
      ga.forEach(e => { if (e.zone) byZone[e.zone] = (byZone[e.zone]||0)+1; });
      const top = Object.entries(byZone).sort((a,b)=>b[1]-a[1])[0];
      if (top) out.push(TX('film.insightConcededZone', { n: top[1], total: ga.length, zone: top[0], hint: TX(ZONE_HINTS[top[0]]) }));
      const bySit = {};
      ga.forEach(e => { if (e.situation) bySit[e.situation] = (bySit[e.situation]||0)+1; });
      const topSit = Object.entries(bySit).sort((a,b)=>b[1]-a[1])[0];
      if (topSit && topSit[1] > 1) out.push(TX('film.insightConcededSituation', { n: topSit[1], situation: topSit[0] }));
    }
    const gf = s.events.filter(e=>e.type==='goal-for');
    if (gf.length) {
      const z = {}; gf.forEach(e=>{ if(e.zone) z[e.zone]=(z[e.zone]||0)+1; });
      const top = Object.entries(z).sort((a,b)=>b[1]-a[1])[0];
      if (top) out.push(TX('film.insightGoalsFavour', { zone: top[0], n: top[1], total: gf.length }));
    }
    const counters = s.events.filter(e=>e.verdict==='wrong' && e.counter);
    if (counters.length) out.push(TX('film.correctionList') + counters.map(e=>`<em>${esc(dt(e.counter))}</em>`).slice(0,3).join(' · '));
    if (!out.length) out.push(TX('film.insightsEmpty'));
    return out;
  }

  function goalGrid(s, interactive) {
    const ga = {}, gf = {};
    shotEvents(s, true).forEach(e => { if (e.zone) ga[e.zone]=(ga[e.zone]||0)+(e.type==='goal-against'?1:0); });
    shotEvents(s, false).forEach(e => { if (e.zone) gf[e.zone]=(gf[e.zone]||0)+(e.type==='goal-for'?1:0); });
    return `<div class="goal-grid ${interactive?'pick':''}" id="${interactive?'film-zone-pick':'film-zone-chart'}">
      ${ZONES.map(z=>`<button class="gz ${interactive && pickZone===z?'sel':''}" data-z="${z}" ${interactive?'':'tabindex="-1"'}>
        ${!interactive && (ga[z]||gf[z]) ? `${ga[z]?`<span class="gz-a">${ga[z]}</span>`:''}${gf[z]?`<span class="gz-f">${gf[z]}</span>`:''}` : (interactive?'':'')}
      </button>`).join('')}
    </div>`;
  }

  /* ---------------- motion auto-analysis (uploaded files) ----------------
     Real, offline analysis: sample frames from the video, measure
     inter-frame motion, surface the busy moments + a coarse heatmap.
     Honest scope: this finds ACTIVITY, not players/ball — full CV
     tracking is a cloud milestone. YouTube embeds can't be pixel-read
     (cross-origin), so this is for uploaded files only. */
  function motionScan(frames, opts) {
    opts = opts || {};
    const n = frames.length;
    const len = n && frames[0] ? frames[0].length : 0;
    const heat = new Array(len).fill(0);
    const timeline = []; let prev = null, max = 0;
    for (let i = 0; i < n; i++) {
      const f = frames[i]; let m = 0;
      if (prev && f) { for (let j = 0; j < len; j++) { const d = Math.abs(f[j] - prev[j]); m += d; heat[j] += d; } m = len ? m / len : 0; }
      timeline.push({ i, frac: n > 1 ? i / (n - 1) : 0, motion: m });
      if (m > max) max = m; prev = f;
    }
    timeline.forEach(t => t.norm = max ? t.motion / max : 0);
    const vals = timeline.slice(1).map(t => t.motion);
    const mean = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (vals.length || 1));
    const thr = mean + (opts.k != null ? opts.k : 0.8) * sd;
    const peaks = [];
    for (let i = 1; i < n - 1; i++) {
      const m = timeline[i].motion;
      // a peak must have real motion, clear the threshold, and top its neighbours
      if (max > 0 && m > 0 && m >= thr && m >= timeline[i - 1].motion && m >= timeline[i + 1].motion) peaks.push({ i, frac: timeline[i].frac, motion: m });
    }
    if (!peaks.length && n > 2 && max > 0) {   // give the coach something to jump to — but only if the clip actually moves
      timeline.slice(1).sort((a, b) => b.motion - a.motion).slice(0, 3)
        .forEach(t => peaks.push({ i: t.i, frac: t.frac, motion: t.motion }));
      peaks.sort((a, b) => a.i - b.i);
    }
    return { timeline, peaks, mean, sd, max, heat };
  }
  function seekVideo(video, t) {
    return new Promise(res => {
      let done = false; const fin = () => { if (done) return; done = true; video.removeEventListener('seeked', fin); res(); };
      video.addEventListener('seeked', fin);
      try { video.currentTime = t; } catch (e) { fin(); }
      setTimeout(fin, 1500);   // guard against a 'seeked' that never fires
    });
  }
  async function scanVideo(video, N) {
    N = N || 36; const W = 48, H = 27;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d', { willReadFrequently: true });
    const dur = video.duration;
    if (!dur || !isFinite(dur)) throw new Error('no-duration');
    const times = [], frames = [];
    for (let i = 0; i < N; i++) times.push((i / (N - 1)) * Math.max(0, dur - 0.05));
    for (const t of times) {
      await seekVideo(video, t);
      g.drawImage(video, 0, 0, W, H);
      let img; try { img = g.getImageData(0, 0, W, H); } catch (e) { throw new Error('tainted'); }
      const gray = new Float32Array(W * H);
      for (let p = 0, q = 0; p < img.data.length; p += 4, q++) gray[q] = img.data[p] * 0.3 + img.data[p + 1] * 0.59 + img.data[p + 2] * 0.11;
      frames.push(gray);
    }
    const res = motionScan(frames);
    res.times = times; res.duration = dur; res.W = W; res.H = H;
    return res;
  }
  function renderAuto(res) {
    const out = root && root.querySelector('#film-auto-out'); if (!out) return;
    const bars = res.timeline.map(t =>
      `<span class="fa-bar" style="height:${Math.round(5 + t.norm * 34)}px" title="${fmt(res.times[t.i])} · ${Math.round(t.norm * 100)}%"></span>`).join('');
    const chips = res.peaks.map(p =>
      `<button class="fa-chip" data-fa-t="${res.times[p.i].toFixed(1)}">▶ ${fmt(res.times[p.i])}</button>`).join('');
    out.innerHTML = `<div class="fa-timeline" title="${TX('film.motionAcrossMatch')}">${bars}</div>
      <div class="fa-peaks"><span class="ef-label">${TX('film.busyMoments', { n: res.peaks.length })}</span>
      <div class="fa-chips">${chips}</div></div>`;
    out.querySelectorAll('[data-fa-t]').forEach(b => b.onclick = () => {
      const t = parseFloat(b.dataset.faT);
      const ti = root.querySelector('#film-t'); if (ti) ti.value = fmt(t);
      seekTo(t);
    });
  }
  async function runAutoAnalyse(btn) {
    const v = root && root.querySelector('#film-video');
    const out = root && root.querySelector('#film-auto-out');
    if (!v || !v.src) { ctx.toast(TX('film.reattachFirst')); return; }
    btn.disabled = true; if (out) out.innerHTML = `<div class="muted">${TX('film.scanningMotion')}</div>`;
    try {
      if (v.readyState < 1) await new Promise(r => { v.addEventListener('loadedmetadata', r, { once: true }); setTimeout(r, 4000); });
      const res = await scanVideo(v, 36);
      renderAuto(res);
      ctx.toast(TX('film.foundBusyMoments', { n: res.peaks.length }));
    } catch (e) {
      if (out) out.innerHTML = `<div class="muted">${TX('film.couldntAnalysePixels', { why: /tainted/.test(e.message) ? TX('film.whyTainted') : (/duration/.test(e.message) ? TX('film.whyNoDuration') : '') })}</div>`;
    } finally { btn.disabled = false; }
  }

  /* ---------------- Tier 1 position tracking ----------------
     Calibrate the pool once (4 corners → homography), then read
     cap + ball colours per frame and project them onto the board. */
  /* ---- Auto field: find the pool in the current frame, show the corners, let the coach nudge ---- */
  let vFieldConf = 0, vFieldMode = 'none';
  function setFieldStatus() {
    const c = root && root.querySelector('#field-status'); if (!c) return;
    c.textContent = vHomography ? (vFieldMode === 'auto' ? TX('film.fieldFoundPct', { pct: Math.round(vFieldConf * 100) }) : TX('film.fieldClickedCorners')) : TX('film.fieldNotSet');
    c.className = 'cloud-status ' + (vHomography ? 'cloud' : 'offline');
    const posBtn = root.querySelector('#film-scanpos'); if (posBtn) posBtn.disabled = !vHomography;
  }
  function grabFrame(Wc, Hc) {
    const v = root && root.querySelector('#film-video'); if (!v) return null;
    const cv = document.createElement('canvas'); cv.width = Wc; cv.height = Hc;
    const g = cv.getContext('2d'); if (!g) return null;
    try { g.drawImage(v, 0, 0, Wc, Hc); return g.getImageData(0, 0, Wc, Hc).data; } catch (e) { return null; }
  }
  function autoField() {
    const v = root && root.querySelector('#film-video');
    const out = root && root.querySelector('#film-track-out');
    if (!v || !out) { ctx.toast(TX('film.reattachFirst')); return; }
    if (typeof FIELD === 'undefined') { ctx.toast(TX('film.fieldModuleMissing')); return; }
    const Wc = 320, Hc = 180; vCalibW = Wc; vCalibH = Hc;
    const data = grabFrame(Wc, Hc);
    if (!data) { out.innerHTML = `<div class="muted">${TX('film.couldNotReadFrame')}</div>`; return; }
    const det = FIELD.detect(data, Wc, Hc, { step: 2 });
    if (!det.found) {
      vHomography = null; vFieldMode = 'none'; setFieldStatus();
      out.innerHTML = `<div class="muted">${TX('film.fieldNotFound', { why: esc(det.why || TX('film.noPoolEdges')), pct: Math.round(det.coverage * 100) })}</div>`;
      return;
    }
    vCorners = det.corners.map(c => ({ x: c.x, y: c.y })); vHomography = det.H; vFieldConf = det.confidence; vFieldMode = 'auto';
    setFieldStatus();
    out.innerHTML = `<div class="cal-wrap"><canvas id="cal-canvas" width="${Wc}" height="${Hc}"></canvas>
      <div class="cal-hint" id="cal-hint">${TX('film.fieldFoundHint', { sure: Math.round(det.confidence * 100), water: Math.round(det.coverage * 100) })}</div></div>`;
    const cv = out.querySelector('#cal-canvas'), g = cv.getContext('2d');
    const draw = () => { try { g.drawImage(v, 0, 0, Wc, Hc); g.strokeStyle = '#1fc0d4'; g.lineWidth = 2; g.beginPath(); vCorners.forEach((c, i) => i ? g.lineTo(c.x, c.y) : g.moveTo(c.x, c.y)); g.closePath(); g.stroke(); vCorners.forEach(c => { g.fillStyle = '#1fc0d4'; g.strokeStyle = '#08131b'; g.beginPath(); g.arc(c.x, c.y, 5, 0, 7); g.fill(); g.stroke(); }); } catch (e) {} };
    draw();
    let dragI = -1;
    const toLocal = ev => { const r = cv.getBoundingClientRect(); return { x: (ev.clientX - r.left) * (Wc / r.width), y: (ev.clientY - r.top) * (Hc / r.height) }; };
    cv.onpointerdown = ev => { const p = toLocal(ev); dragI = vCorners.findIndex(c => Math.hypot(c.x - p.x, c.y - p.y) < 14); if (dragI >= 0) cv.setPointerCapture(ev.pointerId); };
    cv.onpointermove = ev => { if (dragI < 0) return; const p = toLocal(ev); vCorners[dragI] = { x: Math.max(0, Math.min(Wc, p.x)), y: Math.max(0, Math.min(Hc, p.y)) }; draw(); };
    cv.onpointerup = () => { if (dragI < 0) return; dragI = -1; vHomography = VISION.solveHomography(vCorners, VISION.boardCorners()); vFieldMode = 'nudged'; setFieldStatus(); const h = out.querySelector('#cal-hint'); if (h) h.innerHTML = TX('film.cornersAdjusted'); };
  }
  function startCalibrate() {
    const v = root && root.querySelector('#film-video');
    const out = root && root.querySelector('#film-track-out');
    if (!v || !out) { ctx.toast(TX('film.reattachFirst')); return; }
    const Wc = 320, Hc = 180; vCalibW = Wc; vCalibH = Hc; vCorners = [];
    out.innerHTML = `<div class="cal-wrap"><canvas id="cal-canvas" width="${Wc}" height="${Hc}"></canvas>
      <div class="cal-hint" id="cal-hint">${TX('film.clickCorner', { n: 1, corner: TX('film.cornerTopLeft') })}</div></div>`;
    const cv = out.querySelector('#cal-canvas');
    const g = cv.getContext('2d');
    try { g.drawImage(v, 0, 0, Wc, Hc); } catch (e) {}
    const labels = [TX('film.cornerTopLeft'), TX('film.cornerTopRight'), TX('film.cornerBottomRight'), TX('film.cornerBottomLeft')];
    cv.onclick = ev => {
      if (vCorners.length >= 4) return;
      const r = cv.getBoundingClientRect();
      const x = r.width ? (ev.clientX - r.left) * (Wc / r.width) : ev.offsetX;
      const y = r.height ? (ev.clientY - r.top) * (Hc / r.height) : ev.offsetY;
      vCorners.push({ x, y });
      try { g.fillStyle = '#1fc0d4'; g.strokeStyle = '#08131b'; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, 4.5, 0, 7); g.fill(); g.stroke(); } catch (e) {}
      const hint = out.querySelector('#cal-hint');
      if (vCorners.length < 4) {
        hint.innerHTML = TX('film.clickCorner', { n: vCorners.length + 1, corner: labels[vCorners.length] });
      } else {
        vHomography = VISION.solveHomography(vCorners, VISION.boardCorners());
        const posBtn = root.querySelector('#film-scanpos');
        vFieldMode = 'manual'; setFieldStatus();
        if (vHomography) { hint.innerHTML = TX('film.calibratedNowPress'); if (posBtn) posBtn.disabled = false; }
        else hint.textContent = TX('film.calibrationFailed');
      }
    };
  }

  function accHeat(frame, heat, gx, gy) {
    const B = VISION.BOARD, cw = (B.x1 - B.x0) / gx, ch = (B.y1 - B.y0) / gy;
    const add = p => { if (!p) return; const cx = Math.floor((p.x - B.x0) / cw), cy = Math.floor((p.y - B.y0) / ch);
      if (cx >= 0 && cx < gx && cy >= 0 && cy < gy) heat[cy * gx + cx]++; };
    Object.values(frame.att).forEach(add); Object.values(frame.def).forEach(add); add(frame.gk);
  }
  // shared scanner: samples the footage and returns a board frame (+ heat/meta).
  // Tier 1 = sparse across the whole clip (last-frame snapshot); Tier 2 = a DENSE
  // short passage from the current time so frame-to-frame tracking is valid.
  async function scanPositions(v, hardened) {
    const Wc = vCalibW || 320, Hc = vCalibH || 180;
    const cv = document.createElement('canvas'); cv.width = Wc; cv.height = Hc;
    const g = cv.getContext('2d', { willReadFrequently: true });
    const dur = v.duration; if (!dur || !isFinite(dur)) throw new Error('no-duration');
    const gx = 16, gy = 13; const heat = new Array(gx * gy).fill(0);
    const winSec = Math.min(2.5, dur);
    const start = hardened ? Math.min(v.currentTime || 0, Math.max(0, dur - winSec)) : 0;
    const span = hardened ? winSec : Math.max(0, dur - 0.05);
    const N = hardened ? 24 : 18;
    const perFrame = []; let last = null;
    for (let i = 0; i < N; i++) {
      await seekVideo(v, start + (i / (N - 1)) * span);
      g.drawImage(v, 0, 0, Wc, Hc);
      let img; try { img = g.getImageData(0, 0, Wc, Hc); } catch (e) { throw new Error('tainted'); }
      // T2b: on-device detection is pluggable — a registered neural model
      // takes over the Hardened path, else the colour engine.
      const det = hardened
        ? (typeof WEBDETECTOR !== 'undefined' ? await WEBDETECTOR.detectByClass(img.data, Wc, Hc) : TRACK.detectCC(img.data, Wc, Hc, { step: 2, minArea: 3 }))
        : VISION.detect(img.data, Wc, Hc, { step: 2 });
      perFrame.push(det);
      accHeat(VISION.toBoardFrame(det, vHomography).frame, heat, gx, gy);
      if (!hardened) last = VISION.toBoardFrame(det, vHomography).frame;
    }
    let seen, meta;
    if (hardened && typeof TRACK !== 'undefined') {
      const con = TRACK.consolidate(perFrame, { minHits: 2, maxAge: 4, gate: Math.max(Wc, Hc) / 8 });
      last = VISION.toBoardFrame(con, vHomography).frame;
      seen = con.white.length + con.dark.length;
      meta = TX('film.tier2Meta', { n: seen, secs: winSec.toFixed(1), time: fmt(start) });
    } else {
      seen = Object.keys(last.att).length + Object.keys(last.def).length;
      meta = TX('film.tier1Meta', { n: seen });
    }
    return { frame: last, heat, gx, gy, meta, start, players: seen };
  }
  function scanErr(e) {
    return /tainted/.test(e.message) ? TX('film.whyTainted')
      : (/duration/.test(e.message) ? TX('film.whyNoDuration') : '');
  }
  async function trackPositions(btn) {
    const v = root && root.querySelector('#film-video');
    const out = root && root.querySelector('#film-track-out');
    if (!vHomography) { ctx.toast(TX('film.calibrateFirst')); return; }
    if (!v || !v.src) { ctx.toast(TX('film.reattachFirst')); return; }
    const hardened = !!(root.querySelector('#film-hardened') && root.querySelector('#film-hardened').checked && typeof TRACK !== 'undefined');
    btn.disabled = true; if (out) out.innerHTML = `<div class="muted">${TX('film.readingPositions')}</div>`;
    try {
      const r = await scanPositions(v, hardened);
      renderTrack(r.frame, r.heat, r.gx, r.gy, r.meta);
      ctx.toast(TX('film.positionsMapped'));
    } catch (e) {
      if (out) out.innerHTML = `<div class="muted">${TX('film.couldntReadPositions', { why: scanErr(e) })}</div>`;
    } finally { btn.disabled = false; }
  }

  /* ---- Tier 3 Phase 0: run analysis (on-device now, cloud later) → review ---- */
  function sitFromFrame(frame) {
    const n = Math.max(Object.keys(frame.att).length, Object.keys(frame.def).length);
    return n >= 6 ? '6v6' : n === 5 ? '6v5' : n === 4 ? '5v4' : n >= 3 ? '4v3' : n === 2 ? '3v2' : '2v1';
  }
  function updateCloudStatus() {
    const chip = root && root.querySelector('#cloud-status'); if (!chip || typeof ANALYSIS === 'undefined') return;
    const st = ANALYSIS.status();
    chip.textContent = st.mode === 'cloud' ? TX('film.cloudChip', { host: st.endpoint.replace(/^https?:\/\//, '').split('/')[0] }) : TX('film.onDeviceOffline');
    chip.className = 'cloud-status ' + st.mode;
  }
  async function runCloudAnalysis(btn) {
    const v = root && root.querySelector('#film-video');
    const out = root && root.querySelector('#cloud-out');
    if (typeof ANALYSIS === 'undefined') return;
    if (!vHomography) { ctx.toast(TX('film.calibrateFirstPos')); return; }
    if (!v || !v.src) { ctx.toast(TX('film.reattachFirst')); return; }
    btn.disabled = true; if (out) out.innerHTML = `<div class="muted">${TX('film.analysing')}</div>`;
    try {
      const startT = v.currentTime || 0;
      const job = { videoRef: cur.id, calibration: { H: vHomography }, fps: 0, meta: { title: cur.title } };
      const endpoint = ANALYSIS.getEndpoint();
      let opts;
      if (endpoint) {
        // cloud: upload the actual video bytes; the backend decodes full-res with ffmpeg.
        // client + server both analyse at 320×180, so the same homography applies.
        opts = { transport: async (jb) => {
          const blob = await getVideo('film-' + cur.id);
          if (!blob) throw new Error('video-missing');
          const url = endpoint.replace(/\/+$/, '') + '/api/analyse';
          const r = await fetch(url, { method: 'POST', headers: {
            'content-type': 'application/octet-stream',
            'x-calibration': JSON.stringify(jb.calibration),
            'x-opts': JSON.stringify({ start: startT, winSec: 2.5 }),
          }, body: blob });
          if (!r.ok) { let m = 'cloud-http-' + r.status; try { const j = await r.json(); if (j && j.error) m = 'cloud-error: ' + j.error; } catch (e) {} throw new Error(m); }
          return r.json();
        } };
      } else {
        // offline: the on-device engine produces a positions Result.
        opts = { local: async () => { const r = await scanPositions(v, true); return ANALYSIS.resultFromBoardFrame(r.frame, startT); } };
      }
      const result = await ANALYSIS.submit(job, opts);
      renderReview(result);
    } catch (e) {
      const msg = /cloud-http|cloud-error|Failed to fetch|NetworkError/.test(e.message)
        ? TX('film.cloudNoResponse')
        : TX('film.couldntAnalyseWhy', { why: scanErr(e) });
      if (out) out.innerHTML = `<div class="muted">${TX('film.analysisFailed', { msg })}</div>`;
    } finally { btn.disabled = false; }
  }
  /* ---- Auto-scout: whole video → possessions → tactics → summary → playbook ---- */
  const scoutBase = () => API.base();   // the club server is always the app's own origin
  function setScoutStatus(txt, cls) { const c = root && root.querySelector('#scout-status'); if (c) { c.textContent = txt; c.className = 'cloud-status ' + (cls || 'offline'); } }
  async function runAutoScout(btn) {
    const out = root && root.querySelector('#scout-out');
    const movingCam = !!((root.querySelector('#film-moving') || {}).checked);
    if (!vHomography && !movingCam) { ctx.toast(TX('film.findFieldFirst')); return; }
    const base = scoutBase(); const us = (root.querySelector('#scout-us') || {}).value || 'white';
    btn.disabled = true; setScoutStatus(TX('film.statusUploading'), 'cloud');
    if (out) out.innerHTML = `<div class="muted">${TX('film.uploadingVideo')}</div>`;
    try {
      const blob = await getVideo('film-' + cur.id); if (!blob) throw new Error('video-missing');
      let health = null; try { health = await (await fetch(base + '/api/health')).json(); } catch (e) { throw new Error('backend-unreachable'); }
      if (health && health.ffmpeg === false) throw new Error('backend-no-ffmpeg');
      const mb = blob.size / 1048576;
      if (health && health.maxUploadMB && mb > health.maxUploadMB) throw new Error(`too-large:${Math.round(mb)}:${health.maxUploadMB}`);
      const videoRef = await uploadWithProgress(base + '/api/upload', blob, pct => { setScoutStatus(TX('film.statusUploadingPct', { pct }), 'cloud'); if (out) out.innerHTML = `<div class="muted">${TX('film.uploadingMb', { mb: Math.round(mb), pct })}</div>`; });
      const job = await fetch(base + '/api/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ videoRef, calibration: { H: vHomography, mode: (root.querySelector('#film-moving') || {}).checked ? 'auto' : 'fixed', minConf: 0.4 }, scout: true, us, opts: { fps: 6, chunkSec: 20 } }) });
      if (!job.ok) throw new Error('job-' + job.status);
      const { id } = await job.json();
      setScoutStatus(TX('film.statusScouting'), 'cloud'); if (out) out.innerHTML = `<div class="muted">${TX('film.scoutingWholeVideo', { id: esc(id) })}</div>`;
      let st = 'queued', tries = 0, j;
      while (st !== 'done' && st !== 'error' && tries++ < 900) { await new Promise(r => setTimeout(r, 2000)); j = await (await fetch(base + '/api/jobs/' + id)).json(); st = j.status; }
      if (st !== 'done') throw new Error(j && j.error ? 'scout-' + j.error : 'timed-out');
      const result = await (await fetch(base + '/api/jobs/' + id + '/result')).json();
      renderScout(result.scout, result);
      setScoutStatus(TX('film.statusDone'), 'cloud'); ctx.toast(TX('film.scoutingReportReady'));
    } catch (e) {
      setScoutStatus(TX('film.statusFailed'), 'offline');
      const m = String(e.message || e); let why;
      if (/^too-large:/.test(m)) { const [, got, max] = m.split(':'); why = TX('film.whyTooLarge', { got, max }); }
      else if (m === 'upload-413') why = TX('film.whyUpload413');
      else if (m === 'backend-unreachable' || /Failed to fetch|NetworkError/.test(m)) why = TX('film.whyBackendUnreachable', { base });
      else if (m === 'upload-network') why = TX('film.whyUploadCut', { base });
      else if (m === 'backend-no-ffmpeg') why = TX('film.whyNoFfmpeg');
      else if (m === 'video-missing') why = TX('film.whyVideoMissing');
      else why = m;
      if (out) out.innerHTML = `<div class="muted">${TX('film.autoScoutFailed', { why: esc(why) })}</div>`;
    } finally { btn.disabled = false; }
  }
  function uploadWithProgress(url, blob, onPct) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest(); xhr.open('POST', url);
      xhr.setRequestHeader('content-type', 'application/octet-stream');
      xhr.upload.onprogress = ev => { if (ev.lengthComputable && onPct) onPct(Math.round(100 * ev.loaded / ev.total)); };
      xhr.onload = () => { if (xhr.status === 200) { try { resolve(JSON.parse(xhr.responseText).videoRef); } catch (e) { reject(new Error('upload-bad-json')); } } else reject(new Error('upload-' + xhr.status)); };
      xhr.onerror = () => reject(new Error('upload-network'));
      xhr.send(blob);
    });
  }
  let lastScout = null;
  function renderScout(sc, result) {
    const out = root && root.querySelector('#scout-out'); if (!out) return;
    lastScout = { sc, result, sessionId: cur && cur.id };
    if (!sc || !sc.possessions) { const fm0 = result && result.meta && result.meta.field; out.innerHTML = `<div class="muted">${TX('film.noPossessions', { readable: fm0 && fm0.mode === 'auto' ? TX('film.fieldReadableIn', { pct: fm0.readPct }) : '', tip: fm0 && fm0.mode === 'auto' && fm0.readPct < 50 ? TX('film.orClickCorners') : '' })}</div>`; return; }
    const fm = result && result.meta && result.meta.field;
    const meta = (result && result.meta ? TX('film.metaSecondsAnalysed', { n: Math.round(result.meta.seconds) }) : '') + (fm && fm.mode === 'auto' ? TX('film.metaFieldTracked', { pct: fm.readPct, unread: fm.unreadSeconds ? TX('film.metaUnreadSeconds', { n: fm.unreadSeconds }) : '' }) : fm && fm.mode === 'fixed' ? TX('film.metaFixedCamera') : '');
    const teamRows = Object.keys(sc.profile || {}).map(k => { const t = sc.profile[k]; return `<div class="scout-team"><strong>${k === 'att' ? TX('film.whiteCaps') : TX('film.blueCaps')}</strong> — ${TX('film.teamRowStats', { poss: t.possessions, rate: Math.round(t.shotRate * 100), passes: t.avgPasses })}
      <div class="scout-tend">${(t.tendencies || []).slice(0, 4).map(x => `<span class="tag">${esc(tacName(x.tactic, x.name))} ${x.pct}%</span>`).join('') || `<span class="muted">${TX('film.noRecognisedTactics')}</span>`}</div></div>`; }).join('');
    out.innerHTML = `<div class="scout-box">
      ${teamAnalysisHtml(sc, result)}
      <details class="scout-more"><summary>${TX('film.goFurther')}</summary>
      <div class="ef-label" style="margin-top:8px">${TX('film.scoutingSummary', { n: sc.possessions, meta })}</div>
      <div class="scout-summary">${(sc.summary || []).map(l => `<div class="ins-row">${esc(l)}</div>`).join('')}</div>
      ${teamRows}
      <div class="ef-label" style="margin-top:10px">${TX('film.recognisedPlays', { n: sc.playbook.length })}</div>
      <div class="scout-plays">${sc.playbook.map((p, i) => `<div class="scout-play"><span class="sp-t">${esc(p.title)}</span><span class="muted">${esc(p.situation)} · ${Math.round(p.confidence * 100)}%${p.needsReview ? TX('film.needsReviewSuffix') : ''}</span><span class="muted">${esc(p.description)}</span></div>`).join('') || `<div class="muted">${TX('film.noPlayReachedBar')}</div>`}</div>
      ${sc.playbook.length ? `<button class="btn-primary sm" id="scout-add">${TX('film.addPlaysToPlaybook', { n: sc.playbook.length })}</button>` : ''}
      <p class="fa-note">${TX('film.playsEditableNote')}</p>
      ${planReportHtml(sc)}
      ${attacksHtml(sc, result)}
      ${ctx.canEdit ? `<div class="scout-share"><button class="btn-primary sm" id="scout-share">${TX('film.shareDebrief')}</button><span class="muted" id="scout-share-status">${TX('film.shareDebriefHint')}</span></div>` : ''}
      </details>
    </div>`;
    wireAttacks(out, sc, result); wireTeamAnalysis(out, sc, result);
    const share = out.querySelector('#scout-share'); if (share) share.onclick = () => shareDebrief(share, sc, result);
    const add = out.querySelector('#scout-add');
    if (add) add.onclick = () => { if (typeof ctx.addPlays === 'function') { const n = ctx.addPlays(sc.playbook, cur.title); ctx.toast(TX('film.playsAdded', { n })); add.disabled = true; } };
  }

  /* ---------- Team analysis by situation — the default view ----------
     "What were the white caps trying to play in 6 on 6? in 6 on 5? Same for the blue caps."
     Driven by who has the ball and where it travels; one card per team × situation. */
  function teamAnalysisHtml(sc, result) {
    const T = sc.teams; if (!T) return '';
    const us = (root.querySelector('#scout-us') || {}).value || 'white';
    const label = k => (k === 'att' ? TX('film.whiteCaps') : TX('film.blueCaps')) + ((k === 'att') === (us === 'white') ? TX('film.labelUs') : TX('film.labelOpponent'));
    const hasVideo = !!(result && result.meta && result.meta.videoRef);
    const heatGrid = heat => { const H = {}; (heat || []).forEach(h => H[h.zone] = h.pct); const cell = (z, name) => `<span class="hz ${H[z] ? 'on' : ''}" style="--p:${(H[z] || 0) / 100}" title="${name}: ${H[z] || 0}%">${H[z] ? H[z] + '%' : ''}</span>`;
      return `<div class="heat" title="${TX('film.whereBallLived')}">${cell('LW', TX('film.zoneLeftWing'))}${cell('LP', TX('film.zoneLeftPost'))}<span class="hz goal">🥅</span>${cell('PT', TX('film.zonePoint'))}${cell('HOLE', '2 m')}<span class="hz goal"></span>${cell('RW', TX('film.zoneRightWing'))}${cell('RP', TX('film.zoneRightPost'))}<span class="hz goal"></span></div>`; };
    const card = (k, sit, b) => `<div class="ta-card">
        <div class="ta-head"><strong>${esc(b.label)}</strong> <span class="muted">${TX('film.taCardStats', { n: b.possessions, shots: b.shots, rate: Math.round(b.shotRate * 100), goals: b.goals, passes: b.avgPasses, dur: b.avgDuration, unread: b.unread ? TX('film.unreadCount', { n: b.unread }) : '' })}</span></div>
        <div class="ta-body">
          <div class="ta-pats">${b.patterns.length ? b.patterns.map(x => `<div class="ta-pat"><span class="tp-name">${esc(x.name)}</span><span class="muted">${TX('film.patShots', { n: x.n, shots: x.shots })}${x.goals ? TX('film.patGoals', { n: x.goals }) : ''}${x.tactic !== 'unclassified' ? ` · ${esc(tacName(x.tactic, x.tacticName))} ${Math.round(x.confidence * 100)}%` : ''}</span>
            <span class="ar-actions">${hasVideo ? `<button class="btn-ghost sm" data-pclip="${x.example.index}">${TX('film.exampleClip')}</button>` : ''}<button class="btn-ghost sm" data-board="${x.example.index}">${TX('film.boardBtn')}</button></span><div class="ar-clip" hidden></div></div>`).join('') : `<div class="muted">${TX('film.noBallPath')}</div>`}</div>
          <div class="ta-side">${heatGrid(b.ballHeat)}${b.tactics.length ? `<div class="scout-tend">${b.tactics.slice(0, 3).map(t => `<span class="tag">${esc(tacName(t.tactic, t.name))} ${t.pct}%</span>`).join('')}</div>` : ''}${sit === '6v5' && b.topFormation && b.topFormation !== 'set' ? `<span class="tag">${TX('film.setUpTag', { formation: esc(b.topFormation) })}</span>` : ''}${b.topDefence ? `<span class="muted">${TX('film.vsDefence', { defence: esc(b.topDefence) })}</span>` : ''}</div>
        </div></div>`;
    const teamBlock = k => { const r = T[k]; if (!r) return '';
      const sits = Object.keys(r.bySituation);
      return `<div class="ta-team ${k}"><h4>${esc(label(k))} <span class="muted">${TX('film.teamHeadStats', { poss: r.possessions, shots: r.shots, goals: r.goals, counters: r.counters ? TX('film.countersSuffix', { n: r.counters }) : '' })}</span></h4>
        ${sits.length ? sits.map(sit => card(k, sit, r.bySituation[sit])).join('') : `<div class="muted">${TX('film.noPossessionsTeam')}</div>`}</div>`; };
    return `<div class="ef-label">${TX('film.whatEachTeam')}</div>
      <div class="scout-summary">${(sc.narrative || []).map(l => `<div class="ins-row">${esc(l)}</div>`).join('')}</div>
      <div class="ta-grid">${teamBlock(us === 'white' ? 'att' : 'def')}${teamBlock(us === 'white' ? 'def' : 'att')}</div>
      <p class="fa-note">${TX('film.possessionNote')}</p>`;
  }
  function wireTeamAnalysis(out, sc, result) {
    out.querySelectorAll('[data-pclip]').forEach(b => b.onclick = async () => {
      const p = sc.plays[+b.dataset.pclip], holder = b.closest('.ta-pat').querySelector('.ar-clip');
      b.disabled = true; holder.hidden = false; holder.innerHTML = `<span class="muted">${TX('film.cuttingTheClip')}</span>`;
      try { const url = await cutClip(result.meta.videoRef, p.tStart, p.tEnd); holder.innerHTML = `<video controls playsinline preload="metadata" src="${esc(scoutBase() + url)}"></video>`; }
      catch (e) { holder.innerHTML = `<span class="muted">${TX('film.clipFailed', { error: esc(e.message) })}</span>`; b.disabled = false; }
    });
  }

  /* ---------- Game plan: what we asked for ---------- */
  function planPanelHtml(s) {
    if (typeof GAMEPLAN === 'undefined') return '';
    const plan = Array.isArray(s.plan) ? s.plan : [];
    const side = sd => GAMEPLAN.INSTRUCTIONS.filter(i => i.side === sd).map(i => `<button class="plan-chip ${plan.includes(i.id) ? 'on' : ''}" data-ins="${i.id}" title="${i.when === 'any' ? TX('film.everyAttackTip') : TX('film.inWhen', { when: i.when })}">${esc(TX(i.label))}</button>`).join('');
    return `<div class="film-auto" id="film-plan">
      <div class="fa-head"><strong>${TX('film.gamePlan')} <span class="fa-beta">${TX('film.gamePlanBadge')}</span></strong>
        <span class="cloud-status cloud" id="plan-count">${plan.length ? `${plan.length > 1 ? TX('film.nInstructions', { n: plan.length }) : TX('film.oneInstruction', { n: plan.length })}` : TX('film.nothingAskedYet')}</span>
        <span class="fa-note">${TX('film.planPanelNote')}</span></div>
      <div class="plan-grid"><div><span class="ef-label">${TX('film.offenseOurAttacks')}</span><div class="plan-chips">${side('offense')}</div></div>
      <div><span class="ef-label">${TX('film.defenseTheirAttacks')}</span><div class="plan-chips">${side('defense')}</div></div></div>
    </div>`;
  }
  function planRows(sc) {
    if (typeof GAMEPLAN === 'undefined' || !cur || !Array.isArray(cur.plan) || !cur.plan.length) return null;
    const us = (root.querySelector('#scout-us') || {}).value || 'white';
    return GAMEPLAN.compliance(cur.plan, sc.plays || [], { us });
  }
  function planTableHtml(rows) {
    const pct = r => r.followedPct == null ? '–' : r.followedPct + '%';
    const sg = b => `${b.shots}/${b.goals}`;
    return `<table class="plan-table"><thead><tr><th>${TX('film.thAsked')}</th><th>${TX('film.thAttacks')}</th><th>${TX('film.thFollowed')}</th><th title="${TX('film.shotsGoals')}">${TX('film.thWhenFollowed')}</th><th title="${TX('film.shotsGoals')}">${TX('film.thWhenNot')}</th><th>${TX('film.thVerdict')}</th></tr></thead><tbody>
      ${rows.map(r => `<tr class="${r.side}"><td>${r.side === 'defense' ? '🛡 ' : '⚔ '}${esc(TX(r.label))}</td><td>${r.attacks}${r.unread ? `<span class="muted"> ${TX('film.unreadParen', { n: r.unread })}</span>` : ''}</td><td><strong>${pct(r)}</strong></td><td>${sg(r.whenFollowed)} <span class="muted">${TX('film.inN', { n: r.whenFollowed.n })}</span></td><td>${sg(r.whenNot)} <span class="muted">${TX('film.inN', { n: r.whenNot.n })}</span></td><td class="muted">${esc(r.verdict)}</td></tr>`).join('')}
    </tbody></table>`;
  }
  function planReportHtml(sc) {
    const rows = planRows(sc);
    if (!rows) return `<div class="ef-label" style="margin-top:12px">${TX('film.planVsReality')}</div><div class="muted">${ctx.canEdit ? TX('film.planEmptyCoach') : TX('film.planEmptyPlayer')}</div>`;
    return `<div class="ef-label" style="margin-top:12px">${TX('film.planVsRealityFull')}</div>${planTableHtml(rows)}<p class="fa-note">${TX('film.planNote')}</p>`;
  }
  /* ---------- every attack: clip + board ---------- */
  const resultOf = p => p.goal ? TX('film.resultGoal') : p.endsInShot ? TX('film.resultShot') : TX('film.resultNoShot');
  function attacksHtml(sc, result) {
    const plays = sc.plays || []; if (!plays.length) return '';
    const us = (root.querySelector('#scout-us') || {}).value || 'white';
    const usSide = typeof GAMEPLAN !== 'undefined' ? GAMEPLAN.usSide(us) : 'att';
    const hasVideo = !!(result && result.meta && result.meta.videoRef);
    return `<div class="ef-label" style="margin-top:12px">${TX('film.everyAttackN', { n: plays.length })}${hasVideo ? '' : ` <span class="muted">${TX('film.clipsNeedFile')}</span>`}</div>
      <div class="attack-list">${plays.map((p, i) => `<div class="attack-row" data-i="${i}">
        <span class="ar-t">${fmt(p.tStart)}–${fmt(p.tEnd)}</span>
        <span class="ar-who ${p.offense === usSide ? 'us' : 'them'}">${p.offense === usSide ? TX('film.us') : TX('film.them')}</span>
        <span class="ar-main"><strong>${esc(p.name)}</strong> <span class="muted">${esc(p.situation)}${p.counter ? ' · ' + TX('film.counter') : ''} · ${Math.round(p.confidence * 100)}% · ${p.passes === 1 ? TX('film.onePass', { n: p.passes }) : TX('film.nPasses', { n: p.passes })}${p.defence ? ' · vs ' + esc(p.defence) : ''}${p.pathName ? ' · ' + esc(p.pathName) : ''}</span></span>
        <span class="ar-res">${resultOf(p)}</span>
        <span class="ar-actions">${hasVideo ? `<button class="btn-ghost sm" data-clip="${i}">${TX('film.clipBtn')}</button>` : ''}<button class="btn-ghost sm" data-board="${i}">${TX('film.boardBtn')}</button></span>
        <div class="ar-clip" hidden></div>
      </div>`).join('')}</div>`;
  }
  async function cutClip(videoRef, t0, t1) {
    const r = await fetch(scoutBase() + '/api/clip', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ videoRef, start: Math.max(0, t0 - 2), end: t1 + 2 }) });
    if (!r.ok) throw new Error('clip-' + r.status);
    return (await r.json()).clipUrl;
  }
  function wireAttacks(out, sc, result) {
    out.querySelectorAll('[data-clip]').forEach(b => b.onclick = async () => {
      const p = sc.plays[+b.dataset.clip], holder = b.closest('.attack-row').querySelector('.ar-clip');
      b.disabled = true; holder.hidden = false; holder.innerHTML = '<span class="muted">Cutting the clip… ⏳</span>';
      try { const url = await cutClip(result.meta.videoRef, p.tStart, p.tEnd); holder.innerHTML = `<video controls playsinline preload="metadata" src="${esc(scoutBase() + url)}"></video>`; }
      catch (e) { holder.innerHTML = `<span class="muted">${TX('film.clipFailed', { error: esc(e.message) })}</span>`; b.disabled = false; }
    });
    out.querySelectorAll('[data-board]').forEach(b => b.onclick = () => {
      const p = sc.plays[+b.dataset.board];
      if (typeof ctx.openPlay === 'function') ctx.openPlay({ title: `${dt(cur.title)} — ${p.name} @ ${fmt(p.tStart)}`, description: (p.steps || []).join(' → '), situation: p.situation, frames: p.frames, notes: p.notes });
    });
  }
  /* ---------- Debriefs: share with the team, comments ---------- */
  // team scope = the user record's teamCode (set at sign-up), same convention as plays + announcements.
  // Users have no .team/.club — reading those put every club's debriefs in one shared 'club' bucket.
  const teamOf = user => (user && user.teamCode) || 'club';
  async function shareDebrief(btn, sc, result) {
    const st = root.querySelector('#scout-share-status'); btn.disabled = true;
    const us = (root.querySelector('#scout-us') || {}).value || 'white', usSide = typeof GAMEPLAN !== 'undefined' ? GAMEPLAN.usSide(us) : 'att';
    const rows = planRows(sc) || [];
    const plays = (sc.plays || []).slice().sort((a, b) => (b.tactic !== 'unclassified') - (a.tactic !== 'unclassified') || (b.endsInShot - a.endsInShot)).slice(0, 12).sort((a, b) => a.tStart - b.tStart);
    const items = [];
    try {
      for (let i = 0; i < plays.length; i++) {
        const p = plays[i]; if (st) st.textContent = ` — ${TX('film.preparingClip', { i: i + 1, n: plays.length })}`;
        let clipUrl = null; if (result && result.meta && result.meta.videoRef) { try { clipUrl = await cutClip(result.meta.videoRef, p.tStart, p.tEnd); } catch (e) {} }
        const asked = rows.filter(r => r.side === (p.offense === usSide ? 'offense' : 'defense')).map(r => TX(r.label)).join(', ');
        const followed = rows.length && typeof GAMEPLAN !== 'undefined' ? (() => { const js = cur.plan.map(id => GAMEPLAN.byId(id)).filter(Boolean).map(ins => GAMEPLAN.judge(ins, p, us)).filter(j => j.applies && j.read); return js.length ? js.some(j => j.followed) : null; })() : null;
        items.push({ t0: p.tStart, t1: p.tEnd, title: `${fmt(p.tStart)} · ${p.offense === usSide ? 'us' : 'them'} · ${p.name}`, note: (p.steps || []).join(' → '), result: resultOf(p), asked, followed, clipUrl, frames: p.frames, notes: p.notes });
      }
      if (st) st.textContent = ' — ' + TX('film.publishing');
      const body = { team: teamOf(ctx.user), title: TX('film.debriefTitle', { title: dt(cur.title) }), matchTitle: dt(cur.title), author: ctx.user && ctx.user.name, us, summary: (sc.narrative || []).concat(sc.summary || []).slice(0, 12), plan: rows, items };
      const r = await fetch(scoutBase() + '/api/debriefs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error('debrief-' + r.status);
      if (st) st.textContent = ' — ' + TX('film.sharedSeeBelow'); ctx.toast(TX('film.debriefShared'));
      await loadDebriefs(); const d = root.querySelector('#film-debriefs'); if (d) d.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { if (st) st.textContent = ` — ${TX('film.shareFailed', { error: e.message })}`; btn.disabled = false; }
  }
  async function loadDebriefs() {
    const list = root && root.querySelector('#debrief-list'); if (!list) return;
    try {
      const r = await fetch(scoutBase() + '/api/debriefs?team=' + encodeURIComponent(teamOf(ctx.user)));
      const { debriefs } = await r.json();
      if (!debriefs.length) { list.innerHTML = `<span class="muted">${TX('film.noDebriefsYet')}` + (ctx.canEdit ? TX('film.scoutThenShare') : '') + '</span>'; return; }
      list.className = 'debrief-list';
      list.innerHTML = debriefs.map(d => `<button class="debrief-item" data-deb="${d.id}"><strong>${esc(d.title)}</strong><span class="muted">${new Date(d.createdAt).toLocaleDateString()} · ${esc(d.author || '')} · ${TX('film.nPlaysComments', { plays: d.items, comments: d.comments })}</span></button>`).join('');
      list.querySelectorAll('[data-deb]').forEach(b => b.onclick = () => openDebrief(b.dataset.deb));
    } catch (e) { list.innerHTML = `<span class="muted">${TX('film.debriefsBackendDown', { url: esc(scoutBase()) })}</span>`; }
  }
  async function openDebrief(id) {
    const box = root && root.querySelector('#debrief-open'); if (!box) return;
    box.innerHTML = `<div class="muted">${TX('film.loading')}</div>`;
    let d; try { d = await (await fetch(scoutBase() + '/api/debriefs/' + id)).json(); } catch (e) { box.innerHTML = `<div class="muted">${TX('film.couldNotLoadDebrief')}</div>`; return; }
    const cmts = itemId => d.comments.filter(c => (c.itemId || null) === (itemId || null));
    const cHtml = itemId => `<div class="deb-comments" data-for="${itemId || ''}">${cmts(itemId).map(c => `<div class="deb-c"><strong>${esc(c.author)}</strong> <span class="muted">${new Date(c.at).toLocaleString()}</span><div>${esc(c.text)}</div></div>`).join('') || `<span class="muted">${TX('film.noCommentsYet')}</span>`}
      <div class="deb-c-new"><input type="text" placeholder="${TX('film.addComment')}" data-cin="${itemId || ''}" /><button class="btn-ghost sm" data-cpost="${itemId || ''}">${TX('film.post')}</button></div></div>`;
    box.innerHTML = `<div class="debrief">
      <div class="deb-head"><h4>${esc(d.title)}</h4><span class="muted">${esc(d.author || '')} · ${new Date(d.createdAt).toLocaleString()}</span><button class="btn-ghost sm" id="deb-close">${TX('film.close')}</button></div>
      ${d.summary.length ? `<div class="scout-summary">${d.summary.map(l => `<div class="ins-row">${esc(l)}</div>`).join('')}</div>` : ''}
      ${d.plan.length ? `<div class="ef-label">${TX('film.planVsReality')}</div>${planTableHtml(d.plan)}` : ''}
      <div class="ef-label">${TX('film.playsN', { n: d.items.length })}</div>
      ${d.items.map((it, i) => `<div class="deb-item" data-item="${it.id}">
        <div class="deb-item-head"><strong>${esc(it.title)}</strong> <span class="ar-res">${esc(it.result)}</span>${it.asked ? `<span class="muted"> ${TX('film.askedFor', { asked: esc(it.asked) })}${it.followed == null ? '' : it.followed ? ` · ${TX('film.followedYes')}` : ` · ${TX('film.followedNo')}`}</span>` : ''}</div>
        ${it.note ? `<div class="muted">${esc(it.note)}</div>` : ''}
        <div class="deb-media">
          ${it.clipUrl ? `<video controls playsinline preload="metadata" src="${esc(scoutBase() + it.clipUrl)}"></video>` : `<span class="muted">${TX('film.noClip')}</span>`}
          ${it.frames && it.frames.length ? `<div class="deb-board"><svg viewBox="0 0 320 262" preserveAspectRatio="xMidYMid meet" data-board-i="${i}"></svg><button class="btn-ghost sm" data-replay="${i}">${TX('film.replayOnBoard')}</button></div>` : ''}
        </div>
        ${cHtml(it.id)}
      </div>`).join('')}
      <div class="ef-label">${TX('film.discussion')}</div>${cHtml(null)}
    </div>`;
    box.querySelector('#deb-close').onclick = () => { box.innerHTML = ''; };
    // board replays
    const players = {};
    box.querySelectorAll('svg[data-board-i]').forEach(svg => {
      try {
        const it = d.items[+svg.dataset.boardI];
        const scn = DATA.newScenario(sitFromFrame(it.frames[0]) || '6v6', 'offense'); scn.frames = it.frames; scn.notes = it.notes || {};
        const pl = new ANIM.Player(new ANIM.Renderer(svg), scn); pl.setPaths(true); pl.seek(0); players[svg.dataset.boardI] = pl;
      } catch (e) {}
    });
    box.querySelectorAll('[data-replay]').forEach(b => b.onclick = () => { const pl = players[b.dataset.replay]; if (pl) { pl.seek(0); pl.play(); } });
    // comments
    box.querySelectorAll('[data-cpost]').forEach(b => b.onclick = async () => {
      const inp = box.querySelector(`input[data-cin="${b.dataset.cpost}"]`); const text = (inp.value || '').trim(); if (!text) return;
      b.disabled = true;
      try {
        const r = await fetch(scoutBase() + '/api/debriefs/' + id + '/comments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ author: ctx.user && ctx.user.name, text, itemId: b.dataset.cpost || null }) });
        if (!r.ok) throw new Error('comment-' + r.status);
        await openDebrief(id); loadDebriefs();
      } catch (e) { ctx.toast(TX('film.commentFailed', { error: e.message })); b.disabled = false; }
    });
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderReview(result) {
    const out = root && root.querySelector('#cloud-out'); if (!out) return;
    const model = ANALYSIS.buildReview(result);
    if (!model.items.length) { out.innerHTML = `<div class="muted">${TX('film.noFormationDetected')}</div>`; return; }
    out.innerHTML = `<div class="ef-label">${TX('film.autoDetected', { engine: esc(model.engine) })}</div>
      <div class="rev-list">${model.items.map(it => `<div class="rev-item" data-id="${it.id}">
        <span class="rev-main"><strong>${esc(it.label)}</strong><span class="muted">${TX('film.confidencePct', { pct: Math.round(it.conf * 100) })}</span></span>
        <span class="rev-actions">
          <button class="btn-primary sm" data-confirm="${it.id}">${TX('film.confirmToPlay')}</button>
          <button class="btn-ghost sm" data-reject="${it.id}">${TX('film.dismiss')}</button>
        </span></div>`).join('')}</div>
      <p class="fa-note">${TX('film.confirmNote')}</p>`;
    out.querySelectorAll('[data-confirm]').forEach(b => b.onclick = () => {
      const it = model.items.find(x => x.id === b.dataset.confirm); if (!it || !it.frame) { ctx.toast(TX('film.nothingToOpen')); return; }
      ANALYSIS.setItemState(model, it.id, 'confirmed');
      ctx.rebuild(sitFromFrame(it.frame), 'offense', `${dt(cur.title)} — ${it.label}`, TX('film.fromVideoAnalysis'), it.frame);
    });
    out.querySelectorAll('[data-reject]').forEach(b => b.onclick = () => {
      ANALYSIS.setItemState(model, b.dataset.reject, 'rejected');
      const row = out.querySelector(`.rev-item[data-id="${b.dataset.reject}"]`); if (row) row.remove();
      if (!out.querySelector('.rev-item')) out.innerHTML = `<div class="muted">${TX('film.allItemsReviewed')}</div>`;
    });
  }
  function renderTrack(frame, heat, gx, gy, meta) {
    const out = root && root.querySelector('#film-track-out'); if (!out) return;
    out.innerHTML = `<div class="track-grid">
      <div class="track-boardcol"><span class="ef-label">${TX('film.detectedPositions')}</span>
        <svg id="film-track-board" viewBox="0 0 320 262" preserveAspectRatio="xMidYMid meet"></svg></div>
      <div class="track-side"><span class="ef-label">${TX('film.readOut')}</span>
        <div class="track-readout">${TX('film.trackReadout', { white: Object.keys(frame.att).length, dark: Object.keys(frame.def).length, gk: frame.gk?'✓':'—', ball: frame.ball && frame.ball.x!=null?'✓':'—' })}<br><span class="muted">${esc(meta||'')}</span></div>
        <button class="btn-primary sm" id="track-save">${TX('film.openAsPlay')}</button>
        <p class="fa-note">${TX('film.trackNote')}</p></div>
    </div>`;
    const svg = out.querySelector('#film-track-board'); const layers = POOL.render(svg);
    // heatmap under the discs
    const B = VISION.BOARD, cw = (B.x1 - B.x0) / gx, ch = (B.y1 - B.y0) / gy;
    const max = Math.max(1, ...heat);
    heat.forEach((n, k) => { if (!n) return; const cx = k % gx, cy = Math.floor(k / gx);
      layers.pathLayer.appendChild(POOL.svg('rect', { x: B.x0 + cx * cw, y: B.y0 + cy * ch, width: cw, height: ch, fill: '#1fc0d4', opacity: 0.06 + 0.32 * (n / max) })); });
    const mk = (team, label, pt, setter) => {
      const grp = POOL.disc(team, label); grp.classList.add('editable');
      grp.setAttribute('transform', `translate(${pt.x},${pt.y})`); layers.discLayer.appendChild(grp);
      dragOn(grp, svg, np => { setter(np); grp.setAttribute('transform', `translate(${np.x},${np.y})`); });
    };
    Object.keys(frame.att).forEach(p => mk('A', p, frame.att[p], np => frame.att[p] = np));
    Object.keys(frame.def).forEach(p => mk('D', p, frame.def[p], np => frame.def[p] = np));
    if (frame.gk) mk('GK', 'GK', frame.gk, np => frame.gk = np);
    const ball = POOL.ball(); ball.classList.add('editable');
    ball.setAttribute('transform', `translate(${frame.ball.x},${frame.ball.y})`); layers.discLayer.appendChild(ball);
    dragOn(ball, svg, np => { frame.ball = { carrier: null, x: np.x, y: np.y }; ball.setAttribute('transform', `translate(${np.x},${np.y})`); });
    out.querySelector('#track-save').onclick = () => {
      const att = Object.keys(frame.att).length, def = Object.keys(frame.def).length, n = Math.max(att, def);
      const sit = n >= 6 ? '6v6' : n === 5 ? '6v5' : n === 4 ? '5v4' : n >= 3 ? '4v3' : n === 2 ? '3v2' : '2v1';
      ctx.rebuild(sit, 'offense', TX('film.trackedPositionsTitle', { title: dt(cur.title) }), TX('film.trackedPositionsDesc'), frame);
    };
  }

  /* ---------------- render ---------------- */
  function render(container, context) {
    ctx = context; root = container;
    if (!sessions) sessions = load();
    if (!cur && sessions.length) cur = sessions[0];
    const canEdit = ctx.canEdit;

    container.innerHTML = `<div class="film-wrap">
      <div class="dash-head with-mascot">${(typeof FX!=='undefined')?FX.mascot(38):''}
        <div><h1>${TX('nav.film')} <button class="help-chip" data-help="film" title="${TX('film.helpTitle')}">？</button></h1>
        <p class="dash-sub">${TX('film.sub')}</p></div></div>

      <div class="film-cols">
        <aside class="film-side">
          <div class="film-side-head"><h3>${TX('film.matches')}</h3></div>
          ${canEdit ? `<div class="film-new">
            <input type="text" id="film-new-title" placeholder="${TX('film.newTitlePlaceholder')}" />
            <input type="text" id="film-new-url" placeholder="${TX('film.newUrlPlaceholder')}" />
            <div class="film-new-row">
              <button class="btn-primary sm" id="film-create">${TX('film.addMatch')}</button>
              <label class="btn-ghost sm">${TX('film.uploadVideo')}<input type="file" id="film-upload" accept="video/*" hidden></label>
            </div>
          </div>` : ''}
          <div class="film-list">
            ${sessions.map(s=>`<button class="film-item ${cur&&cur.id===s.id?'active':''}" data-id="${s.id}">
              <span class="fi-kind">${s.source.kind==='youtube'?'▶':s.source.kind==='file'?'🎞':'🔗'}</span>
              <span class="fi-main"><strong>${esc(dt(s.title))}</strong><span>${TX('film.taggedBy', { n: s.events.length, by: esc(s.createdBy||'') })}</span></span>
            </button>`).join('') || `<div class="muted">${TX('film.noMatches')}</div>`}
          </div>
        </aside>

        <div class="film-main" id="film-main">${cur ? '' : `<div class="muted">${TX('film.addMatchToStart')}</div>`}</div>
      </div>
    </div>`;

    container.querySelectorAll('.film-item').forEach(b => b.onclick = () => openSession(b.dataset.id));
    if (canEdit) {
      const create = container.querySelector('#film-create');
      if (create) create.onclick = () => {
        const title = container.querySelector('#film-new-title').value.trim() || TX('film.untitledMatch');
        const src = parseSource(container.querySelector('#film-new-url').value);
        if (!src) { ctx.toast(TX('film.pasteLink')); return; }
        if (src.kind === 'link') { ctx.toast(TX('film.externalLinkAdded')); }
        const s = { id: uid(), title, createdBy: ctx.user.name, source: src, events: [] };
        sessions.unshift(s); save(sessions); cur = s; render(container, ctx);
      };
      const up = container.querySelector('#film-upload');
      if (up) up.onchange = async () => {
        const f = up.files[0]; if (!f) return;
        const title = container.querySelector('#film-new-title').value.trim() || f.name;
        const s = { id: uid(), title, createdBy: ctx.user.name, source: { kind:'file', name: f.name }, events: [] };
        try { await putVideo('film-' + s.id, f); } catch (e) { ctx.toast(TX('film.videoStoreFailed')); }
        sessions.unshift(s); save(sessions); cur = s; render(container, ctx);
      };
    }
    if (cur) renderSession();
  }

  function openSession(id) { cur = sessions.find(s=>s.id===id) || cur; pickOrigin=null; pickZone=''; vHomography=null; vCorners=[]; render(root, ctx); }

  function renderSession() {
    const s = cur, canEdit = ctx.canEdit;
    const main = root.querySelector('#film-main');
    main.innerHTML = `
      <div id="film-player"></div>
      ${s.source.kind==='link' ? `<p class="muted">${TX('film.externalVideo', { url: esc(s.source.url) })}</p>` : ''}

      ${canEdit ? `<div class="film-tagbar">
        <button class="btn-primary sm" id="film-mark">${TX('film.markMoment')}</button>
        <input type="text" id="film-t" class="film-t" placeholder="m:ss" />
        <select id="film-type" class="focus-select">${TYPES.map(t=>`<option value="${t.id}">${TX(t.label)}</option>`).join('')}</select>
        <select id="film-sit" class="focus-select">${SITUATIONS.map(x=>`<option value="${x}">${sitLabel(x)}</option>`).join('')}</select>
        <select id="film-pos" class="focus-select"><option value="">${TX('film.posPrompt')}</option>${['1','2','3','4','5','6','GK'].map(p=>`<option>${p}</option>`).join('')}</select>
        <span class="verdict-toggle">
          <button class="v-btn v-right" data-v="right">${TX('film.right')}</button>
          <button class="v-btn v-wrong" data-v="wrong">${TX('film.wrong')}</button>
        </span>
      </div>
      <div class="film-tagbar2">
        <div class="film-pick-block"><span class="ef-label">${TX('film.whereShot')}</span>${goalGrid(s, true)}</div>
        <div class="film-pick-block"><span class="ef-label">${TX('film.stageSituation')}</span>
          <svg id="film-board" viewBox="0 0 320 262" preserveAspectRatio="xMidYMid meet"></svg>
          <span class="ef-hint">${TX('film.ballOriginHint')}</span></div>
        <div class="film-pick-block grow">
          <span class="ef-label">${TX('film.counterLabel')}</span>
          <input type="text" id="film-counter" placeholder="${TX('film.counterPlaceholder')}" />
          <input type="text" id="film-note" placeholder="${TX('film.notePlaceholder')}" />
          <button class="btn-primary sm" id="film-add">${TX('film.saveMoment')}</button>
        </div>
      </div>` : ''}

      ${canEdit ? planPanelHtml(s) : ''}

      ${canEdit && s.source.kind==='file' ? `<div class="film-auto" id="film-auto">
        <div class="fa-head"><strong>${TX('film.autoAnalyse')} <span class="fa-beta">beta</span></strong>
          <button class="btn-ghost sm" id="film-scan">${TX('film.scanFootage')}</button>
          <span class="fa-note">${TX('film.autoAnalyseNote')}</span></div>
        <div id="film-auto-out"></div>
      </div>
      <div class="film-auto" id="film-track">
        <div class="fa-head"><strong>${TX('film.positionTracking')} <span class="fa-beta">Tier 1</span></strong>
          <button class="btn-primary sm" id="film-autofield" title="${TX('film.findFieldTitle')}">${TX('film.findField')}</button>
          <button class="btn-ghost sm" id="film-calibrate" title="${TX('film.clickCornersTitle')}">${TX('film.clickCorners')}</button>
          <label class="fa-check" title="${TX('film.movingCameraTitle')}"><input type="checkbox" id="film-moving" checked /> ${TX('film.movingCamera')}</label>
          <span class="cloud-status offline" id="field-status">${TX('film.fieldNotSet')}</span>
          <button class="btn-ghost sm" id="film-scanpos" disabled>${TX('film.trackPositions')}</button>
          <label class="fa-check" title="${TX('film.hardenedTitle')}"><input type="checkbox" id="film-hardened" checked> ${TX('film.hardened')} <span class="fa-beta">Tier&nbsp;2</span></label>
          <span class="cloud-status" id="ondevice-detector">${TX('film.detectorColour')}</span>
          <span class="fa-note">${TX('film.trackingNote')}</span></div>
        <div id="film-track-out"></div>
      </div>
      <div class="film-auto" id="film-scout">
        <div class="fa-head"><strong>${TX('film.autoScout')} <span class="fa-beta">Tier 3</span></strong>
          <button class="btn-primary sm" id="scout-run">${TX('film.scoutVideo')}</button>
          <select id="scout-us" class="focus-select" title="${TX('film.whichCapsTitle')}"><option value="white">${TX('film.weAreWhite')}</option><option value="dark">${TX('film.weAreDark')}</option></select>
          <span class="cloud-status offline" id="scout-status">${TX('film.scoutIdle')}</span>
          <span class="fa-note">${TX('film.autoScoutNote')}</span></div>
        <div id="scout-out"></div>
      </div>
      <div class="film-auto" id="film-cloud">
        <div class="fa-head"><strong>${TX('film.cloudAnalysis')} <span class="fa-beta">Tier 3</span></strong>
          <button class="btn-ghost sm" id="cloud-run">${TX('film.runAnalysis')}</button>
          <span class="cloud-status" id="cloud-status">${TX('film.cloudOnDevice')}</span>
          <span class="fa-note">${TX('film.cloudNote')}</span></div>
        <label class="cloud-cfg"><input type="checkbox" id="cloud-use" /> ${TX('film.useClubServer')}</label>
        <div id="cloud-out"></div>
      </div>` : canEdit ? `<div class="film-auto" id="film-scout">
        <div class="fa-head"><strong>${TX('film.autoScout')} <span class="fa-beta">Tier 3</span></strong>
          <button class="btn-primary sm" id="scout-run" disabled>${TX('film.scoutVideo')}</button>
          <span class="cloud-status offline" id="scout-status">${TX('film.scoutNeedsFile')}</span>
          <span class="fa-note">${TX('film.noVideoFileNote', { src: s.source.kind==='youtube' ? TX('film.srcYoutubeLink') : TX('film.srcExternalLink'), from: s.source.kind==='youtube' ? 'YouTube' : TX('film.cameraPlatform') })}</span></div>
        <div id="scout-out"></div>
      </div>` : ''}

      <div class="film-grid2">
        <div class="film-panel">
          <h3>${TX('film.timeline')} <span class="rightbar-hint">${TX('film.tapToJump')}</span></h3>
          <div class="film-events">${s.events.slice().sort((a,b)=>a.t-b.t).map(e=>{
            const T = typeOf(e.type);
            return `<div class="film-ev ${e.verdict||''}" data-id="${e.id}">
              <button class="fe-t" data-seek="${e.t}">${fmt(e.t)}</button>
              <span class="fe-main"><strong>${TX(T.label)}</strong>
                <span>${esc(sitLabel(e.situation))}${e.pos?` · ${TX('film.posLabel', { n: esc(e.pos) })}`:''}${e.zone?` · ${e.zone}`:''}${e.verdict?` · ${e.verdict==='right'?TX('film.right'):TX('film.wrong')}`:''}</span>
                ${e.counter?`<span class="fe-counter">🎯 ${esc(dt(e.counter))}</span>`:''}
                ${e.note?`<span class="fe-note">${esc(dt(e.note))}</span>`:''}</span>
              <span class="fe-actions">
                ${ctx.canEdit?`<button class="btn-ghost sm" data-rebuild="${e.id}" title="${TX('film.rebuildTitle')}">${TX('film.boardBtn')}</button>`:''}
                ${ctx.canEdit?`<button class="btn-ghost sm danger" data-del="${e.id}">✕</button>`:''}
              </span>
            </div>`;}).join('') || `<div class="muted">${TX('film.noMomentsTagged')}</div>`}
          </div>
        </div>
        <div class="film-panel">
          <h3>${TX('film.shotChart')} <span class="rightbar-hint">${TX('film.shotChartHint')}</span></h3>
          ${goalGrid(s, false)}
          <h3 class="fp-h">${TX('film.shotOrigins')}</h3>
          <svg id="film-origin-pool" viewBox="0 0 320 262" preserveAspectRatio="xMidYMid meet"></svg>
          <h3 class="fp-h">${TX('film.whatVideoSays')}</h3>
          <div class="film-insights">${insights(s).map(i=>`<div class="fi-row">${i}</div>`).join('')}</div>
        </div>
      </div>

      <div class="film-panel" id="film-debriefs">
        <h3>${TX('film.teamDebriefs')} <span class="rightbar-hint">${TX('film.debriefHint')}</span></h3>
        <div id="debrief-list" class="muted">${TX('film.loadingDebriefs')}</div>
        <div id="debrief-open"></div>
      </div>`;

    // video
    if (s.source.kind === 'youtube') loadYouTube(s.source.id);
    else if (s.source.kind === 'file') loadFile(s);
    else root.querySelector('#film-player').innerHTML = '';

    // origin chart (read-only dots)
    try {
      const chart = main.querySelector('#film-origin-pool');
      const layers = POOL.render(chart);
      s.events.filter(e=>e.origin).forEach(e => {
        const col = e.type==='goal-against' ? '#ff5b5b' : e.type==='goal-for' ? '#2bd07a' : '#cfd8e0';
        layers.pathLayer.appendChild(POOL.svg('circle', { cx:e.origin.x, cy:e.origin.y, r:4, fill:col, stroke:'#08131b', 'stroke-width':1, opacity:0.92 }));
      });
    } catch (e) {}

    if (canEdit) wireTagging(main, s);

    const scanBtn = main.querySelector('#film-scan');
    if (scanBtn) scanBtn.onclick = () => runAutoAnalyse(scanBtn);
    const calBtn = main.querySelector('#film-calibrate');
    if (calBtn) calBtn.onclick = () => startCalibrate();
    const afBtn = main.querySelector('#film-autofield');
    if (afBtn) afBtn.onclick = () => autoField();
    setFieldStatus();
    const odChip = main.querySelector('#ondevice-detector');
    if (odChip && typeof WEBDETECTOR !== 'undefined') { const st = WEBDETECTOR.status(); odChip.textContent = st.hasModel ? TX('film.detectorModel', { name: st.name }) : '● colour'; odChip.className = 'cloud-status ' + (st.hasModel ? 'cloud' : 'offline'); }
    const posBtn = main.querySelector('#film-scanpos');
    if (posBtn) { posBtn.disabled = !vHomography; posBtn.onclick = () => trackPositions(posBtn); }
    const scoutBtn = main.querySelector('#scout-run');
    if (scoutBtn) scoutBtn.onclick = () => runAutoScout(scoutBtn);
    main.querySelectorAll('#film-plan .plan-chip').forEach(b => b.onclick = () => {
      s.plan = Array.isArray(s.plan) ? s.plan : [];
      const i = s.plan.indexOf(b.dataset.ins); if (i >= 0) s.plan.splice(i, 1); else s.plan.push(b.dataset.ins);
      b.classList.toggle('on', i < 0); save(sessions);
      const c = main.querySelector('#plan-count'); if (c) c.textContent = s.plan.length ? TX('film.planInstructions', { n: s.plan.length }) : TX('film.nothingAskedYet');
      if (lastScout && lastScout.sessionId === s.id) renderScout(lastScout.sc, lastScout.result);
    });
    loadDebriefs();
    if (main.querySelector('#film-cloud') && typeof ANALYSIS !== 'undefined') {
      const use = main.querySelector('#cloud-use'); if (use) use.checked = ANALYSIS.usesCloud();
      updateCloudStatus();
      if (use) use.onchange = () => { ANALYSIS.setCloud(use.checked); updateCloudStatus(); ctx.toast(use.checked ? TX('film.usingClubServer') : TX('film.usingOnDevice')); };
      const runBtn = main.querySelector('#cloud-run');
      if (runBtn) runBtn.onclick = () => runCloudAnalysis(runBtn);
    }

    main.querySelectorAll('[data-seek]').forEach(b => b.onclick = () => seekTo(parseFloat(b.dataset.seek)));
    main.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      s.events = s.events.filter(e=>e.id!==b.dataset.del); save(sessions); renderSession();
    });
    main.querySelectorAll('[data-rebuild]').forEach(b => b.onclick = () => {
      const e = s.events.find(x=>x.id===b.dataset.rebuild); if (!e) return;
      const T = typeOf(e.type);
      const phase = T.against ? 'defense' : 'offense';
      const title = `${dt(s.title)} ${fmt(e.t)} — ${T.label.replace(/^[^\s]+\s/,'')}`;
      const desc = [dt(e.note), e.counter && TX('film.fixNote', { text: dt(e.counter) })].filter(Boolean).join(' · ') || TX('film.rebuiltFromVideo');
      ctx.rebuild(mapToBoard(e.situation), phase, title, desc, e.frame || null);
    });
  }

  let verdict = null, boardFrame = null;
  function dragOn(el, svgEl, onMove, anywhere) {
    let live = false;
    const clampFn = anywhere ? POOL.clampAnywhere : POOL.clampToWater;
    const move = ev => { if (!live) return; const p = clampFn(POOL.eventToVB(svgEl, ev)); onMove({ x:+p.x.toFixed(1), y:+p.y.toFixed(1) }); };
    const up = () => { live = false; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    el.addEventListener('pointerdown', ev => { live = true; ev.preventDefault(); ev.stopPropagation(); window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); });
    el.style.cursor = 'grab';
  }
  // stage the situation: a small board with draggable players + ball
  function buildBoard(main, sit) {
    const svg = main.querySelector('#film-board'); if (!svg) return;
    boardFrame = DATA.defaultFrame(mapToBoard(sit));
    const bp = ANIM.ballPoint(boardFrame);
    boardFrame.ball = { carrier: null, x: bp.x, y: bp.y };
    const layers = POOL.render(svg);
    const mk = (team, label, pt, setter) => {
      const g = POOL.disc(team, label);
      g.classList.add('editable');
      g.setAttribute('transform', `translate(${pt.x},${pt.y})`);
      layers.discLayer.appendChild(g);
      dragOn(g, svg, np => { setter(np); g.setAttribute('transform', `translate(${np.x},${np.y})`); });
    };
    Object.keys(boardFrame.att).forEach(pn => mk('A', pn, boardFrame.att[pn], np => boardFrame.att[pn] = np));
    Object.keys(boardFrame.def).forEach(pn => mk('D', pn, boardFrame.def[pn], np => boardFrame.def[pn] = np));
    if (boardFrame.gk) mk('GK', 'GK', boardFrame.gk, np => boardFrame.gk = np);
    const ball = POOL.ball(); ball.classList.add('editable');
    ball.setAttribute('transform', `translate(${boardFrame.ball.x},${boardFrame.ball.y})`);
    layers.discLayer.appendChild(ball);
    dragOn(ball, svg, np => { boardFrame.ball = { carrier:null, x:np.x, y:np.y }; ball.setAttribute('transform', `translate(${np.x},${np.y})`); });
  }

  function wireTagging(main, s) {
    verdict = null; pickZone = ''; pickOrigin = null;
    main.querySelector('#film-mark').onclick = () => {
      const t = currentTime();
      if (t == null) { ctx.toast(TX('film.typeTime')); return; }
      main.querySelector('#film-t').value = fmt(t);
    };
    main.querySelectorAll('.v-btn').forEach(b => b.onclick = () => {
      verdict = (verdict === b.dataset.v) ? null : b.dataset.v;
      main.querySelectorAll('.v-btn').forEach(x=>x.classList.toggle('sel', x.dataset.v===verdict));
    });
    main.querySelectorAll('#film-zone-pick .gz').forEach(b => b.onclick = () => {
      pickZone = (pickZone === b.dataset.z) ? '' : b.dataset.z;
      main.querySelectorAll('#film-zone-pick .gz').forEach(x=>x.classList.toggle('sel', x.dataset.z===pickZone));
    });
    // situation board: draggable players + ball, follows the situation select
    try {
      buildBoard(main, main.querySelector('#film-sit').value);
      main.querySelector('#film-sit').addEventListener('change', () =>
        buildBoard(main, main.querySelector('#film-sit').value));
    } catch (e) {}

    main.querySelector('#film-add').onclick = () => {
      const t = parseT(main.querySelector('#film-t').value);
      const type = main.querySelector('#film-type').value;
      if (!main.querySelector('#film-t').value.trim()) { ctx.toast(TX('film.setTimeFirst')); return; }
      s.events.push({
        id: uid(), t, type,
        situation: main.querySelector('#film-sit').value,
        pos: main.querySelector('#film-pos').value,
        zone: typeOf(type).shot ? pickZone : '',
        origin: (typeOf(type).shot && boardFrame) ? { x: boardFrame.ball.x, y: boardFrame.ball.y } : null,
        frame: boardFrame ? JSON.parse(JSON.stringify(boardFrame)) : null,
        verdict, counter: main.querySelector('#film-counter').value.trim(),
        note: main.querySelector('#film-note').value.trim(),
      });
      save(sessions);
      if (typeof DATA !== 'undefined') DATA.logActivity('play', `${ctx.user.name} tagged ${typeOf(type).label} at ${fmt(t)} in “${dt(s.title)}”`, ctx.user.name);
      renderSession();
      ctx.toast(TX('film.momentSaved'));
    };
  }

  return { render, load, parseSource, ZONE_HINTS, _insights: insights, motionScan, teamOf };
})();
