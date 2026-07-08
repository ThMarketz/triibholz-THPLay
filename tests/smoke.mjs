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

const files = ['js/i18n.js','js/help.js','js/qr.js','js/fx.js','js/pool.js','js/data.js','js/animate.js','js/film.js','js/app.js'];
const combined = files.map(f => readFileSync(join(APP, f), 'utf8')).join('\n;\n')
  + '\n;\nwindow.__T = { POOL, DATA, ANIM, I18N, QR, FX, FILM, HELP };';

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
  ok('8 help topics defined', Object.keys(window.__T.HELP.TOPICS).length===8);
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
