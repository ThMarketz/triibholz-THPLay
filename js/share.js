/* ============================================================
   share.js — plays as portable files and share links.

   · pack / packMany   → a clean, versioned export object
                          (.thplay.json — one play or a whole set)
   · unpack            → validated plays from a file / object / raw
                          scenario (never trusts the input shape)
   · encode / decode   → the play compressed into a URL-safe string,
                          so a link carries the whole play — no server,
                          no login needed to view it
   · fingerprint       → duplicate detection on import
   Pure; runs in the browser and in Node (tests).
   ============================================================ */
const SHARE = (() => {
  const FORMAT_PLAY = 'thplay-play', FORMAT_BOOK = 'thplay-playbook', VERSION = 1;
  const str = (v, n) => String(v == null ? '' : v).slice(0, n || 400);
  const num = v => { const x = +v; return isFinite(x) ? +x.toFixed(1) : 0; };
  const pt = p => (p && typeof p === 'object' && p.x != null && p.y != null) ? { x: num(p.x), y: num(p.y) } : null;
  const VIS = ['public', 'team', 'private'];

  function cleanFrame(f) {
    if (!f || typeof f !== 'object') return null;
    const o = { att: {}, def: {}, gk: null, ball: null, extra: [] };
    Object.keys(f.att || {}).slice(0, 7).forEach(k => { const p = pt(f.att[k]); if (p) o.att[str(k, 4)] = p; });
    Object.keys(f.def || {}).slice(0, 7).forEach(k => { const p = pt(f.def[k]); if (p) o.def[str(k, 4)] = p; });
    o.gk = pt(f.gk) || { x: 292, y: 110 };
    if (f.ball && f.ball.carrier) o.ball = { carrier: str(f.ball.carrier, 4) };
    else { const b = pt(f.ball); o.ball = b ? { carrier: null, x: b.x, y: b.y } : { carrier: null, x: 250, y: 110 }; }
    if (Array.isArray(f.extra)) o.extra = f.extra.slice(0, 12).map(e => { try { return JSON.parse(JSON.stringify(e)); } catch (x) { return null; } }).filter(Boolean);
    return o;
  }
  function cleanPlay(p) {
    if (!p || typeof p !== 'object') return null;
    const frames = (Array.isArray(p.frames) ? p.frames : []).map(cleanFrame).filter(Boolean).slice(0, 40);
    if (!frames.length) return null;
    const notes = {}; Object.keys(p.notes || {}).slice(0, 8).forEach(k => { const v = str(p.notes[k], 300); if (v) notes[str(k, 4)] = v; });
    const out = { id: str(p.id, 64), title: str(p.title, 120) || 'Untitled play', description: str(p.description, 600), situation: str(p.situation, 8) || '6v6',
      phase: p.phase === 'defense' ? 'defense' : 'offense', frames, notes, visibility: VIS.includes(p.visibility) ? p.visibility : 'team', author: str(p.author, 80) };
    if (p.tactic) out.tactic = str(p.tactic, 40);
    return out;
  }
  function pack(scn) { return { format: FORMAT_PLAY, version: VERSION, exportedAt: new Date().toISOString(), play: cleanPlay(scn) }; }
  function packMany(scns, meta) { return { format: FORMAT_BOOK, version: VERSION, exportedAt: new Date().toISOString(), name: str(meta && meta.name, 80), plays: (scns || []).map(cleanPlay).filter(Boolean) }; }

  /* accepts: a JSON string, an export object, a raw scenario, or an array of them */
  function unpack(input) {
    let obj = input;
    if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch (e) { return { plays: [], skipped: 0, error: 'not-json' }; } }
    if (!obj || typeof obj !== 'object') return { plays: [], skipped: 0, error: 'not-a-play-file' };
    let arr, name = '';
    if (obj.format === FORMAT_PLAY) arr = [obj.play];
    else if (obj.format === FORMAT_BOOK) { arr = Array.isArray(obj.plays) ? obj.plays : []; name = str(obj.name, 80); }
    else if (Array.isArray(obj)) arr = obj;
    else if (Array.isArray(obj.frames)) arr = [obj];
    else return { plays: [], skipped: 0, error: 'not-a-play-file' };
    const plays = arr.map(cleanPlay).filter(Boolean);
    return { plays, skipped: arr.length - plays.length, name, error: plays.length ? null : 'no-plays' };
  }

  /* the positions decide identity — same movement = same play, whatever the title */
  function fingerprint(p) {
    p = cleanPlay(p) || p || {};
    const s = JSON.stringify({ s: p.situation, ph: p.phase, f: (p.frames || []).map(f => [f.att, f.def, f.ball]) });
    let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return 'fp' + Math.abs(h).toString(36);
  }
  const isDuplicate = (p, existing) => { const fp = fingerprint(p); return (existing || []).some(e => fingerprint(e) === fp); };

  /* ---- share links: JSON → deflate (when the browser can) → URL-safe base64 ---- */
  const b64u = bytes => { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); const b = typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64'); return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const unb64u = t => { const b = t.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - t.length % 4) % 4); const bin = typeof atob === 'function' ? atob(b) : Buffer.from(b, 'base64').toString('binary'); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
  async function deflate(bytes) { const cs = new CompressionStream('deflate-raw'); const w = cs.writable.getWriter(); w.write(bytes); w.close(); return new Uint8Array(await new Response(cs.readable).arrayBuffer()); }
  async function inflate(bytes) { const ds = new DecompressionStream('deflate-raw'); const w = ds.writable.getWriter(); w.write(bytes); w.close(); return new Uint8Array(await new Response(ds.readable).arrayBuffer()); }
  // UTF-8 without relying on TextEncoder/TextDecoder (older WebViews, test harnesses)
  const utf8Bytes = str => { if (typeof TextEncoder === 'function') return new TextEncoder().encode(str); const bin = unescape(encodeURIComponent(str)); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
  const utf8Str = bytes => { if (typeof TextDecoder === 'function') return new TextDecoder().decode(bytes); let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]); return decodeURIComponent(escape(bin)); };
  async function encode(obj) {
    const bytes = utf8Bytes(JSON.stringify(obj));
    if (typeof CompressionStream === 'function' && typeof Response === 'function') { try { return 'z.' + b64u(await deflate(bytes)); } catch (e) {} }
    return 'j.' + b64u(bytes);
  }
  async function decode(code) {
    code = String(code || ''); const kind = code.slice(0, 2), body = code.slice(2);
    if ((kind !== 'z.' && kind !== 'j.') || !body) throw new Error('bad-share-link');
    let bytes = unb64u(body);
    if (kind === 'z.') { if (typeof DecompressionStream !== 'function') throw new Error('unsupported-browser'); bytes = await inflate(bytes); }
    try { return JSON.parse(utf8Str(bytes)); } catch (e) { throw new Error('bad-share-link'); }
  }
  const shareUrl = (base, code) => String(base || '').replace(/[#?].*$/, '') + '#play=' + code;
  const fromHash = hash => { const m = /[#&]play=([^&]+)/.exec(hash || ''); return m ? m[1] : null; };
  const filename = (title, ext) => ((String(title || 'triibholz-play').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()) || 'triibholz-play') + '.' + ext;

  return { FORMAT_PLAY, FORMAT_BOOK, VERSION, pack, packMany, unpack, cleanPlay, fingerprint, isDuplicate, encode, decode, shareUrl, fromHash, filename };
})();

// Node/CommonJS interop (no-op in the browser)
if (typeof module !== "undefined" && module.exports) module.exports = SHARE;
