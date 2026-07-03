#!/usr/bin/env node
/* ============================================================
   update-rules.mjs — keep the official water polo rule books in
   sync with World Aquatics (primary) and Swiss Aquatics.

   Sources:
   1) worldaquatics.com/rules/competition-regulations — the omnibus
      Competition Regulations PDF (water polo = Part Six) and the
      Water Polo 4x4 supplement, hosted on resources.fina.org.
   2) Swiss Aquatics water-polo downloads — the Swiss competition
      regulations (5.1 / 5.1.1) and their hosted WA water-polo extract.

   Writes data/rules.json with each document's title, URL and
   version/date. We DO NOT copy the rule text (it is copyrighted) —
   we track and link the official documents and record when checked.

   Run:  node scripts/update-rules.mjs
   CI:   .github/workflows/update-rules.yml (weekly + manual)
   ============================================================ */
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'data', 'rules.json');

const SOURCE_WA    = 'https://www.worldaquatics.com/rules/competition-regulations';
const SOURCE_SWISS = 'https://www.swiss-aquatics.ch/leistungssport/water-polo/wettkampfbetrieb/downloads-medien/';

/* ---- Swiss Aquatics: documents found by filename pattern ---- */
const TRACKED_SWISS = [
  { id: 'aqua-water-polo-rules', title: 'World Aquatics Water Polo Rules (Swiss-hosted extract)', lang: 'EN',
    category: 'International playing rules',
    match: /href="([^"]*Water-Polo-Rules[^"]*\.pdf)"/i },
  { id: 'swiss-reglement-5-1', title: 'Swiss Aquatics — Reglement 5.1', lang: 'DE',
    category: 'Swiss competition regulation',
    match: /href="([^"]*Reglement_5_1_D[^"]*\.pdf)"/i },
  { id: 'swiss-reglement-5-1-1', title: 'Swiss Aquatics — Reglement 5.1.1', lang: 'DE',
    category: 'Swiss competition regulation',
    match: /href="([^"]*Reglement_5_1_1_D[^"]*\.pdf)"/i },
];

/* ---- World Aquatics: anchors found by link TEXT (layout-proof) ---- */
const TRACKED_WA = [
  { id: 'wa-competition-regulations',
    title: 'World Aquatics Competition Regulations (Water Polo = Part Six)', lang: 'EN',
    category: 'International rules — primary source',
    text: /Competition\s+Regulations\s+Version/i },
  { id: 'wa-water-polo-4x4',
    title: 'World Aquatics — Water Polo 4x4 (superseding rules, Appendix 9)', lang: 'EN',
    category: 'International rules — 4x4 format',
    text: /Water\s*Polo\s*4\s*x\s*4/i },
];

// authoritative landing pages (always valid)
const REFERENCES = [
  { title: 'World Aquatics — Competition Regulations', url: SOURCE_WA },
  { title: 'Swiss Aquatics — Water Polo downloads & regulations', url: SOURCE_SWISS },
  { title: 'European Aquatics — Water Polo Rules', url: 'https://europeanaquatics.org/sports/water-polo/water-polo-rules/' },
];

/* version/date out of a URL or link text:
   2026-02-18_World-Aquatics_CR-Final.pdf → 2026-02-18
   Water-Polo-Rules_06.25.pdf             → 06.25
   ..._30.04.2026.pdf                     → 30.04.2026 */
function versionFrom(url, text = '') {
  const name = decodeURIComponent((url || '').split('/').pop() || '');
  const iso  = name.match(/((?:19|20)\d{2}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const full = name.match(/(\d{2}\.\d{2}\.\d{4})/);
  if (full) return full[1];
  const ver = name.match(/_(\d{2}\.\d{2})(?=[._-]|\.pdf)/i);
  if (ver) return ver[1];
  const t = text.match(/updated\s*([\d.]+)/i);
  if (t) return t[1];
  const yr = name.match(/((?:19|20)\d{2})/);
  return yr ? yr[1] : '';
}

/* Swiss extraction: filename-pattern based */
export function extractDocuments(html) {
  return TRACKED_SWISS.map(t => {
    const m = html.match(t.match);
    if (!m) return { ...strip(t), url: '', version: '', found: false };
    const url = m[1].replace(/&amp;/g, '&');
    return { ...strip(t), url, version: versionFrom(url), found: true };
  });
}

/* World Aquatics extraction: anchor-text based */
export function extractWorldAquatics(html) {
  const anchors = [...html.matchAll(/<a\b[^>]*href="([^"]+\.pdf[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map(m => ({ url: m[1].replace(/&amp;/g, '&'), text: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }));
  return TRACKED_WA.map(t => {
    const hit = anchors.find(a => t.text.test(a.text));
    if (!hit) return { ...strip(t), url: '', version: '', found: false };
    return { ...strip(t), url: hit.url, version: versionFrom(hit.url, hit.text), edition: hit.text, found: true };
  });
}
function strip(t) { const { match, text, ...rest } = t; return rest; }

async function readPrev() {
  try { return JSON.parse(await readFile(OUT, 'utf8')); } catch { return null; }
}
async function fetchPage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'TriibholzRulesBot/1.1 (+playbook)' } });
  if (!res.ok) throw new Error(url + ' → HTTP ' + res.status);
  return res.text();
}

async function main() {
  const prev = await readPrev();
  let waDocs = [], swissDocs = [];
  let waOk = false, swissOk = false;

  try { waDocs = extractWorldAquatics(await fetchPage(SOURCE_WA)); waOk = true; }
  catch (e) { console.error('⚠️  World Aquatics unreachable:', e.message); }
  try { swissDocs = extractDocuments(await fetchPage(SOURCE_SWISS)); swissOk = true; }
  catch (e) { console.error('⚠️  Swiss Aquatics unreachable:', e.message); }

  if (!waOk && !swissOk) {
    if (prev) { console.error('Both sources failed — keeping existing data/rules.json.'); process.exit(0); }
    console.error('Both sources failed and no existing rules.json — exiting non-zero.');
    process.exit(1);
  }

  // per-document fallback to the previously stored entry
  const merge = (docs) => docs.map(d => {
    if (d.found) { const { found, ...rest } = d; return rest; }
    const old = prev?.documents?.find(p => p.id === d.id);
    if (old) return { ...old, stale: true };
    const { found, ...rest } = d; return rest;
  });

  const payload = {
    sources: [
      { name: 'World Aquatics', page: SOURCE_WA, ok: waOk },
      { name: 'Swiss Aquatics', page: SOURCE_SWISS, ok: swissOk },
    ],
    // kept for backwards compatibility with older app builds
    source: { name: 'World Aquatics', page: SOURCE_WA },
    checkedAt: new Date().toISOString(),
    documents: [...merge(waDocs), ...merge(swissDocs)],
    references: REFERENCES,
    note: 'Official rule books tracked from World Aquatics (primary) and Swiss Aquatics. Links point to the authoritative documents; rule text is not reproduced here (copyright).',
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(payload, null, 2) + '\n');
  const ok = payload.documents.filter(d => d.url && !d.stale).length;
  console.log(`✅ Wrote ${OUT}\n   ${ok}/${payload.documents.length} tracked documents current · checked ${payload.checkedAt}`);
  payload.documents.forEach(d => console.log(`   • ${d.title}${d.version ? ' ('+d.version+')' : ''}${d.stale ? ' [stale — kept previous]' : ''}`));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
