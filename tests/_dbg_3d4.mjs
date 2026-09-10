import { firefox } from 'playwright';
const b = await firefox.launch(); const ctx = await b.newContext({ viewport:{width:1360,height:900} }); const page = await ctx.newPage();
await page.goto('http://localhost:8088/', { waitUntil:'networkidle' });
await page.click('.demo-btn[data-demo="coach"]'); await page.waitForTimeout(700);
if (await page.locator('#tour-skip').count()) await page.click('#tour-skip').catch(()=>{});
await page.click('.nav-btn[data-view="playbook"]'); await page.waitForTimeout(400);
await page.locator('.scn-card:not(.scn-new)').first().click(); await page.waitForTimeout(400);
await page.click('#scene3d-toggle'); await page.waitForTimeout(300);
const info = await page.evaluate(() => {
  const cv = document.querySelector('#scene3d');
  const ctx2 = cv.getContext('2d');
  const data = ctx2.getImageData(0,0,cv.width,cv.height).data;
  let nonBg = 0;
  for (let i=0;i<data.length;i+=4) { if (!(data[i]===8 && data[i+1]===21 && data[i+2]===31)) nonBg++; }
  return { totalPx: data.length/4, nonBg, camTarget: window.MANIKIN ? 'exists' : 'missing' };
});
console.log('canvas content:', info);
// now call draw3dNow via a manual camera change to see if redraw pathway works at all
await page.evaluate(() => { document.querySelector('#scene3d-toggle').click(); document.querySelector('#scene3d-toggle').click(); }); // off/on to force a repaint
await page.waitForTimeout(200);
const info2 = await page.evaluate(() => {
  const cv = document.querySelector('#scene3d'); const ctx2 = cv.getContext('2d');
  const data = ctx2.getImageData(0,0,cv.width,cv.height).data; let nonBg=0;
  for (let i=0;i<data.length;i+=4) if (!(data[i]===8 && data[i+1]===21 && data[i+2]===31)) nonBg++;
  return { nonBg };
});
console.log('after off/on toggle:', info2);
await b.close();
