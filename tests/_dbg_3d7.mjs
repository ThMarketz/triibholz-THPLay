import { firefox } from 'playwright';
const b = await firefox.launch(); const ctx = await b.newContext({ viewport:{width:1360,height:900} }); const page = await ctx.newPage();
await page.addInitScript(() => {
  window.__arcs = [];
  const orig = CanvasRenderingContext2D.prototype.arc;
  CanvasRenderingContext2D.prototype.arc = function(x,y,r,...rest) { window.__arcs.push([x,y,r]); return orig.call(this,x,y,r,...rest); };
});
await page.goto('http://localhost:8088/', { waitUntil:'networkidle' });
await page.click('.demo-btn[data-demo="coach"]'); await page.waitForTimeout(700);
if (await page.locator('#tour-skip').count()) await page.click('#tour-skip').catch(()=>{});
await page.click('.nav-btn[data-view="playbook"]'); await page.waitForTimeout(400);
await page.locator('.scn-card:not(.scn-new)').first().click(); await page.waitForTimeout(400);
await page.click('#scene3d-toggle'); await page.waitForTimeout(300);
console.log('arcs drawn:', await page.evaluate(() => window.__arcs));
await b.close();
