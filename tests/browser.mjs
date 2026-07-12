/* Real-browser QA walkthrough — every persona, every view, in Firefox.
   Run:  node tests/browser.mjs   (deps: npm i inside tests/, app on :8088) */
import { firefox } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'shots');
import { mkdirSync } from 'node:fs'; mkdirSync(OUT, { recursive: true });
const URL = 'http://localhost:8088/';
let pass=0, fail=0; const errs=[];
const ok=(n,c)=>{ c?pass++:fail++; console.log((c?'  ✓ ':'  ✗ FAIL: ')+n); };

const browser = await firefox.launch();

function hook(page, tag){
  const thirdParty = t => /youtube\.com|googlevideo|doubleclick|SameSite|__Secure-/.test(t||'');
  page.on('pageerror', e=>{ if(!thirdParty(e.message)) errs.push(`[${tag}] PAGEERROR ${e.message}`); });
  page.on('console', m=>{ if(m.type()==='error' && !thirdParty(m.text())) errs.push(`[${tag}] ${m.text()}`); });
}
const skipTour = async (page)=>{ if (await page.locator('#tour-skip').count()) await page.click('#tour-skip').catch(()=>{}); };
const dragBy = async (page, locator, dx, dy) => {
  const bb = await locator.boundingBox();
  await page.mouse.move(bb.x + bb.width/2, bb.y + bb.height/2);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width/2 + dx, bb.y + bb.height/2 + dy, { steps: 8 });
  await page.mouse.up();
};

/* ---------- desktop context ---------- */
const ctx = await browser.newContext({ viewport:{ width:1360, height:900 } });
const page = await ctx.newPage(); hook(page,'desktop');

console.log('\n[1] Auth screen');
await page.goto(URL, { waitUntil:'networkidle' });
ok('auth visible', await page.locator('#auth-screen.active').count()===1);
ok('3 demo personas', await page.locator('.demo-btn').count()===3);
ok('4 language flags', await page.locator('#lang-switch-auth .lang-btn').count()===4);
await page.screenshot({ path:OUT+'/qa_01_auth.png' });

console.log('\n[2] Coach — dashboard & playbook');
await page.click('.demo-btn[data-demo="coach"]'); await page.waitForTimeout(500); await skipTour(page);
ok('coach dashboard', await page.locator('.invite-card').count()===1);
await page.screenshot({ path:OUT+'/qa_02_coach_dash.png' });
await page.click('.nav-btn[data-view="playbook"]'); await page.waitForTimeout(400);
ok('play auto-opened', (await page.locator('#pool .disc').count())>=6);
await page.click('#play-btn'); await page.waitForTimeout(900);
await page.screenshot({ path:OUT+'/qa_03_playbook_anim.png' });
await page.click('#play-btn');
await page.click('#step-fwd');
ok('step label updates', /Step \d+ \/ \d+/.test(await page.locator('#frame-label').textContent()));
await page.click('#mode-toggle .mode-btn[data-mode="problem"]'); await page.waitForTimeout(200);
ok('problem overlay', await page.locator('#problem-overlay:not([hidden])').count()===1);
await page.screenshot({ path:OUT+'/qa_04_problem.png' });
await page.click('#reveal-btn'); await page.waitForTimeout(400);
ok('solution revealed', await page.locator('#problem-overlay[hidden]').count()===1);

console.log('\n[2b] Pause-to-move — drag directly on the paused play');
await page.click('#play-btn'); await page.waitForTimeout(500);      // pause → draggable
ok('players draggable when paused', (await page.locator('#pool .disc.editable').count())>=13);
ok('drag hint visible', await page.locator('#pool-drag-hint:not([hidden])').count()===1);
ok('save bar hidden before changes', await page.locator('#adjust-bar[hidden]').count()===1);
const disc = page.locator('#pool .disc.editable').first();
const tBefore = await disc.getAttribute('transform');
await dragBy(page, disc, 62, 38);
ok('disc dragged on the main pool', (await disc.getAttribute('transform')) !== tBefore);
ok('save bar appears after the first change', await page.locator('#adjust-bar:not([hidden])').count()===1);
const ballLoc = page.locator('#pool .ball.editable');
const bBefore = await ballLoc.getAttribute('transform');
await dragBy(page, ballLoc, -45, 22);
ok('ball dragged too', (await ballLoc.getAttribute('transform')) !== bBefore);
await page.click('#adj-undo'); await page.waitForTimeout(250);
ok('↩ Undo reverts the last drag', (await page.locator('#pool .ball.editable').getAttribute('transform')) === bBefore);
await page.screenshot({ path:OUT+'/qa_14_adjust.png' });
const cardsBefore = await page.locator('.scn-card').count();
await page.click('#adj-save-new'); await page.waitForTimeout(500);
ok('adjusted play saved as new (+1)', (await page.locator('.scn-card').count())===cardsBefore+1);
ok('new play opens paused & draggable', (await page.locator('#pool .disc.editable').count())>=13);

