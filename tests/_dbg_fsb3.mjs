import { firefox } from 'playwright';
const b = await firefox.launch(); const ctx = await b.newContext({ viewport:{width:1360,height:900} }); const page = await ctx.newPage();
page.on('pageerror', e=>console.log('PAGEERROR', e.message));
await page.goto('http://localhost:8088/', { waitUntil:'networkidle' });
await page.click('.demo-btn[data-demo="coach"]'); await page.waitForTimeout(700);
if (await page.locator('#tour-skip').count()) await page.click('#tour-skip').catch(()=>{});
await page.click('.nav-btn[data-view="playbook"]'); await page.waitForTimeout(400);
await page.locator('.scn-card:not(.scn-new)').first().click(); await page.waitForTimeout(400);

// --- the zones/gk toggles (from the preceding section) ---
await page.click('#zones-toggle'); await page.waitForTimeout(250);
await page.click('#gk-toggle'); await page.waitForTimeout(350);
await page.click('#gk-toggle'); await page.click('#zones-toggle'); await page.waitForTimeout(200);

// --- the 3D section, verbatim ---
await page.click('#scene3d-toggle'); await page.waitForTimeout(250);
const box3d = await page.locator('#scene3d').boundingBox();
await page.mouse.move(box3d.x + box3d.width/2, box3d.y + box3d.height/2);
await page.mouse.down(); await page.mouse.move(box3d.x + box3d.width/2 + 120, box3d.y + box3d.height/2 - 40, { steps: 10 }); await page.mouse.up();
await page.waitForTimeout(150);
await page.mouse.wheel(0, -300); await page.waitForTimeout(150);
await page.selectOption('#scene3d-target', 'ball'); await page.waitForTimeout(200);
await page.dblclick('#scene3d'); await page.waitForTimeout(150);
await page.selectOption('#scene3d-target', '');
await page.click('#scene3d-toggle'); await page.waitForTimeout(150);
console.log('3D off, canvas hidden?', await page.locator('#scene3d[hidden]').count());

// --- now the fullscreen section ---
await page.click('#speed-seg [data-speed="0.5"]'); await page.waitForTimeout(100);
await page.click('#speed-seg [data-speed="1"]');
await page.selectOption('#focus-pos', '3'); await page.waitForTimeout(200);
await page.click('#fs-btn'); await page.waitForTimeout(300);
await page.mouse.move(400,300); await page.waitForTimeout(150);
console.log('fs-bar.show after entering fullscreen + hover?', await page.locator('#fs-bar.show').count());
const gripBox = await page.locator('#fsb-grip').boundingBox();
const wrapBox = await page.locator('#view-playbook .pool-wrap').boundingBox();
await page.mouse.move(gripBox.x + gripBox.width/2, gripBox.y + gripBox.height/2);
await page.mouse.down(); await page.mouse.move(wrapBox.x+90, wrapBox.y+90, {steps:8}); await page.mouse.up();
await page.waitForTimeout(200);
console.log('placed?', await page.locator('#fs-bar.placed').count());
await page.hover('#pool'); await page.waitForTimeout(150);
console.log('label before restart:', await page.locator('#fsb-label').textContent());
await page.click('#fsb-restart'); await page.waitForTimeout(150);
console.log('after restart:', await page.locator('#fsb-label').textContent());
await page.click('#fsb-fwd'); await page.waitForTimeout(200);
console.log('after fwd:', await page.locator('#fsb-label').textContent());
await b.close();
