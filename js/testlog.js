/* ============================================================
   testlog.js — a player's own development record.

   Modelled directly on a real club's paper/Excel process (SC Horgen —
   Damen Dolphins, "Project 30" individual test logbook): a player's own
   profile + self-set goal, a dated test-result log measured against
   age-band season targets, a weekly swim log that counts CLUB and
   HOME/self training side by side, and — new here — a weekly home
   programme with a "keep the streak alive" companion (the mascot) so
   home training gets the same visible feedback loop as a pool session.

   Everything here is pure and unit-tested. It knows nothing about the
   DOM or localStorage — js/app.js owns storage and rendering.
   ============================================================ */
const TESTLOG = (() => {
  const clone = o => JSON.parse(JSON.stringify(o));

  /* ---------------- 1) the test catalogue + season targets ----------------
     Four progression tiers, as in the source logbook (their own club's
     season labels — editable text, not load-bearing). Values are the
     exact targets from that logbook. lower=true → a smaller number is
     the better result (times); lower=false → bigger is better (counts,
     distances, percentages). Four field tests and two goalkeeper tests
     are shared with the official Swiss Aquatics PISTE test. */
  const TIERS = ['U14', 'U16', 'U18-A', 'U18-B'];   // generic tier labels; a club can relabel in its own season names
  const FIELD_TESTS = [
    { id: 'free25', label: '25 m freestyle', unit: 's', lower: true, piste: true, targets: [16.0, 15.0, 14.5, 14.0] },
    { id: 'free50', label: '50 m freestyle', unit: 's', lower: true, piste: true, targets: [36.0, 34.0, 32.5, 31.0] },
    { id: 'free100', label: '100 m freestyle', unit: 'min:s', lower: true, piste: true, targets: [82, 76, 72, 69] },   // stored as seconds
    { id: 'swim200', label: '200 m', unit: 'min:s', lower: true, piste: false, targets: [170, 160, 152, 145] },
    { id: 'dropoff8x25', label: '8×25 m drop-off', unit: 's drop', lower: true, piste: false, targets: [2.0, 1.5, 1.2, 1.0] },
    { id: 'passDist', label: 'Passing distance', unit: 'm', lower: false, piste: false, targets: [20, 25, 28, 30] },
    { id: 'ballOverhead', label: 'Ball overhead hold (3 kg)', unit: 's', lower: false, piste: true, targets: [90, 120, 150, 150] },
    { id: 'jumpsCrossbar', label: 'Jumps to the crossbar / 30 s', unit: 'reps', lower: false, piste: false, targets: [14, 20, 24, 30] },
    { id: 'swimPerWeek', label: 'Swimming per week', unit: 'km', lower: false, piste: false, targets: [3.75, 4.25, 4.75, 5] },
  ];
  const GK_TESTS = [
    { id: 'eggbeaterPush', label: 'Push-up height from eggbeater', unit: 'cm vs baseline', lower: false, piste: false, targets: [null, 5, 10, 15] },
    { id: 'sideShuttle', label: 'Side shuttle 4×5 m', unit: 's', lower: true, piste: false, targets: [22, 19, 17, 16] },
    { id: 'lungeSteps', label: 'Lunge steps / 30 s', unit: 'reps', lower: false, piste: false, targets: [12, 16, 20, 24] },
    { id: 'ballOverheadGk', label: 'Ball overhead hold (3 kg)', unit: 's', lower: false, piste: true, targets: [105, 135, 165, 165] },
    { id: 'throwHalfway', label: 'Throw over the halfway line', unit: 'm', lower: false, piste: false, targets: [18, 22, 26, 28] },
    { id: 'catchRate', label: 'Catch / save rate', unit: '% vs baseline', lower: false, piste: false, targets: [null, 10, 15, 20] },
    { id: 'penalty5m', label: 'Penalty 5 m (out of 20)', unit: '/ 20', lower: false, piste: true, targets: [3, 5, 6, 7] },
  ];
  const testsFor = isGK => isGK ? GK_TESTS : FIELD_TESTS;
  const testById = (id, isGK) => testsFor(isGK).find(t => t.id === id) || testsFor(!isGK).find(t => t.id === id);

  /* accepts "37.4", "1:22", "1:22.5" → seconds; passes plain numbers through */
  function parseResultValue(raw) {
    if (typeof raw === 'number') return raw;
    const s = String(raw == null ? '' : raw).trim().replace(',', '.');
    if (!s) return null;
    const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(s);
    if (m) return (+m[1]) * 60 + (+m[2]);
    const n = parseFloat(s.replace(/[^\d.\-]/g, ''));
    return isFinite(n) ? n : null;
  }
  function fmtSeconds(v) {
    if (v == null) return '';
    if (v < 60) return (+v.toFixed(2)).toString();
    const m = Math.floor(v / 60), sec = +(v - m * 60).toFixed(1);
    return `${m}:${sec < 10 ? '0' + sec : sec}`;
  }

  /* evaluate(test, resultRaw, tierIndex) → { value, target, met, deltaText } — null-safe throughout */
  function evaluate(test, resultRaw, tierIndex) {
    if (!test) return null;
    const value = parseResultValue(resultRaw);
    const target = test.targets[Math.max(0, Math.min(test.targets.length - 1, tierIndex || 0))];
    if (value == null) return { value: null, target, met: null, deltaText: 'no result yet' };
    if (target == null) return { value, target: null, met: null, deltaText: 'baseline — no fixed target yet' };
    const met = test.lower ? value <= target : value >= target;
    const diff = test.lower ? (value - target) : (target - value);
    // whole-unit match: 'reps' ends in 's' too, and "6.0s to go" for a rep count is simply wrong
    const unitTxt = (test.unit === 's' || test.unit === 'min:s') ? 's' : (test.unit.split(' ')[0] === '%' ? '%' : '');
    const deltaText = met
      ? `at target${diff !== 0 ? ` (by ${Math.abs(diff).toFixed(1)}${unitTxt})` : ''}`
      : `${Math.abs(diff).toFixed(1)}${unitTxt} to go`;
    return { value, target, met, deltaText };
  }

  /* ---------------- 2) home training — the weekly programme + the mascot ---------------- */
  const HOME_ACTIVITIES = [
    { id: 'wallPassing', label: 'Wall passing', perWeek: 3, minutes: 15, note: 'Right hand, left hand, catch and release in one motion. Beat last week’s count.', showsUpIn: 'Catching under pressure, weak-hand passing, reaction time.' },
    { id: 'mobility', label: 'Stretching / mobility', perWeek: 7, minutes: 10, note: 'Shoulders, hips, ankles, lats — most important the day after a hard session.', showsUpIn: 'Recovery between sessions; reach and rotation in the stroke.' },
    { id: 'shoulderBand', label: 'Shoulder band routine', perWeek: 3, minutes: 10, note: 'External/internal rotation, pull-aparts, Y-T-W.', showsUpIn: 'Staying healthy enough to train every week — the invisible one.' },
    { id: 'bodyweight', label: 'Bodyweight strength', perWeek: 2.5, minutes: 20, note: 'Squats, push-ups, plank, glute bridge, lunges — no equipment.', showsUpIn: 'Eggbeater height, shot power, holding position against a defender.' },
    { id: 'ballFeel', label: 'Ball feel', perWeek: 7, minutes: 5, note: 'One-hand lifts, wrist rolls, ball on fingertips.', showsUpIn: 'One-hand control, fakes, catching a bad pass cleanly.' },
    { id: 'watchPolo', label: 'Watch water polo', perWeek: 1.5, minutes: 25, note: 'Follow one player in your position for a whole quarter — what do they do without the ball?', showsUpIn: 'Knowing where to be before the ball arrives.' },
  ];
  const mondayOf = (d) => { const x = new Date(d); const day = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - day); return x.toISOString().slice(0, 10); };
  const weekKeyOf = (isoDateStr) => mondayOf(new Date(isoDateStr + 'T00:00:00Z'));

  /* weekCompliance(log, weekKey) → 0..1 across all activities that week */
  function weekCompliance(log, weekKey) {
    const inWeek = (log || []).filter(e => e.week === weekKey);
    let got = 0, want = 0;
    HOME_ACTIVITIES.forEach(a => {
      const n = inWeek.filter(e => e.activityId === a.id).length;
      got += Math.min(n, a.perWeek); want += a.perWeek;
    });
    return want ? got / want : 0;
  }
  /* streak: consecutive PAST weeks (most recent first, excluding the current in-progress one) at ≥0.6 compliance */
  function streakWeeks(log, uptoWeekKeyExclusive) {
    let n = 0, wk = uptoWeekKeyExclusive;
    for (let i = 0; i < 52; i++) {
      const prev = mondayOf(new Date(new Date(wk + 'T00:00:00Z').getTime() - 7 * 86400000));
      if (weekCompliance(log, prev) >= 0.6) { n++; wk = prev; } else break;
    }
    return n;
  }
  const MOODS = [
    { id: 'thriving', min: 0.85, label: 'Thriving', line: 'Every session logged — this is what consistency looks like.' },
    { id: 'happy', min: 0.6, label: 'Doing well', line: 'On track this week — keep the small pieces going.' },
    { id: 'okay', min: 0.35, label: 'A bit hungry', line: 'A few sessions missed — pick one today, it doesn’t need to be much.' },
    { id: 'neglected', min: 0, label: 'Neglected', line: 'It’s been quiet. Twenty minutes of wall passing gets it started again.' },
  ];
  function mascotState(log, weekKey) {
    const compliance = weekCompliance(log, weekKey);
    const mood = MOODS.find(m => compliance >= m.min) || MOODS[MOODS.length - 1];
    const streak = streakWeeks(log, weekKey);
    return { compliance: +compliance.toFixed(2), mood: mood.id, moodLabel: mood.label, line: mood.line, streak };
  }

  /* ---------------- 3) CSV — the round-trip format for the club's own workflow ---------------- */
  function toCSV(rows, cols) {
    const esc = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return [cols.map(c => esc(c.label || c.key)).join(',')].concat(rows.map(r => cols.map(c => esc(r[c.key])).join(','))).join('\r\n');
  }
  function parseCSV(text) {
    const rows = []; let row = [], field = '', inQ = false;
    const s = String(text || '').replace(/^﻿/, '');
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inQ) { if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
      else if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(f => String(f).trim() !== ''));
  }
  // English labels are the app's own; the `syn` lists are what real club workbooks already use
  // (this reader was built and verified against a real German test-logbook) — matching either
  // means a coach's existing spreadsheet imports with no relabelling.
  const TEST_COLS = [
    { key: 'date', label: 'Date', syn: ['datum'] }, { key: 'name', label: 'Name', syn: ['name', 'spielerin'] },
    { key: 'test', label: 'Test', syn: ['test'] }, { key: 'result', label: 'Result', syn: ['resultat', 'ergebnis'] },
    { key: 'unit', label: 'Unit', syn: ['einheit'] }, { key: 'testedBy', label: 'Tested by', syn: ['getestet von', 'getestet'] },
    { key: 'remark', label: 'Remark', syn: ['bemerkung', 'notiz'] },
  ];
  const SWIM_COLS = [
    { key: 'week', label: 'Week (Monday)', syn: ['woche (datum montag)', 'woche'] }, { key: 'name', label: 'Name', syn: ['name', 'spielerin'] },
    { key: 'metersClub', label: 'Metres club', syn: ['meter verein'] }, { key: 'metersSelf', label: 'Metres self / home', syn: ['meter schwimmclub / selbst', 'meter selbst'] },
    { key: 'total', label: 'Total', syn: ['total'] }, { key: 'attended', label: 'Sessions attended', syn: ['trainings besucht'] },
    { key: 'possible', label: 'Sessions possible', syn: ['von möglich', 'moeglich', 'möglich'] },
  ];
  const headerMatches = (h, c) => h === c.label.toLowerCase() || h === c.key.toLowerCase() || (c.syn || []).includes(h);
  function rowsFromCSV(rows, cols) {
    if (!rows.length) return [];
    const header = rows[0].map(h => String(h).trim().toLowerCase());
    const idx = cols.map(c => header.findIndex(h => headerMatches(h, c)));
    return rows.slice(1).map(r => { const o = {}; cols.forEach((c, i) => { if (idx[i] >= 0) o[c.key] = r[idx[i]]; }); return o; }).filter(o => Object.values(o).some(v => v != null && v !== ''));
  }

  /* ---------------- 4) a minimal, honest XLSX reader ----------------
     Reads the sheets a real Excel workbook exports: a ZIP central
     directory (no external library — this file format is documented
     and small enough to parse by hand), DEFLATE via the platform's own
     DecompressionStream, and the handful of OOXML tags a data sheet
     actually uses. It reads; it does not write — exporting stays CSV,
     which every spreadsheet app already opens and saves natively. */
  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const w = ds.writable.getWriter(); w.write(bytes); w.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  }
  function readUint32LE(b, o) { return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] * 0x1000000); }
  function readUint16LE(b, o) { return b[o] | (b[o + 1] << 8); }
  /* the ZIP entries, by walking the End Of Central Directory backward from the file's tail */
  function zipEntries(bytes) {
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65557); i--) { if (readUint32LE(bytes, i) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) throw Object.assign(new Error('not-a-zip'), { code: 'not-a-zip' });
    const count = readUint16LE(bytes, eocd + 10), cdOff = readUint32LE(bytes, eocd + 16);
    const entries = []; let p = cdOff;
    for (let i = 0; i < count; i++) {
      if (readUint32LE(bytes, p) !== 0x02014b50) break;
      const method = readUint16LE(bytes, p + 10), compSize = readUint32LE(bytes, p + 20), nameLen = readUint16LE(bytes, p + 28), extraLen = readUint16LE(bytes, p + 30), commentLen = readUint16LE(bytes, p + 32), lho = readUint32LE(bytes, p + 42);
      const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
      entries.push({ name, method, compSize, lho });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }
  async function zipRead(bytes, entry) {
    const p = entry.lho, nameLen = readUint16LE(bytes, p + 26), extraLen = readUint16LE(bytes, p + 28);
    const dataStart = p + 30 + nameLen + extraLen, data = bytes.subarray(dataStart, dataStart + entry.compSize);
    if (entry.method === 0) return data;               // stored, no compression
    if (entry.method === 8) return inflateRaw(data);    // deflate
    throw Object.assign(new Error('unsupported-compression'), { code: 'xlsx-unsupported' });
  }
  function xmlUnescape(s) { return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&'); }
  function parseSharedStrings(xml) {
    if (!xml) return [];
    const out = [];
    const items = xml.split(/<si[ >]/).slice(1);
    items.forEach(chunk => { const texts = [...chunk.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => xmlUnescape(m[1])); out.push(texts.join('')); });
    return out;
  }
  const colToIndex = (ref) => { const m = /^([A-Z]+)/.exec(ref); if (!m) return 0; let n = 0; for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
  function parseSheet(xml, shared) {
    const rows = [];
    const rowChunks = xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || [];
    rowChunks.forEach(rc => {
      const cells = [...rc.matchAll(/<c([^>]*)>([\s\S]*?)<\/c>|<c([^>]*)\/>/g)];
      const row = [];
      cells.forEach(m => {
        const attrs = m[1] || m[3] || '', body = m[2] || '';
        const ref = (/r="([A-Z]+\d+)"/.exec(attrs) || [])[1]; const ci = ref ? colToIndex(ref) : row.length;
        const type = (/t="([^"]+)"/.exec(attrs) || [])[1];
        let v = (/<v>([\s\S]*?)<\/v>/.exec(body) || [])[1];
        if (type === 's' && v != null) v = shared[+v];
        else if (type === 'inlineStr') v = xmlUnescape((/<t[^>]*>([\s\S]*?)<\/t>/.exec(body) || [, ''])[1]);
        else if (v != null) v = xmlUnescape(v);
        while (row.length < ci) row.push(null);
        row[ci] = v == null ? null : v;
      });
      rows.push(row);
    });
    return rows;
  }
  /* readXLSX(bytes) → { sheets: { 'Sheet Name': rows[][] } } — never throws on a well-formed workbook;
     throws a tagged error (code) on anything this reader genuinely can't handle. */
  async function readXLSX(bytes) {
    bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const entries = zipEntries(bytes);
    const byName = {}; entries.forEach(e => byName[e.name] = e);
    if (!byName['xl/workbook.xml']) throw Object.assign(new Error('not-an-xlsx'), { code: 'not-an-xlsx' });
    const dec = new TextDecoder();
    const workbookXml = dec.decode(await zipRead(bytes, byName['xl/workbook.xml']));
    const sheetDefs = [...workbookXml.matchAll(/<sheet [^>]*name="([^"]*)"[^>]*sheetId="(\d+)"[^>]*r:id="(rId\d+)"/g)];
    const relsXml = byName['xl/_rels/workbook.xml.rels'] ? dec.decode(await zipRead(bytes, byName['xl/_rels/workbook.xml.rels'])) : '';
    const relById = {}; [...relsXml.matchAll(/<Relationship [^>]*Id="(rId\d+)"[^>]*Target="([^"]*)"/g)].forEach(m => relById[m[1]] = m[2]);
    let shared = [];
    if (byName['xl/sharedStrings.xml']) shared = parseSharedStrings(dec.decode(await zipRead(bytes, byName['xl/sharedStrings.xml'])));
    const sheets = {};
    for (const m of sheetDefs) {
      const name = xmlUnescape(m[1]), rid = m[3];
      const target = (relById[rid] || '').replace(/^\//, '');
      const path = 'xl/' + target.replace(/^xl\//, '');
      const entry = byName[path] || byName['xl/worksheets/' + (target.split('/').pop() || '')];
      if (!entry) continue;
      sheets[name] = parseSheet(dec.decode(await zipRead(bytes, entry)), shared);
    }
    return { sheets };
  }
  /* map raw sheet rows (as read from THIS club's exact template) into our row objects, tolerant of a
     header row in any position and of extra/missing trailing columns. */
  function rowsFromSheetTable(rows, cols) {
    if (!rows || !rows.length) return [];
    let headerAt = -1;
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      const line = (rows[i] || []).map(v => String(v || '').trim().toLowerCase());
      if (cols.some(c => line.some(h => headerMatches(h, c)))) { headerAt = i; break; }
    }
    if (headerAt < 0) return [];
    const header = rows[headerAt].map(v => String(v || '').trim().toLowerCase());
    const idx = cols.map(c => header.findIndex(h => headerMatches(h, c)));
    return rows.slice(headerAt + 1).map(r => { const o = {}; cols.forEach((c, i) => { if (idx[i] >= 0 && r) o[c.key] = r[idx[i]]; }); return o; })
      .filter(o => Object.values(o).some(v => v != null && String(v).trim() !== ''));
  }

  return {
    TIERS, FIELD_TESTS, GK_TESTS, testsFor, testById, parseResultValue, fmtSeconds, evaluate,
    HOME_ACTIVITIES, mondayOf, weekKeyOf, weekCompliance, streakWeeks, MOODS, mascotState,
    toCSV, parseCSV, TEST_COLS, SWIM_COLS, rowsFromCSV, rowsFromSheetTable,
    readXLSX, zipEntries,
  };
})();

// Node/CommonJS interop (no-op in the browser)
if (typeof module !== "undefined" && module.exports) module.exports = TESTLOG;
