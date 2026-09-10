import { firefox } from 'playwright';
const b = await firefox.launch(); const ctx = await b.newContext({ viewport:{width:1360,height:900} }); const page = await ctx.newPage();
await page.goto('http://localhost:8088/', { waitUntil:'networkidle' });
await page.click('.demo-btn[data-demo="coach"]'); await page.waitForTimeout(700);
if (await page.locator('#tour-skip').count()) await page.click('#tour-skip').catch(()=>{});
await page.click('.nav-btn[data-view="playbook"]'); await page.waitForTimeout(400);
await page.locator('.scn-card:not(.scn-new)').first().click(); await page.waitForTimeout(400);
await page.click('#scene3d-toggle'); await page.waitForTimeout(300);
const sample = await page.evaluate(() => {
  const cv = document.querySelector('#scene3d'); const c = cv.getContext('2d');
  const d = c.getImageData(0,0,cv.width,cv.height).data;
  const px = (x,y) => { const i=(y*cv.width+x)*4; return [d[i],d[i+1],d[i+2],d[i+3]]; };
  return { w: cv.width, h: cv.height, corner: px(2,2), centre: px(Math.floor(cv.width/2), Math.floor(cv.height/2)) };
});
console.log(sample);
const box = await page.locator('#scene3d').boundingBox();
const before = await page.evaluate(() => document.querySelector('#scene3d').toDataURL());
await page.mouse.move(box.x+5, box.y+5); // move mouse INTO the element first (Firefox sometimes needs a hover before drag registers reliably)
await page.waitForTimeout(50);
await page.mouse.move(box.x+box.width/2, box.y+box.height/2);
await page.mouse.down();
for (let i=1;i<=10;i++){ await page.mouse.move(box.x+box.width/2+i*12, box.y+box.height/2-i*4); await page.waitForTimeout(10); }
await page.mouse.up();
await page.waitForTimeout(200);
const after = await page.evaluate(() => document.querySelector('#scene3d').toDataURL());
console.log('changed?', before !== after);
const sample2 = await page.evaluate(() => {
  const cv = document.querySelector('#scene3d'); const c = cv.getContext('2d');
  const d = c.getImageData(0,0,cv.width,cv.height).data;
  const px = (x,y) => { const i=(y*cv.width+x)*4; return [d[i],d[i+1],d[i+2],d[i+3]]; };
  return { corner: px(2,2), centre: px(Math.floor(cv.width/2), Math.floor(cv.height/2)) };
});
console.log('after-drag sample', sample2);
await b.close();
