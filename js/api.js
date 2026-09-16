/* ============================================================
   api.js — where the club server lives: always the app's own origin.

   The backend is reached at `/api/…` on the same address the app was
   opened from (nginx proxies it to the analysis container). There is no
   setting for another host, on purpose: match videos of children and,
   soon, sign-in cookies must never be sent to a server someone typed in
   or a stale URL left in localStorage.

   Older builds let the user store a backend URL. Those values are
   ignored everywhere and removed by forgetLegacyOverrides().
   ============================================================ */
const API = (() => {
  const LEGACY_KEYS = ['thplay.calendar.feed'];

  /* 'https://club.example' — '' where there is no web origin (Node, file://) */
  function base() {
    try {
      const o = typeof location !== 'undefined' && location && location.origin;
      return o && o !== 'null' ? o : '';
    } catch (e) { return ''; }
  }
  function url(path) { return base() + (String(path || '').charAt(0) === '/' ? '' : '/') + String(path || ''); }
  function forgetLegacyOverrides() {
    try { LEGACY_KEYS.forEach(k => localStorage.removeItem(k)); } catch (e) {}
  }

  /* every call to the club server, from anywhere in the app: same origin, and — once accounts are
     on — the app's own version, so a server that has moved on can say "update the app" instead of
     failing in some unreadable way. */
  function apiFetch(path, opts) {
    const o = Object.assign({ credentials: 'same-origin' }, opts || {});
    o.headers = Object.assign({}, o.headers || {});
    if (typeof SESSION !== 'undefined' && SESSION.on && SESSION.on()) o.headers['x-thp-client'] = String(SESSION.CLIENT_VERSION);
    return fetch(/^https?:/.test(path) ? path : url(path), o);
  }

  return { base, url, fetch: apiFetch, forgetLegacyOverrides, LEGACY_KEYS };
})();
// Node/CommonJS interop (no-op in the browser)
if (typeof module !== "undefined" && module.exports) module.exports = API;
