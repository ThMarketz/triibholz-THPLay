/* ============================================================
   session.js — the app's side of real accounts: passkeys, the session, and the authorized API.

   The server decides everything (server/auth.js, server/clubs.js, server/access.js); this file
   only speaks to it. It answers three questions the app needs at start-up:

     · are accounts switched on at all?   SESSION.probe()   → /api/health
     · who is signed in here?             SESSION.me()      → /api/auth/me
     · and every call after that          SESSION.api(path) → same-origin, with the app's version

   When accounts are off the app keeps its simulated sign-in, so a development build works with no
   server at all. Nothing here stores a person's name, a token or a passkey: the cookie is HttpOnly
   and the passkey never leaves the authenticator.
   ============================================================ */
const SESSION = (() => {
  const CLIENT_VERSION = 4;               // server/access.js MIN_CLIENT — raise both together
  const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const fromB64u = s => { const t = String(s).replace(/-/g, '+').replace(/_/g, '/'); const bin = atob(t + '='.repeat((4 - t.length % 4) % 4)); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };

  let accountsOn = null, current = null;

  const url = path => (typeof API !== 'undefined' ? API.base() : '') + path;
  /* every call: same origin, the app's version, JSON in and out. Throws { status, error } so a
     caller can tell "signed out" from "update the app" from a real failure. */
  async function api(path, { method = 'GET', body, club } = {}) {
    const headers = { 'x-thp-client': String(CLIENT_VERSION) };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (club) headers['x-club'] = club;
    let r;
    try { r = await fetch(url(path), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' }); }
    catch (e) { throw Object.assign(new Error('offline'), { status: 0, error: 'offline' }); }
    let data = null; try { data = await r.json(); } catch (e) {}
    if (!r.ok) throw Object.assign(new Error((data && data.error) || String(r.status)), { status: r.status, error: (data && data.error) || String(r.status), data });
    return data;
  }

  const supported = () => typeof window !== 'undefined' && !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);

  /* are accounts on for this deployment? (asked once) */
  async function probe() {
    if (accountsOn !== null) return accountsOn;
    try { const h = await api('/api/health'); accountsOn = !!h.accounts; }
    catch (e) { accountsOn = false; }                      // no server, or an old one: simulated sign-in
    return accountsOn;
  }
  const on = () => accountsOn === true;

  /* who is signed in, or null. Never throws: a signed-out answer is an answer. */
  async function me() {
    try { current = await api('/api/auth/me'); }
    catch (e) { current = null; if (e.status === 426) throw e; }
    return current;
  }
  const cached = () => current;

  /* ---- the ceremonies ---- */
  const toCreate = pk => Object.assign({}, pk, {
    challenge: fromB64u(pk.challenge),
    user: Object.assign({}, pk.user, { id: fromB64u(pk.user.id) }),
    excludeCredentials: (pk.excludeCredentials || []).map(c => Object.assign({}, c, { id: fromB64u(c.id) })),
  });
  const toGet = pk => Object.assign({}, pk, {
    challenge: fromB64u(pk.challenge),
    allowCredentials: (pk.allowCredentials || []).map(c => Object.assign({}, c, { id: fromB64u(c.id) })),
  });
  const fromCredential = c => ({
    id: c.id, rawId: b64u(c.rawId), type: c.type,
    response: c.response.attestationObject
      ? { clientDataJSON: b64u(c.response.clientDataJSON), attestationObject: b64u(c.response.attestationObject), transports: c.response.getTransports ? c.response.getTransports() : [] }
      : { clientDataJSON: b64u(c.response.clientDataJSON), authenticatorData: b64u(c.response.authenticatorData), signature: b64u(c.response.signature), userHandle: c.response.userHandle ? b64u(c.response.userHandle) : null },
  });

  /* what a code is for, before anyone types their name into anything */
  const peek = code => api('/api/join/peek', { method: 'POST', body: { code } });

  /* a new account: the invite or join link decides which club and which role it asks for */
  async function register(code, displayName) {
    const opts = await api('/api/auth/register/options', { method: 'POST', body: { code, displayName } });
    const credential = await navigator.credentials.create({ publicKey: toCreate(opts.publicKey) });
    current = await api('/api/auth/register/verify', { method: 'POST', body: { challengeId: opts.challengeId, credential: fromCredential(credential) } });
    return current;
  }
  /* an existing passkey: no user name, no e-mail — the authenticator knows which one it is */
  async function signIn() {
    const opts = await api('/api/auth/login/options', { method: 'POST', body: {} });
    const credential = await navigator.credentials.get({ publicKey: toGet(opts.publicKey) });
    current = await api('/api/auth/login/verify', { method: 'POST', body: { challengeId: opts.challengeId, credential: fromCredential(credential) } });
    return current;
  }
  /* proving it is still you, for the things that would hurt: invites, roles, removals */
  async function stepUp() {
    const opts = await api('/api/auth/stepup/options', { method: 'POST', body: {} });
    const credential = await navigator.credentials.get({ publicKey: toGet(opts.publicKey) });
    return api('/api/auth/stepup/verify', { method: 'POST', body: { challengeId: opts.challengeId, credential: fromCredential(credential) } });
  }
  const join = code => api('/api/join', { method: 'POST', body: { code } });
  async function signOut() { try { await api('/api/auth/logout', { method: 'POST', body: {} }); } finally { current = null; } }

  /* the club this device acts in: the only approved one, or the one the person picked */
  function activeClub(preferred) {
    const clubs = (current && current.clubs || []).filter(c => c.status === 'approved');
    return clubs.find(c => c.id === preferred) || clubs[0] || null;
  }
  /* the app's own role names, from the club membership */
  const APP_ROLE = { admin: 'super-admin', coach: 'coach', trainer: 'trainer', player: 'player' };
  function appUser(preferredClub) {
    if (!current || !current.user) return null;
    const club = activeClub(preferredClub);
    const pending = (current.clubs || []).find(c => c.status === 'pending');
    return {
      id: current.user.id, name: current.user.displayName, email: null, provider: 'Passkey',
      role: club ? APP_ROLE[club.role] : 'player',
      clubRole: club ? club.role : null, clubId: club ? club.id : null, clubName: club ? club.name : null,
      memberRef: club ? club.memberRef : null,
      status: club ? 'approved' : (pending ? 'pending' : 'none'),
      pending: pending || null,
      clubs: current.clubs || [],
      uv: !!(current.session && current.session.uv),
    };
  }

  return { CLIENT_VERSION, probe, on, me, cached, api, peek, register, signIn, signOut, stepUp, join, appUser, activeClub, supported, b64u, fromB64u };
})();

// Node/CommonJS interop (no-op in the browser)
if (typeof module !== "undefined" && module.exports) module.exports = SESSION;