console.log('\n[3] Coach — editor create & save');
await page.click('#new-scenario-btn'); await page.waitForTimeout(400);
ok('editor field drawn', (await page.locator('#editor-pool rect').count())>5);
await page.fill('#ed-title','Final QA play');
await page.click('#add-frame'); await page.waitForTimeout(150);
await page.click('#add-sub'); await page.click('#add-exc'); await page.waitForTimeout(150);
await page.screenshot({ path:OUT+'/qa_05_editor.png' });
await page.click('#ed-save'); await page.waitForTimeout(400);
ok('saved play in library', (await page.locator('.scn-title', { hasText:'Final QA play' }).count())>=1);

console.log('\n[3c] Draft from words — type the play, board builds live');
await page.click('#new-scenario-btn'); await page.waitForTimeout(300);
ok('draft panel open on a new play', await page.locator('#draft-panel[open]').count()===1);
await page.fill('#ed-title','Written play');
await page.click('#draft-text');
await page.keyboard.type('3 has the ball\n3 drives to the middle and 2 lifts to the wing\n3 passes to 2\n2 shoots far corner', { delay: 4 });
await page.waitForTimeout(700);   // debounce + render
ok('typing produced 4 steps', (await page.locator('#frame-chips .frame-chip').count())===4);
ok('feedback shows understood lines', (await page.locator('#draft-feedback .draft-line.ok').count())===4);
ok('movement arrows drawn from the text', (await page.locator('#editor-pool [marker-end]').count())>=2);
await page.screenshot({ path:OUT+'/qa_18_draft.png' });
const draftCards = await page.locator('.scn-card').count();
await page.click('#ed-save'); await page.waitForTimeout(400);
ok('written play saved (+1)', (await page.locator('.scn-card').count())===draftCards+1);
ok('written play opens paused & draggable for fine-tuning', (await page.locator('#pool .disc.editable').count())>=13);

console.log('\n[3d] Tactical commands — editor palette + stage audible');
await page.click('#new-scenario-btn'); await page.waitForTimeout(300);
await page.fill('#ed-title','Commanded play');
await page.click('#cmd-panel > summary'); await page.waitForTimeout(150);
ok('command palette shows 20 calls in 3 groups', (await page.locator('#cmd-groups .cmd-btn').count())===20 && (await page.locator('#cmd-groups .cmd-group').count())===3);
const stepsBefore = await page.locator('#frame-chips .frame-chip').count();
await page.click('#cmd-groups .cmd-btn[data-cmd="pick-roll"]'); await page.waitForTimeout(200);
ok('Pick & Roll added movement steps', (await page.locator('#frame-chips .frame-chip').count()) > stepsBefore);
ok('command drew arrows on the editor board', (await page.locator('#editor-pool [marker-end]').count())>=1);
await page.screenshot({ path:OUT+'/qa_19_commands.png' });
await page.click('#ed-save'); await page.waitForTimeout(400);
// stage audible on an existing play
await page.click('.scn-card:has-text("slip to the hole")'); await page.waitForTimeout(300);
ok('⚡ Audible button visible on the board', await page.locator('#audible-btn:not([hidden])').count()===1);
await page.click('#audible-btn'); await page.waitForTimeout(150);
ok('audible sheet opens', await page.locator('#audible-sheet:not([hidden])').count()===1);
await page.selectOption('#as-target','team');
await page.click('#as-groups .cmd-btn[data-cmd="double-hole"]'); await page.waitForTimeout(250);
ok('audible marked the play dirty (save bar)', await page.locator('#adjust-bar:not([hidden])').count()===1);
await page.screenshot({ path:OUT+'/qa_20_audible.png' });
const audCards = await page.locator('.scn-card').count();
await page.click('#adj-save-new'); await page.waitForTimeout(400);
ok('audible saved as a new movement (+1)', (await page.locator('.scn-card').count())===audCards+1);

