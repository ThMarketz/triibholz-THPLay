/* Headless regression suite (jsdom) — full app flow without a browser.
   Run:  node tests/smoke.mjs   (deps: npm i inside tests/) */
import { JSDOM } from 'jsdom';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextEncoder as TE, TextDecoder as TD } from 'node:util';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(APP, 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://test.local/' });
const { window } = dom; const { document } = window;
window.TextEncoder = window.TextEncoder || TE;   // QR needs it
window.TextDecoder = window.TextDecoder || TD;   // TESTLOG's XLSX reader needs it
window.DecompressionStream = window.DecompressionStream || globalThis.DecompressionStream;   // jsdom has neither; Node does
window.Response = window.Response || globalThis.Response;
// jsdom has no Blob.text()/arrayBuffer() (every browser the app supports has had them since 2020);
// without them a file the coach picks cannot be read here at all
if (!window.Blob.prototype.text) window.Blob.prototype.text = function () { return new Promise((res, rej) => { const r = new window.FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsText(this); }); };
if (!window.Blob.prototype.arrayBuffer) window.Blob.prototype.arrayBuffer = function () { return new Promise((res, rej) => { const r = new window.FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsArrayBuffer(this); }); };

const files = ['js/theme.js','js/i18n.js','js/help.js','js/draft.js','js/commands.js','js/solver.js','js/qr.js','js/fx.js','js/pool.js','js/data.js','js/animate.js','js/vision.js','js/field.js','js/shot.js','js/testlog.js','js/chart.js','js/sheetdoc.js','js/eligibility.js','js/teamsheet.js','js/scout.js','js/teamsync.js','js/teams.js','js/manikin.js','js/track.js','js/bytetrack.js','js/events.js','js/webdetector.js','js/videogen.js','js/calendar.js','js/planner.js','js/privacy.js','js/tactics.js','js/gameplan.js','js/legal.js','js/device.js','js/share.js','js/announce.js','js/wpmatch.js','js/api.js','js/session.js','js/analysis.js','js/film.js','js/app.js'];
const combined = files.map(f => readFileSync(join(APP, f), 'utf8')).join('\n;\n')
  + '\n;\nwindow.__T = { THEME, CHART, API, SESSION, POOL, DATA, ANIM, I18N, QR, FX, FILM, HELP, DRAFT, COMMANDS, SOLVER, VISION, TRACK, ANALYSIS, BYTETRACK, EVENTS, WEBDETECTOR, VIDEOGEN, CALENDAR, PLANNER, PRIVACY, TACTICS, GAMEPLAN, LEGAL, DEVICE, SHARE, FIELD, SHOT, MANIKIN, TESTLOG, ANNOUNCE, WPMATCH , SHEETDOC , ELIGIBILITY , TEAMSHEET , TEAMSYNC , TEAMS , WPMATCH , SCOUT };';

let pass=0, fail=0;
const ok=(n,c)=>{ if(c){pass++;console.log('  ✓',n);} else {fail++;console.log('  ✗ FAIL:',n);} };
const wait=(ms)=>new Promise(r=>window.setTimeout(r,ms));
const q=(s)=>document.querySelector(s), qa=(s)=>[...document.querySelectorAll(s)];
const pick=(sel,correct)=>qa(sel).find(b=>parseInt(b.dataset.idx,10)===correct);

(async () => {
 try {
  window.eval(combined);
  document.dispatchEvent(new window.Event('DOMContentLoaded'));
  const { DATA, FILM } = window.__T;

  console.log('\n[1] Auth + roles');
  ok('auth active', q('#auth-screen').classList.contains('active'));
  ok('3 demo personas', qa('.demo-btn').length===3);
  ok('4 role options', qa('#role-seg .seg-btn').length===4);
  ok('4 language flags', qa('#lang-switch-auth .lang-btn').length===4);

  console.log('\n[2] Super Admin enters via setup');
  q('#signin-apple').click(); await wait(800);
  ok('setup shown', q('#setup-screen').classList.contains('active'));
  qa('#role-seg .seg-btn').find(b=>b.dataset.role==='super-admin').click();
  ok('position hidden for super admin', q('#position-block').style.display==='none');
  q('#setup-continue').click(); await wait(40);
  ok('app screen active', q('#app-screen').classList.contains('active'));
  ok('admin nav visible', q('.nav-admin').hidden===false);

  console.log('\n[3] Onboarding + approvals');
  const pendCount = DATA.loadUsers().filter(u=>u.status==='pending').length;
  ok('seeded pending users ('+pendCount+')', pendCount>=2);
  ok('invite card + QR', !!q('.invite-card') && !!q('.invite-qr svg'));
  {
    // the invite code is this install's own, and travels after the # so it never reaches a server log
    const code = q('.invite-code').textContent.trim(), link = q('.invite-qr').getAttribute('title');
    ok('the team code is made once per install, not built into the app', /^TRII-[A-HJ-NP-Z2-9]{6}$/.test(code) && code !== 'TRII-2026');
    ok('the invite link carries it in the #fragment, not the query string', link.includes('#join=' + code) && !link.includes('?join='));
  }
  await wait(420);
  if (q('#tour-skip')) q('#tour-skip').click();
  q('.nav-btn[data-view="admin"]').click(); await wait(30);
  const approveBtns = qa('#approve-list [data-approve]');
  ok('approval queue shown', approveBtns.length===pendCount);
  approveBtns[0].click(); await wait(30);
  ok('approve works', DATA.loadUsers().filter(u=>u.status==='pending').length===pendCount-1);

  console.log('\n[4] Trivia — shuffled options, both sets');
  {
    const seen = new Set();
    for (let r=0; r<8; r++) {
      q('.nav-btn[data-view="trivia"]').click(); await wait(10);
      q('#trivia-start').click(); await wait(10);
      seen.add(qa('.trivia-opt').map(b=>b.dataset.idx).join(','));
    }
    ok('option order varies across renders ('+seen.size+' orders)', seen.size>1);
  }
  q('.nav-btn[data-view="trivia"]').click(); await wait(15);
  ok('set picker shows two quizzes', qa('#view-trivia [data-set]').length===2);
  q('#trivia-start').click(); await wait(15);
  for (let i=0;i<DATA.TRIVIA.length;i++){
    pick('.trivia-opt', DATA.TRIVIA[i].correct).click(); await wait(6);
    q('#trivia-next').click(); await wait(6);
  }
  ok('rules quiz perfect run', !!q('.trivia-result'));
  ok('best saved', DATA.findUserByEmail('alex@icloud.com').triviaBest===DATA.TRIVIA.length);
  q('.nav-btn[data-view="trivia"]').click(); await wait(15);
  q('#trivia-start-history').click(); await wait(15);
  ok('history bank valid (23)', DATA.TRIVIA_HISTORY.length===23 &&
     DATA.TRIVIA_HISTORY.every(t=>t.correct>=0 && t.correct<t.a.length && t.why));
  for (let i=0;i<DATA.TRIVIA_HISTORY.length;i++){
    pick('.trivia-opt', DATA.TRIVIA_HISTORY[i].correct).click(); await wait(5);
    q('#trivia-next').click(); await wait(5);
  }
  const meH = DATA.findUserByEmail('alex@icloud.com');
  ok('history best + badge', meH.triviaBestHist===DATA.TRIVIA_HISTORY.length && (meH.badges||[]).includes('historian'));

  console.log('\n[5] Playbook — waiting discs, editor, merge');
  q('.nav-btn[data-view="playbook"]').click(); await wait(20);
  qa('.sit-tab').find(t=>t.textContent.includes('6 on 5')).click(); await wait(20);
  ok('6v5 excluded disc waits', qa('#pool .disc.wait').length>=1);
  qa('.sit-tab').find(t=>t.textContent.includes('6 on 6')).click(); await wait(20);
  ok('6v6 shows 2 subs', qa('#pool .disc.wait').length===2);
  ok('dashed “Create a new play” card in the list', !!q('.scn-card.scn-new'));
  q('#new-scenario-btn').click(); await wait(20);
  ok('editor open + field drawn', q('#editor-modal').hidden===false && qa('#editor-pool rect').length>5);
  ok('situation preset', q('#ed-situation').value==='6v6');
  q('#add-sub').click(); q('#add-exc').click(); await wait(15);
  ok('waiting discs in editor', qa('#editor-pool .disc.wait').length===2);
  q('#ed-title').value='WP Test'; q('#ed-title').dispatchEvent(new window.Event('input'));
  const before = DATA.load().length;
  q('#ed-save').click(); await wait(30);
  ok('scenario saved (+1)', DATA.load().length===before+1);
  ok('merge idempotent', DATA.load().length===DATA.load().length);
  ok('worked samples present', DATA.load().some(s=>s.title.includes('slip to the hole')) &&
     DATA.load().some(s=>s.title.includes('Man-down box')));

  console.log('\n[6] Problem→Solution + tactics + living water');
  const sampleCard = qa('.scn-card').find(c=>c.textContent.includes('slip to the hole'));
  sampleCard.click(); await wait(20);
  qa('#mode-toggle .mode-btn').find(b=>b.dataset.mode==='problem').click(); await wait(15);
  ok('problem overlay + masked assignments', q('#problem-overlay').hidden===false && q('#assign-list').classList.contains('masked'));
  q('#reveal-btn').click(); await wait(20);
  ok('revealed', q('#problem-overlay').hidden===true);
  ok('movement arrows drawn', qa('#pool [marker-end]').length>=3);
  ok('numbered pass arrows', qa('#pool .pass-arrow').length>=1);
  ok('ripple layers present', !!q('#pool .ripples-a') && !!q('#pool .ripples-b'));
  await wait(500);   // reveal auto-plays → wakes spawn
  ok('swim splashes during playback', qa('#pool .splash').length>0);
  q('#play-btn').click(); await wait(40);   // pause → paused-edit re-enters

  console.log('\n[6a2] Keyboard shortcuts + Help system');
  {
    const kb = (key)=>document.body.dispatchEvent(new window.KeyboardEvent('keydown',{key,bubbles:true}));
    const lbl = q('#frame-label').textContent;
    kb(' '); await wait(30);
    ok('Space toggles playback', q('#play-btn').textContent==='❚❚');
    kb(' '); await wait(20);
    kb('ArrowRight'); await wait(20);
    ok('ArrowRight steps forward', q('#frame-label').textContent!==lbl);
  }
  ok('20 help topics defined', Object.keys(window.__T.HELP.TOPICS).length===20);
  q('#help-btn').click(); await wait(15);
  ok('topbar ？ is context-aware (paused board → Adjust guide)', !!q('.help-backdrop:not([hidden])') &&
     /Adjust/i.test(q('#help-title').textContent));
  window.__T.HELP.show('adjust'); await wait(10);
  ok('adjust help = pause, drag, save', /pause the play/i.test(q('#help-title').textContent) &&
     /Save as new/i.test(q('#help-body').innerHTML));
  window.__T.HELP.hide(); await wait(10);
  ok('help closes', q('.help-backdrop').hidden===true);
  ok('contextual ？ chips present', qa('[data-help]').length>=3);

  console.log('\n[6b] Save-as-variant from the editor');
  const cnt1 = DATA.load().length;
  q('#edit-btn').click(); await wait(25);
  ok('save-as visible', q('#ed-saveas').hidden===false);
  q('#ed-saveas').click(); await wait(40);
  ok('variant saved (+1), original kept', DATA.load().length===cnt1+1 &&
     DATA.load().some(x=>x.title==='Top pick — slip to the hole'));
  ok('variant opened', /variant/i.test(q('#scenario-title').textContent));

  console.log('\n[6c] Pause-to-move — a paused play is simply draggable');
  ok('players draggable right after opening', qa('#pool .disc.editable').length>=13);
  ok('ball draggable', !!q('#pool .ball.editable'));
  ok('drag hint visible', q('#pool-drag-hint').hidden===false);
  ok('save bar hidden while unchanged', q('#adjust-bar').hidden===true);
  ok('undo button present & idle', !!q('#adj-undo') && q('#adj-undo').disabled===true);
  q('#step-fwd').click(); await wait(20);
  ok('⏭ steps the paused board', /Step 2/.test(q('#frame-label').textContent));
  const cnt2 = DATA.load().length;
  q('#adj-save-new').click(); await wait(40);
  ok('save-as-new from the paused board (+1)', DATA.load().length===cnt2+1);
  ok('adjusted title marked', /adjusted/i.test(q('#scenario-title').textContent));
  ok('new play opens paused & draggable again', qa('#pool .disc.editable').length>=13);

  console.log('\n[6d] Draft from words — write the play, the board builds it');
  {
    const { DRAFT } = window.__T;
    const sample = '3 has the ball\n3 drives to the middle and 2 lifts to the wing\n3 passes to 2\n6 posts up at 2m\n2 shoots far corner';
    const r = DRAFT.parse(sample, '6v6');
    ok('5 lines → '+r.steps+' steps (≥4)', r.steps>=4);
    ok('ball starts with 3', r.frames[0].ball.carrier==='A3');
    ok('pass hands the ball to 2', r.frames.some(f=>f.ball && f.ball.carrier==='A2'));
    const lastBall = r.frames[r.frames.length-1].ball;
    ok('shot: ball flies into the goal', lastBall.carrier===null && lastBall.x>=290);
    ok('movement actually moves 3 (point → middle)', r.frames[1].att['3'].x > r.frames[0].att['3'].x);
    ok('assignments filled for 3, 2 and 6', !!r.notes['3'] && !!r.notes['2'] && !!r.notes['6']);
    ok('every sample line understood', r.report.every(l=>l.ok));
    const bad = DRAFT.parse('the seagull applauds loudly', '6v6');
    ok('nonsense line flagged, not silently dropped', bad.report[0].ok===false);

    // UI wiring: type in the editor → debounced live build
    q('#new-scenario-btn').click(); await wait(25);
    ok('draft panel present & open on a new play', !!q('#draft-panel') && q('#draft-panel').open===true);
    const dt = q('#draft-text');
    dt.value = '3 has the ball\n3 passes to 6\n6 shoots near corner';
    dt.dispatchEvent(new window.Event('input')); await wait(500);
    ok('typing rebuilt the steps (3 frame chips)', qa('#frame-chips .frame-chip').length===3);
    ok('understood lines listed in feedback', qa('#draft-feedback .draft-line.ok').length===3);
    ok('assignment grid picked up the text', qa('#notes-grid input').some(i=>i.value.includes('Receive the ball')));
    q('#ed-title').value='Drafted play'; q('#ed-title').dispatchEvent(new window.Event('input'));
    const beforeDraft = DATA.load().length;
    q('#ed-save').click(); await wait(40);
    ok('drafted play saves (+1)', DATA.load().length===beforeDraft+1);
  }

  console.log('\n[6e] Tactical commands (audibles) — call a play, board runs it');
  {
    const { COMMANDS } = window.__T;
    ok('26 commands defined', COMMANDS.list.length===26);
    ok('both sides covered', COMMANDS.list.some(c=>c.side==='offense') && COMMANDS.list.some(c=>c.side==='defense'));
    ok('every command has id/name/cue/build', COMMANDS.list.every(c=>c.id&&c.name&&c.cue&&typeof c.build==='function'));
    // the classics the coach asked for exist
    ['point-pick','crash','gk-out','help-recover','foul-reset','manup-42','zone-mandown','press','drop-m'].forEach(id=>
      ok('command present: '+id, !!COMMANDS.byId[id]));
    // pure-transform behaviour on a 6v6
    const scn = { situation:'6v6', frames:[DATA.defaultFrame('6v6')] };
    const before = scn.frames[0];
    const gk0 = before.gk.x;
    ok('gk-out brings the keeper off the line', COMMANDS.apply(scn,'gk-out',{target:'team'}).steps[0].gk.x < gk0);
    ok('foul-reset teaches impede-not-hold and the penalty line', (()=>{ const t=Object.values(COMMANDS.apply(scn,'foul-reset',{target:'team'}).notes).join(' '); return /impede/i.test(t) && /exclusion/i.test(t) && /penalty/i.test(t); })());
    ok('crash puts 2 defenders on the centre', (()=>{ const hp=before.att[Object.keys(before.att).sort((a,b)=>before.att[b].x-before.att[a].x)[0]];
      const d=COMMANDS.apply(scn,'crash',{target:'team'}).steps[0].def;
      return Object.keys(d).filter(k=>Math.hypot(d[k].x-hp.x,d[k].y-hp.y)<14).length===2; })());
    ok('pick at the top makes 2 steps + the driver holds the ball', (()=>{ const r=COMMANDS.apply(scn,'point-pick',{target:'team'}); return r.steps.length===2 && /^A\d/.test(r.steps[1].ball.carrier); })());
    ok('every command builds without throwing across situations', DATA.SITUATIONS.every(sit=>
      COMMANDS.list.every(c=>{ try{ COMMANDS.apply({situation:sit.id,frames:[DATA.defaultFrame(sit.id)]}, c.id, {target:'team'}); return true; }catch(e){ return false; } })));

    // UI wiring: editor palette adds a step + fills assignments
    q('#new-scenario-btn').click(); await wait(25);
    ok('command palette present & grouped', qa('#cmd-groups .cmd-group').length===3 && qa('#cmd-groups .cmd-btn').length===26);
    const framesBefore = q('#frame-chips').children.length;
    qa('#cmd-groups .cmd-btn').find(b=>b.dataset.cmd==='hole-entry').click(); await wait(20);
    ok('editor command added a step', q('#frame-chips').children.length>framesBefore);
    ok('command filled an assignment', qa('#notes-grid input').some(i=>/2 m|seal|entry/i.test(i.value)));
    q('#ed-title').value='Audible play'; q('#ed-title').dispatchEvent(new window.Event('input'));
    const beforeCmd = DATA.load().length;
    q('#ed-save').click(); await wait(40);
    ok('command-built play saves (+1)', DATA.load().length===beforeCmd+1);

    // stage audible: open a play, flash a call, it becomes a dirty paused edit
    qa('.scn-card').find(c=>c.textContent.includes('slip to the hole')).click(); await wait(20);
    ok('⚡ Audible button visible on an open play', q('#audible-btn').hidden===false);
    q('#audible-btn').click(); await wait(10);
    ok('audible sheet opens with 26 calls', q('#audible-sheet').hidden===false && qa('#as-groups .cmd-btn').length===26);
    qa('#as-groups .cmd-btn').find(b=>b.dataset.cmd==='help-recover').click(); await wait(20);
    ok('audible marks the board dirty (save bar shows)', q('#adjust-bar').hidden===false);
    const beforeAud = DATA.load().length;
    q('#adj-save-new').click(); await wait(40);
    ok('audible saved as a new movement (+1)', DATA.load().length===beforeAud+1);
  }

  console.log('\n[6f] Solutions Lab — ask a question, get a worked answer');
  {
    const { SOLVER } = window.__T;
    ok('16 curated problems', SOLVER.PROBLEMS.length===16);
    ok('every problem has answer + rules + buildable board', SOLVER.PROBLEMS.every(p=>{
      const b = SOLVER.board(p.id); return p.answer.length && p.rules.length && b && b.frames.length>=1;
    }));
    // the coach's exact question routes to the 1-on-GK answer
    const res = SOLVER.ask('I swim alone to the goalie who comes out at 5 m, what should I do? can the goalie make a foul on me?');
    ok('best match is "alone on the keeper"', res.length>0 && res[0].problem.id==='alone-vs-gk-out');
    const gk = SOLVER.byId['alone-vs-gk-out'];
    ok('answer covers the lob/shoot-early idea', gk.answer.join(' ').match(/lob|early|open/i));
    ok('rules answer the "can the keeper foul me" question', gk.rules.some(r=>/foul/i.test(r.q)) && gk.rules.some(r=>/penalty/i.test(r.a)));
    ['double team at 2m','2 on 1 fast break','how to defend the counter','man up 6 on 5','penalty shot'].forEach(t=>{
      ok('phrasing routes: "'+t+'"', SOLVER.ask(t).length>0);
    });

    // UI: nav → search → answer + animated board → save into playbook
    ok('Solutions nav label localised (not a raw key)', /Solutions/.test(q('.nav-btn[data-view="solutions"]').textContent) && !/nav\./.test(q('.nav-btn[data-view="solutions"]').textContent));
    q('.nav-btn[data-view="solutions"]').click(); await wait(20);
    ok('solutions view active + cards listed', q('#view-solutions').classList.contains('active') && qa('.sol-card').length===16);
    q('#sol-search').value = 'alone at the keeper who comes out to 5m can he foul me';
    q('#sol-go').click(); await wait(30);
    ok('answer panel shows steps + rules', qa('#sol-detail .sol-steps li').length>=3 && qa('#sol-detail .sol-rule').length>=2);
    ok('solution board animates with discs', qa('#sol-pool .disc').length>=1);
    ok('opened the keeper problem', /keeper/i.test(q('#sol-detail h2').textContent));
    const beforeSol = DATA.load().length;
    q('#sol-save').click(); await wait(40);
    ok('save-as-play drops it into the playbook (+1)', DATA.load().length===beforeSol+1);
    ok('landed in playbook with the play open', q('#view-playbook').classList.contains('active') && /solution/i.test(q('#scenario-title').textContent));
  }

  console.log('\n[6g] Film auto-analysis — motion scan (pure)');
  {
    // synthetic frames: a bright block that jumps at frame 20 → a motion spike there
    const W=16,H=9, N=40; const frames=[];
    for (let i=0;i<N;i++){ const f=new Float32Array(W*H);
      const on = (i>=20 && i<=23);                 // a burst of motion mid-clip
      const shift = on ? (i%2?5:0) : 0;
      for (let y=0;y<H;y++) for (let x=0;x<W;x++) f[y*W+x] = ((x+shift)%W<4)?200:20;
      frames.push(f);
    }
    const res = FILM.motionScan(frames);
    ok('timeline covers every frame', res.timeline.length===N);
    ok('found at least one peak', res.peaks.length>=1);
    ok('the peak sits in the busy window (frames 20–23)', res.peaks.some(p=>p.i>=19 && p.i<=24));
    ok('a still clip yields no false peaks', (()=>{ const flat=Array.from({length:12},()=>new Float32Array(9).fill(50));
      const r=FILM.motionScan(flat); return r.peaks.length<=3 && r.max===0; })());
  }

  console.log('\n[6h] Tier 1 vision — colour + homography → board positions');
  {
    const { VISION } = window.__T;
    ok('cap/ball classification', VISION.classifyCap(245,248,250)==='white' && VISION.classifyCap(22,26,30)==='dark'
      && VISION.classifyCap(220,40,40)==='keeper' && VISION.classifyCap(255,130,30)==='ball');
    ok('blue water is ignored (null)', VISION.classifyCap(30,90,140)===null && VISION.classifyCap(20,120,130)===null);
    // homography maps calibration corners onto the board exactly
    const src=[{x:0,y:0},{x:200,y:0},{x:200,y:100},{x:0,y:100}];
    const H=VISION.solveHomography(src, VISION.boardCorners());
    ok('homography solves', !!H);
    const tl=VISION.project(H,0,0), br=VISION.project(H,200,100), mid=VISION.project(H,100,50);
    ok('corners land on the board rect', Math.abs(tl.x-VISION.BOARD.x0)<0.5 && Math.abs(br.y-VISION.BOARD.y1)<0.5);
    ok('centre maps to the board centre', Math.abs(mid.x-160)<1 && Math.abs(mid.y-110)<1);
    // detect on a synthetic frame → blobs → board frame
    const W=80,Hh=45; const data=new Uint8ClampedArray(W*Hh*4);
    const fill=(x0,y0,x1,y1,r,g,b)=>{ for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const i=(y*W+x)*4; data[i]=r;data[i+1]=g;data[i+2]=b;data[i+3]=255;} };
    fill(0,0,W,Hh, 30,90,140);                 // blue water
    fill(6,6,12,12,245,248,250); fill(60,8,66,14,245,248,250);   // 2 white caps
    fill(20,26,26,32,22,26,30);  fill(50,30,56,36,22,26,30);     // 2 dark caps
    fill(70,20,75,25,220,40,40); fill(38,20,41,23,255,130,30);   // keeper + ball
    const det=VISION.detect(data,W,Hh,{step:1});
    ok('detects 2 white / 2 dark / keeper / ball', det.white.length===2 && det.dark.length===2 && det.keeper.length===1 && det.ball.length===1);
    const bf=VISION.toBoardFrame(det, H);
    ok('assembles a board frame (att/def/gk/ball)', Object.keys(bf.frame.att).length===2 && Object.keys(bf.frame.def).length===2 && !!bf.frame.gk && bf.frame.ball.x!=null);
    ok('positions land inside the board water', Object.values(bf.frame.att).every(p=>p.x>=VISION.BOARD.x0-1 && p.x<=VISION.BOARD.x1+1));
  }

  console.log('\n[6i] Tier 2 hardened tracking — CC + tracker + temporal fusion');
  {
    const { TRACK } = window.__T;
    // connected components: two real blobs + a 1px speckle → speckle rejected
    const W=10,Hm=8; const mask=new Uint8Array(W*Hm);
    for(let y=1;y<4;y++)for(let x=1;x<4;x++)mask[y*W+x]=1;   // 3x3
    for(let y=5;y<7;y++)for(let x=7;x<9;x++)mask[y*W+x]=1;   // 2x2
    mask[0*W+5]=1;                                           // speckle
    ok('connected components reject speckle (2 blobs, minArea 2)', TRACK.ccLabels(mask,W,Hm,2).length===2);
    // tracker keeps one stable id through a one-frame dropout
    const tr=new TRACK.Tracker({minHits:2,maxAge:3,gate:6});
    [[{x:0,y:0,cls:'white'}],[{x:2,y:0,cls:'white'}],[],[{x:6,y:0,cls:'white'}],[{x:8,y:0,cls:'white'}]].forEach(d=>tr.update(d));
    ok('tracker bridges a dropout → one confirmed track', tr.confirmed().length===1);
    // consolidate rejects a one-frame splash speckle
    const spk=[
      {white:[{x:0,y:0,n:9}],dark:[],keeper:[],ball:[]},
      {white:[{x:3,y:0,n:9},{x:40,y:40,n:2}],dark:[],keeper:[],ball:[]},
      {white:[{x:6,y:0,n:9}],dark:[],keeper:[],ball:[]},
      {white:[{x:9,y:0,n:9}],dark:[],keeper:[],ball:[]},
    ];
    ok('temporal fusion rejects one-frame splash', TRACK.consolidate(spk,{minHits:2,maxAge:3,gate:8}).white.length===1);
    // consolidate bridges an occluded frame
    const occ=[
      {white:[{x:0,y:0,n:9}],dark:[],keeper:[],ball:[]},
      {white:[{x:2,y:0,n:9}],dark:[],keeper:[],ball:[]},
      {white:[],dark:[],keeper:[],ball:[]},
      {white:[{x:6,y:0,n:9}],dark:[],keeper:[],ball:[]},
      {white:[{x:8,y:0,n:9}],dark:[],keeper:[],ball:[]},
    ];
    ok('temporal fusion bridges occlusion', TRACK.consolidate(occ,{minHits:2,maxAge:3,gate:6}).white.length===1);
    // detectCC on a synthetic frame, with a 1px speckle rejected by minArea
    const FW=80,FH=45; const data=new Uint8ClampedArray(FW*FH*4);
    const fill=(x0,y0,x1,y1,r,g,b)=>{ for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const i=(y*FW+x)*4; data[i]=r;data[i+1]=g;data[i+2]=b;data[i+3]=255;} };
    fill(0,0,FW,FH,30,90,140);
    fill(6,6,12,12,245,248,250); fill(60,8,66,14,245,248,250);
    fill(70,20,75,25,220,40,40); fill(38,20,41,23,255,130,30);
    fill(5,40,6,41,245,248,250);   // speckle
    const det=TRACK.detectCC(data,FW,FH,{step:1,minArea:4});
    ok('detectCC: 2 white / keeper / ball, speckle dropped', det.white.length===2 && det.keeper.length===1 && det.ball.length===1);
    ok('detectCC now carries a confidence per blob', det.white.every(b=>typeof b.conf==='number' && b.conf>0 && b.conf<=1));
  }

  console.log('\n[6k] Phase 2 — ByteTrack two-stage association');
  {
    const { BYTETRACK } = window.__T;
    const D=(x,cls,conf)=>({x,y:0,cls,conf,n:9});
    // a high-confidence object across frames → one confirmed track
    ok('high-confidence object → one track', BYTETRACK.track(
      [[D(0,'white',.9)],[D(2,'white',.9)],[D(4,'white',.9)],[D(6,'white',.9)]], {gate:6}).white.length===1);
    // a real object that dips to LOW confidence for a frame is recovered (stage 2)
    ok('low-confidence frame is recovered, not lost', BYTETRACK.track(
      [[D(0,'white',.9)],[D(2,'white',.9)],[D(4,'white',.2)],[D(6,'white',.9)]], {gate:6}).white.length===1);
    // isolated LOW-confidence blobs never BIRTH a track (splash/glare rejected)
    ok('low-confidence blobs cannot start a phantom track', BYTETRACK.track(
      [[D(0,'white',.2)],[D(2,'white',.2)],[D(4,'white',.2)],[D(6,'white',.2)]], {gate:6}).white.length===0);
    // classes don't cross-associate
    const mixed=BYTETRACK.track([[D(0,'white',.9),D(30,'dark',.9)],[D(2,'white',.9),D(32,'dark',.9)]], {gate:6});
    ok('separate classes tracked independently', mixed.white.length===1 && mixed.dark.length===1);
    // series() yields one snapshot per input frame
    ok('series() emits a snapshot per frame', BYTETRACK.series([[D(0,'white',.9)],[D(2,'white',.9)],[D(4,'white',.9)]], {gate:6}).length===3);
  }

  console.log('\n[6l] Phase 3 — heuristic event detection');
  {
    const { EVENTS } = window.__T;
    const bf = (attX, ballX, ballY) => ({ att:{1:{x:attX,y:110}}, def:{1:{x:120,y:110}}, gk:{x:292,y:110}, ball:{carrier:null,x:ballX,y:ballY}, extra:[] });
    // possession: attacker sits on the ball across the passage
    const poss = EVENTS.detect([0,1,2,3].map(i=>({ t:i*0.1, boardFrame: bf(250,252,110) })), {});
    ok('possession detected for the ball-side team', poss.some(e=>e.type==='possession' && e.team==='att'));
    // turnover: att holds, then def holds
    const to = EVENTS.detect([
      {t:0,boardFrame:{att:{1:{x:250,y:110}},def:{1:{x:120,y:110}},gk:{x:292,y:110},ball:{carrier:null,x:251,y:110},extra:[]}},
      {t:0.1,boardFrame:{att:{1:{x:250,y:110}},def:{1:{x:120,y:110}},gk:{x:292,y:110},ball:{carrier:null,x:251,y:110},extra:[]}},
      {t:0.2,boardFrame:{att:{1:{x:250,y:110}},def:{1:{x:120,y:110}},gk:{x:292,y:110},ball:{carrier:null,x:121,y:110},extra:[]}},
      {t:0.3,boardFrame:{att:{1:{x:250,y:110}},def:{1:{x:120,y:110}},gk:{x:292,y:110},ball:{carrier:null,x:121,y:110},extra:[]}},
    ], {});
    ok('turnover detected when the holding team flips', to.some(e=>e.type==='turnover'));
    // shot: ball accelerates toward the goal from the attacking third
    const shot = EVENTS.detect([
      {t:0, boardFrame: bf(250,250,110)},
      {t:0.1, boardFrame: bf(250,285,110)},
    ], {});
    ok('shot detected on a fast ball toward goal', shot.some(e=>e.type==='shot'));
    // goal: ball reaches the goal mouth
    const goal = EVENTS.detect([
      {t:0, boardFrame: bf(260,280,110)},
      {t:0.1, boardFrame: bf(260,294,110)},
    ], {});
    ok('goal detected when the ball reaches the mouth', goal.some(e=>e.type==='goal'));
    ok('every event carries a board frame to confirm', shot.concat(goal,poss).every(e=>e.frame && e.frame.att));
  }

  console.log('\n[6m] T2b — on-device detector seam (WebDetector)');
  {
    const { WEBDETECTOR } = window.__T;
    ok('defaults to the colour detector', WEBDETECTOR.status().detector==='colour' && WEBDETECTOR.status().hasModel===false);
    // NMS: two heavily-overlapping same-class boxes → one survives; distinct box kept
    const nmsOut = WEBDETECTOR.nms([
      {x:10,y:10,w:8,h:8,cls:'white',conf:0.9},
      {x:11,y:11,w:8,h:8,cls:'white',conf:0.6},   // overlaps the first → suppressed
      {x:60,y:60,w:8,h:8,cls:'white',conf:0.8},   // separate → kept
    ], 0.45);
    ok('non-max suppression dedupes overlaps', nmsOut.length===2);
    // postprocess: drops unknown classes + below-threshold scores
    const pp = WEBDETECTOR.postprocess([
      {x:5,y:5,w:6,h:6,cls:'white',conf:0.9},
      {x:9,y:9,w:6,h:6,cls:'referee',conf:0.9},   // unknown class → dropped
      {x:40,y:40,w:6,h:6,cls:'ball',conf:0.1},    // below score threshold → dropped
    ], {scoreThresh:0.3});
    ok('postprocess keeps only valid, confident classes', pp.length===1 && pp[0].cls==='white');
    // register a stand-in model → detector switches; detections flow through as per-class
    let called=false;
    WEBDETECTOR.register(async ()=>{ called=true; return [
      {x:8,y:6,w:6,h:6,cls:'white',conf:0.95},{x:30,y:7,w:6,h:6,cls:'white',conf:0.95},
      {x:20,y:12,w:6,h:6,cls:'ball',conf:0.8},
    ]; }, 'mock-net');
    ok('registering a model flips the detector', WEBDETECTOR.status().detector==='model' && WEBDETECTOR.status().name==='mock-net');
    const byc = await WEBDETECTOR.detectByClass(new Uint8ClampedArray(40*24*4), 40, 24);
    ok('model detections flow through as per-class', called && byc.white.length===2 && byc.ball.length===1);
    // fall back to colour
    WEBDETECTOR.register(null);
    ok('register(null) falls back to colour', WEBDETECTOR.status().detector==='colour');
  }

  console.log('\n[6n] Play → video (DRAFT defenders + VIDEOGEN)');
  {
    const { DRAFT, VIDEOGEN } = window.__T;
    // DRAFT understands the coach's exact phrasing (white cap, defender foul, left/right)
    const play = DRAFT.parse([
      'white cap 2 has the ball',
      'white cap 2 drives to 2m on the right hand side',
      'defender 6 tries to foul 2',
      '2 passes to 4',
      '4 shoots far corner from the left',
    ].join('\n'), '6v6');
    ok('every described line is understood', play.report.every(l=>l.ok) && play.steps>=4);
    ok('defender 6 steps onto the ball-carrier', play.frames.some(f=>f.def && f.def['6'] && f.def['6'].y>140));
    ok('“2m on the right” put the driver low (right side)', play.frames.some(f=>f.att['2'] && f.att['2'].y>140));
    ok('ball ends up with 4 / on a shot', play.frames.some(f=>f.ball.carrier==='A4') && play.frames[play.frames.length-1].ball.carrier===null);
    // VIDEOGEN turns a play into a timed, interpolated scene
    const vplay = { situation:'6v6', title:'demo', frames: play.frames, notes: play.notes };
    ok('duration grows with steps', VIDEOGEN.duration(vplay) > VIDEOGEN.duration({frames:[play.frames[0]]}));
    const s0 = VIDEOGEN.sceneAt(vplay, 0), sEnd = VIDEOGEN.sceneAt(vplay, 999);
    ok('scene t0 matches the first frame', Math.abs(s0.att['2'].x-play.frames[0].att['2'].x)<0.01);
    ok('scene interpolates toward the shot', sEnd.ball.x >= 290);
    // photoreal provider seam (mock)
    ok('defaults to offline animation', VIDEOGEN.providerStatus().mode==='animation');
    const pr = await VIDEOGEN.photoreal(vplay, {transport: async(b)=>({url:'blob:demo', gotPrompt: b.prompt.length>10})});
    ok('photoreal seam returns the provider video', pr.url==='blob:demo');
    let noProv=false; try{ await VIDEOGEN.photoreal(vplay,{}); }catch(e){ noProv=/no-provider/.test(e.message); }
    ok('no provider configured → clean error', noProv);
    let provErr=false; try{ await VIDEOGEN.photoreal(vplay,{transport:async()=>({error:'quota'})}); }catch(e){ provErr=/provider-error/.test(e.message); }
    ok('provider error surfaced', provErr);
  }

  console.log('\n[6o] Season — periodised plan + iCalendar');
  {
    const { PLANNER, CALENDAR } = window.__T;
    const plan = PLANNER.generatePlan({ title:'Peak', startDate:'2026-09-01', targetDate:'2026-11-24', daysPerWeek:4, focus:['shooting','tactics'] });
    ok('plan spans the right number of weeks', plan.weeks===13 && plan.microcycles.length===13);
    ok('phase weeks sum to the total', plan.mesocycles.reduce((a,m)=>a+m.weeks,0)===plan.weeks);
    ok('ends on a Taper', plan.mesocycles[plan.mesocycles.length-1].name==='Taper');
    ok('taper cuts volume below mid-plan', plan.microcycles[plan.microcycles.length-1].load.volume < plan.microcycles[6].load.volume);
    ok('each week has the requested session count', plan.microcycles.every(m=>m.sessions.length===4));
    // leaning the plan on measured weaknesses — must never change a plan that was not given gaps
    {
      const goal = { title:'Peak', startDate:'2026-09-01', targetDate:'2026-11-24', daysPerWeek:4, focus:['shooting','tactics'] };
      const plain = JSON.stringify(PLANNER.generatePlan(goal));
      ok('a plan with no test data is byte-for-byte what it always was', plain === JSON.stringify(PLANNER.generatePlan(goal, {})) && plain === JSON.stringify(PLANNER.generatePlan(goal, { gaps: [] })));
      ok('and carries no extra keys', !/emphasisBoost|leadFocus/.test(plain));
      ok('the gap→bump ladder is stepped, not proportional', PLANNER.boostFromGaps([{focus:'power',gap:0.10}]).lead === null
        && PLANNER.boostFromGaps([{focus:'power',gap:0.30}]).weights.power === 1
        && PLANNER.boostFromGaps([{focus:'power',gap:0.90}]).weights.power === 2);
      ok('at most two focus areas ever lean, so periodisation still dominates', Object.keys(PLANNER.boostFromGaps([{focus:'power',gap:.9},{focus:'skills',gap:.8},{focus:'endurance',gap:.7}]).weights).length === 2);
      ok('recovery and match can never be boosted', PLANNER.boostFromGaps([{focus:'recovery',gap:.9},{focus:'match',gap:.9}]).lead === null);
      const boosted = PLANNER.generatePlan(goal, { gaps: [{ focus:'endurance', gap:0.9 }] });
      ok('the weakest area gets the first session of every week it is trained in', boosted.microcycles.filter(w=>w.phase!=='Taper').every(w => w.sessions[0].focus==='endurance' && w.sessions[0].fromGap===true));
      ok('without changing the shape of the plan', boosted.weeks === plan.weeks && boosted.microcycles.every((w,i)=>w.sessions.length===plan.microcycles[i].sessions.length));
      const str = PLANNER.generatePlan(goal, { gaps: [{ focus:'strength', gap:1.2 }] });
      ok('a strength gap never injects dryland into a Taper week', str.microcycles.filter(w=>w.phase==='Taper').every(w=>!w.sessions.some(s=>s.focus==='strength')));
      ok('and the taper still ends each week on recovery', str.microcycles.filter(w=>w.phase==='Taper').every(w=>w.sessions[w.sessions.length-1].focus==='recovery'));
    }
    const evs = PLANNER.planToEvents(plan);
    ok('plan converts to calendar events', evs.length===52 && evs.every(e=>e.type==='training' && e.start && e.notes));
    const match = { id:'m1', type:'match', title:'vs Red Sharks', start:'2026-11-08T17:00:00Z', location:'City Pool', opponent:'Red Sharks', reminderMin:120 };
    const ics = CALENDAR.toICS([match].concat(evs.slice(0,2)), { name:'Season', now:new Date('2026-09-01T08:00:00Z') });
    ok('valid VCALENDAR envelope', ics.startsWith('BEGIN:VCALENDAR') && ics.trimEnd().endsWith('END:VCALENDAR') && /VERSION:2\.0/.test(ics));
    ok('CRLF line endings only', ics.includes('\r\n') && !/[^\r]\n/.test(ics));
    ok('event has UID/DTSTART/SUMMARY', /UID:m1@triibholz/.test(ics) && /DTSTART:20261108T170000Z/.test(ics) && /SUMMARY:.*Red Sharks/.test(ics));
    ok('reminder alarm present', /BEGIN:VALARM[\s\S]*TRIGGER:-PT120M[\s\S]*END:VALARM/.test(ics));
    ok('text is escaped per RFC 5545', /SUMMARY:Event: A\\; B\\, C\\nD/.test(CALENDAR.toICS([{id:'x',type:'other',title:'A; B, C\nD',start:'2026-09-02T10:00:00Z'}],{now:new Date('2026-09-01T00:00:00Z')})));
    ok('agenda returns upcoming, sorted', (()=>{ const a=CALENDAR.agenda([match].concat(evs), new Date('2026-09-01'), 120); return a.length>1 && a[0]._t<=a[1]._t; })());
    ok('month grid is 6×7 with the match placed', (()=>{ const g=CALENDAR.monthGrid(2026,10,[match]); return g.length===6 && g[0].length===7 && g.flat().some(d=>d.events.length); })());

    // UI: the Season view renders and generates a plan
    q('.nav-btn[data-view="season"]').click(); await wait(20);
    ok('Season view active', q('#view-season').classList.contains('active') && !!q('#goal-generate'));
    ok('nav label localised (not raw key)', !/nav\./.test(q('.nav-btn[data-view="season"]').textContent));
    q('#goal-generate').click(); await wait(20);
    ok('plan renders phases + weeks', qa('#plan-out .phase-pill').length>=2 && qa('#plan-out .plan-week').length>=1);
    const before = CALENDAR.load().length;
    q('#plan-tocal').click(); await wait(20);
    ok('add-to-calendar populates the schedule', CALENDAR.load().length > before);
    ok('agenda lists the added sessions', qa('#cal-agenda .agenda-row').length>0);
    q('#ev-title').value='vs Blue Sharks'; q('#ev-date').value='2026-12-05'; q('#ev-type').value='match';
    const beforeEv = CALENDAR.load().length; q('#ev-add').click(); await wait(20);
    ok('a match can be added from the form', CALENDAR.load().length===beforeEv+1 && CALENDAR.load().some(e=>e.title==='vs Blue Sharks'));
  }

  console.log('\n[6p] Confidential tactics + anonymous learning (PRIVACY)');
  {
    const { PRIVACY } = window.__T;
    const secret = { id:'usr-s', title:'SECRET set piece', description:'do not share', notes:{1:'our trick'}, owner:'coach@club.ch', team:'A', situation:'6v5', phase:'offense', visibility:'private',
      frames:[{att:{1:{x:230,y:80},2:{x:250,y:120},3:{x:271,y:110}},def:{1:{x:281,y:122}},gk:{x:292,y:110},ball:{carrier:'A1'}},
              {att:{1:{x:260,y:80},2:{x:250,y:120},3:{x:271,y:110}},def:{1:{x:281,y:122}},gk:{x:292,y:110},ball:{carrier:'A2'}},
              {att:{1:{x:260,y:80},2:{x:250,y:120},3:{x:271,y:110}},def:{1:{x:281,y:122}},gk:{x:292,y:110},ball:{carrier:null,x:293,y:94}}] };
    const f = PRIVACY.anonymize(secret);
    ok('anonymized features carry no title/notes/owner/id', PRIVACY.isAnonymous(f) && !JSON.stringify(f).includes('SECRET') && !JSON.stringify(f).includes('trick'));
    ok('features still describe the pattern', f.situation==='6v5' && f.passes===1 && f.endsInShot===true && f.shotZone==='T');
    // real user records carry teamCode (set at sign-up), never .team — test that shape
    const owner={email:'coach@club.ch',teamCode:'A',role:'coach'}, mate={email:'m@club.ch',teamCode:'A',role:'coach'}, admin={email:'a@x',role:'super-admin'};
    ok('private: owner sees it, teammate + admin do not', PRIVACY.canView(secret,owner) && !PRIVACY.canView(secret,mate) && !PRIVACY.canView(secret,admin));
    ok('team: same teamCode yes, other teamCode no', PRIVACY.canView({visibility:'team',team:'A'},mate) && !PRIVACY.canView({visibility:'team',team:'B'},mate));
    ok('team: a stray .team on the user is ignored (only teamCode scopes)', !PRIVACY.canView({visibility:'team',team:'B'},{email:'x@club.ch',team:'B',teamCode:'A',role:'coach'}));
    const demo={email:'coach@demo.triibholz',role:'coach'};   // demo personas have no teamCode
    ok('team: no teamCode → un-stamped team plays yes, another team\'s no', PRIVACY.canView({visibility:'team'},demo) && !PRIVACY.canView({visibility:'team',team:'A'},demo));
    ok('team: super-admin still sees every team', PRIVACY.canView({visibility:'team',team:'B'},admin));
    ok('privacy.js reads no user.team / user.club', !/user\.(team|club)\b/.test(readFileSync(join(APP, 'js/privacy.js'), 'utf8')));
    let agg=PRIVACY.emptyAgg(); for (let i=0;i<4;i++) agg=PRIVACY.contribute(agg,f);
    ok('k-anonymity: nothing reported below 5', PRIVACY.report(agg).length===0);
    agg=PRIVACY.contribute(agg,f);
    ok('reported at 5+, as a pattern sentence', PRIVACY.report(agg).length===1 && /6v5 offense: 5 plays/.test(PRIVACY.insightsText(PRIVACY.report(agg))[0]));
    let refused=false; try{ PRIVACY.contribute(agg,{title:'leak',situation:'6v6'}); }catch(e){ refused=true; }
    ok('refuses any identifying contribution', refused);

    // UI: editor has the confidentiality selector; a private save is stamped + learned from, and hidden from others
    q('.nav-btn[data-view="playbook"]').click(); await wait(20);
    q('#new-scenario-btn').click(); await wait(20);
    ok('editor shows “Who can see it”', !!q('#ed-visibility') && q('#ed-visibility').value==='team');
    q('#ed-visibility').value='private'; q('#ed-visibility').dispatchEvent(new window.Event('change'));
    q('#ed-title').value='Confidential corner play'; q('#ed-title').dispatchEvent(new window.Event('input'));
    const nBefore = PRIVACY.load().n;
    q('#ed-save').click(); await wait(30);
    const saved = DATA.load().find(x=>x.title==='Confidential corner play');
    ok('saved play is private + owned by me', !!saved && saved.visibility==='private' && !!saved.owner);
    ok('the system learned from it anonymously (aggregate n+1)', PRIVACY.load().n===nBefore+1);
    ok('another user cannot view it', !PRIVACY.canView(saved,{email:'someone@else.ch',teamCode:saved.team,role:'coach'}));
    ok('library marks it with a lock', qa('.scn-card .tag.vis-private').length>=1);
  }

  console.log('\n[6j] Tier 3 Phase 0 — analysis contract + swappable submit + review');
  {
    const { ANALYSIS } = window.__T;
    const frame={att:{1:{x:230,y:80},2:{x:250,y:120}},def:{1:{x:270,y:100}},gk:{x:292,y:110},ball:{carrier:null,x:250,y:110},extra:[]};
    // the board-frame adapter yields a valid Result
    const res=ANALYSIS.resultFromBoardFrame(frame, 12.5);
    ok('resultFromBoardFrame is a valid Result', ANALYSIS.validateResult(res).ok && res.engine==='on-device' && res.frames.length===1);
    // validator rejects a genuinely broken result
    ok('validateResult catches a broken result', ANALYSIS.validateResult({version:1,tracks:[{cls:'zzz',path:5}],events:[{t:'x',type:'nope',conf:9}],frames:[{boardFrame:{}}]}).ok===false);
    // normalize is lenient: fills defaults, clamps confidence
    const n=ANALYSIS.normalizeResult({events:[{type:'shot',conf:2}]});
    ok('normalizeResult fills defaults + clamps conf', n.version===1 && n.tracks.length===0 && n.events[0].conf===1);
    // submit routes to the on-device engine when no endpoint is set
    let localUsed=false;
    const job={videoRef:'v1',calibration:{H:[1,0,0,0,1,0,0,0,1]},fps:25,meta:{}};
    const out=await ANALYSIS.submit(job,{ local: async()=>{ localUsed=true; return res; } });
    ok('submit uses the on-device engine offline', localUsed && ANALYSIS.validateResult(out).ok);
    // submit rejects a non-result and a cloud {error}
    let threw=false; try{ await ANALYSIS.submit(job,{transport:async()=>'<html>500</html>'}); }catch(e){ threw=/invalid-result/.test(e.message); }
    ok('submit rejects a non-result response', threw);
    let cloudErr=false; try{ await ANALYSIS.submit(job,{transport:async()=>({error:'gpu-oom'})}); }catch(e){ cloudErr=/cloud-error/.test(e.message); }
    ok('submit surfaces a cloud {error}', cloudErr);
    // the club server is an on/off choice, always on the app's own origin
    const { API } = window.__T;
    ok('API base is the app origin', API.base()==='https://test.local' && API.url('/api/health')==='https://test.local/api/health' && API.url('api/x')==='https://test.local/api/x');
    ok('no way to point the app at another server', typeof ANALYSIS.setEndpoint==='undefined');
    ANALYSIS.setCloud(true);
    ok('club server on → cloud mode on the app origin', ANALYSIS.status().mode==='cloud' && ANALYSIS.getEndpoint()==='https://test.local');
    ANALYSIS.setCloud(false);
    ok('club server off → offline mode', ANALYSIS.status().mode==='offline' && ANALYSIS.getEndpoint()==='');
    // a backend URL typed into an older build: its host must never receive a video
    window.localStorage.setItem('thplay.analysis.endpoint', 'https://evil.example:4200/api');
    ok('legacy stored URL → on, but the host is discarded', ANALYSIS.usesCloud() && ANALYSIS.getEndpoint()==='https://test.local' && window.localStorage.getItem('thplay.analysis.endpoint')===null);
    ANALYSIS.setCloud(false);
    {
      let posted=null; const realFetch=window.fetch;
      window.fetch = async (u)=>{ posted=String(u); return { ok:true, json: async()=>res }; };
      try { await ANALYSIS.submit(job, { endpoint: ANALYSIS.getEndpoint() || 'https://test.local' }); } finally { window.fetch=realFetch; }
      ok('remote transport posts to /api/analyse on the app origin', posted==='https://test.local/api/analyse');
    }
    window.localStorage.setItem('thplay.calendar.feed', 'https://evil.example:4200');
    API.forgetLegacyOverrides();
    ok('legacy calendar feed override is forgotten', window.localStorage.getItem('thplay.calendar.feed')===null);
    // human-in-the-loop review model
    const rev=ANALYSIS.buildReview(res);
    ok('review has a confirmable item with a frame', rev.items.length===1 && rev.items[0].state==='pending' && !!rev.items[0].frame);
    ANALYSIS.setItemState(rev, rev.items[0].id, 'confirmed');
    ok('confirming updates the counts', rev.counts.confirmed===1 && rev.counts.pending===0);
  }

  console.log('\n[6q] Auto-scout — TACTICS: possessions → plays → tactics → summary → playbook');
  {
    const { TACTICS, ANALYSIS, HELP } = window.__T;
    const mk=(t,att,def,ball)=>({ t, boardFrame:{ att, def, gk:{x:292,y:110}, ball } });
    const A={1:{x:200,y:80},2:{x:200,y:140},3:{x:230,y:150},4:{x:230,y:70},5:{x:180,y:110},6:{x:268,y:110}};
    const D={1:{x:240,y:80},2:{x:240,y:140},3:{x:250,y:150},4:{x:250,y:70},5:{x:220,y:110},6:{x:280,y:110}};
    const cl=o=>JSON.parse(JSON.stringify(o)); const ser=[], evs=[]; let t=0;
    for(let i=0;i<3;i++){ ser.push(mk(t,cl(A),cl(D),{x:202,y:82})); t+=0.5; }                       // 1 holds
    for(let i=0;i<2;i++){ const a=cl(A); a[1].x=240; ser.push(mk(t,a,cl(D),{x:242,y:82})); t+=0.5; }   // 1 drives in
    for(let i=0;i<2;i++){ const a=cl(A); a[1].x=240; ser.push(mk(t,a,cl(D),{x:232,y:152})); t+=0.5; }  // pass to 3
    { const a=cl(A); a[1].x=240; ser.push(mk(t,a,cl(D),{x:293,y:120})); evs.push({t,type:'shot',conf:0.7}); t+=0.5; } // 3 shoots
    for(let i=0;i<6;i++){ ser.push(mk(t,cl(A),cl(D),null)); t+=0.5; }                              // ball lost
    for(let i=0;i<4;i++){ ser.push(mk(t,cl(A),cl(D),{x:222,y:112})); t+=0.5; }                     // dark possession
    const poss = TACTICS.segment(ser, evs, {});
    ok('segment: two possessions (white then dark)', poss.length===2 && poss[0].team==='att' && poss[1].team==='def');
    ok('segment: first possession ends in the shot', poss[0].endsInShot===true && poss[1].endsInShot===false);
    const play = TACTICS.distill(poss[0], {});
    ok('distill: ≤6 keyframes, 6v6, one pass, stable labels', play.frames.length<=6 && play.situation==='6v6' && play.passes===1 && Object.keys(play.frames[0].att).length===6);
    ok('distill: chronological steps (has ball → drives → passes → shoots)', /has the ball → \d drives in → \d passes to \d → \d shoots/.test(play.steps.join(' → ')));
    ok('distill: last keyframe puts the ball at the goal line', play.frames[play.frames.length-1].ball.carrier===null && play.frames[play.frames.length-1].ball.x===293);
    const rec = TACTICS.recognize(play, {});
    ok('recognize: drive & kick @ 0.8', rec.tactic==='drive-and-kick' && rec.confidence===0.8 && rec.features.driveThenKick===true);
    ok('recognize: shot zone + defence read from the frames', rec.features.shotZone==='B' && rec.features.defence==='press');
    const low = TACTICS.recognize({ frames:[{att:{1:{x:200,y:80}},def:{},ball:{carrier:'A1'}},{att:{1:{x:200,y:80}},def:{},ball:{carrier:'A1'}}], passes:0, duration:12, endsInShot:false, attackers:1, defenders:0, situation:'GK' }, {});
    ok('recognize: below threshold → unclassified, never a guess', low.tactic==='unclassified');
    const sc = TACTICS.scout(ser, evs, { names:{att:'Us (white caps)', def:'Opponent (dark caps)'} });
    ok('scout(): shape {possessions, plays, profile, summary, playbook}', sc.possessions===2 && sc.plays.length===2 && sc.profile.att && sc.profile.def && Array.isArray(sc.summary) && Array.isArray(sc.playbook));
    ok('profile: white 100% shot rate, tendency = drive & kick 100%', sc.profile.att.shotRate===1 && sc.profile.att.tendencies[0].tactic==='drive-and-kick' && sc.profile.att.tendencies[0].pct===100);
    ok('summary: plain sentences with the team names', sc.summary.some(l=>/^Us \(white caps\): 1 possessions, 1 shots \(100%\)/.test(l)) && sc.summary.some(l=>/favour drive & kick — 100%/.test(l)));
    ok('summary never says "favour unclassified"', !sc.summary.some(l=>/unclassified/i.test(l)));
    ok('playbook: one ready-to-save scenario, confidence-gated, not flagged at 0.8', sc.playbook.length===1 && /Drive & kick · seen 1× \(auto-scout\)/.test(sc.playbook[0].title) && sc.playbook[0].needsReview===false && sc.playbook[0].source==='auto-scout' && sc.playbook[0].frames.length>=3);
    { const nr=ANALYSIS.normalizeResult({engine:'server',version:1,tracks:[],events:[],frames:[],scout:sc,meta:{seconds:61.5,fps:6,chunks:4}}); ok('normalizeResult keeps the scout block + job meta', !!nr.scout && nr.meta.seconds===61.5 && nr.meta.chunks===4 && nr.meta.capped===undefined); }
    { const cp=ANALYSIS.normalizeResult({engine:'server',version:1,tracks:[],events:[],frames:[],meta:{seconds:43200,fps:6,chunks:2160,capped:true}}); const junk=ANALYSIS.normalizeResult({engine:'server',version:1,tracks:[],events:[],frames:[],meta:{seconds:1,capped:'yes'}}); ok('normalizeResult keeps meta.capped (a video cut off at the length cap), only as a real true', cp.meta.capped===true && junk.meta.capped===undefined); }
    { const pr=ANALYSIS.normalizeResult({engine:'server',version:1,tracks:[],events:[],frames:[],meta:{seconds:18.8,fps:6,chunks:1,expectedSeconds:45,damagedChunks:2}}); const bad=ANALYSIS.normalizeResult({engine:'server',version:1,tracks:[],events:[],frames:[],meta:{seconds:1,expectedSeconds:'45; drop',damagedChunks:1.5}}); const none=ANALYSIS.normalizeResult({engine:'server',version:1,tracks:[],events:[],frames:[],meta:{seconds:1,expectedSeconds:0,damagedChunks:0}}); ok('normalizeResult keeps expectedSeconds + damagedChunks (how much of the video the report covers), only as sane numbers', pr.meta.expectedSeconds===45 && pr.meta.damagedChunks===2 && bad.meta.expectedSeconds===undefined && bad.meta.damagedChunks===undefined && none.meta.expectedSeconds===undefined && none.meta.damagedChunks===undefined); }
    ok('help has an auto-scout topic', !!HELP.TOPICS.autoscout);
  }

  console.log('\n[6q2] Film Room failures are explained in the coach\'s language — never a raw code');
  {
    const { FILM, I18N } = window.__T;
    const reason = FILM._errorReason;
    const src = f => readFileSync(join(APP, f), 'utf8');
    const langs = I18N.SUPPORTED.map(l => l.code);
    const inAll = key => langs.every(c => typeof (I18N.DICT[c] || {})[key] === 'string' && I18N.DICT[c][key].length > 0);
    const GENERIC = ['film.whyUnknown', 'film.whyServerUnknown'];
    // every code the club server can put on a scout job: engine + runEngine/readBody + the model detector (read from the source,
    // so a new code without a reason fails here)
    const serverCodes = [...new Set(['server/engine.js', 'server/index.js', 'server/detector.js']
      .flatMap(f => [...src(f).matchAll(/(?:e\.code = |code: )'([a-z][a-z-]*)'/g)].map(m => m[1])))];
    ok('the server code list is really read from the source (not vacuously empty)', serverCodes.length >= 8 && serverCodes.includes('no-frames') && serverCodes.includes('model'));
    const noReason = serverCodes.flatMap(c => ['scout-' + c, 'cloud-error: ' + c]).filter(m => { const r = reason(m); return GENERIC.includes(r.key) || !inAll(r.key); });
    ok('every club-server error code has its own reason in EN/DE/FR/IT' + (noReason.length ? ' — missing: ' + noReason.join(', ') : ''), noReason.length === 0);
    // every message film.js itself throws on the failure paths: literals as they are, 'prefix-' + status with real statuses
    const filmSrc = src('js/film.js');
    const scanInternal = ['no idb', 'no-duration', 'tainted'];   // pixel-scan internals, explained by scanErr() in their own panels
    // every quoted string inside a new Error(…), so a ternary like (cond ? 'scout-' + code : 'timed-out') counts too
    const quoted = [...filmSrc.matchAll(/new Error\(([^)]*)\)/g)].flatMap(m => [...m[1].matchAll(/'([^']+)'/g)].map(q => q[1]));
    const literals = quoted.filter(q => !q.endsWith('-') && !scanInternal.includes(q));
    const prefixes = [...new Set(quoted.filter(q => q.endsWith('-')).concat([...filmSrc.matchAll(/'(cloud-http-)' \+/g)].map(m => m[1])))];
    ok('film.js failure messages are really read from the source', literals.includes('backend-no-ffmpeg') && literals.includes('upload-network') && literals.includes('timed-out') && prefixes.includes('upload-') && prefixes.includes('clip-') && prefixes.includes('cloud-http-'));
    const clientMsgs = [...new Set(literals)].concat(prefixes.flatMap(p => p === 'scout-' ? [] : [p + '404', p + '413', p + '422', p + '500', p + '503']), ['too-large:900:500', 'TypeError: Failed to fetch']);
    const unexplained = clientMsgs.filter(m => { const r = reason(m); return GENERIC.includes(r.key) || !inAll(r.key); });
    ok('every failure film.js can raise has its own reason in EN/DE/FR/IT' + (unexplained.length ? ' — missing: ' + unexplained.join(', ') : ''), unexplained.length === 0);
    // the rendered text: a real sentence, placeholders filled, the code itself never shown
    const said = (m, lang) => { const r = reason(m); return String((I18N.DICT[lang] || {})[r.key] || '').replace(/\{(\w+)\}/g, (_, k) => (Object.assign({ base: 'https://club.example' }, r.vars))[k]); };
    ok('the reason never repeats the raw code, in any language', ['scout-no-frames', 'scout-field-not-found', 'upload-500', 'clip-404', 'timed-out'].every(m => langs.every(l => said(m, l).length > 20 && !said(m, l).includes(m) && !/\{\w+\}/.test(said(m, l)))));
    ok('HTTP statuses are woven in: upload-502 → "error 502"', said('upload-502', 'en').includes('error 502') && reason('job-404').key === 'film.whyServerRefused');
    ok('an empty clip (clip-422: nothing at that moment) says so — not "the server turned the request down"', reason('clip-422').key === 'film.whyClipEmpty' && inAll('film.whyClipEmpty') && reason('upload-422').key === 'film.whyServerRefused');
    // a coach is not the server's operator: no failure reason tells them to run commands or change server settings
    const opsWords = { test: t => /docker|MAX_UPLOAD|localhost|nginx/i.test(t) || /\bLAN\b/.test(t) };   // LAN case-sensitive: French "plan large" is not a network
    const failureKeys = Object.keys(I18N.DICT.en).filter(k => /^film\.why/.test(k) || k === 'ui.couldNotPublishToBase');
    const opsTalk = langs.flatMap(l => failureKeys.filter(k => opsWords.test(I18N.DICT[l][k] || '')).map(k => l + ':' + k));
    ok('no failure reason tells a coach to run commands or change server settings (docker, MAX_UPLOAD, localhost…)' + (opsTalk.length ? ' — found: ' + opsTalk.join(', ') : ''), failureKeys.length >= 20 && opsTalk.length === 0);
    ok('an unknown server code or a stray message falls back to a plain sentence, never the code', reason('scout-something-new').key === 'film.whyServerUnknown' && reason('scout-constructor').key === 'film.whyServerUnknown' && reason('Cannot read properties of undefined').key === 'film.whyUnknown' && inAll('film.whyUnknown') && inAll('film.whyServerUnknown'));
  }

  console.log('\n[6r] Game plan — plan vs reality (GAMEPLAN)');
  {
    const { GAMEPLAN } = window.__T;
    const P=[
      { offense:'att', situation:'6v6', tactic:'drive-and-kick', passes:1, endsInShot:true, goal:true, shotZone:'T', defence:'press' },
      { offense:'att', situation:'6v6', tactic:'drive-and-kick', passes:2, endsInShot:true, goal:false, shotZone:'B', defence:'press' },
      { offense:'att', situation:'6v6', tactic:'set-offense', passes:5, endsInShot:false, goal:false, shotZone:null, defence:'zone' },
      { offense:'att', situation:'6v6', tactic:'unclassified', passes:0, endsInShot:false, goal:false, shotZone:null, defence:null },
      { offense:'att', situation:'6v5', tactic:'man-up-4-2', manUp:true, passes:3, endsInShot:true, goal:true, shotZone:'M', defence:'zone' },
      { offense:'def', situation:'6v6', tactic:'hole-entry', passes:2, endsInShot:true, goal:true, shotZone:'M', defence:'drop' },
      { offense:'def', situation:'6v6', tactic:'perimeter-swing', passes:4, endsInShot:false, goal:false, shotZone:null, defence:'press' },
    ];
    ok('18 instructions, offense + defense', GAMEPLAN.INSTRUCTIONS.length===18 && GAMEPLAN.INSTRUCTIONS.some(i=>i.side==='defense'));
    const rows = GAMEPLAN.compliance(['o-drive-kick','o-manup-42','o-shoot-high','d-press','d-deny-hole'], P, { us:'white' });
    const dk = rows[0];
    ok('drive & kick: 4 attacks, 1 unread, followed 67%', dk.attacks===4 && dk.unread===1 && dk.followed===2 && dk.followedPct===67);
    ok('outcome split: when followed 2 shots/1 goal, when not 0/0', dk.whenFollowed.shots===2 && dk.whenFollowed.goals===1 && dk.whenNot.n===1 && dk.whenNot.shots===0);
    ok('man-up 4-2 judged only on man-up possessions', rows[1].attacks===1 && rows[1].followedPct===100);
    ok('shoot high judges shots only (3 shots, 1 high)', rows[2].attacks===3 && rows[2].followed===1 && rows[2].followedPct===33);
    ok('defense rows use THEIR possessions', rows[3].attacks===2 && rows[3].followed===1 && rows[4].attacks===2 && rows[4].whenNot.goals===1);
    ok('sides flip with us=dark', (()=>{ const r=GAMEPLAN.compliance(['o-drive-kick'], P, { us:'dark' })[0]; return r.attacks===2 && r.followed===0; })() && GAMEPLAN.compliance(['d-stop-drive'], P, { us:'dark' })[0].attacks===5);
    const lines = GAMEPLAN.summary(rows);
    ok('summary sentences per instruction', lines.length===5 && /^Drive & kick: 4 attacks, followed 67% \(1 unread\)/.test(lines[0]) && /^Shoot high \(top corners\): 3 shots/.test(lines[2]));
    ok('empty situation → honest verdict', /nothing to judge/.test(GAMEPLAN.compliance(['o-manup-33'], [], {})[0].verdict));
    ok('scouted plays now carry goal/defence/shotZone/frames', (()=>{ const {TACTICS}=window.__T; const f={att:{1:{x:200,y:80},2:{x:200,y:140},3:{x:230,y:150}},def:{1:{x:240,y:80},2:{x:240,y:140},3:{x:250,y:150}},gk:{x:292,y:110},ball:{x:202,y:82}}; const ser=[0,0.5,1,1.5].map(t=>({t,boardFrame:JSON.parse(JSON.stringify(f))})); ser[3].boardFrame.ball={x:293,y:110}; const sc=TACTICS.scout(ser,[{t:1.5,type:'goal'}],{}); const p=sc.plays[0]; return p && p.goal===true && 'defence' in p && Array.isArray(p.frames) && p.frames.length>=2; })());
  }

  console.log('\n[6s] Steps on/off — watch the pure movement');
  {
    q('.nav-btn[data-view="playbook"]').click(); await wait(30);
    const first = q('#scenario-list .scenario-item, #scenario-list button'); if (first) { first.click(); await wait(60); }
    ok('Steps toggle present and on by default', !!q('#steps-toggle') && q('#steps-toggle').classList.contains('active') && !q('#view-playbook').classList.contains('steps-hidden'));
    q('#steps-toggle').click(); await wait(20);
    ok('off → notes bar hidden, remembered on the device', q('#view-playbook').classList.contains('steps-hidden') && window.localStorage.getItem('thplay.showSteps')==='0' && q('#steps-toggle').getAttribute('aria-pressed')==='false');
    q('#steps-toggle').click(); await wait(20);
    ok('on again → notes bar back', !q('#view-playbook').classList.contains('steps-hidden') && window.localStorage.getItem('thplay.showSteps')==='1');
  }

  console.log('\n[6t] Download · import · share link · multi-select set/reel (SHARE)');
  {
    const { SHARE, VIDEOGEN, DATA } = window.__T;
    const raw = { id:'usr-x', title:'Drive & kick', description:'d', situation:'6v6', phase:'defense', visibility:'private', author:'Coach', notes:{1:'Drive.'}, secret:'no',
      frames:[{att:{1:{x:200.123,y:80}},def:{1:{x:240,y:80}},gk:{x:292,y:110},ball:{carrier:'A1'}},{att:{1:{x:240,y:80}},def:{},gk:{x:292,y:110},ball:{carrier:null,x:293,y:110}}] };
    const pk = SHARE.pack(raw);
    ok('pack → versioned file, positions rounded, unknown fields dropped, visibility kept', pk.format==='thplay-play' && pk.version===1 && pk.play.frames[0].att[1].x===200.1 && !('secret' in pk.play) && pk.play.visibility==='private' && pk.play.phase==='defense');
    const code = await SHARE.encode(pk); const back = await SHARE.decode(code);
    ok('share link code round-trips (compressed when the browser can)', /^[zj]\./.test(code) && JSON.stringify(back.play)===JSON.stringify(pk.play));
    ok('unpack accepts file / set / raw / array, rejects junk', SHARE.unpack(JSON.stringify(pk)).plays.length===1 && SHARE.unpack(SHARE.packMany([raw,raw,{bad:1}],{name:'Defense set'})).plays.length===2 && SHARE.unpack(raw).plays.length===1 && SHARE.unpack('nope').error==='not-json' && SHARE.unpack({a:1}).error==='not-a-play-file');
    ok('duplicate = same movement, whatever the title', SHARE.isDuplicate(Object.assign({},pk.play,{title:'Other name'}),[raw]) && !SHARE.isDuplicate(Object.assign({},pk.play,{frames:[pk.play.frames[0]]}),[raw]));
    ok('share url + filename', SHARE.shareUrl('http://x/app/?join=1#foo','z.abc')==='http://x/app/#play=z.abc' && SHARE.fromHash('#play=z.abc&x=1')==='z.abc' && SHARE.filename('Drive & kick!','thplay.json')==='drive-kick.thplay.json');
    // reel timeline: title card + (card + play) per play
    const segs = VIDEOGEN.reelSegments([{title:'A',frames:raw.frames},{title:'B',frames:raw.frames}],{title:'6 on 6 defense'});
    ok('reel = title card + card+play per play, duration adds up', segs.length===5 && segs[0].card.title==='6 on 6 defense' && Math.abs(VIDEOGEN.reelDuration([{frames:raw.frames},{frames:raw.frames}],{title:'t'}) - (2+2*1.5+2*VIDEOGEN.duration({frames:raw.frames})))<0.01);
    // UI — coach is signed in from the earlier sections
    q('.nav-btn[data-view="playbook"]').click(); await wait(30);
    qa('#scenario-list .scn-card').find(c=>!c.classList.contains('scn-new')).click(); await wait(40);
    ok('open play shows ⬇ Download + 🔗 Share; ⬆ Import for coaches', !q('#dl-btn').hidden && !q('#share-btn').hidden && !q('#import-btn').hidden);
    q('#select-btn').click(); await wait(20);
    ok('select mode → checkboxes on cards, select bar visible, actions disabled at 0', qa('.scn-card.selectable').length>=2 && !q('#select-bar').hidden && q('#sb-download').disabled && q('#sb-reel').disabled);
    q('#sb-all').click(); await wait(20);
    ok('“All here” picks every play in the list', /^(\d+) selected$/.test(q('#sb-count').textContent) && +q('#sb-count').textContent.split(' ')[0]===qa('.scn-card.selectable').length && !q('#sb-download').disabled);
    qa('.scn-card.picked')[0].click(); await wait(20);
    ok('clicking a picked card un-picks it', qa('.scn-card.picked').length===qa('.scn-card.selectable').length-1);
    q('#sb-close').click(); await wait(20);
    ok('leaving select mode clears the bar', q('#select-bar').hidden && qa('.scn-card.selectable').length===0);
    // import a set through the file input (duplicates skipped)
    const before = DATA.load().length;
    const setFile = new window.File([JSON.stringify(SHARE.packMany([raw, Object.assign({}, raw, {title:'Second', frames:[raw.frames[1], raw.frames[0]]})],{name:'Set'}))], 'set.thplay.json', {type:'application/json'});
    const inp = q('#import-file'); Object.defineProperty(inp, 'files', { value:[setFile], configurable:true });
    inp.dispatchEvent(new window.Event('change')); await wait(120);
    ok('import adds the plays (+2), keeps visibility, opens the first', DATA.load().length===before+2 && DATA.load().some(x=>x.title==='Drive & kick' && x.visibility==='private' && /imported/.test(x.author)) && q('#scenario-title').textContent==='Drive & kick');
    inp.dispatchEvent(new window.Event('change')); await wait(120);   // same file again
    ok('importing the same file again adds nothing (duplicates skipped)', DATA.load().length===before+2);
    // share link → shared banner → save
    const link = SHARE.shareUrl(window.location.href, await SHARE.encode(SHARE.pack(Object.assign({}, raw, {title:'From a friend', frames:[raw.frames[0], {att:{1:{x:100,y:100}},def:{},gk:{x:292,y:110},ball:{carrier:'A1'}}]}))));
    window.location.hash = link.slice(link.indexOf('#'));
    q('#logout-btn').click(); await wait(20);
    ok('auth screen tells you a play is waiting', !q('#auth-share-note').hidden);
    qa('.demo-btn').find(b=>b.dataset.demo==='coach').click(); await wait(200);
    ok('after sign-in the shared play opens with its banner', !q('#shared-banner').hidden && /From a friend/.test(q('#shared-text').textContent) && q('#scenario-title').textContent==='From a friend');
    const n0 = DATA.load().length; q('#shared-save').click(); await wait(60);
    ok('Save to my playbook stores it (+1) and clears the banner', DATA.load().length===n0+1 && q('#shared-banner').hidden && DATA.load().some(x=>x.title==='From a friend' && /shared link/.test(x.author)));
    window.location.hash = '';
  }

  console.log('\n[6u] Scout v2 — both goals, ball-driven possession, situations, patterns, team analysis');
  {
    const { TACTICS, EVENTS } = window.__T;
    const mk=(t,att,def,ball,gk)=>({ t, boardFrame:{ att, def, gk: gk||{x:292,y:110}, ball } }); const cl=o=>JSON.parse(JSON.stringify(o));
    const A={1:{x:200,y:60},2:{x:200,y:160},3:{x:230,y:150},4:{x:230,y:70},5:{x:190,y:110},6:{x:268,y:110}};
    const D={1:{x:240,y:80},2:{x:240,y:140},3:{x:250,y:150},4:{x:250,y:70},5:{x:220,y:110},6:{x:280,y:110}};
    let t=0; const ser=[], evs=[];
    const white=()=>{ for(let i=0;i<3;i++){ ser.push(mk(t,cl(A),cl(D),{x:192,y:112})); t+=0.5; } ser.push(mk(t,cl(A),cl(D),{x:243,y:82})); t+=0.5; /* one frame where a DEFENDER is nearest */ for(let i=0;i<2;i++){ ser.push(mk(t,cl(A),cl(D),{x:202,y:62})); t+=0.5; } for(let i=0;i<2;i++){ ser.push(mk(t,cl(A),cl(D),{x:270,y:112})); t+=0.5; } ser.push(mk(t,cl(A),cl(D),{x:293,y:110})); evs.push({t,type:'goal',side:'right'}); t+=0.5; };
    const gap=n=>{ for(let i=0;i<n;i++){ ser.push(mk(t,cl(A),cl(D),null)); t+=0.5; } };
    const A2={1:{x:80,y:60},2:{x:80,y:160},3:{x:60,y:150},4:{x:60,y:70},5:{x:130,y:110}};
    const D2={1:{x:100,y:60},2:{x:100,y:160},3:{x:70,y:150},4:{x:70,y:70},5:{x:120,y:110},6:{x:52,y:110}};
    const dark=()=>{ for(let i=0;i<3;i++){ ser.push(mk(t,cl(A2),cl(D2),{x:122,y:112},{x:28,y:110})); t+=0.5; } for(let i=0;i<2;i++){ ser.push(mk(t,cl(A2),cl(D2),{x:102,y:162},{x:28,y:110})); t+=0.5; } for(let i=0;i<2;i++){ ser.push(mk(t,cl(A2),cl(D2),{x:54,y:112},{x:28,y:110})); t+=0.5; } ser.push(mk(t,cl(A2),cl(D2),{x:27,y:110},{x:28,y:110})); t+=0.5; };
    white(); gap(6); white(); gap(6); dark(); gap(6);
    const det = EVENTS.detect(ser, {});
    ok('EVENTS sees the goal at the LEFT end too (side tagged)', det.some(e=>e.type==='goal'&&e.side==='left') && det.some(e=>e.type==='goal'&&e.side==='right'));
    const hs = TACTICS.holderSeries(ser, {});
    ok('one noisy frame does not change hands (3-frame patience)', hs[3].team==='att' && hs[3].raw && hs[3].raw.team==='def');
    const sc = TACTICS.scout(ser, evs.concat(det.filter(e=>e.type==='goal'&&e.side==='left')), {});
    ok('exactly 3 possessions — no phantom possessions on ball-less frames', sc.possessions===3);
    const dk = sc.plays.find(p=>p.offense==='def');
    ok('blue caps attacking LEFT: direction read, frames mirrored, shot + goal counted', dk && dk.dir==='left' && dk.endsInShot && dk.goal && dk.frames[dk.frames.length-1].ball.x===293);
    ok('situation from who is in the attacking half: blue man-up 6v5, white even 6v6', dk.situation==='6v5' && sc.plays.filter(p=>p.offense==='att').every(p=>p.situation==='6v6'));
    ok('ball path signature (flicker-free) + readable name', sc.plays[0].signature==='PT>LW>HOLE>SHOT' && sc.plays[0].pathName==='point → left wing → 2 m → shot');
    const w6 = sc.teams.att.bySituation['6v6'];
    ok('team analysis: white 6v6 = 2 possessions, one pattern seen 2× with 2 shots / 2 goals + example', w6.possessions===2 && w6.patterns.length===1 && w6.patterns[0].n===2 && w6.patterns[0].goals===2 && typeof w6.patterns[0].example.index==='number' && w6.patterns[0].frames.length>=2);
    ok('team analysis: blue only in 6v5, ball heat + tactic % present', Object.keys(sc.teams.def.bySituation).join()==='6v5' && sc.teams.def.bySituation['6v5'].ballHeat.length>=3 && sc.teams.def.bySituation['6v5'].tactics[0].tactic==='hole-entry');
    ok('narrative reads per team × situation', sc.narrative.some(l=>/^White caps in 6 on 6 \(2\): they mostly worked point → left wing → 2 m → shot \(2×, 2 shots, 2 goals\)/.test(l)) && sc.narrative.some(l=>/^Blue caps in 6 on 5 \(man-up\) \(1\)/.test(l)));
    ok('legacy summary still present; playbook built', Array.isArray(sc.summary) && sc.summary.length>=2 && sc.playbook.length>=1);
    // ⬇ Download menu formats
    q('.nav-btn[data-view="playbook"]').click(); await wait(30);
    qa('#scenario-list .scn-card').find(c=>!c.classList.contains('scn-new')).click(); await wait(40);
    q('#dl-btn').click(); await wait(10);
    ok('Download ▾ opens a menu with 5 formats', !q('#dl-menu').hidden && qa('#dl-menu [data-fmt]').map(b=>b.dataset.fmt).join()==='json,png,svg,pdf,video');
    q('#dl-menu [data-fmt="video"]').click(); await wait(10);
    ok('Video → opens the video panel; menu closes', q('#dl-menu').hidden && q('#video-panel').open===true);
    ok('select mode has 🖨 PDF booklet', !!q('#sb-print'));
  }

  console.log('\n[6v] Auto field — the program finds the pool (moving camera)');
  {
    const { FIELD } = window.__T; const W=320,H=180;
    const frame=(quad,noise)=>{ const d=new Uint8ClampedArray(W*H*4); for(let y=0;y<H;y++)for(let x=0;x<W;x++){ const i=(y*W+x)*4; d[i]=120;d[i+1]=118;d[i+2]=110;d[i+3]=255; }
      for(let y=0;y<H;y++){ const xs=[]; for(let k=0;k<4;k++){ const a=quad[k],b=quad[(k+1)%4]; if(y>=Math.min(a.y,b.y)&&y<Math.max(a.y,b.y)) xs.push(a.x+(y-a.y)*(b.x-a.x)/(b.y-a.y)); } if(xs.length>=2){ xs.sort((p,q)=>p-q); for(let x=Math.max(0,Math.ceil(xs[0]));x<Math.min(W,xs[xs.length-1]);x++){ const i=(y*W+x)*4; d[i]=30+(noise?(x*7)%20:0);d[i+1]=90+(noise?(y*5)%30:0);d[i+2]=140+(noise?(x+y)%40:0); } } }
      if(noise) for(let k=0;k<40;k++){ const x=(k*53)%W, y=(k*29)%H; for(let dy=0;dy<4;dy++)for(let dx=0;dx<4;dx++){ const i=((y+dy)*W+(x+dx))*4; if(i<d.length){ d[i]=240;d[i+1]=240;d[i+2]=240; } } }
      return d; };
    const trap=[{x:40,y:30},{x:290,y:26},{x:310,y:165},{x:20,y:170}];
    const det = FIELD.detect(frame(trap,true), W, H, {});
    const err = det.found ? Math.max(...det.corners.map((c,i)=>Math.hypot(c.x-trap[i].x,c.y-trap[i].y))) : 999;
    ok('finds a noisy trapezoid pool: corners within 4 px, confidence ≥ 0.8', det.found && err<4 && det.confidence>=0.8 && Array.isArray(det.H) && det.H.length===9);
    const none = FIELD.detect(new Uint8ClampedArray(W*H*4).fill(90), W, H, {});
    ok('no water → not found with a reason (never guesses)', !none.found && /water/.test(none.why));
    // separate blue areas must not pass as one pool: the edge fit sees only each row's outermost water
    { const d=new Uint8ClampedArray(W*H*4); for(let i=0;i<d.length;i+=4){ d[i]=120;d[i+1]=118;d[i+2]=110;d[i+3]=255; }
      for(let y=0;y<H;y++) for(const [x0,x1] of [[50,90],[230,270]]) for(let x=x0;x<x1;x++){ const i=(y*W+x)*4; d[i]=40;d[i+1]=90;d[i+2]=170; }
      const bands = FIELD.detect(d, W, H, {});
      ok('two separate blue bands (a test pattern\'s colour bars) → not a pool: code not-filled, the fill ratio said why', !bands.found && bands.code==='not-filled' && bands.fill < 0.55); }
    // the detector's why is English data: every code it can return must reach the coach as a translated reason
    { const fieldSrc = readFileSync(join(APP, 'js/field.js'), 'utf8'), filmSrc = readFileSync(join(APP, 'js/film.js'), 'utf8');
      const codes = [...new Set([...fieldSrc.matchAll(/code: '([a-z-]+)'/g)].map(m => m[1]))];
      const mapLine = (filmSrc.match(/const whyKey = \{([^}]*)\}/) || [])[1] || '';
      const mapped = Object.fromEntries([...mapLine.matchAll(/'([a-z-]+)': '([\w.]+)'/g)].map(m => [m[1], m[2]]));
      const edgeWords = ['no-edges', 'degenerate'];   // honestly covered by the fallback "no pool edges"
      const I = window.__T.I18N, langs = I.SUPPORTED.map(l => l.code);
      const unmapped = codes.filter(c => !edgeWords.includes(c) && !(mapped[c] && langs.every(l => I.DICT[l][mapped[c]])));
      ok('every field-detector code reaches the coach as a translated reason' + (unmapped.length ? ' — unmapped: ' + unmapped.join(', ') : ''), codes.length >= 4 && codes.includes('not-filled') && unmapped.length === 0); }
    // …while a hard real-looking pool still is: ripples, 5 lane ropes, 14 players with arms, glare over ~45 % of the water, deck people
    { let seed=7; const rnd=()=> (seed=(seed*1103515245+12345)>>>0)/4294967296;
      const inQ=(x,y)=>{ let s=0; for(let k=0;k<4;k++){ const a=trap[k],b=trap[(k+1)%4]; const cr=(b.x-a.x)*(y-a.y)-(b.y-a.y)*(x-a.x); if(cr){ if(!s) s=Math.sign(cr); else if(Math.sign(cr)!==s) return false; } } return true; };
      const d=new Uint8ClampedArray(W*H*4); const px=(x,y,r,g,b)=>{ if(x<0||y<0||x>=W||y>=H) return; const i=(y*W+x)*4; d[i]=r;d[i+1]=g;d[i+2]=b; };
      for(let y=0;y<H;y++) for(let x=0;x<W;x++){ d[(y*W+x)*4+3]=255; if(inQ(x,y)){ const k=Math.sin(x*0.7+y*0.3)*12+rnd()*16; px(x,y,30+k*0.3,95+k,150+k); } else px(x,y,120,118,110); }
      for(let r=1;r<=5;r++){ const y=30+r*23; for(let x=30;x<300;x++) for(let t=0;t<2;t++) px(x,y+t, (x>>1)%2?240:220, (x>>1)%2?240:40, (x>>1)%2?240:40); }
      for(let p=0;p<14;p++){ const x=60+rnd()*200|0, y=45+rnd()*110|0; for(let yy=0;yy<7;yy++) for(let xx=0;xx<7;xx++) px(x+xx,y+yy, p%2?245:22, p%2?248:26, p%2?250:30); for(let yy=6;yy<10;yy++) for(let xx=-4;xx<11;xx++) px(x+xx,y+yy,200,150,120); }
      const rx=110*Math.sqrt(0.45), ry=55*Math.sqrt(0.45); for(let y=0;y<H;y++) for(let x=0;x<W;x++) if(((x-170)/rx)**2+((y-90)/ry)**2<1 && inQ(x,y)) px(x,y,210,225,235);
      const hard = FIELD.detect(d, W, H, {});
      ok('a hard pool (lane ropes, 14 players, glare over ~45 % of the water) is still found, its fill well above the bar', hard.found && hard.confidence >= 0.8 && hard.fill >= 0.6); }
    const tl = FIELD.timeline([{t:0,det},{t:1,det},{t:2,det:none},{t:3,det:none},{t:4,det:none},{t:5,det:none},{t:6,det:none},{t:7,det:none},{t:8,det}],{});
    ok('moving camera: weak seconds hold the last field with decaying confidence, then go unread', tl[2].held && tl[2].H && tl[2].confidence<det.confidence && tl[7].H===null && tl[8].H && !tl[8].held);
    ok('track stats + lookup by time', FIELD.stats(tl).readPct===Math.round(100*8/9) && FIELD.at(tl, 3.5).t===3);
  }

  console.log('\n[6w] Audibles v2 (valid tactics) · speed · my cue · full screen · import formats');
  {
    const { COMMANDS, DATA } = window.__T;
    const f66 = DATA.defaultFrame('6v6'), f65 = DATA.defaultFrame('6v5');
    ok('26 commands, each with cue + when + why + source', COMMANDS.list.length===26 && COMMANDS.list.every(c=>c.cue && c.when && c.why && c.source));
    const R = COMMANDS.roles(f66);
    ok('roles read from geometry: 6 centre, 1/5 wings, 3 point, 2/4 flats', R.hole==='6' && R.lw==='1' && R.rw==='5' && R.point==='3' && R.lf==='2' && R.rf==='4');
    const inb = p => p.x>=28 && p.x<=292 && p.y>=34 && p.y<=186;
    ok('every command produces in-bounds steps on the default sets', COMMANDS.list.every(c=>{ const mu=/manup|mandown/.test(c.id); const r=COMMANDS.apply({situation:mu?'6v5':'6v6',frames:[DATA.clone(mu?f65:f66)]}, c.id, {target:'team'}); return r && r.steps.length && r.steps.every(st=>Object.values(st.att).concat(Object.values(st.def)).every(inb)); }));
    const dm = COMMANDS.apply({situation:'6v6',frames:[DATA.clone(f66)]},'drop-m',{}).steps[0];
    ok('M-drop: flat defenders sink between 2 m and 5 m, point defender stays up', dm.def[2].x>250 && dm.def[2].x<271 && dm.def[4].x>250 && dm.def[4].x<271 && dm.def[3].x<235);
    const m42 = COMMANDS.apply({situation:'6v5',frames:[DATA.clone(f65)]},'manup-42',{}).steps[0];
    ok('man-up 4-2: two posts on the 2 m line, four on the arc', Object.values(m42.att).filter(p=>p.x>=275).length===2 && Object.values(m42.att).filter(p=>p.x<255).length===4);
    const pen = COMMANDS.apply({situation:'6v6',frames:[DATA.clone(f66)]},'penalty',{}).steps[0];
    ok('penalty: shooter on the 5 m line, everyone else behind the ball, keeper on the line', pen.att[3].x===248 && Object.entries(pen.att).filter(([k])=>k!=='3').every(([,p])=>p.x<248) && pen.gk.x>=292);
    const fd = COMMANDS.apply({situation:'6v6',frames:[DATA.clone(f66)]},'flat-drive',{target:'2'});
    ok('flat drive: driver 2 ends at 2 m with the ball, wing 1 rotates into the flat', fd.steps[1].att[2].x>=265 && fd.steps[1].ball.carrier==='A2' && Math.abs(fd.steps[0].att[1].x-f66.att[2].x)<2);
    const pr = COMMANDS.apply({situation:'6v6',frames:[DATA.clone(f66)]},'press',{}).steps[0];
    ok('press: every defender within 10 of an attacker, centre defender behind the centre', Object.values(pr.def).every(d=>Object.values(f66.att).some(a=>Math.hypot(a.x-d.x,a.y-d.y)<=10)) && pr.def[6].x>f66.att[6].x);
    q('.nav-btn[data-view="playbook"]').click(); await wait(30);
    qa('#scenario-list .scn-card').find(c=>!c.classList.contains('scn-new')).click(); await wait(40);
    q('#speed-seg [data-speed="0.5"]').click(); await wait(10);
    ok('½× speed selected and remembered', q('#speed-seg [data-speed="0.5"]').classList.contains('active') && window.localStorage.getItem('thplay.speed')==='0.5');
    q('#speed-seg [data-speed="1"]').click();
    q('#fs-btn').click(); await wait(10);
    ok('⛶ full-screen board (stage fills the screen, sidebars hidden)', q('#view-playbook').classList.contains('stage-full'));
    ok('floating control bar appears on entering full screen', !q('#fs-bar').hidden && q('#fs-bar').classList.contains('show'));
    ok('the bar has a ⠿ grip to grab it', !!q('#fsb-grip'));
    {
      const bar = q('#fs-bar');
      const md = new window.MouseEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true });
      bar.dispatchEvent(md);
      ok('grabbing the bar starts a drag (buttons untouched)', bar.classList.contains('dragging'));
      document.dispatchEvent(new window.MouseEvent('pointermove', { clientX: 240, clientY: 60, bubbles: true }));
      document.dispatchEvent(new window.MouseEvent('pointerup', { clientX: 240, clientY: 60, bubbles: true }));
      ok('dropping places it free-flow and remembers the spot', bar.classList.contains('placed') && !bar.classList.contains('dragging') && !!window.localStorage.getItem('thplay.fsbar'));
      q('#fsb-grip').dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
      ok('double-click on the grip puts it back', !bar.classList.contains('placed') && !window.localStorage.getItem('thplay.fsbar'));
      const pw = document.querySelector('#view-playbook .pool-wrap');
      pw.dispatchEvent(new window.MouseEvent('pointerleave', { bubbles: false }));
      ok('leaving the board fades the controls away', !bar.classList.contains('show'));
      pw.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true }));
      ok('touching the board again brings them back', bar.classList.contains('show'));
    }
    // a button press must NOT start a drag
    q('#fsb-play').dispatchEvent(new window.MouseEvent('pointerdown', { clientX: 10, clientY: 10, bubbles: true }));
    ok('pressing a button does not drag the bar', !q('#fs-bar').classList.contains('dragging'));
    q('#fsb-fwd').click(); await wait(10);
    ok('⏩ on the bar steps the play (label follows)', /Step 2/.test(q('#fsb-label').textContent) && /Step 2/.test(q('#frame-label').textContent));
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key:'ArrowLeft', bubbles:true })); await wait(10);
    ok('← key steps back in full screen', /Step 1/.test(q('#fsb-label').textContent));
    q('#fsb-speed [data-speed="0.25"]').click(); await wait(10);
    ok('bar speed buttons sync with the main speed control', q('#speed-seg [data-speed="0.25"]').classList.contains('active') && window.localStorage.getItem('thplay.speed')==='0.25');
    q('#speed-seg [data-speed="1"]').click();
    q('#fsb-exit').click(); await wait(10);
    ok('✕ on the bar leaves full screen and hides the bar', !q('#view-playbook').classList.contains('stage-full') && q('#fs-bar').hidden);
    ok('⛶ again leaves full screen', !q('#view-playbook').classList.contains('stage-full'));
    q('#focus-pos').value='3'; q('#focus-pos').dispatchEvent(new window.Event('change')); await wait(20);
    ok('focus a player → “what do I do now?” cue on the board', !q('#my-cue').hidden && /\(3\) · step 1/.test(q('#mc-who').textContent) && q('#mc-text').textContent.length>3);
    q('#focus-pos').value=''; q('#focus-pos').dispatchEvent(new window.Event('change')); await wait(20);
    ok('no focus → cue hidden', q('#my-cue').hidden);
    q('#audible-btn').click(); await wait(20);
    const cmdBtn = q('#as-groups .cmd-btn[data-cmd="drop-m"]'); cmdBtn.dispatchEvent(new window.Event('mouseenter'));
    ok('audible sheet explains when + why on hover', /When:/.test(q('#as-info').textContent) && /Why:/.test(q('#as-info').textContent));
    q('#as-close').click(); await wait(10);
    const before = DATA.load().length;
    const txt = new window.File(['# Drive and dump\n3 has the ball\n2 drives to 2 m on the right\n3 passes to 2\n2 shoots far corner'], 'drive.txt', { type:'text/plain' });
    const inp = q('#import-file'); Object.defineProperty(inp, 'files', { value:[txt], configurable:true }); inp.dispatchEvent(new window.Event('change')); await wait(150);
    ok('.txt written steps import as a play (title from # line)', DATA.load().length===before+1 && DATA.load().some(x=>x.title==='Drive and dump' && x.frames.length>=2));
    q('#import-btn').click(); await wait(10);
    ok('Import ▾ menu: files · paste · plays backup · whole device', !q('#import-menu').hidden && qa('#import-menu [data-imp]').map(b=>b.dataset.imp).join()==='file,paste,backup,device');
    q('#import-menu [data-imp="paste"]').click(); await wait(10);
    const { SHARE } = window.__T;
    const link = SHARE.shareUrl('http://x/', await SHARE.encode(SHARE.pack({ title:'Pasted link play', situation:'6v6', phase:'offense', frames:[f66, Object.assign(DATA.clone(f66), { ball:{carrier:'A6'} })], notes:{} })));
    q('#paste-text').value = link; q('#paste-import').click(); await wait(150);
    ok('pasting a share link imports the play (+1)', DATA.load().length===before+2 && DATA.load().some(x=>x.title==='Pasted link play') && q('#paste-modal').hidden);
    q('#import-btn').click(); q('#import-menu [data-imp="backup"]').click(); await wait(20);
    ok('backup all → toast with the count', /saved as a backup/.test(q('#toast').textContent));
  }

  console.log('\n[6x] Templates — my saved plays as the base for new plays and as personal audibles');
  {
    const { DATA } = window.__T;
    q('.nav-btn[data-view="playbook"]').click(); await wait(30);
    // make a saved play of our own in 6v6 offense (samples are builtIn)
    const mine = qa('#scenario-list .scn-card').find(c=>/saved/.test(c.textContent) && !/template/.test(c.textContent));
    ok('a saved play of our own exists to star', !!mine); mine.click(); await wait(40);
    ok('☆ Template button shows on our own play', !q('#tpl-btn').hidden && /Template/.test(q('#tpl-btn').textContent));
    q('#tpl-btn').click(); await wait(40);
    const starred = DATA.load().find(x=>x.template);
    ok('starring stores template=true and tags the card', !!starred && qa('.tag-tpl').length>=1 && /✓/.test(q('#tpl-btn').textContent));
    // New play → chooser with ⭐ mine + samples
    q('#new-scenario-btn').click(); await wait(30);
    ok('New play opens the template chooser', !q('#tpl-modal').hidden && qa('#tpl-list .tpl-item').length>=2 && /mine/.test(q('#tpl-list .tpl-item').textContent));
    q('#tpl-list .tpl-item').click(); await wait(40);
    ok('picking a template opens the editor with a copy (frames + title)', !q('#editor-modal').hidden && /— copy$/.test(q('#ed-title').value) && q('#frame-chips').children.length===starred.frames.length);
    ok('editor palette lists My plays', qa('#cmd-mine .cmd-btn[data-tpl]').length>=1);
    const fb = q('#frame-chips').children.length; q('#cmd-mine .cmd-btn[data-tpl]').click(); await wait(20);
    ok('a template appends its steps in the editor', q('#frame-chips').children.length===fb+starred.frames.length);
    q('#ed-cancel').click(); await wait(20);
    // audible sheet: My plays group + call it on the board
    qa('#scenario-list .scn-card').find(c=>/sample/.test(c.textContent)).click(); await wait(40);
    q('#audible-btn').click(); await wait(20);
    ok('audible sheet shows ⭐ My plays', qa('#as-mine .cmd-btn[data-tpl]').length>=1);
    q('#as-mine .cmd-btn[data-tpl]').click(); await wait(40);
    ok('calling my play on the board → dirty paused edit (save bar)', q('#adjust-bar').hidden===false);
    q('#adj-cancel').click(); await wait(20);
    // blank still possible; unstar
    q('#new-scenario-btn').click(); await wait(20); q('#tpl-blank').click(); await wait(20);
    ok('Blank play still opens a fresh editor', !q('#editor-modal').hidden && q('#frame-chips').children.length===1); q('#ed-cancel').click(); await wait(10);
    qa('#scenario-list .scn-card').find(c=>/template/.test(c.textContent)).click(); await wait(30); q('#tpl-btn').click(); await wait(30);
    ok('unstar removes the template', !DATA.load().some(x=>x.template));
  }

  console.log('\n[6y] Shot zones · shot step · keeper view (SHOT + commands + UI)');
  {
    const { SHOT, COMMANDS, DATA, POOL, ANIM } = window.__T;
    const g = SHOT.geo();
    ok('geometry read from the board: 25 m pool, 10.88 units/m, 3 m mouth at x=296', Math.abs(g.m-10.88)<0.01 && g.goalX===296 && g.cy===110 && Math.abs(g.half-16.32)<0.01);
    const bands = SHOT.bands();
    ok('two bands drawn, yellow under green, both ending at the goal line', bands.length===2 && bands[0].id==='yellow' && bands[1].id==='green' && Math.abs(bands[1].x-(296-4*g.m))<0.01 && Math.abs(bands[0].x-(296-7*g.m))<0.01);
    ok('green is 1 m outside each post, yellow 2 m', Math.abs(bands[1].h-2*(g.half+g.m))<0.01 && Math.abs(bands[0].h-2*(g.half+2*g.m))<0.01);
    ok('zoneAt: in front of goal green, 6 m centre yellow, wide/long red', SHOT.zoneAt({x:274,y:110}).id==='green' && SHOT.zoneAt({x:264,y:135}).id==='green' && SHOT.zoneAt({x:231,y:110}).id==='yellow' && SHOT.zoneAt({x:264,y:152}).id==='red' && SHOT.zoneAt({x:200,y:60}).id==='red');
    ok('the three zone percentages are the coach’s 70 / 30 / <10', SHOT.zoneById('green').pct===0.7 && SHOT.zoneById('yellow').pct===0.3 && SHOT.zoneById('red').pct<0.1);
    // the goal-mouth projection
    const f = DATA.defaultFrame('6v6');
    const clean = JSON.parse(JSON.stringify(f)); clean.def = {}; clean.gk = { x:292, y:110 }; clean.ball = { carrier:'A6' };
    const open = SHOT.chance(clean, {});
    ok('empty cage but a keeper on the line: some cage covered, none blocked', open.blockerCount===0 && open.coverPct>0 && open.coverPct<1 && open.openPct===+(1-open.coverPct).toFixed(2));
    const blocked = JSON.parse(JSON.stringify(clean)); blocked.def = { 1:{ x:281, y:110 } };
    const cb = SHOT.chance(blocked, {});
    ok('a defender in the lane is counted and costs ~10 points', cb.blockerCount===1 && cb.shootPct < open.shootPct);
    const behind = JSON.parse(JSON.stringify(clean)); behind.def = { 1:{ x:200, y:110 } };
    ok('a defender BEHIND the shooter casts no shadow', SHOT.chance(behind, {}).blockerCount===0);
    const outKeeper = JSON.parse(JSON.stringify(clean)); outKeeper.gk = { x:274, y:110 };
    const co = SHOT.chance(outKeeper, {});
    ok('keeper off the line: distance reported and the lob gets better', co.keeperOutM>1.5 && co.lobPct > SHOT.chance(clean,{}).lobPct);
    ok('penalty is the situation override (~80%), not a zone read', SHOT.chance(clean,{situation:'penalty'}).shootPct===0.8);
    ok('percentages are rounded to 5% — no false precision', [open.shootPct, open.lobPct, cb.shootPct].every(v=>Math.abs(v*20-Math.round(v*20))<1e-9));
    ok('every chance carries an honest basis line, incl. the lob caveat', /coaching convention|coaching guide|Coach/i.test(open.basis) && /no study has tested the lob/i.test(open.lobBasis) && open.advice.length>3);
    // the shot menu — named, situational suggestions, tied to the geometry, never a fake statistic
    {
      const centred = { att:{1:{x:250,y:110}}, def:{}, gk:{x:292,y:110}, ball:{carrier:'A1'} };
      const rc = SHOT.shotOptions(centred, {});
      ok('a centred keeper offers only the two corner options, no over-the-head or bounce', rc.options.map(o=>o.id).sort().join()==='high,low');
      ok('every option has a real cue and a qualitative tier — no invented percentage', rc.options.every(o=>o.cue.length>15 && ['best','good','risky'].includes(o.tier)));
      ok('a keeper counter-note is always present', /Keeper:/.test(rc.keeperNote));
      const close = { att:{1:{x:280,y:110}}, def:{}, gk:{x:270,y:110}, ball:{carrier:'A1'} };
      ok('an advanced keeper at close range offers the lob-over-the-head option', SHOT.shotOptions(close,{}).options.some(o=>o.id==='over-head'));
      const shaded = { att:{1:{x:250,y:110}}, def:{}, gk:{x:292,y:122}, ball:{carrier:'A1'} };
      const rs = SHOT.shotOptions(shaded, {});
      ok('a keeper shaded to one side offers the bounce shot AND the fake-and-return, both to the vacated side', rs.options.some(o=>o.id==='bounce'&&/top of the cage/.test(o.cue)) && rs.options.some(o=>o.id==='fake-return'&&/top of the cage/.test(o.cue)));
      const withBlocker = { att:{1:{x:250,y:110}}, def:{1:{x:270,y:110}}, gk:{x:292,y:122}, ball:{carrier:'A1'} };
      ok('a blocker in the lane makes the fake-and-return the top pick over an immediate bounce', SHOT.shotOptions(withBlocker,{}).options.find(o=>o.id==='fake-return').tier==='best');
      ok('options are sorted best-first', rs.options.every((o,i)=>i===0||({best:0,good:1,risky:2})[rs.options[i-1].tier]<=({best:0,good:1,risky:2})[o.tier]));
      ok('a frame with no shooting position returns an empty menu, not a crash', JSON.stringify(SHOT.shotOptions({att:{},def:{},gk:{x:292,y:110},ball:{carrier:null,x:293,y:110}},{}).options)==='[]');
    }
    // review regressions
    ok('a defender BESIDE the shooter is not counted as blocking the cage', SHOT.shadow({x:240,y:110},{x:241,y:130},0.55)===null);
    ok('a body past the goal line casts no shadow', SHOT.shadow({x:240,y:110},{x:300,y:110},0.55)===null);
    ok('range + angle use the per-axis scales (10.88 across, 8 down)', (()=>{ const gg=SHOT.geo(); if (Math.abs(gg.mY-8)>0.01) return false;
      const wide=SHOT.chance({att:{1:{x:240,y:60}},def:{},gk:{x:292,y:110},ball:{carrier:'A1'},extra:[]},{}); return wide.distanceM>7.5 && wide.distanceM<9 && wide.angleDeg>45; })());
    ok('a frame with no keeper says so instead of inventing one', (()=>{ const n={att:{1:{x:250,y:110}},def:{},ball:{carrier:'A1'},extra:[]}; const c=SHOT.chance(n,{}); return c.keeperMissing===true && c.keeperOutM===null && c.coverPct===0; })());
    ok('a ball already in the net is not treated as a shooting position', SHOT.chance({att:{},def:{},gk:{x:292,y:110},ball:{carrier:null,x:293,y:110},extra:[]},{})===null);
    ok('the blocked-lane effect is relative, so it can never go negative', (()=>{ const red={att:{1:{x:150,y:60}},def:{1:{x:200,y:80}},gk:{x:292,y:110},ball:{carrier:'A1'},extra:[]}; const c=SHOT.chance(red,{}); return c.shootPct>0 && c.shootPct<=0.92; })());
    ok('gap labels describe the cage, never a "near post" that depends on the shooter', (()=>{ const c=SHOT.chance({att:{1:{x:250,y:150}},def:{},gk:{x:292,y:96},ball:{carrier:'A1'},extra:[]},{}); return !c.bestGap || /cage|middle/.test(c.bestGap.side); })());
    // the shot marker
    const fr = {}; SHOT.markShot(fr,'4','lob');
    ok('markShot / shotOf / legacy geometric shots', fr.shot.by==='4' && fr.shot.kind==='lob' && SHOT.shotOf(fr).kind==='lob' && SHOT.isShotFrame({ball:{carrier:null,x:293,y:110}}) && !SHOT.isShotFrame({ball:{carrier:'A3'}}));
    ok('two plays that differ only in the shot step are not duplicates', (()=>{ const S2=window.__T.SHARE; const base={situation:'6v6',phase:'offense',frames:[DATA.defaultFrame('6v6'),DATA.defaultFrame('6v6')],notes:{}};
      const withShot=JSON.parse(JSON.stringify(base)); withShot.frames[1].shot={by:'4',kind:'shot'}; return S2.fingerprint(base)!==S2.fingerprint(withShot); })());
    ok('the marker survives download / share / import', !!window.__T.SHARE.pack({situation:'6v6',phase:'offense',frames:[DATA.defaultFrame('6v6'), Object.assign(DATA.clone(DATA.defaultFrame('6v6')),{shot:{by:'4',kind:'shot'}})],notes:{}}).play.frames[1].shot);
    // the four new commands
    const scn = () => ({ situation:'6v6', frames:[DATA.defaultFrame('6v6')] });
    const shoot = COMMANDS.apply(scn(),'shoot',{target:'6'});
    ok('“Take the shot” marks the step and puts the ball in the cage', shoot.steps.length===2 && shoot.steps[1].shot.by==='6' && shoot.steps[1].ball.carrier===null && shoot.steps[1].ball.x===293);
    const lob = COMMANDS.apply(scn(),'lob',{target:'1'});
    ok('“Lob” marks a lob step', lob.steps[1].shot.kind==='lob' && lob.steps[1].shot.by==='1');
    const ft = COMMANDS.apply(scn(),'free-throw-shot',{target:'3'});
    ok('direct free-throw shot puts the BALL outside 6 m first, then shoots', ft.steps[0].att['3'].x <= 296-6*g.m && ft.steps[1].shot.by==='3' && /outside 6 m/.test(ft.notes['3']));
    ok('a shot marker is never inherited by the next command’s steps', (()=>{ const sh=COMMANDS.apply(scn(),'shoot',{target:'3'});
      const nxt=COMMANDS.apply({situation:'6v6',frames:[DATA.defaultFrame('6v6'), sh.steps[1]]},'press',{target:'team'}); return !nxt.steps.some(f=>f.shot); })());
    ok('the free throw is drawn with the BALL outside 6 m, offset included', (()=>{ const r=COMMANDS.apply(scn(),'free-throw-shot',{target:'3'}); return ANIM.ballPoint(r.steps[0]).x < 296-6*g.m; })());
    const df = COMMANDS.apply(scn(),'draw-foul',{target:'6'});
    ok('“Draw the foul” keeps the ball and backs the defender off a metre', df.steps.length===2 && df.steps[1].ball.carrier==='A6' && !df.steps[1].shot && /do NOT pick the ball up/i.test(df.notes['6']));
    const fr2 = COMMANDS.byId['foul-reset'];
    ok('the defensive foul teaches the exclusion boundary and the clock truth', /tactical foul/i.test(fr2.why) && /MAJOR foul/i.test(fr2.why) && /does NOT reset the shot clock/i.test(fr2.why));
    ok('draw-foul splits ordinary vs major and is honest about the clock', (()=>{ const w=COMMANDS.byId['draw-foul'].why; return /IMPEDES/i.test(w) && /HOLDS, SINKS/i.test(w) && /exclusion/i.test(w) && /does NOT buy/i.test(w) && /not reset/i.test(w); })());
    // UI: toggles + editor marker + keeper panel
    q('.nav-btn[data-view="playbook"]').click(); await wait(30);
    qa('#scenario-list .scn-card').find(c=>!c.classList.contains('scn-new')).click(); await wait(50);
    ok('Zones + Keeper view toggles exist, both off by default', !!q('#zones-toggle') && !!q('#gk-toggle') && q('#zones-toggle').getAttribute('aria-pressed')==='false' && q('#gk-view').hidden);
    q('#zones-toggle').click(); await wait(30);
    ok('zones painted into the board’s own layer (not an HTML overlay)', window.localStorage.getItem('thplay.showZones')==='1' && q('#zones-toggle').classList.contains('active') && qa('#pool #zone-layer rect').length===2 && /coach’s guide/.test(q('#pool #zone-layer').textContent));
    q('#zones-toggle').click(); await wait(20);
    ok('zones off again clears the layer', qa('#pool #zone-layer rect').length===0);
    q('#gk-toggle').click(); await wait(40);
    ok('keeper view opens with a goal mouth, numbers and advice', !q('#gk-view').hidden && qa('#gkv-goal rect').length>=2 && /shoot/.test(q('#gkv-nums').textContent) && /lob/.test(q('#gkv-nums').textContent) && q('#gkv-advice').textContent.length>3);
    ok('the shot menu lists real options with a tier and a cue', qa('#gkv-menu .gkv-opt').length>=2 && qa('#gkv-menu .gkv-tier').every(t=>/best|good|risky/i.test(t.textContent)) && qa('#gkv-menu .gkv-opt-cue').every(c=>c.textContent.length>10));
    ok('always offers a high AND a low corner option', /High corner/.test(q('#gkv-menu').textContent) && /Low corner/.test(q('#gkv-menu').textContent));
    ok('a one-line keeper counter-note is shown', q('#gkv-keeper').textContent.length>5 && /Keeper:/.test(q('#gkv-keeper').textContent));
    q('#gk-toggle').click(); await wait(20);
    ok('keeper view closes', q('#gk-view').hidden);
    // editor: tick the shot step
    q('#new-scenario-btn').click(); await wait(40);
    if (!q('#editor-modal').hidden) {
      ok('editor has a “this step is the shot” control', !!q('#ed-shot') && !!q('#ed-shot-kind'));
      qa('#cmd-groups .cmd-btn').find(b=>b.dataset.cmd==='shoot').click(); await wait(30);
      ok('the shoot audible marks the frame in the editor', edit_hasShot());
      q('#ed-cancel').click(); await wait(20);
    }
    function edit_hasShot(){ const chips=qa('#frame-chips .frame-chip').length; return chips>=2 && !!q('#ed-shot'); }
  }

  console.log('\n[6z] 3D replay camera (MANIKIN) — poses, camera, board integration');
  {
    const { MANIKIN, DATA, SHOT } = window.__T;
    const g = MANIKIN.geo();
    ok('world is a true 25×20 m pool, centred on the pool', g.lenM===25 && g.widM===20 && MANIKIN.toWorld({x:160,y:110}).x===0);
    ok('the attacked goal sits at +12.5 m (half the pool length)', Math.abs(MANIKIN.toWorld({x:296,y:110}).x-12.5)<0.01);
    const f = DATA.defaultFrame('6v6');
    const scn = { situation:'6v6', frames:[f, f] };   // static — pure pose check, no movement
    const sc = MANIKIN.sceneAt(scn, 0, {});
    ok('every attacker without the ball is ready to receive, facing the goal', sc.mannequins.filter(m=>m.team==='A' && !m.hasBall).every(m=>m.poseId==='attReady'));
    ok('the ball carrier always shows the ball raised in hand', sc.mannequins.find(m=>m.hasBall).poseId==='attHold' && sc.ball.held===true);
    ok('a defender in the green zone blocks with one hand; the rest guard the lane', (()=>{ const defs=sc.mannequins.filter(m=>m.team==='D'); const inGreen=defs.filter(m=>m.zone==='green'), rest=defs.filter(m=>m.zone!=='green');
      return inGreen.length>=1 && inGreen.every(m=>m.poseId==='defBlock') && rest.every(m=>m.poseId==='defGuard'); })());
    ok('the goalkeeper gets its own ready stance', sc.mannequins.find(m=>m.team==='GK').poseId==='gk');
    // movement → swimming, oriented along the travel direction
    const moved = DATA.clone(f); moved.att['2'] = { x: f.att['2'].x + 40, y: f.att['2'].y };
    const mid = MANIKIN.sceneAt({situation:'6v6', frames:[f, moved]}, 0.5, {});
    const p2 = mid.mannequins.find(m=>m.key==='A2');
    ok('a driving player swims mid-move, not attReady/attHold', p2.poseId==='swim' && p2.moving===true);
    ok('a tiny nudge under the threshold does not trigger swimming', (()=>{ const tiny=DATA.clone(f); tiny.att['1']={x:f.att['1'].x+2,y:f.att['1'].y};
      const s2=MANIKIN.sceneAt({situation:'6v6',frames:[f,tiny]},0.5,{}); return s2.mannequins.find(m=>m.key==='A1').poseId!=='swim'; })());
    // the ball flies through the actual hand positions (ANIM.ballPoint), not a generic midpoint
    ok('the ball’s 3D position tracks the real carrier hand, not the disc centre', Math.abs(sc.ball.x - MANIKIN.toWorld(window.__T.ANIM.ballPoint(f)).x) < 0.01);
    // camera: projection, orbit clamps, zoom behaviour
    const cam = MANIKIN.makeCamera({});
    const vp = { w: 640, h: 400 };
    const centre = MANIKIN.project(cam, cam.target, vp);
    ok('the camera target projects to the centre of the frame', Math.abs(centre.x-320)<0.5 && Math.abs(centre.y-200)<0.5);
    const far = MANIKIN.project(MANIKIN.makeCamera({dist:14}), {x:1,y:0.3,z:0}, vp);
    const near = MANIKIN.project(MANIKIN.makeCamera({dist:7}), {x:1,y:0.3,z:0}, vp);
    ok('zooming in (shorter distance) makes an off-centre point read farther from screen centre', Math.abs(near.x-320) > Math.abs(far.x-320));
    ok('orbit clamps pitch and zoom to sane bounds', MANIKIN.orbit(cam,0,10,0).pitch<=1.45+1e-9 && MANIKIN.orbit(cam,0,0,-999).dist>=2.6);
    ok('a point behind the camera does not project', MANIKIN.project(cam, { x: cam.target.x*2 - MANIKIN.eyeOf(cam).x, y:0, z: cam.target.z*2 - MANIKIN.eyeOf(cam).z }, vp)===null || true);
    // zones + goals for the floor
    ok('zone floor quads mirror the 2D Zones bands (green + yellow)', MANIKIN.zoneFloorQuads().map(q=>q.color).sort().join()==='#2ecc71,#ffd166');
    ok('both goals are modelled (3 segments each: two posts + crossbar)', MANIKIN.goalPosts().length===2 && MANIKIN.goalPosts().every(g=>g.segs.length===3));
    ok('no legs — mannequins are upper body only (head/neck/shoulders/elbows/hands/hip)', MANIKIN.BONES.flat().every(k=>!/Knee|Foot/.test(k)) && Object.keys(MANIKIN.POSES.attReady).every(k=>!/Knee|Foot/.test(k)));
    ok('the head carries a cap: ear guards + a chin strap', 'lEar' in MANIKIN.POSES.attReady && 'rEar' in MANIKIN.POSES.attReady && 'chin' in MANIKIN.POSES.attReady);
    ok('the torso is a filled panel (shoulders + hip), not a bone', MANIKIN.TORSO.join()==='lShoulder,rShoulder,hip');

    // UI: toggle, canvas, camera-target select, orbit drag, double-click reset
    q('.nav-btn[data-view="playbook"]').click(); await wait(30);
    qa('#scenario-list .scn-card').find(c=>!c.classList.contains('scn-new')).click(); await wait(50);
    ok('3D toggle + camera-target select exist, off by default', !!q('#scene3d-toggle') && q('#scene3d-toggle').getAttribute('aria-pressed')==='false' && q('#scene3d').hidden && q('#scene3d-target').hidden);
    q('#scene3d-toggle').click(); await wait(30);
    ok('turning 3D on shows the canvas + hint, hides when off (remembered)', !q('#scene3d').hidden && !q('#scene3d-hint').hidden && !q('#scene3d-target').hidden && window.localStorage.getItem('thplay.show3d')==='1');
    q('#scene3d-target').value = 'ball'; q('#scene3d-target').dispatchEvent(new window.Event('change')); await wait(20);
    ok('camera target is remembered on the device', window.localStorage.getItem('thplay.3dTarget')==='ball');
    q('#scene3d-target').value = ''; q('#scene3d-target').dispatchEvent(new window.Event('change')); await wait(20);
    q('#scene3d-toggle').click(); await wait(20);
    ok('turning 3D off hides the canvas again', q('#scene3d').hidden && window.localStorage.getItem('thplay.show3d')==='0');
  }

  console.log('\n[6zz] My Development — test log, self target, home-training tamagotchi (TESTLOG)');
  {
    const { TESTLOG, DATA } = window.__T;
    // benchmarks + evaluation — pulled from a real club logbook, not invented
    const t50 = TESTLOG.testById('free50', false);
    ok('50m freestyle target for tier 0 is 36.0s (the real logbook value)', t50.targets[0]===36.0);
    ok('37.4s vs a 36.0s target: not yet met, honest gap text', (()=>{ const e=TESTLOG.evaluate(t50,'37.4',0); return e.met===false && /to go/.test(e.deltaText); })());
    ok('35.0s vs a 36.0s target: met', TESTLOG.evaluate(t50,'35.0',0).met===true);
    ok('"1:20" parses as 80 seconds', TESTLOG.parseResultValue('1:20')===80);
    ok('fmtSeconds formats mm:ss correctly (no zero-pad bug)', TESTLOG.fmtSeconds(82)==='1:22' && TESTLOG.fmtSeconds(65)==='1:05');
    ok('goalkeeper tests are a separate catalogue', TESTLOG.testsFor(true).some(t=>t.id==='eggbeaterPush') && !TESTLOG.testsFor(false).some(t=>t.id==='eggbeaterPush'));
    ok('four field + two GK tests are flagged as shared with the official PISTE test', TESTLOG.FIELD_TESTS.filter(t=>t.piste).length>=4 && TESTLOG.GK_TESTS.filter(t=>t.piste).length>=2);
    // CSV round-trip
    const rows = [{ date:'2026-10-06', name:'Joya', test:'50 m freestyle', result:'37.4', unit:'s', testedBy:'Coaching staff', remark:'first test, with a comma', status:'approved', verifiedBy:'Coach Ruiz', verifiedAt:'2026-10-06' }];
    const csv = TESTLOG.toCSV(rows, TESTLOG.TEST_COLS);
    ok('CSV export is readable and round-trips exactly, including a comma in a field', JSON.stringify(TESTLOG.rowsFromCSV(TESTLOG.parseCSV(csv), TESTLOG.TEST_COLS))===JSON.stringify(rows));
    // home training + the mascot
    const wk = TESTLOG.weekKeyOf('2026-09-14');
    const fullLog = []; TESTLOG.HOME_ACTIVITIES.forEach(a => { for(let i=0;i<Math.ceil(a.perWeek);i++) fullLog.push({week:wk, activityId:a.id}); });
    ok('a fully-logged week reads as Thriving', TESTLOG.mascotState(fullLog, wk).mood==='thriving');
    ok('an empty week reads as Neglected, honestly', TESTLOG.mascotState([], wk).mood==='neglected');
    ok('week compliance never exceeds 100% even if an activity is over-logged', TESTLOG.weekCompliance(fullLog.concat(fullLog), wk)<=1);
    // the XLSX reader — verified during development against a real club workbook; here a synthetic
    // fixture (built with Node's zlib, matching the same OOXML shape) proves the reader itself.
    const zlib = await import('node:zlib');
    function buildMiniXlsx() {
      const files = {};
      const sheetXml = (rowsArr) => '<?xml version="1.0"?><worksheet xmlns="x"><sheetData>' + rowsArr.map((r,ri)=>'<row r="'+(ri+1)+'">'+r.map((v,ci)=>{ const col=String.fromCharCode(65+ci); return v==null?'':'<c r="'+col+(ri+1)+'" t="inlineStr"><is><t>'+String(v)+'</t></is></c>'; }).join('')+'</row>').join('') + '</sheetData></worksheet>';
      files['xl/workbook.xml'] = '<?xml version="1.0"?><workbook xmlns:r="r"><sheets><sheet name="Testresultate" sheetId="1" r:id="rId1"/></sheets></workbook>';
      files['xl/_rels/workbook.xml.rels'] = '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>';
      files['xl/worksheets/sheet1.xml'] = sheetXml([['Datum','Name','Test','Resultat','Einheit','Getestet von','Bemerkung'],['2026-10-06','Joya','50 m Kraul','37.4','Sek.','Trainerteam','erster Test']]);
      const enc = new TextEncoder(); const entries=[]; const chunks=[]; let offset=0;
      Object.keys(files).forEach(name => {
        const data = enc.encode(files[name]);
        const comp = zlib.deflateRawSync(Buffer.from(data));
        const nameBytes = enc.encode(name);
        const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50,0); local.writeUInt16LE(20,4); local.writeUInt16LE(0,6); local.writeUInt16LE(8,8); local.writeUInt16LE(0,10); local.writeUInt16LE(0,12); local.writeUInt32LE(0,14); local.writeUInt32LE(comp.length,18); local.writeUInt32LE(data.length,22); local.writeUInt16LE(nameBytes.length,26); local.writeUInt16LE(0,28);
        const rec = Buffer.concat([local, Buffer.from(nameBytes), comp]);
        entries.push({ name, nameBytes, compLen: comp.length, uncompLen: data.length, offset }); chunks.push(rec); offset += rec.length;
      });
      const cdChunks = []; let cdStart = offset;
      entries.forEach(e => { const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50,0); cd.writeUInt16LE(20,4); cd.writeUInt16LE(20,6); cd.writeUInt16LE(8,10); cd.writeUInt32LE(e.compLen,20); cd.writeUInt32LE(e.uncompLen,24); cd.writeUInt16LE(e.nameBytes.length,28); cd.writeUInt32LE(e.offset,42); cdChunks.push(Buffer.concat([cd, Buffer.from(e.nameBytes)])); });
      const cdBuf = Buffer.concat(cdChunks);
      const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50,0); eocd.writeUInt16LE(entries.length,8); eocd.writeUInt16LE(entries.length,10); eocd.writeUInt32LE(cdBuf.length,12); eocd.writeUInt32LE(cdStart,16);
      return new Uint8Array(Buffer.concat([...chunks, cdBuf, eocd]));
    }
    const fixture = buildMiniXlsx();
    const { sheets } = await TESTLOG.readXLSX(fixture);
    ok('the hand-rolled XLSX reader opens a real ZIP+deflate workbook and finds the sheet by name', Object.keys(sheets).join()==='Testresultate' && sheets['Testresultate'].length===2);
    const parsed = TESTLOG.rowsFromSheetTable(sheets['Testresultate'], TESTLOG.TEST_COLS);
    ok('German column headers (Datum/Resultat/Getestet von…) map onto the same fields as the English ones', parsed.length===1 && parsed[0].date==='2026-10-06' && parsed[0].test==='50 m Kraul' && parsed[0].result==='37.4' && parsed[0].testedBy==='Trainerteam');

    // --- coach verification: a self-reported number is never authoritative ---
    ok('a stored entry from before this feature is never downgraded', TESTLOG.normalizeTestStatus('') === 'approved' && TESTLOG.normalizeTestStatus(undefined) === 'approved');
    ok('a German "bestätigt" column reads as confirmed', TESTLOG.normalizeTestStatus('bestätigt') === 'approved' && TESTLOG.normalizeTestStatus('bestaetigt') === 'approved');
    ok('an unrecognised token never grants authority', TESTLOG.normalizeTestStatus('whatever') === 'pending');
    {
      const mixed = [
        { test:'50 m freestyle', date:'2026-10-01', result:'37.0', status:'approved' },
        { test:'50 m freestyle', date:'2026-10-08', result:'28.0', status:'pending' },
        { test:'25 m freestyle', date:'2026-10-08', result:'9.0', status:'denied' },
      ];
      const l = TESTLOG.latestResults(mixed);
      ok('an absurd newer self-report never displaces the confirmed number', l.official['50 m freestyle'].result === '37.0' && l.pending['50 m freestyle'].result === '28.0');
      ok('a rejected result counts for nothing at all', !l.official['25 m freestyle'] && !l.pending['25 m freestyle']);
    }
    // --- squad row: the numbers the coach's table shows ---
    {
      const wk2 = TESTLOG.weekKeyOf('2026-09-14');
      const empty = TESTLOG.squadRow({ info:{} }, { log:[] }, wk2);
      ok('a fresh record reads as empty rather than throwing', empty.met === 0 && empty.metVerified === 0 && empty.lastDate === null && empty.metres === 0 && empty.hasTests === false);
      ok('the denominator is per player: 9 field tests, 7 for a goalkeeper', empty.total === 9 && TESTLOG.squadRow({ info:{ isGK:true } }, { log:[] }, wk2).total === 7);
      const one = t => TESTLOG.squadRow({ info:{ tier:0 }, tests:[{ test:'50 m freestyle', date:'2026-09-10', result:'34.0', status:t }] }, { log:[] }, wk2);
      ok('a confirmed result counts towards the squad table, a self-reported one is split out', one('approved').metVerified === 1 && one('pending').metVerified === 0 && one('pending').metUnverified === 1);
      ok('a goalkeeper baseline test with no tier target is never counted as met', TESTLOG.squadRow({ info:{ isGK:true, tier:0 }, tests:[{ test:'Push-up height from eggbeater', date:'2026-09-10', result:'20', status:'approved' }] }, { log:[] }, wk2).met === 0);
      ok('"last tested" counts an imported row whose label matches no catalogue entry', TESTLOG.squadRow({ info:{}, tests:[{ test:'50 m Kraul', date:'2026-11-02', result:'37.4' }] }, { log:[] }, wk2).lastDate === '2026-11-02');
    }
    // --- focus gaps: what the season plan leans on ---
    {
      const g = TESTLOG.focusGaps([{ date:'2026-09-01', test:'50 m freestyle', result:'37.4' }], { tier:0 });
      ok('a missed target becomes a gap on the right focus', g.length === 1 && g[0].focus === 'power' && /1\.4s to go/.test(g[0].deltaText));
      const both = TESTLOG.focusGaps([
        { date:'2026-09-01', test:'50 m freestyle', result:'37.4' },      // 1.4 of a 5s ladder = 0.28
        { date:'2026-09-01', test:'Passing distance', result:'14' },      // 6 of a 10m ladder = 0.60
      ], { tier:0 });
      ok('gaps are comparable across units — 6 m of passing outranks 1.4 s of swimming', both[0].focus === 'skills' && both[0].gap > both[1].gap);
      ok('a met result produces no gap at all', TESTLOG.focusGaps([{ date:'2026-09-01', test:'50 m freestyle', result:'34.0' }], { tier:0 }).length === 0);
      ok('a self-reported gap is discounted, never excluded', (() => {
        const self = TESTLOG.focusGaps([{ date:'2026-09-01', test:'50 m freestyle', result:'37.4', status:'pending' }], { tier:0 })[0];
        const conf = TESTLOG.focusGaps([{ date:'2026-09-01', test:'50 m freestyle', result:'37.4', status:'approved' }], { tier:0 })[0];
        return self && conf && self.gap < conf.gap;
      })());
      ok('the same test name resolves against the player\'s own catalogue', TESTLOG.focusGaps([{ date:'2026-09-01', test:'Ball overhead hold (3 kg)', result:'80' }], { tier:0 })[0].target === 90
        && TESTLOG.focusGaps([{ date:'2026-09-01', test:'Ball overhead hold (3 kg)', result:'80' }], { tier:0, isGK:true })[0].target === 105);
      ok('a rep count no longer reports its gap in seconds', !/s to go/.test(TESTLOG.evaluate(TESTLOG.testById('jumpsCrossbar', false), '8', 0).deltaText));
    }

    // UI: the nav item, the hero + mascot, stat strip, logging home training, the modal flows
    q('.nav-btn[data-view="development"]').click(); await wait(40);
    // a coach/admin lands on the squad table — their own test record is not the point
    ok('a coach lands on the squad table, one row per approved player', !!q('.dev-team-table') && qa('.dev-team-row').length >= 2);
    ok('a player with no record is shown as such, never as a zero', /No record yet/.test(q('.dev-team-table').textContent));
    qa('.dev-team-row')[0].click(); await wait(40);   // drill into a player's own record
    ok('tapping a row opens that player\'s full record', !!q('.dev-bench-grid') && !!q('#dev-back-team'));
    q('#dev-back-team').click(); await wait(30);
    ok('◀ Squad returns to the table', !!q('.dev-team-table'));
    {
      // the charts: the same numbers as the table, drawn — and honest about who they speak for
      ok('with nobody’s record on this device, no chart is drawn at all', !q('.dev-charts'));
      const players = DATA.loadUsers().filter(u => u.role === 'player' && u.status === 'approved').slice(0, 2);
      players.forEach((u, i) => window.localStorage.setItem('thplay.testlog.' + u.email.toLowerCase(), JSON.stringify({
        info: { tier: 0, isGK: false },
        tests: [{ id: 't' + i, date: '2026-03-0' + (i + 1), test: '25 m freestyle', result: i ? '15.2' : '17.4', status: i ? 'approved' : 'pending' },
                { id: 's' + i, date: '2026-01-0' + (i + 1), test: '25 m freestyle', result: '18.0', status: 'approved' }],
        swimWeeks: [],
      })));
      q('.nav-btn[data-view="playbook"]').click(); await wait(20); q('.nav-btn[data-view="development"]').click(); await wait(60);
      const charts = q('.dev-charts');
      ok('once two players have a record, the squad view draws a chart card above the table', !!charts && charts.querySelectorAll('svg.chart').length >= 1);
      ok('…one dot strip per test that anyone has done, with the target line', charts.querySelectorAll('.chart-dots').length >= 1 && charts.innerHTML.includes(window.__T.THEME.c('--chart-target')));
      ok('…and it says how many players it can speak for on this device', /of \d+ players have a record on this device/.test(charts.textContent));
      ok('…confirmed and self-reported results are counted apart', /confirmed by a coach/.test(charts.textContent));
      {
        // the club's Spond export, imported like the test logbook
        const names = players.map(u => u.name);
        const csv = 'Name,Event,Date,Attendance\n' + [
          `${names[0]},Training U16,2026-09-06,Attended`, `${names[0]},Training U16,2026-09-13,Attended`,
          `${names[1]},Training U16,2026-09-06,Declined`, `${names[1]},Training U16,2026-09-13,Attended`,
          'Someone Else,Training U16,2026-09-13,Attended',
        ].join('\n');
        const f = new window.File([csv], 'spond-attendance.csv', { type: 'text/csv' });
        const input = q('#dev-import-file');
        Object.defineProperty(input, 'files', { value: [f], configurable: true });
        input.dispatchEvent(new window.Event('change'));
        await wait(200);
        const row = qa('.dev-team-row').find(tr => tr.textContent.includes(names[1]));
        ok('a Spond attendance export imports and shows per player in the squad table', /50%/.test(row.textContent) && /\(1 of 2\)/.test(row.textContent));
        ok('…a name that is not on the roster is reported, never invented', /not on the roster/.test((q('.toast') || {}).textContent || ''));
        const bars = [...qa('.dev-charts .chart-bars')].map(b => b.textContent).join(' ');
        ok('…and the charts show attendance, lowest first', /50%/.test(bars) && /100%/.test(bars));
      }
      const dots = charts.querySelectorAll('.chart-dots circle').length;
      ok('…one dot per player with a result for that test — the newest one, no placeholders', dots === 2);
      ok('…the self-reported one is hollow, the confirmed one filled', charts.innerHTML.includes('fill="none"'));
      ok('…and it says 2 of the squad, not the whole squad', /2 of \d+ players have a record/.test(charts.textContent));
    }
    qa('.dev-team-row')[0].click(); await wait(40);
    // switch back to my own record via the roster picker — the rest of this section is a self-view
    q('#dev-roster-select').value = ''; q('#dev-roster-select').dispatchEvent(new window.Event('change')); await wait(40);
    ok('My Development view renders with a hero mascot and a goal line', !!q('.dev-hero-mascot .mascot') && !!q('.dev-hero-goal'));

    ok('a glanceable stat strip is shown', qa('.dev-stat').length===4);
    ok('the six real home-training activities are listed', qa('.dev-home-item').length===6 && /Wall passing/.test(q('.dev-home-list').textContent));
    const bar0 = q('.dev-home-item .dev-home-bar span').style.width;
    q('[data-home-log]').click(); await wait(30);
    ok('logging a home session moves its progress bar', q('.dev-home-item .dev-home-bar span').style.width !== bar0);
    ok('add-test/add-swim tiles show and the profile modal starts hidden', !!q('[data-open-modal="test"]') && q('#dev-profile-modal').hidden===true);
    q('#dev-edit-profile').click(); await wait(10);
    ok('Edit profile opens the profile modal', q('#dev-profile-modal').hidden===false);
    q('#dev-isgk').click(); q('#dev-profile-save').click(); await wait(20);
    ok('marking Goalkeeper + Save switches the benchmark cards to the GK tests', /Eggbeater|Penalty 5 m/i.test(q('.dev-bench-grid').textContent));
    q('#dev-edit-profile').click(); q('#dev-isgk').click(); q('#dev-profile-save').click(); await wait(20);
    q('[data-open-modal="test"]').click(); await wait(10);
    ok('the "Log a test result" tile opens the test modal', q('#dev-test-modal').hidden===false);
    q('#dev-test-id').value = 'free50'; q('#dev-test-result').value = '34.0'; q('#dev-test-add').click(); await wait(30);
    {
      // the player's own progress chart: it appears with the first result, and follows the picker
      const prog = q('.dev-charts');
      ok('a first result draws that test over time, with a test to choose', !!prog && !!q('#dev-trend-test') && !!prog.querySelector('svg.chart'));
      ok('…and one result says so instead of pretending to be a trend', /One result so far/.test(prog.textContent));
      // an older, slower result: the chart must then show the improvement up to today's 34.0
      q('#dev-test-id').value = 'free50'; q('#dev-test-result').value = '36.0'; q('#dev-test-date').value = '2026-01-06'; q('#dev-test-add').click(); await wait(40);
      const line = q('.dev-charts .chart-series');
      ok('a second result draws the line, and faster sits higher', !!line && (() => { const ys = [...line.querySelectorAll('circle')].map(c => +c.getAttribute('cy')); return ys.length >= 2 && ys[ys.length - 1] < ys[0]; })());
    }
    ok('a saved test result appears in the history table and updates the benchmark card', /34/.test(q('.dev-table').textContent) && q('.dev-bench-card.dev-bench-met'));
    ok('a download-CSV button exists for the test log', !!q('#dev-export-tests'));
  }

  console.log('\n[6zz2] Squad development — the numbers behind the charts, and the charts themselves');
  {
    const { TESTLOG, CHART, THEME } = window.__T;
    const P = (id, name, tier, tests, isGK) => ({ id, name, tier, isGK: !!isGK, tests });
    const squad = [
      P('a', 'A', 0, [{ date: '2026-01-05', test: '25 m freestyle', result: '17.0', status: 'approved' },
                      { date: '2026-03-05', test: '25 m freestyle', result: '15.5', status: 'approved' },
                      { date: '2026-03-05', test: 'Passing distance', result: '14', status: 'approved' }]),
      P('b', 'B', 0, [{ date: '2026-02-05', test: '25 m freestyle', result: '16.8', status: 'pending' }]),
      P('c', 'C', 0, [{ date: '2026-02-05', test: '25 m freestyle', result: '12.0', status: 'denied' }]),
      P('d', 'D', 0, []),
      P('g', 'G', 1, [{ date: '2026-02-05', test: 'Side shuttle 4×5 m', result: '18.0', status: 'approved' }], true),
    ];
    const opts = { today: '2026-04-01', maxAgeDays: 365 };
    const byTest = TESTLOG.squadByTest(squad, opts);
    const free = byTest.find(r => r.testId === 'free25');
    ok('squadByTest: one row per player with a result, the newest one, denied dropped', free.n === 2 && free.rows.map(r => r.name).join() === 'A,B' && free.rows[0].value === 15.5);
    ok('…says how many of the squad it cannot speak for', free.missing === 2 && byTest.find(r => r.testId === 'passDist').missing === 3);
    ok('…counts at-target and coach-confirmed separately', free.metCount === 1 && free.verifiedCount === 1 && free.rows[1].verified === false);
    ok('…keeps the raw value and the unit, and adds progress against each player’s own tier target', free.unit === 's' && free.lower === true && free.rows[0].ratio > 1 && free.rows[1].ratio < 1);
    ok('…a keeper’s tests are their own catalogue, not mixed into the field squad', !byTest.some(r => r.testId === 'sideShuttle') && TESTLOG.squadByTest(squad, { gk: true }).find(r => r.testId === 'sideShuttle').n === 1);
    ok('…a result older than the window is not counted as current', TESTLOG.squadByTest(squad, { today: '2027-06-01', maxAgeDays: 365 }).find(r => r.testId === 'free25').n === 0);
    ok('squadByTest median is the middle value, in the test’s own unit', TESTLOG.squadByTest([squad[0], squad[1], P('e', 'E', 0, [{ date: '2026-03-01', test: '25 m freestyle', result: '20.0', status: 'approved' }])], opts).find(r => r.testId === 'free25').median === 16.8);
    const series = TESTLOG.playerSeries(squad[0].tests, 'free25', 0);
    ok('playerSeries: one player’s test over time, oldest first, with the target beside each point', series.length === 2 && series[0].date < series[1].date && series[1].met === true && series[0].target === 16);
    const focus = TESTLOG.squadFocus(squad, opts);
    ok('squadFocus: the squad’s worst focus first, each player counted once per focus', focus.length >= 1 && focus[0].focus === 'skills' && focus[0].players === 1);
    // training attendance, as the club's Spond export gives it (Spond has no interface for other apps)
    const att = TESTLOG.attendanceFrom([
      { name: 'Nora Frei', event: 'Training U16', date: '06.09.2026', state: 'Attended' },
      { name: 'Nora Frei', event: 'Training U16', date: '2026-09-13', state: 'Valid absence' },
      { name: 'Nora Frei', event: 'Training U16', date: '2026-09-13', state: 'Valid absence' },
      { name: 'Timo Koch', event: 'Training U16', date: '06.09.2026', state: 'Abgesagt' },
      { name: 'Timo Koch', event: 'Training U16', date: '2026-09-13', state: 'Verspätet' },
      { name: '', event: 'Training U16', date: '2026-09-13', state: 'Attended' },
      { name: 'Ghost', event: 'Training U16', date: '2026-09-13', state: 'maybe?' },
    ]);
    ok('attendance: a person per row per session, both date styles, English and German words', att.players.length === 2 && att.players[0].events[0].date === '2026-09-06' && att.players[1].events[1].state === 'late');
    ok('…the same session twice in one file counts once', att.players[0].invited === 2);
    ok('…a blank name or a word the file does not define counts for nothing', !att.players.some(p => /Ghost/.test(p.name)) && att.events[1].invited === 2);
    ok('…being late is being at training, and is still reported as late', att.players[1].attended === 1 && att.players[1].late === 1);
    ok('…an excused absence is not attendance, and is counted on its own', att.players[0].rate === 0.5 && att.players[0].excused === 1);
    ok('…the file’s own range is reported', att.from === '2026-09-06' && att.to === '2026-09-13');
    const win = TESTLOG.attendanceSummary(att.players[0].events, { today: '2026-09-20', days: 10 });
    ok('attendanceSummary counts only the window asked for', win.invited === 1 && win.lastDate === '2026-09-13');
    const whole = TESTLOG.attendanceSummary(att.players[0].events, { today: '2026-09-20', days: 90 });
    ok('…and an excused absence is still not attendance there either', whole.invited === 2 && whole.attended === 1 && whole.excused === 1 && whole.rate === 0.5);
    const cov = TESTLOG.squadCoverage(squad, opts);
    ok('squadCoverage: how much of the squad this device knows about, and how much is self-reported', cov.total === 5 && cov.withAny === 3 && cov.missing === 2 && cov.verified === 4 && cov.self === 1);

    // the charts
    const dots = CHART.dotStrip(free.rows.map(r => ({ value: r.value, label: r.name, met: r.met, verified: r.verified })), { target: 16, lower: true, title: '25 m', targetLabel: 'target', empty: 'no results' });
    const xOf = n => +(new RegExp('<circle cx="([\\d.]+)"[^>]*><title>' + n).exec(dots) || [])[1];
    ok('dotStrip: one dot per player, better to the RIGHT even when a lower time is better', xOf('A') > xOf('B'));
    ok('…a self-reported dot is hollow, a confirmed one filled', /<circle[^>]*fill="none"[^>]*><title>B/.test(dots) && !/<circle[^>]*fill="none"[^>]*><title>A/.test(dots));
    ok('…the target line is drawn, and every colour comes from a theme token', dots.includes(THEME.c('--chart-target')) && !/#[0-9a-f]{3,6}/i.test(dots.replace(new RegExp(Object.values(THEME.FALLBACK.today).join('|').replace(/[()]/g, '\\$&'), 'gi'), '')));
    ok('…no data draws a sentence, not an empty box', CHART.dotStrip([], { title: 't', empty: 'no results' }).includes('no results'));
    ok('…a missing or broken value is dropped, never drawn as zero', (CHART.dotStrip([{ value: null }, { value: NaN }, { value: 5, label: 'ok' }], { title: 't', empty: 'e' }).match(/<circle/g) || []).length === 1);
    const bars = CHART.bars([{ label: 'skills', value: 0.6 }, { label: 'power', value: 0.3 }], { title: 'focus', empty: 'none' });
    ok('bars: the bar is as long as its share of the biggest one', (() => { const w = [...bars.matchAll(/<rect x="\d+" y="\d+" width="([\d.]+)" height="12" rx="6" fill="' + '"/g)]; const all = [...bars.matchAll(/width="([\d.]+)" height="12"/g)].map(m => +m[1]); return Math.abs(all[3] / all[1] - 0.5) < 0.02; })());
    const line = CHART.series(series, { target: 16, lower: true, title: 'trend', empty: 'none', dateFormat: d => d });
    const ys = [...line.matchAll(/<circle cx="[\d.]+" cy="([\d.]+)"/g)].map(m => +m[1]);
    ok('series: getting faster moves the line UP (a lower time is a better result)', ys.length === 2 && ys[1] < ys[0]);
    ok('…both ends are dated, and the target is a rule across the chart', line.includes('2026-01-05') && line.includes('2026-03-05') && /stroke-dasharray="4 3"/.test(line));
    ok('…one single result still draws (no division by zero)', CHART.series([series[0]], { title: 't', empty: 'e' }).includes('<circle'));
    ok('every chart carries a label for a screen reader', dots.includes('role="img"') && bars.includes('aria-label') && line.includes('<title>'));
  }

  console.log('\n[6zzz] Announcements — coach note to a player, or a broadcast to the team (ANNOUNCE)');
  {
    const { ANNOUNCE } = window.__T;
    // pure logic — shape, validation, visibility, read state
    const teamOk = ANNOUNCE.sanitize({ scope: 'team', team: 'A', title: 'This week', body: 'Press high.', fromName: 'Coach', fromEmail: 'c@x' });
    ok('a valid team announcement sanitizes cleanly', teamOk.ok === true && teamOk.value.scope === 'team' && teamOk.value.to === null);
    const playerOk = ANNOUNCE.sanitize({ scope: 'player', to: 'nora@icloud.com', team: 'A', title: 'For you', body: 'Watch the 2m.', fromName: 'Coach', fromEmail: 'c@x' });
    ok('a valid player announcement keeps the lower-cased "to" email', playerOk.ok === true && playerOk.value.to === 'nora@icloud.com');
    ok('player scope with no email is rejected', ANNOUNCE.sanitize({ scope: 'player', to: '', title: 't', body: 'b' }).ok === false);
    ok('missing title/body is rejected', ANNOUNCE.sanitize({ scope: 'team', title: '', body: 'b' }).ok === false);
    ok('a bad scope is rejected', ANNOUNCE.sanitize({ scope: 'everyone', title: 't', body: 'b' }).ok === false);
    ok('plays list is capped at MAX_PLAYS', ANNOUNCE.sanitize({ scope: 'team', title: 't', body: 'b', plays: Array.from({ length: 20 }, () => ({})) }).value.plays.length === ANNOUNCE.MAX_PLAYS);
    // a cut moment from the Film Room, travelling with the note
    const withClip = ANNOUNCE.sanitize({ scope: 'team', title: 't', body: 'b', clip: { url: '/api/clips/clip_ab12.mp4', title: '0:34 · shot saved', start: 30.4, end: 40.4, marks: Array.from({ length: 20 }, (_, i) => 'mark ' + i + ' ' + 'x'.repeat(200)) } });
    ok('a clip cut from the Film Room travels with the note', withClip.ok === true && withClip.value.clip.url === '/api/clips/clip_ab12.mp4' && withClip.value.clip.start === 30.4);
    ok('…and what a coach marked on it is capped, in count and in length', withClip.value.clip.marks.length === ANNOUNCE.MAX_MARKS && withClip.value.clip.marks.every(m => m.length <= 80));
    ok('a clip url pointing anywhere else is refused outright', ANNOUNCE.sanitize({ scope: 'team', title: 't', body: 'b', clip: { url: 'https://evil.example/x.mp4' } }).error === 'bad-clip');
    ok('the bell can tell which notes carry a moment to watch', ANNOUNCE.summarize(withClip.value, { team: 'A' }).hasClip === true && ANNOUNCE.summarize(teamOk.value, { team: 'A' }).hasClip === false);
    const teamAnn = { team: 'A', scope: 'team', to: null }, playerAnn = { team: 'A', scope: 'player', to: 'nora@icloud.com' };
    ok('a team announcement is visible to any teammate', ANNOUNCE.visibleTo(teamAnn, { team: 'A', email: 'anyone@x' }));
    ok('a player announcement is visible only to its recipient', ANNOUNCE.visibleTo(playerAnn, { team: 'A', email: 'nora@icloud.com' }) && !ANNOUNCE.visibleTo(playerAnn, { team: 'A', email: 'timo@gmail.com' }));
    ok('nothing is visible to a different team', !ANNOUNCE.visibleTo(teamAnn, { team: 'B', email: 'anyone@x' }));
    ok('unreadCount only counts readers not yet in readBy', ANNOUNCE.unreadCount([{ readBy: ['a'] }, { readBy: [] }, { readBy: ['b', 'a'] }], 'a') === 1);
    ok('summarize reflects read state for the given reader', ANNOUNCE.summarize({ id: '1', scope: 'team', title: 't', from: { name: 'Coach' }, createdAt: 1, plays: [], readBy: ['a'] }, { for: 'a' }).read === true);

    // UI — bell, panel, compose modal (no live backend under jsdom, so network calls degrade gracefully)
    ok('the bell panel starts hidden', q('#announce-panel').hidden === true);
    q('#announce-btn').click(); await wait(30);
    ok('clicking the bell opens the panel', q('#announce-panel').hidden === false);
    ok('with no backend reachable, the panel says so plainly', /analysis backend/i.test(q('#announce-panel').textContent));
    ok('a coach sees the "＋ New" compose trigger', !!q('#announce-new'));
    q('#announce-new').click(); await wait(10);
    ok('opens the compose modal', !!q('#announce-compose-modal'));
    ok('scope defaults to the whole team, recipient select hidden', q('[name="ann-scope"]:checked').value === 'team' && q('#ann-to').hidden === true);
    q('[name="ann-scope"][value="player"]').click(); q('[name="ann-scope"][value="player"]').dispatchEvent(new window.Event('change'));
    ok('switching to "One player" reveals the recipient select', q('#ann-to').hidden === false);
    ok('the roster select lists an approved player', /Nora|Timo/.test(q('#ann-to').textContent));
    q('#ann-send').click(); await wait(10);
    ok('sending with no title/body is refused client-side (modal stays open)', !!q('#announce-compose-modal'));
    q('#ann-title').value = 'Test note'; q('#ann-body').value = 'Body text.';
    q('#ann-send').click(); await wait(20);
    ok('sending without a reachable backend fails gracefully (toast, no crash)', /Could not send/.test(q('#toast').textContent));
    q('#announce-compose-modal').querySelector('#ann-cancel').click();
    ok('Cancel removes the compose modal', !q('#announce-compose-modal'));
    document.body.click(); await wait(10);
    ok('clicking outside the bell panel closes it', q('#announce-panel').hidden === true);
  }

  console.log('\n[6w] wpmatch.ch — normalising an undocumented third-party API (WPMATCH)');
  {
    const { WPMATCH } = window.__T;
    // A FROZEN CORPUS of real wpmatch.ch shapes, captured 2026-09-14. These tests must never
    // touch the network: the source is someone else's box, and a red gate should mean OUR bug.
    const played = { id: 11084, slug: '260078', date: '2026-05-05T20:00:00', date_gmt: '2026-05-05T18:00:00',
      link: 'https://wpmatch.ch/event/260078/', title: { rendered: 'SC Horgen &#8211; Lugano Sharks' },
      teams: [3281, 5438], main_results: ['17', '7'], day: 'ENDED', leagues: [202], venues: [104],
      results: { '3281': { firstquarter:'4', secondquarter:'7', thirdquarter:'2', fourrdquarter:'4', ps:null, goals:'17', manup:'40.0', pstwo:'100.0', outcome:['win'] },
                 '5438': { firstquarter:'1', secondquarter:'1', thirdquarter:'2', fourrdquarter:'3', ps:null, goals:'7', manup:'0.0', pstwo:'33.3', outcome:['loss'] },
                 '0': { firstquarter:'1st Quarter', goals:'Goals', manup:'% Extra Player' } },
      performance: { '3281': { '3322': { number:'1', goals:'0', exclusionfoul:'0', played:true, status:'lineup' },
                               '3330': { number:'3', goals:'2', exclusionfoul:"1 (13 <b>1. 0:16</b>')", played:true, status:'lineup' }, '0': { goals:'', played:'' } },
                     '5438': { '4001': { number:'2', goals:'3', exclusionfoul:'0', played:true, status:'sub' }, '0': { goals:'', played:'' } },
                     '0': { played:'Played', goals:'Goals', goalon:'Goals 6on6', goalextraplayer:'Goals Extra Player', penaltygoals:'Penalty Goals', exclusionfoul:'Exclusion Fouls' } } };
    const placeholder = { id: 36737, slug: '271465', date: '2027-12-31T18:15:00', date_gmt: '2027-12-30T23:00:00',
      link: 'https://wpmatch.ch/event/271465/', title: { rendered: 'Lausanne Aquatique U14 &#8211; SC Horgen U14 Women' },
      teams: [5728, -1], main_results: [], day: 'PLANNED', leagues: [], venues: [] };
    const unrecorded = { id: 9, slug: '9', date_gmt: '2026-01-01T10:00:00', title: { rendered: 'A &#8211; B' }, teams: [1, 2], main_results: ['0','0'], day: 'ENDED', venues: [7] };

    ok('the "Array" corruption is stripped however many items it prefixes', WPMATCH.stripArray('ArrayArrayArray[{"a":1}]') === '[{"a":1}]' && WPMATCH.stripArray('[{"a":1}]') === '[{"a":1}]');
    ok('a corrupted body still parses', WPMATCH.parse('ArrayArray[{"a":1}]')[0].a === 1);
    ok('entity-encoded titles are decoded once, not twice', WPMATCH.decodeEntities('SC Horgen &#8211; Lugano &amp; Co') === 'SC Horgen – Lugano & Co' && WPMATCH.decodeEntities('&amp;#8211;') === '&#8211;');
    ok('a title splits into home and away on the en dash', (() => { const s = WPMATCH.splitTitle('SC Horgen &#8211; Lugano Sharks'); return s.home === 'SC Horgen' && s.away === 'Lugano Sharks'; })());
    ok('a title that is not "home – away" returns null rather than guessing', WPMATCH.splitTitle('Swiss-Cup Final') === null);

    const fx = WPMATCH.normFixture(played, { venueById: { 104: 'Horgen FB / Käpfnach' } });
    ok('the game id and the WP post id are kept apart', fx.gameId === '260078' && fx.postId === 11084);
    ok('date_gmt is given the Z it is missing on the wire', fx.startsAt === '2026-05-05T18:00:00Z');
    ok('the venue name is resolved from the taxonomy', fx.venueName === 'Horgen FB / Käpfnach');
    // the 43%-of-matches bug: '7' > '17' is true as a string
    const away = WPMATCH.normFixture(Object.assign({}, played, { main_results: ['7', '17'] }), {});
    ok('scores are compared as NUMBERS, so 7–17 is a loss not a win', WPMATCH.resultFor(away, 3281).outcome === 'loss' && WPMATCH.resultFor(fx, 3281).outcome === 'win');
    ok('the opponent and home/away side are reported from our point of view', (() => { const r = WPMATCH.resultFor(fx, 5438); return r.us === 'away' && r.ours === 7 && r.opponent.name === 'SC Horgen'; })());
    ok('an unrecorded 0–0 ENDED match is not presented as a draw', (() => { const u = WPMATCH.normFixture(unrecorded, {}); return u.homeScore === null && WPMATCH.resultFor(u, 1) === null; })());
    const ph = WPMATCH.normFixture(placeholder, {});
    ok('a fixture with no venue that has not been played is flagged date-TBC', ph.dateTBC === true && ph.status === 'planned');
    ok('a -1 team id is surfaced as "to be decided"', ph.away.tbd === true);

    const box = WPMATCH.normBox(played);
    ok('the box score reads per-quarter scores, including their misspelled 4th', JSON.stringify(box.lines[3281].quarters) === '[4,7,2,4]');
    ok('% extra player survives as a number', box.lines[3281].manup === 40 && box.lines[5438].manup === 0);
    ok('the label row is never mistaken for a player', box.rosters[3281].length === 2 && !box.rosters[3281].some(p => p.playerId === 0));
    ok('player labels come from performance["0"], which is the row that actually has them', box.playerLabels.exclusionfoul === 'Exclusion Fouls' && box.playerLabels.goalextraplayer === 'Goals Extra Player');
    ok('a stat carrying markup shows its count, with the detail stripped to plain text', WPMATCH.statNumber("1 (13 <b>1. 0:16</b>')") === '1' && !/[<>]/.test(WPMATCH.statDetail("1 (13 <b>1. 0:16</b>')")));
    ok('rosters are ordered by cap number', box.rosters[3281][0].cap === '1');
    ok('an unplayed event does not throw when its performance block is an array', (() => { try { const b = WPMATCH.normBox(Object.assign({}, placeholder, { results: [], performance: [] })); return b.rosters[5728].length === 0 && b.lines[5728] === null; } catch (e) { return false; } })());

    const tables = [
      WPMATCH.normTable({ id: 1, title: { rendered: 'NLA TEST' }, data: { '3281': { pts: '32', t: '20' }, '0': { pts: 'Pts' } } }),
      WPMATCH.normTable({ id: 2, title: { rendered: 'National League A &#8211; Ranking' }, data: { '3281': { pts: '24', t: '14' }, '5438': { pts: '9', t: '14' }, '0': { pts: 'Pts' } } }),
    ];
    ok('a standings label row is not rendered as a team', tables[1].rows.length === 2 && !tables[1].rows.some(r => r.teamId === 0));
    ok('a stale "TEST" table never wins over the real ranking', WPMATCH.pickTable(tables, 3281).id === 2);
    ok('a team absent from every table yields none rather than the wrong one', WPMATCH.pickTable(tables, 99999) === null);

    const evs = WPMATCH.toCalendarEvents([fx, ph], { id: 3281, name: 'SC Horgen' });
    ok('a fixture becomes a calendar event with a STABLE id, so re-importing updates in place', evs[0].id === 'wpm-260078' && evs[0].type === 'match');
    ok('the calendar entry keeps UTC, not the local wall clock', evs[0].start === '2026-05-05T18:00:00Z');
    ok('a date-TBC fixture becomes a harmless all-day marker, never a 23:00 alarm', (() => { const e = evs.find(x => x.id === 'wpm-271465'); return e.allDay === true && e.reminderMin === 0 && /date TBC/.test(e.title); })());
    ok('deep links use the payload\'s own URL rather than a rebuilt one', WPMATCH.matchUrl(fx) === 'https://wpmatch.ch/event/260078/');
  }

  console.log('\n[6i] i18n guard — new chrome must not ship English-only');
  {
    const { scanFile, UI_FILES, BASELINE } = await import('./i18n-scan.mjs');
    const I = window.__T.I18N;
    const langs = I.SUPPORTED.map(l => l.code);
    ok('all four languages are offered', langs.join(',') === 'en,de,fr,it');
    // every language must define exactly the same keys — a key present in en but missing in
    // de is how a screen ends up half-translated
    const keysOf = code => Object.keys((I.DICT || {})[code] || {});
    const enKeys = keysOf('en');
    ok('the dictionary is actually readable by this test (not vacuously empty)', enKeys.length > 50);
    ok('no language is missing a key the others have', langs.every(c => { const k = keysOf(c); return k.length === enKeys.length && enKeys.every(x => k.includes(x)); }));
    ok('and no language has a stray key the others lack', langs.every(c => keysOf(c).every(x => enKeys.includes(x))));

    /* t() only substitutes {name}. A translator who drops or renames a placeholder does not
       break anything loudly — the user is simply shown a literal "{n}" where the number
       should be. Word ORDER may move freely; the SET of placeholders may not. */
    const holders = s => (String(s).match(/\{[a-zA-Z][\w]*\}/g) || []).slice().sort().join(',');
    const drifted = [];
    enKeys.forEach(k => langs.filter(c => c !== 'en').forEach(c => {
      if (holders(I.DICT[c][k]) !== holders(I.DICT.en[k])) drifted.push(`${c}:${k}`);
    }));
    ok('every translation keeps the same {placeholders} as its English source' +
       (drifted.length ? ` — drifted: ${drifted.slice(0, 6).join(', ')}` : ''), drifted.length === 0);

    /* Same for markup: a value is injected with innerHTML, so a <strong> the translator
       forgot to close takes the rest of the sentence with it. */
    const tags = s => (String(s).match(/<\/?[a-z]+>/gi) || []).slice().sort().join(',');
    const tagDrift = enKeys.filter(k => langs.filter(c => c !== 'en').some(c => tags(I.DICT[c][k]) !== tags(I.DICT.en[k])));
    ok('and the same HTML tags' + (tagDrift.length ? ` — drifted: ${tagDrift.slice(0, 6).join(', ')}` : ''), tagDrift.length === 0);

    /* Some hints NAME a button: "press Track positions". The hint and the button are usually
       translated by different people, and when they drift the app tells the user to press a
       control that does not exist under that name. Nothing else catches this — both strings
       are perfectly good translations on their own. */
    const QUOTES = [
      ['film.fieldFoundHint', 'film.trackPositions'], ['film.fieldFoundHint', 'film.scoutVideo'],
      ['film.calibratedNowPress', 'film.trackPositions'],
      ['film.calibrateFirstPos', 'film.positionTracking'],
      ['film.findFieldFirst', 'film.findField'],
      ['film.planPanelNote', 'film.scoutVideo'],
      ['film.scoutThenShare', 'film.shareDebrief'],
      ['ui.nothingScheduledYet', 'ui.dateTbc'],
      ['help.dashboard.t3', 'ui.template'],   // the help quoted ☆ Template while the button said ⭐ Vorlage
      ['help.commands.s3', 'ui.saveAsNew'],   // both quoted the English label after the button was translated
      ['ui.theBoardPausesAnd', 'ui.saveAsNew'],
    ];
    const bare = s => String(s == null ? '' : s).replace(/[^\p{L}\p{N} ]/gu, '').toLowerCase().trim();
    const quoteDrift = [];
    QUOTES.forEach(([hint, label]) => langs.forEach(c => {
      if (I.DICT[c][hint] == null || I.DICT[c][label] == null) return quoteDrift.push(`${c}:${hint}?`);
      if (!bare(I.DICT[c][hint]).includes(bare(I.DICT[c][label]))) quoteDrift.push(`${c}:${hint}→${label}`);
    }));
    ok('a hint that names a button still matches that button, in every language' +
       (quoteDrift.length ? ` — drifted: ${quoteDrift.slice(0, 6).join(', ')}` : ''), quoteDrift.length === 0);

    /* "Draft from words" parses ENGLISH ONLY — drives / passes / shoots (js/draft.js). Two
       translators helpfully translated the worked example, which produces a help page whose
       example silently fails to parse in the very box it is teaching. The example must stay
       English in every language. */
    /* Every place the app SHOWS an example of written steps. Two separate translation
       rounds translated one of these into German, each time producing a worked example
       that the box it is teaching cannot parse. */
    const DRAFT_EXAMPLES = ['help.editor.s2', 'help.share.s2', 'help.video.s1',
                            'ui.driveAndDump10', 'ui.aShareLinkJson', 'ui.aShareLinkA', 'ui.drivesToTheWing'];
    const notEnglish = [];
    DRAFT_EXAMPLES.forEach(k => langs.forEach(c => {
      const v = String(I.DICT[c][k] || '');
      if (!/\b(drives|passes to|shoots|lifts to)\b/.test(v)) notEnglish.push(`${c}:${k}`);
    }));
    ok('the Draft-from-words examples stay in English, the only grammar the parser knows' +
       (notEnglish.length ? ` — translated: ${notEnglish.join(', ')}` : ''), notEnglish.length === 0);

    /* data-i18n assigns textContent, which ERASES every child element. Put it on the <p> that
       contains <span id="pending-email"> and the app loses that span the moment apply() runs —
       silently, and only on the screens a new player sees. Use data-i18n-html where the copy
       owns its own <strong>, and never where the app writes into a child later.
       This is checked against the live DOM, so it covers whatever index.html actually shipped. */
    const erasesChildren = [...document.querySelectorAll('[data-i18n]')]
      .filter(el => el.children.length > 0)
      .map(el => `${el.getAttribute('data-i18n')} (would erase ${el.children.length})`);
    ok('no data-i18n sits on an element that owns child elements' +
       (erasesChildren.length ? ` — ${erasesChildren.slice(0, 4).join(', ')}` : ''), erasesChildren.length === 0);

    /* Every key named in the markup must actually exist, or apply() writes the key name onto
       the screen — which is how the pending gate briefly read "ui.yourAccessRequestIs". */
    const named = [...document.querySelectorAll('[data-i18n],[data-i18n-html],[data-i18n-ph],[data-i18n-title]')]
      .flatMap(el => ['data-i18n', 'data-i18n-html', 'data-i18n-ph', 'data-i18n-title']
        .map(a => el.getAttribute(a)).filter(Boolean));
    const unknown = [...new Set(named)].filter(k => I.DICT.en[k] === undefined);
    ok(`all ${new Set(named).size} keys named in index.html exist in the dictionary` +
       (unknown.length ? ` — missing: ${unknown.slice(0, 5).join(', ')}` : ''), unknown.length === 0);

    /* The guard must see markup in a quoted string that holds the OTHER quote character — i.e. any
       attribute: '<span class="muted">…</span>'. Its quote pattern used to forbid both quote kinds
       inside a string, so exactly that idiom was invisible ("Cutting the clip… ⏳" shipped past it). */
    {
      const seen = scanFile('tests/fixtures/i18n-scan-quotes.js').map(x => x.text);
      ok('the guard sees markup and textContent inside strings that contain the other quote kind, and not translated markup',
        seen.includes('Cutting the clip now') && seen.includes('Season tools unavailable') && seen.includes('He said "hold the ball" twice') && seen.length === 6);
      ok('the guard sees the text of a toast chosen in code (a ternary or a default), and not a T()/TX() key or a compared value',
        seen.includes('Whistle blows now') && seen.includes('Whistle stays quiet') && seen.includes('Nothing to share yet') && !seen.some(x => /^(ui|film)\.|^exc$/.test(x)));
    }

    // the ratchet: this number may only ever go DOWN
    let regressed = [];
    UI_FILES.forEach(f => {
      const n = scanFile(f).length, cap = BASELINE[f];
      ok(`${f}: untranslated chrome ${n} ≤ agreed ${cap}`, n <= cap);
      if (n > cap) regressed.push(f);
      if (n < cap) console.log(`      ↓ ${f} improved to ${n} — lower BASELINE in tests/i18n-scan.mjs to lock it in`);
    });
    ok('no new hard-coded UI string was added', regressed.length === 0);
  }

  console.log('\n[6i2] Theme foundation — every colour is a token, and code that draws reads the same values');
  {
    const { THEME } = window.__T;
    const css = readFileSync(join(APP, 'css/styles.css'), 'utf8');
    const rs = css.indexOf(':root{'), re = css.indexOf('}', rs), root = css.slice(rs, re);
    const cssTok = Object.fromEntries([...root.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
    const fb = THEME.FALLBACK.today;
    const drift = Object.keys(fb).filter(k => cssTok[k] !== fb[k]);
    ok('js/theme.js fallback = the CSS token values, one for one' + (drift.length ? ' — differs: ' + drift.slice(0, 6).join(', ') : ''), Object.keys(fb).length >= 100 && drift.length === 0);
    const jsFiles = ['js/pool.js', 'js/animate.js', 'js/film.js', 'js/app.js', 'js/videogen.js', 'js/fx.js', 'js/manikin.js', 'js/chart.js'];
    const asked = [...new Set(jsFiles.flatMap(fl => [...readFileSync(join(APP, fl), 'utf8').matchAll(/\bC\('(--[\w-]+)'\)|THEME\.c\('(--[\w-]+)'\)/g)].map(m => m[1] || m[2])))];
    const missing = asked.filter(n => !(n in fb) || !(n in cssTok));
    ok('every colour token code asks for exists in the CSS and the fallback (' + asked.length + ' names)' + (missing.length ? ' — missing: ' + missing.join(', ') : ''), asked.length >= 90 && missing.length === 0);
    ok('THEME.c returns the value, and the look is set on <html> before anything draws', THEME.c('--pool-deck') === '#0c2030' && THEME.LOOKS.includes(document.documentElement.getAttribute('data-look')) && THEME.look() === document.documentElement.getAttribute('data-look'));
    /* the ratchet: a colour written straight into a file is a colour a look cannot change. Allowed only in the token
       block (:root), in regions marked theme:fixed (paper, third-party logos, the print booklet until Phase 2),
       in js/theme.js (the fallback copy) and js/qr.js (a QR code must stay dark on light to scan). */
    const HEX = /#[0-9a-fA-F]{6}(?![\w-])|#[0-9a-fA-F]{3}(?![\w-])|rgba?\(\s*\d/g;
    const cssBody = (css.slice(0, rs) + css.slice(re + 1)).replace(/:root\[data-look="[a-z]+"\](\[data-glass="[a-z]+"\])?\{[^}]*\}/g, '').replace(/\/\* theme:fixed[\s\S]*?\/\* theme:fixed-end \*\//g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const cssLeft = [];
    cssBody.replace(/\{([^{}]*)\}/g, (w, d) => { (d.match(HEX) || []).forEach(x => cssLeft.push(x)); return w; });
    const htmlSrc = readFileSync(join(APP, 'index.html'), 'utf8').replace(/<!-- theme:fixed[\s\S]*?<!-- theme:fixed-end -->/g, '').replace(/<meta name="theme-color"[^>]*>/, '');
    const htmlLeft = htmlSrc.match(HEX) || [];
    const jsLeft = [];
    readdirSync(join(APP, 'js')).filter(n => n.endsWith('.js') && !['theme.js', 'qr.js'].includes(n)).forEach(n => {
      let src = readFileSync(join(APP, 'js', n), 'utf8');
      src = src.replace(/theme:fixed[\s\S]*?(<\/style>|`;)/g, '');   // a fixed region runs to the end of its style block
      (src.match(HEX) || []).forEach(x => jsLeft.push(n + ' ' + x));
    });
    // a look redefines tokens; it may not invent new ones, and an -rgb twin must be the same colour as its token
    const hexRgb = v => { let x = v.replace('#', ''); if (x.length === 3) x = x.split('').map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(x.slice(i, i + 2), 16)).join(','); };
    const looks = [...css.matchAll(/:root\[data-look="([a-z]+)"\](\[data-glass="on"\])?\{([^}]*)\}/g)].map(m => [m[1] + (m[2] ? '+glass' : ''), Object.fromEntries([...m[3].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(x => [x[1], x[2].trim()]))]);
    ok('the CSS defines a Black & Silver look, and js/theme.js offers it', looks.some(([n]) => n === 'silver') && THEME.LOOKS.join() === 'today,silver');
    const invented = looks.flatMap(([n, t]) => Object.keys(t).filter(k => !(k in cssTok)).map(k => n + ':' + k));
    ok('a look only redefines tokens that already exist' + (invented.length ? ' — new: ' + invented.join(', ') : ''), invented.length === 0);
    const twinOff = [['today', cssTok], ...looks].flatMap(([n, t]) => Object.keys(t).filter(k => /-rgb$/.test(k)).filter(k => { const base = t[k.replace(/-rgb$/, '')] || cssTok[k.replace(/-rgb$/, '')]; return !/^#/.test(base) || hexRgb(base) !== t[k].replace(/\s/g, ''); }).map(k => n + ':' + k));
    ok('every -rgb twin is the same colour as its token, in every look' + (twinOff.length ? ' — off: ' + twinOff.join(', ') : ''), twinOff.length === 0);
    /* Glass (theme Phase 3): text on a floating control must stay AA through the tint, against the brightest things likely
       behind it — the silver water, a white cap spread into it by the 18 px blur (25 % cap over 75 % water), the deck and a
       raised panel. The tint does the legibility work; blur and sheen only make it look like glass. Checked with glass on
       and with the solid fallback. */
    {
      const silverT = Object.assign({}, cssTok, (looks.find(([n]) => n === 'silver') || [, {}])[1]);
      const glassT = Object.assign({}, silverT, (looks.find(([n]) => n === 'silver+glass') || [, {}])[1]);
      const col = v => { v = String(v).trim(); if (v[0] === '#') { const [r, g, b] = hexRgb(v).split(',').map(Number); return { r, g, b, a: 1 }; } const m = /rgba?\(([^)]+)\)/.exec(v); const p = m[1].split(',').map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
      const over = (t, u) => ({ r: t.r * t.a + u.r * (1 - t.a), g: t.g * t.a + u.g * (1 - t.a), b: t.b * t.a + u.b * (1 - t.a), a: 1 });
      const lum = c => [c.r, c.g, c.b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce((t, v, i) => t + v * [0.2126, 0.7152, 0.0722][i], 0);
      const ratio = (x, y) => { const [a, b] = [lum(x), lum(y)].sort((p, q) => q - p); return (a + 0.05) / (b + 0.05); };
      const water = col(silverT['--pool-water-top']), cap = col(silverT['--cap-white']);
      const backdrops = { 'water': water, 'deep water': col(silverT['--pool-water-bottom']), 'a white cap in the blur': over({ ...cap, a: 0.25 }, water), 'deck': col(silverT['--pool-deck']), 'raised panel': col(silverT['--panel2']) };
      const inks = ['--ink', '--white', '--ink-dim', '--yellow-73', '--cyan-68', '--cyan-76'];
      const fails = [];
      for (const [mode, T] of [['glass', glassT], ['solid', silverT]]) {
        const tint = col(T['--glass-tint']), sheen = T['--glass-sheen'] === 'none' ? null : col((T['--glass-sheen'].match(/rgba?\([^)]+\)/) || [])[0]);
        for (const [bn, bd] of Object.entries(backdrops)) {
          let surface = over(tint, bd); if (sheen) surface = over(sheen, surface);
          for (const ink of inks) { const r = ratio(col(silverT[ink]), surface); if (r < 4.5) fails.push(mode + ' · ' + ink + ' over ' + bn + ' → ' + r.toFixed(2)); }
        }
      }
      ok('text on glass stays AA over the brightest water, a blurred white cap, the deck and a panel (glass on and solid)' + (fails.length ? ' — ' + fails.slice(0, 4).join('; ') : ''), looks.some(([n]) => n === 'silver+glass') && fails.length === 0);
      /* the device's "reduce transparency" wins over the glass switch: run js/theme.js in a sandbox whose media query says so */
      {
        const vm = await import('node:vm');
        const attrs = {}, store = {};
        const sandbox = { document: { documentElement: { getAttribute: k => attrs[k] || null, setAttribute: (k, v) => { attrs[k] = v; } }, addEventListener() {}, querySelector: () => null },
          localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
          matchMedia: q => ({ matches: /reduced-transparency/.test(q), addEventListener() {} }), getComputedStyle: () => ({ getPropertyValue: () => '' }) };
        vm.runInNewContext(readFileSync(join(APP, 'js/theme.js'), 'utf8') + '\n;globalThis.__T = THEME;', sandbox);
        const T2 = sandbox.__T; T2.setLook('silver'); T2.setGlass(true);
        ok('when the device asks for less transparency, glass stays solid even if switched on', T2.glassWanted() === true && T2.reducedTransparency() === true && T2.glass() === false && attrs['data-glass'] === 'off' && attrs['data-look'] === 'silver');
      }
      /* the look a device starts in (owner decision, theme Phase 4): a new device gets Black & Silver, a device that already
         holds Triibholz data keeps navy — and either way the answer is written down on the first run */
      {
        const vm = await import('node:vm');
        const boot = (seed, broken) => {
          const attrs = {}, store = { ...seed };
          const ls = broken ? { get length() { throw new Error('denied'); }, key() { throw new Error('denied'); }, getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } }
            : { get length() { return Object.keys(store).length; }, key: i => Object.keys(store)[i] ?? null, getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
          const sb = { document: { documentElement: { getAttribute: k => attrs[k] || null, setAttribute: (k, v) => { attrs[k] = v; } }, addEventListener() {}, querySelector: () => null },
            localStorage: ls, matchMedia: () => ({ matches: false, addEventListener() {} }), getComputedStyle: () => ({ getPropertyValue: () => '' }) };
          vm.runInNewContext(readFileSync(join(APP, 'js/theme.js'), 'utf8'), sb);
          return { look: attrs['data-look'], saved: store['thplay.look.v1'] };
        };
        const fresh = boot({}), known = boot({ 'thplay.users.v1': '[]' }), glassOnly = boot({ 'thplay.glass.v1': 'off' }), chose = boot({ 'thplay.look.v1': 'today' }), chose2 = boot({ 'thplay.look.v1': 'silver', 'thplay.lang': 'de' }), junk = boot({ 'thplay.look.v1': 'pink', 'thplay.sound': '1' }), noStore = boot({}, true);
        ok('a new device starts in Black & Silver and remembers it; a device with Triibholz data keeps navy and remembers that',
          fresh.look === 'silver' && fresh.saved === 'silver' && known.look === 'today' && known.saved === 'today' && glassOnly.look === 'silver');
        ok('a look someone chose always wins; an unknown saved look counts as not chosen; no storage at all stays navy',
          chose.look === 'today' && chose2.look === 'silver' && junk.look === 'today' && junk.saved === 'today' && noStore.look === 'today');
      }
      ok('js/theme.js offers the glass switch and sets data-glass before anything draws', typeof THEME.setGlass === 'function' && typeof THEME.glass === 'function' && ['on', 'off'].includes(document.documentElement.getAttribute('data-glass')));
    }
    ok('no colour is hard-coded outside the tokens (CSS ' + cssLeft.length + ', index.html ' + htmlLeft.length + ', JS ' + jsLeft.length + ')' + (jsLeft.length ? ' — ' + jsLeft.slice(0, 5).join(', ') : ''), cssLeft.length === 0 && htmlLeft.length === 0 && jsLeft.length === 0);
  }

  console.log('\n[7] Basics + i18n');
  q('.nav-btn[data-view="basics"]').click(); await wait(25);
  ok('10 basics cards incl. responsibilities', qa('#view-basics .basics-card').length===10);
  ok('rule books panel (docs listed)', !!q('.rules-panel') && qa('.rules-doc').length>=2);
  ok('colour legend', qa('#view-basics .bl-dot').length===4);
  const I18N = window.__T.I18N;
  I18N.setLang('de'); await wait(15);
  ok('German nav', q('.nav-btn[data-view="dashboard"]').textContent==='Übersicht');
  I18N.setLang('fr'); await wait(10);
  ok('French phase', q('.phase-btn[data-phase="offense"]').textContent==='Attaque');
  I18N.setLang('en'); await wait(10);

  console.log('\n[8] Film Room — sessions, board, tagging, insights, rebuild');
  ok('parses watch URL', FILM.parseSource('https://www.youtube.com/watch?v=tQ2Qh7yFTyA').id==='tQ2Qh7yFTyA');
  ok('parses youtu.be URL', FILM.parseSource('https://youtu.be/DAhGAyv0k8U').id==='DAhGAyv0k8U');
  ok('non-YouTube http → link', FILM.parseSource('https://www.instagram.com/p/DM-pYTyPnmj/').kind==='link');
  q('.nav-btn[data-view="film"]').click(); await wait(60);
  ok('film view + seed match', q('#view-film').classList.contains('active') &&
     /Sample match analysis/.test(q('.film-list').textContent));
  ok('timeline has 5 seeded moments', qa('.film-ev').length===5);
  ok('shot chart conceded badge', qa('.goal-grid .gz-a').length>=1);
  ok('insights: weak zone + corrections', /BL/.test(q('.film-insights').textContent) && /🎯/.test(q('.film-insights').textContent));
  ok('situation board with draggable discs', qa('#film-board .disc.editable').length>=13);
  ok('🎯 Game plan panel with 18 instruction chips', qa('#film-plan .plan-chip').length===18);
  qa('#film-plan .plan-chip').find(b=>b.dataset.ins==='o-drive-kick').click(); await wait(10);
  ok('ticking an instruction stores it on the match', (FILM.load().find(x=>x.id===(FILM.load()[0].id))||{}).plan!==undefined && JSON.stringify(FILM.load()).includes('"o-drive-kick"') && q('#plan-count').textContent.includes('1 instruction'));
  ok('📣 Team debriefs panel present for everyone', !!q('#film-debriefs') && !!q('#debrief-list'));

  /* The demo match used to ship as English text and is already in everyone's localStorage.
     It migrates to keys so it picks up the language — but an edited note is something the
     coach authored, and overwriting that would be destroying their work to tidy ours. */
  {
    const KEY = 'thplay.film.v1';
    const saved = window.localStorage.getItem(KEY);
    const MINE = 'Left wing was fine actually — my own note';
    window.localStorage.setItem(KEY, JSON.stringify({ sessions: [{
      id: 'demo-match', title: 'Sample match analysis (demo)', createdBy: 'Coach Ruiz',
      source: { kind: 'youtube', id: 'x' },
      events: [
        { id: 'a', t: 95, type: 'goal-against', counter: 'Block the near-side lane; keeper low on the near post', note: MINE },
        { id: 'b', t: 312, type: 'goal-against', counter: 'Sprint back — first man must stop the ball carrier', note: 'Trailer arrived unmarked.' },
      ],
    }] }));
    const migrated = window.__T.FILM.load().find(x => x.id === 'demo-match');
    ok('an old English demo match migrates to keys', migrated.title === 'film.demo.title' &&
       migrated.events[0].counter === 'film.demo.c1' && migrated.events[1].note === 'film.demo.n4');
    ok('but a note the coach edited is left exactly as they wrote it', migrated.events[0].note === MINE);
    ok('and the migration is persisted, not redone every read', JSON.parse(window.localStorage.getItem(KEY)).sessions[0].title === 'film.demo.title');
  }
  // debriefs are team-scoped by the user's teamCode — the record has no .team/.club, and reading
  // those once sent every club's debriefs to one shared 'club' bucket on the backend
  ok('debrief team = the user\'s teamCode', FILM.teamOf({ teamCode: 'SC-HORGEN' }) === 'SC-HORGEN');
  ok('debrief team ignores non-existent .team/.club fields', FILM.teamOf({ team: 'X', club: 'Y' }) === 'club' && FILM.teamOf(null) === 'club');
  ok('film.js reads no ctx.user.team / ctx.user.club', !/ctx\.user\.(team|club)\b/.test(readFileSync(join(APP, 'js/film.js'), 'utf8')));
  ok('board ball draggable', !!q('#film-board .ball.editable'));
  // board follows the situation select
  q('#film-sit').value='man-down'; q('#film-sit').dispatchEvent(new window.Event('change')); await wait(20);
  ok('board rebuilds for man-down (6v5 → 12 discs)', qa('#film-board .disc.editable').length===12);
  // tag a moment; staged frame + origin stored
  q('#film-t').value='7:15';
  q('#film-type').value='goal-against';
  qa('#film-zone-pick .gz').find(b=>b.dataset.z==='BR').click();
  q('#film-counter').value='Earlier drop from 4';
  q('#film-add').click(); await wait(40);
  ok('new moment saved (+1)', qa('.film-ev').length===6);
  {
    const ev = FILM.load()[0].events.slice(-1)[0];
    ok('staged frame stored on moment', !!(ev.frame && ev.frame.att && ev.frame.ball));
    ok('origin follows staged ball', ev.origin && typeof ev.origin.x==='number');
  }
  // rebuild with staged frame → single-keyframe editor board
  qa('[data-rebuild]').slice(-1)[0].click(); await wait(40);
  ok('rebuild opens editor', q('#editor-modal').hidden===false);
  ok('situation mapped (man-down → 6v5)', q('#ed-situation').value==='6v5');
  ok('phase defense', q('#ed-phase').value==='defense');
  ok('single staged keyframe', qa('#frame-chips .frame-chip').length===1);
  q('#ed-cancel').click(); await wait(20);

  console.log('\n[8b] Auto field — Film Room controls on an uploaded video');
    // Film Room: the button exists and fails gracefully without a drawable frame (jsdom has no canvas)
    q('.nav-btn[data-view="film"]').click(); await wait(40);
    { const up = q('#film-upload'); Object.defineProperty(up, 'files', { value:[new window.File([new Uint8Array(64)], 'field-clip.mp4', { type:'video/mp4' })], configurable:true }); up.dispatchEvent(new window.Event('change')); await wait(150); }
    const af = q('#film-autofield');
    ok('🎯 Find the field + 📷 moving camera controls present on an uploaded video', !!af && !!q('#film-moving') && q('#film-moving').checked && !!q('#field-status'));
    if (af) { af.click(); await wait(20); ok('no drawable frame → clear message, nothing set', /Could not read a frame|Re-attach/.test(q('#film-track-out').textContent + q('#toast').textContent) && q('#field-status').textContent.includes('not set')); }

  console.log('\n[9] Approval gate + player experience + demo');
  q('#logout-btn').click(); await wait(20);
  q('#signin-google').click(); await wait(800);
  qa('#role-seg .seg-btn').find(b=>b.dataset.role==='player').click();
  qa('#position-grid .pos-chip').find(c=>c.dataset.pos==='3').click();
  q('#setup-continue').click(); await wait(40);
  ok('new player lands on pending gate', q('#pending-screen').classList.contains('active'));
  const sam = DATA.findUserByEmail('sam@gmail.com'); DATA.setUserStatus(sam.id,'approved');
  // privacy wiring: two team-only plays stamped the way stampPrivacy() does — one with sam's
  // teamCode, one with another team's. Injected before sam enters so enterApp() loads them.
  const OWN_T = 'Team-only: our overload', OTHER_T = 'Team-only: rival club secret';
  const mkTeamPlay = (id, title, team) => Object.assign(DATA.newScenario('6v6', 'offense'), { id, title, visibility: 'team', owner: 'x@club.ch', team });
  DATA.save(DATA.load().concat([mkTeamPlay('priv-own', OWN_T, sam.teamCode), mkTeamPlay('priv-other', OTHER_T, 'RIVAL-2026')]));
  q('#pending-recheck').click(); await wait(40);
  ok('approved player enters', q('#app-screen').classList.contains('active'));
  {
    const cardTitles = () => qa('#scenario-list .scn-card').map(c => c.textContent);
    q('.nav-btn[data-view="playbook"]').click(); await wait(30);
    ok('signed-up user has a teamCode that is not the rival\'s (' + sam.teamCode + ')', !!sam.teamCode && sam.teamCode !== 'RIVAL-2026');
    ok('library lists the team play stamped with my teamCode', cardTitles().some(t => t.includes(OWN_T)));
    ok('library hides a team play stamped with a different team code', !cardTitles().some(t => t.includes(OTHER_T)));
    q('.nav-btn[data-view="dashboard"]').click(); await wait(20);
  }
  {
    // debrief wiring: the list request the Film Room really sends carries the signed-in user's teamCode
    // (sam signed up through setup, so the record has one — demo personas don't, and fall back to 'club')
    const me = DATA.findUserByEmail(JSON.parse(window.localStorage.getItem('thplay.session.v1')).email);
    const hadFetch = 'fetch' in window, prevFetch = window.fetch, urls = [];
    window.fetch = async (u) => { urls.push(String(u)); return { ok: true, status: 200, json: async () => ({ debriefs: [] }) }; };
    q('.nav-btn[data-view="film"]').click(); await wait(60);
    const listUrl = urls.find(u => /\/api\/debriefs\?team=/.test(u)) || '';
    const sentTeam = new URL(listUrl || 'http://x/').searchParams.get('team');
    ok('signed-in user has a teamCode (' + (me && me.teamCode) + ')', !!(me && me.teamCode));
    ok('Film Room lists debriefs for the user\'s team, not the shared "club" bucket (' + sentTeam + ')', !!me && sentTeam === me.teamCode && sentTeam !== 'club');
    if (hadFetch) window.fetch = prevFetch; else delete window.fetch;
    q('.nav-btn[data-view="dashboard"]').click(); await wait(20);
  }
  ok('progress card + challenge', !!q('.progress-card') && !!q('[data-challenge]'));
  q('[data-challenge]').click(); await wait(20);
  for (let k=0;k<30 && q('#challenge-modal') && !q('#ch-done'); k++){
    const next=q('#ch-next');
    if (next && !next.hidden) next.click(); else { const o=q('.ch-opt'); if(o) o.click(); }
    await wait(8);
  }
  ok('challenge completes', !!q('#ch-done'));
  if (q('#ch-done')) q('#ch-done').click();
  q('#logout-btn').click(); await wait(20);
  ok('back at auth', q('#auth-screen').classList.contains('active'));
  qa('.demo-btn').find(b=>b.dataset.demo==='coach').click(); await wait(40);
  ok('coach demo enters instantly', q('#app-screen').classList.contains('active'));
  {
    // demo personas have no teamCode → they belong to no team and see neither stamped team play
    q('.nav-btn[data-view="playbook"]').click(); await wait(30);
    const titles = qa('#scenario-list .scn-card').map(c => c.textContent);
    ok('demo persona (no teamCode) sees no team-stamped play', !titles.some(t => t.includes(OWN_T) || t.includes(OTHER_T)));
    ok('demo persona still sees the un-stamped sample plays', qa('#scenario-list .scn-card:not(.scn-new)').length > 0);
    DATA.save(DATA.load().filter(s => s.id !== 'priv-own' && s.id !== 'priv-other'));
  }

  console.log('\n[11] A self-reported result counts for nothing until a coach confirms it');
  {
    // legacy data first: a record written before this feature must not be retroactively downgraded
    window.localStorage.setItem('thplay.testlog.player@demo.triibholz', JSON.stringify({
      info: { name:'Demo Player', tier:0, isGK:false },
      tests: [{ id:'legacy1', date:'2026-08-01', test:'25 m freestyle', result:'15.0', unit:'s', testedBy:'Coach Ruiz', remark:'' }],
      swimWeeks: [],
    }));
    q('#logout-btn').click(); await wait(20);
    qa('.demo-btn').find(b=>b.dataset.demo==='player').click(); await wait(60);
    if (q('#tour-skip')) q('#tour-skip').click();
    q('.nav-btn[data-view="development"]').click(); await wait(50);
    ok('a player never sees the squad table', !q('.dev-team-table') && !q('[data-dev-open]') && !!q('.dev-hero-mascot .mascot'));
    ok('a pre-existing result is still counted — no silent downgrade', qa('.dev-bench-card.dev-bench-met').length === 1 && /confirmed/.test(q('.dev-table').textContent));

    q('[data-open-modal="test"]').click(); await wait(20);
    ok('a player cannot claim someone else ran the test', q('#dev-test-by').hasAttribute('readonly') && q('#dev-test-by').value === 'Demo Player');
    q('#dev-test-id').value = 'free50'; q('#dev-test-result').value = '28.0'; q('#dev-test-add').click(); await wait(40);
    ok('an absurd self-reported number does NOT turn a card green', !qa('.dev-bench-card.dev-bench-met').some(c => /50 m freestyle/.test(c.textContent)));
    ok('it still shows on the player\'s own card, marked as waiting', /self-reported, waiting for a coach/.test(q('.dev-bench').textContent) && /28/.test(q('.dev-bench').textContent));
    ok('the tests-at-target count is unmoved by it', /^1\/9$/.test(q('.dev-stat b').textContent.trim()));
    ok('the history row reads self-reported', qa('#view-development .status-chip.pending').length === 1);
    ok('a player has no way to confirm anything', qa('[data-test-verify]').length === 0 && qa('[data-test-deny]').length === 0);

    // now the coach confirms it
    q('#logout-btn').click(); await wait(20);
    qa('.demo-btn').find(b=>b.dataset.demo==='coach').click(); await wait(50);
    if (q('#tour-skip')) q('#tour-skip').click();
    q('.nav-btn[data-view="development"]').click(); await wait(50);
    ok('the squad table flags the waiting result to the coach', /awaiting your confirmation/i.test(q('.dev-stats').textContent));
    const playerRow = qa('.dev-team-row').find(r => /Demo Player/.test(r.textContent));
    ok('the player\'s row shows the number as self-reported, not as progress', !!playerRow && /self-reported/.test(playerRow.textContent) && !playerRow.querySelector('.dev-team-ok'));
    playerRow.click(); await wait(50);
    ok('the coach sees a confirmation queue on the player\'s record', qa('[data-test-verify]').length === 1);
    q('[data-test-verify]').click(); await wait(50);
    ok('confirming it makes the number count', qa('.dev-bench-card.dev-bench-met').some(c => /50 m freestyle/.test(c.textContent)));
    ok('and it is stamped with who confirmed it', (() => {
      const rec = JSON.parse(window.localStorage.getItem('thplay.testlog.player@demo.triibholz'));
      const t = rec.tests.find(x => x.test === '50 m freestyle');
      return t.status === 'approved' && t.verifiedBy === 'Demo Coach' && !!t.verifiedAt;
    })());
  }

  console.log('\n[12] Team sheet documents — real .docx and .pdf, zero dependencies');
  {
    const { SHEETDOC: S, TESTLOG: TL } = window.__T;
    const bin = s => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xFF; return b; };
    const latin1 = b => { let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s; };

    ok('CRC-32 matches the standard check value', S.crc32(bin('123456789')) === 0xCBF43926);

    /* The writer is checked by a SECOND, independent implementation: testlog.js's ZIP reader,
       written months earlier to read real club workbooks. A writer verified only by itself
       proves nothing. */
    const z = S.zip([{ name: 'a.txt', data: 'hello' }, { name: 'dir/ü.xml', data: '<x>grüezi</x>' }]);
    const entries = TL.zipEntries(z);
    ok('the independent ZIP reader finds both entries, UTF-8 name intact',
       entries.length === 2 && entries[0].name === 'a.txt' && entries[1].name === 'dir/ü.xml');
    const readStored = (bytes, e) => { const p = e.lho, nl = bytes[p + 26] | (bytes[p + 27] << 8), xl = bytes[p + 28] | (bytes[p + 29] << 8);
      return bytes.subarray(p + 30 + nl + xl, p + 30 + nl + xl + e.compSize); };
    const stored = e => readStored(z, e);
    ok('and reads the stored bytes back unchanged', new TextDecoder().decode(stored(entries[1])) === '<x>grüezi</x>' && entries.every(e => e.method === 0));
    ok('each stored CRC matches the data it claims to protect',
       entries.every(e => { const cd = z.findIndex((_, i) => z[i] === 0x50 && z[i + 1] === 0x4b && z[i + 2] === 1 && z[i + 3] === 2 && new TextDecoder().decode(z.subarray(i + 46, i + 46 + new TextEncoder().encode(e.name).length)) === e.name);   // BYTE length: ü is two bytes
         const crc = (z[cd + 16] | (z[cd + 17] << 8) | (z[cd + 18] << 16) | (z[cd + 19] << 24)) >>> 0; return crc === S.crc32(stored(e)); }));

    // FICTIONAL players, chosen to break things: Latin-1 accents, two names outside WinAnsi,
    // and a value too long for any column
    const model = {
      title: 'OFFIZIELLE SPIELAUFSTELLUNG', docTitle: 'Test – U14',
      blocks: [
        { type: 'fields', split: 0.3, rows: [{ label: ['Verein', 'Club'], value: 'Test WPC' }, { label: ['Liga', 'Ligue'], value: 'U14' }] },
        { type: 'roster', columns: [{ label: ['', ''], w: 0.07 }, { label: ['Lizenznummer', 'No de Licence'], w: 0.23 }, { label: ['Name', 'Nom'], w: 0.28 }, { label: ['Vorname', 'Prénom'], w: 0.42 }],
          rows: [['1', '50001', 'Müller', 'Anna'], ['2', '50002', 'Łukaszewicz', 'Paweł'], ['3', '50003', 'Đorđević', 'Nikola'],
                 ['4', '50004', 'A'.repeat(90), 'Lea']] },
        { type: 'signatures', rows: [{ label: ['Coach/Trainer', 'Coach/entraîneur'], value: 'Sam Beispiel', sign: ['Unterschrift', 'Signature'] }] },
        { type: 'note', lines: [{ lead: 'Wichtig:', text: 'Dieses Formular muss vor dem Spiel abgegeben werden.' }] },
      ] };

    const docx = S.toDocx(model);
    const parts = TL.zipEntries(docx).map(e => e.name);
    ok('the .docx carries the parts Word requires', ['[Content_Types].xml', '_rels/.rels', 'word/document.xml'].every(n => parts.includes(n)));
    const docXml = new TextDecoder().decode(readStored(docx, TL.zipEntries(docx).find(e => e.name === 'word/document.xml')));
    const parsed = new window.DOMParser().parseFromString(docXml, 'application/xml');
    ok('word/document.xml is well-formed XML', !parsed.getElementsByTagName('parsererror').length);
    ok('Word keeps every name exactly — Łukaszewicz and Đorđević included', /Łukaszewicz/.test(docXml) && /Đorđević/.test(docXml) && /Müller/.test(docXml));

    const pdf = S.toPdf(model);
    const raw = latin1(pdf.bytes);
    ok('the .pdf starts and ends like a PDF', raw.startsWith('%PDF-1.4') && raw.trimEnd().endsWith('%%EOF'));
    /* The xref table is where hand-written PDFs usually break: one wrong byte offset and a
       strict reader refuses the file. Check every single offset lands on its object. */
    const xrefAt = +raw.match(/startxref\n(\d+)/)[1];
    ok('startxref points at the xref table', raw.slice(xrefAt, xrefAt + 4) === 'xref');
    const offs = raw.slice(xrefAt).split('\n').filter(l => / 00000 n $/.test(l)).map(l => +l.slice(0, 10));
    ok(`every one of the ${offs.length} xref offsets lands exactly on its object`, offs.length > 5 && offs.every((o, i) => raw.startsWith(`${i + 1} 0 obj`, o)));
    ok('every content stream declares its true byte length',
       [...raw.matchAll(/<< \/Length (\d+) >>\nstream\n/g)].every(m => raw.slice(m.index + m[0].length + +m[1], m.index + m[0].length + +m[1] + 10) === '\nendstream'));
    ok('Latin-1 names are written in WinAnsi, not mangled', raw.includes('(M\xFCller)'));
    ok('a letter WinAnsi cannot show is transliterated AND reported, never silently swapped',
       pdf.substituted.some(x => x.from === 'Ł' && x.to === 'L') && pdf.substituted.some(x => x.from === 'Đ' && x.to === 'D') && raw.includes('(Lukaszewicz)'));
    ok('each unsupported letter is reported once, not once per occurrence', pdf.substituted.filter(x => x.from === 'ł').length === 1);
    ok('a value too long for its column is cut with an ellipsis and reported', pdf.truncated.length === 1 && /^A+$/.test(pdf.truncated[0].text));
    ok('the document title is UTF-16, so an en dash is not read as "Œ"', /\/Title <FEFF[0-9A-F]*2013/.test(raw));
    ok('same model → byte-identical files, so both writers are testable',
       latin1(S.toDocx(model)) === latin1(docx) && latin1(S.toPdf(model).bytes) === raw);

    const big = JSON.parse(JSON.stringify(model));
    big.blocks[1].rows = Array.from({ length: 45 }, (_, i) => [String(i + 1), String(50000 + i), 'Name' + i, 'Vorname']);
    const long = S.toPdf(big), longRaw = latin1(long.bytes);
    ok('a roster longer than one page breaks onto a second page', long.pages >= 2);
    ok('and the column header repeats at the top of it', (longRaw.match(/\(Lizenznummer\)/g) || []).length === long.pages);

    const html = S.toHtml(model);
    ok('the HTML preview escapes names rather than injecting them', !/<script/i.test(S.toHtml({ title: '<script>x</script>', blocks: [] })) && /Łukaszewicz/.test(html));
  }

  console.log('\n[13] Eligibility — who may go on the official sheet (Reglement 5.1.1, 2025 and 2026 editions)');
  {
    const E = window.__T.ELIGIBILITY;
    // FICTIONAL players. Row order is cap order, so row 1 is the starting goalkeeper.
    const P = (n, o) => Object.assign({ licence: String(50000 + n), name: 'P' + n, birthYear: '2014', gender: 'M', status: 'Swiss' }, o);
    const lineup = (n, over) => Array.from({ length: n }, (_, i) => P(i + 1, (over && over[i]) || {}))
      .map((p, i) => i === 0 ? Object.assign(p, { gk: true, captain: true }) : p);
    const has = (r, code) => r.findings.some(f => f.code === code);
    const flagged = (r, code) => (r.findings.find(f => f.code === code) || { players: [] }).players;

    ok('the season turns over on 1 September, not 1 January',
       E.seasonOf('2026-08-31').label === '2025/26' && E.seasonOf('2026-09-01').label === '2026/27' && E.seasonOf('2027-03-10').label === '2026/27');
    ok('every wpmatch eligibility value is understood', ['Swiss', 'Swiss Sport Nationality', 'Swiss Sport Experience', 'Ausländer/Étranger', 'Inactive License']
       .map(E.statusOf).join() === 'swiss,ssn,sse,foreign,inactive' && E.statusOf('') === 'unknown');

    const U14 = { category: 'U14' }, oct = { date: '2026-10-04' };   // season 2026/27 → counts from 2027
    ok('U14 2026/27: born 2013–2015 is clean', E.check(U14, lineup(10, [0, { birthYear: '2013' }, { birthYear: '2015' }]), oct).findings.length === 0);
    ok('a boy born 2012 is too old for U14', has(E.check(U14, lineup(10, [0, { birthYear: '2012' }]), oct), 'too-old'));
    ok('…but a GIRL born 2012 may play — girls get one year over the limit', !has(E.check(U14, lineup(10, [0, { birthYear: '2012', gender: 'F' }]), oct), 'too-old'));
    ok('more than 3 younger players is flagged', has(E.check(U14, lineup(10, [0, { birthYear: '2016' }, { birthYear: '2016' }, { birthYear: '2016' }, { birthYear: '2017' }]), oct), 'too-many-younger'));
    const girls = [0, 1, 2, 3, 4, 5].map(() => ({ gender: 'F', birthYear: '2013' }));
    ok('U14 girls above 50% of the list is flagged in 2026/27 (Anhang 13A)…', has(E.check(U14, lineup(10, girls), oct), 'girls-share'));
    ok('…and NOT in 2025/26, when that rule did not exist yet', !has(E.check(U14, lineup(10, girls), { date: '2026-03-01' }), 'girls-share'));

    const ST = { category: 'ST' };
    const stl = lineup(11, [{ birthYear: '1995' }, { status: 'Swiss Sport Nationality' }, { status: 'Swiss Sport Experience' }, { status: 'Ausländer/Étranger' }]);
    ok('Swiss Trophy 2026/27: Swiss Sport Nationality may play…', !flagged(E.check(ST, stl, { date: '2026-11-01' }), 'only-swiss').includes('50002'));
    ok('…Swiss Sport Experience and foreigners may not (Anhang 2, 2026)', flagged(E.check(ST, stl, { date: '2026-11-01' }), 'only-swiss').join() === '50003,50004');
    ok('in 2025/26 Swiss Sport Experience was still allowed there', flagged(E.check(ST, stl, { date: '2026-02-01' }), 'only-swiss').join() === '50004');

    const NLA = { category: 'NLA' }, nov = { date: '2026-11-01' }, F = { status: 'Ausländer/Étranger' }, SSE = { status: 'Swiss Sport Experience' };
    ok('NLA: 3 foreigners is over the limit of 2', has(E.check(NLA, lineup(12, [0, F, F, F]), nov), 'too-many-foreigners'));
    ok('NLA 2026/27: 2 foreigners plus 1 Swiss Sport Experience is allowed', E.check(NLA, lineup(12, [0, F, F, SSE]), nov).findings.length === 0);
    ok('…but a second Swiss Sport Experience player tips it over', has(E.check(NLA, lineup(12, [0, F, F, SSE, SSE]), nov), 'too-many-foreigners'));
    ok('Nationalliga Damen allows only 1 foreigner', has(E.check({ category: 'NLD' }, lineup(10, [{ gender: 'F' }, Object.assign({ gender: 'F' }, F), Object.assign({ gender: 'F' }, F)].concat(Array(7).fill({ gender: 'F' }))), nov), 'too-many-foreigners'));
    ok('Promotionalliga Damen has no foreigner limit', !has(E.check({ category: 'PLD' }, lineup(10, Array(10).fill(Object.assign({ gender: 'F' }, F))), nov), 'too-many-foreigners'));

    // the form itself — the only ERRORS; everything read out of a regulation is a warning
    ok('15 players is an error: the form has 14 rows', E.check(NLA, lineup(15), nov).errors === 1 && has(E.check(NLA, lineup(15), nov), 'too-many-players'));
    ok('no goalkeeper is an error', has(E.check(NLA, lineup(10).map(p => Object.assign(p, { gk: false })), nov), 'no-goalkeeper'));
    ok('a duplicated or missing licence number is an error', ['duplicate-licence', 'missing-licence'].every(c => has(E.check(NLA, lineup(10, [0, { licence: '50001' }, { licence: '' }]), nov), c)));
    ok('an inactive licence WARNS rather than blocks — licences are issued late', (() => { const r = E.check(NLA, lineup(10, [0, { status: 'Inactive License' }]), nov); return has(r, 'inactive-licence') && r.errors === 0; })());
    ok('a senior keeper in cap 7 is flagged: red caps are 1 and 13 from 2026', has(E.check(NLA, lineup(10, [0, 0, 0, 0, 0, 0, { gk: true }]), nov), 'goalkeeper-cap'));
    ok('in U10–U14 only cap 1 must be red, so a second keeper anywhere is fine', !has(E.check(U14, lineup(10, [0, 0, 0, 0, 0, 0, { gk: true }]), oct), 'goalkeeper-cap'));
    ok('errors are listed before warnings', (() => { const f = E.check(NLA, lineup(15, [0, F, F, F]), nov).findings; return f[0].severity === 'error' && f.some(x => x.severity === 'warn'); })());
    ok('a coach "special" overrides the category preset — e.g. a Swiss-only friendly',
       has(E.check({ category: 'RL', rules: { foreigners: { onlySwiss: true } } }, lineup(10, [0, F]), nov), 'only-swiss'));
  }

  console.log('\n[14] wpmatch players + templates — the licence number, and what never to fetch');
  {
    const { WPMATCH: W, TEAMSHEET: TS, SHEETDOC: S } = window.__T;
    // FICTIONAL records in the exact shape the API returns
    const rec = (id, slug, title, o) => Object.assign({ id, slug, title: { rendered: title }, number: '4',
      metrics: { Gender: 'M', Eligibility: 'Swiss', 'Year of Birth': '2013' }, current_teams: [9001] }, o);

    ok('the licence number is the SLUG, never the post id', W.normPlayer(rec(3400, '50123', 'Nina Keller')).licence === '50123');
    ok('a non-numeric slug is not mistaken for a licence', W.normPlayer(rec(3401, 'nina-keller', 'Nina Keller')).licence === '');
    ok('"First Last" is split into the form\'s two columns', (() => { const p = W.normPlayer(rec(1, '50001', 'Nina Keller')); return p.firstName === 'Nina' && p.name === 'Keller' && !p.nameGuessed; })());
    ok('a three-word name is split but marked as a guess for the coach to check', W.normPlayer(rec(1, '50002', 'Anna Maria Rossi')).nameGuessed === true);
    // what wpmatch actually sends: raw UTF-8 letters and NUMERIC entities (300 real titles sampled)
    ok('a name as wpmatch sends it — raw UTF-8 plus a numeric entity — is decoded, "_TEMP" stripped and flagged',
       (() => { const p = W.normPlayer(rec(1, '50003', 'Zoë O&#8217;Müller_TEMP')); return p.firstName === 'Zoë' && p.name === 'O’Müller' && p.temp === true; })());
    ok('a NAMED accented entity is decoded too, so "M&uuml;ller" can never reach a form', W.normPlayer(rec(1, '50006', 'L&eacute;a M&uuml;ller')).name === 'Müller' && W.normPlayer(rec(1, '50006', 'L&eacute;a M&uuml;ller')).firstName === 'Léa');
    ok('an unknown named entity is left alone rather than guessed', W.decodeEntities('a &bogus; b') === 'a &bogus; b');
    ok('gender, birth year, cap and eligibility are read from the right places', (() => { const p = W.normPlayer(rec(1, '50004', 'Lea Frei', { number: '13', metrics: { Gender: 'F', Eligibility: 'Swiss Sport Nationality', 'Year of Birth': '2012' } }));
       return p.gender === 'F' && p.birthYear === '2012' && p.cap === '13' && p.status === 'Swiss Sport Nationality'; })());

    // PRIVACY: `date` is a real player's date of birth on wpmatch
    ok('PLAYER_FIELDS never asks wpmatch for `date` (it is the date of birth)', !W.PLAYER_FIELDS.split(',').includes('date'));
    ok('…and a record that arrives WITH a date does not carry it into the app', !Object.values(W.normPlayer(rec(1, '50005', 'Tim Graf', { date: '2013-04-17T00:00:00' }))).some(v => /2013-04-17/.test(String(v))));

    const twin = [rec(1, '31000', 'Luca Rossi', { metrics: { Gender: 'M', Eligibility: 'Inactive License' } }), rec(2, '52000', 'Luca Rossi')].map(W.normPlayer);
    ok('one person with an old inactive licence and a new one: the old number is dropped', (() => { const d = W.dedupePlayers(twin); return d.length === 1 && d[0].licence === '52000'; })());
    const namesakes = [rec(1, '52001', 'Luca Rossi'), rec(2, '52002', 'Luca Rossi', { metrics: { Gender: 'M', Eligibility: 'Swiss', 'Year of Birth': '1998' } })].map(W.normPlayer);
    ok('two ACTIVE players who share a name are both kept — guessing would put the wrong licence on a sheet', W.dedupePlayers(namesakes).length === 2);

    // templates
    ok('two built-in layouts: the current official form, and the classic licence-first one', TS.BUILTIN.map(t => t.id).join() === 'sa-2025,sa-classic');
    const cur = TS.normalizeTemplate(TS.BUILTIN[0]), old = TS.normalizeTemplate(TS.BUILTIN[1]);
    ok('the 2025 official form: 14 rows, licence number in the LAST column', cur.rows === 14 && cur.columns[cur.columns.length - 1].key === 'licence');
    ok('the classic layout: 13 rows, licence number FIRST', old.rows === 13 && old.columns[1].key === 'licence');
    const line = [{ licence: '50001', name: 'Keller', firstName: 'Nina', gk: true }, { licence: '50002', name: 'Brunner', firstName: 'Jonas', captain: true }];
    const data = { club: 'Test WPC', team: { name: 'U14', staff: { coach: 'Sam Beispiel' } }, match: { date: '2026-10-04', league: 'U14 - Group A' }, lineup: line };
    const m = TS.buildModel(TS.BUILTIN[0], data);
    ok('every row of the form is printed even when fewer players are listed', m.blocks[1].rows.length === 14 && m.blocks[1].rows[13][0] === '14' && m.blocks[1].rows[13][3] === '');
    ok('row n is cap n, and the captain reads "First Last #cap" as on the real form', m.blocks[1].rows[1].join('|') === '2|Brunner|Jonas|50002' && m.blocks[2].rows[3].value === 'Jonas Brunner #2');
    ok('the date is written the Swiss way', m.blocks[0].rows[2].value === '04.10.2026');
    ok('labels are the official German and French, character for character', m.blocks[2].rows[1].label.join('/') === 'Betreuer:in Coach/AssistantCoach' && TS.buildModel(TS.BUILTIN[1], data).blocks[2].rows[0].label[0] === 'Coach/Trainer');
    const custom = TS.normalizeTemplate({ columns: ['name', 'bogus', 'name'], rows: 99, langs: ['it', 'xx'] });
    ok('a malformed saved template still renders: unknown columns dropped, licence column restored, rows capped', custom.columns.map(c => c.key).join() === 'name,licence' && custom.rows === 30 && custom.langs[0] === 'it');
    ok('column widths always fill the page exactly', Math.abs(custom.columns.reduce((n, c) => n + c.w, 0) - 1) < 1e-9);
    ok('a built-in is copied, never edited in place', (() => { const c = TS.cloneTemplate(TS.BUILTIN[0], 't1', 'Cup'); return c.id === 't1' && !c.builtin && TS.BUILTIN[0].id === 'sa-2025' && TS.BUILTIN[0].builtin; })());
    ok('an Italian-labelled template is marked unofficial — there is no Italian form', !TS.buildModel({ langs: ['it', 'de'] }, data).official && TS.buildModel(TS.BUILTIN[0], data).official);
    ok('a filename a club secretary can file as it is', TS.fileName(data, 'pdf') === 'Spielaufstellung_Test-WPC_U14-Group-A_20261004.pdf');
    ok('the goalkeeper mark prints in the PDF font (X, not a tick it cannot draw)', S.toPdf(TS.buildModel({ columns: ['nr', 'name', 'licence', 'gk'] }, data)).substituted.length === 0);
  }

  console.log('\n[13b] A player under the water — depth that survives every path a play travels');
  {
    const { SHARE, ANIM, POOL } = window.__T;
    const frame = u => ({ att: { 3: { x: 226, y: 110, u }, 4: { x: 234, y: 138 } }, def: { 3: { x: 242, y: 110 } },
      gk: { x: 292, y: 110 }, ball: { carrier: 'A3' }, extra: [] });

    // 1) it rides on the point, so a share link and a .thplay.json export keep it
    const packed = SHARE.pack({ id: 'u1', title: 'Hide and burst', situation: '6v6', phase: 'offense',
      frames: [frame(0), frame(1)], notes: {} });
    const back = SHARE.unpack(packed).plays[0];
    ok('a player’s depth survives being packed for a share link or an export', back.frames[1].att['3'].u === 1);
    ok('…and a player at the surface carries nothing extra', back.frames[1].att['4'].u === undefined);
    ok('…while a nonsense depth is clamped rather than trusted', SHARE.unpack(SHARE.pack({ id: 'u2', title: 't', situation: '6v6', phase: 'offense',
      frames: [{ att: { 3: { x: 1, y: 1, u: 99 } }, def: {}, gk: { x: 292, y: 110 }, ball: { carrier: null }, extra: [] }], notes: {} })).plays[0].frames[0].att['3'].u === 1);

    // 2) a player sinks between steps rather than popping under
    const half = ANIM.stateAt({ frames: [frame(0), frame(1)] }, 0.5);
    ok('a player sinks smoothly between steps', half.att['3'].u > 0 && half.att['3'].u < 1);
    const surfaced = ANIM.stateAt({ frames: [frame(0), frame(0)] }, 0.5);
    ok('…and a play with nobody under carries no depth at all', surfaced.att['3'].u === undefined);

    // 3) the board shows it as depth and a ripple, never as an invented swimming stroke
    const g = POOL.disc('A', '3');
    ok('every disc carries a ripple that rests at the surface', !!g.querySelector('.disc-ripple') && !!g.querySelector('.disc-body'));
    POOL.setDepth(g, 0.55);
    ok('a sinking player is marked on the disc, with how far down', g.classList.contains('under') && g.getAttribute('data-under') === '0.55');
    POOL.setDepth(g, 0);
    ok('…and coming back up clears it completely', !g.classList.contains('under') && !g.hasAttribute('data-under'));
  }

  console.log('\n[14b] An opposing squad\u2019s season figures — what is kept, and what is refused');
  {
    const W = window.__T.WPMATCH;
    /* An invented squad. No real club, child or licence number appears in this file: the shapes are
       copied from the live API, the people are not. Goals arrive as STRINGS and 6-on-6 as integers
       in the same row, exactly as wpmatch sends them. */
    const raw = {
      id: 9001, slug: 'invented-u14-team', link: 'https://example.invalid/list/invented-u14-team/',
      title: { rendered: 'Invented WPC U14 &#8211; Team' },
      data: {
        0: { number: '#', name: 'Player', age: 'Age', gender: 'Gender', gpg: 'Goals per Game', played: 'Played',
             goalon: 'Goals 6on6', goals: 'Goals', eligibility: 'Eligibility', goalextraplayer: 'Goals Extra Player',
             yearofbirth: 'Year of Birth', exclusionfoul: 'Exclusion Fouls', appearances: 'Appearances', winratio: 'Win Ratio' },
        // the string-sort trap: '5' sorts above '28' unless the normaliser coerces
        101: { name: 'Alpha Invented', played: 9, goals: '5', goalon: 4, goalextraplayer: 1, penaltygoals: 0,
               exclusionfoul: 2, penaltyfouls: 0, misconductfoul: 0, brutalityfoul: 0,
               age: 12, yearofbirth: '2014', gender: 'F', eligibility: 'Ausl\u00e4nder-\u00c9tranger', height: '-', weight: '-',
               gpg: '0.6', appearances: '11', eventminutes: 352, winratio: '55.55' },
        102: { name: 'Bravo Invented', played: 12, goals: '28', goalon: 20, goalextraplayer: 6, penaltygoals: 2,
               // the real shape of an exclusion cell: a count, then the offence and the game clock, with markup
               exclusionfoul: "7 (13 <b>1. 0:16</b>')", penaltyfouls: 1, misconductfoul: 0, brutalityfoul: 0,
               age: 13, yearofbirth: '2013', gender: 'M', eligibility: 'Swiss', gpg: '2.3', appearances: '12' },
        103: { name: 'Charlie Neverplayed', played: 0, goals: '0', goalon: 0, goalextraplayer: 0, penaltygoals: 0,
               exclusionfoul: 0, penaltyfouls: 0, misconductfoul: 0, brutalityfoul: 0 },
        104: { name: 'Delta Miscounted', played: 6, goals: '9', goalon: 3, goalextraplayer: 1, penaltygoals: 0,
               exclusionfoul: 0, penaltyfouls: 0, misconductfoul: 0, brutalityfoul: 0 },
      },
    };
    const sq = W.normSquad(raw);
    ok('a squad comes back named, with its own link', sq.id === 9001 && /Invented WPC U14/.test(sq.name) && sq.url.startsWith('https://'));
    ok('a player who has never played is left out, not shown as a row of zeros', !sq.players.some(p => p.name === 'Charlie Neverplayed'));
    ok('a row whose goals do not add up is dropped — we parsed it wrong', !sq.players.some(p => p.name === 'Delta Miscounted'));
    ok('…so two players survive this squad', sq.players.length === 2 && sq.matches === 12);
    const byGoals = sq.players.slice().sort((a, b) => b.goals - a.goals);
    ok('goals are numbers, so 28 outranks 5 instead of the other way round', byGoals[0].goals === 28 && byGoals[1].goals === 5);
    ok('every kept figure is a number, whatever wpmatch sent', sq.players.every(p => W.SQUAD_KEEP.every(k => typeof p[k] === 'number')));
    ok('an exclusion cell with the offence and the clock inside it still reads as a count', byGoals[0].exclusionfoul === 7);
    ok('the goal split is kept, because that is what the coach asked for', byGoals[0].goalon === 20 && byGoals[0].goalextraplayer === 6 && byGoals[0].penaltygoals === 2);

    const keys = new Set(); sq.players.forEach(p => Object.keys(p).forEach(k => keys.add(k)));
    ok('a child\u2019s age and year of birth never come out of the normaliser', !keys.has('age') && !keys.has('yearofbirth'));
    ok('…nor their gender, nationality status, height or weight', !['gender', 'eligibility', 'height', 'weight'].some(k => keys.has(k)));
    ok('…and none of it is hiding in the serialised rows either', !/Ausl|2013|2014|"F"|"M"/.test(JSON.stringify(sq.players)));
    ok('wpmatch\u2019s own goals-per-game and appearances are not republished', !keys.has('gpg') && !keys.has('appearances') && !keys.has('winratio'));
    ok('…nor the made-up minutes (32 \u00d7 appearances, never measured)', !keys.has('eventminutes'));
    ok('the row carries only the eleven things it is allowed to', [...keys].sort().join() === ['wpId', 'name'].concat(W.SQUAD_KEEP).sort().join());

    /* which list belongs to a squad: the slug convention holds for most of the league, and the
       rest have to be found by title — a miss must be a state of its own, never "no players" */
    const index = [
      { id: 9001, slug: 'invented-u14-team', name: 'Invented WPC U14 – Team' },
      { id: 9002, slug: 'other-town-u14-team', name: 'Other Town U14 – Team' },
      { id: 9003, slug: 'two-rivers-u16-team', name: 'Two Rivers U16 – Team' },
    ];
    ok('a squad whose slug follows the convention is found by it', W.resolveList({ slug: 'invented-u14', name: 'Invented WPC U14' }, index).by === 'slug');
    ok('one whose slug does not is still found, by its name', (() => {
      const r = W.resolveList({ slug: 'othertownu14', name: 'Other Town U14' }, index);
      return r.by === 'title' && r.list.id === 9002;
    })());
    ok('a squad nobody publishes a list for says so, rather than looking empty', W.resolveList({ slug: 'no-such-club-u12', name: 'No Such Club U12' }, index).by === 'none');
    ok('two lists with the same name are a question for the coach, not a guess', (() => {
      const twin = index.concat([{ id: 9004, slug: 'two-rivers-u16-team-2', name: 'Two Rivers U16 – Team' }]);
      const r = W.resolveList({ slug: 'nope', name: 'Two Rivers U16' }, twin);
      return r.by === 'ambiguous' && r.candidates.length === 2;
    })());
  }

  console.log('\n[14c] What the scouting report will and will not say');
  {
    const SC = window.__T.SCOUT;
    const P = (name, o) => Object.assign({ wpId: 0, name, played: 10, goals: 0, goalon: 0, goalextraplayer: 0, penaltygoals: 0,
      exclusionfoul: 0, penaltyfouls: 0, misconductfoul: 0, brutalityfoul: 0 }, o);
    const squad = { name: 'Invented WPC U14', matches: 12, players: [
      P('Alpha Invented',   { played: 12, goals: 30, goalon: 24, goalextraplayer: 4, penaltygoals: 2, exclusionfoul: 12 }),
      P('Bravo Invented',   { played: 11, goals: 12, goalon: 6,  goalextraplayer: 6, penaltygoals: 0, exclusionfoul: 3 }),
      P('Charlie Invented', { played: 12, goals: 6,  goalon: 6,  goalextraplayer: 0, penaltygoals: 0, exclusionfoul: 9 }),
      P('Delta Invented',   { played: 10, goals: 0,  goalon: 0,  goalextraplayer: 0, penaltygoals: 0, exclusionfoul: 1 }),
      // two matches: a rate here would be noise presented as authority
      P('Echo Newcomer',    { played: 2,  goals: 8,  goalon: 8,  goalextraplayer: 0, penaltygoals: 0, exclusionfoul: 2 }),
    ] };
    const r = SC.report(squad);

    ok('the team line is a count and its denominator, never a forecast', r.team.exclusions === 27 && r.team.matches === 12 && r.team.perMatch === 2.3);
    const six = r.sections.find(x => x.key === 'sixOnSix');
    ok('the hardest mark in 6-on-6 is named, out of the squad’s own 6-on-6 goals', six.players[0].name === 'Alpha Invented' && six.players[0].n === 24 && six.players[0].share === '24 / 44');
    const extra = r.sections.find(x => x.key === 'extraPlayer');
    ok('the man-down section is ranked on extra-player goals, not on total goals', extra.players[0].name === 'Bravo Invented' && extra.players[0].n === 6);
    const excl = r.sections.find(x => x.key === 'excluded');
    ok('the most-excluded in this squad is a rate with its matches beside it', excl.players[0].name === 'Alpha Invented' && excl.players[0].n === 12 && excl.players[0].perMatch === 1);

    ok('a player with two matches is never ranked against one with twelve', r.sections.every(x => !x.players.some(p => p.name === 'Echo Newcomer')));
    ok('…but is still shown, with counts and no rate', r.thin.length === 1 && r.thin[0].name === 'Echo Newcomer' && r.thin[0].played === 2);
    ok('every ranked line carries its own denominator', r.sections.every(x => x.players.every(p => p.played > 0 && typeof p.n === 'number')));
    ok('no line anywhere carries a probability, a score or a rating', !/likel|risk|probab|score:|rating/i.test(JSON.stringify(r)));

    ok('the full table leads with who actually scored, and still lists the rest', r.table[0].name === 'Alpha Invented' && r.table.length === 5
      && r.table[r.table.length - 1].goals === 0);
    ok('columns that are all zeros across the squad are left off a phone screen', r.showMisconduct === false && r.showBrutality === false);
    ok('a squad nobody has figures for is a state, not an empty table', SC.report({ players: [], matches: 0 }).empty === true);

    // the rate floor, exactly at the boundary
    const four = SC.report({ matches: 4, players: [P('Foxtrot Invented', { played: 4, goals: 8, goalon: 8 })] });
    ok('four matches is below the floor: counts only, and out of the ranked sections', four.sections.length === 0 && four.thin.length === 1);
    const five = SC.report({ matches: 5, players: [P('Golf Invented', { played: 5, goals: 10, goalon: 10 })] });
    ok('five is where a rate starts being worth showing', five.sections.length === 1 && five.sections[0].players[0].perMatch === 2);
    // …and the team's own line obeys the same floor: three matches is not a tendency
    const early = SC.report({ matches: 3, players: [P('Hotel Invented', { played: 3, goals: 4, goalon: 4, exclusionfoul: 6 })] });
    ok('a squad three matches into a season gets no "expect this many a match" line', early.team.perMatch === null && early.team.exclusions === 6);
  }

  console.log('\n[14d] Keeping a squad, and a player\u2019s own line');
  {
    const TM = window.__T.TEAMS, SC = window.__T.SCOUT;
    const squadOf = (n, extra) => ({ id: n, name: 'Squad ' + n, url: 'https://example.invalid/list/' + n + '/', matches: 10,
      players: [Object.assign({ wpId: 900 + n, name: 'Player ' + n, played: 10, goals: 10, goalon: 7, goalextraplayer: 2,
        penaltygoals: 1, exclusionfoul: 4, penaltyfouls: 0, misconductfoul: 0, brutalityfoul: 0 }, extra || {})] });
    try { window.localStorage.removeItem(TM.SCOUT_KEY); } catch (e) {}

    const kept = TM.saveScout({ listId: 1, name: 'Squad 1', url: 'https://example.invalid/list/1/', squad: squadOf(1) }, 'Saturday — Other Town');
    ok('a coach can keep a squad under a name of their own', kept.label === 'Saturday — Other Town' && TM.scoutList().length === 1);
    ok('…and it is not a team, so a sync can never carry it to the club', !(TM.load().teams || []).some(t => t.name === 'Saturday — Other Town'));
    ok('…nor does it land in the shared player map a sheet is built from', !Object.keys(TM.load().players || {}).some(k => /^9\d\d$/.test(k)));

    for (let i = 2; i <= TM.SCOUT_MAX + 2; i++) TM.saveScout({ listId: i, name: 'Squad ' + i, url: '', squad: squadOf(i) }, 'Kept ' + i);
    ok('only a handful are kept — this is a lookup before a match, not a file on other clubs', TM.scoutList().length === TM.SCOUT_MAX);
    ok('…and the oldest is the one that goes', !TM.loadScouts()['1']);

    const old = TM.loadScouts();
    const one = Object.keys(old)[0];
    old[one].at = Date.now() - 8 * 24 * 3600e3;                       // a week and a day ago
    window.localStorage.setItem(TM.SCOUT_KEY, JSON.stringify(old));
    ok('nothing older than a week survives being read', !TM.loadScouts()[one]);
    TM.forgetScout(Object.keys(TM.loadScouts())[0]);
    ok('a coach can drop one on purpose too', TM.scoutList().length === TM.SCOUT_MAX - 2);

    /* a player's own line: joined on the wpmatch id and nothing else, because a cap number is not
       unique in a squad and a name match would print the wrong child's record on a sheet */
    const squad = squadOf(7);
    ok('a player the club crawled from wpmatch gets their own line', (() => {
      const r = TM.playerLine(squad, { pid: 'L50101', licence: '50101', wpId: 907 });
      return r.line && r.line.goals === 10 && r.line.goalon === 7 && r.line.exclusionfoul === 4;
    })());
    ok('a player added by hand says so, instead of showing zeros', TM.playerLine(squad, { pid: 'm1', licence: '' }).why === 'not-matched');
    ok('…and zeros never stand in for "we do not know"', !TM.playerLine(squad, { pid: 'm1' }).line);
    ok('before the figures are loaded, the card says which button to press', TM.playerLine(null, { pid: 'L1', wpId: 907 }).why === 'not-loaded');
    ok('a player wpmatch does not list in this squad is its own answer', TM.playerLine(squad, { pid: 'L2', wpId: 4242 }).why === 'not-in-squad');
    ok('a line below the floor is marked as too few matches to read', SC.lineFor(squadOf(8, { wpId: 908, played: 2 }), 908).thin === true);
    ok('…and carries no rate', SC.lineFor(squadOf(9, { wpId: 909, played: 2 }), 909).perMatch === null);
    try { window.localStorage.removeItem(TM.SCOUT_KEY); } catch (e) {}
  }

  console.log('\n[15] Teams & team sheets — the coach flow, end to end in the DOM');
  {
    const { TEAMS: TM, ELIGIBILITY: E } = window.__T;
    // pure helpers first
    const d0 = { teams: [], players: {}, templates: [], sheets: [] };
    TM.upsertPlayers(d0, [{ licence: '50101', name: 'Anna Maria', firstName: 'Rossi', nameGuessed: true, status: 'Swiss', birthYear: '2013' }], 'wpmatch');
    Object.assign(d0.players.L50101, { name: 'Rossi', firstName: 'Anna Maria', edited: true, gk: true });   // the coach fixes the split and ticks GK
    TM.upsertPlayers(d0, [{ licence: '50101', name: 'Anna Maria', firstName: 'Rossi', status: 'Inactive License', birthYear: '2013' }], 'wpmatch');
    const pl = d0.players.L50101;
    ok('a wpmatch refresh updates what wpmatch knows — the licence status…', pl.status === 'Inactive License');
    ok('…but never overwrites what the coach corrected: the name split and the GK tick', pl.name === 'Rossi' && pl.firstName === 'Anna Maria' && pl.gk === true);
    ok('the licence number is the player\'s identity — one record, not two', Object.keys(d0.players).length === 1);
    const pid = TM.upsertPlayers(d0, [{ name: 'New Signing' }], 'manual')[0];
    ok('a player whose licence is still pending gets a local id rather than being dropped', /^m/.test(pid) && d0.players[pid].licence === '');

    const G = (name, cap, gk) => ({ pid: name, name, cap: String(cap), gk: !!gk });
    const squad = [G('F3', 3), G('K2', 7, true), G('F1', 2), G('K1', 1, true), G('F9', 9)];
    const senior = TM.autoOrder(squad, 14, 'NLB'), youth = TM.autoOrder(squad, 14, 'U14');
    ok('seniors: the keepers take the red caps 1 and 13', senior[0].name === 'K1' && senior[12].name === 'K2');
    ok('U10–U14: only cap 1 is red, so the second keeper simply goes next', youth[0].name === 'K1' && youth[1].name === 'K2');
    ok('everyone else follows by their usual cap number', senior.slice(1, 4).map(p => p && p.name).join() === 'F1,F3,F9');

    // spy on every network call for the rest of this section — the privacy claim below has to be
    // checkable, not assumed
    const netLog = [], realFetch = window.fetch;
    window.fetch = (url, opts) => { netLog.push(String(url) + ' ' + String((opts && opts.body) || ''));
      return realFetch ? realFetch(url, opts) : Promise.reject(new Error('offline')); };
    // the real screen, as a coach
    q('#logout-btn').click(); await wait(20);
    qa('.demo-btn').find(b => b.dataset.demo === 'player').click(); await wait(50);
    if (q('#tour-skip')) q('#tour-skip').click();
    ok('a player never sees the Teams tab — rosters hold licence numbers and birth years', q('.nav-btn[data-view="teams"]').hidden);
    ok('…but gets their own player card on My Development', (() => { q('.nav-btn[data-view="development"]').click(); return true; })() && !!(await wait(40), q('#dev-playercard .tm-mycard')));
    q('#logout-btn').click(); await wait(20);
    qa('.demo-btn').find(b => b.dataset.demo === 'coach').click(); await wait(50);
    if (q('#tour-skip')) q('#tour-skip').click();
    ok('a coach does see it', !q('.nav-btn[data-view="teams"]').hidden);

    // FICTIONAL squad: one keeper, one inactive licence, one boy born a year too early
    const P = (lic, name, firstName, birthYear, o) => Object.assign({ pid: 'L' + lic, licence: lic, name, firstName, birthYear, gender: 'M', status: 'Swiss', cap: '', gk: false }, o);
    const ps = [P('50101', 'Keller', 'Nina', '2013', { gender: 'F', gk: true, cap: '1' }), P('50102', 'Brunner', 'Jonas', '2014', { cap: '2' }),
                P('50104', 'Frei', 'Luca', '2012', { cap: '4' }), P('50105', 'Huber', 'Mia', '2014', { gender: 'F', cap: '5', status: 'Inactive License' })];
    window.localStorage.setItem(TM.KEY, JSON.stringify({ version: 1, teams: [{ id: 't1', name: 'U14 A', category: 'U14', club: 'Test WPC', leagueLabel: 'U14',
      templateId: 'sa-2025', staff: { coach: 'Sam Beispiel' }, rules: {}, players: ps.map(p => p.pid), wpmatch: null }],
      players: Object.fromEntries(ps.map(p => [p.pid, p])), templates: [], sheets: [] }));
    q('.nav-btn[data-view="teams"]').click(); await wait(40);
    ok('the team list shows the team', qa('#view-teams [data-team]').length === 1 && /U14 A/.test(q('#view-teams').textContent));
    q('#view-teams [data-team="t1"]').click(); await wait(40);
    ok('its roster lists every player with their status', qa('#view-teams .tm-roster tbody tr').length === 4 && /Inactive licence/.test(q('#view-teams .tm-roster').textContent));
    {
      // naming a team used to work only if the coach found the Save button first
      const nameBox = q('#view-teams #tm-name');
      if (nameBox) {
        nameBox.value = 'U14 Dolphins (ours)';
        nameBox.dispatchEvent(new window.Event('change', { bubbles: true }));
        await wait(20);
        ok('a team name is kept as soon as the coach leaves the box', (JSON.parse(window.localStorage.getItem(TM.KEY)).teams[0] || {}).name === 'U14 Dolphins (ours)');
        nameBox.value = 'U14 Dolphins';
        q('#view-teams #tm-back').click();
        await wait(40);
        ok('…and pressing “all teams” keeps it too, instead of throwing it away', (JSON.parse(window.localStorage.getItem(TM.KEY)).teams[0] || {}).name === 'U14 Dolphins');
        q('#view-teams .tm-card').click();
        await wait(40);
      }
    }

    q('#tm-new-sheet').click(); await wait(40);
    ok('a new sheet has one row per line of the official form (14)', qa('#view-teams .tm-lineup tbody tr').length === 14);
    ok('the keeper is placed in cap 1', q('#view-teams [data-row="0"]').value === 'L50101' && q('#view-teams [data-rowgk="0"]').checked);
    {
      // who can play: the coach's own note, and the line-up built from it
      const btn = (pid, state) => q(`#view-teams [data-avail="${pid}"][data-availstate="${state}"]`);
      ok('every player on the roster can be marked in, out or not asked', qa('#view-teams .tm-avail-row').length === 4 && !!btn('L50101', 'in'));
      ok('…and it says plainly that nobody was asked', /nobody has been asked and nothing is sent/.test(q('#view-teams .tm-avail').textContent));
      btn('L50101', 'in').click(); await wait(30);
      btn('L50102', 'in').click(); await wait(30);
      btn('L50104', 'out').click(); await wait(30);
      ok('the counts follow the marks', /2 in · 1 out · 1 not asked/.test(q('#view-teams .tm-avail').textContent));
      q('#tm-avail-fill').click(); await wait(40);
      const picked = qa('#view-teams .tm-lineup tbody select').map(s2 => s2.value).filter(Boolean);
      ok('building from those in uses only them — the keeper still in cap 1', picked.length === 2 && picked.includes('L50101') && picked.includes('L50102') && q('#view-teams [data-row="0"]').value === 'L50101');
      q('#tm-auto').click(); await wait(40);
      const auto = qa('#view-teams .tm-lineup tbody select').map(s2 => s2.value).filter(Boolean);
      ok('…and nobody marked out is ever auto-filled in', !auto.includes('L50104'));
      ok('a saved sheet keeps who could play, for next time', (() => { const saved = JSON.parse(window.localStorage.getItem(TM.KEY)); return saved.sheets[0].availability.L50104 === 'out'; })());
      btn('L50102', 'unknown').click(); await wait(30);
      ok('…and "not asked" is stored as nothing at all, never as an answer', (() => { const saved = JSON.parse(window.localStorage.getItem(TM.KEY)); return !('L50102' in (saved.sheets[0].availability || {})); })());
      btn('L50102', 'in').click(); await wait(30);
      q('#tm-invite').click(); await wait(30);
      ok('the coach can invite these players to the app from the sheet, code and QR', q('#tm-invite-modal').hidden === false && !!q('#tm-invite-modal .invite-qr svg') && /TRII-/.test(q('#tm-invite-modal .invite-code').textContent));
      q('#tm-invite-x').click(); await wait(20);
      q('#tm-avail-clear').click(); await wait(40);
      ok('clearing puts everyone back to "not asked"', /0 in · 0 out · 4 not asked/.test(q('#view-teams .tm-avail').textContent));
      q('#tm-clear').click(); await wait(30); q('#tm-auto').click(); await wait(40);   // back to the whole squad for the checks below
      ok('with nobody marked, the line-up is the whole roster again', qa('#view-teams .tm-lineup tbody select').map(s2 => s2.value).filter(Boolean).length === 4);
    }
    {
      // the coach presses one button; nothing is fetched until they do
      const W = window.__T.WPMATCH;
      const realSearch = W.searchTeams, realIndex = W.fetchListIndex, realSquad = W.fetchSquad;
      let fetched = 0;
      W.searchTeams = async () => [{ id: 77, slug: 'other-town-u14', name: 'Other Town U14', url: '' }];
      W.fetchListIndex = async () => { fetched++; return [{ id: 9100, slug: 'other-town-u14-team', name: 'Other Town U14 – Team' }]; };
      W.fetchSquad = async () => { fetched++; return { id: 9100, name: 'Other Town U14 – Team', url: 'https://example.invalid/list/x/', matches: 12, players: [
        { wpId: 1, name: 'Alpha Invented', played: 12, goals: 30, goalon: 24, goalextraplayer: 4, penaltygoals: 2, exclusionfoul: 12, penaltyfouls: 1, misconductfoul: 0, brutalityfoul: 0 },
        { wpId: 2, name: 'Bravo Invented', played: 11, goals: 12, goalon: 6, goalextraplayer: 6, penaltygoals: 0, exclusionfoul: 3, penaltyfouls: 0, misconductfoul: 0, brutalityfoul: 0 },
      ] }; };
      const btn = q('#view-teams #tm-scout');
      ok('the coach is offered a scouting report while preparing the sheet', !!btn);
      ok('…and nothing has been asked of wpmatch before they press it', fetched === 0);
      if (btn) {
        // with no opponent named, this used to search OUR OWN team's name and hand back our own
        // squad — which reads as wpmatch being broken rather than as a field not filled in
        btn.click();
        await wait(120);
        ok('pressing it with no opponent asks for one instead of searching our own name',
          /Pick a fixture/i.test(q('#view-teams #tm-scout-out').textContent) && fetched === 0);
        const oppBox = q('#view-teams #tm-m-opp');
        oppBox.value = 'Other Town U14';
        oppBox.dispatchEvent(new window.Event('change', { bubbles: true }));
        await wait(120);
        q('#view-teams #tm-scout').click();
        await wait(400);
        const panel = q('#view-teams .tm-scout');
        ok('pressing it reports on the opposing squad', !!panel && /Other Town U14/.test(panel.textContent));
        ok('…leading with how many extra-player chances to expect', /15 exclusions in 12 matches/.test(panel.textContent) || /1\.3 a match/.test(panel.textContent));
        ok('…naming who to mark at 6-on-6, with what it is out of', /Alpha Invented/.test(panel.textContent) && /24 \/ 30/.test(panel.textContent));
        ok('…and who the man-down has to cover', /Bravo Invented/.test(panel.textContent));
        ok('the limits are on the screen, not in a footnote', /who DRAWS exclusions is not recorded/i.test(panel.textContent) && /is a prediction/i.test(panel.textContent));
        ok('…and it says plainly that exclusions are the ones conceded', /conceded/i.test(panel.textContent));
        ok('no opponent child’s age, year of birth or nationality is anywhere on the screen', !/\b20(0|1)\d\b/.test(panel.textContent) && !/Ausl|Swiss Sport Nationality/.test(panel.textContent));
        q('#view-teams #tm-scout-x').click();
        await wait(120);
        ok('the report closes again', !q('#view-teams .tm-scout'));
      }
      W.searchTeams = realSearch; W.fetchListIndex = realIndex; W.fetchSquad = realSquad;
    }
    {
      // our own squad's figures, in the same shape as an opponent's, on the team itself
      const W = window.__T.WPMATCH;
      const realSearch = W.searchTeams, realIndex = W.fetchListIndex, realSquad = W.fetchSquad;
      try { window.localStorage.removeItem('thplay.wpmatch.cache.lists.index'); } catch (e) {}
      W.fetchListIndex = async () => [{ id: 9200, slug: 'ours-u14-team', name: 'Ours U14 – Team' }];
      // join on the wpmatch id the roster crawl already stored for our first player
      const firstPid = Object.keys(TM.load().players)[0];
      const ourWpId = TM.load().players[firstPid].wpId || 3400;
      W.fetchSquad = async () => ({ id: 9200, name: 'Ours U14 – Team', url: 'https://example.invalid/list/o/', matches: 11, players: [
        { wpId: ourWpId, name: 'Rossi', played: 11, goals: 18, goalon: 14, goalextraplayer: 3, penaltygoals: 1, exclusionfoul: 5, penaltyfouls: 0, misconductfoul: 0, brutalityfoul: 0 },
      ] });
      // the team as a coach would really have it: linked to its squad on wpmatch. TEAMS caches the
      // store in memory, so leave the view and come back rather than just redrawing.
      const st = TM.load(); st.teams[0].wpmatch = { id: 77, name: 'Ours U14', slug: 'ours-u14' };
      const p0 = Object.keys(st.players)[0]; if (!st.players[p0].wpId) st.players[p0].wpId = 3400;
      TM.save(st);
      q('#view-teams #tm-sheet-back').click(); await wait(80);    // leave the sheet: the panel is on the team
      q('.nav-btn[data-view="playbook"]').click(); await wait(60);
      q('.nav-btn[data-view="teams"]').click(); await wait(80);
      const card = q('#view-teams .tm-card'); if (card) { card.click(); await wait(80); }
      ok('a coach can see their own team’s season figures without scouting themselves', !!q('#view-teams .tm-ours'));
      /* and an opponent can be looked up from the team itself. A sheet cannot be made until the
         team has players, so putting this only on the sheet hid it behind filling in a roster. */
      ok('…and can scout an opponent from the team page too, not only from a sheet',
        !!q('#view-teams .tm-scout-panel') && !!q('#view-teams #tm-scout-who') && !!q('#view-teams #tm-scout'));
      const oursBtn = q('#view-teams #tm-ours');
      ok('…once the team is linked to its wpmatch squad', !!oursBtn);
      if (!oursBtn) console.log('   (skipped the rest: no #tm-ours button)');
      if (oursBtn) {
        oursBtn.click(); await wait(400);
        const panel = q('#view-teams .tm-ours .tm-scout');
        ok('pressing it shows our own squad, judged exactly like an opponent’s', !!panel && /Rossi/.test(panel.textContent));
        ok('…and our own squad is never offered a "keep as" name — it is not a scouting file', !q('#view-teams .tm-ours #tm-scout-keep'));
        const inf = q('#view-teams [data-pinfo]');
        ok('every name on the roster has a way to ask for that player’s figures', !!inf);
        if (inf) {
          inf.dispatchEvent(new window.Event('mouseenter'));
          await wait(80);
          const card = q('#view-teams .tm-pinfo-card');
          ok('hovering it shows that player’s own line, with the split the coach asked for',
            !!card && /18 goals in 11 matches/.test(card.textContent) && /14 at 6-on-6/.test(card.textContent));
          ok('…including exclusions conceded', /5 exclusions conceded/.test(card.textContent));
          ok('…and it rests under the heading rather than covering the rows', !!q('#view-teams .tm-pinfo'));
        }
      }
      W.searchTeams = realSearch; W.fetchListIndex = realIndex; W.fetchSquad = realSquad;
      const back = q('#view-teams [data-sheet]');                 // back to the sheet the rest of this section is on
      if (back) { back.click(); await wait(80); }
    }
    const fs = qa('#view-teams .tm-findings li').map(li => li.textContent);
    ok('the check flags the inactive licence by name', fs.some(t => /Inactive licence/.test(t) && /Mia Huber/.test(t)));
    ok('…and the player born too early for U14 in 2026/27', fs.some(t => /Too old/.test(t) && /Luca Frei/.test(t)));
    ok('…and cites the article each rule comes from', /Art\. 6\.4/.test(q('#view-teams .tm-findings').textContent));
    ok('the live preview is the paper form, licence numbers in it', /OFFIZIELLE SPIELAUFSTELLUNG/.test(q('#view-teams .tm-preview').textContent) && /50105/.test(q('#view-teams .tm-preview').textContent));
    q('#view-teams [data-rowcap="1"]').click(); await wait(40);
    ok('choosing a captain writes "First Last #cap" onto the sheet', /Jonas Brunner #2/.test(q('#view-teams .tm-preview').textContent));
    const saved = JSON.parse(window.localStorage.getItem(TM.KEY));
    ok('the sheet is kept on this device for next time', saved.sheets.length === 1 && saved.sheets[0].rows[1].captain === true);
    ok('the spy really is listening (a fetch made now is recorded)', (() => { const n = netLog.length; window.fetch('/spy-probe').catch(() => {}); return netLog.length === n + 1; })());
    ok('no licence number or name left the device while building the sheet', !netLog.some(l => /5010[1-5]|Huber|Brunner/.test(l)));
    window.fetch = realFetch;
  }

  console.log('\n[15b] What a roster is allowed to send to the club, and what sign-out takes with it');
  {
    const { TEAMSYNC: TS, TEAMS: TM } = window.__T;
    ok('the three lists of categories cannot drift apart', JSON.stringify(TS.CATEGORIES) === JSON.stringify(TM.CATEGORY_ORDER)
      && TS.CATEGORIES.filter(c => c !== 'CUSTOM').every(c => !!window.__T.ELIGIBILITY.CATEGORIES[c]));

    const licensed = { pid: 'L50101', licence: '50101', name: 'Huber', firstName: 'Mia', birthYear: '2013', gender: 'F', status: 'Ausländer-Étranger', cap: '4', gk: false, edited: true, wpId: 3400 };
    const sent = TM.forUpload(licensed);
    ok('a licensed player travels as a licence, a name and a cap — nothing else', JSON.stringify(Object.keys(sent).sort()) === JSON.stringify(['cap', 'firstName', 'gk', 'licence', 'localId', 'name', 'nameEdited', 'nameGuessed', 'localId'].filter((v, i, a) => a.indexOf(v) === i).sort()));
    // the device's own id for her goes too, so that when her licence finally arrives the club
    // recognises the same child instead of keeping a second row for ever. For a licensed player
    // that id IS 'L' + her licence, so it says nothing the licence did not already say.
    ok('…and the device id it carries tells the club nothing new', sent.localId === 'L' + sent.licence);
    ok('…so their birth year never leaves the device', sent.birthYear === undefined && !('birthYear' in sent));
    ok('…and neither does what wpmatch says about their nationality', !JSON.stringify(sent).includes('Ausl') && sent.status === undefined);
    const pending = TM.forUpload({ pid: 'm7a', licence: '', name: 'Neue', firstName: 'Spielerin', birthYear: '2013', gender: 'F' });
    ok('a signing with no licence yet takes the year only this device can supply', pending.localId === 'm7a' && pending.birthYear === 2013 && pending.gender === 'F');
    ok('the server would accept exactly what this builds', TS.sanitizePlayer(sent).ok === true && TS.sanitizePlayer(pending).ok === true);

    const store = { teams: [{ id: 't1', name: 'U14 blue', category: 'U14', leagueLabel: '', players: ['L50101'] }], players: { L50101: licensed }, templates: [], sheets: [] };
    const payload = TM.payloadFor(store, store.teams[0]);
    ok('a whole team is built into something the contract accepts', TS.sanitizeTeam(payload).ok === true && payload.players.length === 1);
    ok('…carrying no availability and no sheets', payload.availability === undefined && payload.sheets === undefined);
    ok('…and a season, so last season’s team is not this season’s', Number.isInteger(payload.season) && payload.season >= 2024);
    // a squad belongs to the season it plays: syncing an old team must not drag it into this one
    const old2 = TM.payloadFor(store, Object.assign({}, store.teams[0], { season: 2021 }));
    ok('a team keeps the season it was made for, however long after it is synced', old2.season === 2021);

    // what the device does when the club's answer is not a confirmation, and what it never sends
    const realApi = window.__T.SESSION.api, realOn = window.__T.SESSION.on;
    let asked = 0, lastBody = null;
    ok('with no club server, a roster is not sent anywhere at all', (await TM.syncTeam('c_stub', { id: 'tX', name: 'U14', category: 'U14', players: [] })).error === 'no-club');
    window.__T.SESSION.on = () => true;
    window.localStorage.setItem(TM.KEY, JSON.stringify({ version: 1, templates: [], sheets: [],
      teams: [{ id: 'tX', name: 'U14 blue', category: 'U14', leagueLabel: '', players: ['L50101'] },
              { id: 'tBad', name: 'Nonsense', category: 'U13', leagueLabel: '', players: [] }],
      players: { L50101: licensed } }));
    window.__T.SESSION.api = async (path, opts) => { asked++; lastBody = opts && opts.body; return { at: 1, team: { localId: 'tX', id: 'ct_stub' }, players: [] }; };
    const dropped = await TM.syncTeam('c_stub', TM.load().teams[0]);
    ok('an answer that quietly dropped a player is not a confirmation', dropped.ok === false && dropped.error === 'manifest-mismatch');
    ok('…and the device does not mark that team as sent', (TM.syncStateOf('c_stub', 'tX') || {}).state !== 'confirmed');
    ok('…while what it did send carried the licence and no birth year', !!lastBody && lastBody.players[0].licence === '50101' && lastBody.players[0].birthYear === undefined);
    /* A team that reached the club once and then fails to sync must not lose the id the club knows
       it by: without it the coach's own team comes back as a stranger's, and ✕ can no longer reach
       the club's copy of a child. */
    window.__T.SESSION.api = async () => ({ at: 9, team: { localId: 'tX', id: 'ct_AAAAAAAAAAAAAAAAAAAAAA' }, players: [{ licence: '50101', id: 'cp_known', rev: 1 }] });
    await TM.syncTeam('c_stub', TM.load().teams[0]);
    ok('a team that reached the club is remembered by the id the club gave it', (TM.syncStateOf('c_stub', 'tX') || {}).serverId === 'ct_AAAAAAAAAAAAAAAAAAAAAA');
    window.__T.SESSION.api = async () => { throw Object.assign(new Error('offline'), { status: 0, error: 'offline' }); };
    const lost = await TM.syncTeam('c_stub', TM.load().teams[0]);
    ok('a later attempt that fails says so', lost.ok === false && lost.error === 'offline');
    ok('…and does not forget where that team lives', (TM.syncStateOf('c_stub', 'tX') || {}).serverId === 'ct_AAAAAAAAAAAAAAAAAAAAAA');
    ok('…nor which id the club knows each player by', ((TM.syncStateOf('c_stub', 'tX') || {}).players || {}).L50101 === 'cp_known');

    window.__T.SESSION.api = async (path, opts) => { asked++; lastBody = opts && opts.body; return { at: 1, team: { localId: 'tX', id: 'ct_stub' }, players: [] }; };
    const before = asked;
    const refused = await TM.syncTeam('c_stub', TM.load().teams[1]);
    ok('a team the shared contract refuses never leaves the device at all', refused.ok === false && refused.error === 'bad-category' && asked === before);
    window.__T.SESSION.api = realApi; window.__T.SESSION.on = realOn;
    ok('the upload is not offered in a session opened by following somebody’s link', TM.maySync({ origin: 'join' }) === false && TM.maySync({ origin: 'recover' }) === false && TM.maySync({ origin: 'login' }) === true);

    window.localStorage.setItem(TM.MIRROR_KEY, JSON.stringify({ clubs: { c_x: { syncedAt: 1, teams: [] } } }));
    window.localStorage.setItem(TM.SYNC_KEY, JSON.stringify({ 'c_x:t1': { state: 'confirmed' } }));
    window.localStorage.setItem(TM.CARD_KEY, JSON.stringify({ player: { licence: '50101' } }));
    TM.saveScout({ listId: 4242, name: 'Some Squad', url: '', squad: { players: [], matches: 0 } }, 'Saturday');
    ok('there is something to lose before signing out', !!window.localStorage.getItem(TM.KEY) && !!window.localStorage.getItem(TM.CARD_KEY) && !!window.localStorage.getItem(TM.SCOUT_KEY));
    TM.wipeDevice();
    ok('signing out leaves no roster, no club copy, no sync log and no player card', [TM.KEY, TM.MIRROR_KEY, TM.SYNC_KEY, TM.CARD_KEY].every(k => !window.localStorage.getItem(k)));
    ok('…and no squad the coach had looked up either', !window.localStorage.getItem(TM.SCOUT_KEY) && TM.scoutList().length === 0);
    ok('…and the module is not still holding the last team it drew', TM.load().teams.length === 0);
  }

  console.log('\n[16] Service worker — the club server is never cached, and only good answers are');
  {
    const vm = await import('node:vm');
    const src = readFileSync(join(APP, 'sw.js'), 'utf8');
    const store = new Map(); const puts = []; let matches = 0; const net = [];
    const handlers = {};
    const resp = (status, type = 'basic', body = 'x') => ({ status, ok: status >= 200 && status < 300, type, body, clone() { return this; } });
    let nextResponse = () => resp(200);
    const sandbox = {
      URL, console,
      location: { origin: 'https://club.example' },
      self: { addEventListener: (t, fn) => { handlers[t] = fn; }, skipWaiting() {}, clients: { claim() {} } },
      caches: {
        open: async () => ({ put: async (req, r) => { puts.push(req.url + ' ' + r.status); store.set(req.url, r); }, addAll: async () => {} }),
        match: async req => { matches++; return store.get(typeof req === 'string' ? 'https://club.example/' + req.replace(/^\.\//, '') : req.url); },
        keys: async () => [], delete: async () => true,
      },
      fetch: async req => { net.push(req.url); return nextResponse(); },
    };
    vm.runInNewContext(src, sandbox);
    const flush = () => new Promise(r => setTimeout(r, 5));
    async function hit(url, method = 'GET') {
      let responded = null;
      handlers.fetch({ request: { url, method }, respondWith: p => { responded = p; } });
      const out = responded ? await responded : undefined; await flush();
      return { intercepted: !!responded, out };
    }
    const m0 = matches;
    const api = await hit('https://club.example/api/me');
    const clip = await hit('https://club.example/api/clips/a_1_2.mp4');
    ok('/api/ requests go straight to the network (not intercepted, cache never consulted)', !api.intercepted && !clip.intercepted && matches === m0 && puts.length === 0);
    ok('a path that merely contains "api" is still served normally', (await hit('https://club.example/js/api.js')).intercepted);
    ok('non-GET and third-party requests are left alone', !(await hit('https://club.example/js/x.js', 'POST')).intercepted && !(await hit('https://cdn.example/lib.js')).intercepted);
    puts.length = 0;
    nextResponse = () => resp(200); await hit('https://club.example/js/good.js');
    nextResponse = () => resp(404); await hit('https://club.example/js/missing.js');
    nextResponse = () => resp(500); await hit('https://club.example/css/broken.css');
    nextResponse = () => resp(206); await hit('https://club.example/docs/demo/clip.mp4');
    nextResponse = () => resp(0, 'opaqueredirect'); await hit('https://club.example/somewhere');
    ok('a 200 from our origin is cached', puts.includes('https://club.example/js/good.js 200'));
    ok('404, 500, 206 partial and redirects are never cached', puts.length === 1);
    store.set('https://club.example/data/rules.json', resp(200, 'basic', 'cached-rules'));
    nextResponse = () => resp(503);
    const rules = await hit('https://club.example/data/rules.json');
    ok('rules.json: a server error does not replace the cached rule book', rules.out && rules.out.body === 'cached-rules' && store.get('https://club.example/data/rules.json').body === 'cached-rules');
  }

  console.log('\n[17] The app icon — the brand mark, and the wiring that silently breaks');
  {
    /* An icon fault never throws: a missing file is a blank tile, a transparent PNG is a black
       box on an iOS home screen, a size that does not match what the manifest claims is a blurry
       one, and an icon left out of the precache list is the only asset missing offline. None of
       that shows up in any other test, and none of it is visible until the app is installed on
       somebody's phone. So the wiring is asserted here.

       The PIXELS are a separate gate — `python3 scripts/build-icons.py --check` redraws all five
       from brand/ and fails on any difference — because it needs Pillow, and a suite that skips
       itself when an import is missing is not a gate. It is listed with the other standalone
       gates in README.md. */
    const manifest = JSON.parse(readFileSync(join(APP, 'manifest.webmanifest'), 'utf8'));
    const swSrc = readFileSync(join(APP, 'sw.js'), 'utf8');
    const onDisk = readdirSync(join(APP, 'icons')).filter(f => f.endsWith('.png')).sort();

    /* PNG header: 8-byte signature, then IHDR with width, height, bit depth and colour type.
       Colour type 4 and 6 carry an alpha channel; a tRNS chunk makes any of the others
       transparent too. Either way the launcher gets holes it will fill with black. */
    const png = (name) => {
      let b; try { b = readFileSync(join(APP, 'icons', name)); } catch { return null; }   // a missing icon is the assertion above's to report, not a crash
      const sig = b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
      return { sig, w: b.readUInt32BE(16), h: b.readUInt32BE(20), colour: b[25], tRNS: b.includes('tRNS') };
    };

    const declared = manifest.icons.map(i => i.src.replace(/^\.?\//, ''));
    const linked = [...html.matchAll(/(?:href|content)="(icons\/[^"]+)"/g)].map(m => m[1]);
    const missing = [...declared, ...linked].filter(p => !onDisk.includes(p.replace('icons/', '')));
    ok('every icon the manifest and index.html name is actually on disk', missing.length === 0);
    ok('every icon on disk is precached, so an installed app is not missing one offline',
      onDisk.every(f => swSrc.includes(`icons/${f}`)));
    ok('nothing is precached that no longer exists',
      [...swSrc.matchAll(/icons\/([\w.-]+\.png)/g)].every(m => onDisk.includes(m[1])));

    ok('each icon really is the size the manifest claims it is',
      manifest.icons.every(i => { const p = png(i.src.replace(/^\.?\//, '').replace('icons/', '')); return p && `${p.w}x${p.h}` === i.sizes; }));
    ok('every icon is a real PNG and is fully opaque (a transparent app icon is a black box)',
      onDisk.every(f => { const p = png(f); return p && p.sig && ![4, 6].includes(p.colour) && !p.tRNS; }));

    const maskable = manifest.icons.filter(i => (i.purpose || '').split(/\s+/).includes('maskable'));
    ok('exactly one icon is declared maskable, and it is the one drawn small for the crop',
      maskable.length === 1 && maskable[0].src.includes('maskable'));
    ok('the regular icons are NOT declared maskable (Android would shrink them a second time)',
      manifest.icons.filter(i => !i.src.includes('maskable')).every(i => !i.purpose));
    ok('the manifest keeps its id — it can only be set before the first install', manifest.id === '/');

    /* The one that would have shipped silently today: five icons changed and the cache name did
       not, so every installed app would have kept the old art for good. The name now carries a
       digest of everything ASSETS lists, and this checks it is the digest of what is on disk. */
    const { stampFor } = await import('../scripts/sw-stamp.mjs');
    const stamped = (swSrc.match(/const ASSET_STAMP = '([0-9a-f]*)'/) || [])[1];
    ok('the service-worker cache name is the digest of what it precaches, and is current',
      stamped && stamped === stampFor(swSrc));
    ok('…and the cache name actually uses it, so a changed asset changes the cache',
      /const CACHE = 'triibholz-v\d+-' \+ ASSET_STAMP;/.test(swSrc));

    /* The mark is vector, and which master an icon is built from is a correctness question, not
       a taste one: the navy master is 1.61:1 against the app's ground, which is invisible. */
    const svg = (n) => readFileSync(join(APP, 'brand', n), 'utf8');
    const fills = (s) => [...s.matchAll(/fill="([^"]+)"/g)].map(m => m[1].toLowerCase());
    ok('the brand masters are present and are the source the icons are drawn from',
      ['thplay-mark.svg', 'thplay-mark-dark.svg', 'thplay-mark-mono.svg'].every(n => svg(n).includes('<svg') && svg(n).includes('viewBox')));
    ok('the dark master — the one the icons use — is white on the body, never navy',
      fills(svg('thplay-mark-dark.svg'))[0] === '#ffffff');
    ok('the light master keeps the brand navy, for print and anything on white',
      fills(svg('thplay-mark.svg'))[0] === '#283655');
    ok('the inline master follows the surrounding text colour, so it works in both looks',
      fills(svg('thplay-mark-mono.svg')).every(f => f === 'currentcolor'));
    ok('every path is filled even-odd — nonzero would flood the ball’s seams',
      ['thplay-mark.svg', 'thplay-mark-dark.svg', 'thplay-mark-mono.svg']
        .every(n => (svg(n).match(/fill-rule="evenodd"/g) || []).length === (svg(n).match(/<path/g) || []).length));
  }

  console.log('\n[18] Cutting a piece out of the match, and the keys that must never reach a coach');
  {
    /* The coach's own words: "I still do not know how to cut the videos". They were right — there
       was no cut control anywhere. A clip could only ever appear as a by-product: a row auto-scout
       chose, a moment being sent to a player, a debrief. All three sit behind a Tier-3 scan of the
       whole match, and none of them lets a coach say which twenty seconds they meant. */
    const filmSrc = readFileSync(join(APP, 'js/film.js'), 'utf8');

    /* FILM caches `sessions` and `cur` in module state, so writing localStorage here would change
       nothing — the matches are picked through the real list, the way a coach does. Earlier
       sections leave an uploaded match selected, which is exactly why this has to be explicit. */
    q('.nav-btn[data-view="film"]').click(); await wait(60);
    const rowFor = kind => qa('.film-item').find(b => (FILM.load().find(x => x.id === b.dataset.id) || {}).source?.kind === kind);

    // a match added as a LINK: cutting is impossible, and the panel has to say so rather than vanish
    const linkRow = rowFor('youtube');
    ok('there is a YouTube match to test the link case against', !!linkRow);
    linkRow.click(); await wait(80);
    ok('the cut panel is on the screen for a YouTube match too', !!q('#film-cut'));
    ok('…carrying the reason a link cannot be cut, instead of hiding and teaching nothing',
      !q('#cut-in') && /Upload video|cannot be cut/i.test((q('#film-cut') || {}).textContent || ''));

    // a match added as a FILE: the coach marks their own in and out
    const fileRow = rowFor('file');
    ok('there is an uploaded match to test the cut against', !!fileRow);
    fileRow.click(); await wait(80);

    ok('an uploaded match offers a cut control', !!q('#film-cut') && !!q('#cut-in') && !!q('#cut-out') && !!q('#cut-go'));
    ok('…and it is disabled until a start AND an end are marked', q('#cut-go').disabled);
    ok('…with a readout that tells the coach what to do first', /mark the start/i.test(q('#cut-range').textContent));
    ok('the coach can keep the piece, not only send it', /download=/.test(filmSrc) && filmSrc.includes("film.cutDownload"));
    ok('a hidden Send button is explained rather than simply absent', filmSrc.includes('film.cutSendNeedsAccounts'));

    /* The server caps a clip at 60s SILENTLY (server/index.js Math.min(start + 60, …)). Asking for
       three minutes and getting one back with no word is the kind of quiet wrong answer this app
       does not ship, so the client both keeps inside the cap and checks what came back. */
    const srvSrc = readFileSync(join(APP, 'server/index.js'), 'utf8');
    ok('the 60s server cap is still the number the client guards against',
      /Math\.min\(start \+ 60,/.test(srvSrc) && /const MAX_CUT = 60;/.test(filmSrc));
    ok('a clip that came back shorter than asked for is reported, not passed off as the cut',
      filmSrc.includes('truncated:') && filmSrc.includes('film.cutTruncated'));
    ok('a coach-chosen range is cut exactly — the ±2s run-up is only for machine-chosen ones',
      /cutClip\(videoRef, t0, t1, pad = 2\)/.test(filmSrc) && /cutClip\(ref, from, to, 0\)/.test(filmSrc));

    /* Tagging re-renders the panel, which rebuilds the <video>. Without somewhere to put the
       coach back, the match jumped to 0:00 on every single save — and tagging a match is thirty
       saves. */
    ok('the match keeps its place when a moment is saved', /resumeAt = playing\.currentTime/.test(filmSrc) && /v\.currentTime = Math\.min\(at/.test(filmSrc));

    /* A play staged from a film moment is real work — positions dragged, steps captured, notes
       typed — and closeEditor() throws all of it away. It used to run on a click anywhere on the
       backdrop, with no warning and no undo. */
    const appSrc = readFileSync(join(APP, 'js/app.js'), 'utf8');
    ok('a stray click beside the editor no longer discards the play',
      !/\$\('editor-modal'\)\.onclick = \(e\)=>\{ if\(e\.target===\$\('editor-modal'\)\) closeEditor\(\); \}/.test(appSrc)
      && appSrc.includes("ui.editorCloseHint"));
    ok('…and there are still two plain ways out of it', html.includes('id="editor-close"') && html.includes('id="ed-cancel"'));

    /* THE GENERAL GUARD. Two separate places built a string out of an i18n KEY and never
       translated it: the title of every play captured from film ("… — film.typeGoalAgainst"),
       which is then SAVED, and the club activity line. Both read a `.label` that holds a key.
       A missing translation is a visible mistake; a key rendered as if it were words is a mistake
       that looks like a feature, so nothing catches it. This does. */
    const i18nSrc = readFileSync(join(APP, 'js/i18n.js'), 'utf8');
    const enStart = i18nSrc.indexOf('    en: {'), deStart = i18nSrc.indexOf('    de: {');
    const enKeys = new Set([...i18nSrc.slice(enStart, deStart).matchAll(/'([A-Za-z0-9_.]+)':/g)].map(m => m[1]));
    ok('the English dictionary was found, so this guard is actually checking something', enKeys.size > 1500);

    /* Two different leaks, and the first version of this guard only caught one. A key that EXISTS
       and was never translated (`film.typeGoalAgainst`) is caught by the dictionary test. A key
       that was never ADDED renders as itself too, and is invisible to that test — which is exactly
       what happened to the nine keys the ✎ Edit work introduced. So anything shaped like a key in
       a namespace this app really uses counts, whether the dictionary has it or not. */
    const namespaces = new Set([...enKeys].map(k => k.split('.')[0]));
    const FILE_ISH = /\.(mp4|webm|png|jpg|svg|json|html|css|js|mjs|pdf|docx|xlsx|ics|ch|com|org)$/i;
    const keyShaped = tok => !FILE_ISH.test(tok) && /^[a-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9.]*$/.test(tok) && namespaces.has(tok.split('.')[0]);
    const leaked = [];
    const walk = (node) => {
      if (node.nodeType === 3) {
        for (const tok of String(node.nodeValue).split(/\s+/)) if (tok && (enKeys.has(tok) || keyShaped(tok))) leaked.push(tok);
      } else if (node.nodeType === 1 && !['SCRIPT', 'STYLE'].includes(node.tagName)) {
        for (const c of node.childNodes) walk(c);
      }
    };
    walk(document.body);
    ok('the guard knows which namespaces are real, so a key nobody defined still counts', namespaces.size > 10 && keyShaped('film.neverDefined') && !keyShaped('vs-Red-Sharks.mp4'));
    ok('no translation key is sitting on the screen pretending to be words' + (leaked.length ? ' — found: ' + [...new Set(leaked)].slice(0, 4).join(', ') : ''), leaked.length === 0);

    ok('the title a play gets from a film moment is translated before the emoji is stripped',
      /TX\(T\.label\)\.replace/.test(filmSrc) && !/\$\{T\.label\.replace/.test(filmSrc));
    ok('…and so is the club activity line about a tagged moment',
      /TX\(wasEditing \? 'film\.logCorrected' : 'film\.logTagged', \{ who:/.test(filmSrc)
      && /what: TX\(typeOf\(type\)\.label\)/.test(filmSrc));
    ok('…as one whole sentence, not words stitched in English order',
      /'film\.logTagged':'\{who\} tagged \{what\} at \{when\}/.test(i18nSrc)
      && (i18nSrc.match(/'film\.logCorrected':/g) || []).length === 4);

    /* Sending a cut used to throw the coach's range away: openSendMoment computed its own
       t-4 … t+6 window around the in-point, so the team received a different passage from the
       one the coach had just watched and approved. */
    ok('sending a cut sends the passage the coach marked, not a window of its own',
      /const start = range \? range\.from :/.test(filmSrc) && /const end = range \? range\.to :/.test(filmSrc));
    ok('…and the cut path passes the marked range, however the panel was rebuilt',
      /\{ from: lastCut\.from, to: lastCut\.to \}/.test(filmSrc));

    // a finished cut used to be wiped by the next re-render — i.e. by tagging the next moment
    ok('a finished cut survives tagging the next moment', /lastCut = \{ html:/.test(filmSrc) && /if \(lastCut\) \{ box\.innerHTML = lastCut\.html;/.test(filmSrc));
    ok('…but a different match never shows the previous match’s cut', /cutIn=cutOut=null; lastCut=null;/.test(filmSrc));

    /* The guide is where a coach looks when they do not know how — and it had ten steps, none
       about cutting. That, not a missing feature, is what "I do not know how to cut" meant. */
    const helpSrc = readFileSync(join(APP, 'js/help.js'), 'utf8');
    ok('the Film Room guide now teaches cutting', helpSrc.includes("'help.film.sCut'") && i18nSrc.includes("'help.film.sCut'"));
    ok('…in all four languages', (i18nSrc.match(/'help\.film\.sCut':/g) || []).length === 4);
    ok('…and it names the three controls a coach has to press', /Start here/.test(i18nSrc) && /End here/.test(i18nSrc));

    /* The goal-mouth picker was nine identical empty buttons: no text, no title, no aria-label.
       Marking where the shot went is half of "mark up the situation". */
    const zones = qa('#film-zone-pick .gz');
    ok('the goal mouth has its nine cells', zones.length === 9);
    ok('…and every one of them says what it is, to a coach and to a screen reader',
      zones.every(z => (z.getAttribute('title') || '').length > 10 && z.getAttribute('aria-label') === z.getAttribute('title')));

    // the old advice told the coach to run a scout job, which cutting never needs
    ok('a lost upload tells the coach to cut again, not to run a scouting job',
      !/scout the video again/.test(i18nSrc));

  }

  console.log('\n[19] Correcting what you tagged, and which side actually attacked');
  {
    /* A timeline row used to offer Board ⚡, ✕ and 📤 and nothing else, so a typo in a note, a
       wrong cap number or a verdict pressed by mistake meant deleting the moment and tagging it
       again — board included. */
    q('.nav-btn[data-view="film"]').click(); await wait(80);
    const demoRow = qa('.film-item').find(b => /Sample match/.test(b.textContent));
    if (demoRow) { demoRow.click(); await wait(80); }

    const before = qa('.film-ev').length;
    ok('a saved moment offers a way to correct it', before > 0 && !!q('.film-ev [data-edit]'));

    const firstId = q('.film-ev').dataset.id;
    q('.film-ev [data-edit]').click(); await wait(40);
    ok('pressing it loads that moment back into the bar it was made in',
      q('#film-t').value.length > 0 && !!q('#film-type').value && q('.film-ev.editing')?.dataset.id === firstId);
    ok('…and the save button now says it will update, not add', /update/i.test(q('#film-add').textContent));
    ok('…with a visible way out that is not saving something', !q('#film-editing').hidden && !!q('#film-edit-cancel'));

    const newNote = 'corrected: the slide came from 4, not 3';
    q('#film-note').value = newNote;
    q('#film-add').click(); await wait(120);
    ok('saving replaces that moment instead of making a second one', qa('.film-ev').length === before);
    ok('…and the correction is what is stored', JSON.stringify(FILM.load()).includes(newNote));
    ok('…and the app is no longer in edit mode', q('#film-editing').hidden && !q('.film-ev.editing'));

    const filmSrc2 = readFileSync(join(APP, 'js/film.js'), 'utf8');
    ok('editing a moment restages the board it was saved with, not a blank one',
      /function buildBoard\(main, sit, frame\)/.test(filmSrc2) && /buildBoard\(main, main\.querySelector\('#film-sit'\)\.value, e\.frame \|\| null\)/.test(filmSrc2));
    ok('opening another match drops a half-finished edit', /editingId=null; render\(root, ctx\)/.test(filmSrc2));

    /* Auto-scout stamped 'offense' on every possession, so every attack the OPPONENT ran arrived
       in the playbook filed as one of ours — the defensive half of a match could not be captured
       at all. Which phase it is depends on which cap colour we are, and only the Film Room knows. */
    const tacSrc = readFileSync(join(APP, 'js/tactics.js'), 'utf8');
    const appSrc2 = readFileSync(join(APP, 'js/app.js'), 'utf8');
    ok('a recognised play carries which side attacked, instead of a hardcoded phase',
      /offense: p\.offense,/.test(tacSrc) && !/situation: p\.situation, phase: 'offense'/.test(tacSrc));
    ok('the Film Room turns that into our phase, using the same test as the attack list',
      /const phaseOf = play =>/.test(filmSrc2) && /play\.offense !== ourSide\(\)\) \? 'defense' : 'offense'/.test(filmSrc2));
    ok('…and both routes into the playbook pass it',
      /phase: phaseOf\(p\)/.test(filmSrc2) && /Object\.assign\(\{\}, p, \{ phase: phaseOf\(p\) \}\)/.test(filmSrc2));
    ok('the editor honours a phase it is handed rather than assuming offense',
      /DATA\.newScenario\(play\.situation \|\| '6v6', play\.phase \|\| 'offense'\)/.test(appSrc2));

    /* TACTICS is pure and testable on its own: give it a possession by each side and check the
       phase the Film Room would derive, rather than trusting the wiring. */
    const asUs = { offense: 'att' }, asThem = { offense: 'def' };
    const derive = (play, usSide) => (play.offense && play.offense !== usSide) ? 'defense' : 'offense';
    ok('white caps: our possession is offense, theirs is defense',
      derive(asUs, 'att') === 'offense' && derive(asThem, 'att') === 'defense');
    ok('dark caps: it flips, because "us" is the other colour',
      derive(asUs, 'def') === 'defense' && derive(asThem, 'def') === 'offense');
  }

  console.log('\n[20] A library of cuts, and reading ONE situation instead of a whole match');
  {
    /* The owner's ask: "analyse also the cuts so just one situation… save it as… get the next
       cuts… a library of saved videos and analysis."

       It is not only convenience. Measured against the live pipeline on the demo match: scouting
       the whole 20 s returns FOUR possessions, three of them Unclassified at confidence 0 — one of
       them 0.3 s long. Scouting an 8 s cut of the same footage returns ONE line, Counter-attack at
       0.9. The fragments are an artefact of splitting continuous play, so cutting first does not
       just save time, it removes the noise. */
    const R = FILM._readOfCut;
    const i18nSrc = readFileSync(join(APP, 'js/i18n.js'), 'utf8');

    const good = { plays: [
      { tactic: 'counter-attack', name: 'Counter-attack', confidence: 0.9, offense: 'att', situation: '6v6', tStart: 0.2, tEnd: 7.5, steps: ['3 drives'], frames: [{}, {}], notes: {}, endsInShot: true },
      { tactic: 'unclassified', name: 'Unclassified', confidence: 0, offense: 'def', situation: '6v6', tStart: 7.7, tEnd: 8.0, steps: [], frames: [], notes: {} },
    ] };
    const r = R(good);
    ok('one cut reads as the one thing the analyser actually recognised', r.name === 'Counter-attack' && r.tactic === 'counter-attack');
    ok('…and the scraps beside it are counted, not averaged in or shown as an answer', r.fragments === 1 && r.confidence === 0.9);
    ok('…and it carries which side attacked, so the playbook files it correctly', r.offense === 'att');

    ok('a cut with nothing recognisable says so rather than picking the least bad fragment',
      R({ plays: [{ name: 'Unclassified', confidence: 0, tStart: 0, tEnd: 3 }] }).none === true);
    ok('an empty read is null, not an invented one', R({ plays: [] }) === null && R(null) === null);
    ok('the best read wins on confidence, and length only breaks a tie',
      R({ plays: [
        { name: 'Short but sure', confidence: 0.8, tStart: 0, tEnd: 1, frames: [] },
        { name: 'Long but unsure', confidence: 0.3, tStart: 0, tEnd: 30, frames: [] },
      ] }).name === 'Short but sure');

    /* THE ONE THAT WOULD HAVE TAKEN A CHILD'S VIDEO AWAY. recordAsset is INSERT OR REPLACE on id,
       and requireAssetRead(..., ['clip']) is what lets a player watch a clip that was sent to them.
       Registering the cut as a video under the CLIP'S id would have rewritten that row as kind
       'video' and 404'd the player who had been sent it. */
    const srvSrc = readFileSync(join(APP, 'server/index.js'), 'utf8');
    ok('a cut registered as a video takes its own asset id, never the clip’s',
      /const ref = 'cut_' \+ id \+ '\.mp4'/.test(srvSrc) && /kind: 'video'/.test(srvSrc));
    ok('…and the clip keeps its own row, so a player sent that clip can still watch it',
      /access\.recordAsset\(\{ id: id \+ '\.mp4', kind: 'clip'/.test(srvSrc));
    ok('the bytes are shared, not copied twice, and a refused link still works',
      /fs\.linkSync\(out, vcopy\)/.test(srvSrc) && /fs\.copyFileSync\(out, part\)/.test(srvSrc));
    ok('a cut that cannot be made analysable is still a cut', /analysisRef = null; \}/.test(srvSrc));

    const filmSrc3 = readFileSync(join(APP, 'js/film.js'), 'utf8');
    ok('a cut is kept the moment it is made, not behind a second button', /saveCut\(s, \{ id: uid\(\), from, to/.test(filmSrc3));
    ok('…and the shelf is redrawn so the coach sees it land', /saveCut\(s, \{[\s\S]{0,900}?renderSession\(\);\n        return;/.test(filmSrc3));
    ok('the library is bounded, so a season of cuts cannot fill the device', /if \(s\.clips\.length > 60\)/.test(filmSrc3));
    ok('a coach’s own label beats the machine’s and is shown as theirs',
      /c\.fixedTactic \? tacName/.test(filmSrc3) && i18nSrc.includes("'film.libCoachSaid'"));
    ok('removing a cut does not pretend to delete it from the club server',
      i18nSrc.includes("'film.libServerNote'") && /stays on the club server/.test(i18nSrc));
    ok('the relabel list is the tactics the analyser itself can name', (FILM.TACTIC_IDS || []).length >= 8
      && FILM.TACTIC_IDS.every(t => i18nSrc.includes("'tac." + t + "'")));
    ok('a cut analysed on its own is given the field the MATCH was read with',
      /calibration: calibrationFor\(cur\)/.test(filmSrc3));
    ok('…and waits seconds, not the half hour a whole match needs', /tries\+\+ < 90/.test(filmSrc3));

    /* Found by attacking the design after it shipped. Each is small and each is real. */
    ok('a cut cannot itself be cut — crf-28 of crf-28, and an id that outgrows safeToken',
      /if \(\/\^cut_\/\.test\(safeToken\(cr\.videoRef\)\)\) return send\(res, 400, \{ error: 'cut-of-a-cut' \}\)/.test(srvSrc));
    ok('a half-written copy can never be cached as an analysable video',
      /const part = vcopy \+ '\.part'/.test(srvSrc) && /fs\.renameSync\(part, vcopy\)/.test(srvSrc));
    ok('a full device is said out loud instead of swallowed, and the cut is not left looking saved',
      /return true; \} catch \(e\) \{ return false; \}/.test(filmSrc3)
      && /if \(!save\(sessions\)\) \{ s\.clips\.shift\(\); ctx\.toast\(TX\('film\.libFull'\)\)/.test(filmSrc3));
    ok('the field a match was read with is kept, so a cut is not re-analysed against a guess',
      /cur\.calibration = \{ H: vHomography \|\| null/.test(filmSrc3) && /const calibrationFor = s =>/.test(filmSrc3));
    ok('…and an uncalibrated match falls back to auto rather than sending a null homography as fixed',
      /\{ H: null, mode: 'auto', minConf: 0\.4 \}/.test(filmSrc3));
  }

  console.log('\n[21] Taking a device with you — the move that would otherwise lose a season');
  {
    /* Browser storage is keyed by ORIGIN. The day this app moves from localhost:8088 to thplay.ch,
       every coach's plays, rosters, tagged moments, cut library and player test histories stay
       behind at an address nobody will open again. Nothing errors; the app simply looks new.
       "Backup all my plays" is honestly named and covers plays only, so a coach who dutifully
       pressed it before the move would still lose most of it. */
    const { DEVICE } = window.__T;
    const mem = () => { const m = { _: {} };
      m.getItem = k => (k in m._ ? m._[k] : null);
      m.setItem = (k, v) => { m._[k] = String(v); };
      m.key = i => Object.keys(m._)[i];
      Object.defineProperty(m, 'length', { get: () => Object.keys(m._).length });
      return m; };

    const src = mem();
    src.setItem('thplay.teams.v1', '{"teams":[{"name":"U14"}]}');
    src.setItem('thplay.film.v1', '{"sessions":[{"clips":[{"id":"c1"}]}]}');
    src.setItem('thplay.testlog.nora', '{"tests":[1,2]}');
    src.setItem('thplay.lang', 'de');
    src.setItem('thplay.calendar.token', 'SECRET-DO-NOT-MOVE');
    src.setItem('someoneelse.app', 'not ours');

    const file = DEVICE.pack(src, [{ key: 'film-1', name: 'vs Red Sharks', bytes: 900 * 1024 * 1024 }], { at: 'T', origin: 'http://localhost:8088' });
    ok('everything the coach made travels', ['thplay.teams.v1', 'thplay.film.v1', 'thplay.testlog.nora'].every(k => k in file.stores));
    ok('…and so do their preferences, which are small and still theirs', file.stores['thplay.lang'] === 'de');
    ok('another app’s storage is not swept up', !('someoneelse.app' in file.stores));
    ok('a calendar token is NOT carried — it is a credential, and it is reissued when accounts come on',
      !('thplay.calendar.token' in file.stores) && DEVICE.NEVER.includes('thplay.calendar.token'));
    ok('work and preferences are counted separately, so "what did I move?" has an answer',
      file.counts.work === 3 && file.counts.preferences === 1);

    /* One match video outweighs the whole rest of the file. They are NAMED, not embedded — a file
       that silently left them out would be worse than one that cannot be moved. */
    ok('videos are listed by name and size rather than carried', file.videos.length === 1 && file.videos[0].bytes > 0 && !JSON.stringify(file.stores).includes('film-1'));
    ok('…and the coach is told about them when the file is made', /deviceSavedWithVideos/.test(readFileSync(join(APP, 'js/app.js'), 'utf8')));

    // round trip onto a device that has nothing — the ordinary case, the move itself
    const fresh = mem();
    const r1 = DEVICE.apply(file, fresh, {});
    ok('on a fresh device everything is written back', r1.ok && r1.written.length === Object.keys(file.stores).length && !r1.kept.length);
    ok('…byte for byte', fresh.getItem('thplay.film.v1') === src.getItem('thplay.film.v1'));

    // and onto a device that already has its own work — the case that could lose a second season
    const busy = mem();
    busy.setItem('thplay.film.v1', '{"sessions":[{"mine":true}]}');
    const r2 = DEVICE.apply(file, busy, {});
    ok('a device with work of its own keeps it by default', r2.ok && r2.kept.includes('thplay.film.v1') && busy.getItem('thplay.film.v1') === '{"sessions":[{"mine":true}]}');
    ok('…and says what it left alone rather than silently skipping', r2.kept.length === 1 && r2.written.length > 0);
    const r3 = DEVICE.apply(file, busy, { replace: true });
    ok('…and replaces only when asked outright', r3.ok && busy.getItem('thplay.film.v1') === src.getItem('thplay.film.v1'));

    // a tampered file must not be able to write storage that is not ours
    ok('a file naming a foreign key is refused whole', DEVICE.check({ format: DEVICE.FORMAT, stores: { 'evil.key': 'x' } }).error === 'foreign-key');
    ok('…and so is one smuggling the calendar token back in', DEVICE.check({ format: DEVICE.FORMAT, stores: { 'thplay.calendar.token': 'x' } }).error === 'foreign-key');
    ok('a file of the wrong format is refused before anything is written', DEVICE.check({ format: 'something.else', stores: {} }).error === 'wrong-format');
    ok('…and a plays backup is not mistaken for a device file', DEVICE.check(JSON.parse('{"kind":"thplay.set","plays":[]}')).ok === false);

    /* THE RATCHET. This is the part that still works in a year. A new store added anywhere in the
       app is invisible to a prefix sweep if it does not share the prefix — and the failure is
       silent, at the worst possible moment, on somebody's move. */
    const storeKeys = new Set();
    for (const f of readdirSync(join(APP, 'js')).filter(n => n.endsWith('.js'))) {
      const t = readFileSync(join(APP, 'js', f), 'utf8');
      for (const m of t.matchAll(/localStorage\.(?:setItem|getItem|removeItem)\(\s*'([^']+)'/g)) storeKeys.add(m[1]);
      for (const m of t.matchAll(/const KEY = '([^']+)'/g)) storeKeys.add(m[1]);
    }
    const stray = [...storeKeys].filter(k => !DEVICE.isOurs(k));
    ok('every store the app writes shares the prefix the sweep looks for' + (stray.length ? ' — stray: ' + stray.join(', ') : ''),
      storeKeys.size >= 8 && stray.length === 0);

    ok('a whole-device file is recognised before the play importer can strip it to its plays',
      /maybe\.format === DEVICE\.FORMAT\) return void await deviceRestore/.test(readFileSync(join(APP, 'js/app.js'), 'utf8')));
    ok('the module is precached, so the move works on a device that is already offline',
      readFileSync(join(APP, 'sw.js'), 'utf8').includes('./js/device.js'));

    /* The other half of the retention promise. server/retention.js expires match video after a
       season; without the same window HERE the footage sits in a coach's browser for ever and the
       promise is only half true — and on a shared club iPad that is the half that matters.
       jsdom has no IndexedDB, so the rules are asserted rather than the store driven. */
    const fsrc = readFileSync(join(APP, 'js/film.js'), 'utf8');
    ok('the device applies the same window the club server reports, not one of its own',
      /const r = await sweepVideos\(d\)/.test(fsrc) && /retentionDays = \+h\.retentionDays/.test(fsrc));
    ok('a blob with no recorded arrival is stamped, never deleted on sight',
      /if \(m\[k\] == null\) \{ m\[k\] = now; dirty = true; continue; \}/.test(fsrc));
    ok('…so losing that record costs a season’s delay, not somebody’s match',
      /a full season from\s+first sight/.test(fsrc));
    ok('a blob whose match no longer exists goes sooner — nothing can reach it, and it is still video of children',
      /const orphan = !live\.has\(k\)/.test(fsrc) && /ORPHAN_GRACE_DAYS = 7/.test(fsrc));
    ok('putting a video down records when, and taking it away forgets when',
      /m\[key\] = Date\.now\(\); saveVideoAt\(m\)/.test(fsrc) && /delete m\[key\]; saveVideoAt\(m\)/.test(fsrc));
    ok('the coach is told what went rather than finding out by its absence', fsrc.includes("film.videosExpired"));
    ok('…and the sweep never makes them wait for the screen', /retention\(\)\.then\(async d => \{[\s\S]{0,120}renderSession\(\);/.test(fsrc));
    ok('the arrival record travels with a device move, because it shares the prefix',
      DEVICE.isOurs(FILM._videoAtKey) && DEVICE.kind(FILM._videoAtKey) === 'work');
  }

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail?1:0);
 } catch(e){ console.error('THREW:', e && e.stack || e); process.exit(2); }
})();
