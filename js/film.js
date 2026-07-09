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
      id: 'demo-match', title: 'Sample match analysis (demo)', createdBy: 'Coach Ruiz',
      source: { kind: 'youtube', id: 'tQ2Qh7yFTyA' },
      events: [
        { id: uid(), t: 95,  type: 'goal-against', situation: 'man-down', pos: '5', zone: 'BL',
          origin: { x: 250, y: 150 }, verdict: 'wrong', counter: 'Block the near-side lane; keeper low on the near post',
          note: 'Left wing left free — the slide from 4 came late.' },
        { id: uid(), t: 152, type: 'goal-for', situation: 'man-up', pos: '2', zone: 'TR',
          origin: { x: 238, y: 84 }, verdict: 'right', counter: '',
          note: '4-2 swing finished high far side — textbook.' },
        { id: uid(), t: 241, type: 'shot-against-saved', situation: '6v6', pos: '6', zone: 'MC',
          origin: { x: 232, y: 110 }, verdict: 'right', counter: 'Good front on the hole; shot under pressure',
          note: '' },
        { id: uid(), t: 312, type: 'goal-against', situation: 'counter', pos: '3', zone: 'BL',
          origin: { x: 262, y: 132 }, verdict: 'wrong', counter: 'Sprint back — first man must stop the ball carrier',
          note: 'Trailer arrived unmarked.' },
        { id: uid(), t: 388, type: 'exclusion-against', situation: '6v6', pos: '4', zone: '',
          origin: null, verdict: 'wrong', counter: 'Move the legs earlier — no wrestling at 2 m',
          note: 'Late slide forced the foul.' },
      ],
    }];
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw === null) { const s = seed(); localStorage.setItem(KEY, JSON.stringify({ sessions: s })); return s; }
      return (JSON.parse(raw) || {}).sessions || [];
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
    { id:'goal-for',           label:'⚽ Goal — us',            shot:true,  against:false },
    { id:'goal-against',       label:'🥅 Goal conceded',        shot:true,  against:true  },
    { id:'shot-for-saved',     label:'🧤 Our shot saved/missed',shot:true,  against:false },
    { id:'shot-against-saved', label:'🛡️ Their shot stopped',   shot:true,  against:true  },
    { id:'exclusion-for',      label:'💪 Exclusion won',        shot:false, against:false },
    { id:'exclusion-against',  label:'⚠️ Exclusion conceded',   shot:false, against:true  },
    { id:'turnover',           label:'🔁 Turnover',             shot:false, against:false },
    { id:'note',               label:'📝 Note',                 shot:false, against:false },
  ];
  const typeOf = id => TYPES.find(t=>t.id===id) || TYPES[7];
  const SITUATIONS = ['6v6','man-up','man-down','penalty','counter','other'];
  const ZONES = ['TL','TC','TR','ML','MC','MR','BL','BC','BR'];
  const ZONE_HINTS = {
    TL:'High near-side: press the shooter earlier; keeper owns the short high lane.',
    TC:'High centre: a hand must be in the lane — keeper stays tall, no early sink.',
    TR:'High far-side: the wing closes the angle; keeper shades the far post.',
    ML:'Mid near: win the shoulder position before the catch, not after.',
    MC:'Through the middle: front the centre — no free catch at 2 m.',
    MR:'Mid far: earlier weak-side slide; the skip lane stays closed.',
    BL:'Low near: block DOWN with the inside hand; keeper low on the near post.',
    BC:'Low centre: legs! Keeper holds ground; defender pressures the release.',
    BR:'Low far: deny the cross-cage angle — earlier drop from position 4.',
  };
  const mapToBoard = s => s==='man-up' ? '6v5' : s==='man-down' ? '6v5' : s==='counter' ? '3v2' : s==='penalty' ? 'GK' : '6v6';

  /* ---------------- module state ---------------- */
  let sessions = null, cur = null, ctx = null, root = null;
  let yt = null, ytHostId = 0, fileUrl = null;
  let pickOrigin = null;      // {x,y} being edited
  let pickZone = '';

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
    holder.innerHTML = `<div class="film-frame film-missing"><p>🎞 “${esc(session.source.name||'video')}” isn’t stored on this device.<br>Re-attach the file to keep analysing.</p>
      ${ctx.canEdit?'<label class="btn-ghost sm film-reattach">Re-attach video<input type="file" accept="video/*" hidden></label>':''}</div>`;
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
      if (top) out.push(`🥅 <strong>${top[1]} of ${ga.length}</strong> conceded goals went <strong>${top[0]}</strong> — ${ZONE_HINTS[top[0]]}`);
      const bySit = {};
      ga.forEach(e => { if (e.situation) bySit[e.situation] = (bySit[e.situation]||0)+1; });
      const topSit = Object.entries(bySit).sort((a,b)=>b[1]-a[1])[0];
      if (topSit && topSit[1] > 1) out.push(`📊 <strong>${topSit[1]}</strong> conceded in <strong>${topSit[0]}</strong> situations — that phase is this week’s training block.`);
    }
    const gf = s.events.filter(e=>e.type==='goal-for');
    if (gf.length) {
      const z = {}; gf.forEach(e=>{ if(e.zone) z[e.zone]=(z[e.zone]||0)+1; });
      const top = Object.entries(z).sort((a,b)=>b[1]-a[1])[0];
      if (top) out.push(`⚽ Our goals favour <strong>${top[0]}</strong> (${top[1]}/${gf.length}) — keep feeding that finish, but build a second option.`);
    }
    const counters = s.events.filter(e=>e.verdict==='wrong' && e.counter);
    if (counters.length) out.push(`🎯 Correction list from the video: ` + counters.map(e=>`<em>${esc(e.counter)}</em>`).slice(0,3).join(' · '));
    if (!out.length) out.push('Tag a few moments (goals, shots, exclusions) and the analysis appears here.');
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
    out.innerHTML = `<div class="fa-timeline" title="Motion across the match">${bars}</div>
      <div class="fa-peaks"><span class="ef-label">Busy moments (${res.peaks.length}) — tap to jump &amp; pre-fill the timestamp</span>
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
    if (!v || !v.src) { ctx.toast('Re-attach the uploaded video first'); return; }
    btn.disabled = true; if (out) out.innerHTML = '<div class="muted">Scanning the footage for motion… ⏳</div>';
    try {
      if (v.readyState < 1) await new Promise(r => { v.addEventListener('loadedmetadata', r, { once: true }); setTimeout(r, 4000); });
      const res = await scanVideo(v, 36);
      renderAuto(res);
      ctx.toast(`Found ${res.peaks.length} busy moment${res.peaks.length !== 1 ? 's' : ''}`);
    } catch (e) {
      if (out) out.innerHTML = `<div class="muted">Couldn’t analyse the pixels${/tainted/.test(e.message) ? ' — a cross-origin (YouTube) video can’t be scanned; use an uploaded file' : (/duration/.test(e.message) ? ' — the video didn’t report a duration yet, try again in a second' : '')}.</div>`;
    } finally { btn.disabled = false; }
  }

  /* ---------------- render ---------------- */
  function render(container, context) {
    ctx = context; root = container;
    if (!sessions) sessions = load();
    if (!cur && sessions.length) cur = sessions[0];
    const canEdit = ctx.canEdit;

    container.innerHTML = `<div class="film-wrap">
      <div class="dash-head with-mascot">${(typeof FX!=='undefined')?FX.mascot(38):''}
        <div><h1>Film Room <button class="help-chip" data-help="film" title="How the Film Room works">？</button></h1>
        <p class="dash-sub">Watch the match, tag the moments, see what was right and wrong — then rebuild it on the board.</p></div></div>

      <div class="film-cols">
        <aside class="film-side">
          <div class="film-side-head"><h3>Matches</h3></div>
          ${canEdit ? `<div class="film-new">
            <input type="text" id="film-new-title" placeholder="Match title (e.g. vs Red Sharks)" />
            <input type="text" id="film-new-url" placeholder="YouTube link (or leave empty for upload)" />
            <div class="film-new-row">
              <button class="btn-primary sm" id="film-create">Add match</button>
              <label class="btn-ghost sm">Upload video<input type="file" id="film-upload" accept="video/*" hidden></label>
            </div>
          </div>` : ''}
          <div class="film-list">
            ${sessions.map(s=>`<button class="film-item ${cur&&cur.id===s.id?'active':''}" data-id="${s.id}">
              <span class="fi-kind">${s.source.kind==='youtube'?'▶':s.source.kind==='file'?'🎞':'🔗'}</span>
              <span class="fi-main"><strong>${esc(s.title)}</strong><span>${s.events.length} tagged · ${esc(s.createdBy||'')}</span></span>
            </button>`).join('') || '<div class="muted">No matches yet.</div>'}
          </div>
        </aside>

        <div class="film-main" id="film-main">${cur ? '' : '<div class="muted">Add a match to start analysing.</div>'}</div>
      </div>
    </div>`;

    container.querySelectorAll('.film-item').forEach(b => b.onclick = () => openSession(b.dataset.id));
    if (canEdit) {
      const create = container.querySelector('#film-create');
      if (create) create.onclick = () => {
        const title = container.querySelector('#film-new-title').value.trim() || 'Untitled match';
        const src = parseSource(container.querySelector('#film-new-url').value);
        if (!src) { ctx.toast('Paste a YouTube link, or use Upload'); return; }
        if (src.kind === 'link') { ctx.toast('Only YouTube links can be embedded — added as external link'); }
        const s = { id: uid(), title, createdBy: ctx.user.name, source: src, events: [] };
        sessions.unshift(s); save(sessions); cur = s; render(container, ctx);
      };
      const up = container.querySelector('#film-upload');
      if (up) up.onchange = async () => {
        const f = up.files[0]; if (!f) return;
        const title = container.querySelector('#film-new-title').value.trim() || f.name;
        const s = { id: uid(), title, createdBy: ctx.user.name, source: { kind:'file', name: f.name }, events: [] };
        try { await putVideo('film-' + s.id, f); } catch (e) { ctx.toast('Could not store the video on this device'); }
        sessions.unshift(s); save(sessions); cur = s; render(container, ctx);
      };
    }
    if (cur) renderSession();
  }

  function openSession(id) { cur = sessions.find(s=>s.id===id) || cur; pickOrigin=null; pickZone=''; render(root, ctx); }

  function renderSession() {
    const s = cur, canEdit = ctx.canEdit;
    const main = root.querySelector('#film-main');
    main.innerHTML = `
      <div id="film-player"></div>
      ${s.source.kind==='link' ? `<p class="muted">External video: <a href="${esc(s.source.url)}" target="_blank" rel="noopener">${esc(s.source.url)}</a> (open alongside and tag by time)</p>` : ''}

      ${canEdit ? `<div class="film-tagbar">
        <button class="btn-primary sm" id="film-mark">⏱ Mark moment</button>
        <input type="text" id="film-t" class="film-t" placeholder="m:ss" />
        <select id="film-type" class="focus-select">${TYPES.map(t=>`<option value="${t.id}">${t.label}</option>`).join('')}</select>
        <select id="film-sit" class="focus-select">${SITUATIONS.map(x=>`<option>${x}</option>`).join('')}</select>
        <select id="film-pos" class="focus-select"><option value="">pos?</option>${['1','2','3','4','5','6','GK'].map(p=>`<option>${p}</option>`).join('')}</select>
        <span class="verdict-toggle">
          <button class="v-btn v-right" data-v="right">✔ right</button>
          <button class="v-btn v-wrong" data-v="wrong">✘ wrong</button>
        </span>
      </div>
      <div class="film-tagbar2">
        <div class="film-pick-block"><span class="ef-label">Where did the shot go?</span>${goalGrid(s, true)}</div>
        <div class="film-pick-block"><span class="ef-label">Stage the situation — drag players &amp; ball to match the video</span>
          <svg id="film-board" viewBox="0 0 320 262" preserveAspectRatio="xMidYMid meet"></svg>
          <span class="ef-hint">The ball’s position = shot origin. Saved with the moment; “Board ⚡” opens it in the editor.</span></div>
        <div class="film-pick-block grow">
          <span class="ef-label">What would have stopped it / note</span>
          <input type="text" id="film-counter" placeholder="Counter-measure (e.g. front the hole, earlier slide from 4…)" />
          <input type="text" id="film-note" placeholder="Note" />
          <button class="btn-primary sm" id="film-add">Save moment</button>
        </div>
      </div>` : ''}

      ${canEdit && s.source.kind==='file' ? `<div class="film-auto" id="film-auto">
        <div class="fa-head"><strong>🔎 Auto-analyse <span class="fa-beta">beta</span></strong>
          <button class="btn-ghost sm" id="film-scan">Scan the footage</button>
          <span class="fa-note">Reads the uploaded video and finds the busy moments by motion, so you can jump straight to them. (Full player &amp; ball tracking is a cloud feature.)</span></div>
        <div id="film-auto-out"></div>
      </div>` : ''}

      <div class="film-grid2">
        <div class="film-panel">
          <h3>Timeline <span class="rightbar-hint">(tap to jump)</span></h3>
          <div class="film-events">${s.events.slice().sort((a,b)=>a.t-b.t).map(e=>{
            const T = typeOf(e.type);
            return `<div class="film-ev ${e.verdict||''}" data-id="${e.id}">
              <button class="fe-t" data-seek="${e.t}">${fmt(e.t)}</button>
              <span class="fe-main"><strong>${T.label}</strong>
                <span>${esc(e.situation||'')}${e.pos?` · pos ${esc(e.pos)}`:''}${e.zone?` · ${e.zone}`:''}${e.verdict?` · ${e.verdict==='right'?'✔ right':'✘ wrong'}`:''}</span>
                ${e.counter?`<span class="fe-counter">🎯 ${esc(e.counter)}</span>`:''}
                ${e.note?`<span class="fe-note">${esc(e.note)}</span>`:''}</span>
              <span class="fe-actions">
                ${ctx.canEdit?`<button class="btn-ghost sm" data-rebuild="${e.id}" title="Recreate this situation on the tactics board">Board ⚡</button>`:''}
                ${ctx.canEdit?`<button class="btn-ghost sm danger" data-del="${e.id}">✕</button>`:''}
              </span>
            </div>`;}).join('') || '<div class="muted">No moments tagged yet.</div>'}
          </div>
        </div>
        <div class="film-panel">
          <h3>Shot chart <span class="rightbar-hint">red = conceded · green = ours</span></h3>
          ${goalGrid(s, false)}
          <h3 class="fp-h">Shot origins</h3>
          <svg id="film-origin-pool" viewBox="0 0 320 262" preserveAspectRatio="xMidYMid meet"></svg>
          <h3 class="fp-h">What the video says</h3>
          <div class="film-insights">${insights(s).map(i=>`<div class="fi-row">${i}</div>`).join('')}</div>
        </div>
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

    main.querySelectorAll('[data-seek]').forEach(b => b.onclick = () => seekTo(parseFloat(b.dataset.seek)));
    main.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      s.events = s.events.filter(e=>e.id!==b.dataset.del); save(sessions); renderSession();
    });
    main.querySelectorAll('[data-rebuild]').forEach(b => b.onclick = () => {
      const e = s.events.find(x=>x.id===b.dataset.rebuild); if (!e) return;
      const T = typeOf(e.type);
      const phase = T.against ? 'defense' : 'offense';
      const title = `${s.title} ${fmt(e.t)} — ${T.label.replace(/^[^\s]+\s/,'')}`;
      const desc = [e.note, e.counter && ('Fix: ' + e.counter)].filter(Boolean).join(' · ') || 'Rebuilt from video analysis.';
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
      if (t == null) { ctx.toast('Type the time as m:ss (video not seekable here)'); return; }
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
      if (!main.querySelector('#film-t').value.trim()) { ctx.toast('Set the time first (⏱ Mark moment)'); return; }
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
      if (typeof DATA !== 'undefined') DATA.logActivity('play', `${ctx.user.name} tagged ${typeOf(type).label} at ${fmt(t)} in “${s.title}”`, ctx.user.name);
      renderSession();
      ctx.toast('Moment saved to the timeline');
    };
  }

  return { render, load, parseSource, ZONE_HINTS, _insights: insights, motionScan };
})();