console.log('\n[3e] Solutions Lab — ask a question, get a worked answer');
await page.click('.nav-btn[data-view="solutions"]'); await page.waitForTimeout(300);
ok('solutions view + 16 cards', (await page.locator('.sol-card').count())===16);
await page.fill('#sol-search','I swim alone at the goalie who comes out to 5m, can he foul me?');
await page.click('#sol-go'); await page.waitForTimeout(400);
ok('answer shows tactical steps', (await page.locator('#sol-detail .sol-steps li').count())>=3);
ok('answer shows the rules (fouls/penalty)', (await page.locator('#sol-detail .sol-rule').count())>=2);
ok('best answer is the keeper case', /keeper/i.test(await page.locator('#sol-detail h2').textContent()));
ok('solution board rendered players', (await page.locator('#sol-pool .disc').count())>=1);
await page.screenshot({ path:OUT+'/qa_21_solutions.png' });
const solBefore = await page.evaluate(()=> (JSON.parse(localStorage.getItem('thplay.scenarios.v1')||'{}').scenarios||[]).length);
await page.click('#sol-save'); await page.waitForTimeout(400);
const solAfter = await page.evaluate(()=> (JSON.parse(localStorage.getItem('thplay.scenarios.v1')||'{}').scenarios||[]).length);
ok('solution saved to storage (+1)', solAfter===solBefore+1);
ok('landed in playbook with the play open', await page.locator('#view-playbook.active').count()===1 && /solution/i.test(await page.locator('#scenario-title').textContent()));
// film auto-analyse control shows for an uploaded file (use the real upload flow)
await page.click('.nav-btn[data-view="film"]'); await page.waitForTimeout(400);
await page.setInputFiles('#film-upload', { name:'clip.mp4', mimeType:'video/mp4', buffer: Buffer.from('0000001c66747970', 'hex') });
await page.waitForTimeout(500);
ok('🔎 Auto-analyse control present for uploaded video', await page.locator('#film-scan').count()===1);
// Tier 1 position tracking — calibrate the pool by clicking 4 corners
ok('📍 Position-tracking controls present', await page.locator('#film-calibrate').count()===1 && await page.locator('#film-scanpos').count()===1);
ok('Track button starts disabled (needs calibration)', await page.locator('#film-scanpos').isDisabled());
await page.click('#film-calibrate'); await page.waitForTimeout(200);
ok('calibration canvas appears', await page.locator('#cal-canvas').count()===1);
const cal = await page.locator('#cal-canvas').boundingBox();
const corners = [[0.1,0.15],[0.9,0.15],[0.9,0.9],[0.1,0.9]];
for (const [fx,fy] of corners){ await page.mouse.click(cal.x+cal.width*fx, cal.y+cal.height*fy); await page.waitForTimeout(80); }
ok('calibration completes → Track enabled', /Calibrated/i.test(await page.locator('#cal-hint').innerText()) && !(await page.locator('#film-scanpos').isDisabled()));
await page.screenshot({ path:OUT+'/qa_22_calibrate.png' });
ok('Hardened (Tier 2) toggle present & on by default', await page.locator('#film-hardened').count()===1 && await page.locator('#film-hardened').isChecked());
await page.click('#film-scanpos'); await page.waitForTimeout(800);
ok('Track positions produces a result panel (board or graceful note)', (await page.locator('#film-track-out').innerText()).trim().length>0);
await page.click('.nav-btn[data-view="playbook"]'); await page.waitForTimeout(250);   // [3b] expects the playbook stage

console.log('\n[3b] Help — how to use every function');
await page.click('#help-btn'); await page.waitForTimeout(250);
ok('help opens for current view', await page.locator('.help-backdrop:not([hidden])').count()===1);
await page.screenshot({ path:OUT+'/qa_15_help.png' });
await page.click('#help-x'); await page.waitForTimeout(150);
await page.click('[data-help="playbook"]'); await page.waitForTimeout(200);
ok('contextual ？ chip opens topic', await page.locator('.help-backdrop:not([hidden])').count()===1);
await page.keyboard.press('Escape'); await page.waitForTimeout(150);
ok('Esc closes help', await page.locator('.help-backdrop[hidden]').count()===1);

console.log('\n[4] Basics & Trivia');
await page.click('.nav-btn[data-view="basics"]'); await page.waitForTimeout(500);
ok('rule books panel', await page.locator('.rules-panel').count()===1);
ok('responsibilities cards', await page.locator('.resp-card').count()===3);
await page.screenshot({ path:OUT+'/qa_06_basics.png' });
await page.click('.nav-btn[data-view="trivia"]'); await page.waitForTimeout(300);
await page.click('#trivia-start'); await page.waitForTimeout(200);
await page.locator('.trivia-opt').first().click(); await page.waitForTimeout(150);
ok('trivia explains answer', await page.locator('#trivia-why:not([hidden])').count()===1);
await page.screenshot({ path:OUT+'/qa_07_trivia.png' });

