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
    ['dashboard','playbook','basics','trivia','admin'].forEach(v => $('view-'+v).classList.toggle('active', v===view));
    const inPlaybook = view==='playbook';
    $('situation-tabs').style.display = inPlaybook ? '' : 'none';
    $('phase-toggle').style.display = inPlaybook ? '' : 'none';
    if (view==='dashboard') renderDashboard();
    if (view==='basics') renderBasics();
    if (view==='trivia') renderTrivia();
    if (view==='admin') renderAdmin();
    if (view==='playbook' && !state.selectedId) openFirstOrEmpty();
  }

  /* ---------------- enter app ---------------- */
  function enterApp() {
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
  function renderDashboard() {
    const v = $('view-dashboard');
    const u = state.user;
    const scn = state.scenarios;
    const acts = DATA.loadActivity();
    const card = (cls, inner) => `<div class="dash-card ${cls||''}">${inner}</div>`;
    const mascot = (typeof FX!=='undefined') ? FX.mascot(40) : '';
    let html = `<div class="dash-wrap"><div class="dash-head with-mascot">${mascot}
      <div><h1>${greeting()}, ${escapeHtml(u.name.split(' ')[0])}</h1>
      <p class="dash-sub">${roleL(u.role)}${u.position?` · Position ${u.position}`:''}</p></div></div>`;

    if (u.role === 'player') {
      const total = scn.length;
      html += `<div class="dash-grid">
        ${card('accent', `<span class="dc-k">Your position</span><span class="dc-v big">${u.position||'—'}</span><span class="dc-note">Tap “My position” in any play to see only your movement.</span>`)}
        ${card('', `<span class="dc-k">Plays to know</span><span class="dc-v big">${total}</span><span class="dc-note">across 6v6 → 1‑on‑GK, offense & defense</span>`)}
        ${card('', `<span class="dc-k">Trivia best</span><span class="dc-v big">${u.triviaBest||0}<small>/${DATA.TRIVIA.length}</small></span><button class="btn-primary sm" data-go="trivia">Take the quiz</button>`)}
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
        ${card('', `<span class="dc-k">You can</span><span class="dc-v">Record &amp; adjust</span><span class="dc-note">build movement, capture steps, edit anytime</span>`)}
      </div>
      <h3 class="dash-h3">Recent changes</h3>
      <div class="dash-list">${acts.filter(a=>a.type==='play').slice(0,6).map(activityRow).join('')||'<div class="muted">No edits yet — open the Playbook and press “+ New”.</div>'}</div>`;
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
      const options = opts.sort((a,b)=> (Number(a)-Number(b)));
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
      'Each team has <strong>7 in the water</strong>: 6 field players + 1 goalkeeper (plus subs on the bench).',
      'In this app we number the field players <strong>1–6</strong> and mark them by team colour.',
      'A common shape: perimeter players (wings, flats, point) around the arc, with a <strong>centre‑forward (“hole set”)</strong> posted at the 2 m line in front of goal.' ],
      legend:true },
    { icon:'⏱', title:'Game structure', body:[
      'Played in <strong>4 quarters</strong> (8 minutes of effective time each at senior level).',
      'A <strong>shot‑clock (~30 s)</strong> limits each possession — shoot before it expires.',
      'Teams change ends each quarter; substitutions happen on the fly through the flying‑substitution area.' ] },
    { icon:'▦', title:'The pool & its lines', body:[
      '<strong>Goal line</strong> · <strong>2 m line (red)</strong> — no attacker may sit inside it ahead of the ball.',
      '<strong>5 m line (yellow)</strong> — penalty‑throw distance. <strong>6 m line (green)</strong> — a free throw from here or beyond may be shot directly.',
      '<strong>Half‑distance line</strong> at the middle. Excluded players wait and re‑enter from the <strong>exclusion / re‑entry</strong> corner.' ] },
    { icon:'⚠', title:'Fouls & penalties', body:[
      '<strong>Ordinary (minor) fouls</strong> — pushing the ball under, two hands on the ball (field players), impeding a free player — give a <strong>free throw / change of possession</strong>.',
      '<strong>Major (exclusion) fouls</strong> — holding/sinking an opponent, persistent fouling — send the offender out for <strong>20 seconds</strong> (a “man‑up” for the other team) until a goal, change of possession, or time elapses.',
      'A major foul inside <strong>5 m</strong> that stops a likely goal is a <strong>penalty shot</strong> from the 5 m line.' ] },
    { icon:'✛', title:'The goalkeeper', body:[
      'Wears the <strong>red cap</strong> and defends the goal.',
      'Inside the 5 m area the keeper may <strong>use two hands</strong> and (where depth allows) push off the bottom — things field players can’t do.',
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
      { title:'World Aquatics Water Polo Rules', lang:'EN', category:'International playing rules', url:'https://www.worldaquatics.com/rules/competition-regulations', version:'' },
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
        <p class="dash-sub">${T('basics.sub')}</p></div>
      <div id="rules-mount"></div>
      <div class="basics-grid">
        ${BASICS.map(c=>`<div class="basics-card">
          <div class="basics-h"><span class="basics-ic">${c.icon}</span><h3>${c.title}</h3></div>
          <ul>${c.body.map(p=>`<li>${p}</li>`).join('')}</ul>
          ${c.legend?legendHtml:''}
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
  const trivia = { i:0, score:0, answered:false };
  function renderTrivia() {
    trivia.i = 0; trivia.score = 0; trivia.answered = false;
    const v = $('view-trivia');
    v.innerHTML = `<div class="trivia-wrap"><div class="trivia-card" id="trivia-card">
      <div class="trivia-intro">
        <span class="dc-k">Knowledge check</span>
        <h1>${(typeof I18N!=='undefined')?I18N.t('trivia.title'):'Water Polo Trivia'}</h1>
        <p class="dash-sub">${DATA.TRIVIA.length} questions on rules, positions & tactics. Your best score is saved to your profile.</p>
        <p class="dash-sub">Your best so far: <strong>${state.user.triviaBest||0}/${DATA.TRIVIA.length}</strong></p>
        <button class="btn-primary" id="trivia-start">${(typeof I18N!=='undefined')?I18N.t('trivia.start'):'Start quiz'}</button>
      </div></div></div>`;
    $('trivia-start').onclick = () => showQuestion();
  }
  function showQuestion() {
    const c = $('trivia-card'); const item = DATA.TRIVIA[trivia.i];
    trivia.answered = false;
    c.innerHTML = `<div class="trivia-q">
      <div class="trivia-prog">Question ${trivia.i+1} / ${DATA.TRIVIA.length} · Score ${trivia.score}</div>
      <h2>${escapeHtml(item.q)}</h2>
      <div class="trivia-opts">${item.a.map((opt,idx)=>`<button class="trivia-opt" data-idx="${idx}">${escapeHtml(opt)}</button>`).join('')}</div>
      <div class="trivia-why" id="trivia-why" hidden></div>
      <button class="btn-primary" id="trivia-next" hidden>${trivia.i===DATA.TRIVIA.length-1?'See result':'Next'}</button>
    </div>`;
    c.querySelectorAll('.trivia-opt').forEach(b => b.onclick = () => answer(parseInt(b.dataset.idx,10), item));
    $('trivia-next').onclick = () => { trivia.i++; if (trivia.i>=DATA.TRIVIA.length) finishTrivia(); else showQuestion(); };
  }
  function answer(idx, item) {
    if (trivia.answered) return; trivia.answered = true;
    const correct = idx===item.correct;
    if (correct) trivia.score++;
    document.querySelectorAll('.trivia-opt').forEach((b,i)=>{
      b.classList.add(i===item.correct?'right':(i===idx?'wrong':'mute'));
      b.disabled = true;
    });
    const why = $('trivia-why'); why.hidden=false;
    why.innerHTML = `<strong>${correct?'Correct':'Not quite'}.</strong> ${escapeHtml(item.why)}`;
    $('trivia-next').hidden = false;
  }
  function finishTrivia() {
    const total = DATA.TRIVIA.length;
    DATA.setTriviaBest(state.user.email, trivia.score);
    DATA.awardXp(state.user.email, trivia.score*10);
    if (trivia.score===total) DATA.addBadge(state.user.email, 'trivia-ace');
    DATA.logActivity('trivia', `${state.user.name} scored ${trivia.score}/${total} on trivia`, state.user.name);
    if (typeof FX!=='undefined') {
      if (trivia.score===total) FX.celebrate('Perfect!', total+'/'+total+' — Trivia Ace');
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
      <div class="admin-head"><h1>Super Admin</h1><p class="dash-sub">Approve logins, manage roles, and watch what’s happening.</p></div>

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
  function currentList() { return state.scenarios.filter(s => s.situation===state.situation && s.phase===state.phase); }

  function renderLibrary() {
    const s = DATA.sit(state.situation);
    $('library-title').textContent = s.label;
    $('library-sub').textContent = s.note + ' · ' + (state.phase==='offense'?'Offense':'Defense');
    const list = $('scenario-list'); list.innerHTML='';
    const items = currentList();
    if (items.length===0) list.innerHTML = `<div class="empty-lib">No ${state.phase} plays here yet.${canEdit()?'<br><span>Press “+ New” to build one.</span>':''}</div>`;
    items.forEach(scn => {
      const card = document.createElement('button');
      card.className='scn-card' + (scn.id===state.selectedId?' active':'');
      card.innerHTML = `
        <div class="scn-card-top">
          <span class="scn-title">${escapeHtml(scn.title||'Untitled play')}</span>
          ${scn.builtIn?'<span class="tag tag-sample">sample</span>':'<span class="tag tag-yours">saved</span>'}
        </div>
        <div class="scn-desc">${escapeHtml(scn.description||'')}</div>
        <div class="scn-meta"><span>${scn.frames.length} step${scn.frames.length>1?'s':''}</span><span>${escapeHtml(scn.author||'')}</span></div>`;
      card.onclick = () => openScenario(scn.id);
      list.appendChild(card);
    });
  }

  function openFirstOrEmpty() {
    const first = currentList()[0];
    if (first) { openScenario(first.id); return; }
    state.selectedId = null;
    if (state.viewer) { state.viewer.stop(); state.viewer = null; }
    $('controls').hidden = true; $('pool-empty').hidden = false;
    $('mode-toggle').hidden = true; $('problem-overlay').hidden = true;
    $('scenario-title').textContent = 'Select a scenario';
    $('scenario-desc').textContent = ''; $('scenario-desc').style.display = '';
    $('edit-btn').hidden = true;
    $('assign-list').innerHTML = ''; POOL.render($('pool'));
  }

  function openScenario(id) {
    const scn = state.scenarios.find(s=>s.id===id);
    if (!scn) return;
    state.selectedId = id;
    $('pool-empty').hidden = true; $('controls').hidden = false;
    $('scenario-title').textContent = scn.title || 'Untitled play';
    $('scenario-desc').textContent = scn.description || '';
    $('edit-btn').hidden = !canEdit();
    state.renderer = new ANIM.Renderer($('pool'));
    state.focus = (state.viewMode==='me') ? defaultFocus() : null;
    state.viewer = new ANIM.Player(state.renderer, scn, onViewerFrame);
    state.viewer.setOnState(playing => { $('play-btn').textContent = playing ? '❚❚' : '▶'; $('play-btn').classList.toggle('playing', playing); });
    state.viewer.setFocus(state.focus);
    syncFocusUI();
    // Problem→Solution: players start in "problem" mode, staff in "solution"
    $('mode-toggle').hidden = false;
    state.mode = (state.user.role==='player') ? 'problem' : 'solution';
    state.scenarioDesc = scn.description || '';
    applyMode();
    refreshTabs(); renderLibrary();
  }

  function setMode(mode, autoplay) {
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
      else { state.viewer.setPaths(true); }
    }
    if (problem && scn) {
      const sd = DATA.sit(scn.situation);
      $('problem-prompt').textContent = scn.phase==='defense'
        ? `${sd.label} — they have the ball. How do we defend it?`
        : `${sd.label} — we have the ball. How do we score from here?`;
    }
    if (scn) renderAssignments(scn);
  }
  function defaultFocus() {
    if (state.user.role==='player' && state.user.position) return state.user.position;
    return $('focus-pos').value || null;
  }
  function onViewerFrame(t, step, segCount) {
    $('scrub').value = Math.round(t*1000);
    const total = (segCount!=null?segCount:(state.viewer?state.viewer.segCount():0)) + 1;
    $('frame-label').textContent = `Step ${Math.min(total, step+1)} / ${total}`;
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
     EDITOR (coach / trainer / super-admin)
     ====================================================== */
  const edit = { scenario:null, idx:0, layers:null, isNew:false };

  function openEditor(scn, isNew) {
    edit.scenario = DATA.clone(scn); edit.idx = 0; edit.isNew = isNew;
    $('editor-title').textContent = isNew ? 'New scenario' : 'Edit scenario';
    $('ed-title').value = edit.scenario.title||'';
    $('ed-desc').value = edit.scenario.description||'';
    const ss = $('ed-situation'); ss.innerHTML='';
    DATA.SITUATIONS.forEach(s=>{ const o=document.createElement('option'); o.value=s.id; o.textContent=s.label; ss.appendChild(o); });
    ss.value = edit.scenario.situation;
    if (!ss.value) { ss.selectedIndex = 0; edit.scenario.situation = ss.value; edit.scenario.frames = [ DATA.defaultFrame(ss.value) ]; }
    $('ed-phase').value = edit.scenario.phase || 'offense';
    $('ed-delete').hidden = isNew;
    buildNotesGrid();
    edit.layers = POOL.render($('editor-pool'));
    editorRender();
    $('editor-modal').hidden = false;
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
    buildFrameChips(); buildCarrierSelect();
  }
  function drawEditorPaths(layers, scenario) {
    if (scenario.frames.length<2) return;
    [['att','#eafdff'],['def','#9fb2c0']].forEach(([which,col])=>{
      const sample = scenario.frames[0][which]||{};
      Object.keys(sample).forEach(pos=>{
        const pts = scenario.frames.map(fr=>fr[which]&&fr[which][pos]).filter(Boolean);
        if (pts.length<2) return;
        const moved = pts.some((p,i)=>i>0&&(Math.abs(p.x-pts[0].x)>2||Math.abs(p.y-pts[0].y)>2));
        if(!moved) return;
        const d = pts.map((p,i)=>(i?'L':'M')+p.x.toFixed(1)+' '+p.y.toFixed(1)).join(' ');
        layers.pathLayer.appendChild(POOL.svg('path',{d,fill:'none',stroke:col,'stroke-width':1.5,'stroke-dasharray':which==='att'?'5 3':'2 3','marker-end':'url(#arrow)',color:col,opacity:0.6}));
      });
    });
  }
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
  function drawEditorPathsRefresh(){
    const layers=edit.layers;
    while (layers.pathLayer.firstChild) layers.pathLayer.removeChild(layers.pathLayer.firstChild);
    drawEditorPaths(layers, edit.scenario);
  }
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
    edit.scenario.frames.splice(edit.idx+1,0,DATA.clone(currentFrame()));
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
    const i = state.scenarios.findIndex(s=>s.id===sc.id);
    if (i>=0) state.scenarios[i]=sc; else state.scenarios.push(sc);
    DATA.save(state.scenarios);
    DATA.logActivity('play', `${state.user.name} ${edit.isNew?'created':'updated'} “${sc.title}” (${sc.situation} ${sc.phase})`, state.user.name);
    state.situation=sc.situation; state.phase=sc.phase;
    closeEditor(); refreshTabs(); renderLibrary(); openScenario(sc.id);
    toast('Saved ✓');
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

    $('play-btn').onclick = ()=> state.viewer && state.viewer.toggle();
    $('step-fwd').onclick = ()=> state.viewer && state.viewer.stepFwd();
    $('step-back').onclick = ()=> state.viewer && state.viewer.stepBack();
    $('scrub').oninput = (e)=> state.viewer && state.viewer.seek(e.target.value/1000);
    $('view-team').onclick = ()=>{ state.viewMode='team'; state.focus=null; if(state.viewer)state.viewer.setFocus(null); syncFocusUI(); const s=state.scenarios.find(x=>x.id===state.selectedId); if(s)renderAssignments(s); };
    $('view-me').onclick = ()=>{ state.viewMode='me'; state.focus=defaultFocus()||(state.user.position||'1'); if(state.viewer)state.viewer.setFocus(state.focus); syncFocusUI(); const s=state.scenarios.find(x=>x.id===state.selectedId); if(s)renderAssignments(s); };
    $('focus-pos').onchange = (e)=>{ state.focus=e.target.value||null; state.viewMode=state.focus?'me':'team'; if(state.viewer)state.viewer.setFocus(state.focus); syncFocusUI(); const s=state.scenarios.find(x=>x.id===state.selectedId); if(s)renderAssignments(s); };

    document.querySelectorAll('#mode-toggle .mode-btn').forEach(b=> b.onclick=()=>setMode(b.dataset.mode, false));
    $('reveal-btn').onclick = ()=>{ setMode('solution', true); onStudied(); };
    $('sound-toggle').onclick = (e)=>{
      const on = !FX.isSoundOn(); FX.setSound(on);
      e.currentTarget.textContent = on ? '🔊' : '🔇';
      if (on) FX.sound('whistle');
      toast(on ? 'Sound on' : 'Sound off');
    };

    $('new-scenario-btn').onclick = ()=> { if(canEdit()) openEditor(DATA.newScenario(state.situation, state.phase), true); };
    $('edit-btn').onclick = ()=>{ const s=state.scenarios.find(x=>x.id===state.selectedId); if(s&&canEdit()) openEditor(s,false); };
    $('editor-close').onclick = closeEditor; $('ed-cancel').onclick = closeEditor;
    $('ed-save').onclick = saveScenario; $('ed-delete').onclick = deleteScenario;
    $('add-frame').onclick = addFrame; $('del-frame').onclick = delFrame;
    $('add-sub').onclick = ()=>addWaiting('sub'); $('add-exc').onclick = ()=>addWaiting('exc'); $('del-wait').onclick = delWaiting;
    $('ed-situation').onchange = (e)=>{ edit.scenario.situation=e.target.value; edit.scenario.frames=[DATA.defaultFrame(e.target.value)]; edit.idx=0; editorRender(); toast('Formation reset for '+DATA.sit(e.target.value).label); };
    $('ed-phase').onchange = (e)=>{ edit.scenario.phase=e.target.value; };

    $('logout-btn').onclick = (e)=>{ e.stopPropagation(); clearSession(); state.user=null; show('auth-screen'); };
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
    show('auth-screen');
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
