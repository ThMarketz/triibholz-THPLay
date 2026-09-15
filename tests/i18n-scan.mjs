/* i18n guard — finds user-visible chrome that would stay English when the app is switched
   to another language.

   The app's policy (js/i18n.js header) is: UI CHROME is translated in EN/DE/FR/IT, while
   tactical/coaching CONTENT stays English-first on purpose. This scanner enforces the first
   half. It reads the rendering source and reports every literal that reaches a user's eyes
   without going through T(): text between tags, the attributes a user actually reads
   (placeholder / title / aria-label), toast() calls, and `el.textContent = '...'` — the last
   of those hid the pool's GOAL JUDGE label and "Signing in…" through three whole tranches,
   because neither ever passes through markup.

   Run standalone to see the list:   node tests/i18n-scan.mjs
   Import scanFile() from the smoke suite to fail the build on regressions.

   It is deliberately a source scan rather than a DOM diff: it points at the exact line to
   fix, and it catches a string the moment it is written rather than only when some test
   happens to render that view.

   KNOWN LIMIT: a template literal with no markup in it at all — `${n} plays left` — is not
   scanned, because at that point it is indistinguishable from the hundreds of code strings
   that build URLs, class lists and storage keys. Everything with a tag in it is fair game,
   in template literals (however deeply nested), in ordinary quotes, and in toast(). */
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
  /^[—–-]\s*Triibholz$/,                        // the brand suffix on the print booklet's <title>
  /^(beta|Tier(\s|&nbsp;)[123])$/i,             // maturity badges on the Film Room panels — same word everywhere
  /^\d+(v\d+)?$/,                               // 6v6, 5v4 …
  /^(Q[1-4]|[1-6]|GK)$/,
  /^3 has the ball\b/,                          // the Draft-from-words placeholder: js/draft.js
                                                 // parses English only, so a translated example
                                                 // would be an example that cannot work
];

const isAllowed = s => ALLOW.some(re => re.test(s.trim()));

/* a fragment only counts as prose if it has a real word in it */
const looksLikeProse = s => /\p{L}{3,}/u.test(s);

/* Find every top-level template literal, and blank the parts we must not scan: nested
   ${...} expressions (they are code, and usually already a T() call or an escapeHtml of
   user data).

   This has to be a character walk, not a regex. These templates nest — `${xs.map(x => `
   <li>${x}</li>`).join('')}` — and a regex that stops at the first backtick ends the outer
   literal in the middle of the interpolation, leaving code like `).join('')}` to be scanned
   as if it were copy. Walking with a ${} depth counter is the only way to get the real
   boundaries; the inner literals are reported separately in their own right. */
function templateLiterals(src) {
  const out = [];
  out.outerSpans = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2); if (i < 0) break; i++; continue; }
    if (c === "'" || c === '"') { i = skipString(src, i); continue; }
    if (c !== '`') continue;
    const from = i;
    i = readTemplate(src, i, out);       // pushes this literal AND every literal nested in it
    out.outerSpans.push([from, i]);
  }
  return out;
}

/* Skip the quoted string opening at `q`, returning the index of its closing quote.

   A quote is not always a string: `escapeHtml` is built on /[&<>"']/g, and treating that `"`
   as the start of a string swallowed the next few hundred lines and quietly hid every literal
   in them. A JS string cannot contain a raw newline, so hitting one means we guessed wrong —
   give the character back and carry on. That makes the walk self-correcting instead of
   silently under-reporting, which is the one failure mode a guard must not have. */
function skipString(src, q) {
  const quote = src[q];
  for (let i = q + 1; i < src.length; i++) {
    if (src[i] === '\\') { i++; continue; }
    if (src[i] === '\n') return q;                  // not a string after all
    if (src[i] === quote) return i;
  }
  return q;
}

/* The source with every template literal blanked — i.e. only the plain code. Pass 1 already
   owns what is inside the literals, and naively pairing quotes across them mispairs the `'`
   in `.join('')` with an apostrophe in some sentence, which reported code as copy. */
function codeOnly(src, lits) {
  const buf = src.split('');
  lits.outerSpans.forEach(([a, b]) => { for (let i = a; i <= b && i < buf.length; i++) buf[i] = ' '; });
  return buf.join('');
}

/* Read the template literal starting at `open` (a backtick). Pushes {start, body} for it —
   body has every ${...} blanked to spaces so offsets still line up with the source — and
   recurses into literals nested inside those interpolations so their copy is scanned too.
   Returns the index of the closing backtick. */
