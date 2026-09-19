/* Shared by the accounts test suites: start the real server with accounts on, talk HTTP like a
   browser (Origin, JSON, cookies), and hold a software passkey per device. */
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { SoftAuthenticator, FLAG, b64u } from './softauthn.mjs';

export const ORIGIN = 'http://localhost:8088';
const require = createRequire(import.meta.url);

export async function startServer(port, env = {}) {
  const DATA = mkdtempSync(join(tmpdir(), 'thp-acc-'));
  Object.assign(process.env, { PORT: String(port), DATA_DIR: DATA, ACCOUNTS: '1', DEV: '1', RP_ID: 'localhost', APP_ORIGINS: ORIGIN, AUTH_BODY_TIMEOUT_MS: '1500' }, env);
  const mod = require('../server/index.js');
  await new Promise(r => mod.server.listen(port, '127.0.0.1', r));
  return { mod, db: mod.accountsDb, ID: require('../server/identity.js'), DATA, port, close: () => mod.server.close() };
}

let addr = 0;
export function makeCall(port, defaultOrigin = ORIGIN) {
  return function call(method, path, { body, origin = defaultOrigin, cookie, type = 'application/json', ip, raw, headers: extra } = {}) {
    return new Promise((resolve, reject) => {
      const payload = raw !== undefined ? raw : body === undefined ? (method === 'GET' ? '' : '{}') : JSON.stringify(body);
      const headers = { 'x-real-ip': ip || `10.8.${(++addr >> 8) & 255}.${addr & 255}` };
      if (origin) headers.origin = origin;
      if (type && method !== 'GET') headers['content-type'] = type;
      if (cookie) headers.cookie = cookie;
      Object.assign(headers, extra || {});
      if (method !== 'GET') headers['content-length'] = Buffer.byteLength(payload);
      const req = http.request({ host: '127.0.0.1', port, method, path, headers }, res => {
        const chunks = []; res.on('data', c => chunks.push(c));
        res.on('end', () => { const text = Buffer.concat(chunks).toString(); let json = null; try { json = JSON.parse(text); } catch (e) {} resolve({ status: res.statusCode, headers: res.headers, json, text }); });
      });
      req.on('error', reject);
      if (method !== 'GET') req.end(payload); else req.end();
    });
  };
}

export class Device {
  constructor(call, flags, origin = ORIGIN) { this.call = call; this.origin = origin; this.key = new SoftAuthenticator(flags === undefined ? {} : { flags }); this.cookie = null; }
  take(r) {
    const sc = [].concat(r.headers['set-cookie'] || [])[0];
    if (!sc) return;
    const m = /^thp=([^;]*)/.exec(sc);
    this.cookie = m && m[1] && !/Max-Age=0/.test(sc) ? `thp=${m[1]}` : null;
  }
  async register(code, displayName, over = {}) {
    const options = await this.call('POST', '/api/auth/register/options', { body: { code, displayName } });
    if (options.status !== 200) return { options, verify: options };
    const pk = options.json.publicKey;
    const credential = this.key.create({ rpId: pk.rp.id, origin: this.origin, challenge: pk.challenge, userHandle: pk.user.id, over });
    const verify = await this.call('POST', '/api/auth/register/verify', { body: { challengeId: options.json.challengeId, credential } });
    this.take(verify);
    return { options, verify };
  }
  async login(over = {}) {
    const o = await this.call('POST', '/api/auth/login/options', {});
    const credential = this.key.get({ rpId: 'localhost', origin: this.origin, challenge: o.json.publicKey.challenge, over });
    const v = await this.call('POST', '/api/auth/login/verify', { body: { challengeId: o.json.challengeId, credential }, cookie: this.cookie });
    this.take(v);
    return v;
  }
  async stepUp(over = {}) {
    const o = await this.call('POST', '/api/auth/stepup/options', { cookie: this.cookie });
    if (o.status !== 200) return o;
    const credential = this.key.get({ rpId: 'localhost', origin: this.origin, challenge: o.json.publicKey.challenge, over });
    return this.call('POST', '/api/auth/stepup/verify', { body: { challengeId: o.json.challengeId, credential }, cookie: this.cookie });
  }
  get(path) { return this.call('GET', path, { cookie: this.cookie }); }
  post(path, body = {}) { return this.call('POST', path, { body, cookie: this.cookie }); }
  me() { return this.get('/api/auth/me'); }
  /* The club's admin accepts the terms and the data-processing agreement, as the accept screen
     does. Until they have, the server holds no club data (server/legal.js underContract), so any
     test that puts a roster, a video or a note on the server needs this first. */
  async acceptClubTerms(clubId) {
    const docs = ((await this.get('/api/legal')).json || { docs: [] }).docs.filter(d => d.scope === 'club');
    const out = [];
    for (const d of docs) {
      const shown = (await this.get(`/api/legal/${d.id}?lang=en`)).json;    // what the screen shows, and its hash
      out.push(await this.post('/api/legal/accept', { doc: d.id, version: shown.version, lang: shown.lang, sha256: shown.sha256, clubId }));
    }
    return out;
  }
}

export { FLAG, b64u };
