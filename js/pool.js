/* ============================================================
   pool.js — accurate top-down water polo pool + player discs.
   viewBox 320 x 262. Water x:24..296 y:30..190 (30m x 20m).
   Left goal = WATER.x0, Right goal = WATER.x1 (we attack RIGHT).
   Official table = top. Flying substitution = bottom (opposite).
   Exclusion / re-entry = small boxes in the two BOTTOM corners,
   behind each goal line, next to the flying-substitution strip.
   Red goal box = 2 m deep (goal line → 2 m) and 1 m beyond each post.
   ============================================================ */
const POOL = (() => {
  const VB = { w: 320, h: 262 };
  const WATER = { x0: 24, y0: 30, x1: 296, y1: 190 };
  WATER.w = WATER.x1 - WATER.x0;   // 272
  WATER.h = WATER.y1 - WATER.y0;   // 160
  const METERS = 30;
  const pxPerM = WATER.w / METERS; // ≈ 9.07 px / metre

  const fromLeft  = (m) => WATER.x0 + m * pxPerM;
  const fromRight = (m) => WATER.x1 - m * pxPerM;
  const CY = WATER.y0 + WATER.h / 2;      // 110
  const GHALF = WATER.h * 0.16;           // half goal-mouth (board scale)

  // ---- staging zones ----
  // Flying substitution: strip along the bottom (-Y) side.
  // Exclusion / re-entry: a red right-angle bracket in EACH of the four corners,
  // against the goal line, inside the 2 m zone. An excluded player exits to the
  // re-entry corner at their OWN defensive end.
  const SUBZONE = { x0: 70, x1: 250, y0: 200, y1: 218, cy: 209 };
  const CORNERS = [
    { x0: WATER.x0,     x1: fromLeft(2),  y0: WATER.y0,      y1: WATER.y0 + 30 }, // top-left  (+Y, table)
    { x0: fromRight(2), x1: WATER.x1,     y0: WATER.y0,      y1: WATER.y0 + 30 }, // top-right (+Y, table)
    { x0: WATER.x0,     x1: fromLeft(2),  y0: WATER.y1 - 30, y1: WATER.y1 },      // bottom-left  (-Y, sub)
    { x0: fromRight(2), x1: WATER.x1,     y0: WATER.y1 - 30, y1: WATER.y1 },      // bottom-right (-Y, sub)
  ];
  // excluded defender waits at their defensive (right) end, table-side corner
  const EXCZONE = { x0: fromRight(2) + 2, x1: WATER.x1 - 3, y0: WATER.y0 + 5, y1: WATER.y0 + 30, cy: WATER.y0 + 16 };

  function svg(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }
  function sideMarker(group, x, yTop, yBot, color) {
    group.appendChild(svg('line', { x1: x, y1: yTop, x2: x, y2: yBot, stroke: color, 'stroke-width': 5, 'stroke-linecap': 'round' }));
  }
  function label(svgEl, x, y, text, fill, anchor='middle', size=7) {
    const t = svg('text', { x, y, 'text-anchor': anchor, 'font-size': size, 'font-weight': 700,
      fill, 'font-family': 'Helvetica, Arial, sans-serif', 'letter-spacing': 0.8 });
    t.textContent = text; svgEl.appendChild(t); return t;
  }

  /* Render the static pool. Returns layer <g> elements. */
  function render(svgEl) {
    while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
    svgEl.setAttribute('viewBox', `0 0 ${VB.w} ${VB.h}`);

    const defs = svg('defs', {});
    const grad = svg('linearGradient', { id: 'waterGrad', x1: '0', y1: '0', x2: '0', y2: '1' });
    grad.appendChild(svg('stop', { offset: '0', 'stop-color': '#1aa3b0' }));
    grad.appendChild(svg('stop', { offset: '1', 'stop-color': '#0c7f8c' }));
    defs.appendChild(grad);
    const mk = svg('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: '8', refY: '5', markerWidth: '6', markerHeight: '6', orient: 'auto-start-reverse' });
    mk.appendChild(svg('path', { d: 'M0 0 L10 5 L0 10 z', fill: 'currentColor' }));
    defs.appendChild(mk);
    const fl = svg('filter', { id: 'discShadow', x: '-40%', y: '-40%', width: '180%', height: '180%' });
    fl.appendChild(svg('feDropShadow', { dx: '0', dy: '1.2', stdDeviation: '1.4', 'flood-color': '#00131a', 'flood-opacity': '0.45' }));
    defs.appendChild(fl);
    svgEl.appendChild(defs);

    // deck
    svgEl.appendChild(svg('rect', { x: 0, y: 0, width: VB.w, height: VB.h, fill: '#0c2030' }));

    // top strip: OFFICIAL TABLE + goal judges
    const tableW = 120, tableX = (VB.w - tableW) / 2;
    svgEl.appendChild(svg('rect', { x: tableX, y: 6, width: tableW, height: 14, rx: 2, fill: '#ffffff' }));
    label(svgEl, VB.w / 2, 16, 'OFFICIAL TABLE', '#0b2030');
    label(svgEl, WATER.x0 + 6, 14, 'GOAL JUDGE', '#8fb0c4', 'start', 5.5);
    label(svgEl, WATER.x1 - 6, 14, 'GOAL JUDGE', '#8fb0c4', 'end', 5.5);

    // water
    svgEl.appendChild(svg('rect', { x: WATER.x0, y: WATER.y0, width: WATER.w, height: WATER.h, fill: 'url(#waterGrad)', stroke: '#0a5860', 'stroke-width': 1.5 }));
    const ripples = svg('g', { opacity: '0.10', stroke: '#eafcff', 'stroke-width': '1', fill: 'none' });
    for (let i = 0; i < 4; i++) {
      const yy = WATER.y0 + 32 + i * 36;
      ripples.appendChild(svg('path', { d: `M${WATER.x0} ${yy} q 18 -6 36 0 t 36 0 t 36 0 t 36 0 t 36 0 t 36 0 t 36 0` }));
    }
    svgEl.appendChild(ripples);
    svgEl.appendChild(svg('rect', { x: WATER.x0, y: WATER.y0, width: WATER.w, height: WATER.h, fill: 'none', stroke: '#2bd07a', 'stroke-width': 1.5, opacity: 0.85 }));

    const lineG = svg('g', { 'stroke-width': 1.6 });
    const vline = (x, color, w = 1.6, dash = null) => {
      const a = { x1: x, y1: WATER.y0, x2: x, y2: WATER.y1, stroke: color, 'stroke-width': w };
      if (dash) a['stroke-dasharray'] = dash;
      lineG.appendChild(svg('line', a));
    };
    [ 'L', 'R' ].forEach(end => {
      const f = end === 'L' ? fromLeft : fromRight;
      vline(f(0.3), '#ffffff', 1.6);      // goal line
      vline(f(2), '#ff3b3b', 1.8);        // 2 m red
      vline(f(5), '#ffd400', 1.8, '4 3'); // 5 m yellow
      vline(f(6), '#39e08a', 1.6, '2 3'); // 6 m green
    });
    vline(WATER.x0 + WATER.w / 2, '#ffffff', 1.8, '3 3');  // half / centre (dotted)
    lineG.appendChild(svg('circle', { cx: WATER.x0 + WATER.w / 2, cy: CY, r: 2, fill: '#ffffff' }));
    svgEl.appendChild(lineG);

    // side rail colour markers
    [WATER.y0 - 6, WATER.y1 + 6].forEach(yRail => {
      const top = yRail < WATER.y0 ? yRail - 4 : yRail;
      const bot = yRail < WATER.y0 ? yRail : yRail + 4;
      [ 'L', 'R' ].forEach(end => {
        const f = end === 'L' ? fromLeft : fromRight;
        sideMarker(svgEl, f(2), top, bot, '#ff3b3b');
        sideMarker(svgEl, f(5), top, bot, '#ffd400');
        sideMarker(svgEl, f(6), top, bot, '#39e08a');
      });
    });

    // ---- red goal box: goal line → 2 m deep, 1 m beyond each post ----
    const redHalf = GHALF + pxPerM;                 // 1 m beyond each post
    [ 'L', 'R' ].forEach(end => {
      const f = end === 'L' ? fromLeft : fromRight;
      const gx = end === 'L' ? WATER.x0 : WATER.x1;
      const x2 = f(2);
      const bx = Math.min(gx, x2), bw = Math.abs(x2 - gx);
      svgEl.appendChild(svg('rect', { x: bx, y: CY - redHalf, width: bw, height: redHalf * 2,
        fill: 'rgba(226,59,59,0.10)', stroke: '#ff3b3b', 'stroke-width': 1.4 }));
    });

    // ---- goals ----
    [ WATER.x0, WATER.x1 ].forEach((gx, idx) => {
      const dir = idx === 0 ? -1 : 1;
      const net = svg('g', { stroke: '#cfeff3', 'stroke-width': 0.5, opacity: 0.6 });
      for (let i = 1; i < 5; i++) net.appendChild(svg('line', { x1: gx + dir * (i * 1.2), y1: CY - GHALF, x2: gx + dir * (i * 1.2), y2: CY + GHALF }));
      svgEl.appendChild(net);
      const post = svg('g', { stroke: '#ffffff', 'stroke-width': 2.4, fill: 'none' });
      post.appendChild(svg('line', { x1: gx, y1: CY - GHALF, x2: gx + dir * 6, y2: CY - GHALF }));
      post.appendChild(svg('line', { x1: gx, y1: CY + GHALF, x2: gx + dir * 6, y2: CY + GHALF }));
      post.appendChild(svg('line', { x1: gx + dir * 6, y1: CY - GHALF, x2: gx + dir * 6, y2: CY + GHALF }));
      svgEl.appendChild(post);
    });

    // ---- goal-judge marks (top corners only) ----
    [[WATER.x0, WATER.y0], [WATER.x1, WATER.y0]].forEach(([cx, cy]) => {
      svgEl.appendChild(svg('rect', { x: cx - 3, y: cy - 3, width: 6, height: 6, fill: '#e23b3b', stroke: '#fff', 'stroke-width': 0.6 }));
    });

    // ---- flying substitution: central strip on the bottom side ----
    function box(zone, fill, stroke) {
      svgEl.appendChild(svg('rect', { x: zone.x0, y: zone.y0, width: zone.x1 - zone.x0, height: zone.y1 - zone.y0,
        rx: 3, fill, stroke, 'stroke-width': 1, 'stroke-dasharray': '4 3' }));
    }
    box(SUBZONE, 'rgba(15,58,47,0.65)', '#3fd08a');
    label(svgEl, (SUBZONE.x0 + SUBZONE.x1) / 2, SUBZONE.y1 + 9, 'FLYING SUBSTITUTION', '#8fe0bc', 'middle', 5.5);

    // ---- exclusion / re-entry: red right-angle bracket in each corner ----
    const bracket = (cx, cy, sx, sy) => {
      const ix = 3, gl = 16, sl = 14;                 // inset + arm lengths
      const x = cx + ix * sx, y = cy + ix * sy;
      svgEl.appendChild(svg('path', { d: `M ${x} ${y + gl * sy} L ${x} ${y} L ${x + sl * sx} ${y}`,
        fill: 'none', stroke: '#ff3b3b', 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    };
    bracket(WATER.x0, WATER.y0, +1, +1);  // top-left
    bracket(WATER.x1, WATER.y0, -1, +1);  // top-right
    bracket(WATER.x0, WATER.y1, +1, -1);  // bottom-left
    bracket(WATER.x1, WATER.y1, -1, -1);  // bottom-right
    label(svgEl, (EXCZONE.x0 + EXCZONE.x1) / 2, EXCZONE.y1 + 6, 're-entry', '#ff9e9e', 'middle', 4.5);

    const pathLayer = svg('g', { id: 'path-layer' });
    const discLayer = svg('g', { id: 'disc-layer' });
    svgEl.appendChild(pathLayer);
    svgEl.appendChild(discLayer);
    return { pathLayer, discLayer, WATER };
  }

  /* Build a player disc <g>. team: 'A' white | 'D' black | 'GK' red. small=waiting */
  function disc(team, labelTxt, small) {
    const g = svg('g', { class: 'disc' + (small ? ' wait' : ''), 'data-team': team, 'data-label': labelTxt });
    const r = small ? 6.6 : 8.5;
    let fill = '#ffffff', stroke = '#0b1f2c', txt = '#0b1f2c';
    if (team === 'D') { fill = '#11151c'; stroke = '#000'; txt = '#ffffff'; }
    if (team === 'GK') { fill = '#e23b3b'; stroke = '#7a0f0f'; txt = '#ffffff'; }
    g.appendChild(svg('circle', { r, fill, stroke, 'stroke-width': 1.6, filter: 'url(#discShadow)' }));
    const t = svg('text', { 'text-anchor': 'middle', y: small ? 2.6 : 3.2, fill: txt,
      'font-size': small ? 7 : 9, 'font-weight': 800, 'font-family': 'Helvetica, Arial, sans-serif' });
    t.textContent = labelTxt;
    g.appendChild(t);
    return g;
  }

  function ball() {
    const g = svg('g', { class: 'ball' });
    g.appendChild(svg('circle', { r: 4.4, fill: '#ff7a18', stroke: '#9c3d00', 'stroke-width': 1, filter: 'url(#discShadow)' }));
    g.appendChild(svg('path', { d: 'M-3.6 -1.4 q3.6 -2.6 7.2 0 M-3.6 1.4 q3.6 2.6 7.2 0', stroke: '#fff', 'stroke-width': 0.7, fill: 'none', opacity: .85 }));
    return g;
  }

  // stacked slot inside a zone — grid, filling from the right, wrapping downward
  // (narrow corner boxes therefore stack vertically)
  function stackPos(zone, i) {
    const gap = 15;
    const perRow = Math.max(1, Math.floor((zone.x1 - zone.x0 - 4) / gap));
    const col = i % perRow, row = Math.floor(i / perRow);
    return { x: (zone.x1 - 8) - col * gap, y: zone.y0 + 10 + row * 14 };
  }

  function eventToVB(svgEl, evt) {
    const pt = svgEl.createSVGPoint();
    const src = evt.touches ? evt.touches[0] : evt;
    pt.x = src.clientX; pt.y = src.clientY;
    const ctm = svgEl.getScreenCTM().inverse();
    const p = pt.matrixTransform(ctm);
    return { x: p.x, y: p.y };
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const inBox = (z, p) => p.x >= z.x0 - 5 && p.x <= z.x1 + 5 && p.y >= z.y0 - 5 && p.y <= z.y1 + 8;
  function clampToWater(p) {
    return { x: clamp(p.x, WATER.x0 + 4, WATER.x1 - 4), y: clamp(p.y, WATER.y0 + 4, WATER.y1 - 4) };
  }
  // allow dropping into water OR a staging zone (sub strip / any re-entry corner)
  function clampAnywhere(p) {
    for (const z of CORNERS) if (inBox(z, p)) return { x: clamp(p.x, z.x0 + 3, z.x1 - 3), y: clamp(p.y, z.y0 + 3, z.y1 - 3) };
    if (inBox(SUBZONE, p)) return { x: clamp(p.x, SUBZONE.x0 + 4, SUBZONE.x1 - 4), y: clamp(p.y, SUBZONE.y0 + 4, SUBZONE.y1 - 4) };
    return clampToWater(p);
  }
  function zoneOf(p) {
    for (const z of CORNERS) if (inBox(z, p)) return 'exc';
    if (inBox(SUBZONE, p)) return 'sub';
    return 'water';
  }

  return { VB, WATER, SUBZONE, EXCZONE, CORNERS, pxPerM, fromLeft, fromRight, svg, render, disc, ball,
           stackPos, eventToVB, clampToWater, clampAnywhere, zoneOf };
})();
