/* ============================================================
   app.js — auth + approvals + roles, nav/views, dashboards,
   trivia, super-admin console, playbook viewer & coach editor.
   ============================================================ */
(() => {
  const $ = (id) => document.getElementById(id);
  const C = name => THEME.c(name);   // colour tokens as values (js/theme.js, css/styles.css)
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
  /* Translate. Module-scope on purpose: it used to be re-declared inside individual render
     functions, which is why a T() written anywhere else silently threw. t() reads the live
     language from its own closure, so a switch re-renders correctly. */
  const T = (k, vars) => (typeof I18N !== 'undefined') ? I18N.t(k, vars) : k;

  /* ---------------- auth (simulated Apple / Google) ---------------- */
  const MOCK = {
    apple:  { name: 'Alex Marsh', email: 'alex@icloud.com', provider: 'Apple'  },
    google: { name: 'Sam Rivera', email: 'sam@gmail.com',   provider: 'Google' },
  };
  function simulateSignIn(which, btn) {
    btn.classList.add('loading');
    btn.querySelector('span').textContent = T('ui.signingIn');
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
  /* Signing out, wherever it is asked for. There are three buttons (the top bar, and the two on the
     "waiting to be approved" and "not approved" screens), and they must all do the same three
     things: end the session at the club, take the club's children off this device, and forget who
     was here. A second button that quietly did less than the first is how a roster survives a
     sign-out on a shared laptop. The wipe never waits on the network — a wipe that depends on a
     server being reachable is not a wipe. */
  function signOutEverything() {
    if (realAccounts && typeof SESSION !== 'undefined') SESSION.signOut().catch(()=>{});
    if (typeof TEAMS !== 'undefined') TEAMS.wipeDevice();
    clearSession();
    state.user = null;
  }

  /* ---------------- real accounts (js/session.js) ----------------
     Switched on by the server, not by the app: /api/health says whether this deployment has
     accounts. When it does, the simulated sign-in and the demo personas are not offered at all —
     a passkey is the only way in, and the club decides who gets one. */
  let realAccounts = false, pendingCode = null, swUpdateShown = false;
  const ROLE_WORD = { admin: 'club.roleAdmin', coach: 'role.coach', trainer: 'role.trainer', player: 'role.player' };
  const codeFromHash = () => { const m = /[#&](?:invite|join)=([A-Za-z0-9-]+)/.exec(location.hash || ''); return m ? m[1] : null; };
  function showRealAuth(on) {
    const real = $('auth-real'), sim = $('auth-simulated');
    if (real) real.hidden = !on;
    if (sim) sim.hidden = on;
  }
  async function realBoot() {
    realAccounts = typeof SESSION !== 'undefined' && await SESSION.probe();
    if (!realAccounts) return false;
    showRealAuth(true);
    let who = null;
    try { who = await SESSION.me(); } catch (e) { if (e.status === 426) toast(T('auth.updateApp')); }
    const code = codeFromHash();
    if (code) await offerCode(code);
    if (who) { routeReal(SESSION.appUser()); return true; }
    show('auth-screen');
    return true;
  }
  /* what this code is for, before anyone types anything: the club and the role it asks for */
  async function offerCode(code) {
    try {
      const info = await SESSION.peek(code);
      pendingCode = code;
      const note = $('auth-join-note');
      if (note) { note.hidden = false; note.textContent = T('auth.joiningAs', { club: info.club.name, role: T(ROLE_WORD[info.role] || 'role.player').toLowerCase() }); }
      if ($('auth-name-wrap')) $('auth-name-wrap').hidden = false;
      if ($('auth-create')) $('auth-create').hidden = false;
      if ($('auth-code')) $('auth-code').value = '';
    } catch (e) { toast(T(e.status === 426 ? 'auth.updateApp' : 'auth.codeUnknown')); }
  }
  const passkeyProblem = e => toast(T(e && e.status === 426 ? 'auth.updateApp' : 'auth.passkeyFailed'));
  async function createAccount() {
    if (!SESSION.supported()) return toast(T('auth.noPasskeySupport'));
    const name = (($('auth-name') || {}).value || '').trim();
    if (!name) return toast(T('auth.nameNeeded'));
    try { await SESSION.register(pendingCode, name); pendingCode = null; cleanAuthHash(); routeReal(SESSION.appUser()); }
    catch (e) { passkeyProblem(e); }
  }
  async function signInWithPasskey() {
    if (!SESSION.supported()) return toast(T('auth.noPasskeySupport'));
    try {
      await SESSION.signIn();
      if (pendingCode) { try { await SESSION.join(pendingCode); await SESSION.me(); } catch (e) {} pendingCode = null; }
      cleanAuthHash();
      routeReal(SESSION.appUser());
    } catch (e) { passkeyProblem(e); }
  }
  /* a used code should not sit in the address bar of a shared screen */
  function cleanAuthHash() {
    try { if (codeFromHash() && history.replaceState) history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
  }
  function routeReal(user) {
    if (!user) return show('auth-screen');
    state.user = user;
    if (user.status === 'approved') return enterApp();
    const num = user.pending && user.pending.requestNo;
    if ($('pending-email')) $('pending-email').textContent = num ? T('auth.waitingApproval', { n: num }) : user.name;
    show('pending-screen');
  }

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
    if (joinParam()) setTimeout(()=> toast(T('ui.youReJoiningTeam', { team: loadTeam().name })), 400);
  }
  function updatePositionBlock() {
    const isPlayer = state.setup.role === 'player';
    $('position-block').style.display = isPlayer ? '' : 'none';
    $('position-block').querySelector('.setup-label').textContent = isPlayer ? T('setup.posReq') : T('setup.posOpt');
    $('role-note').textContent = state.setup.role === 'super-admin' ? T('setup.noteAdmin') : T('setup.noteStaff');
    $('setup-continue').textContent = state.setup.role === 'super-admin' ? T('setup.enterAdmin') : T('setup.request');
  }
  function submitSetup() {
    if (state.setup.role === 'player' && !state.setup.position) { toast(T('ui.pickYourPosition')); return; }
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
    ['dashboard','playbook','basics','film','solutions','season','teams','trivia','development','admin'].forEach(v => $('view-'+v).classList.toggle('active', v===view));
    const inPlaybook = view==='playbook';
    $('situation-tabs').style.display = inPlaybook ? '' : 'none';
    $('phase-toggle').style.display = inPlaybook ? '' : 'none';
    if (view==='dashboard') renderDashboard();
    if (view==='basics') renderBasics();
    if (view==='teams' && typeof TEAMS!=='undefined') TEAMS.render($('view-teams'), { user: state.user, canEdit: canEdit(), toast, inviteHtml: inviteCardHtml, bindInvite });
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
        // 'offense' here meant "somebody attacked", not "WE attacked" — so every possession the
        // opponent ran came into the playbook labelled as one of our attacks
        const sc = DATA.newScenario(play.situation || '6v6', play.phase || 'offense');
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
    if (view==='development') renderDevelopment();
    if (view==='admin') renderAdmin();
    if (view==='playbook' && !state.selectedId) openFirstOrEmpty();
    if (typeof updateAudibleBtn==='function') updateAudibleBtn();
  }

  /* ---------------- enter app ---------------- */
  function enterApp() {
    // reset per-session view state — logout/login must not leak the previous
    // user's open scenario, focus or problem/solution mode
    state.selectedId = null; state.focus = null; state.mode = 'solution';
    devViewing = null; devTeamMode = true; devTeamSort = 'name';   // coach A must not land on the player coach B was viewing
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
    // team sheets hold licence numbers and birth years — coaches, trainers and admins only
    $('main-nav').querySelector('.nav-teams').hidden = !canEdit();
    $('new-scenario-btn').style.display = canEdit() ? '' : 'none';
    buildSituationTabs();
    renderLibrary();
    show('app-screen');
    refreshAdminBadge();
    if (typeof loadAnnouncements === 'function') loadAnnouncements();
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
    return `<h3 class="dash-h3">${T('ui.anonymousLearnings')} <button class="help-chip" data-help="privacy" title="${T('ui.howConfidentialityWorks')}">？</button></h3>
      <div class="insights-box">${lines.length ? lines.map(l=>`<div class="ins-row">${escapeHtml(l)}</div>`).join('')
        : `<div class="muted">${T('ui.patternsAppearOnce', { n: PRIVACY.K_MIN })}</div>`}</div>`;
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
      <p class="dash-sub">${roleL(u.role)}${u.position?(' '+T('dash.positionLine',{ n: u.position })):''}</p></div>
      <button class="help-chip" data-help="dashboard" title="${T('ui.howToUseThe')}">？</button></div>`;

    if (u.role === 'player') {
      const total = scn.length;
      html += `<div class="dash-grid">
        ${card('accent', `<span class="dc-k">${T('dash.yourPosition')}</span><span class="dc-v big">${u.position||'—'}</span><span class="dc-note">${T('dash.tapMyPosition')}</span>`)}
        ${card('', `<span class="dc-k">${T('dash.playsToKnow')}</span><span class="dc-v big">${total}</span><span class="dc-note">${T('dash.acrossSituations')}</span>`)}
        ${card('', `<span class="dc-k">${T('dash.triviaBest')}</span><span class="dc-v big">${u.triviaBest||0}<small>/${DATA.TRIVIA.length}</small></span><span class="dc-note">${T('dash.historyLegends', { score: u.triviaBestHist||0, total: (DATA.TRIVIA_HISTORY||[]).length })}</span><button class="btn-primary sm" data-go="trivia">${T('dash.takeTheQuiz')}</button>`)}
      </div>
      <div class="progress-card">
        <div class="pc-item"><span class="pc-v">${u.xp||0}</span><span class="pc-k">XP</span></div>
        <div class="pc-item"><span class="pc-v">🔥 ${u.streak||0}</span><span class="pc-k">${T('ui.dayStreak')}</span></div>
        <div class="pc-badges">${badgesHtml(u.badges)}</div>
        <button class="btn-primary sm" data-challenge="1">${T('ui.challenge')}</button>
      </div>
      <h3 class="dash-h3">${T('ui.studyYourRole')}</h3>
      <div class="dash-list">${scn.slice(0,5).map(s=>scnRow(s)).join('')||`<div class="muted">${T('dash.noPlaysYet')}</div>`}</div>`;
    } else if (u.role === 'super-admin') {
      const users = DATA.loadUsers();
      const pend = users.filter(x=>x.status==='pending');
      html += `<div class="dash-grid">
        ${card(pend.length?'warn':'', `<span class="dc-k">${T('dash.pendingApprovals')}</span><span class="dc-v big">${pend.length}</span>${pend.length?`<button class="btn-primary sm" data-go="admin">${T('dash.reviewNow')}</button>`:`<span class="dc-note">${T('dash.allCaughtUp')}</span>`}`)}
        ${card('', `<span class="dc-k">${T('ui.people')}</span><span class="dc-v big">${users.filter(x=>x.status==='approved').length}</span><span class="dc-note">${T('dash.totalAccounts', { n: users.length })}</span>`)}
        ${card('', `<span class="dc-k">${T('dash.playsInLibrary')}</span><span class="dc-v big">${scn.length}</span><span class="dc-note">${T('dash.recordedMovementPatterns')}</span>`)}
      </div>
      <h3 class="dash-h3">${T('ui.liveActivity')}</h3>
      <div class="dash-list">${acts.slice(0,8).map(activityRow).join('')||`<div class="muted">${T('dash.noActivityYet')}</div>`}</div>`;
    } else { // coach / trainer
      const users = DATA.loadUsers();
      html += `<div class="dash-grid">
        ${card('accent', `<span class="dc-k">${T('dash.squad')}</span><span class="dc-v big">${users.filter(x=>x.role==='player'&&x.status==='approved').length}</span><span class="dc-note">${T('dash.approvedPlayers')}</span>`)}
        ${card('', `<span class="dc-k">${T('dash.plays')}</span><span class="dc-v big">${scn.length}</span><button class="btn-primary sm" data-go="playbook">${T('dash.openPlaybook')}</button>`)}
        ${card('', `<span class="dc-k">${T('dash.youCan')}</span><span class="dc-v">${T('dash.recordAndAdjust')}</span><span class="dc-note">${T('dash.pauseAnyPlay')}</span><button class="btn-primary sm" data-newplay>${T('lib.new')}</button>`)}
      </div>
      <h3 class="dash-h3">${T('ui.recentChanges')}</h3>
      <div class="dash-list">${acts.filter(a=>a.type==='play').slice(0,6).map(activityRow).join('')||`<div class="muted">${T('dash.noEditsYet')}</div>`}</div>`;
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
  function greeting(){ return T('setup.welcome'); }
  function badgesHtml(ids){
    ids = ids||[];
    if (!ids.length) return `<span class="pc-none">${T('dash.noBadgesYet')}</span>`;
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
    if (!qs.length){ toast(T('ui.noPlaysAvailableTo')); return; }
    let i=0, score=0;
    const ov=document.createElement('div'); ov.className='modal-backdrop'; ov.id='challenge-modal';
    document.body.appendChild(ov);
    function step(){
      const q=qs[i];
      ov.innerHTML=`<div class="modal challenge-modal">
        <div class="modal-head"><h3>${T('ui.challenge2', { a: i+1, b: qs.length })}</h3><button class="modal-x" id="ch-x">✕</button></div>
        <div class="modal-body">
          <p class="ch-q">${T('ui.challengeQuestion', { title: escapeHtml(q.title), situation: q.situation })}</p>
          <div class="ch-opts">${q.options.map(o=>`<button class="ch-opt" data-o="${o}">${o==='GK'?T('ui.goalkeeperShort'):T('ui.playerN',{ n: o })}</button>`).join('')}</div>
          <div class="ch-why" id="ch-why" hidden></div>
          <button class="btn-primary" id="ch-next" hidden>${i===qs.length-1?T('ui.finish'):T('ui.next')}</button>
        </div></div>`;
      ov.querySelector('#ch-x').onclick = close;
      let answered=false;
      ov.querySelectorAll('.ch-opt').forEach(b=> b.onclick=()=>{
        if(answered) return; answered=true;
        const correct = b.dataset.o===q.correct;
        if(correct){ score++; if(typeof FX!=='undefined') FX.sound('tick'); }
        ov.querySelectorAll('.ch-opt').forEach(x=> x.classList.add(x.dataset.o===q.correct?'right':(x===b?'wrong':'mute')));
        const w=ov.querySelector('#ch-why'); w.hidden=false;
        w.innerHTML = correct? T('ui.correctThatSTheFinisher') : T('ui.notQuitePlayerFinishes', { n: q.correct });
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
        <h2>${perfect?T('ui.flawless'):score>=qs.length*0.6?T('ui.niceWork'):T('ui.keepStudying')}</h2>
        <p class="dash-sub">+${score*8} XP</p>
        <button class="btn-primary" id="ch-done">${T('ui.done')}</button></div></div>`;
      ov.querySelector('#ch-done').onclick=close;
      if (typeof FX!=='undefined'){ if(perfect) FX.celebrate(T('ui.flawless'), T('ui.nOfMCorrect', { a: score, b: qs.length })); else FX.confetti(40); }
    }
    function close(){ ov.remove(); if(state.view==='dashboard') renderDashboard(); }
    step();
  }
  function scnRow(s){
    return `<button class="dash-row" data-open="${s.id}">
      <span class="dr-tag ${s.phase}">${s.situation}</span>
      <span class="dr-main"><span class="dr-title">${escapeHtml(s.title||T('ui.untitled'))}</span><span class="dr-sub">${escapeHtml(s.description||'')}</span></span>
      <span class="dr-steps">${T('dash.nSteps', { n: s.frames.length })}</span></button>`;
  }
  function activityRow(a){
    const icon = {signin:'→',approve:'✓',deny:'✕',play:'✎',trivia:'★'}[a.type]||'•';
    return `<div class="act-row"><span class="act-ic ${a.type}">${icon}</span><span class="act-text">${escapeHtml(a.text)}</span></div>`;
  }

  /* ======================================================
     BASICS — high-level water polo fundamentals
     ====================================================== */
  const BASICS = [
    { icon:'◎', title:'basics.objectTitle', body:[
      'basics.objectB1',
      'basics.objectB2',
      'basics.objectB3' ] },
    { icon:'7', title:'basics.teamTitle', body:[
      'basics.teamB1',
      'basics.teamB2',
      'basics.teamB3' ],
      legend:true },
    { icon:'⏱', title:'basics.structureTitle', body:[
      'basics.structureB1',
      'basics.structureB2',
      'basics.structureB3',
      'basics.structureB4' ] },
    { icon:'▦', title:'basics.poolTitle', body:[
      'basics.poolB1',
      'basics.poolB2',
      'basics.poolB3',
      'basics.poolB4' ] },
    { icon:'⚠', title:'basics.foulsTitle', body:[
      'basics.foulsB1',
      'basics.foulsB2',
      'basics.foulsB3' ] },
    { icon:'✛', title:'basics.keeperTitle', body:[
      'basics.keeperB1',
      'basics.keeperB2',
      'basics.keeperB3' ] },
    { icon:'≈', title:'basics.skillsTitle', body:[
      'basics.skillsB1',
      'basics.skillsB2',
      'basics.skillsB3' ] },
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
          <span class="rules-checked">${data.checkedAt ? T('basics.autoChecked', { date: fmtDate(data.checkedAt) }) : T('basics.bundledSnapshot')} ${T('ui.refreshesAutomaticallyFromSwiss')}</span></div></div>
      <div class="rules-docs">${docs.map(d=>`
        <a class="rules-doc" href="${d.url||data.source.page}" target="_blank" rel="noopener">
          <span class="rd-lang">${escapeHtml(d.lang||'')}</span>
          <span class="rd-main"><span class="rd-title">${escapeHtml(d.title)}${d.stale?(' '+T('basics.lastKnown')):''}</span>
            <span class="rd-sub">${escapeHtml(d.category||'')}${d.version?(' · v '+escapeHtml(d.version)):''}</span></span>
          <span class="rd-open">${T('basics.open')}</span></a>`).join('')}</div>
      <div class="rules-refs">${(data.references||[]).map(r=>`<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.title)} ↗</a>`).join('')}</div>
    </div>`;
  }

  const RESPONSIBILITIES = [
    { icon:'🤽', title:'basics.respPlayersTitle', items:[
      'basics.respPlayers1',
      'basics.respPlayers2',
      'basics.respPlayers3',
      'basics.respPlayers4',
      'basics.respPlayers5',
      'basics.respPlayers6',
      'basics.respPlayers7' ] },
    { icon:'🎯', title:'role.coach', items:[
      'basics.respCoach1',
      'basics.respCoach2',
      'basics.respCoach3',
      'basics.respCoach4',
      'basics.respCoach5',
      'basics.respCoach6',
      'basics.respCoach7' ] },
    { icon:'⚖️', title:'basics.respRefereeTitle', items:[
      'basics.respReferee1',
      'basics.respReferee2',
      'basics.respReferee3',
      'basics.respReferee4',
      'basics.respReferee5',
      'basics.respReferee6' ] },
  ];

  function renderBasics() {
    const v = $('view-basics');
    const legendHtml = `<div class="basics-legend">
        <span class="bl"><span class="bl-dot att"></span>${T('ui.attackWhite')}</span>
        <span class="bl"><span class="bl-dot def"></span>${T('ui.defenceBlack')}</span>
        <span class="bl"><span class="bl-dot gk"></span>${T('ui.goalkeeperRed')}</span>
        <span class="bl"><span class="bl-dot ball"></span>${T('ui.ballOrange')}</span>
      </div>`;
    v.innerHTML = `<div class="dash-wrap">
      <div class="dash-head"><h1>${T('basics.title')}</h1>
        <p class="dash-sub">${T('basics.sub')}</p>
        <button class="help-chip" data-help="basics" title="${T('ui.howToUseBasics')}">？</button></div>
      <div id="rules-mount"></div>
      <div class="basics-grid">
        ${BASICS.map(c=>`<div class="basics-card">
          <div class="basics-h"><span class="basics-ic">${c.icon}</span><h3>${T(c.title)}</h3></div>
          <ul>${c.body.map(p=>`<li>${T(p)}</li>`).join('')}</ul>
          ${c.legend?legendHtml:''}
        </div>`).join('')}
      </div>
      <h3 class="dash-h3">${T('ui.rolesAndResponsibilities')}</h3>
      <div class="basics-grid resp-grid">
        ${RESPONSIBILITIES.map(c=>`<div class="basics-card resp-card">
          <div class="basics-h"><span class="basics-ic">${c.icon}</span><h3>${T(c.title)}</h3></div>
          <ul>${c.items.map(p=>`<li>${T(p)}</li>`).join('')}</ul>
        </div>`).join('')}
      </div>
      <div class="basics-cta">
        <button class="btn-primary sm" data-go="playbook">${T('basics.seePlaybook')}</button>
        <button class="btn-ghost" data-go="trivia">${T('basics.testTrivia')}</button>
      </div>
      <p class="basics-src">${T('basics.sourceNote', { a: `<a href="https://vancouvervipers.ca/water-polo-basics/" target="_blank" rel="noopener">${T('ui.vancouverVipersWaterPolo')}</a>`, b: `<a href="https://www.wikihow.com/Play-Water-Polo" target="_blank" rel="noopener">${T('ui.wikihowPlayWaterPolo')}</a>` })}</p>
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
     MY DEVELOPMENT — a player's own test log, self target, swim weeks
     and home-training streak (modelled on a real club's own process:
     "this is YOUR data, not the team's — you and your coach fill it in,
     you, your parents and the coaching team see it, nobody else").
     ====================================================== */
  const DEV_KEY = e => 'thplay.testlog.' + (e || '').toLowerCase();
  const HOME_KEY = e => 'thplay.hometraining.' + (e || '').toLowerCase();
  function loadDev(email) {
    let d; try { d = JSON.parse(localStorage.getItem(DEV_KEY(email))); } catch (e) { d = null; }
    const out = Object.assign({ info: { name: '', birthYear: '', band: '', position: '', isGK: false, talentCard: '', cardValidUntil: '', lastPiste: '', tier: 0, goalBlock: '', goalWords: '' }, tests: [], swimWeeks: [] }, d || {});
    // one choke point: every reader sees a concrete status. Normalising in memory only —
    // writing here would rewrite the whole squad's storage on every paint of the team view.
    (out.tests || []).forEach(t => { if (t) t.status = TESTLOG.normalizeTestStatus(t.status); });
    return out;
  }
  function saveDev(email, d) { try { localStorage.setItem(DEV_KEY(email), JSON.stringify(d)); } catch (e) {} }
  function loadHome(email) { let d; try { d = JSON.parse(localStorage.getItem(HOME_KEY(email))); } catch (e) { d = null; } return Object.assign({ log: [] }, d || {}); }
  function saveHome(email, d) { try { localStorage.setItem(HOME_KEY(email), JSON.stringify(d)); } catch (e) {} }
  // loadDev() always returns a full default shape, so "never opened it" and "logged nothing"
  // look identical — probe storage directly instead of inferring from the object
  const devHasRecord = e => { try { return localStorage.getItem(DEV_KEY(e)) != null || localStorage.getItem(HOME_KEY(e)) != null; } catch (x) { return false; } };
  const devCanCoach = () => ['coach', 'trainer', 'super-admin'].includes(state.user.role);
  let devViewing = null;   // the email whose record is on screen; null → self
  let devTeamMode = true;  // coaches land on the squad table; a player can never reach it
  let devTeamSort = 'name';
  let devTrendTest = null;   // which test the player's progress chart shows
  function devTargetEmail() { return state.user.role === 'player' ? state.user.email : (devViewing || state.user.email); }

  function renderDevelopment() {
    const root = $('view-development');
    if (devCanCoach() && devTeamMode) { renderDevTeam(root); return; }   // the only gate — devCanCoach() is false for a player
    const email = devTargetEmail();
    const dev = loadDev(email), home = loadHome(email);
    const isSelf = email === state.user.email;
    const canEditThis = isSelf || devCanCoach();
    const wk = TESTLOG.weekKeyOf(new Date().toISOString().slice(0, 10));
    const mascot = TESTLOG.mascotState(home.log, wk);
    const row = TESTLOG.squadRow(dev, home, wk, { today: new Date().toISOString().slice(0, 10), days: 90 });   // same arithmetic the squad table uses
    const roster = devCanCoach() ? DATA.loadUsers().filter(u => u.role === 'player' && u.status === 'approved').sort((a, b) => (a.name || '').localeCompare(b.name || '')) : [];

    const testCat = TESTLOG.testsFor(!!dev.info.isGK);
    const testRows = (dev.tests || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    // a self-reported number is visible but never authoritative until a coach confirms it
    const latest = TESTLOG.latestResults(dev.tests || []);
    const swimRows = (dev.swimWeeks || []).slice().sort((a, b) => (b.week || '').localeCompare(a.week || ''));
    const metCount = row.metVerified;
    const pendingCount = row.pendingCount;
    const reviewRows = (dev.tests || []).filter(t => t.status === 'pending' || t.status === 'denied').sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const tierLabel = TESTLOG.TIERS[dev.info.tier] || TESTLOG.TIERS[0];
    const displayName = dev.info.name || (isSelf ? state.user.name : (roster.find(u => u.email === email) || {}).name) || email;

    // one progress card per test — a bar you can read in a glance, not a spreadsheet row
    const benchCard = (t) => {
      // colour, fill and "at target" come ONLY from confirmed results
      const last = latest.official[t.label] || latest.official[t.id];
      const waiting = latest.pending[t.label] || latest.pending[t.id];
      const ev = last ? TESTLOG.evaluate(t, last.result, dev.info.tier) : null;
      let pct = 0, state_ = 'untested';
      if (ev && ev.target != null) { state_ = ev.met ? 'met' : 'gap'; pct = ev.met ? 100 : Math.max(4, Math.min(96, 100 * (t.lower ? ev.target / ev.value : ev.value / ev.target))); }
      else if (last) { state_ = 'baseline'; pct = 50; }
      return `<div class="dev-bench-card dev-bench-${state_}">
        <div class="dev-bench-top"><b>${escapeHtml(t.label)}</b>${t.piste ? ` <span class="tag" title="${T('dev.pisteTooltip')}">PISTE</span>` : ''}</div>
        <div class="dev-bench-bar"><span style="width:${pct}%"></span></div>
        <div class="dev-bench-bottom"><span>${last ? escapeHtml(String(last.result)) + ' ' + escapeHtml(t.unit) : T('dev.notTestedYet')}</span><span class="muted">${ev ? escapeHtml(ev.deltaText) : (t.targets[dev.info.tier] != null ? T('dev.targetN', { v: escapeHtml(String(t.targets[dev.info.tier])) }) : '')}</span></div>
        ${waiting ? `<div class="dev-bench-pending">${T('dev.benchPending', { result: escapeHtml(String(waiting.result)), unit: escapeHtml(t.unit) })}</div>` : ''}
      </div>`;
    };

    root.innerHTML = `
      <div class="dev-hero">
        <div class="dev-hero-mascot">${(typeof FX !== 'undefined') ? FX.mascot(84, mascot.mood) : ''}</div>
        <div class="dev-hero-info">
          <div class="dev-hero-id"><h1>${escapeHtml(displayName)} <button class="help-chip" data-help="development" title="${T('dev.howThisWorks')}">？</button></h1><span class="tag">${escapeHtml(tierLabel)}</span>${dev.info.position ? `<span class="tag">${T('dev.posN', { n: escapeHtml(dev.info.position) })}</span>` : ''}${dev.info.isGK ? `<span class="tag">GK</span>` : ''}
            ${devCanCoach() ? `<button class="btn-ghost sm" id="dev-back-team">${T('dev.squad')}</button>` : ''}
            ${canEditThis ? `<button class="btn-ghost sm" id="dev-edit-profile">${T('dev.editProfile')}</button>` : ''}</div>
          <div class="dev-hero-goal">${dev.info.goalBlock ? `🎯 ${escapeHtml(dev.info.goalBlock)}` : (canEditThis ? T('dev.noGoalSetYet') : T('dev.noGoalSetYet2'))}</div>
          <div class="dev-hero-line">${escapeHtml(mascot.line)}${mascot.streak > 0 ? (' ' + T('dev.weekStreak', { n: mascot.streak })) : ''}</div>
        </div>
      </div>

      <div class="dev-stats">
        <div class="dev-stat"><b>${metCount}/${testCat.length}</b><span>${T('dev.testsAtTarget')}</span></div>
        <div class="dev-stat"><b>${Math.round(row.compliance * 100)}%</b><span>${T('dev.homeTrainingThisWeek')}</span></div>
        <div class="dev-stat"><b>${row.metres.toLocaleString()} m</b><span>${T('dev.swumThisWeek')}</span></div>
        <div class="dev-stat"><b>${(dev.tests || []).length}</b><span>${T('dev.testsLoggedAllTime')}${pendingCount ? ' · ' + T('dev.nAwaiting', { n: pendingCount }) : ''}</span></div>
      </div>
      ${isSelf && typeof TEAMS !== 'undefined' ? '<div id="dev-playercard"></div>' : ''}

      ${roster.length ? `<details class="dev-coach-tools"><summary>${T('dev.coachToolsViewing')} <b>${devViewing ? escapeHtml((roster.find(u => u.email === devViewing) || {}).name || devViewing) : T('dev.myself')}</b></summary>
        <div class="dev-coach-row"><select id="dev-roster-select" class="focus-select"><option value="">${T('dev.myselfOption')}</option>${roster.map(u => `<option value="${escapeHtml(u.email)}" ${devViewing === u.email ? 'selected' : ''}>${escapeHtml(u.name || u.email)}${u.position ? ' · ' + escapeHtml(u.position) : ''}</option>`).join('')}</select>
          <button class="btn-ghost sm" id="dev-import-btn">${T('dev.importTeamLogbookXlsx')}</button><input type="file" id="dev-import-file" accept=".xlsx,.csv" hidden multiple></div></details>` : ''}

      ${devCanCoach() && reviewRows.length ? `<div class="dev-card dev-review">
        <h3>${T('dev.awaitingYourConfirmation')} <span class="rightbar-hint">${pendingCount} ${T('dev.selfReportedWord')}</span></h3>
        ${reviewRows.map(r => `<div class="dev-review-row">
          <span class="drv-main"><b>${escapeHtml(r.test)}</b> <span class="drv-res">${escapeHtml(String(r.result))} ${escapeHtml(r.unit || '')}</span>
            <span class="muted">${escapeHtml(r.date)}${r.testedBy ? ' · ' + escapeHtml(r.testedBy) : ''}${r.remark ? ' · ' + escapeHtml(r.remark) : ''}</span></span>
          <span class="drv-actions">${r.status === 'denied' ? `<span class="status-chip denied">${T('dev.rejected')}</span>` : ''}
            <button class="btn-primary sm" data-test-verify="${r.id}">${T('dev.confirm')}</button>
            ${r.status === 'pending' ? `<button class="btn-ghost sm danger" data-test-deny="${r.id}">${T('dev.reject')}</button>` : ''}</span>
        </div>`).join('')}
      </div>` : ''}

      ${canEditThis ? `<div class="dev-actions">
        <button class="dev-tile" data-open-modal="test"><span class="dev-tile-ic">🧪</span>${T('dev.logATestResult')}</button>
        <button class="dev-tile" data-open-modal="swim"><span class="dev-tile-ic">🏊</span>${T('dev.logThisWeekS')}</button>
      </div>` : ''}

      <div class="dev-card dev-home">
        <h3>${T('dev.homeTraining')} <span class="rightbar-hint">${T('dev.thisWeek')}</span></h3>
        <div class="dev-home-list">${TESTLOG.HOME_ACTIVITIES.map(a => {
          const n = home.log.filter(e => e.week === wk && e.activityId === a.id).length;
          const done = Math.min(n, a.perWeek);
          return `<div class="dev-home-item"><div class="dev-home-h"><b>${escapeHtml(a.label)}</b><span class="muted">${T('dev.homeDonePerWeekMinutes', { done: done, target: a.perWeek === Math.round(a.perWeek) ? a.perWeek : a.perWeek.toFixed(1), minutes: a.minutes })}</span></div>
            <div class="dev-home-bar"><span style="width:${Math.min(100, Math.round(100 * done / a.perWeek))}%"></span></div>
            <span class="fa-note">${escapeHtml(a.note)}</span>
            ${isSelf ? `<button class="btn-ghost sm" data-home-log="${a.id}">${T('dev.logIt')}</button>` : ''}</div>`;
        }).join('')}</div>
      </div>

      <div class="dev-card dev-bench">
        <h3>${T('dev.testResults')} <span class="rightbar-hint">${T('dev.vsThisSeasonS')}</span></h3>
        <div class="dev-bench-grid">${testCat.map(benchCard).join('')}</div>
      </div>

      ${progressCard(dev)}

      <details class="dev-history"><summary>${T('dev.testLogHistory', { n: testRows.length })}</summary>
        <div class="dev-table-wrap"><table class="dev-table"><thead><tr><th>${T('dev.date')}</th><th>${T('dev.test')}</th><th>${T('dev.result')}</th><th>${T('dev.testedBy')}</th><th>${T('dev.status')}</th><th>${T('dev.remark')}</th>${canEditThis ? '<th></th>' : ''}</tr></thead>
          <tbody>${testRows.map(r => `<tr><td>${escapeHtml(r.date)}</td><td>${escapeHtml(r.test)}</td><td>${escapeHtml(String(r.result))} ${escapeHtml(r.unit || '')}</td><td>${escapeHtml(r.testedBy || '')}</td>
            <td><span class="status-chip ${r.status}">${r.status === 'approved' ? T('dev.confirmed') : r.status === 'denied' ? T('dev.rejected') : T('dev.selfReportedWord')}</span>${r.verifiedBy ? ` <span class="muted">${escapeHtml(r.verifiedBy)}${r.verifiedAt ? ' · ' + escapeHtml(r.verifiedAt) : ''}</span>` : ''}</td>
            <td class="muted">${escapeHtml(r.remark || '')}</td>${canEditThis ? `<td>${(devCanCoach() || (isSelf && r.status === 'pending')) ? `<button class="btn-ghost sm danger" data-test-del="${r.id}">✕</button>` : ''}</td>` : ''}</tr>`).join('') || `<tr><td colspan="${canEditThis ? 7 : 6}" class="muted">${T('dev.noTestsLoggedYet')}</td></tr>`}</tbody></table></div>
        <button class="btn-ghost sm" id="dev-export-tests">${T('dev.downloadCsv')}</button>
      </details>
      <details class="dev-history"><summary>${T('dev.swimWeeksHistory', { n: swimRows.length })}</summary>
        <div class="dev-table-wrap"><table class="dev-table"><thead><tr><th>${T('dev.week')}</th><th>${T('dev.club')}</th><th>${T('dev.selfHome')}</th><th>${T('dev.total')}</th><th>${T('dev.attended')}</th>${canEditThis ? '<th></th>' : ''}</tr></thead>
          <tbody>${swimRows.map(r => `<tr><td>${escapeHtml(r.week)}</td><td>${escapeHtml(String(r.metersClub || 0))}</td><td>${escapeHtml(String(r.metersSelf || 0))}</td><td><b>${escapeHtml(String(r.total || ((+r.metersClub || 0) + (+r.metersSelf || 0))))}</b></td><td class="muted">${escapeHtml(String(r.attended || 0))}/${escapeHtml(String(r.possible || 0))}</td>${canEditThis ? `<td><button class="btn-ghost sm danger" data-swim-del="${r.id}">✕</button></td>` : ''}</tr>`).join('') || `<tr><td colspan="5" class="muted">${T('dev.noWeeksLoggedYet')}</td></tr>`}</tbody></table></div>
        <button class="btn-ghost sm" id="dev-export-swim">${T('dev.downloadCsv')}</button>
      </details>

      <div class="modal-backdrop dev-modal" id="dev-profile-modal" hidden><div class="modal modal-sm">
        <div class="modal-head"><h3>${T('dev.profileAndSelfTarget')}</h3><span class="spacer"></span><button class="modal-x" data-close-modal="dev-profile-modal">✕</button></div>
        <div class="modal-body">
          <div class="dev-form">
            <label>${T('dev.name')}<input type="text" id="dev-name" value="${escapeHtml(dev.info.name || (isSelf ? state.user.name : ''))}"></label>
            <label>${T('dev.birthYear')}<input type="text" id="dev-birth" value="${escapeHtml(dev.info.birthYear)}" placeholder="${T('dev.eG2013')}"></label>
            <label>${T('dev.bandAgeGroup')}<input type="text" id="dev-band" value="${escapeHtml(dev.info.band)}" placeholder="${T('dev.eGCore2013')}"></label>
            <label>${T('dev.position')}<input type="text" id="dev-position" value="${escapeHtml(dev.info.position || state.user.position || '')}"></label>
            <label class="fa-check">${T('dev.goalkeeper')}<input type="checkbox" id="dev-isgk" ${dev.info.isGK ? 'checked' : ''}></label>
            <label>${T('dev.seasonTier')}<select id="dev-tier">${TESTLOG.TIERS.map((t, i) => `<option value="${i}" ${dev.info.tier == i ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}</select></label>
            <label>${T('dev.talentCard')}<input type="text" id="dev-card" value="${escapeHtml(dev.info.talentCard)}" placeholder="${T('dev.eGNational')}"></label>
            <label>${T('dev.cardValidUntil')}<input type="text" id="dev-card-until" value="${escapeHtml(dev.info.cardValidUntil)}" placeholder="${T('dev.yyyyMm')}"></label>
            <label>${T('dev.lastPisteTest')}<input type="text" id="dev-piste" value="${escapeHtml(dev.info.lastPiste)}" placeholder="${T('dev.yyyyMmDd')}"></label>
          </div>
          <label class="dev-goal">${T('dev.myGoalThisBlock')}<input type="text" id="dev-goal-block" value="${escapeHtml(dev.info.goalBlock)}" placeholder="${T('dev.eGSub35s')}"></label>
          <label class="dev-goal">${T('dev.myGoalInMy')}<textarea id="dev-goal-words" rows="2" placeholder="${T('dev.whatDoIWant')}">${escapeHtml(dev.info.goalWords)}</textarea></label>
          <p class="fa-note">${T('dev.thereAreNoBad')}</p>
        </div>
        <div class="modal-foot"><button class="btn-ghost" data-close-modal="dev-profile-modal">${T('dev.cancel')}</button><button class="btn-primary" id="dev-profile-save">${T('dev.save')}</button></div>
      </div></div>

      <div class="modal-backdrop dev-modal" id="dev-test-modal" hidden><div class="modal modal-sm">
        <div class="modal-head"><h3>${T('dev.logATestResult')}</h3><span class="spacer"></span><button class="modal-x" data-close-modal="dev-test-modal">✕</button></div>
        <div class="modal-body dev-add-form">
          <select id="dev-test-id">${testCat.map(t => `<option value="${t.id}">${escapeHtml(t.label)}</option>`).join('')}</select>
          <input type="text" id="dev-test-date" placeholder="${T('dev.dateYyyyMmDd')}" value="${new Date().toISOString().slice(0, 10)}">
          <input type="text" id="dev-test-result" placeholder="${T('dev.resultEG37')}">
          ${devCanCoach()
            ? `<input type="text" id="dev-test-by" placeholder="${T('dev.testedBy')}" value="${escapeHtml(state.user.name)}">`
            : `<input type="text" id="dev-test-by" readonly value="${escapeHtml(state.user.name)}">`}
          <input type="text" id="dev-test-remark" placeholder="${T('dev.remarkOptional')}">
          ${devCanCoach() ? '' : `<p class="fa-note">${T('dev.coachConfirmsNote')}</p>`}
        </div>
        <div class="modal-foot"><button class="btn-ghost" data-close-modal="dev-test-modal">${T('dev.cancel')}</button><button class="btn-primary" id="dev-test-add">${T('dev.saveResult')}</button></div>
      </div></div>

      <div class="modal-backdrop dev-modal" id="dev-swim-modal" hidden><div class="modal modal-sm">
        <div class="modal-head"><h3>${T('dev.logThisWeekS')}</h3><span class="spacer"></span><button class="modal-x" data-close-modal="dev-swim-modal">✕</button></div>
        <div class="modal-body dev-add-form">
          <input type="text" id="dev-swim-week" placeholder="${T('dev.weekMondayYyyyMm')}" value="${TESTLOG.mondayOf(new Date())}">
          <input type="number" id="dev-swim-club" placeholder="${T('dev.metresClub')}">
          <input type="number" id="dev-swim-self" placeholder="${T('dev.metresSelfHome')}">
          <input type="number" id="dev-swim-att" placeholder="${T('dev.sessionsAttended')}">
          <input type="number" id="dev-swim-poss" placeholder="${T('dev.sessionsPossible')}">
        </div>
        <div class="modal-foot"><button class="btn-ghost" data-close-modal="dev-swim-modal">${T('dev.cancel')}</button><button class="btn-primary" id="dev-swim-add">${T('dev.saveWeek')}</button></div>
      </div></div>`;

    wireDevelopment(root, email, dev, home, wk, canEditThis);
  }

  /* ---- one player's test over time ----
     The first place in the app where a result is more than a row in a table: the same numbers as
     the history below, with the season target as a rule across the chart. Better is always up,
     including for times, where the smaller number is the better one. */
  function progressCard(dev) {
    if (typeof CHART === 'undefined') return '';
    const live = (dev.tests || []).filter(r => TESTLOG.normalizeTestStatus(r.status) !== 'denied');
    const cat = TESTLOG.testsFor(!!dev.info.isGK);
    const have = cat.filter(t => live.some(r => r.test === t.label || r.test === t.id));
    if (!have.length) return '';
    const pick = have.find(t => t.id === devTrendTest) || have[0];
    const points = TESTLOG.playerSeries(live, pick.id, dev.info.tier || 0, dev.info.isGK);
    const target = TESTLOG.evaluate(pick, points.length ? points[points.length - 1].value : null, dev.info.tier || 0);
    return `<div class="dev-card dev-charts">
      <h3>${T('dev.progressTitle')} <span class="rightbar-hint">${escapeHtml(pick.unit)}</span></h3>
      <div class="dev-coach-row">
        <label class="ef-label" for="dev-trend-test">${T('dev.progressPick')}</label>
        <select id="dev-trend-test" class="focus-select">${have.map(t => `<option value="${escapeHtml(t.id)}" ${t.id === pick.id ? 'selected' : ''}>${escapeHtml(t.label)}</option>`).join('')}</select>
      </div>
      ${CHART.series(points, { width: 320, height: 140, target: target && target.target, lower: !!pick.lower,
        title: pick.label, empty: T('dev.progressEmpty'), dateFormat: d => d,
        valueFormat: v => pick.unit === 'min:s' ? TESTLOG.fmtSeconds(v) : String(Math.round(v * 100) / 100) })}
      <p class="fa-note">${points.length < 2 ? T('dev.progressOnlyOne') : T('dev.chartsHowToRead')}</p>
    </div>`;
  }

  /* ---- the squad in charts: the same numbers as the table, drawn ----
     Every value comes from TESTLOG (squadByTest / squadFocus / squadCoverage), so a chart can
     never say something the table below it does not. A dot is one player measured against the
     target for THEIR OWN tier, which is why the scale is "% of my target" and not seconds: a
     U14 and a U18 keeper cannot share a seconds axis honestly. The raw result travels in the
     dot's own label. Coverage is stated in the card, not in a footnote: these records live on
     this device, so the chart speaks for the players whose record is here and no one else. */
  function fmtResult(test, value) {
    if (value == null) return '—';
    if (test.unit === 'min:s') return TESTLOG.fmtSeconds(value);
    return `${Math.round(value * 100) / 100} ${test.unit}`;
  }
  function squadCharts(rows) {
    if (typeof CHART === 'undefined') return '';
    const players = rows.filter(x => x.started).map(x => ({ id: x.u.email, name: x.u.name || x.u.email, tier: x.tier, isGK: x.isGK, tests: (x.dev && x.dev.tests) || [] }));
    if (!players.length) return '';
    const opts = { today: new Date().toISOString().slice(0, 10), maxAgeDays: 365 };
    const cover = TESTLOG.squadCoverage(players, opts);
    const groups = [{ gk: false, label: T('dev.chartFieldTests') }].concat(players.some(p => p.isGK) ? [{ gk: true, label: T('dev.chartKeeperTests') }] : []);
    const testRow = t => {
      const test = TESTLOG.testById(t.testId, /^(eggbeater|side|lunge|throw|catch|penalty)/.test(t.testId));
      const strip = CHART.dotStrip(t.rows.map(r => ({
        value: r.ratio, met: r.met, verified: r.verified,
        label: `${r.name} · ${fmtResult(test, r.value)}${r.verified ? '' : ' · ' + T('dev.selfReportedWord')}`,
      })), { target: 1, lower: false, width: 300, height: 52, title: t.label, targetLabel: T('dev.chartTarget'),
        empty: T('dev.chartNoResultsHere'), axisFormat: v => Math.round(v * 100) + '%' });
      return `<tr><td>${escapeHtml(t.label)}${t.piste ? ` <span class="tag">PISTE</span>` : ''}</td>
        <td class="dev-chart-cell">${strip}</td>
        <td class="${t.n && t.metCount === t.n ? 'dev-team-ok' : t.n ? 'dev-team-gap' : 'muted'}">${t.n ? T('dev.chartAtTarget', { met: t.metCount, n: t.n }) : '—'}</td>
        <td class="muted">${t.n ? escapeHtml(fmtResult(test, t.median)) : ''}${t.missing ? `<br><small>${T('dev.chartMissing', { n: t.missing })}</small>` : ''}</td></tr>`;
    };
    const focus = TESTLOG.squadFocus(players, opts);
    const focusLabelOf = k => (FOCUS_LIST().find(f => f[0] === k) || [k, k])[1];
    return `<div class="dev-card dev-charts">
      <h3>${T('dev.chartsTitle')} <span class="rightbar-hint">${T('dev.chartsSince12Months')}</span></h3>
      <p class="fa-note">${T('dev.chartsCoverage', { known: cover.withAny, total: cover.total })} · ${T('dev.chartsConfirmedSplit', { verified: cover.verified, self: cover.self })}</p>
      ${groups.map(g => {
        const all = TESTLOG.squadByTest(players, Object.assign({ gk: g.gk }, opts));
        const done = all.filter(t => t.n > 0);
        const untested = all.filter(t => t.n === 0);
        if (!done.length && !untested.length) return '';
        return `<h4 class="dev-chart-head">${escapeHtml(g.label)}</h4>
          ${done.length ? `<div class="dev-table-wrap"><table class="dev-table dev-chart-table">
            <thead><tr><th>${T('dev.test')}</th><th>${T('dev.chartVsOwnTarget')}</th><th>${T('dev.chartAtTargetHead')}</th><th>${T('dev.chartMedian')}</th></tr></thead>
            <tbody>${done.map(testRow).join('')}</tbody></table></div>` : ''}
          ${untested.length ? `<p class="fa-note">${T('dev.chartsUntested', { n: untested.length, tests: untested.map(t => t.label).join(', ') })}</p>` : ''}`;
      }).join('')}
      ${(() => {
        const withTraining = rows.filter(x => x.r && x.r.training.invited).map(x => ({ label: x.u.name || x.u.email, value: x.r.training.rate, note: T('dev.attendanceOf', { attended: x.r.training.attended, invited: x.r.training.invited }) })).sort((a, b) => a.value - b.value);
        if (!withTraining.length) return `<p class="fa-note">${T('dev.chartsNoAttendance')}</p>`;
        return `<h4 class="dev-chart-head">${T('dev.chartsAttendanceTitle')}</h4>
          ${CHART.bars(withTraining, { width: 460, max: 1, title: T('dev.chartsAttendanceTitle'), empty: T('dev.chartNoResultsHere'), valueFormat: v => Math.round(v * 100) + '%' })}
          <p class="fa-note">${T('dev.chartsAttendanceNote')}</p>`;
      })()}
      ${focus.length ? `<h4 class="dev-chart-head">${T('dev.chartsFocusTitle')}</h4>
        ${CHART.bars(focus.map(f => ({ label: focusLabelOf(f.focus), value: f.gap, note: T('dev.chartsFocusNote', { n: f.players, test: f.worstLabel || '' }) })),
  { width: 460, max: 1, title: T('dev.chartsFocusTitle'), empty: T('dev.chartNoResultsHere'), valueFormat: v => Math.round(v * 100) + '%' })}` : ''}
      <p class="fa-note">${T('dev.chartsHowToRead')}</p>
    </div>`;
  }

  /* ---- the coach's squad table: every player at a glance, one row each ----
     Numbers come from TESTLOG.squadRow, the same function the single-player
     strip uses, so the two views can never quietly disagree. */
  function renderDevTeam(root) {
    const roster = devCanCoach() ? DATA.loadUsers().filter(u => u.role === 'player' && u.status === 'approved').sort((a, b) => (a.name || '').localeCompare(b.name || '')) : [];
    const today = new Date().toISOString().slice(0, 10);
    const wk = TESTLOG.weekKeyOf(today);   // once per render, never per row
    const rows = roster.map(u => {
      const started = devHasRecord(u.email);
      const dev = loadDev(u.email), home = loadHome(u.email);
      return { u, started, r: started ? TESTLOG.squadRow(dev, home, wk, { today, days: 90 }) : null, tier: dev.info.tier, isGK: dev.info.isGK, dev };
    });
    const live = rows.filter(x => x.started && x.r);
    const keeping = live.filter(x => x.r.compliance >= 0.6).length;      // same floor as the streak/mood thresholds
    const noRecord = rows.filter(x => !x.started).length;
    const selfReported = live.reduce((n, x) => n + x.r.metUnverified, 0);
    const awaiting = live.reduce((n, x) => n + x.r.pendingCount, 0);
    const sorters = {
      name: (a, b) => (a.u.name || '').localeCompare(b.u.name || ''),
      home: (a, b) => (a.r ? a.r.compliance : 2) - (b.r ? b.r.compliance : 2),
      tests: (a, b) => (a.r ? a.r.metVerified / (a.r.total || 1) : 2) - (b.r ? b.r.metVerified / (b.r.total || 1) : 2),
      tested: (a, b) => String((a.r && a.r.lastDate) || '9999').localeCompare(String((b.r && b.r.lastDate) || '9999')),
    };
    const sorted = rows.slice().sort(sorters[devTeamSort] || sorters.name);

    const cell = (x) => {
      if (!x.started) return `<td colspan="7" class="muted">${T('dev.noRecordYetNothing')}</td>`;
      const r = x.r;
      const pct = Math.round(r.compliance * 100);
      const testCls = (r.metVerified > 0 && r.metVerified === r.total) ? 'dev-team-ok' : (r.hasTests ? 'dev-team-gap' : '');
      const tr = r.training;
      return `<td><span class="tag">${escapeHtml(TESTLOG.TIERS[x.tier] || TESTLOG.TIERS[0])}</span></td>
        <td class="${testCls}">${r.hasTests ? `${r.metVerified}/${r.total}${r.metUnverified ? ` <span class="muted">+${r.metUnverified} ${T('dev.selfReportedWord')}</span>` : ''}` : '—'}</td>
        <td class="${tr.invited && tr.rate < 0.6 ? 'dev-team-gap' : ''}">${tr.invited ? `${Math.round(tr.rate * 100)}% <span class="muted">${T('dev.attendanceOf', { attended: tr.attended, invited: tr.invited })}</span>${tr.excused ? ` <span class="tag">${T('dev.attendanceExcused', { n: tr.excused })}</span>` : ''}` : '—'}</td>
        <td>${r.lastDate ? escapeHtml(r.lastDate) + (r.lastVerified ? '' : ' <span class="tag tag-self">self</span>') : '—'}</td>
        <td><div class="dev-bench-bar"><span style="width:${pct}%"></span></div> ${pct}% ${(typeof FX !== 'undefined') ? FX.mascot(22, r.mood) : ''}</td>
        <td>${r.streak > 0 ? '🔥 ' + r.streak : '—'}</td>
        <td>${r.hasSwim ? r.metres.toLocaleString() : '—'}</td>`;
    };

    root.innerHTML = `
      <div class="dev-hero">
        <div class="dev-hero-info">
          <div class="dev-hero-id"><h1>${T('dev.squadDevelopment')} <button class="help-chip" data-help="development" title="${T('dev.howThisWorks')}">？</button></h1></div>
          <div class="dev-hero-line">${T('dev.recordsAreDeviceLocal', { here: '<b>' + T('dev.hereWord') + '</b>' })}</div>
        </div>
      </div>

      <div class="dev-stats">
        <div class="dev-stat"><b>${roster.length}</b><span>${T('dev.playersOnTheRoster')}</span></div>
        <div class="dev-stat"><b>${keeping}/${live.length || 0}</b><span>${T('dev.keepingUpHomeTraining')}</span></div>
        <div class="dev-stat"><b>${noRecord}</b><span>${T('dev.noRecordYet')}</span></div>
        <div class="dev-stat"><b>${awaiting}</b><span>${T('dev.resultsAwaitingYourConfirmation')}</span></div>
      </div>

      <details class="dev-coach-tools" open><summary>${T('dev.coachTools')}${selfReported ? T('dev.nSelfReportedNotConfirmed', { n: selfReported }) : ''}</summary>
        <div class="dev-coach-row">
          <select id="dev-team-sort" class="focus-select">
            <option value="name" ${devTeamSort === 'name' ? 'selected' : ''}>${T('dev.sortName')}</option>
            <option value="home" ${devTeamSort === 'home' ? 'selected' : ''}>${T('dev.sortHomeTrainingLowest')}</option>
            <option value="tests" ${devTeamSort === 'tests' ? 'selected' : ''}>${T('dev.sortTestsAtTarget')}</option>
            <option value="tested" ${devTeamSort === 'tested' ? 'selected' : ''}>${T('dev.sortLastTestedOldest')}</option>
          </select>
          <button class="btn-ghost sm" id="dev-import-btn">${T('dev.importTeamLogbookXlsx')}</button><input type="file" id="dev-import-file" accept=".xlsx,.csv" hidden multiple>
        </div>
      </details>

      ${squadCharts(rows)}

      <div class="dev-card">
        <h3>${T('dev.everyPlayer')} <span class="rightbar-hint">${T('dev.thisWeek')}</span></h3>
        <div class="dev-table-wrap"><table class="dev-table dev-team-table">
          <thead><tr><th>${T('dev.player')}</th><th>${T('dev.tier')}</th><th>${T('dev.testsAtTarget2')}</th><th>${T('dev.thTraining')}<small>${T('dev.thLast90Days')}</small></th><th>${T('dev.lastTested')}</th><th>${T('dev.thHomeTraining')}<small>${T('dev.thSelfLogged')}</small></th><th>${T('dev.streak')}</th><th>${T('dev.thMetres')}<small>${T('dev.thSelfDeclared')}</small></th></tr></thead>
          <tbody>${sorted.map(x => `<tr class="dev-team-row" data-dev-open="${escapeHtml(x.u.email)}">
            <td><button class="btn-ghost sm">${escapeHtml(x.u.name || x.u.email)}</button>${x.u.position ? ` <span class="tag">${T('ui.pos')} ${escapeHtml(x.u.position)}</span>` : ''}${x.isGK ? ' <span class="tag">GK</span>' : ''}</td>
            ${cell(x)}</tr>`).join('') || `<tr><td colspan="8" class="muted">${T('dev.noApprovedPlayersOn')}</td></tr>`}</tbody>
        </table></div>
      </div>`;
    wireDevTeam(root);
  }
  function wireDevTeam(root) {
    root.querySelectorAll('[data-dev-open]').forEach(el => el.onclick = () => { devViewing = el.dataset.devOpen; devTeamMode = false; renderDevelopment(); });
    const ss = root.querySelector('#dev-team-sort');
    if (ss) ss.onchange = () => { devTeamSort = ss.value; renderDevTeam(root); };
    wireDevImport(root);
  }

  function devToggleModal(root, id, show) { const m = root.querySelector('#' + id); if (m) m.hidden = show == null ? !m.hidden : !show; }

  function wireDevelopment(root, email, dev, home, wk, canEditThis) {
    const trend = root.querySelector('#dev-trend-test');
    if (trend) trend.onchange = () => { devTrendTest = trend.value; renderDevelopment(); };
    const rs = root.querySelector('#dev-roster-select');
    if (rs) rs.onchange = () => { devViewing = rs.value || null; devTeamMode = false; renderDevelopment(); };
    const backTeam = root.querySelector('#dev-back-team');
    if (backTeam) backTeam.onclick = () => { devTeamMode = true; renderDevelopment(); };

    root.querySelectorAll('[data-open-modal]').forEach(b => b.onclick = () => devToggleModal(root, 'dev-' + b.dataset.openModal + '-modal', true));
    root.querySelectorAll('[data-close-modal]').forEach(b => b.onclick = () => devToggleModal(root, b.dataset.closeModal, false));
    const editBtn = root.querySelector('#dev-edit-profile'); if (editBtn) editBtn.onclick = () => devToggleModal(root, 'dev-profile-modal', true);

    // profile — one explicit Save, not silent auto-save on every keystroke
    if (canEditThis) {
      const save = root.querySelector('#dev-profile-save');
      if (save) save.onclick = () => {
        dev.info = Object.assign({}, dev.info, {
          name: root.querySelector('#dev-name').value, birthYear: root.querySelector('#dev-birth').value, band: root.querySelector('#dev-band').value,
          position: root.querySelector('#dev-position').value, isGK: root.querySelector('#dev-isgk').checked, tier: +root.querySelector('#dev-tier').value,
          talentCard: root.querySelector('#dev-card').value, cardValidUntil: root.querySelector('#dev-card-until').value, lastPiste: root.querySelector('#dev-piste').value,
          goalBlock: root.querySelector('#dev-goal-block').value, goalWords: root.querySelector('#dev-goal-words').value,
        });
        saveDev(email, dev); toast(T('ui.profileSaved')); renderDevelopment();
      };
    }
    // home training: log one occurrence of an activity this week
    root.querySelectorAll('[data-home-log]').forEach(b => b.onclick = () => {
      home.log.push({ id: 'h' + Math.random().toString(36).slice(2, 9), week: wk, activityId: b.dataset.homeLog, date: new Date().toISOString().slice(0, 10) });
      saveHome(email, home); toast(T('ui.loggedTheMascotNoticed')); renderDevelopment();
    });
    // add a test result
    const addTest = root.querySelector('#dev-test-add');
    if (addTest) addTest.onclick = () => {
      const id = root.querySelector('#dev-test-id').value, t = TESTLOG.testById(id, !!dev.info.isGK);
      const result = root.querySelector('#dev-test-result').value.trim(); if (!t || !result) { toast(T('ui.pickATestAnd')); return; }
      // authority comes from the role at WRITE time — never from a DOM value a player could set
      const official = devCanCoach(), today = new Date().toISOString().slice(0, 10);
      dev.tests = dev.tests || []; dev.tests.push({ id: 'd' + Math.random().toString(36).slice(2, 9), date: root.querySelector('#dev-test-date').value || today, name: dev.info.name || email, test: t.label, result, unit: t.unit, testedBy: root.querySelector('#dev-test-by').value, remark: root.querySelector('#dev-test-remark').value,
        status: official ? 'approved' : 'pending', verifiedBy: official ? state.user.name : '', verifiedAt: official ? today : '' });
      saveDev(email, dev); toast(T(official ? 'ui.testResultSaved' : 'ui.testLoggedPending')); renderDevelopment();
    };
    root.querySelectorAll('[data-test-del]').forEach(b => b.onclick = () => { dev.tests = (dev.tests || []).filter(t => t.id !== b.dataset.testDel); saveDev(email, dev); renderDevelopment(); });
    // a coach confirms or rejects a self-reported number
    function devSetTestStatus(id, status) {
      if (!devCanCoach()) return;
      const t = (dev.tests || []).find(x => x.id === id); if (!t) return;
      t.status = status; t.verifiedBy = state.user.name; t.verifiedAt = new Date().toISOString().slice(0, 10);
      saveDev(email, dev);
      DATA.logActivity(status === 'approved' ? 'approve' : 'deny', `${state.user.name} ${status === 'approved' ? 'confirmed' : 'rejected'} ${dev.info.name || email}'s ${t.test} result (${t.result})`, state.user.name);
      toast(T(status === 'approved' ? 'ui.resultConfirmed' : 'ui.resultRejected')); renderDevelopment();
    }
    root.querySelectorAll('[data-test-verify]').forEach(b => b.onclick = () => devSetTestStatus(b.dataset.testVerify, 'approved'));
    root.querySelectorAll('[data-test-deny]').forEach(b => b.onclick = () => devSetTestStatus(b.dataset.testDeny, 'denied'));
    // add a swim week
    const addSwim = root.querySelector('#dev-swim-add');
    if (addSwim) addSwim.onclick = () => {
      const week = root.querySelector('#dev-swim-week').value || TESTLOG.mondayOf(new Date());
      const club = +root.querySelector('#dev-swim-club').value || 0, self_ = +root.querySelector('#dev-swim-self').value || 0;
      dev.swimWeeks = dev.swimWeeks || []; dev.swimWeeks.push({ id: 's' + Math.random().toString(36).slice(2, 9), week, name: dev.info.name || email, metersClub: club, metersSelf: self_, total: club + self_, attended: +root.querySelector('#dev-swim-att').value || 0, possible: +root.querySelector('#dev-swim-poss').value || 0 });
      saveDev(email, dev); toast(T('ui.swimWeekSaved')); renderDevelopment();
    };
    root.querySelectorAll('[data-swim-del]').forEach(b => b.onclick = () => { dev.swimWeeks = (dev.swimWeeks || []).filter(r => r.id !== b.dataset.swimDel); saveDev(email, dev); renderDevelopment(); });
    // export
    const exT = root.querySelector('#dev-export-tests'); if (exT) exT.onclick = () => downloadBlob(TESTLOG.toCSV(dev.tests || [], TESTLOG.TEST_COLS), (dev.info.name || 'player').replace(/[^\w]+/g, '-') + '-test-log.csv', 'text/csv');
    const exS = root.querySelector('#dev-export-swim'); if (exS) exS.onclick = () => downloadBlob(TESTLOG.toCSV(dev.swimWeeks || [], TESTLOG.SWIM_COLS), (dev.info.name || 'player').replace(/[^\w]+/g, '-') + '-swim-weeks.csv', 'text/csv');
    wireDevImport(root);
    if (typeof TEAMS !== 'undefined') TEAMS.renderPlayerCard(root.querySelector('#dev-playercard'), { toast });
  }

  // team import (coach/trainer/admin only) — .xlsx or .csv, matched by player name against
  // the roster. Its own function so the squad view can offer it too, where it belongs.
  function wireDevImport(root) {
    const impBtn = root.querySelector('#dev-import-btn'), impFile = root.querySelector('#dev-import-file');
    if (impBtn) impBtn.onclick = () => impFile.click();
    if (impFile) impFile.onchange = async () => {
      const files = Array.from(impFile.files || []); impFile.value = ''; if (!files.length) return;
      const roster = DATA.loadUsers().filter(u => u.role === 'player');
      const byName = n => roster.find(u => (u.name || '').trim().toLowerCase() === String(n || '').trim().toLowerCase());
      let addedTests = 0, addedWeeks = 0, confirmedTests = 0, addedSessions = 0, unmatched = new Set(), bad = 0;
      for (const f of files) {
        try {
          let testSheetRows = [], swimSheetRows = [], spondRows = [];
          if (/\.xlsx$/i.test(f.name)) {
            const buf = new Uint8Array(await f.arrayBuffer());
            const { sheets } = await TESTLOG.readXLSX(buf);
            const testSheet = sheets['Testresultate'] || Object.values(sheets).find(rows => TESTLOG.rowsFromSheetTable(rows, TESTLOG.TEST_COLS).length);
            const swimSheet = sheets['Schwimm-Wochen'] || Object.values(sheets).find(rows => TESTLOG.rowsFromSheetTable(rows, TESTLOG.SWIM_COLS).length);
            if (testSheet) testSheetRows = TESTLOG.rowsFromSheetTable(testSheet, TESTLOG.TEST_COLS);
            if (swimSheet) swimSheetRows = TESTLOG.rowsFromSheetTable(swimSheet, TESTLOG.SWIM_COLS);
            // a Spond attendance export: one row per person per session. Recognised by the columns it
            // alone has (a person, a date AND an attendance word), never by the file's name.
            const asSpond = Object.values(sheets).map(rows => TESTLOG.rowsFromSheetTable(rows, TESTLOG.SPOND_COLS)).find(rs => rs.some(r => r.name && r.date && r.state));
            if (asSpond) spondRows = asSpond.filter(r => r.name && r.date && r.state);
          } else {
            const text = await f.text(); const rows = TESTLOG.parseCSV(text);
            const asTests = TESTLOG.rowsFromCSV(rows, TESTLOG.TEST_COLS), asSwim = TESTLOG.rowsFromCSV(rows, TESTLOG.SWIM_COLS);
            const asSpond = TESTLOG.rowsFromCSV(rows, TESTLOG.SPOND_COLS).filter(r => r.name && r.date && r.state);
            if (asTests.some(r => r.test && r.result)) testSheetRows = asTests;
            else if (asSwim.some(r => r.week)) swimSheetRows = asSwim;
            else if (asSpond.length) spondRows = asSpond;
          }
          testSheetRows.filter(r => r.test && r.result).forEach(r => {
            const u = byName(r.name); if (!u) { unmatched.add(r.name || '(blank)'); return; }
            const d = loadDev(u.email); d.tests = d.tests || [];
            const today = new Date().toISOString().slice(0, 10);
            // a bulk import is coach-entered by construction — the button only exists for a coach
            const status = TESTLOG.normalizeTestStatus(r.status), by = r.verifiedBy || state.user.name, at = r.verifiedAt || today;
            const dup = d.tests.find(x => x.date === r.date && x.test === r.test && String(x.result) === String(r.result));
            if (!dup) { d.tests.push({ id: 'd' + Math.random().toString(36).slice(2, 9), date: r.date, name: r.name, test: r.test, result: r.result, unit: r.unit, testedBy: r.testedBy, remark: r.remark, status, verifiedBy: by, verifiedAt: at }); saveDev(u.email, d); addedTests++; }
            else if (dup.status !== 'approved' && status === 'approved') {
              // the player self-logged it first; the coach's workbook is the authority — upgrade rather than skip
              dup.status = 'approved'; dup.verifiedBy = by; dup.verifiedAt = at; saveDev(u.email, d); confirmedTests++;
            }
          });
          swimSheetRows.filter(r => r.week).forEach(r => {
            const u = byName(r.name); if (!u) { unmatched.add(r.name || '(blank)'); return; }
            const d = loadDev(u.email); d.swimWeeks = d.swimWeeks || [];
            const dup = d.swimWeeks.some(x => x.week === r.week);
            if (!dup) { d.swimWeeks.push({ id: 's' + Math.random().toString(36).slice(2, 9), week: r.week, name: r.name, metersClub: +r.metersClub || 0, metersSelf: +r.metersSelf || 0, total: +r.total || ((+r.metersClub || 0) + (+r.metersSelf || 0)), attended: +r.attended || 0, possible: +r.possible || 0 }); saveDev(u.email, d); addedWeeks++; }
          });
          if (spondRows.length) {
            // training attendance from the club's Spond export: sessions per person, newest kept, no duplicates
            TESTLOG.attendanceFrom(spondRows).players.forEach(p => {
              const u = byName(p.name); if (!u) { unmatched.add(p.name || '(blank)'); return; }
              const d = loadDev(u.email); d.attendance = d.attendance || [];
              p.events.forEach(ev => {
                const i = d.attendance.findIndex(x => x.date === ev.date && x.event === ev.event);
                if (i >= 0) { if (d.attendance[i].state !== ev.state) { d.attendance[i] = ev; addedSessions++; } }
                else { d.attendance.push(ev); addedSessions++; }
              });
              d.attendance.sort((a, b) => a.date.localeCompare(b.date));
              saveDev(u.email, d);
            });
          }
        } catch (e) { bad++; }
      }
      toast(T('dev.importedSummary', { tests: addedTests, weeks: addedWeeks, sessions: addedSessions })
        + (confirmedTests ? ' · ' + T('dev.importedConfirmed', { n: confirmedTests }) : '')
        + (unmatched.size ? ' · ' + T('dev.importedUnmatched', { n: unmatched.size }) : '')
        + (bad ? ' · ' + T('dev.importedUnreadable', { n: bad }) : ''));
      renderDevelopment();
    };
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
        <span class="dc-k">${T('ui.knowledgeCheck')} <button class="help-chip" data-help="trivia" title="${T('ui.howTriviaWorks')}">？</button></span>
        <h1>${(typeof I18N!=='undefined')?I18N.t('trivia.title'):'Water Polo Trivia'}</h1>
        <p class="dash-sub">${T('ui.pickAQuizYour')}</p>
        <div class="trivia-sets">
          ${sets.map(st=>`
            <div class="trivia-set">
              <span class="ts-icon">${st.icon}</span>
              <div class="ts-main"><strong>${escapeHtml(st.label)}</strong>
                <span class="ts-sub">${T('ui.questionsBestScore', { n: st.questions.length, best: state.user[bestField(st.id)]||0 })}</span></div>
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
      <div class="trivia-prog">${trivia.set.icon} ${T('ui.triviaProgress', { set: escapeHtml(trivia.set.label), i: trivia.i+1, n: qs.length, score: trivia.score })}</div>
      <h2>${escapeHtml(item.q)}</h2>
      <div class="trivia-opts">${order.map(idx=>`<button class="trivia-opt" data-idx="${idx}">${escapeHtml(item.a[idx])}</button>`).join('')}</div>
      <div class="trivia-why" id="trivia-why" hidden></div>
      <button class="btn-primary" id="trivia-next" hidden>${trivia.i===qs.length-1?T('ui.seeResult'):'Next'}</button>
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
    why.innerHTML = `<strong>${correct?T('ui.correct'):T('ui.notQuite')}</strong> ${escapeHtml(item.why)}`;
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
      if (trivia.score===total) FX.celebrate(T('ui.perfect'), total+'/'+total+(trivia.set.id==='history'?' — Historian':' — Trivia Ace'));
      else if (trivia.score/total>=0.6) { FX.confetti(50); FX.sound('pop'); }
    }
    state.user = DATA.findUserByEmail(state.user.email);
    const c = $('trivia-card');
    const pct = Math.round(trivia.score/total*100);
    c.innerHTML = `<div class="trivia-result">
      <div class="trivia-score-ring">${trivia.score}<small>/${total}</small></div>
      <h2>${pct>=80?T('ui.triviaSharp'):pct>=50?T('ui.triviaGoodWork'):T('ui.triviaKeepStudying')}</h2>
      <p class="dash-sub">${T('ui.bestScoreSavedTo')}</p>
      <div class="status-actions"><button class="btn-primary" id="trivia-again">${T('ui.tryAgain')}</button>
      <button class="btn-ghost" data-go="dashboard">${T('ui.backToDashboard')}</button></div>
    </div>`;
    $('trivia-again').onclick = () => renderTrivia();
    c.querySelector('[data-go]').onclick = () => switchView('dashboard');
  }

  /* ======================================================
     SUPER ADMIN CONSOLE
     ====================================================== */
  /* ---- the club console, when accounts are real ----
     The same screen as the simulated one, fed by the server: the club's own requests (each with the
     number the person shows in person), its members, and the two ways in — a join link for players
     and a single-use invite for a coach. Anything that changes a role asks for the passkey again. */
  async function withStepUp(run) {
    try { return await run(); }
    catch (e) {
      if (e.status !== 403 || e.error !== 'step-up-required') throw e;
      await SESSION.stepUp();            // prove it is still you, then do exactly what was asked
      return run();
    }
  }
  async function renderClubAdmin() {
    const v = $('view-admin'), club = SESSION.activeClub(state.user && state.user.clubId);
    if (!club) { v.innerHTML = `<div class="admin-wrap"><p class="muted">${T('club.noClub')}</p></div>`; return; }
    const base = `/api/clubs/${club.id}`;
    let info = null, members = [], codes = [], invites = [];
    try {
      info = await SESSION.api(base);
      if (info.myRole === 'admin') {
        members = (await SESSION.api(base + '/members')).members;
        codes = (await SESSION.api(base + '/join-codes')).joinCodes;
        invites = (await SESSION.api(base + '/invites')).invites;
      }
    } catch (e) { v.innerHTML = `<div class="admin-wrap"><p class="muted">${escapeHtml(T(e.status === 401 ? 'auth.passkeyFailed' : 'club.cannotLoad'))}</p></div>`; return; }
    const pend = members.filter(m => m.status === 'pending'), approved = members.filter(m => m.status === 'approved');
    const roleOpts = cur => ['player', 'trainer', 'coach', 'admin'].map(r => `<option value="${r}"${r === cur ? ' selected' : ''}>${T(ROLE_WORD[r] || 'role.player')}</option>`).join('');
    v.innerHTML = `<div class="admin-wrap">
      <div class="admin-head"><h1>${escapeHtml(info.name)}</h1><p class="dash-sub">${T('club.yourRole', { role: T(ROLE_WORD[info.myRole] || 'role.player') })}${info.adminCount === 1 ? ' · ' + T('club.onlyAdmin') : ''}</p></div>
      ${info.myRole !== 'admin' ? `<p class="muted">${T('club.staffOnly')}</p>` : `
      ${(info.alerts || []).length ? `<section class="admin-sec"><h3>${T('club.alerts')}</h3>${info.alerts.map(a => `<div class="admin-row"><span class="ar-main">${T('club.suspectPasskey', { name: escapeHtml(a.name) })}</span></div>`).join('')}</section>` : ''}
      <section class="admin-sec">
        <h3>${T('club.requests')} ${pend.length ? `<span class="pill-count">${pend.length}</span>` : ''}</h3>
        <div class="admin-list" id="club-requests">
          ${pend.length ? pend.map(m => `<div class="admin-row" data-member="${escapeHtml(m.memberRef)}">
            <span class="ar-av">${escapeHtml((m.name || '?').charAt(0))}</span>
            <span class="ar-main"><span class="ar-name">${escapeHtml(m.name)}${m.sameName ? ` <span class="tag">${T('club.sameName')}</span>` : ''}${m.mixedScript ? ` <span class="tag">${T('club.oddLetters')}</span>` : ''}</span>
              <span class="ar-sub">${T('club.asksToJoinAs', { role: T(ROLE_WORD[m.role] || 'role.player') })}${m.via && m.via.label ? ' · ' + escapeHtml(m.via.label) : ''}${m.previously ? ' · ' + T('club.previously' + (m.previously.status === 'removed' ? 'Removed' : 'Denied')) : ''}</span></span>
            <span class="ar-actions">
              <label class="ar-code">${T('club.requestNo')} <input type="text" inputmode="numeric" maxlength="4" size="4" data-no="${escapeHtml(m.memberRef)}"></label>
              <button class="btn-primary sm" data-approve-member="${escapeHtml(m.memberRef)}">${T('ui.approve')}</button>
              <button class="btn-ghost sm danger" data-deny-member="${escapeHtml(m.memberRef)}">${T('ui.deny')}</button>
            </span></div>`).join('') : `<div class="muted">${T('club.noRequests')}</div>`}
        </div>
        <p class="fa-note">${T('club.requestNoNote')}</p>
      </section>
      <section class="admin-sec">
        <h3>${T('club.members')} <span class="pill-count">${approved.length}</span></h3>
        <div class="admin-list">${approved.map(m => `<div class="admin-row">
          <span class="ar-av">${escapeHtml((m.name || '?').charAt(0))}</span>
          <span class="ar-main"><span class="ar-name">${escapeHtml(m.name)}</span></span>
          <span class="ar-actions">
            <select data-role-member="${escapeHtml(m.memberRef)}">${roleOpts(m.role)}</select>
            <button class="btn-ghost sm danger" data-remove-member="${escapeHtml(m.memberRef)}">${T('club.remove')}</button>
          </span></div>`).join('')}</div>
      </section>
      <section class="admin-sec">
        <h3>${T('club.waysIn')}</h3>
        <div class="admin-list">
          ${codes.map(c => `<div class="admin-row"><span class="ar-main"><span class="ar-name">${escapeHtml(c.label || T('club.joinLink'))}</span>
            <span class="ar-sub">${T('club.joinLinkStats', { uses: c.uses, pending: c.pendingCount })}${c.active ? '' : ' · ' + T('club.revoked')}</span></span>
            ${c.active ? `<span class="ar-actions"><button class="btn-ghost sm danger" data-revoke-code="${escapeHtml(c.ref)}">${T('club.revoke')}</button></span>` : ''}</div>`).join('')}
          ${invites.map(i => `<div class="admin-row"><span class="ar-main"><span class="ar-name">${escapeHtml(i.label || T(ROLE_WORD[i.role] || 'role.coach'))}</span>
            <span class="ar-sub">${i.status === 'pending' ? T('club.inviteUsedBy', { name: escapeHtml(i.usedBy.name) }) : T('club.inviteUnused', { role: T(ROLE_WORD[i.role] || 'role.coach') })}</span></span>
            ${i.status === 'unused' ? `<span class="ar-actions"><button class="btn-ghost sm danger" data-revoke-invite="${escapeHtml(i.ref)}">${T('club.revoke')}</button></span>` : ''}</div>`).join('')}
        </div>
        <div class="admin-actions">
          <button class="btn-primary sm" id="club-new-join">${T('club.newJoinLink')}</button>
          <select id="club-invite-role">${['coach', 'trainer', 'admin'].map(r => `<option value="${r}">${T(ROLE_WORD[r])}</option>`).join('')}</select>
          <button class="btn-ghost sm" id="club-new-invite">${T('club.newInvite')}</button>
        </div>
        <div id="club-new-code" hidden></div>
      </section>`}
    </div>`;
    wireClubAdmin(v, base);
  }
  function wireClubAdmin(v, base) {
    const again = async (fn) => { try { await fn(); await renderClubAdmin(); } catch (e) { toast(clubError(e)); } };
    const numFor = ref => ((v.querySelector(`[data-no="${ref}"]`) || {}).value || '').trim();
    v.querySelectorAll('[data-approve-member]').forEach(b => b.onclick = () => again(() => withStepUp(() =>
      SESSION.api(`${base}/members/${b.dataset.approveMember}/approve`, { method: 'POST', body: { requestNo: numFor(b.dataset.approveMember) } }))));
    v.querySelectorAll('[data-deny-member]').forEach(b => b.onclick = () => again(() =>
      SESSION.api(`${base}/members/${b.dataset.denyMember}/deny`, { method: 'POST', body: { requestNo: numFor(b.dataset.denyMember) } })));
    v.querySelectorAll('[data-role-member]').forEach(s => s.onchange = () => again(() => withStepUp(() =>
      SESSION.api(`${base}/members/${s.dataset.roleMember}/role`, { method: 'POST', body: { role: s.value } }))));
    v.querySelectorAll('[data-remove-member]').forEach(b => b.onclick = () => { if (!confirm(T('club.confirmRemove'))) return; again(() => withStepUp(() =>
      SESSION.api(`${base}/members/${b.dataset.removeMember}/remove`, { method: 'POST', body: {} }))); });
    v.querySelectorAll('[data-revoke-code]').forEach(b => b.onclick = () => again(() =>
      SESSION.api(`${base}/join-codes/${b.dataset.revokeCode}/revoke`, { method: 'POST', body: {} })));
    v.querySelectorAll('[data-revoke-invite]').forEach(b => b.onclick = () => again(() =>
      SESSION.api(`${base}/invites/${b.dataset.revokeInvite}/revoke`, { method: 'POST', body: {} })));
    const show = (code, what) => { const box = v.querySelector('#club-new-code'); if (!box) return; box.hidden = false;
      box.innerHTML = `<div class="invite-card"><div class="invite-left"><span class="dc-k">${escapeHtml(what)}</span><div class="invite-code">${escapeHtml(code)}</div>
        <p class="dc-note">${T('club.codeShownOnce')}</p></div><div class="invite-qr">${typeof QR !== 'undefined' ? QR.toSVG(location.origin + location.pathname + '#join=' + code.replace(/-/g, ''), { size: 148, quiet: 2 }) : ''}</div></div>`; };
    const nj = v.querySelector('#club-new-join');
    if (nj) nj.onclick = async () => { try { const r = await withStepUp(() => SESSION.api(`${base}/join-codes`, { method: 'POST', body: { label: T('club.joinLink') } })); await renderClubAdmin(); show(r.code, T('club.newJoinLink')); } catch (e) { toast(clubError(e)); } };
    const ni = v.querySelector('#club-new-invite');
    if (ni) ni.onclick = async () => { const role = (v.querySelector('#club-invite-role') || {}).value || 'coach';
      try { const r = await withStepUp(() => SESSION.api(`${base}/invites`, { method: 'POST', body: { role } })); await renderClubAdmin(); show(r.code, T(ROLE_WORD[role] || 'role.coach')); } catch (e) { toast(clubError(e)); } };
  }
  const clubError = e => T(e && e.error === 'request-changed' ? 'club.requestChanged'
    : e && e.error === 'last-admin' ? 'club.lastAdmin'
    : e && e.error === 'needs-verified-passkey' ? 'club.needsVerifiedPasskey'
    : e && e.status === 426 ? 'auth.updateApp' : 'club.cannotLoad');

  function renderAdmin() {
    if (realAccounts) { renderClubAdmin(); return; }
    const v = $('view-admin');
    const users = DATA.loadUsers();
    const pend = users.filter(u=>u.status==='pending');
    const acts = DATA.loadActivity();
    const roleOpts = (cur) => DATA.ROLES.map(r=>`<option value="${r}"${r===cur?' selected':''}>${DATA.roleLabel(r)}</option>`).join('');

    v.innerHTML = `<div class="admin-wrap">
      <div class="admin-head"><h1>${T('ui.superAdmin')} <button class="help-chip" data-help="admin" title="${T('ui.howTheConsoleWorks')}">？</button></h1><p class="dash-sub">${T('ui.approveLoginsManageRoles')}</p></div>

      <section class="admin-sec">
        <h3>${T('ui.approvalQueue')} ${pend.length?`<span class="pill-count">${pend.length}</span>`:''}</h3>
        <div class="admin-list" id="approve-list">
          ${pend.length ? pend.map(u=>`
            <div class="admin-row" data-id="${u.id}">
              <span class="ar-av">${escapeHtml(u.name.charAt(0))}</span>
              <span class="ar-main"><span class="ar-name">${escapeHtml(u.name)}</span><span class="ar-sub">${T('ui.emailWantsRole', { email: escapeHtml(u.email), role: DATA.roleLabel(u.role) })}${u.position?` (${T('ui.posLower')} ${u.position})`:''} · ${u.provider}</span></span>
              <span class="ar-actions">
                <button class="btn-primary sm" data-approve="${u.id}">${T('ui.approve')}</button>
                <button class="btn-ghost sm danger" data-deny="${u.id}">${T('ui.deny')}</button>
              </span>
            </div>`).join('') : `<div class="muted">${T('ui.noPendingRequests')}</div>`}
        </div>
      </section>

      <section class="admin-sec">
        <h3>${T('ui.people')}</h3>
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
        <h3>${T('ui.activityFeed')}</h3>
        <div class="dash-list">${acts.slice(0,30).map(activityRow).join('')||`<div class="muted">${T('ui.nothingYet')}</div>`}</div>
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
    $('library-sub').textContent = s.note + ' · ' + (state.phase==='offense'?T('phase.offense'):T('phase.defense'));
    const list = $('scenario-list'); list.innerHTML='';
    const items = currentList();
    if (items.length===0) list.innerHTML = `<div class="empty-lib">${T('ui.noPhasePlaysHereYet', { phase: T('phase.' + state.phase) })}${canEdit()?`<br><span>${T('ui.pressNewToBuildOne')}</span>`:''}</div>`;
    items.forEach(scn => {
      const card = document.createElement('button');
      card.className='scn-card' + (scn.id===state.selectedId?' active':'') + (selecting?' selectable':'') + (selecting && selected.has(scn.id)?' picked':'');
      card.innerHTML = `${selecting?`<span class="scn-check">${selected.has(scn.id)?'☑':'☐'}</span>`:''}
        <div class="scn-card-top">
          <span class="scn-title">${escapeHtml(scn.title||T('ui.untitledPlay'))}</span>
          ${scn.builtIn?`<span class="tag tag-sample">${T('ui.tagSample')}</span>`:`<span class="tag tag-yours">${T('ui.tagSaved')}</span>`}${scn.template?`<span class="tag tag-tpl">${T('ui.tagTemplate')}</span>`:''}${(typeof PRIVACY!=='undefined' && !scn.builtIn && PRIVACY.levelOf(scn)!=='team')?`<span class="tag vis-${PRIVACY.levelOf(scn)}">${PRIVACY.levelOf(scn)==='private'?'🔒':'🌐'}</span>`:''}
        </div>
        <div class="scn-desc">${escapeHtml(scn.description||'')}</div>
        <div class="scn-meta"><span>${scn.frames.length > 1 ? T('ui.nSteps', { n: scn.frames.length }) : T('ui.nStep', { n: scn.frames.length })}</span><span>${escapeHtml(scn.author||'')}</span></div>`;
      card.onclick = () => selecting ? togglePick(scn.id) : openScenario(scn.id);
      list.appendChild(card);
    });
    updateSelectBar();
    if (canEdit() && !selecting) {
      const plus = document.createElement('button');
      plus.className = 'scn-card scn-new';
      plus.innerHTML = `<span class="scn-new-plus">＋</span> ${T('ui.createANewPlay')}`;
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
    $('scenario-title').textContent = T('lib.select');
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
  const ZONE_FILL = { get green() { return C('--zone-green'); }, get yellow() { return C('--zone-yellow'); } };
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
      fill: C('--zone-label'), opacity: 0.85, 'font-family': 'Helvetica, Arial, sans-serif' });
    leg.textContent = T('ui.shotLegend');
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
    ctx.fillStyle = C('--scene3d-air'); ctx.fillRect(0, 0, cv.width, cv.height);   // above the water — deck / air
    const pool = MANIKIN.worldPool();
    const corners = [{ x: -pool.halfLen, y: 0, z: -pool.halfWid }, { x: pool.halfLen, y: 0, z: -pool.halfWid }, { x: pool.halfLen, y: 0, z: pool.halfWid }, { x: -pool.halfLen, y: 0, z: pool.halfWid }].map(proj3);
    // the water itself — a filled, gently gradient surface, not a dry floor
    if (!corners.some(p => !p)) {
      const g = ctx.createLinearGradient(0, Math.min(...corners.map(p => p.y)), 0, Math.max(...corners.map(p => p.y)));
      g.addColorStop(0, C('--scene3d-water-top')); g.addColorStop(1, C('--scene3d-water-bottom'));
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(corners[0].x, corners[0].y); corners.slice(1).forEach(p => ctx.lineTo(p.x, p.y)); ctx.closePath(); ctx.fill();
    }
    // lane markings on the water surface (not a court grid)
    ctx.strokeStyle = C('--scene3d-ripple'); ctx.lineWidth = Math.max(1, cv.height / 480);
    for (let x = -Math.floor(pool.halfLen); x <= pool.halfLen; x += 5) { const a = proj3({ x, y: 0, z: -pool.halfWid }), b = proj3({ x, y: 0, z: pool.halfWid }); if (a && b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); } }
    // the same shot-chance zones as the 2D board, only when Zones is on
    if (zonesShown()) MANIKIN.zoneFloorQuads().forEach(q => {
      const c = [{ x: q.x0, y: 0, z: q.z0 }, { x: q.x1, y: 0, z: q.z0 }, { x: q.x1, y: 0, z: q.z1 }, { x: q.x0, y: 0, z: q.z1 }].map(proj3);
      if (c.some(p => !p)) return;
      ctx.fillStyle = q.color + '40'; ctx.beginPath(); ctx.moveTo(c[0].x, c[0].y); c.slice(1).forEach(p => ctx.lineTo(p.x, p.y)); ctx.closePath(); ctx.fill();
    });
    // goals (both ends, for context and depth)
    ctx.strokeStyle = C('--scene3d-line'); ctx.lineWidth = Math.max(1.4, cv.height / 260);
    MANIKIN.goalPosts().forEach(g => g.segs.forEach(seg => { const a = proj3(seg[0]), b = proj3(seg[1]); if (a && b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); } }));
    // a small ripple under each player — everyone is at the surface, nothing stands on a floor
    scene.mannequins.forEach(m => { const rp = proj3({ x: m.pos.x, y: 0, z: m.pos.z }); if (!rp) return;
      ctx.strokeStyle = C('--scene3d-lane'); ctx.lineWidth = 1;
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
      const skinLine = C('--scene3d-skin-line');
      const skinGrad = (x0, y0, x1, y1) => { const g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, C('--scene3d-skin-light')); g.addColorStop(1, C('--scene3d-skin-dark')); return g; };
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
      ctx.strokeStyle = C('--scene3d-arm'); ctx.lineWidth = Math.max(2.2, px * 0.075); ctx.lineCap = 'round';
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
        if (m.key !== 'GK') { ctx.fillStyle = m.team === 'D' ? C('--cap3d-dark-ink') : C('--cap3d-light-ink'); /* by team, never by comparing a colour a look can change */ const fs = Math.max(7, pts.head.scale * 0.19); ctx.font = '700 ' + fs + 'px Helvetica, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(m.key.replace(/^[AD]/, ''), pts.head.x, pts.head.y + fs * 0.32); }
      }
    });
    // the ball
    if (scene.ball) { const bp = proj3(scene.ball); if (bp) { ctx.fillStyle = C('--ball'); ctx.beginPath(); ctx.arc(bp.x, bp.y, Math.max(2, bp.scale * 0.10), 0, TAU_LOCAL); ctx.fill(); } }
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
    add('rect', { x: X0, y: Y0, width: W, height: H, rx: 1.5, fill: C('--gkv-goal'), stroke: C('--gkv-frame'), 'stroke-width': 1.6 });
    for (let i = 1; i < 6; i++) add('line', { x1: X0 + W * i / 6, y1: Y0, x2: X0 + W * i / 6, y2: Y1, stroke: C('--gkv-frame'), 'stroke-width': 0.3, opacity: 0.25 });
    if (view.bestGap && view.bestGap.size > 0.06)
      add('rect', { x: X0 + view.bestGap.a * W, y: Y0, width: (view.bestGap.b - view.bestGap.a) * W, height: H,
        fill: C('--gkv-gap'), 'fill-opacity': 0.28, stroke: C('--gkv-gap'), 'stroke-width': 1, 'stroke-dasharray': '3 2' });
    (view.blockers || []).forEach(b => add('rect', { x: X0 + b.a * W, y: Y0 + H * 0.28, width: Math.max(1.5, (b.b - b.a) * W), height: H * 0.72,
      fill: C('--gkv-blocker'), 'fill-opacity': 0.9, stroke: C('--gkv-blocker-edge'), 'stroke-width': 0.8 }));
    if (view.keeper) {
      // the keeper reaches roughly two-thirds of the 0.9 m cage height — never floor to crossbar
      const kx = X0 + view.keeper.a * W, kw = Math.max(3, (view.keeper.b - view.keeper.a) * W);
      add('rect', { x: kx, y: Y0 + H * 0.34, width: kw, height: H * 0.66, rx: 2, fill: C('--gkv-keeper'), 'fill-opacity': 0.85, stroke: C('--gkv-keeper-edge'), 'stroke-width': 0.8 });
    }
    add('line', { x1: X0, y1: Y1, x2: X1, y2: Y1, stroke: C('--gkv-waterline'), 'stroke-width': 2 });      // water line
    const t = add('text', { x: X0 + W / 2, y: 46, 'text-anchor': 'middle', 'font-size': 5.4, fill: C('--gkv-text'), 'font-family': 'Helvetica, Arial, sans-serif' });
    t.textContent = view.keeperMissing
      ? T('ui.gkNoKeeperInStep')
      : T('ui.gkCoverage', { pct: Math.round(view.coverPct * 10) * 10 });
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
    if (marked) $('gkv-badge').textContent = marked.kind === 'lob' ? T('ui.badgeLob') : T('ui.badgeShot');
    $('gkv-nums').innerHTML =
      `<span class="gkv-n gkv-shoot"><b>${pct(c.shootPct)}</b> ${T('ui.shoot')}</span>` +
      `<span class="gkv-n gkv-lob"><b>${pct(c.lobPct)}</b> ${T('ui.lob')}</span>` +
      `<span class="gkv-n">${c.blockerCount} ${T('ui.inTheLane')}</span>` +
      (c.keeperOutM == null ? `<span class="gkv-n">${T('ui.noKeeper')}</span>` : `<span class="gkv-n">${T('ui.keeperOutM', { m: c.keeperOutM })}</span>`) +
      `<span class="gkv-n">${c.distanceM} m · ${c.angleDeg}°</span>` +
      `<span class="gkv-n gkv-zone gkv-${c.zone}">${c.zone}</span>`;
    $('gkv-advice').textContent = c.advice;
    const menuData = SHOT.shotOptions(f, { shooter: marked ? marked.by : null, manUp: scn.situation === '6v5' || scn.situation === '5v4' });
    const TIER = { best: T('ui.tierBest'), good: T('ui.tierGood'), risky: T('ui.tierRisky') };
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
    if (adjust.dirty) { toast(T('ui.saveOrCancelYour')); return; }
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
    $('frame-label').textContent = T('ui.stepNofM', { n: Math.min(total, step+1), total });
    const fl = $('fsb-label'); if (fl) fl.textContent = T('ui.stepNofM', { n: Math.min(total, step+1), total });
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
    $('mc-who').textContent = T('ui.cueWhoStep', { who: pos === state.user.position ? T('ui.cueYou') : T('role.player'), pos, n: Math.min(tot, st + 1), total: tot });
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
    toast(T('ui.controlsBackAtThe'));
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
      note.textContent = T('ui.thinkItThrough');
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
    if (typeof SOLVER==='undefined') { c.innerHTML = `<div class="muted">${T('ui.solutionsUnavailable')}</div>`; return; }
    c.innerHTML = `<div class="sol-wrap">
      <div class="dash-head with-mascot">${(typeof FX!=='undefined')?FX.mascot(38):''}
        <div><h1>${T('ui.solutionsLab')} <button class="help-chip" data-help="solutions" title="${T('ui.howSolutionsWork')}">？</button></h1>
        <p class="dash-sub">${T('ui.askASituationIn')}</p></div></div>
      <div class="sol-ask">
        <input type="text" id="sol-search" placeholder="${T('ui.eGISwim')}" />
        <button class="btn-primary sm" id="sol-go">${T('ui.solve')}</button>
      </div>
      <div class="sol-ex">${T('ui.tryColon')}
        ${['Alone on the keeper who comes out','2-on-1 fast break','They double-team our hole','How do I draw a kick-out','Defend the counter-attack']
          .map(x=>`<button class="sol-chip" data-sol-ex="${escapeHtml(x)}">${escapeHtml(x)}</button>`).join('')}
      </div>
      <div class="sol-body">
        <div class="sol-results" id="sol-results"></div>
        <div class="sol-detail" id="sol-detail"><div class="sol-empty">${T('ui.pickAQuestionOn')}</div></div>
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
      wrap.innerHTML = `<div class="sol-none">${T('ui.noExactMatchHere')}</div>`;
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
          <svg id="sol-pool" viewBox="0 0 320 262" preserveAspectRatio="xMidYMid meet" aria-label="${T('ui.solutionBoard')}"></svg>
          <div class="sol-board-btns">
            <button class="btn-ghost sm" id="sol-replay">${T('ui.replay')}</button>
            <button class="btn-primary sm" id="sol-save">${T('ui.saveAsAPlay')}</button>
          </div>
        </div>
        <div class="sol-text">
          <h3>${T('ui.whatToDo')}</h3>
          <ul class="sol-steps">${p.answer.map(a=>`<li>${escapeHtml(a)}</li>`).join('')}</ul>
          <h3>${T('ui.theRules')}</h3>
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
    if (!canEdit()) { toast(T('ui.coachesTrainersCanSave')); return; }
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
    toast(T('ui.savedToYourPlaybook'));
  }

  /* ======================================================
     SEASON — goal → periodised training plan + a calendar that
     exports/subscribes to iOS / Android / Windows via iCalendar.
     ====================================================== */
  const season = { plan: null };
  const FOCUS_LIST = () => [['endurance',T('ui.focusEndurance')],['strength',T('ui.focusStrength')],['power',T('ui.focusPower')],['shooting',T('ui.focusShooting')],['skills',T('ui.focusSkills')],['tactics',T('ui.focusTactics')]];
  function d2(n){ return String(n).padStart(2,'0'); }
  function isoDay(d){ return `${d.getFullYear()}-${d2(d.getMonth()+1)}-${d2(d.getDate())}`; }
  function fmtDay(iso){ const d=new Date(iso); return d.toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short'}); }
  function fmtTime(iso){ const d=new Date(iso); return d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}); }

  function renderSeason() {
    const c = $('view-season');
    if (typeof PLANNER==='undefined' || typeof CALENDAR==='undefined') { c.innerHTML='<div class="muted">'+T('ui.seasonToolsUnavailable')+'</div>'; return; }
    const today = new Date(); const target = new Date(today.getTime()+70*86400000);
    const myTests = (typeof TESTLOG!=='undefined' && state.user) ? (loadDev(state.user.email).tests || []).length : 0;
    c.innerHTML = `<div class="season-wrap">
      <div class="dash-head with-mascot">${(typeof FX!=='undefined')?FX.mascot(38):''}
        <div><h1>${T('ui.season')} <button class="help-chip" data-help="season" title="${T('ui.howSeasonWorks')}">？</button></h1>
        <p class="dash-sub">${T('ui.setAGoalGet')}</p></div></div>

      <div id="wpm-section"></div>

      <div class="season-cols">
        <section class="season-card">
          <h2>${T('ui.goalTrainingPlan')}</h2>
          <div class="goal-form">
            <label>${T('ui.goal')} <input type="text" id="goal-title" placeholder="${T('ui.eGPeakFor')}" value="Peak for the play-offs"></label>
            <div class="goal-row">
              <label>${T('ui.start')} <input type="date" id="goal-start" value="${isoDay(today)}"></label>
              <label>${T('ui.peakBy')} <input type="date" id="goal-target" value="${isoDay(target)}"></label>
              <label>${T('ui.daysWeek')}
                <select id="goal-days">${[2,3,4,5,6].map(n=>`<option ${n===4?'selected':''}>${n}</option>`).join('')}</select>
              </label>
            </div>
            <div class="goal-focus"><span class="ef-label">${T('ui.focus')}</span>
              ${FOCUS_LIST().map(([k,l])=>`<label class="chip-check"><input type="checkbox" value="${k}" ${['shooting','tactics'].includes(k)?'checked':''}> ${l}</label>`).join('')}
              <label class="chip-check" title="${T('ui.leanThePlanToward')}"><input type="checkbox" id="goal-usetests" ${myTests ? 'checked' : 'disabled'}> ${T('ui.useMyTestResults', { n: myTests })}</label>
            </div>
            <button class="btn-primary sm" id="goal-generate">${T('ui.generatePlan')}</button>
          </div>
          <div id="plan-out"></div>
        </section>

        <section class="season-card">
          <h2>${T('ui.calendar')}</h2>
          <div class="cal-add">
            <div class="goal-row">
              <select id="ev-type">${Object.keys(CALENDAR.TYPES).map(t=>`<option value="${t}">${CALENDAR.TYPES[t]}</option>`).join('')}</select>
              <input type="text" id="ev-title" placeholder="${T('ui.titleEGVs')}">
            </div>
            <div class="goal-row">
              <input type="date" id="ev-date" value="${isoDay(today)}">
              <input type="time" id="ev-time" value="18:00">
              <input type="text" id="ev-loc" placeholder="${T('ui.location')}">
            </div>
            <button class="btn-ghost sm" id="ev-add">${T('ui.addToCalendar')}</button>
          </div>
          <div class="cal-actions">
            <button class="btn-ghost sm" id="cal-export">${T('ui.exportIcs')}</button>
            <button class="btn-ghost sm" id="cal-subscribe">${T('ui.subscribeAllDevices')}</button>
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
    renderWpMatch();
    if (season.plan) renderPlan();
    renderAgenda();
  }
  /* ======================================================
     MATCHES & RESULTS — the club's real fixtures, results, box scores and
     league table from wpmatch.ch (Swiss Aquatics' own match centre).
     It lives in Season because Season already owns the schedule: the
     calendar, the .ics export and the subscribe feed are one card away.
     Everything is cached, so a wpmatch outage degrades to stale-but-
     stamped data rather than a blank screen.
     ====================================================== */
  const WPM_TTL = 6 * 3600 * 1000;        // fixtures/tables: the source rebuilds daily
  const WPM_BOX_TTL = 30 * 24 * 3600 * 1000;   // a played match's box score never changes
  const wpm = { busy: false, openBox: null, error: '' };

  const wpmAgo = at => { const m = Math.round((Date.now() - at) / 60000); return m < 60 ? T('ui.minAgo', { n: m }) : (m < 1440 ? T('ui.hAgo', { n: Math.round(m / 60) }) : T('ui.dAgo', { n: Math.round(m / 1440) })); };

  function renderWpMatch() {
    const host = $('wpm-section'); if (!host || typeof WPMATCH === 'undefined') return;
    const team = WPMATCH.loadTeam();
    if (!team) {
      host.innerHTML = `<section class="season-card wpm-card">
        <h2>${T('ui.matchesAndResults')} <span class="rightbar-hint">${T('ui.fromWpmatchCh')}</span></h2>
        <p class="fa-note">${T('ui.pickYourClubS')}</p>
        <div class="wpm-pick"><input type="text" id="wpm-search" placeholder="${T('ui.searchYourTeamE')}" value=""><button class="btn-primary sm" id="wpm-search-go">${T('ui.search')}</button></div>
        <div id="wpm-results"></div>
        <p class="fa-note">${T('ui.dataSwissAquaticsMatch')} <a href="${WPMATCH.SITE}" target="_blank" rel="noopener">wpmatch.ch</a></p>
      </section>`;
      wireWpMatch(); return;
    }
    const fxBox = WPMATCH.cacheGet('fx.' + team.id, WPM_TTL);
    const tblBox = WPMATCH.cacheGet('tbl.' + team.id, WPM_TTL);
    const fixtures = (fxBox && fxBox.data) || [];
    const now = Date.now();
    const upcoming = fixtures.filter(f => f.status !== 'ended').sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)));
    const played = fixtures.filter(f => f.status === 'ended' && f.homeScore != null).sort((a, b) => String(b.startsAt).localeCompare(String(a.startsAt)));
    const table = tblBox && tblBox.data;

    const row = (f) => {
      const r = WPMATCH.resultFor(f, team.id);
      const side = WPMATCH.opponentOf(f, team.id);
      const when = f.dateTBC ? T('ui.dateTbc') : (f.localTime ? fmtDay(f.startsAt) + ' · ' + f.localTime.slice(11, 16) : fmtDay(f.startsAt));
      const opp = side ? side.opponent.name : (f.home.name && f.away.name ? f.home.name + ' – ' + f.away.name : f.title);
      const score = r ? `<b class="wpm-${r.outcome}">${r.ours}–${r.theirs}</b>` : '';
      return `<div class="wpm-row${f.dateTBC ? ' wpm-tbc' : ''}">
        <span class="wpm-when">${escapeHtml(when)}</span>
        <span class="wpm-opp">${side ? (side.us === 'home' ? T('ui.vsPrefix') : T('ui.atPrefix')) : ''}${escapeHtml(opp || f.title)}${f.venueName ? ` <span class="muted">${escapeHtml(f.venueName)}</span>` : ''}</span>
        <span class="wpm-score">${score}</span>
        <span class="wpm-acts">${f.homeScore != null ? `<button class="btn-ghost xs" data-wpm-box="${escapeHtml(f.gameId)}">${T('ui.statsBtn')}</button>` : ''}<a class="btn-ghost xs" href="${escapeHtml(WPMATCH.matchUrl(f))}" target="_blank" rel="noopener">↗</a></span>
      </div>`;
    };

    host.innerHTML = `<section class="season-card wpm-card">
      <h2>${T('ui.matchesAndResults')} <span class="rightbar-hint">${escapeHtml(team.name)}</span></h2>
      <div class="wpm-head">
        <a class="btn-ghost xs" href="${escapeHtml(WPMATCH.teamUrl(team))}" target="_blank" rel="noopener">${T('ui.teamPage')}</a>
        <button class="btn-ghost xs" id="wpm-refresh">${wpm.busy ? T('ui.refreshing') : T('ui.refreshBtn')}</button>
        <button class="btn-ghost xs" id="wpm-change">${T('ui.changeTeam')}</button>
        ${fixtures.length ? `<button class="btn-primary xs" id="wpm-tocal">${T('ui.addNToCalendar', { n: upcoming.filter(f => !f.dateTBC).length || played.length })}</button>` : ''}
        <span class="muted">${fxBox ? T('ui.updatedAgo', { ago: wpmAgo(fxBox.at) }) + (fxBox.stale ? T('ui.refreshingSuffix') : '') : T('ui.notLoadedYet')}</span>
      </div>
      ${wpm.error ? `<p class="fa-note">${escapeHtml(wpm.error)}</p>` : ''}
      ${!fixtures.length && !wpm.busy ? `<p class="fa-note">${T('ui.noFixturesYet')}</p>` : ''}

      ${fixtures.length ? `<div class="wpm-group"><div class="ef-label">${T('ui.upcomingN', { n: upcoming.length })}</div>
        ${upcoming.length ? upcoming.slice(0, 8).map(row).join('') : `<div class="muted">${T('ui.nothingScheduledYet')}</div>`}</div>

      <div class="wpm-group"><div class="ef-label">${T('ui.recentResultsN', { n: played.length })}</div>
        ${played.slice(0, 8).map(row).join('') || `<div class="muted">${T('ui.noPlayedMatchesFound')}</div>`}</div>` : ''}

      <div id="wpm-box"></div>

      ${table ? `<details class="wpm-table-wrap"><summary>${escapeHtml(table.name)}</summary>
        <div class="dev-table-wrap"><table class="dev-table"><thead><tr><th>#</th><th>${T('ui.team')}</th>${['t', 'w', 'd', 'l', 'pts'].map(k => `<th>${escapeHtml(table.labels[k] || k.toUpperCase())}</th>`).join('')}</tr></thead>
          <tbody>${table.rows.map((r, i) => `<tr${r.teamId === team.id ? ' class="wpm-us"' : ''}><td>${i + 1}</td><td>${escapeHtml(r.name || String(r.teamId))}</td>${['t', 'w', 'd', 'l', 'pts'].map(k => `<td>${escapeHtml(String(r[k] == null ? '—' : r[k]))}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div></details>` : ''}

      <p class="fa-note">${T('ui.dataSwissAquaticsMatch')} <a href="${escapeHtml(WPMATCH.matchUrl({ url: WPMATCH.SITE }))}" target="_blank" rel="noopener">wpmatch.ch</a>${T('ui.readOnlyAndNot')}</p>
    </section>`;
    wireWpMatch();
    if (!fxBox || fxBox.stale) wpmRefresh(true);   // first paint shows cache, then quietly catches up
  }

  async function wpmRefresh(quiet) {
    const team = WPMATCH.loadTeam(); if (!team || wpm.busy) return;
    wpm.busy = true; wpm.error = ''; if (!quiet) renderWpMatch();
    try {
      let venueById = (WPMATCH.cacheGet('venues', 7 * 24 * 3600 * 1000) || {}).data;
      if (!venueById) { venueById = await WPMATCH.fetchVenues(); WPMATCH.cachePut('venues', venueById); }
      const fixtures = await WPMATCH.fetchFixtures(team, { search: team.searchTerm || team.name, venueById });
      WPMATCH.cachePut('fx.' + team.id, fixtures);
      try {
        const tables = await WPMATCH.fetchTables(team);
        const picked = WPMATCH.pickTable(tables, team.id);
        if (picked) {
          const nameById = {}; fixtures.forEach(f => { [f.home, f.away].forEach(s => { if (s.id && s.name) nameById[s.id] = s.name; }); });
          picked.rows = picked.rows.map(r => Object.assign({ name: nameById[r.teamId] || '' }, r)).sort((a, b) => (+b.pts || 0) - (+a.pts || 0));
          WPMATCH.cachePut('tbl.' + team.id, picked);
        }
      } catch (e) { /* a missing table must never cost us the fixtures */ }
    } catch (e) {
      wpm.error = e.code === 'unreachable'
        ? T('ui.couldNotReachWpmatch')
        : T('ui.wpmatchUnexpected');
    }
    wpm.busy = false; renderWpMatch();
  }

  async function wpmOpenBox(gameId) {
    const host = $('wpm-box'); if (!host) return;
    const cached = WPMATCH.cacheGet('box.' + gameId, WPM_BOX_TTL);
    let box = cached && cached.data;
    if (!box) {
      host.innerHTML = `<div class="muted">${T('ui.loadingTheBoxScore')}</div>`;
      try { box = await WPMATCH.fetchBox(gameId); WPMATCH.cachePut('box.' + gameId, box); }
      catch (e) { host.innerHTML = `<div class="muted">${T('ui.couldNotLoadBoxScore')}</div>`; return; }
    }
    const team = WPMATCH.loadTeam() || {};
    const nameFor = id => { const f = ((WPMATCH.cacheGet('fx.' + team.id) || {}).data || []).find(x => x.gameId === gameId); if (!f) return String(id); return f.home.id === id ? f.home.name : (f.away.id === id ? f.away.name : String(id)); };
    const L = box.playerLabels || {};
    const cols = ['goals', 'goalon', 'goalextraplayer', 'penaltygoals', 'exclusionfoul'].filter(k => L[k]);
    host.innerHTML = `<div class="wpm-boxscore">
      <div class="wpm-box-head"><b>${escapeHtml(box.title)}</b><button class="btn-ghost xs" id="wpm-box-close">✕</button></div>
      <div class="dev-table-wrap"><table class="dev-table"><thead><tr><th>${T('ui.team')}</th>${box.quarterKeys.map((k, i) => `<th>${escapeHtml((box.scoreLabels && box.scoreLabels[k]) || 'Q' + (i + 1))}</th>`).join('')}<th>${escapeHtml((box.scoreLabels && box.scoreLabels.goals) || T('ui.goalsCol'))}</th><th>${escapeHtml((box.scoreLabels && box.scoreLabels.manup) || T('ui.extraPct'))}</th></tr></thead>
        <tbody>${box.teamIds.map(id => { const l = box.lines[id]; return `<tr${id === team.id ? ' class="wpm-us"' : ''}><td>${escapeHtml(nameFor(id))}</td>${(l ? l.quarters : [null, null, null, null]).map(q => `<td>${q == null ? '—' : q}</td>`).join('')}<td><b>${l && l.goals != null ? l.goals : '—'}</b></td><td>${l && l.manup != null ? l.manup + '%' : '—'}</td></tr>`; }).join('')}</tbody></table></div>
      ${box.teamIds.filter(id => (box.rosters[id] || []).length).map(id => `<div class="ef-label">${escapeHtml(nameFor(id))}</div>
        <div class="dev-table-wrap"><table class="dev-table"><thead><tr><th>#</th>${cols.map(k => `<th>${escapeHtml(L[k])}</th>`).join('')}</tr></thead>
          <tbody>${box.rosters[id].map(p => `<tr><td>${escapeHtml(p.cap)}</td>${cols.map(k => { const v = p.stats[k]; const n = WPMATCH.statNumber(v), d = WPMATCH.statDetail(v); return `<td${d && d !== n ? ` title="${escapeHtml(d)}"` : ''}>${escapeHtml(n || '0')}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`).join('')}
      <p class="fa-note">${T('ui.officialRecord')} <a href="${escapeHtml(box.url)}" target="_blank" rel="noopener">${T('ui.openOnWpmatchCh')}</a></p>
    </div>`;
    const cl = $('wpm-box-close'); if (cl) cl.onclick = () => { host.innerHTML = ''; };
    host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function wireWpMatch() {
    const go = $('wpm-search-go'), inp = $('wpm-search');
    if (go && inp) {
      const run = async () => {
        const q = inp.value.trim(); if (!q) return;
        const out = $('wpm-results'); out.innerHTML = `<div class="muted">${T('ui.searching')}</div>`;
        try {
          const teams = await WPMATCH.searchTeams(q);
          out.innerHTML = teams.length
            ? `<div class="wpm-teamlist">${teams.map(t => `<button class="btn-ghost sm" data-wpm-team="${t.id}" data-name="${escapeHtml(t.name)}" data-slug="${escapeHtml(t.slug)}" data-url="${escapeHtml(t.url)}">${escapeHtml(t.name)}</button>`).join('')}</div>`
            : `<div class="muted">${T('ui.noTeamOfThatName')}</div>`;
          out.querySelectorAll('[data-wpm-team]').forEach(b => b.onclick = () => {
            WPMATCH.saveTeam({ id: +b.dataset.wpmTeam, name: b.dataset.name, slug: b.dataset.slug, url: b.dataset.url, searchTerm: q });
            renderWpMatch(); wpmRefresh();
          });
        } catch (e) { out.innerHTML = `<div class="muted">${T('ui.couldNotReachWpmatchNow')}</div>`; }
      };
      go.onclick = run; inp.onkeydown = e => { if (e.key === 'Enter') run(); };
    }
    const rf = $('wpm-refresh'); if (rf) rf.onclick = () => wpmRefresh(false);
    const ch = $('wpm-change'); if (ch) ch.onclick = () => { WPMATCH.saveTeam(null); renderWpMatch(); };
    const tc = $('wpm-tocal'); if (tc) tc.onclick = () => {
      const team = WPMATCH.loadTeam();
      const fixtures = ((WPMATCH.cacheGet('fx.' + team.id) || {}).data) || [];
      const evs = WPMATCH.toCalendarEvents(fixtures.filter(f => !f.dateTBC), team);
      const cur = CALENDAR.load(); const byId = new Map(cur.map(e => [e.id, e]));
      let added = 0, updated = 0;
      evs.forEach(e => { if (byId.has(e.id)) { Object.assign(byId.get(e.id), e); updated++; } else { cur.push(e); added++; } });
      CALENDAR.save(cur);
      toast(`${T('ui.nMatchesAdded', { n: added })}${updated ? T('ui.andNUpdated', { n: updated }) : ''}`);
      renderAgenda();
    };
    document.querySelectorAll('[data-wpm-box]').forEach(b => b.onclick = () => wpmOpenBox(b.dataset.wpmBox));
  }

  function goalFromForm() {
    return {
      title: $('goal-title').value.trim() || T('ui.seasonGoal'),
      startDate: $('goal-start').value, targetDate: $('goal-target').value,
      daysPerWeek: +$('goal-days').value,
      focus: [...document.querySelectorAll('.goal-focus input[type="checkbox"]:checked')].filter(i=>i.id!=='goal-usetests').map(i=>i.value),
    };
  }
  /* the signed-in player's own measured gaps — empty for a coach with no record, which
     is the safe default: the plan then comes out exactly as it always did */
  function devGapsForPlan() {
    const box = $('goal-usetests');
    if (!box || !box.checked || typeof TESTLOG==='undefined' || !state.user) return [];
    const d = loadDev(state.user.email);
    return TESTLOG.focusGaps(d.tests || [], { tier: d.info.tier, isGK: !!d.info.isGK, today: new Date().toISOString().slice(0,10) });
  }
  function generatePlanFromForm() {
    season.plan = PLANNER.generatePlan(goalFromForm(), { gaps: devGapsForPlan() });
    renderPlan();
    toast(season.plan.leadFocus ? T('ui.planGeneratedLeaning') : T('ui.planGenerated'));
  }
  function renderPlan() {
    const p = season.plan; if (!p) return;
    const out = $('plan-out');
    const phases = p.mesocycles.map(m=>`<span class="phase-pill ${m.name.replace(/\W/g,'').toLowerCase()}">${T('ui.planPhasePill', { name: escapeHtml(m.name), weeks: m.weeks })}</span>`).join('');
    const weeks = p.microcycles.map(mc=>`<details class="plan-week"><summary>
        <span class="pw-n">${T('ui.weekN', { n: mc.week })}</span><span class="pw-phase">${escapeHtml(mc.phase)}${mc.deload?T('ui.deloadSuffix'):''}</span>
        <span class="pw-load"><i class="lv vol" style="width:${mc.load.volume}%"></i></span>
        <span class="pw-rpe">${T('ui.volIntLoad', { vol: mc.load.volume, int: mc.load.intensity })}</span></summary>
      <div class="pw-sessions">${mc.sessions.map(s=>`<div class="ses${s.fromGap?' ses-fromgap':''}"${s.fromGap?` title="${T('ui.pickedFromYourTestLog')}"`:''}><span class="ses-focus ${s.focus}">${escapeHtml(s.focus)}</span>
        <span class="ses-main"><strong>${escapeHtml(s.title)}</strong><span class="muted">${T('ui.sessionMeta', { min: s.durationMin, rpe: s.rpe, drills: escapeHtml((s.drills||[]).slice(0,2).join(' · ')) })}</span></span></div>`).join('')}</div>
      </details>`).join('');
    // say WHY the plan leans the way it does — a plan that silently changes shape is worse than one that explains itself
    const focusLabel = k => (FOCUS_LIST().find(f => f[0] === k) || [k, k])[1].toLowerCase();
    let why;
    if (p.emphasisBoost && Object.keys(p.emphasisBoost).length) {
      why = Object.keys(p.emphasisBoost).map(f => {
        const g = (p.gaps || []).find(x => x.focus === f);
        return `<div class="why-row">${T('ui.planMoreFocus', { focus: escapeHtml(focusLabel(f)) })}${g ? `${T('ui.planGapDetail', { test: escapeHtml(g.label), delta: escapeHtml(g.deltaText) })}${g.verified ? '' : ` <span class="muted">${T('ui.selfReportedParen')}</span>`}` : ''}</div>`;
      }).join('') + (p.leadFocus ? `<div class="why-row muted">${T('ui.firstSessionTargets', { focus: escapeHtml(focusLabel(p.leadFocus)) })}</div>` : '')
        + `<div class="why-row muted">${T('ui.theTestCatalogueMeasures')}</div>`;
    } else {
      const noneLogged = !$('goal-usetests') || $('goal-usetests').disabled;
      why = `<div class="why-row muted">${T('ui.planBasedOnFocusOnly', { reason: noneLogged ? T('ui.planNoTestResultsYet') : T('ui.planNothingStandsOut') })} <button class="btn-ghost xs" id="plan-why-log">${T('ui.logATest')}</button></div>`;
    }
    out.innerHTML = `<div class="plan-summary">${T('ui.peakForSummary', { date: escapeHtml(new Date(p.goal.targetDate).toLocaleDateString()), weeks: p.weeks, perWeek: p.goal.daysPerWeek })}</div>
      <div class="plan-why">${why}</div>
      <div class="phase-band">${phases}</div>
      <div class="plan-weeks">${weeks}</div>
      <button class="btn-primary sm" id="plan-tocal">${T('ui.addAllNSessions', { n: PLANNER.planToEvents(p).length })}</button>`;
    $('plan-tocal').onclick = () => {
      const evs = PLANNER.planToEvents(p);
      const cur = CALENDAR.load(); const ids = new Set(cur.map(e=>e.id));
      const add = evs.filter(e=>!ids.has(e.id));
      CALENDAR.save(cur.concat(add));
      toast(T('ui.nSessionsAdded', { n: add.length }));
      renderAgenda();
    };
    const whyLog = $('plan-why-log'); if (whyLog) whyLog.onclick = () => switchView('development');
  }
  function addCalendarEvent() {
    const date = $('ev-date').value, time = $('ev-time').value || '18:00';
    if (!date) { toast(T('ui.pickADate')); return; }
    const start = new Date(`${date}T${time}`);
    const ev = { id: CALENDAR.uid(), type: $('ev-type').value, title: $('ev-title').value.trim() || T('ui.eventDefaultTitle'),
      start: start.toISOString(), end: new Date(start.getTime()+90*60000).toISOString(),
      location: $('ev-loc').value.trim(), reminderMin: 120 };
    const all = CALENDAR.load(); all.push(ev); CALENDAR.save(all);
    $('ev-title').value=''; $('ev-loc').value='';
    toast(T('ui.eventAdded')); renderAgenda();
  }
  function renderAgenda() {
    const wrap = $('cal-agenda'); if (!wrap) return;
    const items = CALENDAR.agenda(CALENDAR.load(), new Date(), 90);
    if (!items.length) { wrap.innerHTML = `<div class="muted" style="padding:12px">${T('ui.noUpcomingEvents')}</div>`; return; }
    wrap.innerHTML = `<div class="ef-label" style="margin-top:12px">${T('ui.next90Days', { n: items.length })}</div>` + items.map(e=>`
      <div class="agenda-row" data-ev="${escapeHtml(e.id)}">
        <span class="ag-date"><b>${fmtDay(e.start)}</b>${e.allDay?'':'<span class="muted">'+fmtTime(e.start)+'</span>'}</span>
        <span class="ag-main"><span class="ag-title">${(CALENDAR.TYPES[e.type]||'').split(' ')[0]} ${escapeHtml(e.title)}</span>
          ${e.location?`<span class="muted">${escapeHtml(e.location)}</span>`:''}</span>
        <button class="btn-ghost xs" data-del-ev="${escapeHtml(e.id)}" title="${T('ui.remove')}">✕</button>
      </div>`).join('');
    wrap.querySelectorAll('[data-del-ev]').forEach(b=> b.onclick=()=>{ CALENDAR.save(CALENDAR.load().filter(e=>e.id!==b.dataset.delEv)); renderAgenda(); });
  }
  function downloadBlob(text, name, mime) {
    try { const blob = new Blob([text], { type: mime||'text/plain' }); const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
      setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 100); } catch(e){ toast(T('ui.downloadNotSupportedHere')); }
  }
  function exportICS() {
    const ev = CALENDAR.load();
    if (!ev.length) { toast(T('ui.nothingToExportYet')); return; }
    downloadBlob(CALENDAR.toICS(ev, { name: 'Triibholz — ' + (state.user && state.user.name || T('view.team')) }), 'triibholz-season.ics', 'text/calendar');
    toast(T('ui.calendarExportedOpenIt'));
  }
  function feedBase() { return API.base(); }   // the club server is always the app's own origin
  function calToken() { try { let t=localStorage.getItem('thplay.calendar.token'); if(!t){ t=CALENDAR.uid().replace('ev_','cal'); localStorage.setItem('thplay.calendar.token',t); } return t; } catch(e){ return 'cal'; } }
  async function publishFeed() {
    const out = $('cal-subscribe-out');
    const ev = CALENDAR.load(); if (!ev.length) { toast(T('ui.addEventsFirst')); return; }
    const base = feedBase().replace(/\/+$/,''); const token = calToken();
    out.innerHTML = `<div class="muted">${T('ui.publishing')}</div>`;
    try {
      const r = await API.fetch(`${base}/api/calendar/${token}`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ name:'Triibholz — '+(state.user&&state.user.name||'Team'), events: ev }) });
      if (!r.ok) throw new Error('publish-'+r.status);
      const url = `${base}/api/calendar/${token}.ics`;
      const webcal = url.replace(/^https?:/, 'webcal:');
      const lanHint = /localhost|127\.0\.0\.1/.test(base) ? `<p class="fa-note">${T('ui.localhostFeedWarning')}</p>` : '';
      out.innerHTML = `<div class="feed-box">
        <p class="fa-note">${T('ui.subscribeOnceOnEach')}</p>
        <div class="feed-url"><code>${escapeHtml(url)}</code><button class="btn-ghost xs" id="feed-copy">${T('ui.copy')}</button></div>
        <a class="btn-primary sm" href="${escapeHtml(webcal)}">${T('ui.subscribeOnThisDevice')}</a>
        ${lanHint}
        <p class="fa-note">${T('ui.iphoneCalendarAddAccount')}</p>
      </div>`;
      const cp = $('feed-copy'); if (cp) cp.onclick = ()=>{ try{ navigator.clipboard.writeText(url); toast(T('ui.linkCopied')); }catch(e){} };
      toast(T('ui.publishedSubscribeOnAny'));
    } catch(e) {
      out.innerHTML = `<div class="muted">${T('ui.couldNotPublishToBase', { server: escapeHtml(base) })}</div>`;
    }
  }

  /* ======================================================
     ANNOUNCEMENTS — a coach's note to one player, or a "here's the
     plan for Saturday" broadcast to the whole team, optionally
     carrying attached plays from the library. Unlike everything else
     in this app, an announcement has to reach a DIFFERENT device (the
     coach writes it, a player reads it elsewhere) — so it lives on
     the analysis backend (one JSON file per announcement, the same
     shape as team debriefs), scoped by the team's own invite code.
     ====================================================== */
  const announce = { list: [], unread: 0, reachable: true };
  function announceTeam() { return (state.user && state.user.teamCode) || 'club'; }
  async function loadAnnouncements() {
    if (!state.user) return;
    const base = feedBase().replace(/\/+$/, '');
    try {
      // with accounts on the server reads neither of these from the request — it uses the session
      const q = realAccounts ? '' : `?team=${encodeURIComponent(announceTeam())}&for=${encodeURIComponent(state.user.email)}`;
      const r = await API.fetch(`${base}/api/announcements${q}`);
      if (!r.ok) throw new Error('list-' + r.status);
      const data = await r.json();
      announce.list = data.announcements || []; announce.unread = data.unread || 0; announce.reachable = true;
    } catch (e) { announce.reachable = false; }
    const badge = $('announce-badge');
    if (badge) { badge.textContent = announce.unread; badge.hidden = !announce.unread; }
    if ($('announce-panel') && !$('announce-panel').hidden) renderAnnouncePanel();
  }
  /* A drop-down hangs from the right edge of its button. On a phone the top-bar buttons sit mid-screen, and the Look menu
     and announcements opened off the left side of it (theme Phase 4) — so nudge an open menu back onto the screen. */
  function fitMenu(m) {
    if (!m) return;
    m.style.transform = '';
    if (m.hidden) return;
    const r = m.getBoundingClientRect(), vw = document.documentElement.clientWidth, pad = 8;
    if (!r.width || !vw) return;
    const dx = r.left < pad ? pad - r.left : r.right > vw - pad ? vw - pad - r.right : 0;
    if (dx) m.style.transform = `translateX(${Math.round(dx)}px)`;
  }
  function toggleAnnouncePanel(force) {
    const m = $('announce-panel'); if (!m) return;
    m.hidden = force == null ? !m.hidden : !force;
    if (!m.hidden) { renderAnnouncePanel(); loadAnnouncements(); }
    fitMenu(m);
  }
  function renderAnnouncePanel() {
    const m = $('announce-panel'); if (!m) return;
    const list = announce.list || [];
    m.innerHTML = `<div class="announce-head"><b>${T('ui.announcements')}</b> <button class="help-chip" data-help="announcements" title="${T('ui.howAnnouncementsWork')}">？</button>${canEdit() ? `<button class="btn-ghost xs" id="announce-new">${T('ui.newShort')}</button>` : ''}</div>
      <div class="announce-list">${
        !announce.reachable ? `<div class="muted" style="padding:10px 4px">${T('ui.announcementsNeedBackend')}</div>`
        : list.length ? list.map(a => `<button class="announce-item${a.read ? '' : ' unread'}" data-ann="${escapeHtml(a.id)}">
            <span class="ann-title">${a.scope === 'player' ? '👤' : '📣'} ${escapeHtml(a.title)}</span>
            <span class="muted">${escapeHtml(a.from || '')} · ${new Date(a.createdAt).toLocaleDateString()}${a.matchLabel ? ' · ' + escapeHtml(a.matchLabel) : ''}${a.playCount ? ' · ' + T('ui.nPlaysAttached', { n: a.playCount }) : ''}</span>
          </button>`).join('')
        : `<div class="muted" style="padding:10px 4px">${T('ui.nothingHereYet')}</div>`
      }</div>
      <div id="announce-detail"></div>`;
    const nb = $('announce-new'); if (nb) nb.onclick = e => { e.stopPropagation(); openAnnounceCompose(); };
    m.querySelectorAll('[data-ann]').forEach(b => b.onclick = e => { e.stopPropagation(); openAnnounceDetail(b.dataset.ann); });
  }
  async function openAnnounceDetail(id) {
    const box = $('announce-detail'); if (!box) return;
    box.innerHTML = `<div class="muted" style="padding:8px 4px">${T('ui.loadingEllipsis')}</div>`;
    const base = feedBase().replace(/\/+$/, '');
    let a; try { a = await (await API.fetch(`${base}/api/announcements/${id}`)).json(); } catch (e) { box.innerHTML = `<div class="muted">${T('ui.couldNotLoadThis')}</div>`; return; }
    box.innerHTML = `<div class="announce-open">
      <div class="ann-open-head"><b>${escapeHtml(a.title)}</b><span class="muted">${escapeHtml((a.from && a.from.name) || '')} · ${new Date(a.createdAt).toLocaleString()}</span></div>
      ${a.matchLabel ? `<div class="ann-match">🤽 ${escapeHtml(a.matchLabel)}</div>` : ''}
      ${a.clip && a.clip.url ? `<div class="ann-clip">
        <video controls playsinline preload="metadata" src="${escapeHtml(API.url(a.clip.url))}"></video>
        <div class="ann-marks">${(a.clip.marks || []).map(m => `<span class="tag">${escapeHtml(m)}</span>`).join('')}</div>
      </div>` : ''}
      <p>${escapeHtml(a.body)}</p>
      ${(a.plays || []).length ? `<div class="ann-plays">${a.plays.map((p, i) => `<button class="btn-ghost sm" data-import-play="${i}">${T('ui.playImportButton', { title: escapeHtml((p.play && p.play.title) || T('ui.playN', { n: i + 1 })) })}</button>`).join('')}</div>` : ''}
    </div>`;
    box.querySelectorAll('[data-import-play]').forEach(b => b.onclick = e => { e.stopPropagation(); importAnnouncedPlay(a.plays[+b.dataset.importPlay]); });
    if (!(a.readBy || []).includes(realAccounts ? state.user.id : state.user.email)) {
      // with accounts on the server takes the reader from the session; it is only told who otherwise
      try { await API.fetch(`${base}/api/announcements/${id}/read`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(realAccounts ? {} : { by: state.user.email }) }); } catch (e) {}
      // update the badge/list state quietly — a full re-render would wipe the detail view open right now
      const item = (announce.list || []).find(x => x.id === id); if (item) item.read = true;
      announce.unread = (announce.list || []).filter(x => !x.read).length;
      const badge = $('announce-badge'); if (badge) { badge.textContent = announce.unread; badge.hidden = !announce.unread; }
    }
  }
  function importAnnouncedPlay(packed) {
    if (!packed || typeof SHARE === 'undefined') { toast(T('ui.couldNotImportThat')); return; }
    const r = SHARE.unpack(packed);
    if (r.error || !r.plays.length) { toast(T('ui.couldNotImportThat')); return; }
    let n = 0;
    r.plays.forEach(p => {
      const sc = DATA.newScenario(p.situation || '6v6', p.phase || 'offense');
      Object.assign(sc, p);
      sc.id = 'usr-' + Math.abs(hash('ann' + JSON.stringify(p).slice(0, 80)));
      sc.builtIn = false; sc.owner = state.user && state.user.email;
      if (!state.scenarios.some(x => x.id === sc.id)) { state.scenarios.push(sc); n++; }
    });
    if (n) { DATA.save(state.scenarios); renderLibrary(); toast(T('ui.nPlaysAddedToPlaybook', { n: n })); }
    else toast(T('ui.alreadyInYourPlaybook'));
  }
  /* Who a coach may write to. With accounts on that is the club's approved members, from the
     server — a name and a member ref, nothing else (the old local user list is gone). */
  async function announceAddressees() {
    if (!realAccounts) {
      return DATA.loadUsers().filter(u => u.role === 'player' && u.status === 'approved')
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .map(u => ({ to: u.email, label: (u.name || u.email) + (u.position ? ' · Pos ' + u.position : '') }));
    }
    try {
      const club = SESSION.activeClub(state.user && state.user.clubId);
      if (!club) return [];
      return (await SESSION.api(`/api/clubs/${club.id}/addressees`)).addressees
        .filter(p => p.memberRef !== state.user.memberRef)
        .map(p => ({ to: p.memberRef, label: p.name }));
    } catch (e) { return []; }
  }
  async function openAnnounceCompose() {
    const roster = await announceAddressees();
    const matches = CALENDAR.agenda(CALENDAR.load(), new Date(), 120).filter(e => e.type === 'match');
    const myPlays = (state.scenarios || []).filter(s => !s.builtIn).slice(0, 30);
    const ov = document.createElement('div'); ov.className = 'modal-backdrop'; ov.id = 'announce-compose-modal';
    ov.addEventListener('click', e => e.stopPropagation());   // this modal sits outside #announce-panel — never let a click here bubble to the document-level "close the bell panel" listener
    document.body.appendChild(ov);
    ov.innerHTML = `<div class="modal modal-sm">
      <div class="modal-head"><h3>${T('ui.newAnnouncement')}</h3><span class="spacer"></span><button class="modal-x" id="ann-x">✕</button></div>
      <div class="modal-body ann-compose">
        <div class="ann-scope-toggle">
          <label><input type="radio" name="ann-scope" value="team" checked> ${T('ui.wholeTeam')}</label>
          <label><input type="radio" name="ann-scope" value="player"> ${T('ui.onePlayer')}</label>
        </div>
        <select id="ann-to" hidden>${roster.map(u => `<option value="${escapeHtml(u.to)}">${escapeHtml(u.label)}</option>`).join('') || `<option value="">${T('ui.noApprovedPlayersYet')}</option>`}</select>
        <input type="text" id="ann-title" placeholder="${T('ui.titleEGThis')}">
        <textarea id="ann-body" rows="4" placeholder="${T('ui.whatDoTheyNeed')}"></textarea>
        <select id="ann-match"><option value="">${T('ui.notTiedToA')}</option>${matches.map(m => `<option value="${escapeHtml(m.id)}" data-label="${escapeHtml(fmtDay(m.start) + ' · ' + m.title)}">${escapeHtml(fmtDay(m.start))} · ${escapeHtml(m.title)}</option>`).join('')}</select>
        ${myPlays.length ? `<div class="ann-plays-pick"><span class="ef-label">${T('ui.attachPlaysUpTo', { n: ANNOUNCE.MAX_PLAYS })}</span>
          ${myPlays.map(s => `<label class="chip-check"><input type="checkbox" value="${escapeHtml(s.id)}"> ${escapeHtml(s.title || 'Untitled')}</label>`).join('')}</div>` : ''}
      </div>
      <div class="modal-foot"><button class="btn-ghost" id="ann-cancel">${T('ui.cancel')}</button><button class="btn-primary" id="ann-send">${T('ui.send')}</button></div>
    </div>`;
    const close = () => ov.remove();
    ov.querySelector('#ann-x').onclick = close; ov.querySelector('#ann-cancel').onclick = close;
    ov.querySelectorAll('[name="ann-scope"]').forEach(rd => rd.onchange = () => { ov.querySelector('#ann-to').hidden = ov.querySelector('[name="ann-scope"]:checked').value !== 'player'; });
    ov.querySelector('#ann-send').onclick = async () => {
      const scope = ov.querySelector('[name="ann-scope"]:checked').value;
      const title = ov.querySelector('#ann-title').value.trim(), body = ov.querySelector('#ann-body').value.trim();
      if (!title || !body) { toast(T('ui.addATitleAnd')); return; }
      const toSel = ov.querySelector('#ann-to');
      if (scope === 'player' && !toSel.value) { toast(T('ui.pickAPlayer')); return; }
      const matchSel = ov.querySelector('#ann-match'), matchOpt = matchSel.selectedOptions[0];
      const plays = [...ov.querySelectorAll('.ann-plays-pick input:checked')].slice(0, ANNOUNCE.MAX_PLAYS)
        .map(cb => state.scenarios.find(s => s.id === cb.value)).filter(Boolean).map(s => SHARE.pack(s));
      // with accounts on the club and the author come from the session; the app does not name itself
      const payload = { team: announceTeam(), scope, to: scope === 'player' ? toSel.value : null,
        fromName: realAccounts ? undefined : state.user.name, fromEmail: realAccounts ? undefined : state.user.email, title, body,
        matchLabel: matchOpt && matchOpt.value ? matchOpt.dataset.label : null,
        matchEventId: matchOpt && matchOpt.value ? matchOpt.value : null, plays };
      const btn = ov.querySelector('#ann-send'); btn.disabled = true; btn.textContent = T('ui.sending');
      try {
        const base = feedBase().replace(/\/+$/, '');
        const r = await API.fetch(`${base}/api/announcements`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
        if (!r.ok) throw new Error('send-' + r.status);
        toast(scope === 'player' ? T('ui.noteSent') : T('ui.sentToWholeTeam'));
        close(); loadAnnouncements();
      } catch (e) { toast(T('ui.couldNotSend') + e.message + ')'); btn.disabled = false; btn.textContent = T('ui.send'); }
    };
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
    $('frame-label').textContent = T('ui.stepNofM', { n: adjust.idx+1, total });
    { const fl = $('fsb-label'); if (fl) fl.textContent = T('ui.stepNofM', { n: adjust.idx+1, total }); }
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
    toast(T('ui.lastDragUndone'));
  }
  function adjustStep(d) {
    if (!adjust.live) return;
    adjust.idx = Math.max(0, Math.min(adjust.scn.frames.length-1, adjust.idx + d));
    renderAdjustBoard();
  }
  function adjustCancel() {
    resetAdjust();
    openScenario(state.selectedId);
    toast(T('ui.changesDiscarded'));
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
    toast(T(asNew ? 'ui.savedAsNewMovement' : 'ui.changesSaved'));
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
    sum.textContent = T(r.steps > 1 ? 'ui.draftStepsOnBoard' : 'ui.draftStepOnBoard', { n: r.steps });
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
    toast(T(sc.template ? 'ui.templateOn' : 'ui.templateOff'));
  }
  const myTemplates = () => state.scenarios.filter(sc => sc.template && !sc.builtIn && !sc.shared);
  function templatesFor(situation, phase) {
    const mine = myTemplates().filter(sc => sc.situation === situation && sc.phase === phase);
    const samples = state.scenarios.filter(sc => sc.builtIn && sc.situation === situation && sc.phase === phase);
    return { mine, samples };
  }
  function cloneAsNew(src) {
    const sc = DATA.newScenario(src.situation, src.phase);
    sc.title = (src.title || 'Play') + T('ui.copySuffix'); sc.description = src.description || '';
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
      b.innerHTML = `<span class="tpl-kind">${kind}</span><strong>${escapeHtml(sc.title || 'Untitled')}</strong><span class="muted">${sc.frames.length > 1 ? T('ui.nSteps', { n: sc.frames.length }) : T('ui.nStep', { n: sc.frames.length })}${sc.description ? ' · ' + escapeHtml(sc.description.slice(0, 80)) : ''}</span>`;
      b.onclick = () => { $('tpl-modal').hidden = true; openEditor(cloneAsNew(sc), true); };
      list.appendChild(b); };
    mine.forEach(sc => row(sc, T('ui.tplKindMine'))); samples.forEach(sc => row(sc, 'sample'));
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
    grp.innerHTML = `<div class="cmd-group-h">${T('ui.myPlaysTemplates')}</div>`;
    const rowEl = document.createElement('div'); rowEl.className = 'cmd-btns';
    mine.forEach(sc => { const b = document.createElement('button'); b.className = 'cmd-btn'; b.type = 'button'; b.dataset.tpl = sc.id; b.title = sc.description || sc.title;
      b.innerHTML = `<span class="cmd-ic">⭐</span><span class="cmd-name">${escapeHtml(sc.title || 'Untitled')}</span><span class="cmd-scope">${T('ui.nSteps', { n: sc.frames.length })}</span>`;
      b.onclick = () => onPickTpl(sc.id); rowEl.appendChild(b); });
    grp.appendChild(rowEl); wrap.appendChild(grp);
  }
  function applyTemplateToEditor(id) {
    const tpl = state.scenarios.find(x => x.id === id); if (!edit.scenario || !tpl) return;
    const r = playAsSteps(tpl, edit.scenario.frames[edit.scenario.frames.length - 1]);
    edit.scenario.frames.push(...r.steps);
    Object.keys(r.notes).forEach(p => { if (!r.notes[p]) return; edit.scenario.notes[p] = edit.scenario.notes[p] ? edit.scenario.notes[p] + ' ' + r.notes[p] : r.notes[p]; });
    edit.idx = edit.scenario.frames.length - 1; buildNotesGrid(); editorRender();
    toast(T('ui.templateAddedSteps', { name: r.name, n: r.steps.length }));
  }
  function applyTemplateAudible(id) {
    const tpl = state.scenarios.find(x => x.id === id); if (!tpl) return;
    if (!canPausedEdit()) { toast(T('ui.openAPlayFirst')); return; }
    if (state.viewer) state.viewer.stop(); enterPausedEdit(); if (!adjust.scn) return;
    const r = playAsSteps(tpl, adjust.scn.frames[adjust.scn.frames.length - 1]);
    adjust.undo.push(JSON.parse(JSON.stringify(adjust.scn.frames))); if (adjust.undo.length > 25) adjust.undo.shift();
    adjust.scn.frames.push(...r.steps); adjust.scn.notes = adjust.scn.notes || {};
    Object.keys(r.notes).forEach(p => { if (!r.notes[p]) return; adjust.scn.notes[p] = adjust.scn.notes[p] ? adjust.scn.notes[p] + ' ' + r.notes[p] : r.notes[p]; });
    adjust.dirty = true; if (typeof renderAdjustBoard === 'function') renderAdjustBoard();
    const bar = $('adjust-bar'); if (bar) bar.hidden = false;
    const sheet = $('audible-sheet'); if (sheet) sheet.hidden = true;
    toast(T('ui.templateCalledSteps', { name: r.name, n: r.steps.length }));
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
        b.title = c.cue + (c.when ? `\n\n${T('ui.whenLabel')} ${c.when}` : '') + (c.why ? `\n${T('ui.whyLabel')} ${c.why}` : '');
        b.innerHTML = `<span class="cmd-ic">${c.icon||'▸'}</span><span class="cmd-name">${escapeHtml(c.name)}</span><span class="cmd-scope">${c.scope}</span>`;
        const info = $(containerId === 'as-groups' ? 'as-info' : 'cmd-info');
        /* the resting hint: written here rather than via data-i18n, because the app fills this
           panel with markup on hover and data-i18n would erase it on a language change */
        if (info && !info.querySelector('strong')) info.textContent = T('ui.hoverACommandTo');
        const showInfo = () => { if (info) info.innerHTML = `<strong>${escapeHtml(c.name)}</strong> — ${escapeHtml(c.cue)}${c.when ? `<br><b>${T('ui.whenLabel')}</b> ${escapeHtml(c.when)}` : ''}${c.why ? `<br><b>${T('ui.whyLabel')}</b> ${escapeHtml(c.why)}` : ''}`; };
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
    if (!r) { toast(T('ui.thatCommandNeedsA')); return; }
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
    if (!canPausedEdit()) { toast(T('ui.openAPlayFirst')); return; }
    if (state.viewer) state.viewer.stop();    // freeze the animation before we edit
    enterPausedEdit();                        // ensure the paused working copy exists
    if (!adjust.scn) return;
    const target = $('as-target').value || 'team';
    const r = COMMANDS.apply(adjust.scn, id, { target });
    if (!r) { toast(T('ui.thatCommandNeedsA')); return; }
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
    g.fillStyle = C('--export-bg'); g.fillRect(0, 0, sheet.width, sheet.height);
    g.fillStyle = C('--export-title'); g.font = '700 26px system-ui, -apple-system, Segoe UI, sans-serif'; g.fillText(String(sc.title || 'Play').slice(0, 60), pad, 34);
    g.fillStyle = C('--export-caption'); g.font = '500 15px system-ui, sans-serif'; g.fillText(T('ui.sheetCaption', { situation: DATA.sit(sc.situation).label, phase: T('phase.' + sc.phase), n: n }), pad, 56);
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
      return `<section class="play"><h1>${esc(sc.title || 'Play')}</h1><p class="sub">${T('ui.printPlaySub', { situation: esc(DATA.sit(sc.situation).label), phase: T('phase.' + sc.phase), n: sc.frames.length })}${sc.author ? ' · ' + esc(sc.author) : ''}</p>${sc.description ? `<p>${esc(sc.description)}</p>` : ''}${img}${notes ? `<h2>${T('assign.hint')}</h2><ul>${notes}</ul>` : ''}</section>`; };
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(scns.length === 1 ? (scns[0].title || 'Play') : T('ui.nPlaysTitle', { n: scns.length }))} — Triibholz</title>
      <style>/* theme:fixed — the print booklet is paper for now; whether printing follows the look is decided in theme Phase 2 */body{font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;color:#111;margin:0;padding:18mm 16mm}.play{page-break-after:always}.play:last-child{page-break-after:auto}h1{margin:0 0 2px;font-size:22px}h2{font-size:14px;margin:14px 0 4px}.sub{color:#555;margin:0 0 8px}img{width:100%;max-width:720px;display:block;border-radius:6px;margin:8px 0}ul{padding-left:18px}li{margin:2px 0}@media print{body{padding:0}}</style></head>
      <body>${scns.map(page).join('')}<script>setTimeout(function(){window.print();},350);<\/script></body></html>`;
  }
  function openPrint(scns) {
    const html = printHtml(scns);
    let w = null; try { w = window.open('', '_blank'); } catch (e) {}
    if (!w) { downloadBlob(html, SHARE.filename((scns.length === 1 ? scns[0].title : 'plays') + ' print', 'html'), 'text/html'); toast(T('ui.popUpsAreBlocked')); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }
  async function exportPlayAs(fmt) {
    const sc = currentScenario(); if (!sc) return;
    if (fmt === 'json') return downloadPlay();
    if (!await guardConfidential([sc])) return;
    if (fmt === 'png') { const sheet = sheetCanvas(sc); if (!sheet) { toast(T('ui.imageExportNeedsA')); return; }
      sheet.toBlob(b => { if (!b) { toast(T('ui.couldNotRenderThe')); return; } const url = URL.createObjectURL(b); const a = document.createElement('a'); a.href = url; a.download = SHARE.filename(sc.title, 'png'); document.body.appendChild(a); a.click(); setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1500); toast(T('ui.imageSheetDownloaded')); }, 'image/png'); return; }
    if (fmt === 'svg') { const svg = svgOfBoard(); if (!svg) return; downloadBlob(svg, SHARE.filename(sc.title + ' step ' + ((state.viewer ? state.viewer.currentStep() : 0) + 1), 'svg'), 'image/svg+xml'); toast(T('ui.boardSavedAsSvg')); return; }
    if (fmt === 'pdf') { openPrint([sc]); return; }
    if (fmt === 'video') { const d = $('video-panel'); if (d) { d.open = true; if (typeof d.scrollIntoView === 'function') d.scrollIntoView({ behavior: 'smooth', block: 'start' }); const b = $('vid-generate'); if (b) b.focus(); } return; }
  }
  function toggleDlMenu(force) { const m = $('dl-menu'); if (!m) return; m.hidden = force == null ? !m.hidden : !force; fitMenu(m); }
  async function downloadPlay() {
    const sc = currentScenario(); if (!sc || typeof SHARE === 'undefined') return;
    if (!await guardConfidential([sc])) return;
    downloadBlob(JSON.stringify(SHARE.pack(sc), null, 1), SHARE.filename(sc.title, 'thplay.json'), 'application/json');
    DATA.logActivity('play', `Downloaded “${sc.title}”`, state.user && state.user.name);
    toast(T('ui.playDownloadedSendThe'));
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
    let url; try { url = SHARE.shareUrl(location.href, await SHARE.encode(SHARE.pack(sc))); } catch (e) { toast(T('ui.couldNotBuildThe')); return; }
    if (navigator.share) { try { await navigator.share({ title: sc.title, text: 'Water polo play: ' + sc.title, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    const done = () => toast(T('ui.linkCopiedWhoeverOpens'));
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
    /* A whole-device file is not a bag of plays and must not be fed through the play importer —
       it would find the plays, write them, and quietly drop the rosters, the film and the test
       results, which is the exact loss this file exists to prevent. Caught first, by its format. */
    if (typeof DEVICE !== 'undefined' && files.length === 1) {
      let maybe = null;
      try { maybe = JSON.parse(await read(files[0])); } catch (e) { maybe = null; }
      if (maybe && maybe.format === DEVICE.FORMAT) return void await deviceRestore(maybe);
    }
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
  function toggleImportMenu(force) { const m = $('import-menu'); if (!m) return; m.hidden = force == null ? !m.hidden : !force; fitMenu(m); }
  function openPaste() { const m = $('paste-modal'); if (!m) return; m.hidden = false; $('paste-text').value = ''; setTimeout(() => $('paste-text').focus(), 30); }
  async function backupAll() {
    const mine = state.scenarios.filter(sc => !sc.builtIn && !sc.shared);
    if (!mine.length) { toast(T('ui.noPlaysOfYour')); return; }
    downloadBlob(JSON.stringify(SHARE.packMany(mine, { name: 'Triibholz backup ' + new Date().toISOString().slice(0, 10) }), null, 1), SHARE.filename('triibholz-backup-' + new Date().toISOString().slice(0, 10), 'thplay.json'), 'application/json');
    toast(`${mine.length} play${mine.length > 1 ? 's' : ''} saved as a backup — import the file on any device`);
  }
  /* ---- take everything with me ----
     backupAll() above saves PLAYS. This saves the device: every thplay.* key — rosters, tagged
     moments, the cut library, player test histories, home training, preferences. Browser storage
     is keyed by origin, so without this the move to thplay.ch strands all of it silently. */
  async function deviceBackup() {
    let videos = [];
    try { if (typeof FILM !== 'undefined' && FILM.videoList) videos = await FILM.videoList(); } catch (e) {}
    const file = DEVICE.pack(window.localStorage, videos, {
      at: new Date().toISOString(), origin: location.origin, app: 'Triibholz',
    });
    const d = DEVICE.describe(file);
    downloadBlob(JSON.stringify(file, null, 1),
      'triibholz-device-' + new Date().toISOString().slice(0, 10) + '.thplay.json', 'application/json');
    // say what is NOT in it, in the same breath as making it
    toast(videos.length
      ? T('ui.deviceSavedWithVideos', { n: d.work.length, v: videos.length })
      : T('ui.deviceSaved', { n: d.work.length }));
  }

  async function deviceRestore(file) {
    const d = DEVICE.describe(file);
    if (!d.ok) { toast(T('ui.deviceNotAFile')); return false; }
    const clash = Object.keys(file.stores).filter(k => window.localStorage.getItem(k) !== null);
    /* A device that already holds work is the one case where restoring blindly is the same loss,
       pointed the other way. Ask, and default to keeping what is here. */
    const replace = clash.length
      ? window.confirm(T('ui.deviceClash', { n: clash.length }))
      : false;
    const r = DEVICE.apply(file, window.localStorage, { replace });
    if (!r.ok) { toast(r.error === 'device-full' ? T('ui.deviceFull') : T('ui.deviceNotAFile')); return false; }
    toast(T('ui.deviceRestored', { n: r.written.length, kept: r.kept.length }));
    setTimeout(() => location.reload(), 900);   // every module reads its store once, at start
    return true;
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
    c.textContent = T('ui.nSelected', { n: selected.size });
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
    out.innerHTML = `<div class="muted">${T('ui.renderingTheReel', { n: scns.length, s: Math.round(total) })}<span id="sb-pct">0%</span></div>`;
    try {
      const res = await VIDEOGEN.recordReel(plays, { title: setName(), subtitle: T('ui.reelSubtitle', { n: scns.length, phase: T('phase.' + state.phase) }), onProgress: p => { const e = $('sb-pct'); if (e) e.textContent = Math.round(p * 100) + '%'; } });
      const ext = /mp4/.test(res.mime) ? 'mp4' : 'webm';
      const name = SHARE.filename(setName() + ' reel', ext);
      out.innerHTML = `<video src="${res.url}" controls playsinline class="vid-preview"></video>
        <div class="sb-actions"><a class="btn-primary sm" id="sb-reel-download" href="${res.url}" download="${escapeHtml(name)}">${T('ui.downloadReelSeconds', { s: res.duration.toFixed(0) })}</a>${navigator.share ? `<button class="btn-ghost sm" id="sb-reel-share">${T('ui.shareEllipsis')}</button>` : ''}</div>`;
      const sh = $('sb-reel-share'); if (sh) sh.onclick = async () => { try { const file = new File([res.blob], name, { type: res.mime }); if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: setName() + ' reel' }); else toast(T('ui.sharingFilesIsnT')); } catch (e) {} };
      toast(T('ui.reelReadyPlayIt'));
    } catch (e) { out.innerHTML = `<div class="muted">${T('ui.couldNotRenderReel', { error: escapeHtml(e.message || 'unknown error') })}</div>`; }
    finally { btn.disabled = !selected.size; }
  }
  // ---- a share link opens the play (no server, no login for the play itself)
  async function openSharedPlay() {
    const code = SHARE.fromHash(location.hash); if (!code) return;
    let obj; try { obj = await SHARE.decode(code); } catch (e) { toast(e.message === 'unsupported-browser' ? T('ui.shareLinkUnsupported') : T('ui.shareLinkDamaged')); return; }
    const r = SHARE.unpack(obj); if (!r.plays.length) { toast(T('ui.theLinkHoldsNo')); return; }
    const p = r.plays[0];
    state.scenarios = state.scenarios.filter(sc => !sc.shared);
    const sc = Object.assign(DATA.newScenario(p.situation, p.phase), { id: 'shared-' + SHARE.fingerprint(p), title: p.title, description: p.description || '', frames: DATA.clone(p.frames), notes: DATA.clone(p.notes || {}), author: (p.author || 'Someone') + T('ui.sharedLinkSuffix'), visibility: 'team', shared: true, builtIn: false, sharedPlay: p });
    state.scenarios.push(sc);
    state.situation = sc.situation; state.phase = sc.phase; buildSituationTabs(); refreshTabs();
    switchView('playbook'); openScenario(sc.id);
    const already = SHARE.isDuplicate(p, state.scenarios.filter(x => !x.shared));
    $('shared-text').textContent = T('ui.sharedPlayNote', { title: sc.title }) + (p.author ? T('ui.sharedPlayFrom', { author: p.author }) : '') + (already ? T('ui.sharedPlayAlready') : '');
    $('shared-save').hidden = already; $('shared-banner').hidden = false;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
  }
  function saveSharedPlay() {
    const sc = currentScenario(); if (!sc || !sc.shared) return;
    const kept = addImported(sc.sharedPlay, 'shared link');
    state.scenarios = state.scenarios.filter(x => !x.shared);
    DATA.save(state.scenarios); DATA.logActivity('play', `Saved shared play “${kept.title}”`, state.user && state.user.name);
    renderLibrary(); openScenario(kept.id); toast(T('ui.savedToYourPlaybook2'));
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
    $('import-menu').querySelectorAll('[data-imp]').forEach(b => b.onclick = e => { e.stopPropagation(); toggleImportMenu(false); if (b.dataset.imp === 'file') $('import-file').click(); else if (b.dataset.imp === 'paste') openPaste(); else if (b.dataset.imp === 'device') deviceBackup(); else backupAll(); });
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
    if (sv) sv.onclick = () => { VIDEOGEN.setProvider({ endpoint: (ep.value || '').trim(), key: (key.value || '').trim(), name: 'provider' }); updateVidStatus(); toast(VIDEOGEN.getProvider() ? T('ui.videoProviderSaved') : T('ui.usingOfflineAnimation')); };
    const pr = $('vid-photoreal'); if (pr) pr.onclick = () => generatePhotoreal(pr);
  }
  async function generateVideo(btn) {
    if (typeof VIDEOGEN === 'undefined' || !edit.scenario) return;
    const out = $('vid-out'); btn.disabled = true;
    out.innerHTML = `<div class="muted">${T('ui.renderingTheClip', { s: Math.round(VIDEOGEN.duration(editPlay())) })}</div>`;
    try {
      const play = editPlay();
      const res = await VIDEOGEN.record(play, { caption: play.description });
      const ext = /mp4/.test(res.mime) ? 'mp4' : 'webm';
      const name = (play.title || 'triibholz-play').replace(/[^\w]+/g, '-').toLowerCase() + '.' + ext;
      out.innerHTML = `<video src="${res.url}" controls playsinline class="vid-preview"></video>
        <a class="btn-primary sm" id="vid-download" href="${res.url}" download="${escapeHtml(name)}">${T('ui.downloadSeconds', { s: res.duration.toFixed(1) })}</a>`;
      toast(T('ui.videoReadyPlayIt'));
    } catch (e) {
      out.innerHTML = `<div class="muted">${T('ui.couldNotRenderVideo', { error: escapeHtml(e.message || 'unknown error') })}</div>`;
    } finally { btn.disabled = false; }
  }
  async function generatePhotoreal(btn) {
    if (typeof VIDEOGEN === 'undefined' || !edit.scenario) return;
    const out = $('vid-out'); btn.disabled = true;
    out.innerHTML = `<div class="muted">${T('ui.requestingPhotoreal')}</div>`;
    try {
      let r = await VIDEOGEN.photoreal(editPlay(), {});
      if (!r.url && r.jobId) {   // async job — poll the adapter until it's ready
        const ep = ((VIDEOGEN.getProvider() || {}).endpoint || '').replace(/\/+$/, '');
        out.innerHTML = `<div class="muted">${T('ui.providerGeneratingClip', { job: escapeHtml(r.jobId) })}</div>`;
        r = await pollVideoJob(ep, r.jobId);
      }
      if (r && r.url) out.innerHTML = `<video src="${escapeHtml(r.url)}" controls playsinline class="vid-preview"></video>
        <a class="btn-primary sm" href="${escapeHtml(r.url)}" download>${T('ui.download')}</a>`;
      else out.innerHTML = `<div class="muted">${T('ui.providerResponse', { response: escapeHtml(JSON.stringify(r).slice(0, 200)) })}</div>`;
    } catch (e) {
      const msg = /no-provider/.test(e.message) ? T('ui.setProviderEndpointFirst') : e.message;
      out.innerHTML = `<div class="muted">${T('ui.photorealFailed', { error: escapeHtml(msg) })}</div>`;
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
    syncUnderControls();
  }
  /* ---- a player under the water, in this step.

     Legal when a player sinks THEMSELVES — to break their marker's line of sight, or to let a pass
     travel over them. Sinking an OPPONENT is a major foul and an 18-second exclusion (docs/FOULS.md,
     Art. 9.8/9.9), so the hint says which one the board is drawing. Depth rides on the player's
     point as `u`, so it interpolates between steps and survives a share link and an export. */
  function underPlayers() {
    const f = currentFrame(), out = [];
    Object.keys(f.att || {}).forEach(k => out.push({ id: 'A' + k, side: 'att', k }));
    Object.keys(f.def || {}).forEach(k => out.push({ id: 'D' + k, side: 'def', k }));
    return out;
  }
  function syncUnderControls() {
    const who = $('ed-under-who'), how = $('ed-under-how');
    if (!who || !how) return;
    const f = currentFrame(), list = underPlayers();
    const keep = who.value;
    who.innerHTML = list.map(p => `<option value="${p.id}">${p.id}</option>`).join('');
    who.value = list.some(p => p.id === keep) ? keep : (list[0] ? list[0].id : '');
    const sel = list.find(p => p.id === who.value);
    const u = sel ? ((f[sel.side][sel.k] || {}).u || 0) : 0;
    how.value = u >= 0.9 ? '1' : (u > 0 ? '0.55' : '0');
    how.disabled = !sel;
  }
  function setUnderOnFrame() {
    const who = $('ed-under-who'), how = $('ed-under-how');
    const sel = underPlayers().find(p => p.id === who.value);
    if (!sel) return;
    const f = currentFrame(), pt = f[sel.side][sel.k];
    if (!pt) return;
    const u = +how.value || 0;
    if (u > 0) pt.u = u; else delete pt.u;
    DATA.save(state.scenarios);
    const disc = edit.layers && edit.layers.discLayer
      && edit.layers.discLayer.querySelector(`[data-team="${sel.side === 'att' ? 'A' : 'D'}"][data-label="${sel.k}"]`);
    POOL.setDepth(disc, u);
    drawEditorPathsRefresh();
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
    POOL.setDepth(g, pt && pt.u);
    layers.discLayer.appendChild(g);
    makeDraggable(g, $('editor-pool'), (np) => {
      const f = currentFrame();
      const map = team==='A'?f.att:team==='D'?f.def:null;
      // a drag moves a player; it does not bring them back to the surface
      const was = map ? map[pos] : f.gk;
      if (was && was.u) np = Object.assign({}, np, { u: was.u });
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
    toast(T('ui.stepRecordedDragPlayers'));
  }
  function delFrame() {
    if (edit.scenario.frames.length<=1){ toast(T('ui.aPlayNeedsAt')); return; }
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
    toast(T(lane==='exc' ? 'ui.excludedAddedReentry' : 'ui.subAddedFlyingSub'));
  }
  function delWaiting() {
    const f = currentFrame(); if (!f.extra||!f.extra.length){ toast(T('ui.noWaitingPlayers')); return; }
    f.extra.pop(); editorRender();
  }

  function saveScenario() {
    const sc=edit.scenario;
    sc.title=$('ed-title').value.trim(); sc.description=$('ed-desc').value.trim();
    if (!sc.title){ toast(T('ui.giveThePlayA')); $('ed-title').focus(); return; }
    sc.builtIn=false;
    sc.author = edit.isNew ? state.user.name : (sc.author && sc.author!=='Playbook (sample)' ? sc.author : state.user.name);
    stampPrivacy(sc, true);
    const i = state.scenarios.findIndex(s=>s.id===sc.id);
    if (i>=0) state.scenarios[i]=sc; else state.scenarios.push(sc);
    DATA.save(state.scenarios);
    DATA.logActivity('play', `${state.user.name} ${edit.isNew?'created':'updated'} “${sc.title}” (${sc.situation} ${sc.phase})`, state.user.name);
    state.situation=sc.situation; state.phase=sc.phase;
    closeEditor(); refreshTabs(); renderLibrary(); openScenario(sc.id);
    /* A play captured from a film moment is saved while the coach is still in the Film Room, and
       refreshTabs/renderLibrary/openScenario all act on the playbook view — which is hidden. So
       the work landed correctly and nothing on screen moved, and "Saved" alone reads as "saved
       where?". Name the shelf it went onto; do not drag them out of the match they are tagging. */
    const onPlaybook = state.view === 'playbook';
    toast(onPlaybook ? T('ui.saved') : T('ui.savedToPlaybook', { situation: DATA.sit(sc.situation).label, phase: T('phase.' + sc.phase) }));
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
    closeEditor(); renderLibrary(); toast(T('ui.deleted'));
  }

  /* ======================================================
     ONBOARDING — team invite (link + QR), join flow, guided tour
     ====================================================== */
  const TEAM_KEY = 'thplay.team.v1';
  /* The team code scopes what a person sees (announcements, team-stamped plays). A code built into
     the app would be the same on every install — anyone could read another club's notes by typing
     it — so each install makes its own, once, and keeps it. */
  function newTeamCode(){
    const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no I/O/0/1: these get read aloud and typed in
    let bytes; try { bytes = crypto.getRandomValues(new Uint8Array(6)); } catch(e){ bytes = Array.from({length:6},()=>Math.floor(Math.random()*256)); }
    return 'TRII-' + Array.from(bytes).map(b => abc[b % abc.length]).join('');
  }
  function loadTeam(){
    let t = null; try { t = JSON.parse(localStorage.getItem(TEAM_KEY)); } catch(e){}
    if (t && t.code) return t;
    const made = { name: (t && t.name) || 'Triibholz WPC', code: newTeamCode() };
    try { localStorage.setItem(TEAM_KEY, JSON.stringify(made)); } catch(e){}
    return made;
  }
  /* the code travels in the #fragment: a browser never sends that to a server, so it stays out of
     server, proxy and tunnel logs (docs/ACCOUNTS.md) */
  function inviteLink(){ const t=loadTeam(); return location.origin + location.pathname + '#join=' + encodeURIComponent(t.code); }
  function joinParam(){
    try {
      const h = /[#&]join=([^&]+)/.exec(location.hash || '');
      if (h) return decodeURIComponent(h[1]);
      return new URLSearchParams(location.search).get('join');   // links already sent out keep working
    } catch(e){ return null; }
  }

  function inviteCardHtml(){
    const t = loadTeam(); const link = inviteLink();
    let qr=''; try { if (typeof QR!=='undefined') qr = QR.toSVG(link, { size:148, quiet:2 }); } catch(e){ qr=''; }
    return `<div class="invite-card">
      <div class="invite-left">
        <span class="dc-k">${T('ui.invitePlayers')}</span>
        <div class="invite-code">${escapeHtml(t.code)}</div>
        <p class="dc-note">${T('ui.playersScanTheCode')}</p>
        <div class="invite-actions"><button class="btn-primary sm" id="invite-copy">${T('ui.copyInviteLink')}</button></div>
      </div>
      <div class="invite-qr" title="${escapeHtml(link)}">${qr||'<span class="dc-note">QR unavailable</span>'}</div>
    </div>`;
  }
  function bindInvite(root){
    const b = root.querySelector('#invite-copy'); if(!b) return;
    b.onclick = () => {
      const link = inviteLink();
      const done = ()=> toast(T('ui.inviteLinkCopiedShare'));
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
            <button class="btn-ghost sm" id="tour-skip">${T('ui.skip')}</button>
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
    if ($('signin-passkey')) $('signin-passkey').onclick = signInWithPasskey;
    if ($('auth-create')) $('auth-create').onclick = createAccount;
    if ($('auth-code-go')) $('auth-code-go').onclick = () => { const c = (($('auth-code') || {}).value || '').trim(); if (c) offerCode(c); };
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

    $('pending-recheck').onclick = ()=>{ const u=DATA.findUserByEmail(state.user.email); if(u&&u.status!=='pending'){ routeUser(u); toast(T(u.status==='approved'?'ui.approvedWelcome':'ui.accessDeclined')); } else toast(T('ui.stillPendingApproval')); };
    $('pending-signout').onclick = ()=>{ signOutEverything(); show('auth-screen'); };
    $('denied-signout').onclick = ()=>{ signOutEverything(); show('auth-screen'); };

    document.querySelectorAll('#main-nav .nav-btn').forEach(b=> b.onclick=()=>switchView(b.dataset.view));

    document.querySelectorAll('#phase-toggle .phase-btn').forEach(b=> b.onclick=()=>{ state.phase=b.dataset.phase; refreshTabs(); renderLibrary(); openFirstOrEmpty(); });

    $('play-btn').onclick = ()=> {
      if (adjust.live) {
        if (adjust.dirty) { toast(T('ui.saveOrCancelYour')); return; }
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
    if ($('ed-under-who')) $('ed-under-who').onchange = syncUnderControls;
    if ($('ed-under-how')) $('ed-under-how').onchange = setUnderOnFrame;
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
    $('look-toggle').onclick = e => { e.stopPropagation(); toggleLookMenu(); };
    $('look-menu').onclick = e => e.stopPropagation();   // choosing inside the menu keeps it open
    document.querySelectorAll('#look-menu [data-look]').forEach(b => b.onclick = () => {
      if (THEME.look() === b.dataset.look) return;
      THEME.setLook(b.dataset.look); updateLookToggle(); redrawForLook();
      toast(T(b.dataset.look === 'silver' ? 'ui.lookNowSilver' : 'ui.lookNowToday'));
    });
    $('glass-toggle').onclick = () => {
      const on = !THEME.glassWanted(); THEME.setGlass(on); updateLookToggle();
      toast(T(on ? 'ui.glassNowOn' : 'ui.glassNowOff'));
    };
    document.addEventListener('click', () => toggleLookMenu(false));
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('look-menu').hidden) { toggleLookMenu(false); $('look-toggle').focus(); } });
    $('sound-toggle').onclick = (e)=>{
      const on = !FX.isSoundOn(); FX.setSound(on);
      e.currentTarget.textContent = on ? '🔊' : '🔇';
      if (on) FX.sound('whistle');
      toast(T(on ? 'ui.soundOn' : 'ui.soundOff'));
    };

    $('announce-btn').onclick = e => { e.stopPropagation(); toggleAnnouncePanel(); };
    document.addEventListener('click', () => toggleAnnouncePanel(false));

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
    $('ed-situation').onchange = (e)=>{ edit.scenario.situation=e.target.value; edit.scenario.frames=[DATA.defaultFrame(e.target.value)]; edit.idx=0; editorRender(); toast(T('ui.formationResetForSituation', { situation: DATA.sit(e.target.value).label })); };
    $('ed-phase').onchange = (e)=>{ edit.scenario.phase=e.target.value; };
    if ($('ed-visibility')) $('ed-visibility').onchange = (e)=>{ edit.scenario.visibility=e.target.value; };

    $('logout-btn').onclick = (e)=>{ e.stopPropagation(); signOutEverything(); if (typeof SHARE!=='undefined' && $('auth-share-note')) $('auth-share-note').hidden = !SHARE.fromHash(location.hash); show('auth-screen'); };
    /* The editor deliberately does NOT close on a backdrop click. A play staged from a film moment
       — positions dragged, steps captured, notes typed — is thrown away by closeEditor(), and a
       click a few pixels outside the dialog did exactly that with no warning and no undo. There
       are two explicit ways out (the ✕ and Cancel), so nothing is trapped. */
    $('editor-modal').onclick = (e)=>{ if (e.target===$('editor-modal')) toast(T('ui.editorCloseHint')); };
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
  /* After a look change, everything drawn with colour VALUES (the board and its layers, the 3D replay, the keeper's
     view, dashboards with the mascot) is redrawn — CSS alone follows the look, drawn SVG and canvas do not. */
  function redrawForLook(){
    if (!$('app-screen').classList.contains('active')) return;
    switchView(state.view);
    if (state.view === 'playbook' && state.selectedId) openScenario(state.selectedId);
    applyZones(); updateGkView(); draw3dNow();
  }
  function toggleLookMenu(force){
    const m = $('look-menu'); if (!m) return;
    m.hidden = force == null ? !m.hidden : !force;
    $('look-toggle').setAttribute('aria-expanded', m.hidden ? 'false' : 'true');
    fitMenu(m);
  }
  /* the Look menu (◐): which look is on, whether glass is on, and why glass may be unavailable — in the current language */
  function updateLookToggle(){
    const b = $('look-toggle'); if (!b || typeof THEME==='undefined') return;
    const silver = THEME.look() === 'silver', label = T('ui.lookMenu');
    b.title = label; b.setAttribute('aria-label', label);
    document.querySelectorAll('#look-menu [data-look]').forEach(o => o.setAttribute('aria-pressed', o.dataset.look === THEME.look() ? 'true' : 'false'));
    const g = $('glass-toggle'), reduced = THEME.reducedTransparency();
    g.textContent = T(THEME.glass() ? 'ui.glassOn' : 'ui.glassOff');
    g.setAttribute('aria-pressed', THEME.glass() ? 'true' : 'false');
    g.disabled = !silver || reduced;
    $('look-note').textContent = reduced ? T('ui.glassNoteReduced') : silver ? T('ui.glassNoteSilver') : T('ui.glassNoteNavy');
  }
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
    if (typeof API!=='undefined') API.forgetLegacyOverrides();   // backend URLs typed into older builds
    if (typeof I18N!=='undefined') {
      I18N.init();
      I18N.onChange(()=>{
        refreshLangSwitches();
        updateLookToggle();
        updateUserPill();
        if ($('app-screen').classList.contains('active')) {
          switchView(state.view);
          /* The pool's own markings — OFFICIAL TABLE, GOAL JUDGE, the substitution zone — are
             drawn into the SVG once, so they keep whatever language the board was built in.
             switchView only rebuilds the board when no play is open; re-open the current one
             so the markings follow the language too. */
          if (state.view === 'playbook' && state.selectedId) openScenario(state.selectedId);
        }
        if ($('setup-screen').classList.contains('active')) updatePositionBlock();
      });
    }
    wire();
    refreshLangSwitches();
    if (typeof FX!=='undefined' && $('sound-toggle')) $('sound-toggle').textContent = FX.isSoundOn() ? '🔊' : '🔇';
    if (typeof I18N!=='undefined') I18N.apply(document);
    updateLookToggle();
    // PWA: register the service worker when served over http(s)
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(()=>{});
      /* The page you are reading was served from the previous cache — that is what cache-first
         means. When a new build takes over, say so once, rather than leaving a coach on last
         week's app at a pool with no way to tell. */
      navigator.serviceWorker.addEventListener('message', e => {
        if (!e.data || e.data.type !== 'sw-updated' || swUpdateShown) return;
        swUpdateShown = true;
        const bar = document.createElement('div');
        bar.className = 'sw-update';
        bar.innerHTML = `<span>${T('ui.newVersionReady')}</span> <button class="btn-primary sm" id="sw-reload">${T('ui.reloadNow')}</button>`;
        document.body.appendChild(bar);
        bar.querySelector('#sw-reload').onclick = () => location.reload();
      });
    }
    // accounts are the server's decision: ask before offering a simulated sign-in
    if (typeof SESSION !== 'undefined') { realBoot().then(on => { if (!on) bootSimulated(); }).catch(() => bootSimulated()); return; }
    bootSimulated();
  }
  function bootSimulated() {
    const sess = loadSession();
    if (sess && sess.email) { const u = DATA.findUserByEmail(sess.email); if (u && u.role) { routeUser(u); return; } }
    if (typeof SHARE!=='undefined' && SHARE.fromHash(location.hash) && $('auth-share-note')) $('auth-share-note').hidden = false;
    show('auth-screen');
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
