/* ============================================================
   server/cbor.js — a strict CBOR decoder (RFC 8949) for WebAuthn.

   Only what authenticators send: unsigned and negative integers, byte
   and text strings, arrays, maps, true/false/null. Everything else is
   refused rather than guessed at — indefinite lengths, tags, floats,
   other simple values, duplicate map keys, map keys that are not an
   integer or text, invalid UTF-8, nesting deeper than 8, strings
   longer than 64 kB, and any length that runs past the buffer (checked
   before a single byte is sliced).

   decodeOne(buf, offset) → { value, end } decodes ONE item and says
   where it ended, because authenticator data is a COSE key followed by
   more bytes. decodeAll(buf) additionally refuses trailing bytes.
   ============================================================ */
'use strict';

const MAX_DEPTH = 8;
const MAX_LEN = 65536;
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });   // byte-exact: a leading U+FEFF is part of the text

const bad = why => Object.assign(new Error('cbor: ' + why), { code: 'bad-cbor' });

function decodeOne(input, offset = 0, depth = 0) {
  const buf = Buffer.isBuffer(input) ? input : ArrayBuffer.isView(input) ? Buffer.from(input.buffer, input.byteOffset, input.byteLength) : Buffer.from(input);
  if (depth > MAX_DEPTH) throw bad('nested too deeply');
  if (!Number.isInteger(offset) || offset < 0 || offset >= buf.length) throw bad('truncated');
  const initial = buf[offset], major = initial >> 5, info = initial & 31;
  let pos = offset + 1;
  const need = n => { if (n > buf.length - pos) throw bad('truncated'); };
  // refuse by kind before reading an argument, so a float is called a float
  if (major === 6) throw bad('tags are not allowed');
  if (major === 7 && (info < 20 || info > 22)) throw bad('floats and other simple values are not allowed');

  let arg;
  if (info < 24) arg = info;
  else if (info === 24) { need(1); arg = buf[pos]; pos += 1; }
  else if (info === 25) { need(2); arg = buf.readUInt16BE(pos); pos += 2; }
  else if (info === 26) { need(4); arg = buf.readUInt32BE(pos); pos += 4; }
  else if (info === 27) {
    need(8); const big = buf.readBigUInt64BE(pos); pos += 8;
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw bad('integer too large');
    arg = Number(big);
  } else throw bad(info === 31 ? 'indefinite lengths are not allowed' : 'reserved additional information');

  switch (major) {
    case 0: return { value: arg, end: pos };
    case 1: return { value: -1 - arg, end: pos };
    case 2:
    case 3: {
      if (arg > MAX_LEN) throw bad('string too long');
      need(arg);
      const bytes = buf.subarray(pos, pos + arg);
      if (major === 2) return { value: Buffer.from(bytes), end: pos + arg };
      let text; try { text = utf8.decode(bytes); } catch (e) { throw bad('invalid UTF-8'); }
      return { value: text, end: pos + arg };
    }
    case 4: {
      if (arg > buf.length - pos) throw bad('truncated');   // every item is at least one byte
      const items = [];
      for (let i = 0; i < arg; i++) { const r = decodeOne(buf, pos, depth + 1); items.push(r.value); pos = r.end; }
      return { value: items, end: pos };
    }
    case 5: {
      if (arg > (buf.length - pos) / 2) throw bad('truncated');
      const map = new Map(), seen = new Set();
      for (let i = 0; i < arg; i++) {
        const k = decodeOne(buf, pos, depth + 1); pos = k.end;
        if (typeof k.value !== 'number' && typeof k.value !== 'string') throw bad('map keys must be integers or text');
        const id = typeof k.value + ':' + k.value;
        if (seen.has(id)) throw bad('duplicate map key');
        seen.add(id);
        const v = decodeOne(buf, pos, depth + 1); pos = v.end;
        map.set(k.value, v.value);
      }
      return { value: map, end: pos };
    }
    case 6: throw bad('tags are not allowed');
    default:   // 7
      if (info === 20) return { value: false, end: pos };
      if (info === 21) return { value: true, end: pos };
      if (info === 22) return { value: null, end: pos };
      throw bad('floats and other simple values are not allowed');
  }
}

function decodeAll(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const { value, end } = decodeOne(buf, 0);
  if (end !== buf.length) throw bad('trailing bytes');
  return value;
}

module.exports = { decodeOne, decodeAll, MAX_DEPTH, MAX_LEN };
