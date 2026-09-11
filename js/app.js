/* ============================================================
   app.js — auth + approvals + roles, nav/views, dashboards,
   trivia, super-admin console, playbook viewer & coach editor.
   ============================================================ */
(() => {
  const $ = (id) => document.getElementById(id);
  const SESSION_KEY = 'thplay.session.v1';
  const EDIT_ROLES = ['coach','trainer','super-admin'];

  const state = {
    user: null,
    scenarios: [],
    situation: '6v6',
    phase: 'offense',
    selectedId: null,
    viewer: null,
    renderer: null,
    viewMode: 'team',
    focus: null,
    mode: 'solution',   // 'problem' | 'solution'
    view: 'dashboard',
    setup: { role: 'player', position: null },
  };
  const canEdit = () => state.user && EDIT_ROLES.includes(state.user.role);

  /* ---------------- screens / toast ---------------- */
  function show(screenId) {
    ['auth-screen','setup-screen','pending-screen','denied-screen','app-screen']
      .forEach(s => $(s).classList.toggle('active', s===screenId));
  }
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.hidden = false; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.hidden=true,250); }, 2000);
  }
  function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  /* ---------------- auth (simulated Apple / Google) ---------------- */
  const MOCK = {
    apple:  { name: 'Alex Marsh', email: 'alex@icloud.com', provider: 'Apple'  },
    google: { name: 'Sam Rivera', email: 'sam@gmail.com',   provider: 'Google' },
  };
  function simulateSignIn(which, btn) {
    btn.classList.add('loading');
    btn.querySelector('span').textContent = 'Signing in…';
    setTimeout(() => {
      btn.classList.remove('loading');
      btn.querySelector('span').textContent = which==='apple' ? 'Sign in with Apple' : 'Sign in with Google';
      const idn = MOCK[which];
      const existing = DATA.findUserByEmail(idn.email);
      if (existing && existing.role) routeUser(existing);
      else openSetup(idn);
    }, 650);
  }
  // one-tap demo personas — pre-approved, no OAuth delay, no approval gate
  const DEMO_USERS = {
    'coach':       { id:'demo-coach',  name:'Demo Coach',  email:'coach@demo.triibholz',  provider:'Demo', role:'coach',       position:null, status:'approved', xp:60,  streak:3, badges:['first-study'] },
    'player':      { id:'demo-player', name:'Demo Player', email:'player@demo.triibholz', provider:'Demo', role:'player',      position:'6',  status:'approved', xp:120, streak:4, badges:['first-study','trivia-ace','power-play'] },
    'super-admin': { id:'demo-admin',  name:'Demo Admin',  email:'admin@demo.triibholz',  provider:'Demo', role:'super-admin', position:null, status:'approved', xp:0,   streak:2, badges:[] },
  };
  function enterDemo(role){
    const u = DEMO_USERS[role] || DEMO_USERS['coach'];
    DATA.upsertUser(u);
    const stored = DATA.findUserByEmail(u.email) || u;
    DATA.logActivity('signin', `${stored.name} entered the demo`, stored.name);
    state.user = stored; saveSession(stored); enterApp();
  }
  function loadSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch(e){ return null; } }
  function saveSession(u) { try { localStorage.setItem(SESSION_KEY, JSON.stringify({ email: u.email })); } catch(e){} }
  function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch(e){} }

  // route an existing user record by status
  function routeUser(user) {
    state.user = user;
    saveSession(user);
    if (user.status === 'approved') { enterApp(); }
    else if (user.status === 'denied') { $('denied-email').textContent = user.email; show('denied-screen'); }
    else { $('pending-email').textContent = user.email; show('pending-screen'); }
  }

  /* ---------------- setup (role + position + request access) ---------------- */
  function openSetup(idn) {
    state._pendingIdentity = idn;
    $('setup-name').textContent = idn.name ? ', ' + idn.name.split(' ')[0] : '';
    state.setup = { role: 'player', position: null };
    document.querySelectorAll('#role-seg .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.role==='player'));
    document.querySelectorAll('#position-grid .pos-chip').forEach(b => b.classList.remove('active'));
    updatePositionBlock();
    show('setup-screen');
    if (joinParam()) setTimeout(()=> toast('You’re joining ' + loadTeam().name + ' — pick your cap number'), 400);
  }
  function updatePositionBlock() {
    const isPlayer = state.setup.role === 'player';
    const T = (typeof I18N!=='undefined') ? I18N.t : (k=>k);
    $('position-block').style.display = isPlayer ? '' : 'none';
    $('position-block').querySelector('.setup-label').textContent = isPlayer ? T('setup.posReq') : T('setup.posOpt');
    $('role-note').textContent = state.setup.role === 'super-admin' ? T('setup.noteAdmin') : T('setup.noteStaff');
    $('setup-continue').textContent = state.setup.role === 'super-admin' ? T('setup.enterAdmin') : T('setup.request');
  }
  function submitSetup() {
    if (state.setup.role === 'player' && !state.setup.position) { toast('Pick your position'); return; }
    const idn = state._pendingIdentity;
    const role = state.setup.role;
    const status = role === 'super-admin' ? 'approved' : 'pending';
    const user = {
      id: 'u-' + Math.abs(hash(idn.email)),
      name: idn.name, email: idn.email, provider: idn.provider,
      role, position: role==='player' ? state.setup.position : null,
      status, createdAt: DATA.nowStamp(), triviaBest: 0,
      teamCode: joinParam() || loadTeam().code,
    };
    DATA.upsertUser(user);
    DATA.logActivity('signin', `${user.name} requested access as ${DATA.roleLabel(role)}`, user.name);
    if (status === 'approved') { DATA.logActivity('approve', `${user.name} provisioned as Super Admin`, user.name); state.user = user; saveSession(user); enterApp(); }
    else routeUser(DATA.findUserByEmail(idn.email));
  }
  function hash(str){ let h=0; for(let i=0;i<str.length;i++){ h=(h<<5)-h+str.charCodeAt(i); h|=0; } return h; }

  /* ---------------- nav / views ---------------- */
  function switchView(view) {
    state.view = view;
    document.querySelectorAll('#main-nav .nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view===view));
    ['dashboard','playbook','basics','film','solutions','season','trivia','admin'].forEach(v => $('view-'+v).classList.toggle('active', v===view));
    const inPlaybook = view==='playbook';
    $('situation-tabs').style.display = inPlaybook ? '' : 'none';
    $('phase-toggle').style.display = inPlaybook ? '' : 'none';
    if (view==='dashboard') renderDashboard();
    if (view==='basics') renderBasics();
    if (view==='film' && typeof FILM!=='undefined') FILM.render($('view-film'), {
      user: state.user, canEdit: canEdit(), toast,
      // a tagged video moment becomes a play on the tactics board
      // auto-scout → real plays in the library (Team visibility, flagged for review when unsure)
      addPlays: (plays, source) => {
        let n = 0;
        (plays || []).forEach(p => {
          if (!p || !p.frames || !p.frames.length) return;
          const sc = DATA.newScenario(p.situation || '6v6', p.phase || 'offense');
          sc.id = 'usr-' + Math.abs(hash('scout' + (source || '') + p.title + JSON.stringify(p.frames[0]).slice(0, 60)));
          sc.title = p.title; sc.description = (p.needsReview ? '⚠ needs review · ' : '') + (p.description || '');
          sc.frames = DATA.clone(p.frames); sc.notes = DATA.clone(p.notes || {});
          sc.author = 'Auto-scout' + (source ? ' · ' + source : ''); sc.builtIn = false; sc.visibility = 'team'; sc.owner = state.user && state.user.email;
          if (!state.scenarios.some(x => x.id === sc.id)) { state.scenarios.push(sc); n++; }
          try { if (typeof PRIVACY !== 'undefined') PRIVACY.learnFrom(sc); } catch (e) {}
        });
        if (n) { DATA.save(state.scenarios); DATA.logActivity('play', `Auto-scout added ${n} play${n > 1 ? 's' : ''} from “${source || 'video'}”`, 'Auto-scout'); renderLibrary(); }
        return n;
      },
      // an auto-scouted attack (≤6 keyframes) opens as an animated play in the editor
      openPlay: (play) => {
        const sc = DATA.newScenario(play.situation || '6v6', 'offense');
        sc.title = play.title || 'Scouted attack'; sc.description = play.description || '';
        if (play.frames && play.frames.length) sc.frames = DATA.clone(play.frames);
        sc.notes = DATA.clone(play.notes || {});
        openEditor(sc, true);
      },
      rebuild: (situation, phase, title, desc, frame) => {
        const sc = DATA.newScenario(situation, phase);
        sc.title = title; sc.description = desc;
        if (frame) sc.frames = [DATA.clone(frame)];   // staged positions from the Film Room
        openEditor(sc, true);
      },
    });
    if (view==='solutions') renderSolutions();
    if (view==='season') renderSeason();
    if (view==='trivia') renderTrivia();
    if (view==='admin') renderAdmin();
    if (view==='playbook' && !state.selectedId) openFirstOrEmpty();
    if (typeof updateAudibleBtn==='function') updateAudibleBtn();
  }

  /* ---------------- enter app ---------------- */
  function enterApp() {
    // reset per-session view state — logout/login must not leak the previous
    // user's open scenario, focus or problem/solution mode
    state.selectedId = null; state.focus = null; state.mode = 'solution';
    if (state.viewer) { state.viewer.stop(); state.viewer = null; }
    state.scenarios = DATA.load();
    const streak = DATA.touchStreak(state.user.email);
    if (streak>=3) DATA.addBadge(state.user.email,'streak-3');
    state.user = DATA.findUserByEmail(state.user.email) || state.user;
    state.situation='6v6'; state.phase='offense';
    state.viewMode = state.user.role==='player' ? 'me' : 'team';
    updateUserPill();
    const isAdmin = state.user.role==='super-admin';
    $('main-nav').querySelector('.nav-admin').hidden = !isAdmin;
    $('new-scenario-btn').style.display = canEdit() ? '' : 'none';
    buildSituationTabs();
    renderLibrary();
    show('app-screen');
    refreshAdminBadge();
    switchView('dashboard');
    if ($('import-btn')) $('import-btn').hidden = !canEdit();
    if (typeof SHARE!=='undefined' && SHARE.fromHash(location.hash)) openSharedPlay();
    maybeRunTour();
  }
  function refreshAdminBadge() {
    if (state.user.role!=='super-admin') return;
    const pend = DATA.loadUsers().filter(u=>u.status==='pending').length;
    const b = $('nav-admin-badge'); b.textContent = pend; b.hidden = pend===0;
  }

  /* ======================================================
     DASHBOARD
     ====================================================== */
  // what the system has learned ANONYMOUSLY (patterns only, k-anonymous — never a play)
  function insightsPanelHtml() {
    if (typeof PRIVACY==='undefined') return '';
    const rep = PRIVACY.report(PRIVACY.load());
    const lines = PRIVACY.insightsText(rep);
    return `<h3 class="dash-h3">🔒 Anonymous learnings <button class="help-chip" data-help="privacy" title="How confidentiality works">？</button></h3>
      <div class="insights-box">${lines.length ? lines.map(l=>`<div class="ins-row">${escapeHtml(l)}</div>`).join('')
        : `<div class="muted">Patterns appear once at least ${PRIVACY.K_MIN} plays of a kind exist. Private tactics are never shown — only anonymous patterns (no names, no text).</div>`}</div>`;
  }
  function renderDashboard() {
    const v = $('view-dashboard');
    const u = state.user;
    const scn = state.scenarios;
    const acts = DATA.loadActivity();
    const card = (cls, inner) => `<div class="dash-card ${cls||''}">${inner}</div>`;
    const mascot = (typeof FX!=='undefined') ? FX.mascot(40) : '';
    let html = `<div class="dash-wrap"><div class="dash-head with-mascot">${mascot}
      <div><h1>${greeting()}, ${escapeHtml(u.name.split(' ')[0])}</h1>
      <p class="dash-sub">${roleL(u.role)}${u.position?` · Position ${u.position}`:''}</p></div>
      <button class="help-chip" data-help="dashboard" title="How to use the dashboard">？</button></div>`;

    if (u.role === 'player') {
      const total = scn.length;
      html += `<div class="dash-grid">
        ${card('accent', `<span class="dc-k">Your position</span><span class="dc-v big">${u.position||'—'}</span><span class="dc-note">Tap “My position” in any play to see only your movement.</span>`)}
        ${card('', `<span class="dc-k">Plays to know</span><span class="dc-v big">${total}</span><span class="dc-note">across 6v6 → 1‑on‑GK, offense & defense</span>`)}
        ${card('', `<span class="dc-k">Trivia best</span><span class="dc-v big">${u.triviaBest||0}<small>/${DATA.TRIVIA.length}</small></span><span class="dc-note">🏛️ History & legends: ${u.triviaBestHist||0}/${(DATA.TRIVIA_HISTORY||[]).length}</span><button class="btn-primary sm" data-go="trivia">Take the quiz</button>`)}
      </div>
      <div class="progress-card">
        <div class="pc-item"><span class="pc-v">${u.xp||0}</span><span class="pc-k">XP</span></div>
        <div class="pc-item"><span class="pc-v">🔥 ${u.streak||0}</span><span class="pc-k">day streak</span></div>
        <div class="pc-badges">${badgesHtml(u.badges)}</div>
        <button class="btn-primary sm" data-challenge="1">🏆 Challenge</button>
      </div>
      <h3 class="dash-h3">Study your role</h3>
      <div class="dash-list">${scn.slice(0,5).map(s=>scnRow(s)).join('')||'<div class="muted">No plays yet.</div>'}</div>`;
    } else if (u.role === 'super-admin') {
      const users = DATA.loadUsers();
      const pend = users.filter(x=>x.status==='pending');
      html += `<div class="dash-grid">
        ${card(pend.length?'warn':'', `<span class="dc-k">Pending approvals</span><span class="dc-v big">${pend.length}</span>${pend.length?'<button class="btn-primary sm" data-go="admin">Review now</button>':'<span class="dc-note">All caught up</span>'}`)}
        ${card('', `<span class="dc-k">People</span><span class="dc-v big">${users.filter(x=>x.status==='approved').length}</span><span class="dc-note">${users.length} total accounts</span>`)}
        ${card('', `<span class="dc-k">Plays in library</span><span class="dc-v big">${scn.length}</span><span class="dc-note">recorded movement patterns</span>`)}
      </div>
      <h3 class="dash-h3">Live activity</h3>
      <div class="dash-list">${acts.slice(0,8).map(activityRow).join('')||'<div class="muted">No activity yet.</div>'}</div>`;
    } else { // coach / trainer
      const users = DATA.loadUsers();
      html += `<div class="dash-grid">
        ${card('accent', `<span class="dc-k">Squad</span><span class="dc-v big">${users.filter(x=>x.role==='player'&&x.status==='approved').length}</span><span class="dc-note">approved players</span>`)}
        ${card('', `<span class="dc-k">Plays</span><span class="dc-v big">${scn.length}</span><button class="btn-primary sm" data-go="playbook">Open playbook</button>`)}
        ${card('', `<span class="dc-k">You can</span><span class="dc-v">Record &amp; adjust</span><span class="dc-note">pause any play and drag players — or build one from scratch</span><button class="btn-primary sm" data-newplay>＋ New play</button>`)}
      </div>
      <h3 class="dash-h3">Recent changes</h3>
      <div class="dash-list">${acts.filter(a=>a.type==='play').slice(0,6).map(activityRow).join('')||'<div class="muted">No edits yet — open the Playbook and press “+ New”.</div>'}</div>`;
      html += insightsPanelHtml();
    }
    html += `</div>`;
    v.innerHTML = html;
    // staff get an invite (link + QR) card
    if (EDIT_ROLES.includes(u.role)) {
      const wrap = v.querySelector('.dash-wrap');
      const holder = document.createElement('div'); holder.innerHTML = inviteCardHtml();
      const grid = wrap.querySelector('.dash-grid');
      if (grid) grid.insertAdjacentElement('afterend', holder.firstElementChild);
      else wrap.appendChild(holder.firstElementChild);
      bindInvite(v);
    }
    v.querySelectorAll('[data-go]').forEach(b=> b.onclick=()=>switchView(b.dataset.go));
    v.querySelectorAll('[data-challenge]').forEach(b=> b.onclick=()=>runChallenge());
    v.querySelectorAll('[data-newplay]').forEach(b=> b.onclick=()=>{ switchView('playbook'); openEditor(DATA.newScenario(state.situation, state.phase), true); });
    v.querySelectorAll('[data-open]').forEach(b=> b.onclick=()=>{ const s=state.scenarios.find(x=>x.id===b.dataset.open); if(s){ state.situation=s.situation; state.phase=s.phase; switchView('playbook'); openScenario(s.id);} });
  }
  function greeting(){ return 'Welcome'; }
  function badgesHtml(ids){
    ids = ids||[];
    if (!ids.length) return '<span class="pc-none">No badges yet — study a play or take a challenge</span>';
    return ids.map(id => { const b=DATA.BADGES[id]; return b?`<span class="badge-chip" title="${escapeHtml(b.label)}">${b.icon} ${escapeHtml(b.label)}</span>`:''; }).join('');
  }
  // reward studying a play (triggered from Reveal solution)
  function onStudied(){
    if (!state.user) return;
    if (typeof FX!=='undefined') FX.sound('pop');
    const scn = state.scenarios.find(s=>s.id===state.selectedId);
    DATA.awardXp(state.user.email, 5);
    const first = DATA.addBadge(state.user.email, 'first-study');
    if (scn && scn.situation==='6v5') DATA.addBadge(state.user.email, 'power-play');
    state.user = DATA.findUserByEmail(state.user.email);
    if (first && typeof FX!=='undefined') FX.confetti(40);
  }

  /* ---------------- Challenge mode (auto-generated from plays) ---------------- */
  function buildChallenge(){
    const pool = state.scenarios.filter(s => s.phase==='offense' && s.frames.length>1 &&
      /^A[1-6]$/.test((s.frames[s.frames.length-1].ball||{}).carrier||''));
    const qs = [];
    const shuffled = pool.slice().sort((a,b)=> (a.id>b.id?1:-1));
    for (const s of shuffled){
      const carrier = s.frames[s.frames.length-1].ball.carrier.slice(1);
      const inPlay = Object.keys(s.frames[0].att);
      const distractors = inPlay.filter(p=>p!==carrier);
      // pick 2 distractors deterministically
      const opts = [carrier, distractors[0], distractors[1]].filter(Boolean);
      while (opts.length<3 && inPlay.length) { const extra=inPlay.find(p=>!opts.includes(p)); if(!extra)break; opts.push(extra); }
      for (let k=opts.length-1;k>0;k--){ const j=Math.floor(Math.random()*(k+1)); [opts[k],opts[j]]=[opts[j],opts[k]]; }
      const options = opts;
      qs.push({ title:s.title, situation:s.situation, correct:carrier, options });
      if (qs.length>=5) break;
    }
    return qs;
  }
  function runChallenge(){
    const qs = buildChallenge();
    if (!qs.length){ toast('No plays available to challenge yet'); return; }
    let i=0, score=0;
    const ov=document.createElement('div'); ov.className='modal-backdrop'; ov.id='challenge-modal';
    document.body.appendChild(ov);
    function step(){
      const q=qs[i];
      ov.innerHTML=`<div class="modal challenge-modal">
        <div class="modal-head"><h3>🏆 Challenge — ${i+1}/${qs.length}</h3><button class="modal-x" id="ch-x">✕</button></div>
        <div class="modal-body">
          <p class="ch-q">In <strong>“${escapeHtml(q.title)}”</strong> (${q.situation}), which player finishes the play?</p>
          <div class="ch-opts">${q.options.map(o=>`<button class="ch-opt" data-o="${o}">${o==='GK'?'Goalkeeper':'Player '+o}</button>`).join('')}</div>
          <div class="ch-why" id="ch-why" hidden></div>
          <button class="btn-primary" id="ch-next" hidden>${i===qs.length-1?'Finish':'Next'}</button>
        </div></div>`;
      ov.querySelector('#ch-x').onclick = close;
      let answered=false;
      ov.querySelectorAll('.ch-opt').forEach(b=> b.onclick=()=>{
        if(answered) return; answered=true;
        const correct = b.dataset.o===q.correct;
        if(correct){ score++; if(typeof FX!=='undefined') FX.sound('tick'); }
        ov.querySelectorAll('.ch-opt').forEach(x=> x.classList.add(x.dataset.o===q.correct?'right':(x===b?'wrong':'mute')));
        const w=ov.querySelector('#ch-why'); w.hidden=false;
        w.innerHTML = correct? '<strong>Correct!</strong> That’s the finisher.' : `<strong>Not quite.</strong> Player ${q.correct} finishes this one.`;
        ov.querySelector('#ch-next').hidden=false;
      });
      ov.querySelector('#ch-next').onclick=()=>{ i++; if(i>=qs.length) finish(); else step(); };
    }
    function finish(){
      DATA.awardXp(state.user.email, score*8);
      DATA.addBadge(state.user.email, 'challenger');
      DATA.logActivity('trivia', `${state.user.name} scored ${score}/${qs.length} on a play challenge`, state.user.name);
      state.user = DATA.findUserByEmail(state.user.email);
      const perfect = score===qs.length;
      ov.innerHTML=`<div class="modal challenge-modal"><div class="modal-body ch-result">
        <div class="trivia-score-ring">${score}<small>/${qs.length}</small></div>
        <h2>${perfect?'Flawless!':score>=qs.length*0.6?'Nice work':'Keep studying'}</h2>
        <p class="dash-sub">+${score*8} XP</p>
        <button class="btn-primary" id="ch-done">Done</button></div></div>`;
      ov.querySelector('#ch-done').onclick=close;
      if (typeof FX!=='undefined'){ if(perfect) FX.celebrate('Flawless!', score+'/'+qs.length+' correct'); else FX.confetti(40); }
    }
    function close(){ ov.remove(); if(state.view==='dashboard') renderDashboard(); }
    step();
  }
  function scnRow(s){
    return `<button class="dash-row" data-open="${s.id}">
      <span class="dr-tag ${s.phase}">${s.situation}</span>
      <span class="dr-main"><span class="dr-title">${escapeHtml(s.title||'Untitled')}</span><span class="dr-sub">${escapeHtml(s.description||'')}</span></span>
      <span class="dr-steps">${s.frames.length} steps</span></button>`;
  }
  function activityRow(a){
    const icon = {signin:'→',approve:'✓',deny:'✕',play:'✎',trivia:'★'}[a.type]||'•';
    return `<div class="act-row"><span class="act-ic ${a.type}">${icon}</span><span class="act-text">${escapeHtml(a.text)}</span></div>`;
  }

  /* ======================================================
     BASICS — high-level water polo fundamentals
     ====================================================== */
  const BASICS = [
    { icon:'◎', title:'Object of the game', body:[
      'Two teams try to throw the ball into the opponent’s goal. A goal counts only when the ball <strong>fully crosses the goal line</strong>.',
      'Play starts with both teams on their own goal lines; the referee releases the ball at mid‑pool and the teams swim for it.',
      'You must get a shot away before your possession time runs out, or the ball turns over.' ] },
    { icon:'7', title:'Team & positions', body:[
      'Each team has <strong>7 in the water</strong>: 6 field players + 1 goalkeeper. Match roster: up to <strong>14</strong> (12 field + 2 goalkeepers).',
      'In this app we number the field players <strong>1–6</strong> and mark them by team colour.',
      'A common shape: perimeter players (wings, flats, point) around the arc, with a <strong>centre‑forward (“hole set”)</strong> posted at the 2 m line in front of goal.' ],
      legend:true },
    { icon:'⏱', title:'Game structure', body:[
      'Played in <strong>4 quarters</strong> of 8 minutes actual play (senior level); teams change ends at half‑time.',
      'A <strong>28‑second possession clock</strong> limits each attack — shoot before it expires.',
      'Each team has <strong>two 1‑minute timeouts</strong> — callable only while in possession, even straight after a goal.',
      'Flying substitutions go through your team’s own half of the substitution area (own goal line → centre); World Aquatics events also use a <strong>VAR referee</strong>.' ] },
    { icon:'▦', title:'The pool & its lines', body:[
      'Field of play: <strong>25 m × 20 m</strong> goal line to goal line — men and women alike (2025 rules).',
      '<strong>Goal line</strong> · <strong>2 m line (red)</strong> — no attacker may sit inside it ahead of the ball.',
      '<strong>5 m line (yellow)</strong> — penalty throws are taken from anywhere on it. <strong>6 m line (green)</strong> — free throws from outside it may be shot directly; blocking with two hands is only allowed inside your own 6 m area.',
      '<strong>Half‑distance line</strong> at the middle. Excluded players wait and re‑enter from the <strong>exclusion / re‑entry</strong> corner.' ] },
    { icon:'⚠', title:'Fouls & penalties', body:[
      '<strong>Ordinary (minor) fouls</strong> — pushing the ball under, two hands on the ball (field players), impeding a free player — give a <strong>free throw / change of possession</strong>.',
      '<strong>Major (exclusion) fouls</strong> — holding/sinking an opponent, tactical fouls — send the offender to the re‑entry corner for <strong>18 seconds</strong> (a “man‑up”); they return at the earliest of 18 s served, a goal, or their team being awarded a free throw / goal throw / penalty.',
      'A major foul inside the <strong>6 m area</strong> that stops a likely goal is a <strong>penalty shot</strong>, taken from the 5 m line — in the last minute the coach may choose possession instead (clock reset to 28 s).' ] },
    { icon:'✛', title:'The goalkeeper', body:[
      'Wears the <strong>red cap</strong> and defends the goal.',
      'Inside the 6 m area the keeper may <strong>use two hands</strong> and (where depth allows) push off the bottom — things field players can’t do.',
      'The keeper starts the counter‑attack: a fast, accurate outlet pass turns defence into offence.' ] },
    { icon:'≈', title:'Core skills', body:[
      '<strong>Eggbeater kick</strong> — the alternating leg motion that keeps you high and stable without using your hands.',
      '<strong>Dry passing</strong> — catch and release with one hand, keeping the ball out of the water.',
      '<strong>Shooting</strong> — power shots, lobs over the keeper, and quick catch‑and‑shoot off a feed.' ] },
  ];
  // bundled snapshot — used until data/rules.json loads (and for file:// where fetch is blocked)
  const RULES_FALLBACK = {
    source: { name:'Swiss Aquatics', page:'https://www.swiss-aquatics.ch/leistungssport/water-polo/wettkampfbetrieb/downloads-medien/' },
    checkedAt: null,
    documents: [
      { title:'World Aquatics Competition Regulations (Water Polo = Part Six)', lang:'EN', category:'International rules — primary source', url:'https://www.worldaquatics.com/rules/competition-regulations', version:'' },
      { title:'Swiss Aquatics — Reglement 5.1', lang:'DE', category:'Swiss competition regulation', url:'https://www.swiss-aquatics.ch/leistungssport/water-polo/wettkampfbetrieb/downloads-medien/', version:'' },
    ],
    references: [
      { title:'Swiss Aquatics — Water Polo downloads & regulations', url:'https://www.swiss-aquatics.ch/leistungssport/water-polo/wettkampfbetrieb/downloads-medien/' },
      { title:'World Aquatics — Competition Regulations', url:'https://www.worldaquatics.com/rules/competition-regulations' },
    ],
  };
  function fmtDate(iso){ if(!iso) return ''; try{ return new Date(iso).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}); }catch(e){ return iso; } }
  function rulebooksHtml(data){
    const docs = (data.documents||[]).filter(d => d.url || d.stale);
    return `<div class="rules-panel">
      <div class="rules-head"><span class="rules-ic">§</span>
        <div><h3>${(typeof I18N!=='undefined')?I18N.t('basics.rulebooks'):'Official rule books — Swiss Aquatics'}</h3>
          <span class="rules-checked">${data.checkedAt ? ('Auto‑checked '+fmtDate(data.checkedAt)) : 'Bundled snapshot'} · refreshes automatically from Swiss Aquatics</span></div></div>
      <div class="rules-docs">${docs.map(d=>`
        <a class="rules-doc" href="${d.url||data.source.page}" target="_blank" rel="noopener">
          <span class="rd-lang">${escapeHtml(d.lang||'')}</span>
          <span class="rd-main"><span class="rd-title">${escapeHtml(d.title)}${d.stale?' <em>(last known)</em>':''}</span>
            <span class="rd-sub">${escapeHtml(d.category||'')}${d.version?(' · v '+escapeHtml(d.version)):''}</span></span>
          <span class="rd-open">open ↗</span></a>`).join('')}</div>
      <div class="rules-refs">${(data.references||[]).map(r=>`<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.title)} ↗</a>`).join('')}</div>
    </div>`;
  }

  const RESPONSIBILITIES = [
    { icon:'🤽', title:'Players', items:[
      'Know your position and your job on every play — offense <em>and</em> defense.',
      'Follow the game plan and the coach’s calls; run the set plays.',
      'Communicate constantly — call screens, presses and switches.',
      'Play within the rules: manage your fouls and avoid needless exclusions.',
      'Sprint transitions — first back on defense, first up on the counter.',
      'Support the goalkeeper and protect the front of goal.',
      'Respect teammates, opponents and officials; give full effort when tired.' ] },
    { icon:'🎯', title:'Coach', items:[
      'Prepare the team: training plans, tactics and set plays.',
      'Pick the line-up and manage substitutions and time-outs.',
      'Teach roles and positions; develop every player.',
      'Read the game and adjust tactics in real time (man-up, man-down, press vs drop).',
      'Motivate, set standards and manage the bench.',
      'Look after player welfare, safety and fair play.',
      'Communicate clearly and respect the officials.' ] },
    { icon:'⚖️', title:'Referee', items:[
      'Enforce the rules and keep the game fair and safe.',
      'Award ordinary fouls, exclusions (18 s) and penalties (from the 5 m line).',
      'Manage exclusions and re-entry from the corner.',
      'Signal decisions clearly; coordinate with the table, timekeepers and VAR.',
      'Control the match and both benches; stay impartial.',
      'Protect players from dangerous play.' ] },
  ];

  function renderBasics() {
    const v = $('view-basics');
    const legendHtml = `<div class="basics-legend">
        <span class="bl"><span class="bl-dot att"></span>Attack (white)</span>
        <span class="bl"><span class="bl-dot def"></span>Defence (black)</span>
        <span class="bl"><span class="bl-dot gk"></span>Goalkeeper (red)</span>
        <span class="bl"><span class="bl-dot ball"></span>Ball (orange)</span>
      </div>`;
    const T = (typeof I18N!=='undefined') ? I18N.t : (k=>k);
    v.innerHTML = `<div class="dash-wrap">
      <div class="dash-head"><h1>${T('basics.title')}</h1>
        <p class="dash-sub">${T('basics.sub')}</p>
        <button class="help-chip" data-help="basics" title="How to use Basics">？</button></div>
      <div id="rules-mount"></div>
      <div class="basics-grid">
        ${BASICS.map(c=>`<div class="basics-card">
          <div class="basics-h"><span class="basics-ic">${c.icon}</span><h3>${c.title}</h3></div>
          <ul>${c.body.map(p=>`<li>${p}</li>`).join('')}</ul>
          ${c.legend?legendHtml:''}
        </div>`).join('')}
      </div>
      <h3 class="dash-h3">Roles &amp; responsibilities</h3>
      <div class="basics-grid resp-grid">
        ${RESPONSIBILITIES.map(c=>`<div class="basics-card resp-card">
          <div class="basics-h"><span class="basics-ic">${c.icon}</span><h3>${c.title}</h3></div>
          <ul>${c.items.map(p=>`<li>${p}</li>`).join('')}</ul>
        </div>`).join('')}
      </div>
      <div class="basics-cta">
        <button class="btn-primary sm" data-go="playbook">${T('basics.seePlaybook')}</button>
        <button class="btn-ghost" data-go="trivia">${T('basics.testTrivia')}</button>
      </div>
      <p class="basics-src">Fundamentals summarised from
        <a href="https://vancouvervipers.ca/water-polo-basics/" target="_blank" rel="noopener">Vancouver Vipers — Water Polo Basics</a>,
        <a href="https://www.wikihow.com/Play-Water-Polo" target="_blank" rel="noopener">wikiHow — Play Water Polo</a>,
        and World Aquatics rules. Details vary by level/governing body.</p>
    </div>`;
    v.querySelectorAll('[data-go]').forEach(b=> b.onclick=()=>switchView(b.dataset.go));
    // official rule books: show bundled snapshot now, then refresh from data/rules.json
    const mount = $('rules-mount');
    if (mount) {
      mount.innerHTML = rulebooksHtml(RULES_FALLBACK);
      if (typeof fetch === 'function') {
        fetch('data/rules.json', { cache:'no-store' })
          .then(r => r.ok ? r.json() : null)
          .then(d => { if (d && Array.isArray(d.documents) && d.documents.length) mount.innerHTML = rulebooksHtml(d); })
          .catch(()=>{});
      }
    }
  }

  /* ======================================================
     TRIVIA
     ====================================================== */
  const trivia = { set:null, i:0, score:0, answered:false };
  function triviaSets(){ return DATA.TRIVIA_SETS || [{ id:'rules', icon:'📘', label:'Rules & basics', questions: DATA.TRIVIA }]; }
  function bestField(setId){ return setId==='history' ? 'triviaBestHist' : 'triviaBest'; }
  function renderTrivia() {
    trivia.set = null; trivia.i = 0; trivia.score = 0; trivia.answered = false;
    const v = $('view-trivia');
    const sets = triviaSets();
    v.innerHTML = `<div class="trivia-wrap"><div class="trivia-card" id="trivia-card">
      <div class="trivia-intro">
        <span class="dc-k">Knowledge check <button class="help-chip" data-help="trivia" title="How trivia works">？</button></span>
        <h1>${(typeof I18N!=='undefined')?I18N.t('trivia.title'):'Water Polo Trivia'}</h1>
        <p class="dash-sub">Pick a quiz — your best score for each is saved to your profile.</p>
        <div class="trivia-sets">
          ${sets.map(st=>`
            <div class="trivia-set">
              <span class="ts-icon">${st.icon}</span>
              <div class="ts-main"><strong>${escapeHtml(st.label)}</strong>
                <span class="ts-sub">${st.questions.length} questions · best ${state.user[bestField(st.id)]||0}/${st.questions.length}</span></div>
              <button class="btn-primary sm" id="trivia-start${st.id==='rules'?'':'-'+st.id}" data-set="${st.id}">
                ${(typeof I18N!=='undefined')?I18N.t('trivia.start'):'Start quiz'}</button>
            </div>`).join('')}
        </div>
      </div></div></div>`;
    v.querySelectorAll('[data-set]').forEach(b=> b.onclick=()=> startSet(b.dataset.set));
  }
  function startSet(id){
    trivia.set = triviaSets().find(s=>s.id===id) || triviaSets()[0];
    trivia.i = 0; trivia.score = 0; trivia.answered = false;
    showQuestion();
  }
  function showQuestion() {
    const qs = trivia.set.questions;
    const c = $('trivia-card'); const item = qs[trivia.i];
    trivia.answered = false;
    // shuffle the displayed order every time — the correct answer must never
    // live in a fixed position (players were learning "always the first one")
    const order = item.a.map((_,i)=>i);
    for (let i=order.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [order[i],order[j]]=[order[j],order[i]]; }
    c.innerHTML = `<div class="trivia-q">
      <div class="trivia-prog">${trivia.set.icon} ${escapeHtml(trivia.set.label)} · Question ${trivia.i+1} / ${qs.length} · Score ${trivia.score}</div>
      <h2>${escapeHtml(item.q)}</h2>
      <div class="trivia-opts">${order.map(idx=>`<button class="trivia-opt" data-idx="${idx}">${escapeHtml(item.a[idx])}</button>`).join('')}</div>
      <div class="trivia-why" id="trivia-why" hidden></div>
      <button class="btn-primary" id="trivia-next" hidden>${trivia.i===qs.length-1?'See result':'Next'}</button>
    </div>`;
    c.querySelectorAll('.trivia-opt').forEach(b => b.onclick = () => answer(parseInt(b.dataset.idx,10), item));
    $('trivia-next').onclick = () => { trivia.i++; if (trivia.i>=qs.length) finishTrivia(); else showQuestion(); };
  }
  function answer(idx, item) {
    if (trivia.answered) return; trivia.answered = true;
    const correct = idx===item.correct;
    if (correct) trivia.score++;
    document.querySelectorAll('.trivia-opt').forEach(b=>{
      const bi = parseInt(b.dataset.idx,10);
      b.classList.add(bi===item.correct?'right':(bi===idx?'wrong':'mute'));
      b.disabled = true;
    });
    const why = $('trivia-why'); why.hidden=false;
    why.innerHTML = `<strong>${correct?'Correct':'Not quite'}.</strong> ${escapeHtml(item.why)}`;
    $('trivia-next').hidden = false;
  }
  function finishTrivia() {
    const total = trivia.set.questions.length;
    const field = bestField(trivia.set.id);
    DATA.setTriviaBest(state.user.email, trivia.score, field);
    DATA.awardXp(state.user.email, trivia.score*10);
    if (trivia.score===total) DATA.addBadge(state.user.email, trivia.set.id==='history' ? 'historian' : 'trivia-ace');
    DATA.logActivity('trivia', `${state.user.name} scored ${trivia.score}/${total} on ${trivia.set.label} trivia`, state.user.name);
    if (typeof FX!=='undefined') {
      if (trivia.score===total) FX.celebrate('Perfect!', total+'/'+total+(trivia.set.id==='history'?' — Historian':' — Trivia Ace'));
      else if (trivia.score/total>=0.6) { FX.confetti(50); FX.sound('pop'); }
    }
    state.user = DATA.findUserByEmail(state.user.email);
    const c = $('trivia-card');
    const pct = Math.round(trivia.score/total*100);
    c.innerHTML = `<div class="trivia-result">
      <div class="trivia-score-ring">${trivia.score}<small>/${total}</small></div>
      <h2>${pct>=80?'Sharp!':pct>=50?'Good work':'Keep studying'}</h2>
      <p class="dash-sub">Best score saved to your profile.</p>
      <div class="status-actions"><button class="btn-primary" id="trivia-again">Try again</button>
      <button class="btn-ghost" data-go="dashboard">Back to dashboard</button></div>
    </div>`;
    $('trivia-again').onclick = () => renderTrivia();
    c.querySelector('[data-go]').onclick = () => switchView('dashboard');
  }

  /* ======================================================
     SUPER ADMIN CONSOLE
     ====================================================== */
  function renderAdmin() {
    const v = $('view-admin');
    const users = DATA.loadUsers();
    const pend = users.filter(u=>u.status==='pending');
    const acts = DATA.loadActivity();
    const roleOpts = (cur) => DATA.ROLES.map(r=>`<option value="${r}"${r===cur?' selected':''}>${DATA.roleLabel(r)}</option>`).join('');

    v.innerHTML = `<div class="admin-wrap">
      <div class="admin-head"><h1>Super Admin <button class="help-chip" data-help="admin" title="How the console works">？</button></h1><p class="dash-sub">Approve logins, manage roles, and watch what’s happening.</p></div>

      <section class="admin-sec">
        <h3>Approval queue ${pend.length?`<span class="pill-count">${pend.length}</span>`:''}</h3>
        <div class="admin-list" id="approve-list">
          ${pend.length ? pend.map(u=>`
            <div class="admin-row" data-id="${u.id}">
              <span class="ar-av">${escapeHtml(u.name.charAt(0))}</span>
              <span class="ar-main"><span class="ar-name">${escapeHtml(u.name)}</span><span class="ar-sub">${escapeHtml(u.email)} · wants ${DATA.roleLabel(u.role)}${u.position?` (pos ${u.position})`:''} · ${u.provider}</span></span>
              <span class="ar-actions">
                <button class="btn-primary sm" data-approve="${u.id}">Approve</button>
                <button class="btn-ghost sm danger" data-deny="${u.id}">Deny</button>
              </span>
            </div>`).join('') : '<div class="muted">No pending requests.</div>'}
        </div>
      </section>

      <section class="admin-sec">
        <h3>People</h3>
        <div class="admin-list">
          ${users.map(u=>`
            <div class="admin-row">
              <span class="ar-av ${u.status}">${escapeHtml(u.name.charAt(0))}</span>
              <span class="ar-main"><span class="ar-name">${escapeHtml(u.name)} <span class="status-chip ${u.status}">${u.status}</span></span>
                <span class="ar-sub">${escapeHtml(u.email)} · ${u.provider}${u.position?` · pos ${u.position}`:''}</span></span>
              <span class="ar-actions">
                <select class="focus-select" data-role-for="${u.id}">${roleOpts(u.role)}</select>
              </span>
            </div>`).join('')}
        </div>
      </section>

      <section class="admin-sec">
        <h3>Activity feed</h3>
        <div class="dash-list">${acts.slice(0,30).map(activityRow).join('')||'<div class="muted">Nothing yet.</div>'}</div>
      </section>
    </div>`;

    v.querySelectorAll('[data-approve]').forEach(b=> b.onclick=()=>adminApprove(b.dataset.approve, true));
    v.querySelectorAll('[data-deny]').forEach(b=> b.onclick=()=>adminApprove(b.dataset.deny, false));
    v.querySelectorAll('[data-role-for]').forEach(s=> s.onchange=()=>{
      const u = DATA.setUserRole(s.dataset.roleFor, s.value);
      DATA.logActivity('approve', `${state.user.name} set ${u.name}’s role to ${DATA.roleLabel(s.value)}`, state.user.name);
      renderAdmin();
    });
  }
  function adminApprove(id, approve) {
    const u = DATA.setUserStatus(id, approve?'approved':'denied');
    DATA.logActivity(approve?'approve':'deny', `${state.user.name} ${approve?'approved':'denied'} ${u.name} (${DATA.roleLabel(u.role)})`, state.user.name);
    toast(approve?`Approved ${u.name}`:`Denied ${u.name}`);
    refreshAdminBadge();
    renderAdmin();
  }

  /* ======================================================
     PLAYBOOK — library / viewer  (unchanged core + logging)
     ====================================================== */
  function buildSituationTabs() {
    const wrap = $('situation-tabs'); wrap.innerHTML='';
    DATA.SITUATIONS.forEach(s => {
      const b = document.createElement('button');
      b.className = 'sit-tab' + (s.id===state.situation?' active':'');
      b.innerHTML = `<span class="sit-num">${s.label}</span>`;
      b.title = s.note;
      b.onclick = () => { state.situation = s.id; refreshTabs(); renderLibrary(); openFirstOrEmpty(); };
      wrap.appendChild(b);
    });
  }
  function refreshTabs() {
    document.querySelectorAll('.sit-tab').forEach((b,i)=> b.classList.toggle('active', DATA.SITUATIONS[i].id===state.situation));
    document.querySelectorAll('#phase-toggle .phase-btn').forEach(b=> b.classList.toggle('active', b.dataset.phase===state.phase));
  }
  function currentList() {
    return state.scenarios.filter(s => s.situation===state.situation && s.phase===state.phase
      && (typeof PRIVACY==='undefined' || PRIVACY.canView(s, state.user)));
  }
  // stamp confidentiality + ownership, and let the system learn ANONYMOUSLY
  function stampPrivacy(sc, fromEditor) {
    if (typeof PRIVACY==='undefined') return;
    if (fromEditor && $('ed-visibility')) sc.visibility = $('ed-visibility').value || 'team';
    if (!sc.visibility) sc.visibility = 'team';
    if (!sc.owner && state.user) sc.owner = state.user.email;
    if (!sc.team && state.user && state.user.teamCode) sc.team = state.user.teamCode;
    try { PRIVACY.learnFrom(sc); } catch (e) {}     // features only — never the play
  }

  function renderLibrary() {
    const s = DATA.sit(state.situation);
    $('library-title').textContent = s.label;
    $('library-sub').textContent = s.note + ' · ' + (state.phase==='offense'?'Offense':'Defense');
    const list = $('scenario-list'); list.innerHTML='';
    const items = currentList();
    if (items.length===0) list.innerHTML = `<div class="empty-lib">No ${state.phase} plays here yet.${canEdit()?'<br><span>Press “+ New” to build one.</span>':''}</div>`;
    items.forEach(scn => {
      const card = document.createElement('button');
      card.className='scn-card' + (scn.id===state.selectedId?' active':'') + (selecting?' selectable':'') + (selecting && selected.has(scn.id)?' picked':'');
      card.innerHTML = `${selecting?`<span class="scn-check">${selected.has(scn.id)?'☑':'☐'}</span>`:''}
        <div class="scn-card-top">
          <span class="scn-title">${escapeHtml(scn.title||'Untitled play')}</span>
          ${scn.builtIn?'<span class="tag tag-sample">sample</span>':'<span class="tag tag-yours">saved</span>'}${scn.template?'<span class="tag tag-tpl">⭐ template</span>':''}${(typeof PRIVACY!=='undefined' && !scn.builtIn && PRIVACY.levelOf(scn)!=='team')?`<span class="tag vis-${PRIVACY.levelOf(scn)}">${PRIVACY.levelOf(scn)==='private'?'🔒':'🌐'}</span>`:''}
        </div>
        <div class="scn-desc">${escapeHtml(scn.description||'')}</div>
        <div class="scn-meta"><span>${scn.frames.length} step${scn.frames.length>1?'s':''}</span><span>${escapeHtml(scn.author||'')}</span></div>`;
      card.onclick = () => selecting ? togglePick(scn.id) : openScenario(scn.id);
      list.appendChild(card);
    });
    updateSelectBar();
    if (canEdit() && !selecting) {
      const plus = document.createElement('button');
      plus.className = 'scn-card scn-new';
      plus.innerHTML = '<span class="scn-new-plus">＋</span> Create a new play';
      plus.onclick = () => newPlayFlow();
      list.appendChild(plus);
    }
  }

  function openFirstOrEmpty() {
    const first = currentList()[0];
    if (first) { openScenario(first.id); return; }
    state.selectedId = null;
    if (state.viewer) { state.viewer.stop(); state.viewer = null; }
    $('controls').hidden = true; $('pool-empty').hidden = false;
    resetAdjust();
    $('mode-toggle').hidden = true; $('problem-overlay').hidden = true;
    $('scenario-title').textContent = 'Select a scenario';
    $('scenario-desc').textContent = ''; $('scenario-desc').style.display = '';
    $('edit-btn').hidden = true;
    if ($('dl-btn')) { $('dl-btn').hidden = true; $('share-btn').hidden = true; }
    if ($('tpl-btn')) $('tpl-btn').hidden = true;
    if ($('shared-banner')) $('shared-banner').hidden = true;
    if ($('gk-view')) $('gk-view').hidden = true;
    if ($('my-cue')) $('my-cue').hidden = true;
    if ($('scene3d')) { const cv = $('scene3d'); if (!cv.hidden) { const ctx = cv.getContext('2d'); if (ctx) ctx.clearRect(0, 0, cv.width, cv.height); } }
    $('assign-list').innerHTML = ''; POOL.render($('pool'));
  }

  function openScenario(id) {
    const scn = state.scenarios.find(s=>s.id===id);
    if (!scn) return;
    state.selectedId = id;
    $('pool-empty').hidden = true; $('controls').hidden = false;
    resetAdjust();
    $('scenario-title').textContent = scn.title || 'Untitled play';
    $('scenario-desc').textContent = scn.description || '';
    $('edit-btn').hidden = !canEdit();
    if ($('dl-btn')) { $('dl-btn').hidden = false; $('share-btn').hidden = false; }
    if ($('tpl-btn')) { $('tpl-btn').hidden = !(canEdit() && !scn.builtIn && !scn.shared); $('tpl-btn').textContent = scn.template ? '⭐ Template ✓' : '☆ Template'; $('tpl-btn').classList.toggle('active', !!scn.template); }
    if ($('shared-banner')) $('shared-banner').hidden = !scn.shared;
    state.focus = (state.viewMode==='me') ? defaultFocus() : null;
    buildViewer(0, false);
    syncFocusUI();
    // Problem→Solution: players start in "problem" mode, staff in "solution"
    $('mode-toggle').hidden = false;
    state.mode = (state.user.role==='player') ? 'problem' : 'solution';
    state.scenarioDesc = scn.description || '';
    applyMode();
    refreshTabs(); renderLibrary();
    // pause-to-move: an open play IS paused, so coaches can drag right away
    enterPausedEdit();
  }

  let wasPlaying = false;
  function onPlayState(playing) {
    $('play-btn').textContent = playing ? '❚❚' : '▶';
    const fp = $('fsb-play'); if (fp) fp.textContent = playing ? '❚❚' : '▶';
    $('play-btn').classList.toggle('playing', playing);
    const was = wasPlaying; wasPlaying = playing;
    // only a real playing→paused transition re-opens the drag surface
    if (!playing && was) setTimeout(() => { if (state.viewer && !state.viewer.playing) enterPausedEdit(); }, 0);
  }
  /* Steps on/off: the per-position notes (right bar) + the arrows/paths on the board.
     Off = watch the pure movement. Remembered per device. */
  function stepsShown() { try { return localStorage.getItem('thplay.showSteps') !== '0'; } catch (e) { return true; } }
  function applySteps() {
    const show = stepsShown();
    const lay = $('view-playbook'); if (lay) lay.classList.toggle('steps-hidden', !show);
    const b = $('steps-toggle'); if (b) { b.classList.toggle('active', show); b.setAttribute('aria-pressed', show ? 'true' : 'false'); }
    if (state.viewer && state.mode !== 'problem') state.viewer.setPaths(show);
  }
  function toggleSteps() { try { localStorage.setItem('thplay.showSteps', stepsShown() ? '0' : '1'); } catch (e) {} applySteps(); }

  /* ======================================================
     SHOT-CHANCE ZONES + THE KEEPER'S VIEW
     Both read js/shot.js, which owns the geometry and the chance model.
     ====================================================== */
  const ZONE_FILL = { green: '#2ecc71', yellow: '#ffd166' };
  function zonesShown() { try { return localStorage.getItem('thplay.showZones') === '1'; } catch (e) { return false; } }
  function paintZones(layers) {
    if (!layers || !layers.zoneLayer || typeof SHOT === 'undefined') return;
    const zl = layers.zoneLayer;
    while (zl.firstChild) zl.removeChild(zl.firstChild);
    if (!zonesShown()) return;
    SHOT.bands().forEach(b => {
      zl.appendChild(POOL.svg('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 3,
        fill: ZONE_FILL[b.id], 'fill-opacity': b.id === 'green' ? 0.20 : 0.13,
        stroke: ZONE_FILL[b.id], 'stroke-width': 1, 'stroke-dasharray': '5 3', 'stroke-opacity': 0.75 }));
      const t = POOL.svg('text', { x: b.x + 4, y: b.y + 9, 'font-size': 6, 'font-weight': 800,
        fill: ZONE_FILL[b.id], 'font-family': 'Helvetica, Arial, sans-serif', opacity: 0.9 });
      t.textContent = Math.round(b.pct * 100) + '%';
      zl.appendChild(t);
    });
    const leg = POOL.svg('text', { x: POOL.WATER.x0 + 4, y: POOL.WATER.y1 - 4, 'font-size': 5.4,
      fill: '#cfe9f2', opacity: 0.85, 'font-family': 'Helvetica, Arial, sans-serif' });
    leg.textContent = 'green ~70% · yellow ~30% · rest <10% — coach’s guide, not a measurement';
    zl.appendChild(leg);
  }
  function applyZones() {
    const on = zonesShown();
    const b = $('zones-toggle');
    if (b) { b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    if (state.renderer && state.renderer.layers) paintZones(state.renderer.layers);
    if (adjust.layers) paintZones(adjust.layers);
    if (edit.layers) paintZones(edit.layers);
  }
  function toggleZones() { try { localStorage.setItem('thplay.showZones', zonesShown() ? '0' : '1'); } catch (e) {} applyZones(); }

  /* ---- the keeper's view ---- */
  function gkShown() { try { return localStorage.getItem('thplay.showGk') === '1'; } catch (e) { return false; } }
  function toggleGk() { try { localStorage.setItem('thplay.showGk', gkShown() ? '0' : '1'); } catch (e) {} applyGk(); updateGkView(); }

  /* ======================================================
     3D REPLAY CAMERA — a stylized orbit camera over the same tactics,
     built from js/manikin.js. Watch-only: dragging players stays 2D.
     ====================================================== */
  let scene3dCam = null, scene3dDrag = null, scene3dPinch = null, scene3dTarget = '';
  function scene3dShown() { try { return localStorage.getItem('thplay.show3d') === '1'; } catch (e) { return false; } }
  function scene3dSaveTarget(v) { try { localStorage.setItem('thplay.3dTarget', v || ''); } catch (e) {} }
  function scene3dLoadTarget() { try { return localStorage.getItem('thplay.3dTarget') || ''; } catch (e) { return ''; } }
  function toggle3d() { try { localStorage.setItem('thplay.show3d', scene3dShown() ? '0' : '1'); } catch (e) {} apply3d(); }
  function apply3d() {
    const on = scene3dShown(), b = $('scene3d-toggle'), cv = $('scene3d'), hint = $('scene3d-hint'), sel = $('scene3d-target');
    if (b) { b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    if (cv) cv.hidden = !on; if (hint) hint.hidden = !on; if (sel) sel.hidden = !on;
    if (on && !scene3dCam) scene3dCam = MANIKIN.makeCamera({});
    if (on) { resize3d(); draw3dNow(); }
  }
  function resize3d() {
    const cv = $('scene3d'); if (!cv) return;
    const wrap = cv.parentElement, r = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr));
    cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px';
  }
  /* project a world point, honouring the canvas's device-pixel size */
  function proj3(p) { const cv = $('scene3d'); return MANIKIN.project(scene3dCam, p, { w: cv.width, h: cv.height }); }
  /* lighten a #rrggbb hex by `amt` (0..1) toward white — used for the cap's sculpted highlight */
  function lighten(hex, amt) {
    const n = parseInt(hex.replace('#', ''), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const mix = (c) => Math.round(c + (255 - c) * amt);
    return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
  }
  function draw3d(scene) {
    const cv = $('scene3d'); if (!cv || cv.hidden) return;
    const ctx = cv.getContext('2d'); if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#050e17'; ctx.fillRect(0, 0, cv.width, cv.height);   // above the water — deck / air
    const pool = MANIKIN.worldPool();
    const corners = [{ x: -pool.halfLen, y: 0, z: -pool.halfWid }, { x: pool.halfLen, y: 0, z: -pool.halfWid }, { x: pool.halfLen, y: 0, z: pool.halfWid }, { x: -pool.halfLen, y: 0, z: pool.halfWid }].map(proj3);
    // the water itself — a filled, gently gradient surface, not a dry floor
    if (!corners.some(p => !p)) {
      const g = ctx.createLinearGradient(0, Math.min(...corners.map(p => p.y)), 0, Math.max(...corners.map(p => p.y)));
      g.addColorStop(0, 'rgba(24,110,140,.85)'); g.addColorStop(1, 'rgba(10,50,68,.92)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(corners[0].x, corners[0].y); corners.slice(1).forEach(p => ctx.lineTo(p.x, p.y)); ctx.closePath(); ctx.fill();
    }
    // lane markings on the water surface (not a court grid)
    ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = Math.max(1, cv.height / 480);
    for (let x = -Math.floor(pool.halfLen); x <= pool.halfLen; x += 5) { const a = proj3({ x, y: 0, z: -pool.halfWid }), b = proj3({ x, y: 0, z: pool.halfWid }); if (a && b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); } }
    // the same shot-chance zones as the 2D board, only when Zones is on
    if (zonesShown()) MANIKIN.zoneFloorQuads().forEach(q => {
      const c = [{ x: q.x0, y: 0, z: q.z0 }, { x: q.x1, y: 0, z: q.z0 }, { x: q.x1, y: 0, z: q.z1 }, { x: q.x0, y: 0, z: q.z1 }].map(proj3);
      if (c.some(p => !p)) return;
      ctx.fillStyle = q.color + '40'; ctx.beginPath(); ctx.moveTo(c[0].x, c[0].y); c.slice(1).forEach(p => ctx.lineTo(p.x, p.y)); ctx.closePath(); ctx.fill();
    });
    // goals (both ends, for context and depth)
    ctx.strokeStyle = '#e6f6fb'; ctx.lineWidth = Math.max(1.4, cv.height / 260);
    MANIKIN.goalPosts().forEach(g => g.segs.forEach(seg => { const a = proj3(seg[0]), b = proj3(seg[1]); if (a && b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); } }));
    // a small ripple under each player — everyone is at the surface, nothing stands on a floor
    scene.mannequins.forEach(m => { const rp = proj3({ x: m.pos.x, y: 0, z: m.pos.z }); if (!rp) return;
      ctx.strokeStyle = 'rgba(230,250,255,.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(rp.x, rp.y, rp.scale * 0.22, rp.scale * 0.22 * 0.35, 0, 0, TAU_LOCAL); ctx.stroke();
    });
    // mannequins — upper body only, farthest first (painter's algorithm)
    const withDepth = scene.mannequins.map(m => ({ m, d: (proj3({ x: m.pos.x, y: 0, z: m.pos.z }) || { depth: 1e9 }).depth })).sort((a, b) => b.d - a.d);
    withDepth.forEach(({ m }) => {
      const cap = MANIKIN.CAP[m.team] || MANIKIN.CAP.A;
      const pts = {}; let any = false;
      Object.keys(m.joints).forEach(k => { const pr = proj3(m.joints[k]); pts[k] = pr; if (pr) any = true; });
      if (!any) return;
      const px = pts.neck ? pts.neck.scale : 50;   // pixels per metre at this mannequin's depth
      // a neutral, sculpted mannequin body — no gender, no skin tone; the cap alone carries the team
      const skinLine = '#5a6469';
      const skinGrad = (x0, y0, x1, y1) => { const g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, '#e3e9ec'); g.addColorStop(1, '#a7b2b8'); return g; };
      // torso: a filled, tapered panel — shoulders wide, waist narrower, lightly shaded like a sculpted figure
      if (pts.lShoulder && pts.rShoulder && pts.hip) {
        const hipHalfW = Math.abs(pts.rShoulder.x - pts.lShoulder.x) * 0.5 * 0.55;
        const rHipPt = { x: pts.hip.x + hipHalfW, y: pts.hip.y }, lHipPt = { x: pts.hip.x - hipHalfW, y: pts.hip.y };
        ctx.fillStyle = skinGrad(pts.lShoulder.x, 0, pts.rShoulder.x, 0); ctx.strokeStyle = skinLine; ctx.lineWidth = Math.max(1, px * 0.02);
        ctx.beginPath(); ctx.moveTo(pts.lShoulder.x, pts.lShoulder.y); ctx.lineTo(pts.rShoulder.x, pts.rShoulder.y);
        ctx.lineTo(rHipPt.x, rHipPt.y); ctx.lineTo(lHipPt.x, lHipPt.y);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      // arms: rounded, body-toned capsules — no legs, ever
      ctx.strokeStyle = '#c3cdd2'; ctx.lineWidth = Math.max(2.2, px * 0.075); ctx.lineCap = 'round';
      MANIKIN.BONES.forEach(([a, b]) => { if (pts[a] && pts[b]) { ctx.beginPath(); ctx.moveTo(pts[a].x, pts[a].y); ctx.lineTo(pts[b].x, pts[b].y); ctx.stroke(); } });
      // the cap: crown + two prominent ear guards + a chin strap with tied-off ends, all in the team colour
      if (pts.head) {
        const r = Math.max(2.5, pts.head.scale * 0.15);
        if (pts.chin) {
          ctx.strokeStyle = cap.stroke; ctx.lineWidth = Math.max(1, r * 0.13); ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(pts.head.x - r * 0.62, pts.head.y + r * 0.48); ctx.lineTo(pts.chin.x, pts.chin.y); ctx.lineTo(pts.head.x + r * 0.62, pts.head.y + r * 0.48); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(pts.chin.x, pts.chin.y); ctx.lineTo(pts.chin.x - r * 0.08, pts.chin.y + r * 0.5); ctx.stroke();   // the tied-off strap ends that hang below the chin
          ctx.beginPath(); ctx.moveTo(pts.chin.x, pts.chin.y); ctx.lineTo(pts.chin.x + r * 0.1, pts.chin.y + r * 0.4); ctx.stroke();
        }
        const capGrad = (cx, cy, rad) => { const g = ctx.createRadialGradient(cx - rad * 0.35, cy - rad * 0.4, rad * 0.1, cx, cy, rad * 1.15); g.addColorStop(0, lighten(cap.fill, 0.35)); g.addColorStop(1, cap.fill); return g; };
        [pts.lEar, pts.rEar].forEach(ep => { if (!ep) return; const er = r * 0.52; ctx.fillStyle = capGrad(ep.x, ep.y, er); ctx.beginPath(); ctx.arc(ep.x, ep.y, er, 0, TAU_LOCAL); ctx.fill(); ctx.strokeStyle = cap.stroke; ctx.lineWidth = 1; ctx.stroke(); });
        ctx.fillStyle = capGrad(pts.head.x, pts.head.y, r); ctx.beginPath(); ctx.arc(pts.head.x, pts.head.y, r, 0, TAU_LOCAL); ctx.fill(); ctx.strokeStyle = cap.stroke; ctx.lineWidth = 1; ctx.stroke();
        if (m.key !== 'GK') { ctx.fillStyle = cap.stroke === '#000' ? '#fff' : '#0b1f2c'; const fs = Math.max(7, pts.head.scale * 0.19); ctx.font = '700 ' + fs + 'px Helvetica, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(m.key.replace(/^[AD]/, ''), pts.head.x, pts.head.y + fs * 0.32); }
      }
    });
    // the ball
    if (scene.ball) { const bp = proj3(scene.ball); if (bp) { ctx.fillStyle = '#ff7a18'; ctx.beginPath(); ctx.arc(bp.x, bp.y, Math.max(2, bp.scale * 0.10), 0, TAU_LOCAL); ctx.fill(); } }
  }
  const TAU_LOCAL = Math.PI * 2;
  function scene3dCurrentScenario() { return state.scenarios.find(x => x.id === state.selectedId); }
  function scene3dCurrentT() {
    if (adjust.live && adjust.scn) { const n = Math.max(1, adjust.scn.frames.length - 1); return n ? adjust.idx / n : 0; }
    return state.viewer ? state.viewer.t : 0;
  }
  function draw3dNow() {
    if (!scene3dShown() || typeof MANIKIN === 'undefined') return;
    const scn = adjust.live && adjust.scn ? adjust.scn : scene3dCurrentScenario();
    if (!scn) return;
    const scene = MANIKIN.sceneAt(scn, scene3dCurrentT(), {});
    // "switch player or ball view" — the camera target follows the chosen entity every frame
    if (scene3dTarget === 'ball' && scene.ball) scene3dCam.target = { x: scene.ball.x, y: 0.4, z: scene.ball.z };
    else if (scene3dTarget) { const m = scene.mannequins.find(x => x.key === scene3dTarget || x.key === 'A' + scene3dTarget || x.key === 'D' + scene3dTarget); if (m) scene3dCam.target = { x: m.pos.x, y: 0.45, z: m.pos.z }; }
    draw3d(scene);
  }
  function wire3dInteraction() {
    const cv = $('scene3d'); if (!cv) return;
    const pointers = new Map();
    const dist2 = () => { const p = [...pointers.values()]; return p.length === 2 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : null; };
    cv.addEventListener('pointerdown', e => { pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pointers.size === 1) scene3dDrag = { x: e.clientX, y: e.clientY }; else scene3dPinch = dist2(); cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', e => {
      if (!pointers.has(e.pointerId)) return; pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size >= 2) { const d = dist2(); if (scene3dPinch && d) { scene3dCam = MANIKIN.orbit(scene3dCam, 0, 0, (scene3dPinch - d) * 0.03); scene3dPinch = d; draw3dNow(); } return; }
      if (!scene3dDrag) return;
      const dx = e.clientX - scene3dDrag.x, dy = e.clientY - scene3dDrag.y; scene3dDrag = { x: e.clientX, y: e.clientY };
      scene3dCam = MANIKIN.orbit(scene3dCam, -dx * 0.008, -dy * 0.006, 0); draw3dNow();
    });
    const up = e => { pointers.delete(e.pointerId); if (pointers.size < 2) scene3dPinch = null; if (pointers.size === 0) scene3dDrag = null; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', e => { e.preventDefault(); scene3dCam = MANIKIN.orbit(scene3dCam, 0, 0, e.deltaY * 0.01); draw3dNow(); }, { passive: false });
    cv.addEventListener('dblclick', () => { scene3dCam = MANIKIN.makeCamera({}); draw3dNow(); });
  }
  function applyGk() {
    const on = gkShown(), b = $('gk-toggle');
    if (b) { b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    const panel = $('gk-view'); if (panel && !on) panel.hidden = true;
  }
  function currentBoardFrame() {
    if (adjust.live && adjust.scn) return adjust.scn.frames[adjust.idx];
    const scn = state.scenarios.find(x => x.id === state.selectedId);
    if (!scn) return null;
    if (state.viewer && typeof ANIM.stateAt === 'function') { try { return ANIM.stateAt(scn, state.viewer.t); } catch (e) {} }
    return scn.frames[0];
  }
  function markedShotFrame() {
    const scn = adjust.live && adjust.scn ? adjust.scn : state.scenarios.find(x => x.id === state.selectedId);
    if (!scn) return null;
    const i = adjust.live ? adjust.idx : (state.viewer ? state.viewer.currentStep() : 0);
    const f = scn.frames[i], n = scn.frames[i + 1];
    if (f && f.shot) return f.shot;
    if (n && n.shot) return n.shot;
    return null;
  }
  function drawGoalMouth(view) {
    const svgEl = $('gkv-goal'); if (!svgEl) return;
    while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
    const X0 = 6, X1 = 114, Y0 = 6, Y1 = 38, W = X1 - X0, H = Y1 - Y0;
    const add = (tag, at) => { const e = POOL.svg(tag, at); svgEl.appendChild(e); return e; };
    add('rect', { x: X0, y: Y0, width: W, height: H, rx: 1.5, fill: '#06131c', stroke: '#e6f6fb', 'stroke-width': 1.6 });
    for (let i = 1; i < 6; i++) add('line', { x1: X0 + W * i / 6, y1: Y0, x2: X0 + W * i / 6, y2: Y1, stroke: '#e6f6fb', 'stroke-width': 0.3, opacity: 0.25 });
    if (view.bestGap && view.bestGap.size > 0.06)
      add('rect', { x: X0 + view.bestGap.a * W, y: Y0, width: (view.bestGap.b - view.bestGap.a) * W, height: H,
        fill: '#2ecc71', 'fill-opacity': 0.28, stroke: '#2ecc71', 'stroke-width': 1, 'stroke-dasharray': '3 2' });
    (view.blockers || []).forEach(b => add('rect', { x: X0 + b.a * W, y: Y0 + H * 0.28, width: Math.max(1.5, (b.b - b.a) * W), height: H * 0.72,
      fill: '#0b1b25', 'fill-opacity': 0.9, stroke: '#8fb8ff', 'stroke-width': 0.8 }));
    if (view.keeper) {
      // the keeper reaches roughly two-thirds of the 0.9 m cage height — never floor to crossbar
      const kx = X0 + view.keeper.a * W, kw = Math.max(3, (view.keeper.b - view.keeper.a) * W);
      add('rect', { x: kx, y: Y0 + H * 0.34, width: kw, height: H * 0.66, rx: 2, fill: '#e2413a', 'fill-opacity': 0.85, stroke: '#ffdede', 'stroke-width': 0.8 });
    }
    add('line', { x1: X0, y1: Y1, x2: X1, y2: Y1, stroke: '#3fd0e0', 'stroke-width': 2 });      // water line
    const t = add('text', { x: X0 + W / 2, y: 46, 'text-anchor': 'middle', 'font-size': 5.4, fill: '#9fd7e4', 'font-family': 'Helvetica, Arial, sans-serif' });
    t.textContent = view.keeperMissing
      ? 'no keeper in this step'
      : 'keeper + blockers cover ~' + (Math.round(view.coverPct * 10) * 10) + '% of the width';
  }
  function updateGkView() {
    const panel = $('gk-view'); if (!panel) return;
    const scn = state.scenarios.find(x => x.id === state.selectedId);
    if (!gkShown() || !scn || state.mode === 'problem' || typeof SHOT === 'undefined') { panel.hidden = true; return; }
    const f = currentBoardFrame(); if (!f) { panel.hidden = true; return; }
    const marked = markedShotFrame();
    const c = SHOT.chance(f, { shooter: marked ? marked.by : null, manUp: scn.situation === '6v5' || scn.situation === '5v4' });
    if (!c) { panel.hidden = true; return; }
    drawGoalMouth(c);
    const pct = v => Math.round(v * 100) + '%';
    $('gkv-badge').hidden = !marked;
    if (marked) $('gkv-badge').textContent = marked.kind === 'lob' ? 'LOB' : 'SHOT';
    $('gkv-nums').innerHTML =
      `<span class="gkv-n gkv-shoot"><b>${pct(c.shootPct)}</b> shoot</span>` +
      `<span class="gkv-n gkv-lob"><b>${pct(c.lobPct)}</b> lob</span>` +
      `<span class="gkv-n">${c.blockerCount} in the lane</span>` +
      (c.keeperOutM == null ? '<span class="gkv-n">no keeper</span>' : `<span class="gkv-n">keeper ${c.keeperOutM} m out</span>`) +
      `<span class="gkv-n">${c.distanceM} m · ${c.angleDeg}°</span>` +
      `<span class="gkv-n gkv-zone gkv-${c.zone}">${c.zone}</span>`;
    $('gkv-advice').textContent = c.advice;
    const menuData = SHOT.shotOptions(f, { shooter: marked ? marked.by : null, manUp: scn.situation === '6v5' || scn.situation === '5v4' });
    const TIER = { best: '★ best', good: 'good', risky: 'risky' };
    const menu = $('gkv-menu');
    if (menu) menu.innerHTML = menuData.options.map(o =>
      `<div class="gkv-opt gkv-opt-${o.tier}"><span class="gkv-opt-h"><b>${escapeHtml(o.label)}</b><span class="gkv-tier gkv-tier-${o.tier}">${TIER[o.tier]}</span></span><span class="gkv-opt-cue">${escapeHtml(o.cue)}</span></div>`
    ).join('');
    const kn = $('gkv-keeper'); if (kn) kn.textContent = menuData.keeperNote || '';
    const basis = $('gkv-basis'); if (basis) basis.textContent = c.basis + ' ' + c.lobBasis + ' ' + (menuData.basis || '');
    panel.hidden = false;
  }
  function buildViewer(t0, andPlay) {
    const scn = state.scenarios.find(s=>s.id===state.selectedId);
    if (!scn) return;
    wasPlaying = false;
    state.renderer = new ANIM.Renderer($('pool'));
    state.viewer = new ANIM.Player(state.renderer, scn, onViewerFrame);
    state.viewer.setOnState(onPlayState);
    state.viewer.setFocus(state.focus);
    applySteps();
    paintZones(state.renderer && state.renderer.layers);
    if (state.viewer.setSpeed) state.viewer.setSpeed(savedSpeed());
    updateMyCue(); lastGkStep = -1; updateGkView(); draw3dNow();
    if (t0) state.viewer.seek(t0);
    if (andPlay) state.viewer.play();
  }

  function setMode(mode, autoplay) {
    if (adjust.dirty) { toast('Save or cancel your changes first'); return; }
    if (adjust.live) exitPausedEditToViewer(0, false);
    state.mode = mode;
    applyMode();
    if (mode==='solution' && autoplay && state.viewer) state.viewer.play();
  }
  function applyMode() {
    const scn = state.scenarios.find(s=>s.id===state.selectedId);
    const problem = state.mode==='problem';
    document.querySelectorAll('#mode-toggle .mode-btn').forEach(b=> b.classList.toggle('active', b.dataset.mode===state.mode));
    $('problem-overlay').hidden = !problem;
    $('controls').hidden = problem;
    $('scenario-desc').style.display = problem ? 'none' : '';
    if (state.viewer) {
      if (problem) { state.viewer.stop(); state.viewer.seek(0); state.viewer.setPaths(false); }
      else { state.viewer.setPaths(stepsShown()); }
    }
    if (problem && scn) {
      const sd = DATA.sit(scn.situation);
      $('problem-prompt').textContent = scn.phase==='defense'
        ? `${sd.label} — they have the ball. How do we defend it?`
        : `${sd.label} — we have the ball. How do we score from here?`;
    }
    if (scn) renderAssignments(scn);
    updateAudibleBtn();
  }
  function defaultFocus() {
    if (state.user.role==='player' && state.user.position) return state.user.position;
    return $('focus-pos').value || null;
  }
  function onViewerFrame(t, step, segCount) {
    $('scrub').value = Math.round(t*1000);
    const total = (segCount!=null?segCount:(state.viewer?state.viewer.segCount():0)) + 1;
    $('frame-label').textContent = `Step ${Math.min(total, step+1)} / ${total}`;
    const fl = $('fsb-label'); if (fl) fl.textContent = `Step ${Math.min(total, step+1)} / ${total}`;
    updateMyCue(step, total);
    if (step !== lastGkStep) { lastGkStep = step; updateGkView(); }   // once per step, not per frame
    draw3dNow();   // the 3D camera redraws every tick — it's animating the same interpolated motion
  }
  let lastGkStep = -1;
  /* ---- "what do I do now?" — one line for the focused player, per step ---- */
  function cueFor(scn, pos, step) {
    const fr = scn.frames, n = fr.length, i = Math.max(0, Math.min(step, n - 1));
    const a = fr[i], b = fr[Math.min(i + 1, n - 1)];
    const pa = pos === 'GK' ? a.gk : a.att[pos], pb = pos === 'GK' ? b.gk : b.att[pos];
    const parts = [];
    if (pa && pb && i < n - 1) {
      const dx = pb.x - pa.x, dy = pb.y - pa.y, d = Math.hypot(dx, dy);
      if (d >= 14) {
        const toGoal = dx > 8, deep = pb.x >= 265, lateral = Math.abs(dy) > Math.abs(dx);
        if (pos === 'GK') parts.push(toGoal ? 'drop back to the line' : 'come out to close the angle');
        else if (deep && toGoal) parts.push('drive to 2 m');
        else if (toGoal) parts.push('drive towards the goal');
        else if (lateral) parts.push(dy < 0 ? 'slide to the left wing side' : 'slide to the right wing side');
        else parts.push('move out to the top');
      }
    }
    const me = pos === 'GK' ? 'GK' : 'A' + pos, ca = a.ball && a.ball.carrier, cb = b.ball && b.ball.carrier;
    if (i < n - 1) {
      if (cb === me && ca !== me) parts.push('receive the pass');
      if (ca === me && cb && cb !== me) parts.push('pass to ' + String(cb).replace(/^A/, ''));
      if (b.shot && String(b.shot.by) === String(pos)) parts.push(b.shot.kind === 'lob' ? 'lob it over the keeper' : 'shoot');
      else if (ca === me && !cb && b.ball && b.ball.x != null && b.ball.x >= 285) parts.push('shoot');
      if (ca === me && cb === me && !parts.length) parts.push('keep the ball, read the defence');
    }
    if (!parts.length) parts.push(i >= n - 1 ? 'finish — hold your position' : 'hold your position, stay ready');
    const title = parts.map((x, k) => k ? x : x.charAt(0).toUpperCase() + x.slice(1)).join(', then ');
    return { title, note: ((scn.notes && scn.notes[pos]) || '').trim() };
  }
  function updateMyCue(step, total) {
    const box = $('my-cue'); if (!box) return;
    const scn = state.scenarios.find(x => x.id === state.selectedId);
    const pos = state.focus;
    if (!scn || !pos || state.mode === 'problem') { box.hidden = true; return; }
    const st = step != null ? step : (state.viewer ? state.viewer.currentStep() : 0);
    const tot = total != null ? total : ((state.viewer ? state.viewer.segCount() : Math.max(0, scn.frames.length - 1)) + 1);
    const c = cueFor(scn, pos, st);
    $('mc-who').textContent = `${pos === state.user.position ? 'You' : 'Player'} (${pos}) · step ${Math.min(tot, st + 1)} / ${tot}`;
    $('mc-text').textContent = c.title; $('mc-note').textContent = c.note; $('mc-note').hidden = !c.note;
    box.hidden = false;
  }
  /* ---- playback speed (remembered) + full-screen board ---- */
  function savedSpeed() { try { return +(localStorage.getItem('thplay.speed') || 1) || 1; } catch (e) { return 1; } }
  function applySpeed(v) {
    v = +v || 1; try { localStorage.setItem('thplay.speed', String(v)); } catch (e) {}
    document.querySelectorAll('#speed-seg [data-speed], #fsb-speed [data-speed]').forEach(b => b.classList.toggle('active', +b.dataset.speed === v));
    if (state.viewer && state.viewer.setSpeed) state.viewer.setSpeed(v);
  }
  /* Floating controls on the full-screen board.
     Free-flow: grab them anywhere (or by the ⠿ grip) and drop them where you want;
     the spot is remembered as a fraction of the board, so it survives a resize.
     They fade out whenever you are not touching them. */
  let fsHideTimer = null, fsDragging = false;
  const FSBAR_KEY = 'thplay.fsbar';
  function fsBarPos() { try { const p = JSON.parse(localStorage.getItem(FSBAR_KEY) || 'null'); return (p && isFinite(p.fx) && isFinite(p.fy)) ? p : null; } catch (e) { return null; } }
  const fsClamp01 = v => Math.max(0, Math.min(1, isFinite(v) ? v : 0.5));
  function fsBarPlace(fx, fy, save) {
    const bar = $('fs-bar'), wrap = document.querySelector('#view-playbook .pool-wrap'); if (!bar || !wrap) return;
    fx = fsClamp01(fx); fy = fsClamp01(fy);
    const w = wrap.clientWidth || 0, h = wrap.clientHeight || 0, bw = bar.offsetWidth || 0, bh = bar.offsetHeight || 0;
    const x = Math.max(0, Math.min(Math.max(0, w - bw), fx * w - bw / 2));
    const y = Math.max(0, Math.min(Math.max(0, h - bh), fy * h - bh / 2));
    bar.style.left = x + 'px'; bar.style.top = y + 'px';
    bar.classList.add('placed');
    if (save) { try { localStorage.setItem(FSBAR_KEY, JSON.stringify({ fx: +fx.toFixed(4), fy: +fy.toFixed(4) })); } catch (e) {} }
  }
  function fsBarReset() {
    const bar = $('fs-bar'); if (!bar) return;
    bar.classList.remove('placed'); bar.style.left = ''; bar.style.top = '';
    try { localStorage.removeItem(FSBAR_KEY); } catch (e) {}
    toast('Controls back at the bottom');
  }
  function fsBarApplyStored() { const p = fsBarPos(); if (p) fsBarPlace(p.fx, p.fy, false); }
  function fsBarShow(persist) {
    const bar = $('fs-bar'); if (!bar || !$('view-playbook').classList.contains('stage-full')) return;
    bar.hidden = false; bar.classList.add('show'); fsBarApplyStored();
    clearTimeout(fsHideTimer);
    if (persist) return;                                   // stay while a finger / the mouse is on the bar
    fsHideTimer = setTimeout(() => { if (!fsDragging && !fsBarHovered()) bar.classList.remove('show'); }, 2500);
  }
  function fsBarHovered() { const bar = $('fs-bar'); try { return !!(bar && bar.matches(':hover')); } catch (e) { return false; } }
  function fsBarFade() { const bar = $('fs-bar'); if (!bar || fsDragging) return; clearTimeout(fsHideTimer); bar.classList.remove('show'); }
  function fsBarHide() { const bar = $('fs-bar'); if (!bar) return; clearTimeout(fsHideTimer); fsDragging = false; bar.classList.remove('show'); bar.hidden = true; }
  function wireFsDrag() {
    const bar = $('fs-bar'), wrap = document.querySelector('#view-playbook .pool-wrap'); if (!bar || !wrap) return;
    let dx = 0, dy = 0, fx = 0.5, fy = 0.9;
    // the move/up listeners live on the document, so a fast drag never "escapes" the bar
    const move = e => {
      if (!fsDragging) return;
      const wr = wrap.getBoundingClientRect(), bw = bar.offsetWidth, bh = bar.offsetHeight;
      fx = wr.width ? (e.clientX - wr.left - dx + bw / 2) / wr.width : 0.5;
      fy = wr.height ? (e.clientY - wr.top - dy + bh / 2) / wr.height : 0.9;
      fsBarPlace(fx, fy, false);
      if (e.cancelable) e.preventDefault();
    };
    const drop = () => {
      if (!fsDragging) return;
      fsDragging = false; bar.classList.remove('dragging');
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', drop, true);
      document.removeEventListener('pointercancel', drop, true);
      fsBarPlace(fx, fy, true);
      fsBarShow();
    };
    bar.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;              // buttons still click
      const r = bar.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
      dx = e.clientX - r.left; dy = e.clientY - r.top; fsDragging = true;
      fx = wr.width ? (r.left + r.width / 2 - wr.left) / wr.width : 0.5;
      fy = wr.height ? (r.top + r.height / 2 - wr.top) / wr.height : 0.9;
      bar.classList.add('dragging'); fsBarShow(true);
      document.addEventListener('pointermove', move, true);
      document.addEventListener('pointerup', drop, true);
      document.addEventListener('pointercancel', drop, true);
      if (e.cancelable) e.preventDefault();
    });
    bar.addEventListener('pointerenter', () => fsBarShow(true));
    bar.addEventListener('pointerleave', () => { if (!fsDragging) fsBarShow(); });
    const grip = $('fsb-grip'); if (grip) grip.addEventListener('dblclick', e => { e.stopPropagation(); fsBarReset(); fsBarShow(); });
  }
  function toggleFull(force) {
    const lay = $('view-playbook'); if (!lay) return;
    const on = force == null ? !lay.classList.contains('stage-full') : !!force;
    lay.classList.toggle('stage-full', on);
    if (on) fsBarShow(); else fsBarHide();
    if (scene3dShown()) setTimeout(() => { resize3d(); draw3dNow(); }, 30);   // .pool-wrap just changed size
    const b = $('fs-btn'); if (b) { b.classList.toggle('active', on); b.title = on ? 'Leave full screen (Esc)' : 'Full-screen board (Esc to leave)'; }
    try { if (on && document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {}); else if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch (e) {}
  }
  function syncFocusUI() {
    $('view-team').classList.toggle('active', state.viewMode==='team');
    $('view-me').classList.toggle('active', state.viewMode==='me');
    $('focus-pos').value = state.focus || '';
  }
  function renderAssignments(scn) {
    const wrap = $('assign-list'); wrap.innerHTML='';
    const masked = state.mode==='problem';
    wrap.classList.toggle('masked', masked);
    if (masked) {
      const note = document.createElement('div');
      note.className='assign-mask-note';
      note.textContent = 'Think it through first — reveal the solution to see what each position does.';
      wrap.appendChild(note);
    }
    const order = ['1','2','3','4','5','6','GK'];
    const sd = DATA.sit(scn.situation);
    order.forEach(pos => {
      const note = (scn.notes && scn.notes[pos]) || '';
      const inPlay = pos==='GK' ? true : Number(pos) <= sd.att || (note && note.trim());
      const isMine = state.user.position===pos;
      const row = document.createElement('button');
      row.className = 'assign-row' + (isMine?' mine':'') + (state.focus===pos?' focused':'') + (inPlay?'':' faded');
      row.innerHTML = `<span class="assign-badge ${pos==='GK'?'gk':'att'}">${pos}</span>
        <span class="assign-text">${note?escapeHtml(note):'<em>No specific assignment</em>'}</span>`;
      row.onclick = () => setFocus(pos);
      wrap.appendChild(row);
    });
  }
  function setFocus(pos) {
    if (state.focus===pos) { state.focus=null; state.viewMode='team'; }
    else { state.focus=pos; state.viewMode='me'; }
    if (state.viewer) state.viewer.setFocus(state.focus);
    syncFocusUI();
    const scn = state.scenarios.find(s=>s.id===state.selectedId); if (scn) renderAssignments(scn);
  }

  /* ======================================================
     SOLUTIONS LAB — ask a tactical question, get a worked
     solution: what to do + the rules + an animated board.
     ====================================================== */
  const sol = { openId:null, player:null };
  function renderSolutions() {
    const c = $('view-solutions');
    if (typeof SOLVER==='undefined') { c.innerHTML = '<div class="muted">Solutions unavailable.</div>'; return; }
    c.innerHTML = `<div class="sol-wrap">
      <div class="dash-head with-mascot">${(typeof FX!=='undefined')?FX.mascot(38):''}
        <div><h1>Solutions Lab <button class="help-chip" data-help="solutions" title="How Solutions work">？</button></h1>
        <p class="dash-sub">Ask a situation in your own words — get what to do, the rules, and a play on the board.</p></div></div>
      <div class="sol-ask">
        <input type="text" id="sol-search" placeholder="e.g. I swim alone at the keeper who comes out to 5 m — what do I do, can they foul me?" />
        <button class="btn-primary sm" id="sol-go">Solve</button>
      </div>
      <div class="sol-ex">Try:
        ${['Alone on the keeper who comes out','2-on-1 fast break','They double-team our hole','How do I draw a kick-out','Defend the counter-attack']
          .map(x=>`<button class="sol-chip" data-sol-ex="${escapeHtml(x)}">${escapeHtml(x)}</button>`).join('')}
      </div>
      <div class="sol-body">
        <div class="sol-results" id="sol-results"></div>
        <div class="sol-detail" id="sol-detail"><div class="sol-empty">Pick a question on the left, or ask your own above.</div></div>
      </div>
    </div>`;
    $('sol-go').onclick = () => runSolve($('sol-search').value);
    $('sol-search').addEventListener('keydown', e => { if (e.key==='Enter') runSolve($('sol-search').value); });
    c.querySelectorAll('[data-sol-ex]').forEach(b => b.onclick = () => { $('sol-search').value = b.dataset.solEx; runSolve(b.dataset.solEx); });
    listSolutions(SOLVER.PROBLEMS.map(p=>({problem:p})));   // default: show all
    if (sol.openId) openSolution(sol.openId);
  }
  function runSolve(text) {
    const res = (text && text.trim()) ? SOLVER.ask(text) : SOLVER.PROBLEMS.map(p=>({problem:p}));
    const wrap = $('sol-results');
    if (!res.length) {
      wrap.innerHTML = `<div class="sol-none">No exact match — here’s the closest ideas.</div>`;
      listSolutions(SOLVER.PROBLEMS.slice(0,5).map(p=>({problem:p})), true);
      return;
    }
    listSolutions(res);
    openSolution(res[0].problem.id);   // jump straight to the best answer
  }
  function listSolutions(items, append) {
    const wrap = $('sol-results');
    if (!append) wrap.innerHTML = '';
    items.forEach(({problem:p}) => {
      const b = document.createElement('button');
      b.className = 'sol-card' + (sol.openId===p.id?' active':'');
      b.dataset.sol = p.id;
      b.innerHTML = `<span class="sol-card-tag ${p.phase}">${p.phase}</span>
        <span class="sol-card-title">${escapeHtml(p.title)}</span>
        <span class="sol-card-q">${escapeHtml(p.q)}</span>`;
      b.onclick = () => openSolution(p.id);
      wrap.appendChild(b);
    });
  }
  function openSolution(id) {
    const p = SOLVER.byId[id]; if (!p) return;
    sol.openId = id;
    document.querySelectorAll('.sol-card').forEach(c => c.classList.toggle('active', c.dataset.sol===id));
    const b = SOLVER.board(id);
    $('sol-detail').innerHTML = `
      <div class="sol-head"><span class="sol-card-tag ${p.phase}">${p.phase}</span><h2>${escapeHtml(p.title)}</h2></div>
      <p class="sol-q">“${escapeHtml(p.q)}”</p>
      <div class="sol-cols">
        <div class="sol-board-wrap">
          <svg id="sol-pool" viewBox="0 0 320 262" preserveAspectRatio="xMidYMid meet" aria-label="Solution board"></svg>
          <div class="sol-board-btns">
            <button class="btn-ghost sm" id="sol-replay">▶ Replay</button>
            <button class="btn-primary sm" id="sol-save">Save as a play</button>
          </div>
        </div>
        <div class="sol-text">
          <h3>What to do</h3>
          <ul class="sol-steps">${p.answer.map(a=>`<li>${escapeHtml(a)}</li>`).join('')}</ul>
          <h3>The rules</h3>
          <div class="sol-rules">${p.rules.map(r=>`<div class="sol-rule"><strong>${escapeHtml(r.q)}</strong><span>${escapeHtml(r.a)}</span></div>`).join('')}</div>
        </div>
      </div>`;
    $('sol-replay').onclick = () => playSolutionBoard(id);
    $('sol-save').onclick = () => saveSolutionAsPlay(id);
    playSolutionBoard(id);
  }
  function playSolutionBoard(id) {
    const b = SOLVER.board(id); if (!b) return;
    if (sol.player) { try { sol.player.stop(); } catch(e){} }
    const scn = { id:'sol-'+id, title:SOLVER.byId[id].title, situation:b.situation, phase:b.phase, frames:b.frames, notes:b.notes };
    const renderer = new ANIM.Renderer($('sol-pool'));
    sol.player = new ANIM.Player(renderer, scn, ()=>{});
    sol.player.setPaths(true);
    sol.player.seek(0);
    sol.player.play();
  }
  function saveSolutionAsPlay(id) {
    const p = SOLVER.byId[id]; const b = SOLVER.board(id); if (!b) return;
    if (!canEdit()) { toast('Coaches & trainers can save plays'); return; }
    const scn = {
      id: 'usr-' + Math.abs(hash('sol'+id+(state.user.email||''))),
      title: p.title + ' — solution', description: p.q,
      situation: b.situation, phase: b.phase,
      frames: DATA.clone(b.frames), notes: DATA.clone(b.notes||{}),
      author: state.user.name || 'You', builtIn: false,
    };
    const existing = state.scenarios.findIndex(x=>x.id===scn.id);
    if (existing>=0) state.scenarios[existing]=scn; else state.scenarios.push(scn);
    DATA.save(state.scenarios);
    DATA.logActivity('play', `${state.user.name} saved solution “${scn.title}”`, state.user.name);
    // jump the playbook to this play's situation/phase so it shows in the list
    state.situation = scn.situation; state.phase = scn.phase;
    switchView('playbook');
    document.querySelectorAll('#main-nav .nav-btn').forEach(x=>x.classList.toggle('active', x.dataset.view==='playbook'));
    refreshTabs(); renderLibrary();
    openScenario(scn.id);
    toast('Saved to your playbook ✓');
  }

  /* ======================================================
     SEASON — goal → periodised training plan + a calendar that
     exports/subscribes to iOS / Android / Windows via iCalendar.
     ====================================================== */
  const season = { plan: null };
  const FOCUS_LIST = [['endurance','Endurance'],['strength','Strength'],['power','Speed & power'],['shooting','Shooting'],['skills','Ball skills'],['tactics','Tactics']];
  function d2(n){ return String(n).padStart(2,'0'); }
  function isoDay(d){ return `${d.getFullYear()}-${d2(d.getMonth()+1)}-${d2(d.getDate())}`; }
  function fmtDay(iso){ const d=new Date(iso); return d.toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short'}); }
  function fmtTime(iso){ const d=new Date(iso); return d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}); }

  function renderSeason() {
    const c = $('view-season');
    if (typeof PLANNER==='undefined' || typeof CALENDAR==='undefined') { c.innerHTML='<div class="muted">Season tools unavailable.</div>'; return; }
    const today = new Date(); const target = new Date(today.getTime()+70*86400000);
    c.innerHTML = `<div class="season-wrap">
      <div class="dash-head with-mascot">${(typeof FX!=='undefined')?FX.mascot(38):''}
        <div><h1>Season <button class="help-chip" data-help="season" title="How Season works">？</button></h1>
        <p class="dash-sub">Set a goal → get a periodised plan, and a calendar your whole team can subscribe to.</p></div></div>

      <div class="season-cols">
        <section class="season-card">
          <h2>🎯 Goal → training plan</h2>
          <div class="goal-form">
            <label>Goal <input type="text" id="goal-title" placeholder="e.g. Peak for the play-offs" value="Peak for the play-offs"></label>
            <div class="goal-row">
              <label>Start <input type="date" id="goal-start" value="${isoDay(today)}"></label>
              <label>Peak by <input type="date" id="goal-target" value="${isoDay(target)}"></label>
              <label>Days/week
                <select id="goal-days">${[2,3,4,5,6].map(n=>`<option ${n===4?'selected':''}>${n}</option>`).join('')}</select>
              </label>
            </div>
            <div class="goal-focus"><span class="ef-label">Focus</span>
              ${FOCUS_LIST.map(([k,l])=>`<label class="chip-check"><input type="checkbox" value="${k}" ${['shooting','tactics'].includes(k)?'checked':''}> ${l}</label>`).join('')}
            </div>
            <button class="btn-primary sm" id="goal-generate">Generate plan</button>
          </div>
          <div id="plan-out"></div>
        </section>

        <section class="season-card">
          <h2>📅 Calendar</h2>
          <div class="cal-add">
            <div class="goal-row">
              <select id="ev-type">${Object.keys(CALENDAR.TYPES).map(t=>`<option value="${t}">${CALENDAR.TYPES[t]}</option>`).join('')}</select>
              <input type="text" id="ev-title" placeholder="Title (e.g. vs Red Sharks)">
            </div>
            <div class="goal-row">
              <input type="date" id="ev-date" value="${isoDay(today)}">
              <input type="time" id="ev-time" value="18:00">
              <input type="text" id="ev-loc" placeholder="Location">
            </div>
            <button class="btn-ghost sm" id="ev-add">＋ Add to calendar</button>
          </div>
          <div class="cal-actions">
            <button class="btn-ghost sm" id="cal-export">⬇ Export .ics</button>
            <button class="btn-ghost sm" id="cal-subscribe">🔗 Subscribe (all devices)</button>
          </div>
          <div id="cal-subscribe-out"></div>
          <div id="cal-agenda"></div>
        </section>
      </div>
    </div>`;

    $('goal-generate').onclick = generatePlanFromForm;
    $('ev-add').onclick = addCalendarEvent;
    $('cal-export').onclick = exportICS;
    $('cal-subscribe').onclick = publishFeed;
    if (season.plan) renderPlan();
    renderAgenda();
  }
  function goalFromForm() {
    return {
      title: $('goal-title').value.trim() || 'Season goal',
      startDate: $('goal-start').value, targetDate: $('goal-target').value,
      daysPerWeek: +$('goal-days').value,
      focus: [...document.querySelectorAll('.goal-focus input:checked')].map(i=>i.value),
    };
  }
  function generatePlanFromForm() {
    season.plan = PLANNER.generatePlan(goalFromForm());
    renderPlan();
    toast('Plan generated');
  }
  function renderPlan() {
    const p = season.plan; if (!p) return;
    const out = $('plan-out');
    const phases = p.mesocycles.map(m=>`<span class="phase-pill ${m.name.replace(/\W/g,'').toLowerCase()}">${escapeHtml(m.name)} · ${m.weeks}w</span>`).join('');
    const weeks = p.microcycles.map(mc=>`<details class="plan-week"><summary>
        <span class="pw-n">Week ${mc.week}</span><span class="pw-phase">${escapeHtml(mc.phase)}${mc.deload?' · deload':''}</span>
        <span class="pw-load"><i class="lv vol" style="width:${mc.load.volume}%"></i></span>
        <span class="pw-rpe">vol ${mc.load.volume} · int ${mc.load.intensity}</span></summary>
      <div class="pw-sessions">${mc.sessions.map(s=>`<div class="ses"><span class="ses-focus ${s.focus}">${escapeHtml(s.focus)}</span>
        <span class="ses-main"><strong>${escapeHtml(s.title)}</strong><span class="muted">${s.durationMin}min · RPE ${s.rpe} · ${escapeHtml((s.drills||[]).slice(0,2).join(' · '))}</span></span></div>`).join('')}</div>
      </details>`).join('');
    out.innerHTML = `<div class="plan-summary">Peak for <strong>${escapeHtml(new Date(p.goal.targetDate).toLocaleDateString())}</strong> · ${p.weeks} weeks · ${p.goal.daysPerWeek}/wk</div>
      <div class="phase-band">${phases}</div>
      <div class="plan-weeks">${weeks}</div>
      <button class="btn-primary sm" id="plan-tocal">＋ Add all ${PLANNER.planToEvents(p).length} sessions to the calendar</button>`;
    $('plan-tocal').onclick = () => {
      const evs = PLANNER.planToEvents(p);
      const cur = CALENDAR.load(); const ids = new Set(cur.map(e=>e.id));
      const add = evs.filter(e=>!ids.has(e.id));
      CALENDAR.save(cur.concat(add));
      toast(`${add.length} sessions added to the calendar`);
      renderAgenda();
    };
  }
  function addCalendarEvent() {
    const date = $('ev-date').value, time = $('ev-time').value || '18:00';
    if (!date) { toast('Pick a date'); return; }
    const start = new Date(`${date}T${time}`);
    const ev = { id: CALENDAR.uid(), type: $('ev-type').value, title: $('ev-title').value.trim() || 'Event',
      start: start.toISOString(), end: new Date(start.getTime()+90*60000).toISOString(),
      location: $('ev-loc').value.trim(), reminderMin: 120 };
    const all = CALENDAR.load(); all.push(ev); CALENDAR.save(all);
    $('ev-title').value=''; $('ev-loc').value='';
    toast('Event added'); renderAgenda();
  }
  function renderAgenda() {
    const wrap = $('cal-agenda'); if (!wrap) return;
    const items = CALENDAR.agenda(CALENDAR.load(), new Date(), 90);
    if (!items.length) { wrap.innerHTML = '<div class="muted" style="padding:12px">No upcoming events. Add a match or generate a plan.</div>'; return; }
    wrap.innerHTML = `<div class="ef-label" style="margin-top:12px">Next 90 days (${items.length})</div>` + items.map(e=>`
      <div class="agenda-row" data-ev="${escapeHtml(e.id)}">
        <span class="ag-date"><b>${fmtDay(e.start)}</b>${e.allDay?'':'<span class="muted">'+fmtTime(e.start)+'</span>'}</span>
        <span class="ag-main"><span class="ag-title">${(CALENDAR.TYPES[e.type]||'').split(' ')[0]} ${escapeHtml(e.title)}</span>
          ${e.location?`<span class="muted">${escapeHtml(e.location)}</span>`:''}</span>
        <button class="btn-ghost xs" data-del-ev="${escapeHtml(e.id)}" title="Remove">✕</button>
      </div>`).join('');
    wrap.querySelectorAll('[data-del-ev]').forEach(b=> b.onclick=()=>{ CALENDAR.save(CALENDAR.load().filter(e=>e.id!==b.dataset.delEv)); renderAgenda(); });
  }
  function downloadBlob(text, name, mime) {
    try { const blob = new Blob([text], { type: mime||'text/plain' }); const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
      setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 100); } catch(e){ toast('Download not supported here'); }
  }
  function exportICS() {
    const ev = CALENDAR.load();
    if (!ev.length) { toast('Nothing to export yet'); return; }
    downloadBlob(CALENDAR.toICS(ev, { name: 'Triibholz — ' + (state.user && state.user.name || 'Team') }), 'triibholz-season.ics', 'text/calendar');
    toast('Calendar exported — open it to add to Apple/Google/Outlook');
  }
  function defaultFeedBase() { try { const h = (location && location.hostname) || 'localhost'; const proto = (location && location.protocol === 'https:') ? 'https:' : 'http:'; return `${proto}//${h}:4200`; } catch (e) { return 'http://localhost:4200'; } }
  function feedBase() { try { return localStorage.getItem('thplay.calendar.feed') || (typeof ANALYSIS!=='undefined' && ANALYSIS.getEndpoint && ANALYSIS.getEndpoint()) || defaultFeedBase(); } catch(e){ return defaultFeedBase(); } }
  function calToken() { try { let t=localStorage.getItem('thplay.calendar.token'); if(!t){ t=CALENDAR.uid().replace('ev_','cal'); localStorage.setItem('thplay.calendar.token',t); } return t; } catch(e){ return 'cal'; } }
  async function publishFeed() {
    const out = $('cal-subscribe-out');
    const ev = CALENDAR.load(); if (!ev.length) { toast('Add events first'); return; }
    const base = feedBase().replace(/\/+$/,''); const token = calToken();
    out.innerHTML = '<div class="muted">Publishing…</div>';
    try {
      const r = await fetch(`${base}/api/calendar/${token}`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ name:'Triibholz — '+(state.user&&state.user.name||'Team'), events: ev }) });
      if (!r.ok) throw new Error('publish-'+r.status);
      const url = `${base}/api/calendar/${token}.ics`;
      const webcal = url.replace(/^https?:/, 'webcal:');
      const lanHint = /localhost|127\.0\.0\.1/.test(base) ? '<p class="fa-note">⚠︎ This link uses <strong>localhost</strong> — only this computer can open it. For phones, open the app itself from your Mac’s network address (e.g. http://192.168.x.x:8088) and Subscribe there, or set the Feed server below to that address.</p>' : '';
      out.innerHTML = `<div class="feed-box">
        <p class="fa-note">Subscribe once on each device — matches you publish later update automatically.</p>
        <div class="feed-url"><code>${escapeHtml(url)}</code><button class="btn-ghost xs" id="feed-copy">Copy</button></div>
        <a class="btn-primary sm" href="${escapeHtml(webcal)}">＋ Subscribe on this device</a>
        ${lanHint}
        <div class="feed-url"><span class="muted" style="font-size:11px">Feed server</span><input type="text" id="feed-base" value="${escapeHtml(base)}" style="flex:1;font-size:11px"><button class="btn-ghost xs" id="feed-base-save">Use &amp; republish</button></div>
        <p class="fa-note">iPhone: Calendar → Add Account → Other → Add Subscribed Calendar. Android/Google Calendar: Settings → Add by URL. Outlook: Add calendar → Subscribe from web.</p>
      </div>`;
      const cp = $('feed-copy'); if (cp) cp.onclick = ()=>{ try{ navigator.clipboard.writeText(url); toast('Link copied'); }catch(e){} };
      const fbSave = $('feed-base-save'); if (fbSave) fbSave.onclick = ()=>{ const v=($('feed-base').value||'').trim().replace(/\/+$/,''); try{ v?localStorage.setItem('thplay.calendar.feed',v):localStorage.removeItem('thplay.calendar.feed'); }catch(e){} publishFeed(); };
      toast('Published — subscribe on any device');
    } catch(e) {
      out.innerHTML = `<div class="muted">Couldn’t publish to ${escapeHtml(base)} — start the backend (docker compose up -d analysis), or just use ⬇ Export .ics.</div>`;
    }
  }

  /* ======================================================
     PAUSE-TO-MOVE — whenever a play is PAUSED, coaches can drag
     players & the ball right on the board. The save bar appears
     automatically after the first change. (No mode to find.)
     ====================================================== */
  const adjust = { live:false, dirty:false, scn:null, idx:0, layers:null, ballEl:null, undo:[], gesture:false };

  function canPausedEdit() {
    return canEdit() && state.view==='playbook' && state.mode==='solution'
      && !!state.selectedId && $('editor-modal').hidden;
  }
  function stepT() {
    const seg = Math.max(1, adjust.scn.frames.length - 1);
    return adjust.idx / seg;
  }
  function updateAdjustBar() {
    $('adjust-bar').hidden = !adjust.dirty;
    const hint = $('pool-drag-hint');
    if (hint) hint.hidden = !(adjust.live && !adjust.dirty);
    updateUndoBtn();
  }
  function markDirty() {
    if (!adjust.dirty) { adjust.dirty = true; updateAdjustBar(); }
  }
  function resetAdjust() {
    adjust.live = false; adjust.dirty = false; adjust.scn = null; adjust.ballEl = null;
    adjust.undo = []; adjust.gesture = false;
    $('adjust-bar').hidden = true;
    const hint = $('pool-drag-hint'); if (hint) hint.hidden = true;
  }

  function enterPausedEdit() {
    if (adjust.live || !canPausedEdit()) return;
    const scn = state.scenarios.find(s=>s.id===state.selectedId);
    if (!scn) return;
    if (!adjust.dirty) {                     // clean entry → fresh working copy
      adjust.scn = DATA.clone(scn);
      adjust.undo = []; adjust.gesture = false;
      adjust.idx = Math.min(state.viewer ? state.viewer.currentStep() : 0, adjust.scn.frames.length - 1);
    }
    adjust.live = true;
    renderAdjustBoard();
    updateAdjustBar();
    updateAudibleBtn();
  }
  // clean exits only — back to the animated viewer (optionally playing)
  function exitPausedEditToViewer(t, andPlay) {
    adjust.live = false; adjust.ballEl = null;
    const hint = $('pool-drag-hint'); if (hint) hint.hidden = true;
    buildViewer(t == null ? stepT() : t, andPlay);
  }

  function renderAdjustBoard() {
    const f = adjust.scn.frames[adjust.idx];
    adjust.layers = POOL.render($('pool'));
    paintZones(adjust.layers);
    const refresh = () => { ANIM.drawTactics(adjust.layers, adjust.scn, state.focus); updateGkView(); draw3dNow(); };
    refresh();
    // one undo snapshot per drag gesture (a gesture = pointerdown → pointerup)
    const snapshot = () => {
      if (adjust.gesture) return;
      adjust.gesture = true;
      adjust.undo.push(JSON.parse(JSON.stringify(adjust.scn.frames)));
      if (adjust.undo.length > 25) adjust.undo.shift();
      window.addEventListener('pointerup', () => { adjust.gesture = false; }, { once:true });
      markDirty();
      updateUndoBtn();
    };

    const mkDisc = (team, label, pt, setter, small, anywhere) => {
      const g = POOL.disc(team, label, small);
      g.classList.add('editable');
      g.setAttribute('transform', `translate(${pt.x},${pt.y})`);
      adjust.layers.discLayer.appendChild(g);
      makeDraggable(g, $('pool'), np => {
        snapshot();
        setter(np);
        g.setAttribute('transform', `translate(${np.x},${np.y})`);
        if (!small && f.ball.carrier === team + label) placeAdjustBall(f);
        refresh();
      }, anywhere);
    };
    Object.keys(f.att).forEach(p => mkDisc('A', p, f.att[p], np => f.att[p] = np));
    Object.keys(f.def).forEach(p => mkDisc('D', p, f.def[p], np => f.def[p] = np));
    if (f.gk) mkDisc('GK', 'GK', f.gk, np => f.gk = np);
    (f.extra||[]).forEach((e, i) => mkDisc(e.team, e.label, e, np => { f.extra[i].x = np.x; f.extra[i].y = np.y; }, true, true));

    adjust.ballEl = POOL.ball();
    adjust.ballEl.classList.add('editable');
    placeAdjustBall(f);
    adjust.layers.discLayer.appendChild(adjust.ballEl);
    makeDraggable(adjust.ballEl, $('pool'), np => {
      snapshot();
      f.ball = { carrier: null, x: np.x, y: np.y };
      placeAdjustBall(f);
      refresh();
    });
    // keep the normal transport in sync
    const total = adjust.scn.frames.length;
    $('frame-label').textContent = `Step ${adjust.idx+1} / ${total}`;
    { const fl = $('fsb-label'); if (fl) fl.textContent = `Step ${adjust.idx+1} / ${total}`; }
    updateGkView(); draw3dNow();
    $('scrub').value = Math.round(stepT() * 1000);
    updateUndoBtn();
  }
  function placeAdjustBall(f) {
    if (!adjust.ballEl) return;
    const p = ANIM.ballPoint(f);
    adjust.ballEl.setAttribute('transform', `translate(${p.x},${p.y})`);
  }
  function updateUndoBtn() { const b = $('adj-undo'); if (b) b.disabled = adjust.undo.length === 0; }
  function adjustUndo() {
    if (!adjust.live || !adjust.undo.length) return;
    adjust.scn.frames = adjust.undo.pop();
    adjust.gesture = false;
    renderAdjustBoard();
    toast('Last drag undone ↩');
  }
  function adjustStep(d) {
    if (!adjust.live) return;
    adjust.idx = Math.max(0, Math.min(adjust.scn.frames.length-1, adjust.idx + d));
    renderAdjustBoard();
  }
  function adjustCancel() {
    resetAdjust();
    openScenario(state.selectedId);
    toast('Changes discarded');
  }
  function adjustSave(asNew) {
    const sc = adjust.scn;
    sc.builtIn = false;
    if (asNew) sc.owner = state.user.email;
    stampPrivacy(sc, false);
    if (asNew) {
      sc.id = 'usr-' + Math.abs(hash('adj' + sc.title + (typeof performance!=='undefined'?performance.now():Math.random())));
      sc.title = (sc.title || 'Play') + ' — adjusted';
      sc.author = state.user.name || 'You';
      state.scenarios.push(sc);
    } else {
      sc.author = sc.author === 'Playbook (sample)' ? (state.user.name || 'You') : sc.author;
      const i = state.scenarios.findIndex(x => x.id === sc.id);
      if (i >= 0) state.scenarios[i] = sc; else state.scenarios.push(sc);
    }
    DATA.save(state.scenarios);
    DATA.logActivity('play', `${state.user.name} adjusted “${sc.title}” on the board`, state.user.name);
    const id = sc.id;
    resetAdjust();
    renderLibrary();
    openScenario(id);
    toast(asNew ? 'Saved as a new movement ⑂' : 'Changes saved ✓');
  }

  /* ======================================================
     EDITOR (coach / trainer / super-admin)
     ====================================================== */
  const edit = { scenario:null, idx:0, layers:null, isNew:false };

  function openEditor(scn, isNew) {
    edit.scenario = DATA.clone(scn); edit.idx = 0; edit.isNew = isNew;
    edit.origTitle = scn.title || '';
    $('editor-title').textContent = isNew ? 'New scenario' : 'Edit scenario';
    $('ed-saveas').hidden = isNew;
    $('ed-title').value = edit.scenario.title||'';
    $('ed-desc').value = edit.scenario.description||'';
    const ss = $('ed-situation'); ss.innerHTML='';
    DATA.SITUATIONS.forEach(s=>{ const o=document.createElement('option'); o.value=s.id; o.textContent=s.label; ss.appendChild(o); });
    ss.value = edit.scenario.situation;
    if (!ss.value) { ss.selectedIndex = 0; edit.scenario.situation = ss.value; edit.scenario.frames = [ DATA.defaultFrame(ss.value) ]; }
    $('ed-phase').value = edit.scenario.phase || 'offense';
    if ($('ed-visibility')) $('ed-visibility').value = (typeof PRIVACY!=='undefined' ? PRIVACY.levelOf(edit.scenario) : 'team');
    $('ed-delete').hidden = isNew;
    buildNotesGrid();
    edit.layers = POOL.render($('editor-pool'));
    // fresh draft panel per editor session
    const dt = $('draft-text'); if (dt) dt.value = '';
    const df = $('draft-feedback'); if (df) df.querySelectorAll('.draft-line').forEach(n=>n.remove());
    const dp = $('draft-panel'); if (dp) dp.open = isNew;   // invite drafting on new plays
    buildCommandGroups('cmd-groups', applyCommandToEditor);
    buildMineGroup('cmd-mine', applyTemplateToEditor, edit.scenario.situation);
    const cp = $('cmd-panel'); if (cp) cp.open = false;
    const ct = $('cmd-target'); if (ct) ct.value = 'team';
    wireVideoPanel();
    editorRender();
    $('editor-modal').hidden = false;
  }

  /* ---- Draft from words: text → frames + assignments, applied live ---- */
  let draftTimer = null;
  function applyDraft() {
    if (!edit.scenario || typeof DRAFT === 'undefined') return;
    const text = $('draft-text').value;
    const fb = $('draft-feedback');
    fb.querySelectorAll('.draft-line').forEach(n=>n.remove());
    if (!text.trim()) return;
    const r = DRAFT.parse(text, edit.scenario.situation);
    edit.scenario.frames = r.frames;
    Object.keys(r.notes).forEach(p => { edit.scenario.notes[p] = r.notes[p]; });
    edit.idx = 0;
    buildNotesGrid();
    editorRender();
    r.report.forEach(rep => {
      const div = document.createElement('div');
      div.className = 'draft-line ' + (rep.ok ? 'ok' : 'nope');
      div.innerHTML = `<span class="dl-src">${escapeHtml(rep.text)}</span>` +
        (rep.parts||[]).map(pt=>`<span class="dl-part ${pt.startsWith('〰')?'miss':''}">${escapeHtml(pt)}</span>`).join('');
      fb.appendChild(div);
    });
    const sum = document.createElement('div');
    sum.className = 'draft-line sum';
    sum.textContent = `→ ${r.steps} step${r.steps>1?'s':''} on the board — drag anything to fine-tune, then save.`;
    fb.appendChild(sum);
  }
  /* ---- Tactical commands (audibles): call a play, board runs it ---- */
  const SIDE_LABEL = { offense:'Offense', defense:'Defense', transition:'Transition / special' };
  /* ======================================================
     TEMPLATES — the coach's own saved situation plays as the base for
     new plays, and as personal audibles in the command sheet.
     ====================================================== */
  function toggleTemplate() {
    const sc = currentScenario(); if (!sc || sc.builtIn || sc.shared) return;
    sc.template = !sc.template; sc.updated = Date.now();
    DATA.save(state.scenarios); renderLibrary(); openScenario(sc.id);
    toast(sc.template ? '⭐ Template — it now shows under “New play” and as a personal audible' : 'No longer a template');
  }
  const myTemplates = () => state.scenarios.filter(sc => sc.template && !sc.builtIn && !sc.shared);
  function templatesFor(situation, phase) {
    const mine = myTemplates().filter(sc => sc.situation === situation && sc.phase === phase);
    const samples = state.scenarios.filter(sc => sc.builtIn && sc.situation === situation && sc.phase === phase);
    return { mine, samples };
  }
  function cloneAsNew(src) {
    const sc = DATA.newScenario(src.situation, src.phase);
    sc.title = (src.title || 'Play') + ' — copy'; sc.description = src.description || '';
    sc.frames = DATA.clone(src.frames); sc.notes = DATA.clone(src.notes || {});
    sc.fromTemplate = src.id;
    return sc;
  }
  function newPlayFlow(force) {
    const { mine, samples } = templatesFor(state.situation, state.phase);
    // the chooser only appears when the coach has ⭐ templates of their own (or from the editor button); plain New play stays instant
    if (!force && !mine.length) { openEditor(DATA.newScenario(state.situation, state.phase), true); return; }
    if (!mine.length && !samples.length) { openEditor(DATA.newScenario(state.situation, state.phase), true); return; }
    const list = $('tpl-list'); list.innerHTML = '';
    const row = (sc, kind) => { const b = document.createElement('button'); b.className = 'tpl-item'; b.dataset.tpl = sc.id;
      b.innerHTML = `<span class="tpl-kind">${kind}</span><strong>${escapeHtml(sc.title || 'Untitled')}</strong><span class="muted">${sc.frames.length} step${sc.frames.length > 1 ? 's' : ''}${sc.description ? ' · ' + escapeHtml(sc.description.slice(0, 80)) : ''}</span>`;
      b.onclick = () => { $('tpl-modal').hidden = true; openEditor(cloneAsNew(sc), true); };
      list.appendChild(b); };
    mine.forEach(sc => row(sc, '⭐ mine')); samples.forEach(sc => row(sc, 'sample'));
    $('tpl-modal').hidden = false;
  }
  /* a template play as an audible: its movement is appended to the current board */
  function playAsSteps(tpl, base) {
    const frames = DATA.clone(tpl.frames);
    // start from the template's first frame so the movement is exactly the coach's; keep the current keeper if the template has none
    frames.forEach(f => { if (!f.gk && base && base.gk) f.gk = DATA.clone(base.gk); });
    return { steps: frames, notes: DATA.clone(tpl.notes || {}), name: tpl.title || 'Template' };
  }
  function buildMineGroup(containerId, onPickTpl, situation) {
    const wrap = $(containerId); if (!wrap) return;
    const mine = myTemplates().filter(sc => sc.situation === situation);
    wrap.innerHTML = '';
    if (!mine.length) return;
    const grp = document.createElement('div'); grp.className = 'cmd-group cmd-mineg';
    grp.innerHTML = '<div class="cmd-group-h">⭐ My plays (templates)</div>';
    const rowEl = document.createElement('div'); rowEl.className = 'cmd-btns';
    mine.forEach(sc => { const b = document.createElement('button'); b.className = 'cmd-btn'; b.type = 'button'; b.dataset.tpl = sc.id; b.title = sc.description || sc.title;
      b.innerHTML = `<span class="cmd-ic">⭐</span><span class="cmd-name">${escapeHtml(sc.title || 'Untitled')}</span><span class="cmd-scope">${sc.frames.length} steps</span>`;
      b.onclick = () => onPickTpl(sc.id); rowEl.appendChild(b); });
    grp.appendChild(rowEl); wrap.appendChild(grp);
  }
  function applyTemplateToEditor(id) {
    const tpl = state.scenarios.find(x => x.id === id); if (!edit.scenario || !tpl) return;
    const r = playAsSteps(tpl, edit.scenario.frames[edit.scenario.frames.length - 1]);
    edit.scenario.frames.push(...r.steps);
    Object.keys(r.notes).forEach(p => { if (!r.notes[p]) return; edit.scenario.notes[p] = edit.scenario.notes[p] ? edit.scenario.notes[p] + ' ' + r.notes[p] : r.notes[p]; });
    edit.idx = edit.scenario.frames.length - 1; buildNotesGrid(); editorRender();
    toast(`⭐ ${r.name} added — ${r.steps.length} step${r.steps.length > 1 ? 's' : ''}`);
  }
  function applyTemplateAudible(id) {
    const tpl = state.scenarios.find(x => x.id === id); if (!tpl) return;
    if (!canPausedEdit()) { toast('Open a play first to call an audible'); return; }
    if (state.viewer) state.viewer.stop(); enterPausedEdit(); if (!adjust.scn) return;
    const r = playAsSteps(tpl, adjust.scn.frames[adjust.scn.frames.length - 1]);
    adjust.undo.push(JSON.parse(JSON.stringify(adjust.scn.frames))); if (adjust.undo.length > 25) adjust.undo.shift();
    adjust.scn.frames.push(...r.steps); adjust.scn.notes = adjust.scn.notes || {};
    Object.keys(r.notes).forEach(p => { if (!r.notes[p]) return; adjust.scn.notes[p] = adjust.scn.notes[p] ? adjust.scn.notes[p] + ' ' + r.notes[p] : r.notes[p]; });
    adjust.dirty = true; if (typeof renderAdjustBoard === 'function') renderAdjustBoard();
    const bar = $('adjust-bar'); if (bar) bar.hidden = false;
    const sheet = $('audible-sheet'); if (sheet) sheet.hidden = true;
    toast(`⭐ ${r.name} called — ${r.steps.length} step${r.steps.length > 1 ? 's' : ''}; drag to tweak, then save`);
  }
  function buildCommandGroups(containerId, onPick) {
    const wrap = $(containerId); if (!wrap || typeof COMMANDS==='undefined') return;
    wrap.innerHTML = '';
    COMMANDS.SIDES.forEach(side => {
      const cmds = COMMANDS.list.filter(c=>c.side===side); if (!cmds.length) return;
      const grp = document.createElement('div'); grp.className = 'cmd-group cmd-'+side;
      grp.innerHTML = `<div class="cmd-group-h">${SIDE_LABEL[side]}</div>`;
      const row = document.createElement('div'); row.className='cmd-btns';
      cmds.forEach(c => {
        const b = document.createElement('button');
        b.className = 'cmd-btn'; b.type='button';
        b.dataset.cmd = c.id;
        b.title = c.cue + (c.when ? `\n\nWhen: ${c.when}` : '') + (c.why ? `\nWhy: ${c.why}` : '');
        b.innerHTML = `<span class="cmd-ic">${c.icon||'▸'}</span><span class="cmd-name">${escapeHtml(c.name)}</span><span class="cmd-scope">${c.scope}</span>`;
        const info = $(containerId === 'as-groups' ? 'as-info' : 'cmd-info');
        const showInfo = () => { if (info) info.innerHTML = `<strong>${escapeHtml(c.name)}</strong> — ${escapeHtml(c.cue)}${c.when ? `<br><b>When:</b> ${escapeHtml(c.when)}` : ''}${c.why ? `<br><b>Why:</b> ${escapeHtml(c.why)}` : ''}`; };
        b.onmouseenter = showInfo; b.onfocus = showInfo;
        b.onclick = () => { showInfo(); onPick(c.id); };
        row.appendChild(b);
      });
      grp.appendChild(row); wrap.appendChild(grp);
    });
  }
  // apply a command inside the EDITOR — append its steps + merge assignments
  function applyCommandToEditor(id) {
    if (!edit.scenario || typeof COMMANDS==='undefined') return;
    const target = $('cmd-target').value || 'team';
    const r = COMMANDS.apply(edit.scenario, id, { target });
    if (!r) { toast('That command needs a player who isn’t in this situation'); return; }
    edit.scenario.frames.push(...r.steps);
    Object.keys(r.notes).forEach(p => {
      edit.scenario.notes[p] = edit.scenario.notes[p]
        ? edit.scenario.notes[p] + ' ' + r.notes[p] : r.notes[p];
    });
    edit.idx = edit.scenario.frames.length - 1;
    buildNotesGrid(); editorRender();
    toast(`${r.cmd.icon} ${r.cmd.name} added — ${r.steps.length} step${r.steps.length>1?'s':''}`);
  }
  // apply a command LIVE on the stage (paused board) — the "audible" button
  function applyAudible(id) {
    const scn = state.scenarios.find(s=>s.id===state.selectedId);
    if (!scn || typeof COMMANDS==='undefined') return;
    if (!canPausedEdit()) { toast('Open a play first to call an audible'); return; }
    if (state.viewer) state.viewer.stop();    // freeze the animation before we edit
    enterPausedEdit();                        // ensure the paused working copy exists
    if (!adjust.scn) return;
    const target = $('as-target').value || 'team';
    const r = COMMANDS.apply(adjust.scn, id, { target });
    if (!r) { toast('That command needs a player who isn’t in this situation'); return; }
    adjust.undo.push(JSON.parse(JSON.stringify(adjust.scn.frames)));   // one undo step
    if (adjust.undo.length > 25) adjust.undo.shift();
    adjust.scn.frames.push(...r.steps);
    adjust.scn.notes = adjust.scn.notes || {};
    Object.keys(r.notes).forEach(p => {
      adjust.scn.notes[p] = adjust.scn.notes[p] ? adjust.scn.notes[p] + ' ' + r.notes[p] : r.notes[p];
    });
    adjust.idx = adjust.scn.frames.length - 1;
    markDirty();
    renderAdjustBoard();
    closeAudible();
    toast(`${r.cmd.icon} ${r.cmd.name} — drag to tweak, then Save as new ⑂`);
  }
  function openAudible() {
    if (!canPausedEdit()) return;
    buildCommandGroups('as-groups', applyAudible);
    { const cur = state.scenarios.find(x => x.id === state.selectedId); buildMineGroup('as-mine', applyTemplateAudible, cur ? cur.situation : state.situation); }
    $('as-target').value = state.focus || 'team';
    $('audible-sheet').hidden = false;
  }
  function closeAudible() { const s=$('audible-sheet'); if (s) s.hidden = true; }
  function updateAudibleBtn() {
    const b = $('audible-btn'); if (!b) return;
    b.hidden = !canPausedEdit();
    if (b.hidden) closeAudible();
  }

  /* ======================================================
     DOWNLOAD · IMPORT · SHARE LINK · MULTI-SELECT (set / reel)
     Plays are portable: a .thplay.json file, or a link that carries
     the whole play. Confidential plays ask before they leave the app.
     ====================================================== */
  let selecting = false; const selected = new Set();
  function askConfirm(msg, okLabel) {
    return new Promise(resolve => {
      const m = $('confirm-modal'); if (!m) { resolve(true); return; }
      $('confirm-text').textContent = msg; $('confirm-yes').textContent = okLabel || 'Continue';
      m.hidden = false;
      const done = v => { m.hidden = true; $('confirm-yes').onclick = null; $('confirm-no').onclick = null; resolve(v); };
      $('confirm-yes').onclick = () => done(true); $('confirm-no').onclick = () => done(false);
    });
  }
  const currentScenario = () => state.scenarios.find(s => s.id === state.selectedId);
  const levelOf = sc => (typeof PRIVACY !== 'undefined' && !sc.builtIn) ? PRIVACY.levelOf(sc) : 'public';
  async function guardConfidential(scns) {
    const conf = scns.filter(sc => levelOf(sc) !== 'public');
    if (!conf.length) return true;
    const allPriv = conf.every(sc => levelOf(sc) === 'private');
    const what = conf.length === 1 ? `“${conf[0].title || 'this play'}” is` : `${conf.length} of these plays are`;
    return askConfirm(`${what} marked ${allPriv ? 'private' : 'team-only'}. Once downloaded or shared, the file leaves the app and you can’t take it back. Continue?`, 'Yes, export');
  }
  /* ---- more formats: PNG step sheet, SVG board, printable PDF ---- */
  const playOf = sc => ({ situation: sc.situation, phase: sc.phase, title: sc.title || 'Play', description: sc.description || '', frames: sc.frames, notes: sc.notes || {} });
  function stepCanvas(play, i, W, H) {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'); if (!ctx) return null;
    const t = i * VIDEOGEN.SEC_PER_STEP;   // the exact keyframe time
    VIDEOGEN.drawScene(ctx, play, t, W, H, { caption: `Step ${i + 1} / ${play.frames.length}` });
    return c;
  }
  function sheetCanvas(sc, opts) {
    if (typeof VIDEOGEN === 'undefined') return null;
    const play = playOf(sc), n = play.frames.length, cols = n <= 2 ? n : n <= 4 ? 2 : 3, rows = Math.ceil(n / cols);
    const W = (opts && opts.w) || 640, H = Math.round(W * 9 / 16), pad = 16, head = 64;
    const sheet = document.createElement('canvas'); sheet.width = cols * W + (cols + 1) * pad; sheet.height = head + rows * H + (rows + 1) * pad;
    const g = sheet.getContext('2d'); if (!g) return null;
    g.fillStyle = '#0b1b25'; g.fillRect(0, 0, sheet.width, sheet.height);
    g.fillStyle = '#e8f6f8'; g.font = '700 26px system-ui, -apple-system, Segoe UI, sans-serif'; g.fillText(String(sc.title || 'Play').slice(0, 60), pad, 34);
    g.fillStyle = '#7fd4de'; g.font = '500 15px system-ui, sans-serif'; g.fillText(`${DATA.sit(sc.situation).label} · ${sc.phase} · ${n} step${n > 1 ? 's' : ''} · Triibholz THPLAY`, pad, 56);
    for (let i = 0; i < n; i++) { const c = stepCanvas(play, i, W, H); if (!c) return null; g.drawImage(c, pad + (i % cols) * (W + pad), head + pad + Math.floor(i / cols) * (H + pad)); }
    return sheet;
  }
  function svgOfBoard() {
    const svg = $('pool'); if (!svg) return null;
    const clone = svg.cloneNode(true);
    // bake the computed styles in, so the file looks right outside the app
    const src = svg.querySelectorAll('*'), dst = clone.querySelectorAll('*');
    const props = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'font-size', 'font-family', 'font-weight', 'text-anchor', 'stroke-linecap', 'fill-opacity', 'stroke-opacity'];
    for (let i = 0; i < src.length && i < dst.length; i++) { try { const cs = getComputedStyle(src[i]); props.forEach(pn => { const v = cs.getPropertyValue(pn); if (v && v !== 'none' || pn === 'fill') dst[i].style.setProperty(pn, v); }); } catch (e) {} }
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('width', '960'); clone.setAttribute('height', '786');
    clone.removeAttribute('id');
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
  }
  function printHtml(scns) {
    const esc = escapeHtml;
    const page = sc => { const sheet = sheetCanvas(sc, { w: 520 }); const img = sheet ? `<img src="${sheet.toDataURL('image/png')}" alt="">` : '';
      const notes = Object.keys(sc.notes || {}).filter(k => (sc.notes[k] || '').trim()).map(k => `<li><b>${esc(k)}</b> ${esc(sc.notes[k])}</li>`).join('');
      return `<section class="play"><h1>${esc(sc.title || 'Play')}</h1><p class="sub">${esc(DATA.sit(sc.situation).label)} · ${esc(sc.phase)} · ${sc.frames.length} steps${sc.author ? ' · ' + esc(sc.author) : ''}</p>${sc.description ? `<p>${esc(sc.description)}</p>` : ''}${img}${notes ? `<h2>What each position does</h2><ul>${notes}</ul>` : ''}</section>`; };
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(scns.length === 1 ? (scns[0].title || 'Play') : scns.length + ' plays')} — Triibholz</title>
      <style>body{font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;color:#111;margin:0;padding:18mm 16mm}.play{page-break-after:always}.play:last-child{page-break-after:auto}h1{margin:0 0 2px;font-size:22px}h2{font-size:14px;margin:14px 0 4px}.sub{color:#555;margin:0 0 8px}img{width:100%;max-width:720px;display:block;border-radius:6px;margin:8px 0}ul{padding-left:18px}li{margin:2px 0}@media print{body{padding:0}}</style></head>
      <body>${scns.map(page).join('')}<script>setTimeout(function(){window.print();},350);<\/script></body></html>`;
  }
  function openPrint(scns) {
    const html = printHtml(scns);
    let w = null; try { w = window.open('', '_blank'); } catch (e) {}
    if (!w) { downloadBlob(html, SHARE.filename((scns.length === 1 ? scns[0].title : 'plays') + ' print', 'html'), 'text/html'); toast('Pop-ups are blocked — the print page was downloaded instead; open it and print / save as PDF'); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }
  async function exportPlayAs(fmt) {
    const sc = currentScenario(); if (!sc) return;
    if (fmt === 'json') return downloadPlay();
    if (!await guardConfidential([sc])) return;
    if (fmt === 'png') { const sheet = sheetCanvas(sc); if (!sheet) { toast('Image export needs a canvas-capable browser'); return; }
      sheet.toBlob(b => { if (!b) { toast('Could not render the image'); return; } const url = URL.createObjectURL(b); const a = document.createElement('a'); a.href = url; a.download = SHARE.filename(sc.title, 'png'); document.body.appendChild(a); a.click(); setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1500); toast('Image sheet downloaded'); }, 'image/png'); return; }
    if (fmt === 'svg') { const svg = svgOfBoard(); if (!svg) return; downloadBlob(svg, SHARE.filename(sc.title + ' step ' + ((state.viewer ? state.viewer.currentStep() : 0) + 1), 'svg'), 'image/svg+xml'); toast('Board saved as SVG (current step)'); return; }
    if (fmt === 'pdf') { openPrint([sc]); return; }
    if (fmt === 'video') { const d = $('video-panel'); if (d) { d.open = true; if (typeof d.scrollIntoView === 'function') d.scrollIntoView({ behavior: 'smooth', block: 'start' }); const b = $('vid-generate'); if (b) b.focus(); } return; }
  }
  function toggleDlMenu(force) { const m = $('dl-menu'); if (!m) return; m.hidden = force == null ? !m.hidden : !force; }
  async function downloadPlay() {
    const sc = currentScenario(); if (!sc || typeof SHARE === 'undefined') return;
    if (!await guardConfidential([sc])) return;
    downloadBlob(JSON.stringify(SHARE.pack(sc), null, 1), SHARE.filename(sc.title, 'thplay.json'), 'application/json');
    DATA.logActivity('play', `Downloaded “${sc.title}”`, state.user && state.user.name);
    toast('Play downloaded — send the file to another coach; they add it with ⬆ Import');
  }
  async function downloadSet(scns, name) {
    if (!scns.length || typeof SHARE === 'undefined') return;
    if (!await guardConfidential(scns)) return;
    downloadBlob(JSON.stringify(SHARE.packMany(scns, { name }), null, 1), SHARE.filename(name, 'thplay.json'), 'application/json');
    toast(`${scns.length} plays downloaded as one set`);
  }
  async function sharePlay() {
    const sc = currentScenario(); if (!sc || typeof SHARE === 'undefined') return;
    if (!await guardConfidential([sc])) return;
    let url; try { url = SHARE.shareUrl(location.href, await SHARE.encode(SHARE.pack(sc))); } catch (e) { toast('Could not build the link'); return; }
    if (navigator.share) { try { await navigator.share({ title: sc.title, text: 'Water polo play: ' + sc.title, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    const done = () => toast('Link copied — whoever opens it sees the play animated and can save it to their playbook');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done).catch(() => prompt('Copy this link', url));
    else prompt('Copy this link', url);
  }
  function addImported(p, source) {
    const sc = DATA.newScenario(p.situation, p.phase);
    sc.title = p.title; sc.description = p.description || '';
    sc.frames = DATA.clone(p.frames); sc.notes = DATA.clone(p.notes || {});
    sc.author = (p.author || 'Imported') + (source ? ' · ' + source : '');
    sc.visibility = p.visibility || 'team'; sc.owner = state.user && state.user.email; sc.builtIn = false;
    if (p.tactic) sc.tactic = p.tactic;
    while (state.scenarios.some(x => x.id === sc.id)) sc.id += 'i';
    state.scenarios.push(sc);
    return sc;
  }
  /* any text → plays: a share link, JSON (file / set / backup), or written steps (DRAFT) */
  async function playsFromText(txt) {
    txt = String(txt || '').trim(); if (!txt) return [];
    const code = SHARE.fromHash(txt.replace(/\s+/g, ''));
    if (code) { try { const r = SHARE.unpack(await SHARE.decode(code)); return r.plays; } catch (e) { return []; } }
    if (/^[\[{]/.test(txt)) return SHARE.unpack(txt).plays;
    if (typeof DRAFT === 'undefined') return [];
    const lines = txt.split(/\r?\n/); let title = '', sit = state.situation;
    while (lines.length && (/^\s*(#|title\s*:)/i.test(lines[0]) || /^\s*situation\s*:/i.test(lines[0]) || !lines[0].trim())) {
      const l = lines.shift(); const t = /^\s*(?:#+|title\s*:)\s*(.+)$/i.exec(l); const st = /^\s*situation\s*:\s*(\S+)/i.exec(l);
      if (t) title = t[1].trim(); if (st && DATA.sit(st[1])) sit = st[1];
    }
    const body = lines.join('\n').trim(); if (!body) return [];
    const d = DRAFT.parse(body, sit); if (!d || !d.frames || d.frames.length < 2 || !(d.report || []).some(l => l.ok)) return [];
    return SHARE.unpack({ title: title || (body.split('\n')[0] || 'Written play').slice(0, 60), description: body.replace(/\s+/g, ' ').slice(0, 300), situation: sit, phase: state.phase, frames: d.frames, notes: d.notes || {}, author: state.user && state.user.name, visibility: 'team' }).plays;
  }
  async function importFiles(files) {
    if (typeof SHARE === 'undefined' || !files || !files.length) return;
    const read = f => f.text ? f.text() : new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result || '')); fr.readAsText(f); });
    const texts = await Promise.all(Array.from(files).map(read));
    return importTexts(texts);
  }
  async function importTexts(texts) {
    let added = 0, dup = 0, bad = 0, first = null;
    for (const txt of texts) {
      const plays = await playsFromText(txt); if (!plays.length) { bad++; continue; }
      plays.forEach(p => { if (SHARE.isDuplicate(p, state.scenarios)) { dup++; return; } const sc = addImported(p, 'imported'); added++; first = first || sc; });
    }
    if (added) { DATA.save(state.scenarios); DATA.logActivity('play', `Imported ${added} play${added > 1 ? 's' : ''}`, state.user && state.user.name); }
    if (first) { state.situation = first.situation; state.phase = first.phase; buildSituationTabs(); refreshTabs(); renderLibrary(); openScenario(first.id); }
    toast(`${added} play${added === 1 ? '' : 's'} imported${dup ? ` · ${dup} skipped (already in your playbook)` : ''}${bad ? ` · ${bad} item${bad > 1 ? 's' : ''} not understood` : ''}`);
    return { added, dup, bad };
  }
  function toggleImportMenu(force) { const m = $('import-menu'); if (!m) return; m.hidden = force == null ? !m.hidden : !force; }
  function openPaste() { const m = $('paste-modal'); if (!m) return; m.hidden = false; $('paste-text').value = ''; setTimeout(() => $('paste-text').focus(), 30); }
  async function backupAll() {
    const mine = state.scenarios.filter(sc => !sc.builtIn && !sc.shared);
    if (!mine.length) { toast('No plays of your own yet — samples are always there'); return; }
    downloadBlob(JSON.stringify(SHARE.packMany(mine, { name: 'Triibholz backup ' + new Date().toISOString().slice(0, 10) }), null, 1), SHARE.filename('triibholz-backup-' + new Date().toISOString().slice(0, 10), 'thplay.json'), 'application/json');
    toast(`${mine.length} play${mine.length > 1 ? 's' : ''} saved as a backup — import the file on any device`);
  }
  // ---- multi-select → set download / video reel
  function toggleSelectMode(on) {
    selecting = on == null ? !selecting : !!on; if (!selecting) selected.clear();
    $('select-btn').classList.toggle('active', selecting);
    $('select-bar').hidden = !selecting; $('sb-out').innerHTML = '';
    renderLibrary();
  }
  function togglePick(id) { if (selected.has(id)) selected.delete(id); else selected.add(id); renderLibrary(); }
  function updateSelectBar() {
    const c = $('sb-count'); if (!c) return;
    c.textContent = `${selected.size} selected`;
    $('sb-download').disabled = !selected.size; $('sb-reel').disabled = !selected.size; if ($('sb-print')) $('sb-print').disabled = !selected.size;
  }
  const pickedScenarios = () => Array.from(selected).map(id => state.scenarios.find(sc => sc.id === id)).filter(Boolean);
  const setName = () => `${DATA.sit(state.situation).label} ${state.phase}`;
  async function makeReel() {
    const scns = pickedScenarios(); if (!scns.length || typeof VIDEOGEN === 'undefined') return;
    if (!await guardConfidential(scns)) return;
    const out = $('sb-out'); const btn = $('sb-reel'); btn.disabled = true;
    const plays = scns.map(sc => ({ situation: sc.situation, phase: sc.phase, title: sc.title || 'Play', description: sc.description || '', frames: sc.frames, notes: sc.notes || {} }));
    const total = VIDEOGEN.reelDuration(plays, { title: setName() });
    out.innerHTML = `<div class="muted">Rendering the reel… ⏳ ${scns.length} plays, about ${Math.round(total)}s — <span id="sb-pct">0%</span></div>`;
    try {
      const res = await VIDEOGEN.recordReel(plays, { title: setName(), subtitle: `${scns.length} play${scns.length > 1 ? 's' : ''} · ${state.phase}`, onProgress: p => { const e = $('sb-pct'); if (e) e.textContent = Math.round(p * 100) + '%'; } });
      const ext = /mp4/.test(res.mime) ? 'mp4' : 'webm';
      const name = SHARE.filename(setName() + ' reel', ext);
      out.innerHTML = `<video src="${res.url}" controls playsinline class="vid-preview"></video>
        <div class="sb-actions"><a class="btn-primary sm" id="sb-reel-download" href="${res.url}" download="${escapeHtml(name)}">⬇ Download reel (${res.duration.toFixed(0)}s)</a>${navigator.share ? '<button class="btn-ghost sm" id="sb-reel-share">📤 Share…</button>' : ''}</div>`;
      const sh = $('sb-reel-share'); if (sh) sh.onclick = async () => { try { const file = new File([res.blob], name, { type: res.mime }); if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: setName() + ' reel' }); else toast('Sharing files isn’t supported here — use Download'); } catch (e) {} };
      toast('Reel ready — play it or download to share');
    } catch (e) { out.innerHTML = `<div class="muted">Couldn’t render the reel — ${escapeHtml(e.message || 'unknown error')}.</div>`; }
    finally { btn.disabled = !selected.size; }
  }
  // ---- a share link opens the play (no server, no login for the play itself)
  async function openSharedPlay() {
    const code = SHARE.fromHash(location.hash); if (!code) return;
    let obj; try { obj = await SHARE.decode(code); } catch (e) { toast(e.message === 'unsupported-browser' ? 'This browser can’t open compressed share links' : 'This share link is damaged or from a newer version'); return; }
    const r = SHARE.unpack(obj); if (!r.plays.length) { toast('The link holds no play'); return; }
    const p = r.plays[0];
    state.scenarios = state.scenarios.filter(sc => !sc.shared);
    const sc = Object.assign(DATA.newScenario(p.situation, p.phase), { id: 'shared-' + SHARE.fingerprint(p), title: p.title, description: p.description || '', frames: DATA.clone(p.frames), notes: DATA.clone(p.notes || {}), author: (p.author || 'Someone') + ' · shared link', visibility: 'team', shared: true, builtIn: false, sharedPlay: p });
    state.scenarios.push(sc);
    state.situation = sc.situation; state.phase = sc.phase; buildSituationTabs(); refreshTabs();
    switchView('playbook'); openScenario(sc.id);
    const already = SHARE.isDuplicate(p, state.scenarios.filter(x => !x.shared));
    $('shared-text').textContent = `🔗 Shared play “${sc.title}”${p.author ? ' from ' + p.author : ''}${already ? ' — already in your playbook' : ''}`;
    $('shared-save').hidden = already; $('shared-banner').hidden = false;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
  }
  function saveSharedPlay() {
    const sc = currentScenario(); if (!sc || !sc.shared) return;
    const kept = addImported(sc.sharedPlay, 'shared link');
    state.scenarios = state.scenarios.filter(x => !x.shared);
    DATA.save(state.scenarios); DATA.logActivity('play', `Saved shared play “${kept.title}”`, state.user && state.user.name);
    renderLibrary(); openScenario(kept.id); toast('Saved to your playbook');
  }
  function dismissShared() {
    const sc = currentScenario();
    state.scenarios = state.scenarios.filter(x => !x.shared);
    $('shared-banner').hidden = true; renderLibrary();
    if (sc && sc.shared) openFirstOrEmpty();
  }
  function wireShare() {
    if (!$('dl-btn')) return;
    $('dl-btn').onclick = e => { e.stopPropagation(); toggleDlMenu(); };
    $('dl-menu').querySelectorAll('[data-fmt]').forEach(b => b.onclick = e => { e.stopPropagation(); toggleDlMenu(false); exportPlayAs(b.dataset.fmt); });
    document.addEventListener('click', () => toggleDlMenu(false));
    $('share-btn').onclick = sharePlay;
    $('sb-print').onclick = async () => { const scns = pickedScenarios(); if (!scns.length) return; if (!await guardConfidential(scns)) return; openPrint(scns); };
    $('select-btn').onclick = () => toggleSelectMode();
    $('sb-close').onclick = () => toggleSelectMode(false);
    $('sb-all').onclick = () => { currentList().forEach(sc => selected.add(sc.id)); renderLibrary(); };
    $('sb-download').onclick = () => downloadSet(pickedScenarios(), setName() + ' set');
    $('sb-reel').onclick = makeReel;
    $('import-btn').onclick = e => { e.stopPropagation(); toggleImportMenu(); };
    document.addEventListener('click', () => toggleImportMenu(false));
    $('import-menu').querySelectorAll('[data-imp]').forEach(b => b.onclick = e => { e.stopPropagation(); toggleImportMenu(false); if (b.dataset.imp === 'file') $('import-file').click(); else if (b.dataset.imp === 'paste') openPaste(); else backupAll(); });
    $('import-file').onchange = e => { importFiles(e.target.files); e.target.value = ''; };
    $('paste-close').onclick = $('paste-cancel').onclick = () => { $('paste-modal').hidden = true; };
    $('paste-import').onclick = async () => { const t = $('paste-text').value; $('paste-modal').hidden = true; await importTexts([t]); };
    const list = $('scenario-list');
    list.addEventListener('dragover', e => { if (canEdit()) { e.preventDefault(); list.classList.add('drop'); } });
    list.addEventListener('dragleave', () => list.classList.remove('drop'));
    list.addEventListener('drop', e => { list.classList.remove('drop'); if (!canEdit()) return; e.preventDefault(); if (e.dataTransfer && e.dataTransfer.files) importFiles(e.dataTransfer.files); });
    $('shared-save').onclick = saveSharedPlay; $('shared-dismiss').onclick = dismissShared;
    // a share link pasted while the app is already open (same-document hash change)
    window.addEventListener('hashchange', () => { if (state.user && $('app-screen').classList.contains('active') && SHARE.fromHash(location.hash)) openSharedPlay(); });
  }

  /* ---- Generate a shareable video of the play (offline animation / optional photoreal) ---- */
  function editPlay() {
    return { situation: edit.scenario.situation, title: edit.scenario.title || 'Play',
      description: edit.scenario.description || edit.scenario.title || 'Water polo play',
      frames: edit.scenario.frames, notes: edit.scenario.notes || {} };
  }
  function updateVidStatus() {
    const chip = $('vid-status'); if (!chip || typeof VIDEOGEN === 'undefined') return;
    const st = VIDEOGEN.providerStatus();
    chip.textContent = st.mode === 'photoreal' ? `● photoreal: ${st.name || 'provider'}` : '● animation (offline)';
    chip.className = 'cloud-status ' + (st.mode === 'photoreal' ? 'cloud' : 'offline');
  }
  function wireVideoPanel() {
    if (!$('video-panel') || typeof VIDEOGEN === 'undefined') return;
    $('vid-out').innerHTML = '';
    const p = VIDEOGEN.getProvider() || {};
    const ep = $('vid-endpoint'), key = $('vid-key');
    if (ep) ep.value = p.endpoint || ''; if (key) key.value = p.key || '';
    updateVidStatus();
    $('vid-generate').onclick = () => generateVideo($('vid-generate'));
    const sv = $('vid-save-provider');
    if (sv) sv.onclick = () => { VIDEOGEN.setProvider({ endpoint: (ep.value || '').trim(), key: (key.value || '').trim(), name: 'provider' }); updateVidStatus(); toast(VIDEOGEN.getProvider() ? 'Video provider saved' : 'Using offline animation'); };
    const pr = $('vid-photoreal'); if (pr) pr.onclick = () => generatePhotoreal(pr);
  }
  async function generateVideo(btn) {
    if (typeof VIDEOGEN === 'undefined' || !edit.scenario) return;
    const out = $('vid-out'); btn.disabled = true;
    out.innerHTML = '<div class="muted">Rendering the clip… ⏳ (about ' + Math.round(VIDEOGEN.duration(editPlay())) + 's)</div>';
    try {
      const play = editPlay();
      const res = await VIDEOGEN.record(play, { caption: play.description });
      const ext = /mp4/.test(res.mime) ? 'mp4' : 'webm';
      const name = (play.title || 'triibholz-play').replace(/[^\w]+/g, '-').toLowerCase() + '.' + ext;
      out.innerHTML = `<video src="${res.url}" controls playsinline class="vid-preview"></video>
        <a class="btn-primary sm" id="vid-download" href="${res.url}" download="${escapeHtml(name)}">⬇ Download (${res.duration.toFixed(1)}s)</a>`;
      toast('Video ready — play it or download to share');
    } catch (e) {
      out.innerHTML = `<div class="muted">Couldn’t render the video — ${escapeHtml(e.message || 'unknown error')}.</div>`;
    } finally { btn.disabled = false; }
  }
  async function generatePhotoreal(btn) {
    if (typeof VIDEOGEN === 'undefined' || !edit.scenario) return;
    const out = $('vid-out'); btn.disabled = true;
    out.innerHTML = '<div class="muted">Requesting a photoreal clip from your provider… ⏳</div>';
    try {
      let r = await VIDEOGEN.photoreal(editPlay(), {});
      if (!r.url && r.jobId) {   // async job — poll the adapter until it's ready
        const ep = ((VIDEOGEN.getProvider() || {}).endpoint || '').replace(/\/+$/, '');
        out.innerHTML = `<div class="muted">Your provider is generating the clip… ⏳ (job ${escapeHtml(r.jobId)}) — this can take a minute or two.</div>`;
        r = await pollVideoJob(ep, r.jobId);
      }
      if (r && r.url) out.innerHTML = `<video src="${escapeHtml(r.url)}" controls playsinline class="vid-preview"></video>
        <a class="btn-primary sm" href="${escapeHtml(r.url)}" download>⬇ Download</a>`;
      else out.innerHTML = `<div class="muted">Provider response: ${escapeHtml(JSON.stringify(r).slice(0, 200))}</div>`;
    } catch (e) {
      const msg = /no-provider/.test(e.message) ? 'set a provider endpoint above first (point it at your backend’s /api/videogen)' : e.message;
      out.innerHTML = `<div class="muted">Photoreal failed — ${escapeHtml(msg)}.</div>`;
    } finally { btn.disabled = false; }
  }
  async function pollVideoJob(endpoint, jobId) {
    for (let i = 0; i < 45; i++) {                 // ~3 min at 4s
      await new Promise(r => setTimeout(r, 4000));
      try {
        const res = await fetch(endpoint + '/' + encodeURIComponent(jobId));
        const j = await res.json();
        if (j.status === 'done' && j.url) return { url: j.url };
        if (j.status === 'error') return { error: j.error || 'provider error' };
      } catch (e) { /* keep waiting */ }
    }
    return { error: 'timed out waiting for the provider' };
  }

  function closeEditor() { $('editor-modal').hidden = true; edit.scenario=null; }
  function buildNotesGrid() {
    const g = $('notes-grid'); g.innerHTML='';
    ['1','2','3','4','5','6','GK'].forEach(pos => {
      const row = document.createElement('div'); row.className='note-row';
      row.innerHTML = `<span class="note-badge ${pos==='GK'?'gk':'att'}">${pos}</span>`;
      const inp = document.createElement('input');
      inp.type='text'; inp.placeholder='What does '+(pos==='GK'?'the goalkeeper':'player '+pos)+' do?';
      inp.value = (edit.scenario.notes&&edit.scenario.notes[pos])||'';
      inp.oninput = () => { edit.scenario.notes[pos]=inp.value; };
      row.appendChild(inp); g.appendChild(row);
    });
  }
  function currentFrame() { return edit.scenario.frames[edit.idx]; }

  function editorRender() {
    const layers = edit.layers;
    while (layers.pathLayer.firstChild) layers.pathLayer.removeChild(layers.pathLayer.firstChild);
    drawEditorPaths(layers, edit.scenario);
    while (layers.discLayer.firstChild) layers.discLayer.removeChild(layers.discLayer.firstChild);
    const f = currentFrame();
    Object.keys(f.att).forEach(pos => addEditableDisc(layers,'A',pos,f.att[pos]));
    Object.keys(f.def).forEach(pos => addEditableDisc(layers,'D',pos,f.def[pos]));
    if (f.gk) addEditableDisc(layers,'GK','GK',f.gk);
    (f.extra||[]).forEach((e,i)=> addEditableExtra(layers, e, i));
    addEditableBall(layers, f);
    buildFrameChips(); buildCarrierSelect(); syncShotControls(); paintZones(edit.layers);
  }
  /* mark the current keyframe as "the shot happens here" */
  function shooterForFrame() {
    const i = edit.idx, fr = edit.scenario.frames;
    const prev = fr[i - 1], cur = fr[i];
    const c = (prev && prev.ball && prev.ball.carrier) || (cur && cur.ball && cur.ball.carrier) || '';
    return (c && c[0] === 'A') ? c.slice(1) : null;
  }
  function syncShotControls() {
    const box = $('ed-shot'); if (!box) return;
    const f = currentFrame(), who = (f.shot && f.shot.by) || shooterForFrame();
    box.checked = !!(f.shot && f.shot.by);
    box.disabled = !who;
    $('ed-shot-kind').value = (f.shot && f.shot.kind) || 'shot';
    $('ed-shot-kind').disabled = !box.checked;
    $('ed-shot-label').textContent = who ? `◎ Step ${edit.idx + 1}: ${who} shoots` : '◎ Shot (needs a ball carrier)';
  }
  function setShotOnFrame(on) {
    const f = currentFrame(), who = (f.shot && f.shot.by) || shooterForFrame();
    if (on && who) SHOT.markShot(f, who, $('ed-shot-kind').value); else delete f.shot;
    syncShotControls(); drawEditorPathsRefresh();
  }
  function drawEditorPaths(layers, scenario) { ANIM.drawTactics(layers, scenario, null); }
  function addEditableDisc(layers, team, pos, pt) {
    const g = POOL.disc(team, pos); g.classList.add('editable');
    g.setAttribute('transform', `translate(${pt.x},${pt.y})`);
    layers.discLayer.appendChild(g);
    makeDraggable(g, $('editor-pool'), (np) => {
      const f = currentFrame();
      const map = team==='A'?f.att:team==='D'?f.def:null;
      if (map) map[pos]=np; else f.gk=np;
      g.setAttribute('transform', `translate(${np.x},${np.y})`);
      if (f.ball.carrier === team+pos) updateBallEl(f);
      drawEditorPathsRefresh();
    }, false);
    return g;
  }
  function addEditableExtra(layers, e, i) {
    const g = POOL.disc(e.team, e.label, true); g.classList.add('editable');
    g.setAttribute('transform', `translate(${e.x},${e.y})`);
    layers.discLayer.appendChild(g);
    makeDraggable(g, $('editor-pool'), (np) => {
      const f = currentFrame(); f.extra[i].x = np.x; f.extra[i].y = np.y;
      g.setAttribute('transform', `translate(${np.x},${np.y})`);
    }, true);
  }
  let ballEl=null;
  function addEditableBall(layers, f) {
    ballEl = POOL.ball(); ballEl.classList.add('editable');
    const p = ballGeom(f); ballEl.setAttribute('transform', `translate(${p.x},${p.y})`);
    layers.discLayer.appendChild(ballEl);
    makeDraggable(ballEl, $('editor-pool'), (np)=>{
      f.ball = { carrier:null, x:np.x, y:np.y };
      ballEl.setAttribute('transform', `translate(${np.x},${np.y})`); buildCarrierSelect();
    }, false);
  }
  function ballGeom(f){ const b=ANIM.ballPoint(f); return {x:b.x,y:b.y}; }
  function updateBallEl(f){ if(!ballEl)return; const p=ballGeom(f); ballEl.setAttribute('transform',`translate(${p.x},${p.y})`); }
  function drawEditorPathsRefresh(){ ANIM.drawTactics(edit.layers, edit.scenario, null); }
  function buildFrameChips() {
    const wrap=$('frame-chips'); wrap.innerHTML='';
    edit.scenario.frames.forEach((fr,i)=>{
      const c=document.createElement('button');
      c.className='frame-chip'+(i===edit.idx?' active':''); c.textContent=i+1;
      c.onclick=()=>{ edit.idx=i; editorRender(); };
      wrap.appendChild(c);
    });
  }
  function buildCarrierSelect() {
    const f=currentFrame(); const sel=$('ball-carrier'); sel.innerHTML='';
    const opt=(v,l)=>{ const o=document.createElement('option'); o.value=v; o.textContent=l; sel.appendChild(o); };
    opt('','Free (in flight)');
    Object.keys(f.att).forEach(p=>opt('A'+p,'Player '+p));
    Object.keys(f.def).forEach(p=>opt('D'+p,'Defender '+p));
    if (f.gk) opt('GK','Goalkeeper');
    sel.value = f.ball.carrier || '';
    sel.onchange = () => {
      if (sel.value) f.ball = { carrier: sel.value };
      else { const p=ballGeom(f); f.ball={carrier:null,x:p.x,y:p.y}; }
      updateBallEl(f);
    };
  }
  function makeDraggable(el, svgEl, onMove, anywhere) {
    let dragging=false;
    const clampFn = anywhere ? POOL.clampAnywhere : POOL.clampToWater;
    const down=(e)=>{ dragging=true; el.classList.add('dragging'); e.preventDefault(); window.addEventListener('pointermove',move); window.addEventListener('pointerup',up); };
    const move=(e)=>{ if(!dragging)return; const p=clampFn(POOL.eventToVB(svgEl,e)); onMove({x:+p.x.toFixed(1),y:+p.y.toFixed(1)}); };
    const up=()=>{ dragging=false; el.classList.remove('dragging'); window.removeEventListener('pointermove',move); window.removeEventListener('pointerup',up); };
    el.addEventListener('pointerdown',down); el.style.cursor='grab';
  }

  function addFrame() {
    const nf = DATA.clone(currentFrame()); delete nf.shot;   // a shot belongs to ONE step
    edit.scenario.frames.splice(edit.idx+1,0,nf);
    edit.idx++; editorRender();
    toast('Step recorded — drag players to their next spots');
  }
  function delFrame() {
    if (edit.scenario.frames.length<=1){ toast('A play needs at least one step'); return; }
    edit.scenario.frames.splice(edit.idx,1); edit.idx=Math.max(0,edit.idx-1); editorRender();
  }
  function countExtras() { return (currentFrame().extra||[]).length; }
  function addWaiting(lane) {
    const f = currentFrame(); f.extra = f.extra || [];
    const sameLane = f.extra.filter(e => POOL.zoneOf(e)===lane).length;
    const team = lane==='exc' ? 'D' : 'A';
    const label = lane==='exc' ? 'EX' : 'S';
    const z = lane==='exc' ? POOL.EXCZONE : POOL.SUBZONE;
    const p = POOL.stackPos(z, sameLane);
    f.extra.push({ team, label, x:p.x, y:p.y });
    editorRender();
    toast(lane==='exc' ? 'Excluded player added to re-entry lane' : 'Substitute added to flying-sub lane');
  }
  function delWaiting() {
    const f = currentFrame(); if (!f.extra||!f.extra.length){ toast('No waiting players'); return; }
    f.extra.pop(); editorRender();
  }

  function saveScenario() {
    const sc=edit.scenario;
    sc.title=$('ed-title').value.trim(); sc.description=$('ed-desc').value.trim();
    if (!sc.title){ toast('Give the play a title'); $('ed-title').focus(); return; }
    sc.builtIn=false;
    sc.author = edit.isNew ? state.user.name : (sc.author && sc.author!=='Playbook (sample)' ? sc.author : state.user.name);
    stampPrivacy(sc, true);
    const i = state.scenarios.findIndex(s=>s.id===sc.id);
    if (i>=0) state.scenarios[i]=sc; else state.scenarios.push(sc);
    DATA.save(state.scenarios);
    DATA.logActivity('play', `${state.user.name} ${edit.isNew?'created':'updated'} “${sc.title}” (${sc.situation} ${sc.phase})`, state.user.name);
    state.situation=sc.situation; state.phase=sc.phase;
    closeEditor(); refreshTabs(); renderLibrary(); openScenario(sc.id);
    toast('Saved ✓');
  }
  // trainer adjusts an existing play and keeps BOTH: save the adjusted
  // version as a brand-new movement, leaving the original untouched
  function saveScenarioAs() {
    if (!edit.scenario) return;
    const sc = edit.scenario;
    sc.id = 'usr-' + Math.abs(hash((sc.title||'play') + (typeof performance!=='undefined'?performance.now():'') + Math.random()));
    const t = $('ed-title').value.trim();
    if (!t || t === edit.origTitle) $('ed-title').value = (t || edit.origTitle || 'Play') + ' — variant';
    sc.builtIn = false; sc.author = state.user.name || 'You'; sc.owner = state.user.email;
    edit.isNew = true;               // saveScenario now inserts instead of replacing
    saveScenario();
  }

  function deleteScenario() {
    const id=edit.scenario.id;
    state.scenarios=state.scenarios.filter(s=>s.id!==id); DATA.save(state.scenarios);
    DATA.logActivity('play', `${state.user.name} deleted a play`, state.user.name);
    if (state.selectedId===id) openFirstOrEmpty();
    closeEditor(); renderLibrary(); toast('Deleted');
  }

  /* ======================================================
     ONBOARDING — team invite (link + QR), join flow, guided tour
     ====================================================== */
  const TEAM_KEY = 'thplay.team.v1';
  function loadTeam(){
    try { return JSON.parse(localStorage.getItem(TEAM_KEY)) || { name:'Triibholz WPC', code:'TRII-2026' }; }
    catch(e){ return { name:'Triibholz WPC', code:'TRII-2026' }; }
  }
  function inviteLink(){ const t=loadTeam(); return location.origin + location.pathname + '?join=' + encodeURIComponent(t.code); }
  function joinParam(){ try { return new URLSearchParams(location.search).get('join'); } catch(e){ return null; } }

  function inviteCardHtml(){
    const t = loadTeam(); const link = inviteLink();
    let qr=''; try { if (typeof QR!=='undefined') qr = QR.toSVG(link, { size:148, quiet:2 }); } catch(e){ qr=''; }
    return `<div class="invite-card">
      <div class="invite-left">
        <span class="dc-k">Invite players</span>
        <div class="invite-code">${escapeHtml(t.code)}</div>
        <p class="dc-note">Players scan the code (or open the link) and tap their cap number — no typing, no accounts to set up.</p>
        <div class="invite-actions"><button class="btn-primary sm" id="invite-copy">Copy invite link</button></div>
      </div>
      <div class="invite-qr" title="${escapeHtml(link)}">${qr||'<span class="dc-note">QR unavailable</span>'}</div>
    </div>`;
  }
  function bindInvite(root){
    const b = root.querySelector('#invite-copy'); if(!b) return;
    b.onclick = () => {
      const link = inviteLink();
      const done = ()=> toast('Invite link copied — share it with your players');
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done).catch(()=>toast(link));
      else toast(link);
    };
  }

  // first-run guided tour (coach-marks)
  function maybeRunTour(){
    let done; try { done = localStorage.getItem('thplay.toured'); } catch(e){}
    if (done) return;
    setTimeout(()=>{
      const visible = (el)=>{
        if(!el) return false; if(el.hidden) return false;
        const cs = (typeof getComputedStyle==='function') ? getComputedStyle(el) : null;
        return !(cs && (cs.display==='none' || cs.visibility==='hidden'));
      };
      const steps = [
        { sel:'#main-nav',        text:'Move between Dashboard, Playbook, Basics and Trivia here.' },
        { sel:'#lang-switch-top', text:'Change language any time — the whole app follows.' },
        { sel:'#user-pill',       text:'Your account lives here — tap the power icon to sign out.' },
      ].filter(s => visible(document.querySelector(s.sel)));
      if (steps.length) runTour(steps, ()=>{ try{ localStorage.setItem('thplay.toured','1'); }catch(e){} });
    }, 350);
  }
  function runTour(steps, done){
    let i=0;
    const ov=document.createElement('div'); ov.className='tour-overlay'; document.body.appendChild(ov);
    function render(){
      const s=steps[i]; const el=document.querySelector(s.sel);
      if(!el){ finish(); return; }
      const r=el.getBoundingClientRect();
      const tipLeft=Math.min(Math.max(8,r.left), (window.innerWidth||360)-268);
      const tipTop=Math.min(r.bottom+12, (window.innerHeight||600)-150);
      ov.innerHTML=`<div class="tour-hole" style="left:${r.left-6}px;top:${r.top-6}px;width:${r.width+12}px;height:${r.height+12}px"></div>
        <div class="tour-tip" style="left:${tipLeft}px;top:${tipTop}px">
          <p>${escapeHtml(s.text)}</p>
          <div class="tour-actions"><span class="tour-step">${i+1}/${steps.length}</span>
            <button class="btn-ghost sm" id="tour-skip">Skip</button>
            <button class="btn-primary sm" id="tour-next">${i===steps.length-1?'Got it':'Next'}</button></div>
        </div>`;
      const next=ov.querySelector('#tour-next'), skip=ov.querySelector('#tour-skip');
      if(next) next.onclick=()=>{ i++; if(i>=steps.length) finish(); else render(); };
      if(skip) skip.onclick=finish;
    }
    function finish(){ ov.remove(); if(done) done(); }
    render();
  }

  /* ---------------- wire events ---------------- */
  function wire() {
    $('signin-apple').onclick  = (e)=> simulateSignIn('apple', e.currentTarget);
    $('signin-google').onclick = (e)=> simulateSignIn('google', e.currentTarget);
    document.querySelectorAll('.demo-btn').forEach(b=> b.onclick=()=> enterDemo(b.dataset.demo));

    document.querySelectorAll('#role-seg .seg-btn').forEach(b=> b.onclick=()=>{
      state.setup.role=b.dataset.role;
      document.querySelectorAll('#role-seg .seg-btn').forEach(x=>x.classList.toggle('active',x===b));
      updatePositionBlock();
    });
    document.querySelectorAll('#position-grid .pos-chip').forEach(b=> b.onclick=()=>{
      state.setup.position=b.dataset.pos;
      document.querySelectorAll('#position-grid .pos-chip').forEach(x=>x.classList.toggle('active',x===b));
    });
    $('setup-continue').onclick = submitSetup;

    $('pending-recheck').onclick = ()=>{ const u=DATA.findUserByEmail(state.user.email); if(u&&u.status!=='pending'){ routeUser(u); toast(u.status==='approved'?'Approved — welcome in':'Access declined'); } else toast('Still pending approval'); };
    $('pending-signout').onclick = ()=>{ clearSession(); state.user=null; show('auth-screen'); };
    $('denied-signout').onclick = ()=>{ clearSession(); state.user=null; show('auth-screen'); };

    document.querySelectorAll('#main-nav .nav-btn').forEach(b=> b.onclick=()=>switchView(b.dataset.view));

    document.querySelectorAll('#phase-toggle .phase-btn').forEach(b=> b.onclick=()=>{ state.phase=b.dataset.phase; refreshTabs(); renderLibrary(); openFirstOrEmpty(); });

    $('play-btn').onclick = ()=> {
      if (adjust.live) {
        if (adjust.dirty) { toast('Save or cancel your changes first'); return; }
        exitPausedEditToViewer(stepT(), true);   // resume from the step on screen
        return;
      }
      state.viewer && state.viewer.toggle();
    };
    $('step-fwd').onclick  = ()=> adjust.live ? adjustStep(1)  : (state.viewer && state.viewer.stepFwd());
    $('step-back').onclick = ()=> adjust.live ? adjustStep(-1) : (state.viewer && state.viewer.stepBack());
    $('scrub').oninput = (e)=> {
      if (adjust.live) {
        if (adjust.dirty) { e.target.value = Math.round(stepT()*1000); return; }
        adjust.live = false;
        const hint = $('pool-drag-hint'); if (hint) hint.hidden = true;
        buildViewer(e.target.value/1000, false);
        return;
      }
      state.viewer && state.viewer.seek(e.target.value/1000);
    };
    $('scrub').onchange = ()=> {   // released the slider while paused → draggable again
      if (!adjust.live && state.viewer && !state.viewer.playing) enterPausedEdit();
    };
    const afterFocusChange = ()=>{ if(state.viewer)state.viewer.setFocus(state.focus); if(adjust.live)renderAdjustBoard(); syncFocusUI(); const s=state.scenarios.find(x=>x.id===state.selectedId); if(s)renderAssignments(s); updateMyCue(); };
    $('view-team').onclick = ()=>{ state.viewMode='team'; state.focus=null; afterFocusChange(); };
    $('steps-toggle').onclick = toggleSteps;
    $('zones-toggle').onclick = toggleZones; applyZones();
    $('gk-toggle').onclick = toggleGk; applyGk();
    $('scene3d-toggle').onclick = toggle3d;
    scene3dTarget = scene3dLoadTarget(); if ($('scene3d-target')) $('scene3d-target').value = scene3dTarget;
    $('scene3d-target').onchange = e => { scene3dTarget = e.target.value; scene3dSaveTarget(scene3dTarget); if (!scene3dTarget) scene3dCam = MANIKIN.makeCamera({}); draw3dNow(); };
    wire3dInteraction();
    window.addEventListener('resize', () => { if (scene3dShown()) { resize3d(); draw3dNow(); } });
    apply3d();
    $('ed-shot').onchange = e => setShotOnFrame(e.target.checked);
    $('ed-shot-kind').onchange = () => { if ($('ed-shot').checked) setShotOnFrame(true); };
    document.querySelectorAll('#speed-seg [data-speed]').forEach(b => b.onclick = () => applySpeed(b.dataset.speed));
    applySpeed(savedSpeed());
    $('fs-btn').onclick = () => toggleFull();
    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) toggleFull(false); });
    // full-screen bar: hover / tap shows it, buttons delegate to the main controls
    const pw = document.querySelector('#view-playbook .pool-wrap');
    if (pw) {
      ['mousemove', 'touchstart', 'pointerdown'].forEach(ev => pw.addEventListener(ev, () => fsBarShow(), { passive: true }));
      pw.addEventListener('pointerleave', fsBarFade);       // hand off the board → the controls go away
    }
    wireFsDrag();
    window.addEventListener('resize', () => { if ($('view-playbook').classList.contains('stage-full')) fsBarApplyStored(); });
    $('fsb-play').onclick = () => $('play-btn').click();
    $('fsb-fwd').onclick = () => $('step-fwd').click();
    $('fsb-back').onclick = () => $('step-back').click();
    $('fsb-restart').onclick = () => { if (adjust.live) { adjust.idx = 0; renderAdjustBoard(); } else if (state.viewer) { state.viewer.seek(0); } };
    $('fsb-exit').onclick = () => toggleFull(false);
    document.querySelectorAll('#fsb-speed [data-speed]').forEach(b => b.onclick = () => applySpeed(b.dataset.speed));
    document.addEventListener('keydown', e => {
      const full = $('view-playbook').classList.contains('stage-full');
      if (e.key === 'Escape' && full) { toggleFull(false); return; }
      if (!full || /input|textarea|select/i.test((e.target && e.target.tagName) || '')) return;
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); $('play-btn').click(); fsBarShow(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); $('step-fwd').click(); fsBarShow(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); $('step-back').click(); fsBarShow(); }
      else if (e.key === 'r' || e.key === 'Home') { if (state.viewer) state.viewer.seek(0); fsBarShow(); }
      else if (e.key === '-' || e.key === '_') { applySpeed(Math.max(0.25, savedSpeed() - 0.25)); fsBarShow(); }
      else if (e.key === '+' || e.key === '=') { applySpeed(Math.min(1.5, savedSpeed() + 0.25)); fsBarShow(); }
    });
    wireShare();
    $('view-me').onclick = ()=>{ state.viewMode='me'; state.focus=defaultFocus()||(state.user.position||'1'); afterFocusChange(); };
    $('focus-pos').onchange = (e)=>{ state.focus=e.target.value||null; state.viewMode=state.focus?'me':'team'; afterFocusChange(); };

    document.querySelectorAll('#mode-toggle .mode-btn').forEach(b=> b.onclick=()=>setMode(b.dataset.mode, false));
    $('reveal-btn').onclick = ()=>{ setMode('solution', true); onStudied(); };
    $('sound-toggle').onclick = (e)=>{
      const on = !FX.isSoundOn(); FX.setSound(on);
      e.currentTarget.textContent = on ? '🔊' : '🔇';
      if (on) FX.sound('whistle');
      toast(on ? 'Sound on' : 'Sound off');
    };

    // "How to use" — the ？ in the top bar explains the CURRENT view; small
    // [data-help] chips sit next to each feature
    $('help-btn').onclick = ()=> { if (typeof HELP==='undefined') return; if (adjust.live) HELP.show('adjust'); else HELP.forView(state.view); };
    document.addEventListener('click', e => {
      const chip = e.target.closest && e.target.closest('[data-help]');
      if (chip && typeof HELP!=='undefined') { e.preventDefault(); HELP.show(chip.dataset.help); }
    });
    // keyboard shortcuts in the playbook: Space = play/pause, ←/→ = step
    document.addEventListener('keydown', e => {
      if (!$('app-screen').classList.contains('active') || state.view!=='playbook') return;
      if (!$('editor-modal').hidden || (typeof HELP!=='undefined' && document.querySelector('.help-backdrop:not([hidden])'))) return;
      const tag = (e.target && e.target.tagName || '').toLowerCase();
      if (tag==='input' || tag==='textarea' || tag==='select') return;
      if (!state.viewer && !adjust.live) return;
      if (e.key===' ')            { e.preventDefault(); $('play-btn').click(); }
      else if (e.key==='ArrowRight'){ e.preventDefault(); $('step-fwd').click(); }
      else if (e.key==='ArrowLeft') { e.preventDefault(); $('step-back').click(); }
    });

    $('audible-btn').onclick = ()=> { if ($('audible-sheet').hidden) openAudible(); else closeAudible(); };
    $('as-close').onclick = ()=> closeAudible();

    $('adj-undo').onclick = ()=> adjustUndo();
    $('adj-cancel').onclick = ()=> adjustCancel();
    $('adj-save').onclick = ()=> adjustSave(false);
    $('adj-save-new').onclick = ()=> adjustSave(true);

    $('new-scenario-btn').onclick = ()=> { if(canEdit()) newPlayFlow(); };
    $('tpl-btn').onclick = toggleTemplate;
    if ($('ed-from-tpl')) $('ed-from-tpl').onclick = () => { $('editor-modal').hidden = true; newPlayFlow(true); };
    $('tpl-close').onclick = () => { $('tpl-modal').hidden = true; };
    $('tpl-blank').onclick = () => { $('tpl-modal').hidden = true; openEditor(DATA.newScenario(state.situation, state.phase), true); };
    $('edit-btn').onclick = ()=>{ const s=state.scenarios.find(x=>x.id===state.selectedId); if(s&&canEdit()) openEditor(s,false); };
    $('editor-close').onclick = closeEditor; $('ed-cancel').onclick = closeEditor;
    $('ed-save').onclick = saveScenario; $('ed-saveas').onclick = saveScenarioAs; $('ed-delete').onclick = deleteScenario;
    $('add-frame').onclick = addFrame; $('del-frame').onclick = delFrame;
    $('draft-text').addEventListener('input', ()=> {
      clearTimeout(draftTimer);
      draftTimer = setTimeout(applyDraft, 350);
    });
    $('add-sub').onclick = ()=>addWaiting('sub'); $('add-exc').onclick = ()=>addWaiting('exc'); $('del-wait').onclick = delWaiting;
    $('ed-situation').onchange = (e)=>{ edit.scenario.situation=e.target.value; edit.scenario.frames=[DATA.defaultFrame(e.target.value)]; edit.idx=0; editorRender(); toast('Formation reset for '+DATA.sit(e.target.value).label); };
    $('ed-phase').onchange = (e)=>{ edit.scenario.phase=e.target.value; };
    if ($('ed-visibility')) $('ed-visibility').onchange = (e)=>{ edit.scenario.visibility=e.target.value; };

    $('logout-btn').onclick = (e)=>{ e.stopPropagation(); clearSession(); state.user=null; if (typeof SHARE!=='undefined' && $('auth-share-note')) $('auth-share-note').hidden = !SHARE.fromHash(location.hash); show('auth-screen'); };
    $('editor-modal').onclick = (e)=>{ if(e.target===$('editor-modal')) closeEditor(); };
  }

  /* ---------------- i18n glue ---------------- */
  function roleL(r){ return (typeof I18N!=='undefined') ? I18N.t('role.'+r) : DATA.roleLabel(r); }
  function buildLangSwitch(id){
    const el = $(id); if (!el || typeof I18N==='undefined') return;
    el.innerHTML='';
    I18N.SUPPORTED.forEach(l=>{
      const b=document.createElement('button');
      b.className='lang-btn'+(l.code===I18N.lang?' active':'');
      b.innerHTML=`<span class="lang-flag">${l.flag}</span><span class="lang-code">${l.code.toUpperCase()}</span>`;
      b.title=l.label;
      b.onclick=()=>{ I18N.setLang(l.code); if(state.user && typeof DATA!=='undefined') DATA.addBadge(state.user.email,'polyglot'); };
      el.appendChild(b);
    });
  }
  function refreshLangSwitches(){ buildLangSwitch('lang-switch-auth'); buildLangSwitch('lang-switch-top'); }
  function updateUserPill(){
    if(!state.user) return;
    $('user-name').textContent = state.user.name;
    $('user-sub').textContent = state.user.role==='player'
      ? `${roleL('player')} ${state.user.position||''} · ${state.user.provider}`
      : `${roleL(state.user.role)} · ${state.user.provider}`;
    $('user-avatar').textContent = (state.user.name||'?').charAt(0).toUpperCase();
  }

  function boot() {
    if (boot._done) return;   // guard double DOMContentLoaded (harness/edge cases)
    boot._done = true;
    if (typeof I18N!=='undefined') {
      I18N.init();
      I18N.onChange(()=>{
        refreshLangSwitches();
        updateUserPill();
        if ($('app-screen').classList.contains('active')) switchView(state.view);
        if ($('setup-screen').classList.contains('active')) updatePositionBlock();
      });
    }
    wire();
    refreshLangSwitches();
    if (typeof FX!=='undefined' && $('sound-toggle')) $('sound-toggle').textContent = FX.isSoundOn() ? '🔊' : '🔇';
    if (typeof I18N!=='undefined') I18N.apply(document);
    // PWA: register the service worker when served over http(s)
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(()=>{});
    }
    const sess = loadSession();
    if (sess && sess.email) { const u = DATA.findUserByEmail(sess.email); if (u && u.role) { routeUser(u); return; } }
    if (typeof SHARE!=='undefined' && SHARE.fromHash(location.hash) && $('auth-share-note')) $('auth-share-note').hidden = false;
    show('auth-screen');
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
