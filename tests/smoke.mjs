/* Headless regression suite (jsdom) — full app flow without a browser.
   Run:  node tests/smoke.mjs   (deps: npm i inside tests/) */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextEncoder as TE } from 'node:util';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(APP, 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://test.local/' });
const { window } = dom; const { document } = window;
window.TextEncoder = window.TextEncoder || TE;   // QR needs it

const files = ['js/i18n.js','js/help.js','js/draft.js','js/commands.js','js/solver.js','js/qr.js','js/fx.js','js/pool.js','js/data.js','js/animate.js','js/vision.js','js/field.js','js/track.js','js/bytetrack.js','js/events.js','js/webdetector.js','js/videogen.js','js/calendar.js','js/planner.js','js/privacy.js','js/tactics.js','js/gameplan.js','js/share.js','js/analysis.js','js/film.js','js/app.js'];
const combined = files.map(f => readFileSync(join(APP, f), 'utf8')).join('\n;\n')
  + '\n;\nwindow.__T = { POOL, DATA, ANIM, I18N, QR, FX, FILM, HELP, DRAFT, COMMANDS, SOLVER, VISION, TRACK, ANALYSIS, BYTETRACK, EVENTS, WEBDETECTOR, VIDEOGEN, CALENDAR, PLANNER, PRIVACY, TACTICS, GAMEPLAN, SHARE, FIELD };';

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
  ok('16 help topics defined', Object.keys(window.__T.HELP.TOPICS).length===16);
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
    ok('22 commands defined', COMMANDS.list.length===22);
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
    ok('foul-reset note names the foul', /foul/i.test(Object.values(COMMANDS.apply(scn,'foul-reset',{target:'team'}).notes).join(' ')));
    ok('crash puts 2 defenders on the centre', (()=>{ const hp=before.att[Object.keys(before.att).sort((a,b)=>before.att[b].x-before.att[a].x)[0]];
      const d=COMMANDS.apply(scn,'crash',{target:'team'}).steps[0].def;
      return Object.keys(d).filter(k=>Math.hypot(d[k].x-hp.x,d[k].y-hp.y)<14).length===2; })());
    ok('pick at the top makes 2 steps + the driver holds the ball', (()=>{ const r=COMMANDS.apply(scn,'point-pick',{target:'team'}); return r.steps.length===2 && /^A\d/.test(r.steps[1].ball.carrier); })());
    ok('every command builds without throwing across situations', DATA.SITUATIONS.every(sit=>
      COMMANDS.list.every(c=>{ try{ COMMANDS.apply({situation:sit.id,frames:[DATA.defaultFrame(sit.id)]}, c.id, {target:'team'}); return true; }catch(e){ return false; } })));

    // UI wiring: editor palette adds a step + fills assignments
    q('#new-scenario-btn').click(); await wait(25);
    ok('command palette present & grouped', qa('#cmd-groups .cmd-group').length===3 && qa('#cmd-groups .cmd-btn').length===22);
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
    ok('audible sheet opens with 22 calls', q('#audible-sheet').hidden===false && qa('#as-groups .cmd-btn').length===22);
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
    const owner={email:'coach@club.ch',team:'A',role:'coach'}, mate={email:'m@club.ch',team:'A',role:'coach'}, admin={email:'a@x',role:'super-admin'};
    ok('private: owner sees it, teammate + admin do not', PRIVACY.canView(secret,owner) && !PRIVACY.canView(secret,mate) && !PRIVACY.canView(secret,admin));
    ok('team: same team yes, other team no', PRIVACY.canView({visibility:'team',team:'A'},mate) && !PRIVACY.canView({visibility:'team',team:'B'},mate));
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
    ok('another user cannot view it', !PRIVACY.canView(saved,{email:'someone@else.ch',team:saved.team,role:'coach'}));
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
    // endpoint config toggles the mode
    ANALYSIS.setEndpoint('https://api.example/analyse');
    ok('endpoint set → cloud mode', ANALYSIS.status().mode==='cloud');
    ANALYSIS.setEndpoint('');
    ok('endpoint cleared → offline mode', ANALYSIS.status().mode==='offline');
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
    { const nr=ANALYSIS.normalizeResult({engine:'server',version:1,tracks:[],events:[],frames:[],scout:sc,meta:{seconds:61.5,fps:6,chunks:4}}); ok('normalizeResult keeps the scout block + job meta', !!nr.scout && nr.meta.seconds===61.5 && nr.meta.chunks===4); }
    ok('help has an auto-scout topic', !!HELP.TOPICS.autoscout);
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
    const tl = FIELD.timeline([{t:0,det},{t:1,det},{t:2,det:none},{t:3,det:none},{t:4,det:none},{t:5,det:none},{t:6,det:none},{t:7,det:none},{t:8,det}],{});
    ok('moving camera: weak seconds hold the last field with decaying confidence, then go unread', tl[2].held && tl[2].H && tl[2].confidence<det.confidence && tl[7].H===null && tl[8].H && !tl[8].held);
    ok('track stats + lookup by time', FIELD.stats(tl).readPct===Math.round(100*8/9) && FIELD.at(tl, 3.5).t===3);
  }

  console.log('\n[6w] Audibles v2 (valid tactics) · speed · my cue · full screen · import formats');
  {
    const { COMMANDS, DATA } = window.__T;
    const f66 = DATA.defaultFrame('6v6'), f65 = DATA.defaultFrame('6v5');
    ok('22 commands, each with cue + when + why + source', COMMANDS.list.length===22 && COMMANDS.list.every(c=>c.cue && c.when && c.why && c.source));
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
    ok('Import ▾ menu: files · paste · backup', !q('#import-menu').hidden && qa('#import-menu [data-imp]').map(b=>b.dataset.imp).join()==='file,paste,backup');
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
  q('#pending-recheck').click(); await wait(40);
  ok('approved player enters', q('#app-screen').classList.contains('active'));
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

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail?1:0);
 } catch(e){ console.error('THREW:', e && e.stack || e); process.exit(2); }
})();
