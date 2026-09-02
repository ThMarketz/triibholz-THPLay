/* ============================================================
   privacy.js — confidentiality + anonymous learning.

   Two guarantees, kept separate on purpose:
   1) WHO CAN SEE a play/tactic — a visibility level on every item:
        public  → anyone in the club
        team    → the same team only
        private → the owner only (🔒 confidential tactics)
      canView() is the single rule every list/render goes through.
   2) WHAT THE SYSTEM LEARNS — never the play itself. anonymize()
      reduces a play to a small set of NON-IDENTIFYING pattern
      features (situation, step count, passes, shot zone, a coarse
      formation shape…). It strips titles, descriptions, notes,
      owners, clubs and ids. Those features feed an aggregator that
      only reports buckets seen at least K times (k-anonymity), so no
      single confidential play can be reverse-engineered.

   Pure, deterministic, unit-tested. Storage/UI in app.js; the
   backend mirrors the aggregator (counts only, never the play).
   ============================================================ */
const PRIVACY = (() => {
  const LEVELS = ['public', 'team', 'private'];
  const LABEL = { public: '🌐 Club', team: '👥 Team', private: '🔒 Private' };
  const STORE = 'thplay.insights.v1';
  const K_MIN = 5;

  /* ---------- visibility ---------- */
  function levelOf(item) { return LEVELS.indexOf(item && item.visibility) >= 0 ? item.visibility : 'team'; }
  function canView(item, user) {
    if (!item) return false;
    const lvl = levelOf(item);
    if (lvl === 'public') return true;
    if (!user) return false;
    if (user.role === 'super-admin' && lvl === 'team') return true;
    if (lvl === 'team') return !item.team || !user.team || item.team === user.team;
    return !!item.owner && item.owner === user.email;          // private
  }

  /* ---------- anonymisation ---------- */
  const B = { x0: 26, y0: 32, x1: 294, y1: 188 };
  const cellOf = p => {
    const cx = Math.min(2, Math.max(0, Math.floor((p.x - B.x0) / ((B.x1 - B.x0) / 3))));
    const cy = Math.min(1, Math.max(0, Math.floor((p.y - B.y0) / ((B.y1 - B.y0) / 2))));
    return cy * 3 + cx;                                           // 0..5 coarse grid
  };
  const carrier = f => (f && f.ball && f.ball.carrier) || null;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  /* anonymize(play) → features only; NO title/description/notes/owner/ids */
  function anonymize(play) {
    const frames = (play && play.frames) || [];
    const first = frames[0] || { att: {}, def: {} }, last = frames[frames.length - 1] || first;
    let passes = 0, drives = 0, screens = 0;
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1], b = frames[i];
      if (carrier(a) && carrier(b) && carrier(a) !== carrier(b)) passes++;
      Object.keys(b.att || {}).forEach(k => { if (a.att && a.att[k] && dist(a.att[k], b.att[k]) > 20) drives++; });
    }
    frames.forEach(f => { const ks = Object.keys(f.att || {}); for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) if (dist(f.att[ks[i]], f.att[ks[j]]) < 12) screens++; });
    const endsInShot = !carrier(last) && last.ball && last.ball.x != null && last.ball.x >= 288;
    const shotZone = endsInShot ? (last.ball.y < 101 ? 'T' : last.ball.y > 119 ? 'B' : 'M') : null;
    const shape = {}; Object.values(first.att || {}).forEach(p => { const c = cellOf(p); shape[c] = (shape[c] || 0) + 1; });
    return {
      situation: play.situation || '6v6', phase: play.phase || 'offense',
      steps: frames.length, passes, drives, screens: screens > 0,
      endsInShot: !!endsInShot, shotZone,
      shape: Object.keys(shape).sort().map(c => c + ':' + shape[c]).join(','),
      attackers: Object.keys(first.att || {}).length, defenders: Object.keys(first.def || {}).length,
    };
  }
  // guard: assert nothing identifying survives
  const FORBIDDEN = ['title', 'description', 'notes', 'owner', 'author', 'id', 'club', 'team', 'email', 'name'];
  function isAnonymous(f) { return f && typeof f === 'object' && !FORBIDDEN.some(k => k in f); }

  /* ---------- k-anonymous aggregation ---------- */
  function emptyAgg() { return { n: 0, buckets: {} }; }
  const keyOf = f => `${f.situation}|${f.phase}`;
  function contribute(agg, f) {
    if (!isAnonymous(f)) throw new Error('refusing non-anonymous contribution');
    agg = agg || emptyAgg(); agg.n++;
    const k = keyOf(f);
    const b = agg.buckets[k] || (agg.buckets[k] = { count: 0, shots: 0, zones: { T: 0, M: 0, B: 0 }, passes: 0, steps: 0, screens: 0, shapes: {} });
    b.count++; if (f.endsInShot) { b.shots++; if (f.shotZone) b.zones[f.shotZone]++; }
    b.passes += f.passes || 0; b.steps += f.steps || 0; if (f.screens) b.screens++;
    if (f.shape) b.shapes[f.shape] = (b.shapes[f.shape] || 0) + 1;
    return agg;
  }
  /* report(agg, k) → only buckets with count ≥ k; nothing about single plays */
  function report(agg, k) {
    k = k || K_MIN; const out = [];
    Object.keys((agg && agg.buckets) || {}).forEach(key => {
      const b = agg.buckets[key]; if (b.count < k) return;
      const [situation, phase] = key.split('|');
      const topShape = Object.entries(b.shapes).sort((a, c) => c[1] - a[1])[0];
      out.push({
        situation, phase, plays: b.count,
        shotRate: +(b.shots / b.count).toFixed(2),
        zone: Object.entries(b.zones).sort((a, c) => c[1] - a[1])[0][0],
        avgPasses: +(b.passes / b.count).toFixed(1), avgSteps: +(b.steps / b.count).toFixed(1),
        screenRate: +(b.screens / b.count).toFixed(2),
        commonShape: topShape && topShape[1] >= k ? topShape[0] : null,   // shapes need k too
      });
    });
    return out.sort((a, c) => c.plays - a.plays);
  }
  function insightsText(rep) {
    const Z = { T: 'top corner', M: 'centre', B: 'bottom corner' };
    return (rep || []).map(r => {
      const bits = [`${r.situation} ${r.phase}: ${r.plays} plays`];
      if (r.shotRate > 0) bits.push(`${Math.round(r.shotRate * 100)}% finish with a shot${r.zone ? ' (mostly ' + Z[r.zone] + ')' : ''}`);
      bits.push(`avg ${r.avgPasses} passes over ${r.avgSteps} steps`);
      if (r.screenRate >= 0.3) bits.push(`${Math.round(r.screenRate * 100)}% use a screen`);
      return bits.join(' · ');
    });
  }

  /* ---------- local store ---------- */
  function load() { try { return JSON.parse(localStorage.getItem(STORE) || 'null') || emptyAgg(); } catch (e) { return emptyAgg(); } }
  function save(agg) { try { localStorage.setItem(STORE, JSON.stringify(agg)); } catch (e) {} }
  function learnFrom(play) { const f = anonymize(play); const agg = contribute(load(), f); save(agg); return f; }

  return { LEVELS, LABEL, K_MIN, levelOf, canView, anonymize, isAnonymous, emptyAgg, contribute, report, insightsText, load, save, learnFrom };
})();

// Node/CommonJS interop (no-op in the browser)
if (typeof module !== "undefined" && module.exports) module.exports = PRIVACY;
