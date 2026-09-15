/* ============================================================
   sheetdoc.js — a team sheet as a real document: .docx, .pdf, HTML.

   One layout MODEL, three renderers. The model knows nothing about
   players or leagues (teamsheet.js builds it); the renderers know
   nothing about water polo. That split is what lets a coach design
   their own template once and get a Word file, a PDF and an on-screen
   preview that all agree.

   Zero dependencies, on purpose — same reason testlog.js hand-rolls
   its XLSX reader. So both formats are written from first principles:

   · .docx is a ZIP of WordprocessingML. zip() writes the container
     (STORE method, CRC-32) and toDocx() the XML. Word, Pages and
     LibreOffice all open a stored (uncompressed) ZIP.
   · .pdf uses the four standard Helvetica faces with WinAnsiEncoding,
     so nothing is embedded and a sheet is a few kB. The price is the
     character set: WinAnsi covers every Latin-1 name (Füssinger,
     Müller, Gonçalves) but NOT Ł, Đ or ı. Those are transliterated and
     REPORTED back in `substituted`, so the UI can tell the coach to use
     the Word file when a name must be spelled exactly. Silently
     printing "?" on an official form is the failure this avoids.

   The Helvetica widths below are the Adobe AFM metrics, measured from
   the system font (space 278, A 667, W 944) — used to shrink, then
   truncate, anything that will not fit its column. Truncation is
   reported too.

   Deterministic: identical input → identical bytes (fixed ZIP date,
   no PDF timestamp), which is what makes both writers testable.

   The MODEL:
   {
     title: 'OFFIZIELLE SPIELAUFSTELLUNG',
     blocks: [
       { type:'fields', split:0.3, rows:[{ label:['Verein','Club'], value:'…' }] },
       { type:'roster', columns:[{ label:['Lizenznummer','No de Licence'], w:0.22 }, …],
                        rows:[['1','12345','Muster','Anna'], …] },
       { type:'signatures', rows:[{ label:['Coach/Trainer','Coach/entraîneur'], value:'…',
                                    sign:['Unterschrift','Signature'] }] },
       { type:'note', lines:[{ lead:'Wichtig:', text:'…' }, { lead:'Important:', text:'…', italic:true }] },
     ]
   }
   A label is [primary, secondary]: the primary line bold, the secondary
   bold-italic and grey — the two-language look of the official form.
   ============================================================ */
