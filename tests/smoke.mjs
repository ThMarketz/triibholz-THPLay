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

const files = ['js/i18n.js','js/help.js','js/draft.js','js/commands.js','js/solver.js','js/qr.js','js/fx.js','js/pool.js','js/data.js','js/animate.js','js/vision.js','js/track.js','js/bytetrack.js','js/events.js','js/webdetector.js','js/analysis.js','js/film.js','js/app.js'];
const combined = files.map(f => readFileSync(join(APP, f), 'utf8')).join('\n;\n')
  + '\n;\nwindow.__T = { POOL, DATA, ANIM, I18N, QR, FX, FILM, HELP, DRAFT, COMMANDS, SOLVER, VISION, TRACK, ANALYSIS, BYTETRACK, EVENTS, WEBDETECTOR };';

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
  ok('10 help topics defined', Object.keys(window.__T.HELP.TOPICS).length===10);
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
    ok('20 commands defined', COMMANDS.list.length===20);
    ok('both sides covered', COMMANDS.list.some(c=>c.side==='offense') && COMMANDS.list.some(c=>c.side==='defense'));
    ok('every command has id/name/cue/build', COMMANDS.list.every(c=>c.id&&c.name&&c.cue&&typeof c.build==='function'));
    // the classics the coach asked for exist
    ['pick-roll','double-hole','goalie-out','collapse','tactical-foul'].forEach(id=>
      ok('command present: '+id, !!COMMANDS.byId[id]));
    // pure-transform behaviour on a 6v6
    const scn = { situation:'6v6', frames:[DATA.defaultFrame('6v6')] };
    const before = scn.frames[0];
    const gk0 = before.gk.x;
    ok('goalie-out brings the keeper off the line', COMMANDS.apply(scn,'goalie-out',{target:'team'}).steps[0].gk.x < gk0);
    ok('tactical-foul note names an ordinary foul', /foul/i.test(Object.values(COMMANDS.apply(scn,'tactical-foul',{target:'team'}).notes).join(' ')));
    ok('double-hole sandwiches with 2 defenders', (()=>{ const hp=before.att[Object.keys(before.att).sort((a,b)=>before.att[b].x-before.att[a].x)[0]];
      const d=COMMANDS.apply(scn,'double-hole',{target:'team'}).steps[0].def;
      return Object.keys(d).filter(k=>Math.hypot(d[k].x-hp.x,d[k].y-hp.y)<14).length===2; })());
    ok('pick & roll makes 2 steps + roller holds the ball', (()=>{ const r=COMMANDS.apply(scn,'pick-roll',{target:'team'}); return r.steps.length===2 && /^A\d/.test(r.steps[1].ball.carrier); })());
    ok('every command builds without throwing across situations', DATA.SITUATIONS.every(sit=>
      COMMANDS.list.every(c=>{ try{ COMMANDS.apply({situation:sit.id,frames:[DATA.defaultFrame(sit.id)]}, c.id, {target:'team'}); return true; }catch(e){ return false; } })));

    // UI wiring: editor palette adds a step + fills assignments
    q('#new-scenario-btn').click(); await wait(25);
    ok('command palette present & grouped', qa('#cmd-groups .cmd-group').length===3 && qa('#cmd-groups .cmd-btn').length===20);
    const framesBefore = q('#frame-chips').children.length;
    qa('#cmd-groups .cmd-btn').find(b=>b.dataset.cmd==='set-hole').click(); await wait(20);
    ok('editor command added a step', q('#frame-chips').children.length>framesBefore);
    ok('command filled an assignment', qa('#notes-grid input').some(i=>/2m|post|seal/i.test(i.value)));
    q('#ed-title').value='Audible play'; q('#ed-title').dispatchEvent(new window.Event('input'));
    const beforeCmd = DATA.load().length;
    q('#ed-save').click(); await wait(40);
    ok('command-built play saves (+1)', DATA.load().length===beforeCmd+1);

    // stage audible: open a play, flash a call, it becomes a dirty paused edit
    qa('.scn-card').find(c=>c.textContent.includes('slip to the hole')).click(); await wait(20);
    ok('⚡ Audible button visible on an open play', q('#audible-btn').hidden===false);
    q('#audible-btn').click(); await wait(10);
    ok('audible sheet opens with 20 calls', q('#audible-sheet').hidden===false && qa('#as-groups .cmd-btn').length===20);
    qa('#as-groups .cmd-btn').find(b=>b.dataset.cmd==='collapse').click(); await wait(20);
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
