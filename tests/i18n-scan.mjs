/* i18n guard — finds user-visible chrome that would stay English when the app is switched
   to another language.

   The app's policy (js/i18n.js header) is: UI CHROME is translated in EN/DE/FR/IT, while
   tactical/coaching CONTENT stays English-first on purpose. This scanner enforces the first
   half. It reads the rendering source and reports every literal that reaches a user's eyes
   without going through T(): text between tags, and the attributes a user actually reads
   (placeholder / title / aria-label), plus toast() calls.

   Run standalone to see the list:   node tests/i18n-scan.mjs
   Import scanFile() from the smoke suite to fail the build on regressions.

   It is deliberately a source scan rather than a DOM diff: it points at the exact line to
   fix, and it catches a string the moment it is written rather than only when some test
   happens to render that view. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');

/* Strings that are deliberately NOT translated. Keep this list short and justified —
   it is the escape hatch, and every entry is a small promise to the user. */
export const ALLOW = [
  /^[\s\d.,:;·—–\-+/%×()[\]]*$/u,              // punctuation, numbers, separators
  /^[^\p{L}]*$/u,                               // no letters at all (emoji, arrows, symbols)
  /^\p{L}$/u,                                   // a single letter (position chips: 1..6, GK handled below)
  /^(GK|XP|PS|RPE|CSV|ICS|PDF|SVG|PNG|JSON|QR|3D|2D|API|URL|ID|vs|v)$/i,
  /^(Triibholz|THPLAY|Spond|wpmatch\.ch|Swiss Aquatics|DeepL|Strava|Garmin|PISTE)$/i,
  /^\d+(v\d+)?$/,                               // 6v6, 5v4 …
  /^(Q[1-4]|[1-6]|GK)$/,
];

const isAllowed = s => ALLOW.some(re => re.test(s.trim()));

/* a fragment only counts as prose if it has a real word in it */
const looksLikeProse = s => /\p{L}{3,}/u.test(s);

/* Strip the parts of a template literal we must not scan: nested ${...} expressions
   (they are code, and usually already a T() call or an escapeHtml of user data). */
function blankInterpolations(src) {
  let out = '', depth = 0;
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '$' && src[i + 1] === '{') { depth++; i++; out += '  '; continue; }
    if (depth) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      out += ' ';
      continue;
    }
    out += src[i];
  }
  return out;
}

const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

export function scanFile(relPath) {
  const src = readFileSync(join(APP, relPath), 'utf8');
  const findings = [];
  const push = (idx, text, kind) => {
    const s = text.replace(/\s+/g, ' ').trim();
    if (!s || !looksLikeProse(s) || isAllowed(s)) return;
    findings.push({ file: relPath, line: lineOf(src, idx), kind, text: s.slice(0, 90) });
  };

  // 1) text between tags, inside template literals only (so we don't scan comments/CSS)
  const tpl = /`(?:[^`\\]|\\.)*`/gs;
  let m;
  while ((m = tpl.exec(src))) {
    const start = m.index;
    const body = blankInterpolations(m[0]);
    if (!/</.test(body)) continue;                       // not markup — skip plain strings here
    let t;
    const between = />([^<>]{2,})</g;
    while ((t = between.exec(body))) push(start + t.index, t[1], 'text');
    const attr = /\b(placeholder|title|aria-label)\s*=\s*"([^"]{2,})"/g;
    while ((t = attr.exec(body))) push(start + t.index, t[2], t[1]);
  }

  // 2) toast('…') — a user-visible message that never sits in markup
  const toast = /\btoast\(\s*(['"])((?:[^\\]|\\.)*?)\1/g;
  while ((m = toast.exec(src))) push(m.index, m[2], 'toast');

  return findings;
}

export function scanAll(files) {
  return files.flatMap(scanFile);
}

/* The rendering surface. js/*.js content modules (commands/help/data/testlog/shot) are
   deliberately excluded: those hold coaching content, which is English-first by policy. */
export const UI_FILES = ['js/app.js', 'js/film.js'];

/* A RATCHET, not a target. The backlog is burned down view by view; this number may only
   ever go DOWN. Its job is to make the next hard-coded string fail the build on the day it
   is written — which is the only thing that stops this drifting again, and is exactly how
   the app ended up with 73 translated keys and 392 untranslated ones. */
export const BASELINE = { 'js/app.js': 196, 'js/film.js': 112 };

// compare real paths — import.meta.url is percent-encoded and this repo lives under "Mobile Documents"
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const found = scanAll(UI_FILES);
  const byFile = {};
  found.forEach(f => { (byFile[f.file] = byFile[f.file] || []).push(f); });
  Object.keys(byFile).forEach(f => {
    console.log(`\n${f} — ${byFile[f].length} untranslated`);
    byFile[f].slice(0, Number(process.env.SHOW || 25)).forEach(x => console.log(`  ${String(x.line).padStart(5)} [${x.kind}] ${x.text}`));
    if (byFile[f].length > Number(process.env.SHOW || 25)) console.log(`  … and ${byFile[f].length - Number(process.env.SHOW || 25)} more`);
  });
  console.log(`\nTOTAL untranslated chrome strings: ${found.length}`);
}
