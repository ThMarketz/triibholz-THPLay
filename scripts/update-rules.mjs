#!/usr/bin/env node
/* ============================================================
   update-rules.mjs — keep the official water polo rule books in
   sync with Swiss Aquatics.

   Fetches the Swiss Aquatics water-polo "Downloads / Reglemente"
   page, finds the CURRENT rule documents (World Aquatics playing
   rules + the Swiss competition regulations), and writes
   data/rules.json with each document's title, URL and version/date.

   We DO NOT copy the rule text (it is copyrighted) — we track and
   link to the official documents and record when we last checked.

   Run:  node scripts/update-rules.mjs
   CI:   .github/workflows/update-rules.yml (weekly + manual)
   ============================================================ */
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'data', 'rules.json');

const SOURCE_PAGE =
  'https://www.swiss-aquatics.ch/leistungssport/water-polo/wettkampfbetrieb/downloads-medien/';

// Documents we track. Each `match` finds the current PDF link on the page;
// the title is curated so it stays stable even if the filename changes.
const TRACKED = [
  { id: 'aqua-water-polo-rules', title: 'World Aquatics Water Polo Rules', lang: 'EN',
    category: 'International playing rules',
    match: /href="([^"]*Water-Polo-Rules[^"]*\.pdf)"/i },
  { id: 'swiss-reglement-5-1', title: 'Swiss Aquatics — Reglement 5.1', lang: 'DE',
    category: 'Swiss competition regulation',
    match: /href="([^"]*Reglement_5_1_D[^"]*\.pdf)"/i },
  { id: 'swiss-reglement-5-1-1', title: 'Swiss Aquatics — Reglement 5.1.1', lang: 'DE',
    category: 'Swiss competition regulation',
    match: /href="([^"]*Reglement_5_1_1_D[^"]*\.pdf)"/i },
];

// Authoritative landing pages (always valid, no version parsing needed)
const REFERENCES = [
  { title: 'Swiss Aquatics — Water Polo downloads & regulations', url: SOURCE_PAGE },
  { title: 'World Aquatics — Competition Regulations', url: 'https://www.worldaquatics.com/rules/competition-regulations' },
  { title: 'European Aquatics — Water Polo Rules', url: 'https://europeanaquatics.org/sports/water-polo/water-polo-rules/' },
];

// pull a human version/date out of a PDF filename, e.g.
//   Water-Polo-Rules_06.25.pdf            -> "06.25"
//   WP-Reglement_5_1_D_Update_30.04.2026  -> "30.04.2026"
function versionFromUrl(url) {
  const name = decodeURIComponent(url.split('/').pop() || '');
  const full = name.match(/(\d{2}\.\d{2}\.\d{4})/);          // dd.mm.yyyy
  if (full) return full[1];
  const ver = name.match(/_(\d{2}\.\d{2})(?=[._-]|\.pdf)/i);  // version like 06.25
  if (ver) return ver[1];
  const yr = name.match(/((?:19|20)\d{2})/);                  // a year
  return yr ? yr[1] : '';
}

export function extractDocuments(html) {
  return TRACKED.map(t => {
    const m = html.match(t.match);
    if (!m) return { ...stripMatch(t), url: '', version: '', found: false };
    const url = m[1].replace(/&amp;/g, '&');
    return { ...stripMatch(t), url, version: versionFromUrl(url), found: true };
  });
}
function stripMatch(t) { const { match, ...rest } = t; return rest; }

async function readPrev() {
  try { return JSON.parse(await readFile(OUT, 'utf8')); } catch { return null; }
}

async function main() {
  let html;
  try {
    const res = await fetch(SOURCE_PAGE, { headers: { 'User-Agent': 'TriibholzRulesBot/1.0 (+playbook)' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    html = await res.text();
  } catch (err) {
    console.error('⚠️  Could not reach Swiss Aquatics:', err.message);
    const prev = await readPrev();
    if (prev) { console.error('Keeping existing data/rules.json (not overwriting).'); process.exit(0); }
    console.error('No existing rules.json and fetch failed — exiting non-zero.');
    process.exit(1);
  }

  const prev = await readPrev();
  const found = extractDocuments(html);
  // for any doc not found this run, fall back to the previously stored entry
  const documents = found.map(d => {
    if (d.found) return d;
    const old = prev?.documents?.find(p => p.id === d.id);
    return old ? { ...old, stale: true } : { ...d };
  }).map(({ found, ...d }) => d);

  const payload = {
    source: { name: 'Swiss Aquatics', page: SOURCE_PAGE },
    checkedAt: new Date().toISOString(),
    documents,
    references: REFERENCES,
    note: 'Official rule books tracked from Swiss Aquatics. Links point to the authoritative documents; rule text is not reproduced here (copyright).',
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(payload, null, 2) + '\n');
  const ok = documents.filter(d => d.url && !d.stale).length;
  console.log(`✅ Wrote ${OUT}\n   ${ok}/${documents.length} tracked documents current · checked ${payload.checkedAt}`);
  documents.forEach(d => console.log(`   • ${d.title}${d.version ? ' ('+d.version+')' : ''}${d.stale ? ' [stale — kept previous]' : ''}`));
}

// run when invoked directly (not when imported by a test)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
