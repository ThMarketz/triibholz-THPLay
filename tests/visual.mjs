/* Visual regression — capture the app's key screens, or compare two captures pixel by pixel.

     node tests/visual.mjs capture <appUrl> <outDir>      e.g. http://localhost:8091/ /tmp/vis-base
     node tests/visual.mjs compare <baseDir> <candDir>    exit 1 if any screen differs

   Written for the Black & Silver theme work (docs/THEME_BLACK_SILVER.md): Phase 0 turns every colour into
   a token and must leave today's look exactly as it was, and this is the proof. Everything that could make
   two captures of the SAME build differ is pinned: a fixed clock, a seeded Math.random, no animations or
   transitions or carets, no network outside the app, a fresh browser profile, one viewport per screen.
   Run a build against itself first — if that is not 0 px, the harness is lying, not the change.
   Capture both builds at the SAME address: the invite QR code encodes the page's origin, so :8090 vs :8091
   differs by a few thousand pixels that have nothing to do with the change.
   Pixels are compared inside Firefox (canvas), so there is nothing to install. */
import { firefox } from 'playwright';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const [mode, a, b] = process.argv.slice(2);
if (!['capture', 'compare'].includes(mode) || !a || !b) { console.error('usage: visual.mjs capture <appUrl> <outDir> | compare <baseDir> <candDir>'); process.exit(2); }

// same reason as tests/browser.mjs: the user's everyday Firefox home breaks Playwright's Firefox
const ffHome = mkdtempSync(join(tmpdir(), 'thplay-ffhome-'));
const browser = await firefox.launch({ env: { ...process.env, HOME: ffHome, CFFIXED_USER_HOME: ffHome } });

const FROZEN = new Date('2026-09-15T10:00:00Z');
const PIN = () => {
  let s = 20260915; Math.random = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  const kill = () => { const st = document.createElement('style'); st.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'; (document.head || document.documentElement).appendChild(st); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', kill); else kill();
};

async function session(appUrl, viewport, persona, lang) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: 'dark', locale: 'en-US', timezoneId: 'Europe/Zurich' });
  const origin = new URL(appUrl).origin;
  await ctx.route('**/*', r => r.request().url().startsWith(origin) || r.request().url().startsWith('data:') ? r.continue() : r.abort());
  const page = await ctx.newPage();
  await page.clock.setFixedTime(FROZEN);
  await page.addInitScript(PIN);
  if (lang) await page.addInitScript(l => { try { localStorage.setItem('thplay.lang', l); } catch (e) {} }, lang);
  await page.goto(appUrl, { waitUntil: 'networkidle' });
  if (persona) {
    await page.click(`.demo-btn[data-demo="${persona}"]`); await page.waitForTimeout(500);
    if (await page.locator('#tour-skip').count()) await page.click('#tour-skip').catch(() => {});
  }
  return { ctx, page };
}
const view = async (page, v) => { await page.click(`.nav-btn[data-view="${v}"]`); await page.waitForTimeout(700); };
const settle = page => page.waitForTimeout(400);

/* The screens. Each is deterministic on its own; order does not matter. */
const DESK = { width: 1360, height: 900 }, PHONE = { width: 375, height: 812 };
const SCREENS = [
  ['01-auth', DESK, null, async () => {}],
  ['02-coach-dashboard', DESK, 'coach', async () => {}],
  ['03-playbook', DESK, 'coach', async p => view(p, 'playbook')],
  ['04-basics', DESK, 'coach', async p => view(p, 'basics')],
  ['05-film-room', DESK, 'coach', async p => { await view(p, 'film'); await p.click('.film-item:has-text("Sample match")').catch(() => {}); }],
  ['06-solutions', DESK, 'coach', async p => view(p, 'solutions')],
  ['07-season', DESK, 'coach', async p => view(p, 'season')],
  ['08-trivia', DESK, 'coach', async p => view(p, 'trivia')],
  ['09-development', DESK, 'coach', async p => view(p, 'development')],
  ['10-teams', DESK, 'coach', async p => { if (await p.locator('.nav-btn[data-view="teams"]:visible').count()) await view(p, 'teams'); }],
  ['11-help', DESK, 'coach', async p => { await p.click('#help-btn').catch(() => {}); }],
  ['12-admin', DESK, 'super-admin', async p => { if (await p.locator('.nav-btn[data-view="admin"]:visible').count()) await view(p, 'admin'); }],
  ['13-player-dashboard', DESK, 'player', async () => {}],
  ['14-phone-dashboard', PHONE, 'coach', async () => {}],
  ['15-phone-playbook', PHONE, 'coach', async p => view(p, 'playbook')],
  ['16-german-dashboard', DESK, 'coach', async () => {}, 'de'],
  ['17-playbook-zones-keeper', DESK, 'coach', async p => { await view(p, 'playbook'); await p.click('#zones-toggle'); await p.click('#gk-toggle'); await p.waitForTimeout(350); }],
  ['18-playbook-3d', DESK, 'coach', async p => { await view(p, 'playbook'); await p.click('#scene3d-toggle'); await p.waitForTimeout(500); }],
];

