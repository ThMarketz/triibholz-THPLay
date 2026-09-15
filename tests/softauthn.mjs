/* A software passkey, for tests.

   It does what a platform authenticator does — makes a real P-256 key pair, writes a real CBOR
   attestationObject and authenticatorData, signs real ES256 assertions — so the server's
   verification runs against genuine cryptography instead of a mock that agrees with it.

   Every field can be bent for negative tests: wrong origin, wrong rpId, missing user-presence
   flag, a replayed challenge, a regressed sign counter, a tampered signature.

   Written from the WebAuthn Level 3 data formats (§6.1 authenticator data, §6.5 attestation
   object, §7 client data), independently of the server code, so the two check each other. */
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

export const b64u = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const fromB64u = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const sha256 = b => createHash('sha256').update(b).digest();

/* ---- a minimal canonical CBOR encoder: exactly what CTAP2 authenticators emit ---- */
function head(major, n) {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 0x100) return Buffer.from([(major << 5) | 24, n]);
  if (n < 0x10000) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b; }
  const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b;
}
export function cbor(v) {
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return Buffer.concat([head(2, v.length), Buffer.from(v)]);
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') { const s = Buffer.from(v, 'utf8'); return Buffer.concat([head(3, s.length), s]); }
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cbor)]);
  if (v instanceof Map) {
    // canonical order: shorter encoded key first, then bytewise (RFC 8949 §4.2.1 / CTAP2)
    const entries = [...v.entries()].map(([k, x]) => [cbor(k), cbor(x)]).sort((a, b) => a[0].length - b[0].length || Buffer.compare(a[0], b[0]));
    return Buffer.concat([head(5, entries.length), ...entries.flat()]);
  }
  if (v === true) return Buffer.from([0xf5]);
  if (v === false) return Buffer.from([0xf4]);
  if (v === null) return Buffer.from([0xf6]);
  throw new Error('cbor: unsupported ' + typeof v);
}

const FLAG = { UP: 0x01, UV: 0x04, BE: 0x08, BS: 0x10, AT: 0x40, ED: 0x80 };

export class SoftAuthenticator {
  constructor(opts = {}) {
    this.aaguid = Buffer.alloc(16);                 // all zeros, as 'none' attestation allows
    this.flags = opts.flags ?? (FLAG.UP | FLAG.UV); // user present + verified by default
    this.creds = new Map();                         // id(b64u) → { privateKey, jwk, rpId, userHandle, count }
  }

  clientData(type, challenge, origin, extra = {}) {
    // same member order a browser emits: type, challenge, origin, crossOrigin
    return Buffer.from(JSON.stringify(Object.assign({ type, challenge, origin, crossOrigin: false }, extra)), 'utf8');
  }

  /* navigator.credentials.create() */
  create({ rpId, origin, challenge, userHandle, over = {} }) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const credId = over.credentialId || randomBytes(16);
    const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, fromB64u(jwk.x)], [-3, fromB64u(jwk.y)]]));
    const flags = (over.flags ?? this.flags) | FLAG.AT;
    const count = Buffer.alloc(4); count.writeUInt32BE(0);
    const credLen = Buffer.alloc(2); credLen.writeUInt16BE(credId.length);
    const authData = Buffer.concat([sha256(Buffer.from(over.rpId ?? rpId)), Buffer.from([flags]), count, this.aaguid, credLen, credId, over.cose ?? cose]);
    const attestationObject = cbor(new Map([['fmt', over.fmt ?? 'none'], ['attStmt', new Map()], ['authData', authData]]));
    const clientDataJSON = this.clientData(over.type ?? 'webauthn.create', over.challenge ?? challenge, over.origin ?? origin, over.clientExtra);
    const id = b64u(credId);
    this.creds.set(id, { privateKey, jwk, rpId, userHandle, count: 0 });
    return { id, rawId: id, type: 'public-key',
      response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject), transports: ['internal'] } };
  }

  /* navigator.credentials.get() — discoverable: the authenticator picks its credential for the rp */
  get({ rpId, origin, challenge, credentialId, over = {} }) {
    const id = credentialId || [...this.creds.entries()].find(([, c]) => c.rpId === rpId)?.[0];
    const c = this.creds.get(id);
    if (!c) throw new Error('softauthn: no credential for ' + rpId);
    c.count = over.count ?? (c.count + 1);
    const count = Buffer.alloc(4); count.writeUInt32BE(c.count >>> 0);
    const authData = Buffer.concat([sha256(Buffer.from(over.rpId ?? rpId)), Buffer.from([over.flags ?? this.flags]), count]);
    const clientDataJSON = this.clientData(over.type ?? 'webauthn.get', over.challenge ?? challenge, over.origin ?? origin, over.clientExtra);
    let signature = sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), c.privateKey);   // DER, as authenticators send
    if (over.tamper) { signature = Buffer.from(signature); signature[signature.length - 1] ^= 0x01; }
    return { id, rawId: id, type: 'public-key',
      response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authData), signature: b64u(signature),
                  userHandle: over.userHandle === undefined ? c.userHandle : over.userHandle } };
  }
}

export { FLAG };
