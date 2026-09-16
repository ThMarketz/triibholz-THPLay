/* ============================================================
   chart.js — the few charts this app needs, drawn by hand in SVG.

   No charting library: the app ships with zero dependencies, and the three shapes a coach
   actually reads are small enough to draw honestly —

     · dotStrip  one dot per player against their own target line ("who is short, and by how much")
     · bars      a value per row against a shared scale ("where is the squad furthest behind")
     · series    one player's result over time, with the target as a rule ("is this getting better")

   Rules this file keeps:
   · Pure. It takes numbers and returns an SVG string; it never reads the DOM or storage.
   · Every colour comes from THEME.c() — a literal here would survive a change of look and
     look wrong in Black & Silver (tests/smoke.mjs fails the build for one).
   · Every word is passed IN, already translated. This file contains no English.
   · Better is always UP and RIGHT, including for times, where a smaller number is better:
     `lower: true` flips the axis instead of asking the reader to flip it in their head.
   · A value that cannot be drawn (missing, NaN, infinite) is dropped, never drawn as zero.
   ============================================================ */
const CHART = (() => {
  const C = name => (typeof THEME !== 'undefined' && THEME.c ? THEME.c(name) : '');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const num = v => (typeof v === 'number' && isFinite(v) ? v : null);
  const round = v => Math.round(v * 100) / 100;

  /* a domain a person would choose: round steps, and always room for the target line */
  function niceDomain(values, { include = [], pad = 0.08 } = {}) {
    const vs = values.concat(include).map(num).filter(v => v !== null);
    if (!vs.length) return null;
    let min = Math.min(...vs), max = Math.max(...vs);
    if (min === max) { const d = Math.abs(min) * 0.1 || 1; min -= d; max += d; }
    const span = max - min;
    return { min: min - span * pad, max: max + span * pad };
  }
  /* up to `count` round tick values inside a domain */
  function ticks(domain, count = 4) {
    if (!domain) return [];
    const raw = (domain.max - domain.min) / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || mag * 10;
    const out = [];
    for (let v = Math.ceil(domain.min / step) * step; v <= domain.max + 1e-9; v += step) out.push(round(v));
    return out;
  }
  const scale = (v, domain, from, to, flip) => {
    const t = (v - domain.min) / (domain.max - domain.min || 1);
    return flip ? to - t * (to - from) : from + t * (to - from);
  };

  const wrap = (w, h, title, body, cls) =>
    // its own size, never blown up: the CSS may shrink it on a narrow screen, and the text shrinks with it
    `<svg class="chart ${cls || ''}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}" preserveAspectRatio="xMidYMid meet">` +
    `<title>${esc(title)}</title>${body}</svg>`;
  const empty = (w, h, title, message) =>
    wrap(w, h, title, `<text x="${w / 2}" y="${h / 2}" text-anchor="middle" dominant-baseline="middle" font-size="11" fill="${C('--chart-muted')}">${esc(message)}</text>`, 'chart-empty');

  /* ---- one dot per player, against the target ----
     rows: [{ value, label, verified }]  value in the same unit as `target`.
     Dots sit on one line; a dot short of target is drawn hollow, at target filled. */
  function dotStrip(rows, opts) {
    const o = Object.assign({ width: 320, height: 54, target: null, lower: false, title: '', empty: '', axisFormat: v => String(v), ticks: 3 }, opts || {});
    const pts = (rows || []).map(r => ({ v: num(r && r.value), label: r && r.label, verified: !!(r && r.verified), met: r && r.met })).filter(p => p.v !== null);
    if (!pts.length) return empty(o.width, o.height, o.title, o.empty);
    const left = 4, right = o.width - 4, top = 16, mid = top + 12;
    const domain = niceDomain(pts.map(p => p.v), { include: o.target == null ? [] : [o.target] });
    const x = v => scale(v, domain, left, right, o.lower);   // better is always to the right
    const body = [];
    ticks(domain, o.ticks).forEach(t => {
      body.push(`<line x1="${round(x(t))}" y1="${top}" x2="${round(x(t))}" y2="${mid + 10}" stroke="${C('--chart-grid')}" stroke-width="1"/>`);
      body.push(`<text x="${round(x(t))}" y="${o.height - 4}" text-anchor="middle" font-size="9" fill="${C('--chart-muted')}">${esc(o.axisFormat(t))}</text>`);
    });
    if (o.target != null && num(o.target) !== null) {
      const tx = round(x(o.target));
      body.push(`<line x1="${tx}" y1="${top - 6}" x2="${tx}" y2="${mid + 12}" stroke="${C('--chart-target')}" stroke-width="2"/>`);
      body.push(`<text x="${tx}" y="${top - 8}" text-anchor="middle" font-size="9" fill="${C('--chart-target')}">${esc(o.targetLabel || '')}</text>`);
    }
    pts.forEach(p => {
      const cx = round(x(p.v)), fill = p.met ? C('--chart-good') : C('--chart-short');
      body.push(`<circle cx="${cx}" cy="${mid}" r="5" fill="${p.verified ? fill : 'none'}" stroke="${fill}" stroke-width="2" stroke-dasharray="${p.verified ? '' : '2 2'}"><title>${esc(p.label || '')}</title></circle>`);
    });
    return wrap(o.width, o.height, o.title, body.join(''), 'chart-dots');
  }

  /* ---- bars: one row per label, a shared scale, the biggest at the top ---- */
  function bars(rows, opts) {
    const o = Object.assign({ width: 320, rowHeight: 22, max: null, title: '', empty: '', valueFormat: v => String(round(v)), labelWidth: 96 }, opts || {});
    const list = (rows || []).map(r => ({ label: r && r.label, v: num(r && r.value), note: r && r.note })).filter(r => r.v !== null);
    if (!list.length) return empty(o.width, o.rowHeight * 2, o.title, o.empty);
    const h = list.length * o.rowHeight + 6;
    const max = num(o.max) !== null ? o.max : Math.max(...list.map(r => r.v));
    const x0 = o.labelWidth, x1 = o.width - 36;
    const body = list.map((r, i) => {
      const y = i * o.rowHeight + 4, bw = max > 0 ? Math.max(1, (r.v / max) * (x1 - x0)) : 1;
      return `<text x="0" y="${y + 12}" font-size="11" fill="${C('--chart-ink')}">${esc(r.label)}</text>` +
        `<rect x="${x0}" y="${y + 3}" width="${x1 - x0}" height="12" rx="6" fill="${C('--chart-bar-track')}"/>` +
        `<rect x="${x0}" y="${y + 3}" width="${round(bw)}" height="12" rx="6" fill="${C('--chart-bar')}"><title>${esc(r.note || r.label)}</title></rect>` +
        `<text x="${o.width}" y="${y + 13}" text-anchor="end" font-size="10" fill="${C('--chart-muted')}">${esc(o.valueFormat(r.v))}</text>`;
    });
    return wrap(o.width, h, o.title, body.join(''), 'chart-bars');
  }

  /* ---- one player's result over time; better is up, whatever the unit ---- */
  function series(points, opts) {
    const o = Object.assign({ width: 320, height: 130, target: null, lower: false, title: '', empty: '', valueFormat: v => String(round(v)), dateFormat: d => String(d || '') }, opts || {});
    const pts = (points || []).map(p => ({ v: num(p && p.value), date: p && p.date, verified: !!(p && p.verified), met: p && p.met })).filter(p => p.v !== null);
    if (!pts.length) return empty(o.width, o.height, o.title, o.empty);
    const left = 34, right = o.width - 6, top = 10, bottom = o.height - 18;
    const domain = niceDomain(pts.map(p => p.v), { include: o.target == null ? [] : [o.target] });
    const y = v => scale(v, domain, bottom, top, !!o.lower);   // lower-is-better → small values sit high
    const x = i => pts.length === 1 ? (left + right) / 2 : left + (i / (pts.length - 1)) * (right - left);
    const body = [];
    ticks(domain, 3).forEach(t => {
      body.push(`<line x1="${left}" y1="${round(y(t))}" x2="${right}" y2="${round(y(t))}" stroke="${C('--chart-grid')}" stroke-width="1"/>`);
      body.push(`<text x="${left - 4}" y="${round(y(t)) + 3}" text-anchor="end" font-size="9" fill="${C('--chart-muted')}">${esc(o.valueFormat(t))}</text>`);
    });
    if (o.target != null && num(o.target) !== null) {
      body.push(`<line x1="${left}" y1="${round(y(o.target))}" x2="${right}" y2="${round(y(o.target))}" stroke="${C('--chart-target')}" stroke-width="2" stroke-dasharray="4 3"/>`);
    }
    body.push(`<polyline fill="none" stroke="${C('--chart-line')}" stroke-width="2" points="${pts.map((p, i) => `${round(x(i))},${round(y(p.v))}`).join(' ')}"/>`);
    pts.forEach((p, i) => {
      const fill = p.met ? C('--chart-good') : C('--chart-short');
      body.push(`<circle cx="${round(x(i))}" cy="${round(y(p.v))}" r="4" fill="${p.verified ? fill : C('--chart-bg')}" stroke="${fill}" stroke-width="2"><title>${esc(o.dateFormat(p.date))} · ${esc(o.valueFormat(p.v))}</title></circle>`);
    });
    [pts[0], pts[pts.length - 1]].forEach((p, k) => {
      if (pts.length < 2 && k) return;
      const i = k ? pts.length - 1 : 0;
      body.push(`<text x="${round(x(i))}" y="${o.height - 4}" text-anchor="${k ? 'end' : 'start'}" font-size="9" fill="${C('--chart-muted')}">${esc(o.dateFormat(p.date))}</text>`);
    });
    return wrap(o.width, o.height, o.title, body.join(''), 'chart-series');
  }

  return { dotStrip, bars, series, niceDomain, ticks, scale };
})();

// Node/CommonJS interop (no-op in the browser)
if (typeof module !== "undefined" && module.exports) module.exports = CHART;