console.log('\n[4b] Film Room — video, board, timeline, charts');
await page.click('.nav-btn[data-view="film"]'); await page.waitForTimeout(1200);
await page.click('.film-item:has-text("Sample match")'); await page.waitForTimeout(600);   // [3e] seeded another session first
ok('film view + seed match', await page.locator('.film-item').count()>=1);
ok('video frame present', await page.locator('#film-player .film-frame').count()===1);
ok('coach sees tag bar', await page.locator('.film-tagbar').count()===1);
ok('timeline events', (await page.locator('.film-ev').count())>=5);
ok('shot chart + insights', await page.locator('.goal-grid').count()>=2 && await page.locator('.film-insights .fi-row').count()>=1);
ok('situation board with draggable players', (await page.locator('#film-board .disc.editable').count())>=11);
const fball = page.locator('#film-board .ball.editable');
const fbBefore = await fball.getAttribute('transform');
await dragBy(page, fball, -38, 18);
ok('board ball draggable', (await fball.getAttribute('transform')) !== fbBefore);
await page.screenshot({ path:OUT+'/qa_13_filmroom.png' });

console.log('\n[5] German locale');
await page.click('#lang-switch-top .lang-btn:nth-child(2)'); await page.waitForTimeout(300);
ok('nav in German', (await page.locator('.nav-btn[data-view="dashboard"]').textContent())==='Übersicht');
await page.click('.nav-btn[data-view="dashboard"]'); await page.waitForTimeout(300);
await page.screenshot({ path:OUT+'/qa_08_german.png' });
await page.click('#lang-switch-top .lang-btn:nth-child(1)'); await page.waitForTimeout(200);

console.log('\n[6] Admin — approvals');
await page.click('#logout-btn'); await page.waitForTimeout(300);
await page.click('.demo-btn[data-demo="super-admin"]'); await page.waitForTimeout(500); await skipTour(page);
await page.click('.nav-btn[data-view="admin"]'); await page.waitForTimeout(300);
const pend = await page.locator('#approve-list [data-approve]').count();
ok('pending queue shown ('+pend+')', pend>=1);
await page.screenshot({ path:OUT+'/qa_09_admin.png' });
if (pend) { await page.locator('#approve-list [data-approve]').first().click(); await page.waitForTimeout(300);
  ok('approve works', (await page.locator('#approve-list [data-approve]').count())===pend-1); }

console.log('\n[7] Player — progress & challenge');
await page.click('#logout-btn'); await page.waitForTimeout(300);
await page.click('.demo-btn[data-demo="player"]'); await page.waitForTimeout(500); await skipTour(page);
ok('progress card', await page.locator('.progress-card').count()===1);
await page.screenshot({ path:OUT+'/qa_10_player_dash.png' });
await page.click('[data-challenge]'); await page.waitForTimeout(300);
for (let i=0;i<30;i++){
  if (await page.locator('#ch-done').count()) break;
  if (await page.locator('#ch-next:not([hidden])').count()) await page.click('#ch-next');
  else if (await page.locator('.ch-opt').count()) await page.locator('.ch-opt').first().click();
  await page.waitForTimeout(120);
}
ok('challenge completes', await page.locator('#ch-done').count()===1);
await page.screenshot({ path:OUT+'/qa_11_challenge.png' });
await page.click('#ch-done');
await page.click('.nav-btn[data-view="playbook"]'); await page.waitForTimeout(400);
ok('player defaults to Problem mode', await page.locator('#problem-overlay:not([hidden])').count()===1);

console.log('\n[8] Mobile viewport (375×812)');
const mctx = await browser.newContext({ viewport:{ width:375, height:812 } });
const mp = await mctx.newPage(); hook(mp,'mobile');
await mp.goto(URL, { waitUntil:'networkidle' });
await mp.click('.demo-btn[data-demo="coach"]'); await mp.waitForTimeout(500);
if (await mp.locator('#tour-skip').count()) await mp.click('#tour-skip').catch(()=>{});
await mp.click('.nav-btn[data-view="playbook"]'); await mp.waitForTimeout(400);
const poolBox = await mp.locator('#pool').boundingBox();
ok('pool visible on mobile ('+Math.round(poolBox?.width||0)+'px wide)', poolBox && poolBox.width>300);
const overflowPx = await mp.evaluate(()=>document.body.scrollWidth - window.innerWidth);
ok('no meaningful horizontal overflow ('+overflowPx+'px)', overflowPx <= 4);
await mp.screenshot({ path:OUT+'/qa_12_mobile.png' });

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
console.log('CONSOLE ERRORS:', errs.length?('\n  '+errs.join('\n  ')):'none');
await browser.close();
process.exit(fail?1:0);
