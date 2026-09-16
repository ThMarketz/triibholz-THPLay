/* ============================================================
   theme.js — the app's look, and colour values for code that DRAWS.

   Loaded first, in <head>: it sets data-look on <html> before the first paint (no flash of the wrong
   look) and keeps the phone's status-bar colour in step with the look.

   css/styles.css is the single source of truth for colours. Code that draws — SVG attributes, canvas,
   exported images and reels — must not write var(): an inline style would beat the CSS rules that
   highlight a focused player, and a downloaded SVG has no stylesheet to resolve it. So it asks
   THEME.c('--pool-deck') for the current VALUE instead.

   FALLBACK is a copy of the "drawn by code" tokens for places that cannot compute CSS (the jsdom smoke
   suite). tests/smoke.mjs fails if a value here differs from css/styles.css, or if code asks for a name
   that is missing — so the two cannot drift.

   Looks: 'today' (the navy look) and 'silver' (Black & Silver). FALLBACK holds today's values: code that cannot
   compute CSS draws in the navy look.
   ============================================================ */
const THEME = (() => {
  const KEY = 'thplay.look.v1', GLASS_KEY = 'thplay.glass.v1';
  const LOOKS = ['today', 'silver'];   // silver: Black & Silver (docs/THEME_BLACK_SILVER.md Phase 1)
  const FALLBACK = { today: {
    "--status-bar":"#0e7c86", "--logo-water":"#0e7c86", "--logo-edge":"#0a5860", "--logo-wave":"#bff0f4",
    "--logo-ball":"#ff7a18", "--logo-seam":"#fff", "--pool-deck":"#0c2030", "--pool-water-top":"#1aa3b0",
    "--pool-water-bottom":"#0c7f8c", "--pool-water-edge":"#0a5860", "--pool-sheen":"#ffffff",
    "--pool-mark":"#eafcff", "--pool-field-edge":"#2bd07a", "--pool-table":"#ffffff", "--pool-table-ink":"#0b2030",
    "--pool-label":"#8fb0c4", "--pool-goal-line":"#ffffff", "--pool-half":"#ffffff", "--pool-2m":"#ff3b3b",
    "--pool-5m":"#ffd400", "--pool-6m":"#39e08a", "--pool-2m-zone":"rgba(226,59,59,0.10)", "--pool-net":"#cfeff3",
    "--pool-goal-post":"#ffffff", "--pool-judge-mark":"#e23b3b", "--pool-judge-mark-edge":"#fff",
    "--pool-exclusion":"#ff3b3b", "--pool-sub-zone":"rgba(15,58,47,0.65)", "--pool-sub-edge":"#3fd08a",
    "--pool-sub-label":"#8fe0bc", "--pool-disc-shadow":"#00131a", "--pool-arrow":"#eafdff",
    "--pool-arrow-ball":"#ffb057", "--pool-arrow-context":"#ff8a8a", "--pool-pass":"#ffd166",
    "--pool-trail-def":"#9fb2c0", "--pool-trail-gk":"#ff8a8a", "--pool-pass-badge":"#ff7a18",
    "--pool-pass-badge-edge":"#fff", "--pool-pass-badge-ink":"#fff", "--cap-white":"#ffffff",
    "--cap-white-edge":"#0b1f2c", "--cap-white-ink":"#0b1f2c", "--cap-dark":"#11151c", "--cap-dark-edge":"#000",
    "--cap-dark-ink":"#ffffff", "--cap-gk":"#e23b3b", "--cap-gk-edge":"#7a0f0f", "--cap-gk-ink":"#ffffff",
    "--ball":"#ff7a18", "--ball-edge":"#9c3d00", "--ball-seam":"#fff", "--zone-green":"#2ecc71",
    "--zone-yellow":"#ffd166", "--zone-label":"#cfe9f2", "--scene3d-air":"#050e17",
    "--scene3d-water-top":"rgba(24,110,140,.85)", "--scene3d-water-bottom":"rgba(10,50,68,.92)",
    "--scene3d-ripple":"rgba(255,255,255,.16)", "--scene3d-line":"#e6f6fb", "--scene3d-lane":"rgba(230,250,255,.35)",
    "--scene3d-skin-line":"#5a6469", "--scene3d-skin-light":"#e3e9ec", "--scene3d-skin-dark":"#a7b2b8",
    "--scene3d-arm":"#c3cdd2", "--cap3d-white":"#f5f8fa", "--cap3d-white-edge":"#0b1f2c", "--cap3d-dark":"#11151c",
    "--cap3d-dark-edge":"#000", "--cap3d-gk":"#e23b3b", "--cap3d-gk-edge":"#7a0f0f", "--cap3d-light-ink":"#0b1f2c",
    "--cap3d-dark-ink":"#fff", "--gkv-goal":"#06131c", "--gkv-frame":"#e6f6fb", "--gkv-gap":"#2ecc71",
    "--gkv-blocker":"#0b1b25", "--gkv-blocker-edge":"#8fb8ff", "--gkv-keeper":"#e2413a",
    "--gkv-keeper-edge":"#ffdede", "--gkv-waterline":"#3fd0e0", "--gkv-text":"#9fd7e4", "--film-corner":"#1fc0d4",
    "--film-corner-edge":"#08131b", "--film-heat":"#1fc0d4", "--film-shot-for":"#2bd07a",
    "--film-shot-against":"#ff5b5b", "--film-shot-other":"#cfd8e0", "--film-shot-edge":"#08131b",
    "--export-bg":"#0b1b25", "--export-title":"#e8f6f8", "--export-caption":"#7fd4de", "--reel-bg":"#06121a",
    "--reel-water-top":"#0f5f74", "--reel-water-bottom":"#0a4152", "--reel-line":"rgba(210,240,245,0.5)",
    "--reel-2m":"#e23b3b", "--reel-5m":"#f2c14e", "--reel-6m":"#3fae6b", "--reel-white":"#f4f8fb",
    "--reel-dark":"#1b2531", "--reel-ball":"#ff8a2a", "--reel-ink":"#eaf4fb", "--reel-caption":"rgba(6,16,22,0.82)",
    "--reel-arrow":"rgba(244,248,251,0.5)", "--reel-disc-edge":"rgba(0,0,0,0.35)",
    "--reel-watermark":"rgba(234,244,251,0.55)", "--reel-title-top":"#0b2a3a", "--reel-title-bottom":"#06151f",
    "--reel-title":"#e8f6f8", "--reel-subtitle":"#7fd4de", "--reel-brand":"rgba(232,246,248,.55)",
    "--fx-confetti-1":"#ff7a18", "--fx-confetti-2":"#16b3c4", "--fx-confetti-3":"#2bd07a",
    "--fx-confetti-4":"#ffd400", "--fx-confetti-5":"#ffffff", "--fx-confetti-6":"#e23b3b", "--mascot-body":"#ff7a18",
    "--mascot-edge":"#9c3d00", "--mascot-seam":"#fff", "--mascot-eye":"#fff", "--mascot-ink":"#0b1f2c",
    "--chart-ink":"#eaf4fb", "--chart-muted":"#9fb6c9", "--chart-grid":"#1e3650", "--chart-line":"#1fc0d4",
    "--chart-target":"#ffd166", "--chart-good":"#2bd07a", "--chart-short":"#ff6b6b", "--chart-bar":"#16b3c4",
    "--chart-bar-track":"#13263a", "--chart-bg":"#0f1c2b",
  } };
  const doc = typeof document !== 'undefined' ? document : null;
  const root = doc && doc.documentElement;
  const cache = {}, listeners = [];
  const saved = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  const valid = l => LOOKS.includes(l) ? l : 'today';
  function look() { return valid(root && root.getAttribute('data-look')); }
  /* the current value of a colour token, e.g. c('--pool-deck') → '#0c2030' */
  function c(name) {
    const l = look(), k = l + name;
    if (cache[k]) return cache[k];
    let v = '';
    try { if (root && typeof getComputedStyle === 'function') v = getComputedStyle(root).getPropertyValue(name).trim(); } catch (e) {}
    if (v) return (cache[k] = v);
    return (FALLBACK[l] && FALLBACK[l][name]) || FALLBACK.today[name] || '';
  }
  function statusBar() {
    const m = doc && doc.querySelector('meta[name="theme-color"]'), v = c('--status-bar');
    if (m && v) m.setAttribute('content', v);
  }
  function setLook(l) {
    l = valid(l);
    try { localStorage.setItem(KEY, l); } catch (e) {}
    if (root) root.setAttribute('data-look', l);
    statusBar();
    listeners.forEach(fn => { try { fn(l); } catch (e) {} });
  }
  const onChange = fn => { listeners.push(fn); };
  /* Glass (theme Phase 3): frosted controls over the pool, part of Black & Silver. On unless the person turned it
     off — and always solid when the device asks for less transparency (the browser says so via a media query;
     Chromium does today, Safari does not yet, which is why there is also a switch). */
  const rtq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-transparency: reduce)') : null;
  const glassWanted = () => { try { return localStorage.getItem(GLASS_KEY) !== 'off'; } catch (e) { return true; } };
  const reducedTransparency = () => !!(rtq && rtq.matches);
  const glass = () => glassWanted() && !reducedTransparency();
  const applyGlass = () => { if (root) root.setAttribute('data-glass', glass() ? 'on' : 'off'); };
  function setGlass(on) {
    try { localStorage.setItem(GLASS_KEY, on ? 'on' : 'off'); } catch (e) {}
    applyGlass(); listeners.forEach(fn => { try { fn(look()); } catch (e) {} });
  }
  /* The look a device starts in when nobody chose one (theme Phase 4, owner decision): a new device gets Black &
     Silver; a device that already holds Triibholz data keeps the navy look it knows. The choice is written down on
     the first run, so the app's own data created a moment later cannot flip a new device back to navy. */
  function startLook() {
    const s = saved();
    if (LOOKS.includes(s)) return s;
    let known = false;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) || '';
        if (k.startsWith('thplay.') && k !== KEY && k !== GLASS_KEY) { known = true; break; }
      }
    } catch (e) { return 'today'; }   // no storage: nothing can be remembered, stay with the look everyone knows
    const l = known ? 'today' : 'silver';
    try { localStorage.setItem(KEY, l); } catch (e) {}
    return l;
  }
  if (rtq && rtq.addEventListener) rtq.addEventListener('change', applyGlass);
  if (root) root.setAttribute('data-look', startLook());   // before the first paint
  applyGlass();
  if (doc) doc.addEventListener('DOMContentLoaded', statusBar);
  return { KEY, GLASS_KEY, LOOKS, FALLBACK, look, c, setLook, onChange, glass, glassWanted, reducedTransparency, setGlass, startLook };
})();

// Node/CommonJS interop (no-op in the browser)
if (typeof module !== "undefined" && module.exports) module.exports = THEME;
