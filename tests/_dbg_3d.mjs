import { firefox } from 'playwright';
const b = await firefox.launch(); const ctx = await b.newContext({ viewport:{width:1360,height:900} }); const page = await ctx.newPage();
const logs=[]; page.on('console', m=>logs.push(m.type()+': '+m.text())); page.on('pageerror', e=>logs.push('PAGEERROR: '+e.message+'\n'+e.stack));
await page.goto('http://localhost:8088/', { waitUntil:'networkidle' });
await page.click('.demo-btn[data-demo="coach"]'); await page.waitForTimeout(700);
if (await page.locator('#tour-skip').count()) await page.click('#tour-skip').catch(()=>{});
await page.click('.nav-btn[data-view="playbook"]'); await page.waitForTimeout(400);
await page.locator('.scn-card:not(.scn-new)').first().click(); await page.waitForTimeout(400);
console.log('pre-click onclick types:', await page.evaluate(() => ({
  zones: typeof document.querySelector('#zones-toggle').onclick,
  gk: typeof document.querySelector('#gk-toggle').onclick,
  scene3d: typeof document.querySelector('#scene3d-toggle').onclick,
})));
await page.click('#scene3d-toggle'); await page.waitForTimeout(300);
console.log('hidden after click:', await page.evaluate(() => document.querySelector('#scene3d').hidden));
console.log('stored:', await page.evaluate(() => localStorage.getItem('thplay.show3d')));
const box = await page.locator('#scene3d').boundingBox();
console.log('box', box);
if (box) {
  const before = await page.evaluate(() => document.querySelector('#scene3d').toDataURL());
  await page.mouse.move(box.x+box.width/2, box.y+box.height/2);
  await page.mouse.down();
  await page.mouse.move(box.x+box.width/2+120, box.y+box.height/2-40, {steps:10});
  await page.mouse.up();
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => document.querySelector('#scene3d').toDataURL());
  console.log('drag changed pixels?', before !== after, 'lens', before.length, after.length);
  console.log('camera yaw/pitch via debug hook not exposed — checking canvas non-blank:', after.length > 2000);
}
console.log('LOGS:\n' + logs.join('\n'));
await b.close();