if (mode === 'capture') {
  mkdirSync(b, { recursive: true });
  /* In a real browser, code that draws gets colours through getComputedStyle. Every token must come back
     exactly as written (not normalised to rgb()), or attribute values silently change. Builds without
     js/theme.js (before the theme work) skip this. */
  {
    const { ctx, page } = await session(a, DESK, null);
    const bad = await page.evaluate(() => typeof THEME === 'undefined' ? null : Object.entries(THEME.FALLBACK.today).filter(([k, v]) => THEME.c(k) !== v).map(([k, v]) => k + ': ' + THEME.c(k) + ' ≠ ' + v));
    await ctx.close();
    if (bad && bad.length) { console.log('  ✗ computed token values differ from the CSS text:\n    ' + bad.join('\n    ')); await browser.close(); process.exit(1); }
    console.log(bad ? '  ✓ every drawn-by-code token computes to exactly its CSS text' : '  – no js/theme.js in this build (token check skipped)');
  }
  for (const [name, vp, persona, go, lang] of SCREENS) {
    const { ctx, page } = await session(a, vp, persona, lang);
    await go(page); await settle(page);
    await page.screenshot({ path: join(b, name + '.png') });
    await ctx.close();
    console.log('  captured', name);
  }
  console.log(`\n==== ${SCREENS.length} screens captured → ${b} ====`);
}

if (mode === 'compare') {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  const names = readdirSync(a).filter(f => f.endsWith('.png')).sort();
  let bad = 0;
  for (const f of names) {
    if (!existsSync(join(b, f))) { console.log(`  ✗ ${f}: missing in candidate`); bad++; continue; }
    const r = await page.evaluate(async ([x, y]) => {
      const img = async src => { const i = new Image(); i.src = src; await i.decode(); return i; };
      const [A, B] = await Promise.all([img(x), img(y)]);
      if (A.width !== B.width || A.height !== B.height) return { size: `${A.width}×${A.height} vs ${B.width}×${B.height}`, diff: -1 };
      const c = document.createElement('canvas'); c.width = A.width; c.height = A.height; const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(A, 0, 0); const da = g.getImageData(0, 0, c.width, c.height).data;
      g.clearRect(0, 0, c.width, c.height); g.drawImage(B, 0, 0); const db = g.getImageData(0, 0, c.width, c.height).data;
      const out = g.createImageData(c.width, c.height); let diff = 0, max = 0;
      for (let i = 0; i < da.length; i += 4) {
        const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
        if (d) { diff++; if (d > max) max = d; out.data[i] = 255; out.data[i + 1] = 0; out.data[i + 2] = 60; out.data[i + 3] = 255; }
        else { const v = (da[i] + da[i + 1] + da[i + 2]) / 12; out.data[i] = out.data[i + 1] = out.data[i + 2] = v; out.data[i + 3] = 255; }
      }
      let png = null; if (diff) { g.putImageData(out, 0, 0); png = c.toDataURL('image/png'); }
      return { size: `${c.width}×${c.height}`, diff, pct: +(100 * diff / (c.width * c.height)).toFixed(3), max, png };
    }, ['data:image/png;base64,' + readFileSync(join(a, f)).toString('base64'), 'data:image/png;base64,' + readFileSync(join(b, f)).toString('base64')]);
    if (r.diff === 0) console.log(`  ✓ ${f}: identical (${r.size})`);
    else {
      bad++;
      if (r.png) writeFileSync(join(b, f.replace('.png', '.DIFF.png')), Buffer.from(r.png.split(',')[1], 'base64'));
      console.log(`  ✗ ${f}: ${r.diff < 0 ? 'size differs ' + r.size : `${r.diff} px differ (${r.pct} %), largest channel step ${r.max} — see ${f.replace('.png', '.DIFF.png')}`}`);
    }
  }
  console.log(`\n==== ${names.length - bad} identical, ${bad} differ ====`);
  await browser.close(); process.exit(bad ? 1 : 0);
}
await browser.close();
