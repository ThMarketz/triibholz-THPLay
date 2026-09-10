import { firefox } from 'playwright';
const b = await firefox.launch(); const ctx = await b.newContext({ viewport:{width:1360,height:900} }); const page = await ctx.newPage();
page.on('pageerror', e=>console.log('PAGEERROR', e.message, e.stack));
await page.addInitScript(() => {
  window.__fillRectCalls = 0; window.__strokeCalls = 0; window.__errCaught=[];
  const origFR = CanvasRenderingContext2D.prototype.fillRect;
  CanvasRenderingContext2D.prototype.fillRect = function(...a) { window.__fillRectCalls++; return origFR.apply(this, a); };
  const origStroke = CanvasRenderingContext2D.prototype.stroke;
  CanvasRenderingContext2D.prototype.stroke = function(...a) { window.__strokeCalls++; return origStroke.apply(this, a); };
});
await page.goto('http://localhost:8088/', { waitUntil:'networkidle' });
await page.click('.demo-btn[data-demo="coach"]'); await page.waitForTimeout(700);
if (await page.locator('#tour-skip').count()) await page.click('#tour-skip').catch(()=>{});
await page.click('.nav-btn[data-view="playbook"]'); await page.waitForTimeout(400);
await page.locator('.scn-card:not(.scn-new)').first().click(); await page.waitForTimeout(400);
console.log('before toggle: fillRect calls =', await page.evaluate(()=>window.__fillRectCalls));
await page.click('#scene3d-toggle'); await page.waitForTimeout(300);
console.log('after toggle: fillRect calls =', await page.evaluate(()=>window.__fillRectCalls), 'strokes=', await page.evaluate(()=>window.__strokeCalls));
await b.close();
