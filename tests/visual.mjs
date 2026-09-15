/* Visual regression — capture the app's key screens, or compare two captures pixel by pixel.

     node tests/visual.mjs capture <appUrl> <outDir>      e.g. http://localhost:8091/ /tmp/vis-base
     node tests/visual.mjs compare <baseDir> <candDir>    exit 1 if any screen differs
     node tests/visual.mjs audit <appUrl> <look> [maxFail]  WCAG AA text contrast on every screen, in a look
     LOOK=silver node tests/visual.mjs capture …          capture in a look other than the default

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
if (!['capture', 'compare', 'audit'].includes(mode) || !a || !b) { console.error('usage: visual.mjs capture <appUrl> <outDir> | compare <baseDir> <candDir> | audit <appUrl> <look> [maxFail]'); process.exit(2); }
const LOOK = mode === 'audit' ? b : (process.env.LOOK || '');

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
  if (LOOK) await page.addInitScript(l => { try { if (!localStorage.getItem('thplay.look.v1')) localStorage.setItem('thplay.look.v1', l); } catch (e) {} }, LOOK); /* the STARTING look: a choice made during the run must survive a reload */
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
    const bad = await page.evaluate(() => {
      if (typeof THEME === 'undefined') return null;
      // expected = the token text as written in the stylesheet: the bare :root, overridden by the active look's block
      const look = THEME.look(), exp = {};
      for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules; } catch (e) { continue; }
        for (const r of rules) if (r.selectorText === ':root' || r.selectorText === ':root[data-look="' + look + '"]')
          for (let i = 0; i < r.style.length; i++) { const n = r.style[i]; if (r.selectorText === ':root' ? !(n in exp) : true) exp[n] = r.style.getPropertyValue(n).trim(); } }
      return Object.keys(THEME.FALLBACK.today).filter(k => THEME.c(k) !== exp[k]).map(k => look + ' ' + k + ': ' + THEME.c(k) + ' ≠ ' + exp[k]);
    });
    await ctx.close();
    if (bad && bad.length) { console.log('  ✗ computed token values differ from the CSS text:\n    ' + bad.join('\n    ')); await browser.close(); process.exit(1); }
    console.log(bad ? '  ✓ every drawn-by-code token computes to exactly its CSS text in this look' : '  – no js/theme.js in this build (token check skipped)');
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

/* WCAG AA on what is really on screen: every visible text element against the background actually behind it
   (semi-transparent layers composited, a gradient judged by its WORST stop, the page ground for the body).
   4.5:1, or 3:1 for large text (≥ 24 px, or ≥ 18.66 px bold). Board SVG text and disabled controls are exempt. */
const AUDIT = () => {
  const parse = s => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null; const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const stops = s => [...(s || '').matchAll(/rgba?\([^)]+\)/g)].map(m => parse(m[0]));
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const over = (t, u) => ({ r: t.r * t.a + u.r * (1 - t.a), g: t.g * t.a + u.g * (1 - t.a), b: t.b * t.a + u.b * (1 - t.a), a: 1 });
  const ratio = (x, y) => { const [l1, l2] = [lum(x), lum(y)].sort((p, q) => q - p); return (l1 + 0.05) / (l2 + 0.05); };
  const ground = parse('rgb(' + (getComputedStyle(document.documentElement).getPropertyValue('--bg-rgb') || '7,15,23') + ')');
  // candidate backgrounds behind an element: composite layers bottom-up; a gradient layer yields one candidate per stop
  function backs(el) {
    const layers = [];
    for (let e = el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      const img = cs.backgroundImage !== 'none' ? stops(cs.backgroundImage).filter(Boolean) : [];
      const col = parse(cs.backgroundColor);
      if (img.length) { layers.push({ grad: img }); if (img.every(c => c.a >= 1)) break; }
      if (col && col.a > 0) { layers.push({ col }); if (col.a >= 1) break; }
    }
    let cands = [ground];
    for (let i = layers.length - 1; i >= 0; i--) {
      const L = layers[i];
      cands = L.col ? cands.map(b => over(L.col, b)) : L.grad.flatMap(g => cands.map(b => over(g, b)));
    }
    return cands;
  }
  const out = []; let checked = 0;
  const vw = innerWidth, vh = innerHeight;
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('svg, canvas, option, script, style, [hidden]')) continue;
    const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('');
    // colour emoji ignore CSS colour, so only judge text that has letters, digits or punctuation of its own
    if (!own.replace(/[\p{Extended_Pictographic}\u200d\ufe0f\s]/gu, '')) continue;
    if (el.matches(':disabled, [aria-disabled="true"]') || el.closest(':disabled')) continue;
    const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
    const cs = getComputedStyle(el); if (cs.visibility !== 'visible') continue;
    let op = 1; for (let e = el; e; e = e.parentElement) op *= +getComputedStyle(e).opacity; if (op < 0.05) continue;
    const fg0 = parse(cs.color); if (!fg0) continue;
    const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700, need = (size >= 24 || (size >= 18.66 && bold)) ? 3 : 4.5;
    const worst = Math.min(...backs(el).map(bg => ratio(over({ ...fg0, a: fg0.a * op }, bg), bg)));
    checked++;
    if (worst < need) out.push({ text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 36), ratio: +worst.toFixed(2), need, sel: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''), color: cs.color });
  }
  return { checked, fails: out };
};

if (mode === 'audit') {
  const maxFail = process.argv[5] === undefined ? Infinity : +process.argv[5];
  let total = 0; const bySel = {};
  for (const [name, vp, persona, go, lang] of SCREENS) {
    const { ctx, page } = await session(a, vp, persona, lang);
    await go(page); await settle(page);
    const look = await page.evaluate(() => document.documentElement.getAttribute('data-look'));
    const r = await page.evaluate(AUDIT);
    total += r.fails.length;
    r.fails.forEach(x => { const k = x.sel + ' ' + x.color; (bySel[k] = bySel[k] || { n: 0, ratio: x.ratio, need: x.need, text: x.text }).n++; });
    console.log(`  ${r.fails.length ? '✗' : '✓'} ${name} [${look || 'no look'}]: ${r.checked} texts, ${r.fails.length} below AA`);
    await ctx.close();
  }
  console.log('\n  worst offenders (selector · colour · lowest ratio · count):');
  Object.entries(bySel).sort((x, y) => y[1].n - x[1].n).slice(0, 25).forEach(([k, v]) => console.log(`    ${v.n}× ${k} → ${v.ratio}:1 (needs ${v.need}) e.g. "${v.text}"`));
  console.log(`\n==== ${total} text elements below AA across ${SCREENS.length} screens (allowed: ${maxFail === Infinity ? 'report only' : maxFail}) ====`);
  await browser.close(); process.exit(total > maxFail ? 1 : 0);
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