function readTemplate(src, open, out) {
  let body = '`', i = open + 1;
  for (; i < src.length; i++) {
    const c = src[i];
    /* Keep the escaped character, not two blanks: printHtml() closes its embedded script with
       <\/script>, and blanking the slash left "<  script>" which then read as real copy. */
    if (c === '\\') { body += (/[a-z]/i.test(src[i + 1] || '') ? '  ' : ' ' + src[i + 1]); i++; continue; }
    if (c === '`') { body += '`'; break; }
    if (c === '$' && src[i + 1] === '{') {
      let depth = 1;
      body += '  '; i += 2;
      for (; i < src.length && depth; i++) {
        const d = src[i];
        if (d === '\\') { body += '  '; i++; continue; }
        if (d === '`') { const end = readTemplate(src, i, out); body += ' '.repeat(end - i + 1); i = end; continue; }
        if (d === "'" || d === '"') {                      // a quoted string inside the code
          const from = i;
          i = skipString(src, i);
          body += ' '.repeat(i - from + 1);
          continue;
        }
        if (d === '{') depth++;
        else if (d === '}') { depth--; if (!depth) { body += ' '; break; } }
        body += ' ';
      }
      continue;
    }
    body += c;
  }
  out.push({ start: open, body });
  return i;
}

const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

/* The app shell. index.html is static markup, so none of the JS passes apply to it — and it
   is where the whole playbook toolbar lives. A string here is translated by carrying
   data-i18n / data-i18n-ph / data-i18n-title, which I18N.apply() swaps at runtime; anything
   else is English forever. This surface was unguarded through four tranches. */
function scanHtml(relPath, src, push) {
  const body = src.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, s => ' '.repeat(s.length))
                  .replace(/<!--[\s\S]*?-->/g, s => ' '.repeat(s.length));
  let m;
  const el = /<([a-z][a-z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>([^<>]{2,})</gi;
  while ((m = el.exec(body))) {
    if (/\bdata-i18n(-html)?\s*=/.test(m[2])) continue;          // swapped at runtime
    push(m.index + m[0].length - m[3].length - 1, m[3], 'html');
  }
  /* (?<![-\w]) matters: without it, `title="…"` also matches inside `data-i18n-title="…"`,
     and the scanner cheerfully reports its own key names as untranslated English. */
  const attr = /(?<![-\w])(placeholder|title|aria-label)\s*=\s*"([^"]{2,})"/gi;
  while ((m = attr.exec(body))) {
    // the WHOLE tag, not just what precedes the attribute — the data-i18n-* marker is
    // usually written after the attribute it localises
    const tagStart = body.lastIndexOf('<', m.index);
    let tagEnd = body.indexOf('>', m.index); if (tagEnd < 0) tagEnd = body.length;
    const tag = body.slice(tagStart, tagEnd);
    const a = m[1].toLowerCase();
    const want = a === 'placeholder' ? 'data-i18n-ph' : a === 'aria-label' ? 'data-i18n-aria' : 'data-i18n-title';
    if (tag.includes(want)) continue;
    push(m.index, m[2], a);
  }
}