const SHEETDOC = (() => {

  /* ---------------------------------------------------------------- ZIP */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  const utf8 = s => new TextEncoder().encode(s);
  function concat(parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  /* zip([{ name, data }]) → Uint8Array. STORE only: nothing here is big enough for
     compression to matter, and it keeps the writer small enough to trust. */
  function zip(entries) {
    const DOS_TIME = 0, DOS_DATE = ((2024 - 1980) << 9) | (1 << 5) | 1;    // fixed → reproducible bytes
    const UTF8_NAMES = 0x0800;
    const local = [], central = [];
    let offset = 0;
    for (const e of entries) {
      const name = utf8(e.name);
      const data = typeof e.data === 'string' ? utf8(e.data) : e.data;
      const crc = crc32(data);

      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true); lh.setUint16(6, UTF8_NAMES, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, DOS_TIME, true); lh.setUint16(12, DOS_DATE, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      local.push(new Uint8Array(lh.buffer), name, data);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, UTF8_NAMES, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, DOS_TIME, true); ch.setUint16(14, DOS_DATE, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true);          // extra, comment, disk, attrs all zero
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);

      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((n, p) => n + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return concat([...local, ...central, new Uint8Array(end.buffer)]);
  }

  /* --------------------------------------------------------------- DOCX */
  const xml = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const TW_PAGE_W = 11906, TW_PAGE_H = 16838, TW_MARGIN = 1134;       // A4, 2 cm margins (twips)
  const TW_BODY = TW_PAGE_W - 2 * TW_MARGIN;
  const FONT = 'Verdana';                                              // the official form's face
  const GREY = '555555', RED = 'E4002B';

  const run = (text, o = {}) => `<w:r><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/>` +
    (o.bold ? '<w:b/>' : '') + (o.italic ? '<w:i/>' : '') + (o.color ? `<w:color w:val="${o.color}"/>` : '') +
    `<w:sz w:val="${o.sz || 20}"/></w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
  const para = (runs, o = {}) => `<w:p><w:pPr><w:spacing w:before="${o.before || 0}" w:after="${o.after || 0}"/>` +
    (o.align ? `<w:jc w:val="${o.align}"/>` : '') + `</w:pPr>${runs}</w:p>`;

  /* A two-language label: bold primary, a line break, bold-italic grey secondary. */
  const labelRuns = label => {
    const [a, b] = Array.isArray(label) ? label : [label, ''];
    return run(a, { bold: true }) + (b ? '<w:r><w:br/></w:r>' + run(b, { bold: true, italic: true, color: GREY }) : '');
  };
  const cell = (width, inner, o = {}) =>
    `<w:tc><w:tcPr><w:tcW w:w="${Math.round(width)}" w:type="dxa"/>${o.vAlign ? `<w:vAlign w:val="${o.vAlign}"/>` : ''}</w:tcPr>${inner}</w:tc>`;
  const BORDERS = '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map(s => `<w:${s} w:val="single" w:sz="6" w:space="0" w:color="000000"/>`).join('') + '</w:tblBorders>';
  const table = (widths, rowsXml) =>
    `<w:tbl><w:tblPr><w:tblW w:w="${TW_BODY}" w:type="dxa"/>${BORDERS}<w:tblLayout w:type="fixed"/>` +
    `<w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
    `<w:tblGrid>${widths.map(w => `<w:gridCol w:w="${Math.round(w)}"/>`).join('')}</w:tblGrid>${rowsXml}</w:tbl>`;
  const tr = (cells, heightTw) => `<w:tr>${heightTw ? `<w:trPr><w:trHeight w:val="${heightTw}" w:hRule="atLeast"/></w:trPr>` : ''}${cells}</w:tr>`;

  function docxBlock(b) {
    if (b.type === 'fields') {
      const w1 = TW_BODY * (b.split || 0.3), w2 = TW_BODY - w1;
      return table([w1, w2], b.rows.map(r => tr(
        cell(w1, para(labelRuns(r.label))) + cell(w2, para(run(r.value))), 520)).join(''));
    }
    if (b.type === 'roster') {
      const ws = b.columns.map(c => TW_BODY * c.w);
      const head = tr(b.columns.map((c, i) => cell(ws[i], para(labelRuns(c.label)))).join(''), 520);
      const body = b.rows.map(r => tr(r.map((v, i) => cell(ws[i], para(run(v)))).join(''), 340)).join('');
      return table(ws, head + body);
    }
    if (b.type === 'signatures') {
      const ws = [TW_BODY * 0.24, TW_BODY * 0.3, TW_BODY * 0.46];
      return table(ws, b.rows.map(r => tr(
        cell(ws[0], para(labelRuns(r.label)), { vAlign: 'top' }) +
        cell(ws[1], para(run(r.value)), { vAlign: 'top' }) +
        cell(ws[2], para(labelRuns(r.sign || ['', ''])), { vAlign: 'top' }), 820)).join(''));
    }
    if (b.type === 'note') {
      return b.lines.map(l => para(
        run(l.lead + ' ', { bold: true, italic: !!l.italic, color: RED, sz: 22 }) +
        run(l.text, { bold: true, italic: !!l.italic, sz: 22 }))).join('');
    }
    return '';
  }

  function toDocx(model) {
    const gap = para('', { after: 280 });
    const body = para(run(model.title || '', { bold: true, sz: 26 }), { after: 240 }) +
      (model.blocks || []).map(docxBlock).join(gap) +
      `<w:sectPr><w:pgSz w:w="${TW_PAGE_W}" w:h="${TW_PAGE_H}"/>` +
      `<w:pgMar w:top="${TW_MARGIN}" w:right="${TW_MARGIN}" w:bottom="${TW_MARGIN}" w:left="${TW_MARGIN}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`;
    const doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body>${body}</w:body></w:document>`;
    return zip([
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
        '</Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
        '</Relationships>' },
      { name: 'docProps/core.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
        'xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>' + xml(model.docTitle || model.title || '') + '</dc:title>' +
        '<dc:creator>Triibholz</dc:creator></cp:coreProperties>' },
      { name: 'word/document.xml', data: doc },
    ]);
  }

  /* ---------------------------------------------------------------- PDF */
  // Adobe Helvetica AFM widths for WinAnsi codes 32..255 (index = code - 32).
  const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,634,744,0,222,556,333,1000,556,556,333,1000,667,333,1000,0,611,0,0,222,222,333,333,350,556,1000,333,1000,500,333,944,0,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,549,333,333,333,576,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,549,611,556,556,556,556,500,556,500];
  const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,722,744,0,278,556,500,1000,556,556,333,1000,667,333,1000,0,611,0,0,278,278,500,500,350,556,1000,333,1000,556,333,944,0,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,549,333,333,333,576,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,549,611,611,611,611,611,556,611,556];

  // WinAnsiEncoding bytes 128–159 are not Latin-1; everything else from 160 up is.
  const WIN_SPECIAL = { 0x20AC:128, 0x201A:130, 0x0192:131, 0x201E:132, 0x2026:133, 0x2020:134, 0x2021:135,
    0x02C6:136, 0x2030:137, 0x0160:138, 0x2039:139, 0x0152:140, 0x017D:142, 0x2018:145, 0x2019:146,
    0x201C:147, 0x201D:148, 0x2022:149, 0x2013:150, 0x2014:151, 0x02DC:152, 0x2122:153, 0x0161:154,
    0x203A:155, 0x0153:156, 0x017E:158, 0x0178:159 };
  // Letters with no Unicode decomposition to a Latin base, so NFD cannot rescue them.
  const NO_DECOMP = { 'Ł':'L', 'ł':'l', 'Đ':'D', 'đ':'d', 'ı':'i', 'Ħ':'H', 'ħ':'h', 'Ŧ':'T', 'ŧ':'t', 'ŋ':'n', 'Ŋ':'N' };

  /* Encode to WinAnsi. Anything outside it is transliterated (Č→C, Ł→L) and pushed onto
     `subs` — never dropped silently. Returns a string of char codes 0..255. */
  function winAnsi(str, subs) {
    let out = '';
    for (const ch of String(str == null ? '' : str).normalize('NFC')) {
      const cp = ch.codePointAt(0);
      if ((cp >= 32 && cp < 127) || (cp >= 160 && cp <= 255)) { out += String.fromCharCode(cp); continue; }
      if (WIN_SPECIAL[cp]) { out += String.fromCharCode(WIN_SPECIAL[cp]); continue; }
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      const fb = NO_DECOMP[ch] || (base.length === 1 && base.charCodeAt(0) < 127 ? base : '?');
      if (subs) subs.push({ from: ch, to: fb });
      out += fb;
    }
    return out;
  }
  const widthOf = (s, bold, size) => {
    const tbl = bold ? W_BOLD : W_REG;
    let w = 0;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); w += (c >= 32 && c <= 255 ? tbl[c - 32] : 556) || 556; }
    return w * size / 1000;
  };
  /* Shrink to a floor of 7pt, then cut with an ellipsis. Reports whether it had to cut. */
  function fit(s, bold, size, maxW) {
    let sz = size;
    while (sz > 7 && widthOf(s, bold, sz) > maxW) sz -= 0.5;
    if (widthOf(s, bold, sz) <= maxW) return { text: s, size: sz, cut: false };
    const ELL = '\x85';
    let t = s;
    while (t.length && widthOf(t + ELL, bold, sz) > maxW) t = t.slice(0, -1);
    return { text: t + ELL, size: sz, cut: true };
  }
  const pdfStr = s => '(' + s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)') + ')';
  const n2 = v => (Math.round(v * 100) / 100).toString();

  function toPdf(model) {
    const PW = 595.28, PH = 841.89, ML = 51, MR = 51, MT = 60, MB = 50, BODY = PW - ML - MR;
    const subs = [], cuts = [];
    const pages = [];
    let ops = [], y = PH - MT;
    const newPage = () => { if (ops.length) pages.push(ops); ops = []; y = PH - MT; };
    const ensure = h => { if (y - h < MB) newPage(); };

    const F = { reg: 'F1', bold: 'F2', ital: 'F3', boldItal: 'F4' };
    const text = (x, yy, s, font, size, color) => {
      const enc = winAnsi(s, subs);
      ops.push(`BT ${color || '0 g'} /${font} ${n2(size)} Tf ${n2(x)} ${n2(yy)} Td ${pdfStr(enc)} Tj ET`);
    };
    const textFit = (x, yy, s, font, size, maxW, color, where) => {
      const enc = winAnsi(s, subs);
      const f = fit(enc, font === F.bold || font === F.boldItal, size, maxW);
      if (f.cut) cuts.push({ text: String(s), where });
      ops.push(`BT ${color || '0 g'} /${font} ${n2(f.size)} Tf ${n2(x)} ${n2(yy)} Td ${pdfStr(f.text)} Tj ET`);
    };
    const rect = (x, yy, w, h) => ops.push(`${n2(x)} ${n2(yy)} ${n2(w)} ${n2(h)} re S`);
    const label = (x, top, lab, maxW, size) => {
      const [a, b] = Array.isArray(lab) ? lab : [lab, ''];
      textFit(x, top - size - 2, a, F.bold, size, maxW, '0 g', 'label');
      if (b) textFit(x, top - 2 * size - 4, b, F.boldItal, size, maxW, '0.33 g', 'label');
    };
    const PAD = 5, SZ = 9.5;

    ops.push('0.6 w 0 G');
    if (model.title) { text(ML, y - 14, model.title, F.bold, 14); y -= 38; }

    for (const b of model.blocks || []) {
      if (b.type === 'fields') {
        const w1 = BODY * (b.split || 0.3), RH = 30;
        for (const r of b.rows) {
          ensure(RH);
          rect(ML, y - RH, w1, RH); rect(ML + w1, y - RH, BODY - w1, RH);
          label(ML + PAD, y, r.label, w1 - 2 * PAD, SZ);
          textFit(ML + w1 + PAD, y - SZ - 2, r.value || '', F.reg, SZ + 0.5, BODY - w1 - 2 * PAD, '0 g', 'field');
          y -= RH;
        }
      } else if (b.type === 'roster') {
        const ws = b.columns.map(c => BODY * c.w), HH = 30, RH = 18;
        const drawHead = () => {
          let x = ML;
          b.columns.forEach((c, i) => { rect(x, y - HH, ws[i], HH); label(x + PAD, y, c.label, ws[i] - 2 * PAD, SZ); x += ws[i]; });
          y -= HH;
        };
        ensure(HH + RH); drawHead();
        for (const row of b.rows) {
          if (y - RH < MB) { newPage(); ops.push('0.6 w 0 G'); drawHead(); }     // the header repeats on a new page
          let x = ML;
          row.forEach((v, i) => {
            rect(x, y - RH, ws[i], RH);
            textFit(x + PAD, y - RH + 5, String(v == null ? '' : v), F.reg, SZ + 0.5, ws[i] - 2 * PAD, '0 g', 'roster');
            x += ws[i];
          });
          y -= RH;
        }
      } else if (b.type === 'signatures') {
        const ws = [BODY * 0.24, BODY * 0.3, BODY * 0.46], RH = 44;
        for (const r of b.rows) {
          ensure(RH);
          let x = ML;
          ws.forEach(w => { rect(x, y - RH, w, RH); x += w; });
          label(ML + PAD, y, r.label, ws[0] - 2 * PAD, SZ);
          textFit(ML + ws[0] + PAD, y - SZ - 2, r.value || '', F.reg, SZ + 0.5, ws[1] - 2 * PAD, '0 g', 'signature');
          label(ML + ws[0] + ws[1] + PAD, y, r.sign || ['', ''], ws[2] - 2 * PAD, SZ);
          y -= RH;
        }
      } else if (b.type === 'note') {
        ensure(b.lines.length * 16 + 10);
        for (const l of b.lines) {
          const leadFont = l.italic ? F.boldItal : F.bold;
          const leadEnc = winAnsi(l.lead + ' ', subs);
          const leadW = widthOf(leadEnc, true, 10);
          text(ML, y - 10, l.lead + ' ', leadFont, 10, '0.894 0 0.169 rg');
          textFit(ML + leadW, y - 10, l.text, leadFont, 10, BODY - leadW, '0 g', 'note');
          y -= 15;
        }
      }
      y -= 22;                                                            // gap between blocks
    }
    newPage();

    // ---- serialise. Everything is built as Latin-1 so the WinAnsi bytes survive intact.
    const objs = [];
    const add = s => { objs.push(s); return objs.length; };
    const catalog = add(null), pagesId = add(null);
    const fontIds = ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique']
      .map(f => add(`<< /Type /Font /Subtype /Type1 /BaseFont /${f} /Encoding /WinAnsiEncoding >>`));
    const res = `<< /Font << /F1 ${fontIds[0]} 0 R /F2 ${fontIds[1]} 0 R /F3 ${fontIds[2]} 0 R /F4 ${fontIds[3]} 0 R >> >>`;
    const pageIds = pages.map(p => {
      const stream = p.join('\n');
      const contentId = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      return add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources ${res} /Contents ${contentId} 0 R >>`);
    });
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(i => i + ' 0 R').join(' ')}] /Count ${pageIds.length} >>`;
    /* The Info dictionary is NOT WinAnsi — PDF reads it as PDFDocEncoding, where byte 150
       (WinAnsi's en dash) is "Œ". A title like "Club – U14" came out "Club Œ U14" in every
       viewer's document properties. UTF-16BE with a BOM is unambiguous and takes any name. */
    const utf16Hex = s => {
      let h = 'FEFF';
      for (const ch of String(s)) {
        const cp = ch.codePointAt(0);
        const units = cp > 0xFFFF ? [0xD800 + ((cp - 0x10000) >> 10), 0xDC00 + ((cp - 0x10000) & 0x3FF)] : [cp];
        units.forEach(u => { h += u.toString(16).toUpperCase().padStart(4, '0'); });
      }
      return '<' + h + '>';
    };
    const infoId = add(`<< /Title ${utf16Hex(model.docTitle || model.title || '')} /Producer (Triibholz) >>`);

    let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets = [];
    objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
      offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') +
      `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xFF;
    // one entry per distinct character, so the UI can say "Ł → L" once, not once per render
    const seen = new Set();
    const substituted = subs.filter(s => !seen.has(s.from) && seen.add(s.from));
    return { bytes, pages: pageIds.length, substituted, truncated: cuts };
  }

  /* --------------------------------------------------------------- HTML */
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const htmlLabel = lab => {
    const [a, b] = Array.isArray(lab) ? lab : [lab, ''];
    return `<b>${esc(a)}</b>${b ? `<br><i class="ts-2nd">${esc(b)}</i>` : ''}`;
  };
  /* The on-screen preview and the print fallback. Self-contained markup + classes; the
     stylesheet ships with the app (css/styles.css .ts-*). */
  function toHtml(model) {
    const blocks = (model.blocks || []).map(b => {
      if (b.type === 'fields') {
        const p = Math.round((b.split || 0.3) * 100);
        return `<table class="ts-t ts-fields">${b.rows.map(r =>
          `<tr><td style="width:${p}%">${htmlLabel(r.label)}</td><td>${esc(r.value)}</td></tr>`).join('')}</table>`;
      }
      if (b.type === 'roster') {
        return `<table class="ts-t ts-roster"><thead><tr>${b.columns.map(c =>
          `<th style="width:${Math.round(c.w * 100)}%">${htmlLabel(c.label)}</th>`).join('')}</tr></thead>` +
          `<tbody>${b.rows.map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      }
      if (b.type === 'signatures') {
        return `<table class="ts-t ts-sign">${b.rows.map(r =>
          `<tr><td style="width:24%">${htmlLabel(r.label)}</td><td style="width:30%">${esc(r.value)}</td>` +
          `<td>${htmlLabel(r.sign || ['', ''])}</td></tr>`).join('')}</table>`;
      }
      if (b.type === 'note') {
        return `<div class="ts-note">${b.lines.map(l =>
          `<p${l.italic ? ' class="ts-i"' : ''}><span class="ts-lead">${esc(l.lead)}</span> ${esc(l.text)}</p>`).join('')}</div>`;
      }
      return '';
    }).join('');
    return `<div class="ts-sheet"><h1 class="ts-title">${esc(model.title)}</h1>${blocks}</div>`;
  }

  return { zip, crc32, toDocx, toPdf, toHtml, winAnsi, widthOf, fit };
})();

// Node/CommonJS interop (no-op in the browser)
if (typeof module !== "undefined" && module.exports) module.exports = SHEETDOC;
