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

console.log('\n[2b] Adjust mode — drag directly on the play');
await page.click('#adjust-btn'); await page.waitForTimeout(400);
ok('adjust surface active', await page.locator('#adjust-bar:not([hidden])').count()===1);
const disc = page.locator('#pool .disc.editable').first();
const tBefore = await disc.getAttribute('transform');
await dragBy(page, disc, 62, 38);
ok('disc dragged on the main pool', (await disc.getAttribute('transform')) !== tBefore);
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
ok('back in playback view', await page.locator('#controls:not([hidden])').count()===1);

console.log('\n[3] Coach — editor create & save');
await page.click('#new-scenario-btn'); await page.waitForTimeout(400);
ok('editor field drawn', (await page.locator('#editor-pool rect').count())>5);
await page.fill('#ed-title','Final QA play');
await page.click('#add-frame'); await page.waitForTimeout(150);
await page.click('#add-sub'); await page.click('#add-exc'); await page.waitForTimeout(150);
await page.screenshot({ path:OUT+'/qa_05_editor.png' });
await page.click('#ed-save'); await page.waitForTimeout(400);
ok('saved play in library', (await page.locator('.scn-title', { hasText:'Final QA play' }).count())>=1);

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
