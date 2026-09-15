/* ============================================================
   server/config.js — accounts configuration, checked once at startup.

   Accounts are OFF unless ACCOUNTS=1; the server then behaves exactly
   as before. When they are on, a wrong setting must stop the server
   instead of quietly weakening sign-in, because passkeys are bound to
   the domain forever: a credential made for the wrong RP_ID cannot be
   moved later, and a session cookie set without Secure can be planted
   or read by a sibling host.

     ACCOUNTS=1
     RP_ID=triibholz.example.ch          the passkey domain (no scheme/port)
     APP_ORIGINS=https://triibholz.example.ch[,https://www.triibholz.example.ch]
     DEV=1                               only for http://localhost

   The cookie mode comes from APP_ORIGINS, never from request headers:
   behind cloudflared → nginx the request arrives as plain http even
   though the browser is on https.
   ============================================================ */
'use strict';
const net = require('node:net');

const list = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
const isLocalhost = h => h === 'localhost' || h.endsWith('.localhost');
const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HOSTNAME = new RegExp(`^(?=.{1,253}$)${LABEL}(?:\\.${LABEL})*$`);

function loadConfig(env = process.env) {
  const problems = [];
  const cfg = {
    accounts: env.ACCOUNTS === '1',
    dev: env.DEV === '1',
    rpId: null, rpName: 'Triibholz',
    origins: [], cookieSecure: false, cookieName: null,
    problems,
  };
  if (!cfg.accounts) return cfg;

  const rpId = String(env.RP_ID || '').trim();
  if (!rpId) problems.push('RP_ID is required (the domain passkeys belong to, e.g. triibholz.example.ch)');
  else if (net.isIP(rpId.replace(/^\[|\]$/g, ''))) problems.push(`RP_ID "${rpId}" is an IP address — passkeys need a domain name`);
  else if (rpId !== rpId.toLowerCase() || !HOSTNAME.test(rpId)) problems.push(`RP_ID "${rpId}" is not a lowercase host name (no scheme, port or path)`);
  else if (!rpId.includes('.') && rpId !== 'localhost') problems.push(`RP_ID "${rpId}" must be a full domain`);
  else cfg.rpId = rpId;

  const raw = list(env.APP_ORIGINS);
  if (!raw.length) problems.push('APP_ORIGINS is required (the exact address(es) the app is opened from)');
  for (const o of raw) {
    let u;
    try { u = new URL(o); } catch (e) { problems.push(`APP_ORIGINS: "${o}" is not a URL`); continue; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') { problems.push(`APP_ORIGINS: "${o}" must be http(s)`); continue; }
    if (u.username || u.password || u.search || u.hash || !/^https?:\/\/[^/]+\/?$/i.test(o)) { problems.push(`APP_ORIGINS: "${o}" must be an origin only — scheme, host and port, no path`); continue; }
    const h = u.hostname;
    if (net.isIP(h.replace(/^\[|\]$/g, ''))) { problems.push(`APP_ORIGINS: "${o}" uses an IP address — passkeys do not work there; use a host name`); continue; }
    if (cfg.rpId && h !== cfg.rpId && !h.endsWith('.' + cfg.rpId)) problems.push(`APP_ORIGINS: "${o}" is not on RP_ID ${cfg.rpId}`);
    if (u.protocol === 'http:' && !isLocalhost(h)) problems.push(`APP_ORIGINS: "${o}" must use https (only localhost may use http)`);
    if (!cfg.origins.includes(u.origin)) cfg.origins.push(u.origin);
  }

  const https = cfg.origins.filter(o => o.startsWith('https:')).length;
  const http = cfg.origins.length - https;
  if (https && http) problems.push('APP_ORIGINS mixes http and https — a deployment is either secure or local development, not both');
  cfg.cookieSecure = https > 0;
  if (http && !https && !(cfg.dev && cfg.rpId === 'localhost')) problems.push('http origins need DEV=1 and RP_ID=localhost (local development only)');
  if (cfg.dev && cfg.rpId && cfg.rpId !== 'localhost') problems.push('DEV=1 is only allowed with RP_ID=localhost');
  cfg.cookieName = cfg.cookieSecure ? '__Host-thp' : 'thp';
  return cfg;
}

/* loadConfig, or throw with every problem listed at once */
function assertConfig(env = process.env) {
  const cfg = loadConfig(env);
  if (cfg.problems.length) {
    const e = new Error('Accounts configuration refused:\n  - ' + cfg.problems.join('\n  - '));
    e.code = 'bad-config'; e.problems = cfg.problems;
    throw e;
  }
  return cfg;
}

module.exports = { loadConfig, assertConfig };
