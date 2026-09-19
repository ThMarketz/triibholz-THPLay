/* Build legal/manifest.json from the documents themselves.
 *
 *   node scripts/legal-stamp.mjs            rewrite it
 *   node scripts/legal-stamp.mjs --check    fail if it is stale   ← a gate
 *
 * WHY THE VERSION IS NOT TYPED BY HAND. "Accepted: yes" is worth nothing once a document changes,
 * and the first lawyer to read these will change them. What a club, a parent or a court asks is
 * "what did they agree to", and only the exact text answers it. So a version is the date in the
 * document's own front matter plus the first eight characters of its sha256: edit a comma and the
 * version moves on its own. There is no way to change a document and leave the version claiming
 * otherwise, and no discipline for anyone to keep.
 *
 * A stale manifest would mean the server serving one text while recording acceptance of another,
 * which is the exact failure this is meant to prevent — hence the gate.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'legal');
const OUT = join(DIR, 'manifest.json');

export function build() {
  const files = readdirSync(DIR).filter(n => n.endsWith('.md')).sort();
  const docs = {};
  for (const name of files) {
    const m = /^([a-z][a-z0-9-]*)\.([a-z]{2})\.md$/.exec(name);
    if (!m) throw new Error(`legal/${name}: expected <doc>.<lang>.md`);
    const [, doc, lang] = m;
    const text = readFileSync(join(DIR, name), 'utf8');
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
    if (!fm) throw new Error(`legal/${name}: no front matter`);
    const date = (/^date:\s*(\d{4}-\d{2}-\d{2})\s*$/m.exec(fm[1]) || [])[1];
    if (!date) throw new Error(`legal/${name}: front matter needs a date: YYYY-MM-DD`);
    const status = (/^status:\s*(\w+)\s*$/m.exec(fm[1]) || [])[1] || 'draft';
    // the WHOLE file, front matter included: the review note is part of what somebody was shown
    const sha256 = createHash('sha256').update(text).digest('hex');
    const d = docs[doc] || (docs[doc] = { version: null, status, langs: {} });
    d.langs[lang] = { sha256, bytes: Buffer.byteLength(text), date };
    /* A TRANSLATION SAYS WHICH ENGLISH IT TRANSLATES. Without it there is no way to tell a German
       text of today's English from one of last month's, and the version a reader accepts is the
       English one. The server and the app use a translation only while this names the current
       English version (LEGAL.pickLang); otherwise they show English and say so. */
    if (lang !== 'en') {
      const tr = (/^translates:\s*(\d{4}-\d{2}-\d{2}\+[0-9a-f]{8})\s*$/m.exec(fm[1]) || [])[1];
      if (!tr) throw new Error(`legal/${name}: a translation needs "translates: <English version>" in its front matter`);
      d.langs[lang].translates = tr;
    }
    // the canonical version comes from the English text; a translation that drifts is caught below
    if (lang === 'en') { d.version = `${date}+${sha256.slice(0, 8)}`; d.status = status; }
  }
  for (const [id, d] of Object.entries(docs)) {
    if (!d.version) throw new Error(`legal/${id}: no English text, so there is no version to bind to`);
  }
  return { docs };
}

/* translations that no longer translate the current English — shown as English until updated */
export function behind(built) {
  const out = [];
  for (const [id, d] of Object.entries((built || build()).docs)) {
    for (const [lang, l] of Object.entries(d.langs)) if (lang !== 'en' && l.translates !== d.version) out.push(`${id}.${lang} translates ${l.translates}, English is ${d.version}`);
  }
  return out;
}

function main() {
  const built = build();
  const late = behind(built);
  if (late.length) {
    console.warn(`${late.length} translation(s) are behind the English and will be shown as English until updated:`);
    late.forEach(l => console.warn('  ' + l));
  }
  const text = JSON.stringify(built, null, 1) + '\n';
  let have = null;
  try { have = readFileSync(OUT, 'utf8'); } catch (e) { have = null; }
  if (have === text) { console.log('legal manifest is current'); return; }
  if (process.argv.includes('--check')) {
    console.error('legal/manifest.json is stale — a document changed without the manifest moving with it.');
    console.error('  The server would serve one text and record acceptance of another. Run: node scripts/legal-stamp.mjs');
    process.exit(1);
  }
  writeFileSync(OUT, text);
  for (const [id, d] of Object.entries(built.docs)) console.log(`  ${id.padEnd(8)} ${d.version}  ${d.status}  [${Object.keys(d.langs).join(', ')}]`);
  console.log('wrote legal/manifest.json');
}

if (process.argv[1] && process.argv[1].endsWith('legal-stamp.mjs')) main();
