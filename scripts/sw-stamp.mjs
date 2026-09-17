/* Stamp sw.js with a digest of everything it precaches.
 *
 *   node scripts/sw-stamp.mjs            rewrite the stamp
 *   node scripts/sw-stamp.mjs --check    fail if it is stale (this is a gate)
 *
 * WHY THIS EXISTS. The cache name is what makes an installed app take an update: a service worker
 * only refills its cache when the name changes. Bumping it by hand is a rule nobody can keep —
 * this project shipped a whole session of work behind a stale container once, and then shipped new
 * icons against an unchanged `triibholz-v86`, which would have left every installed app holding
 * the previous art forever. Neither failure showed up as an error anywhere.
 *
 * So the version stops being a decision. ASSET_STAMP is a digest of the bytes of every file in
 * ASSETS; change any one of them and the stamp changes, the cache name changes with it, and the
 * update lands. Forget to re-stamp and the gate fails with the command to run.
 *
 * The hand-written vNN stays in front of it, for reading a cache name in devtools and knowing
 * roughly which release it is.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SW = join(ROOT, 'sw.js');

export function stampFor(src) {
  const block = src.match(/const ASSETS = \[([\s\S]*?)\];/);
  if (!block) throw new Error('sw.js: could not find the ASSETS list');
  const assets = [...block[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  const h = createHash('sha256');
  for (const a of assets.slice().sort()) {
    // './' is the shell; hashing it twice is harmless, missing it would not be
    const rel = a.replace(/^\.\//, '') || 'index.html';
    h.update(rel + '\0');
    h.update(readFileSync(join(ROOT, rel === '' ? 'index.html' : rel)));
    h.update('\0');
  }
  return h.digest('hex').slice(0, 12);
}

export function currentStamp() {
  const src = readFileSync(SW, 'utf8');
  return { src, want: stampFor(src), found: (src.match(/const ASSET_STAMP = '([0-9a-f]*)'/) || [])[1] };
}

// only when run directly — tests/smoke.mjs imports stampFor() and must not trip the exit code
if (process.argv[1] && process.argv[1].endsWith('sw-stamp.mjs')) main();

function main() {
const { src, want, found } = currentStamp();
if (found === want) {
  console.log(`sw.js stamp is current: ${want}`);
} else if (process.argv.includes('--check')) {
  console.error(`sw.js ASSET_STAMP is stale: has ${found || '(empty)'}, precached files hash to ${want}`);
  console.error('  a precached asset changed without the cache name changing, so installed apps');
  console.error('  would keep the old copy. Run:  node scripts/sw-stamp.mjs');
  process.exit(1);
} else {
  if (found === undefined) throw new Error("sw.js: no ASSET_STAMP line to rewrite");
  writeFileSync(SW, src.replace(/const ASSET_STAMP = '[0-9a-f]*'/, `const ASSET_STAMP = '${want}'`));
  console.log(`sw.js stamped: ${found} -> ${want}`);
}
}