export function scanFile(relPath) {
  const src = readFileSync(join(APP, relPath), 'utf8');
  const findings = [];
  const push = (idx, text, kind) => {
    const s = text.replace(/\s+/g, ' ').trim();
    if (!s || !looksLikeProse(s) || isAllowed(s)) return;
    findings.push({ file: relPath, line: lineOf(src, idx), kind, text: s });   // full text — the CLI truncates for display, callers need it whole to match source
  };

  if (/\.html?$/i.test(relPath)) { scanHtml(relPath, src, push); return findings; }

  // 1) text between tags, inside template literals only (so we don't scan comments/CSS)
  let m;
  const lits = templateLiterals(src);
  for (const { start, body: raw } of lits) {
    if (!/</.test(raw)) continue;                        // not markup — skip plain strings here
    /* <style> and <script> bodies are code, not copy — printHtml() embeds both. The closing
       tag may be written <\/script> to survive being inside a <script> itself. Blank them in
       place rather than replacing, so offsets still point at the right source line. */
    const body = raw.replace(/<(style|script)[^>]*>[\s\S]*?<\s*\/\1>/gi, s => ' '.repeat(s.length));
    let t;
    const between = />([^<>]{2,})</g;
    while ((t = between.exec(body))) push(start + t.index, t[1], 'text');
    /* Copy that sits OUTSIDE any tag — before the first `<` or after the last `>`.
       `${a} conceded in ${b} situations — that phase is…` is just as visible as text in a
       <span>, and the between-tags regex above cannot see it because it has no opening `>`. */
    const first = body.indexOf('<'), last = body.lastIndexOf('>');
    if (first > 1) push(start, body.slice(1, first), 'text');            // slice(1) drops the backtick
    if (last > -1 && last < body.length - 2) push(start + last, body.slice(last + 1, -1), 'text');
    const attr = /\b(placeholder|title|aria-label)\s*=\s*"([^"]{2,})"/g;
    while ((t = attr.exec(body))) push(start + t.index, t[2], t[1]);
  }

  // 2) markup inside ordinary quotes — the `cond ? '<span>No clip</span>' : ''` idiom is
  //    everywhere in this codebase and is exactly as visible as a template literal.
  const code = codeOnly(src, lits);
  const quoted = /(['"])((?:(?!\1)[^\\\n]|\\.)*?)\1/g;
  while ((m = quoted.exec(code))) {
    const body = m[2];
    if (!/<[a-z/]/i.test(body)) continue;                // needs a real tag, not just a `<` in prose
    let t;
    const between = />([^<>]{2,})</g;
    while ((t = between.exec(body))) push(m.index, t[1], 'text');
    const first = body.indexOf('<'), last = body.lastIndexOf('>');
    if (first > 0) push(m.index, body.slice(0, first), 'text');
    if (last > -1 && last < body.length - 1) push(m.index, body.slice(last + 1), 'text');
  }

  // 3) toast('…') — a user-visible message that never sits in markup
  const toast = /\btoast\(\s*(['"])((?:[^\\]|\\.)*?)\1/g;
  while ((m = toast.exec(src))) push(m.index, m[2], 'toast');

  /* …and every other literal inside the toast's argument: `toast(on ? 'Sound on' : 'Sound off')` and
     `toast(msg || 'Saved')` start with code, so the pattern above never saw them (the sound toast stayed
     English through the whole translation work). Walk to the matching `)`, drop T(...) calls, and report
     what is left in quotes. */
  const toastCall = /\btoast\(/g;
  while ((m = toastCall.exec(src))) {
    let i = m.index + m[0].length, depth = 1, q = null;
    const from = i;
    for (; i < src.length && depth; i++) {
      const ch = src[i];
      if (q) { if (ch === '\\') i++; else if (ch === q) q = null; continue; }
      if (ch === "'" || ch === '"' || ch === '`') q = ch;
      else if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === '\n' && depth === 1 && i - from > 400) break;
    }
    let arg = src.slice(from, i - 1);
    if (/^\s*(['"])/.test(arg) && !/^\s*(['"])(?:(?!\1)[^\\\n]|\\.)*\1\s*[?:|&]/.test(arg)) continue;   // a bare literal: reported above
    for (let prev = ''; prev !== arg;) { prev = arg; arg = arg.replace(/\bTX?\((?:[^()]|\([^()]*\))*\)/g, ' '); }   // T() in app.js, TX() in film.js
    arg = arg.replace(/[!=]==?\s*(['"])(?:(?!\1)[^\\\n]|\\.)*\1|(['"])(?:(?!\2)[^\\\n]|\\.)*\2\s*[!=]==?/g, ' ');   // compared, not shown: lane === 'exc'
    const lit = /(['"])((?:(?!\1)[^\\\n]|\\.)*?)\1/g;
    let t;
    while ((t = lit.exec(arg))) push(m.index, t[2], 'toast');
  }

  /* 4) el.textContent = '…' — visible text that never passes through markup at all, so
     passes 1 and 2 are blind to it. By definition textContent IS what the user reads, which
     makes this the rare pattern with no false positives worth speaking of. This is how
     "Signing in…" and the pool's GOAL JUDGE label stayed English through three tranches. */
  const textContent = /\.textContent\s*=\s*(['"])((?:(?!\1)[^\\\n]|\\.)*?)\1/g;
  while ((m = textContent.exec(src))) push(m.index, m[2], 'textContent');

  /* …and the same assignment written as a template literal. The "no markup, don't scan"
     rule above does NOT apply here: whatever is assigned to textContent is by definition
     what the user reads, tag or no tag. `Step ${n} / ${total}` sat in five places and was
     the last English left on the playbook screen. */
  const tplText = /\.textContent\s*=\s*`((?:[^`\\]|\\.)*)`/g;
  while ((m = tplText.exec(src))) push(m.index, m[1].replace(/\$\{[^}]*\}/g, ' '), 'textContent');

  return findings;
}

export function scanAll(files) {
  return files.flatMap(scanFile);
}

/* The rendering surface. js/*.js content modules (commands/help/data/testlog/shot) are
   deliberately excluded: those hold coaching content, which is English-first by policy. */
export const UI_FILES = ['js/app.js', 'js/film.js', 'js/help.js', 'js/gameplan.js', 'js/tactics.js', 'js/pool.js', 'js/animate.js', 'index.html', 'js/teams.js'];

/* A RATCHET, not a target. The backlog is burned down view by view; this number may only
   ever go DOWN. Its job is to make the next hard-coded string fail the build on the day it
   is written — which is the only thing that stops this drifting again, and is exactly how
   the app ended up with 73 translated keys and 392 untranslated ones. */
export const BASELINE = { 'js/app.js': 0, 'js/film.js': 0, 'js/help.js': 0, 'js/gameplan.js': 0, 'js/tactics.js': 0, 'js/pool.js': 0, 'js/animate.js': 0, 'index.html': 0, 'js/teams.js': 0 };

// compare real paths — import.meta.url is percent-encoded and this repo lives under "Mobile Documents"
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const found = scanAll(UI_FILES);
  const byFile = {};
  found.forEach(f => { (byFile[f.file] = byFile[f.file] || []).push(f); });
  Object.keys(byFile).forEach(f => {
    console.log(`\n${f} — ${byFile[f].length} untranslated`);
    byFile[f].slice(0, Number(process.env.SHOW || 25)).forEach(x => console.log(`  ${String(x.line).padStart(5)} [${x.kind}] ${x.text.slice(0, 90)}`));
    if (byFile[f].length > Number(process.env.SHOW || 25)) console.log(`  … and ${byFile[f].length - Number(process.env.SHOW || 25)} more`);
  });
  console.log(`\nTOTAL untranslated chrome strings: ${found.length}`);
}
