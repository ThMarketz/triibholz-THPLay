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
  }
  function updatePositionBlock() {
    const isPlayer = state.setup.role === 'player';
    $('position-block').style.display = isPlayer ? '' : 'none';
    $('role-note').textContent = state.setup.role === 'super-admin'
      ? 'Super Admins are provisioned directly and can approve everyone else.'
      : 'Players & staff need a Super Admin to approve access before signing in.';
    $('setup-continue').textContent = state.setup.role === 'super-admin' ? 'Enter as Super Admin' : 'Request access';
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
    state.situation='6v6'; state.phase='offense';
    state.viewMode = state.user.role==='player' ? 'me' : 'team';
    $('user-name').textContent = state.user.name;
    $('user-sub').textContent = state.user.role==='player'
      ? `Player ${state.user.position||''} · ${state.user.provider}`
      : `${DATA.roleLabel(state.user.role)} · ${state.user.provider}`;
    $('user-avatar').textContent = (state.user.name||'?').charAt(0).toUpperCase();
    const isAdmin = state.user.role==='super-admin';
    $('main-nav').querySelector('.nav-admin').hidden = !isAdmin;
    $('new-scenario-btn').style.display = canEdit() ? '' : 'none';
    buildSituationTabs();
    renderLibrary();
    show('app-screen');
    refreshAdminBadge();
    switchView('dashboard');
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
    let html = `<div class="dash-wrap"><div class="dash-head">
      <h1>${greeting()}, ${escapeHtml(u.name.split(' ')[0])}</h1>
      <p class="dash-sub">${DATA.roleLabel(u.role)}${u.position?` · Position ${u.position}`:''}</p></div>`;

    if (u.role === 'player') {
      const total = scn.length;
      html += `<div class="dash-grid">
        ${card('accent', `<span class="dc-k">Your position</span><span class="dc-v big">${u.position||'—'}</span><span class="dc-note">Tap “My position” in any play to see only your movement.</span>`)}
        ${card('', `<span class="dc-k">Plays to know</span><span class="dc-v big">${total}</span><span class="dc-note">across 6v6 → 1‑on‑GK, offense & defense</span>`)}
        ${card('', `<span class="dc-k">Trivia best</span><span class="dc-v big">${u.triviaBest||0}<small>/${DATA.TRIVIA.length}</small></span><button class="btn-primary sm" data-go="trivia">Take the quiz</button>`)}
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
    v.querySelectorAll('[data-go]').forEach(b=> b.onclick=()=>switchView(b.dataset.go));
    v.querySelectorAll('[data-open]').forEach(b=> b.onclick=()=>{ const s=state.scenarios.find(x=>x.id===b.dataset.open); if(s){ state.situation=s.situation; state.phase=s.phase; switchView('playbook'); openScenario(s.id);} });
  }
  function greeting(){ return 'Welcome'; }
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
  function renderBasics() {
    const v = $('view-basics');
    const legendHtml = `<div class="basics-legend">
        <span class="bl"><span class="bl-dot att"></span>Attack (white)</span>
        <span class="bl"><span class="bl-dot def"></span>Defence (black)</span>
        <span class="bl"><span class="bl-dot gk"></span>Goalkeeper (red)</span>
        <span class="bl"><span class="bl-dot ball"></span>Ball (orange)</span>
      </div>`;
    v.innerHTML = `<div class="dash-wrap">
      <div class="dash-head"><h1>Water polo basics</h1>
        <p class="dash-sub">The high‑level fundamentals — then jump into the Playbook to see them in motion.</p></div>
      <div class="basics-grid">
        ${BASICS.map(c=>`<div class="basics-card">
          <div class="basics-h"><span class="basics-ic">${c.icon}</span><h3>${c.title}</h3></div>
          <ul>${c.body.map(p=>`<li>${p}</li>`).join('')}</ul>
          ${c.legend?legendHtml:''}
        </div>`).join('')}
      </div>
      <div class="basics-cta">
        <button class="btn-primary sm" data-go="playbook">See it in the Playbook</button>
        <button class="btn-ghost" data-go="trivia">Test yourself with Trivia</button>
      </div>
      <p class="basics-src">Fundamentals summarised from
        <a href="https://vancouvervipers.ca/water-polo-basics/" target="_blank" rel="noopener">Vancouver Vipers — Water Polo Basics</a>,
        <a href="https://www.wikihow.com/Play-Water-Polo" target="_blank" rel="noopener">wikiHow — Play Water Polo</a>,
        and World Aquatics rules. Details vary by level/governing body.</p>
    </div>`;
    v.querySelectorAll('[data-go]').forEach(b=> b.onclick=()=>switchView(b.dataset.go));
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
        <h1>Water Polo Trivia</h1>
        <p class="dash-sub">${DATA.TRIVIA.length} questions on rules, positions & tactics. Your best score is saved to your profile.</p>
        <p class="dash-sub">Your best so far: <strong>${state.user.triviaBest||0}/${DATA.TRIVIA.length}</strong></p>
        <button class="btn-primary" id="trivia-start">Start quiz</button>
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
    state.user = DATA.findUserByEmail(state.user.email);
    DATA.logActivity('trivia', `${state.user.name} scored ${trivia.score}/${total} on trivia`, state.user.name);
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
    $('ed-phase').value = edit.scenario.phase;
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

  /* ---------------- wire events ---------------- */
  function wire() {
    $('signin-apple').onclick  = (e)=> simulateSignIn('apple', e.currentTarget);
    $('signin-google').onclick = (e)=> simulateSignIn('google', e.currentTarget);

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
    $('reveal-btn').onclick = ()=> setMode('solution', true);

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

  function boot() {
    wire();
    const sess = loadSession();
    if (sess && sess.email) { const u = DATA.findUserByEmail(sess.email); if (u && u.role) { routeUser(u); return; } }
    show('auth-screen');
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
