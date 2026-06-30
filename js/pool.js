/* ============================================================
   pool.js — accurate top-down water polo pool + player discs
   Coordinate system: viewBox 320 x 262.
   Water rectangle x:24..296 y:30..190 (30m x 20m, 3:2).
   Left goal = WATER.x0 , Right goal = WATER.x1 (we attack RIGHT).
   Below the water: two waiting lanes — flying substitution & exclusion/re-entry.
   ============================================================ */
const POOL = (() => {
  const VB = { w: 320, h: 262 };
  const WATER = { x0: 24, y0: 30, x1: 296, y1: 190 };
  WATER.w = WATER.x1 - WATER.x0;   // 272
  WATER.h = WATER.y1 - WATER.y0;   // 160
  const METERS = 30;
  const pxPerM = WATER.w / METERS;

  const fromLeft  = (m) => WATER.x0 + m * pxPerM;
  const fromRight = (m) => WATER.x1 - m * pxPerM;

  // waiting lanes below the field of play
  const SUBZONE = { x0: WATER.x0, x1: WATER.x1, y0: 198, y1: 218, cy: 208 };  // flying substitution
  const EXCZONE = { x0: WATER.x0, x1: WATER.x1, y0: 232, y1: 252, cy: 242 };  // exclusion / re-entry

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
      fill, 'font-family': 'Helvetica, Arial, sans-serif', 'letter-spacing': 1 });
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

    // top strip: OFFICIAL TABLE
    const tableW = 120, tableX = (VB.w - tableW) / 2;
    svgEl.appendChild(svg('rect', { x: tableX, y: 6, width: tableW, height: 14, rx: 2, fill: '#ffffff' }));
    label(svgEl, VB.w / 2, 16, 'OFFICIAL TABLE', '#0b2030');

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
      vline(f(0.3), '#ffffff', 1.6);   // goal line
      vline(f(2), '#ff3b3b', 1.8);     // 2 m red
      vline(f(5), '#ffd400', 1.8, '4 3'); // 5 m yellow
      vline(f(6), '#39e08a', 1.6, '2 3'); // 6 m green
    });
    vline(WATER.x0 + WATER.w / 2, '#ffffff', 1.8);  // half
    lineG.appendChild(svg('circle', { cx: WATER.x0 + WATER.w / 2, cy: WATER.y0 + WATER.h / 2, r: 2, fill: '#ffffff' }));
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

    const cy = WATER.y0 + WATER.h / 2;
    const ghalf = (WATER.h * 0.16);

    // ---- red goal-area box in front of each goal ----
    [ 'L', 'R' ].forEach(end => {
      const f = end === 'L' ? fromLeft : fromRight;
      const gx = end === 'L' ? WATER.x0 : WATER.x1;
      const x2 = f(2);
      const bx = Math.min(gx, x2), bw = Math.abs(x2 - gx);
      svgEl.appendChild(svg('rect', { x: bx, y: cy - ghalf, width: bw, height: ghalf * 2,
        fill: 'rgba(226,59,59,0.14)', stroke: '#ff3b3b', 'stroke-width': 1.2 }));
    });

    // ---- goals ----
    [ WATER.x0, WATER.x1 ].forEach((gx, idx) => {
      const dir = idx === 0 ? -1 : 1;
      const net = svg('g', { stroke: '#cfeff3', 'stroke-width': 0.5, opacity: 0.6 });
      for (let i = 1; i < 5; i++) net.appendChild(svg('line', { x1: gx + dir * (i * 1.2), y1: cy - ghalf, x2: gx + dir * (i * 1.2), y2: cy + ghalf }));
      svgEl.appendChild(net);
      const post = svg('g', { stroke: '#ffffff', 'stroke-width': 2.2, fill: 'none' });
      post.appendChild(svg('line', { x1: gx, y1: cy - ghalf, x2: gx + dir * 6, y2: cy - ghalf }));
      post.appendChild(svg('line', { x1: gx, y1: cy + ghalf, x2: gx + dir * 6, y2: cy + ghalf }));
      post.appendChild(svg('line', { x1: gx + dir * 6, y1: cy - ghalf, x2: gx + dir * 6, y2: cy + ghalf }));
      svgEl.appendChild(post);
    });

    // ---- corner re-entry / exclusion markings on the field ----
    [[WATER.x0, WATER.y0, 1, 1], [WATER.x1, WATER.y0, -1, 1], [WATER.x0, WATER.y1, 1, -1], [WATER.x1, WATER.y1, -1, -1]]
      .forEach(([x, y, sx, sy]) => {
        svgEl.appendChild(svg('path', { d: `M${x} ${y + sy*10} A 10 10 0 0 ${sx*sy>0?0:1} ${x + sx*10} ${y}`,
          fill: 'none', stroke: '#e23b3b', 'stroke-width': 1.2, opacity: 0.85 }));
        svgEl.appendChild(svg('rect', { x: x - 3, y: y - 3, width: 6, height: 6, fill: '#e23b3b', stroke: '#fff', 'stroke-width': 0.6 }));
      });

    // ---- waiting lanes ----
    function lane(zone, fill, stroke, text) {
      svgEl.appendChild(svg('rect', { x: zone.x0, y: zone.y0, width: zone.x1 - zone.x0, height: zone.y1 - zone.y0,
        rx: 3, fill, stroke, 'stroke-width': 1, 'stroke-dasharray': '4 3' }));
      label(svgEl, zone.x0 + 4, (zone.y0 + zone.y1) / 2 + 2.4, text, stroke, 'start', 6.5);
    }
    lane(SUBZONE, 'rgba(15,58,47,0.65)', '#3fd08a', 'FLYING SUBSTITUTION');
    lane(EXCZONE, 'rgba(58,28,28,0.6)', '#ff7a7a', 'EXCLUSION / RE-ENTRY');

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

  // stacked slot inside a waiting lane — anchored at the right, filling leftward,
  // so discs stay clear of the left-aligned lane label.
  function stackPos(zone, i) {
    const rightX = zone.x1 - 14, gap = 17, perRow = Math.max(1, Math.floor((zone.x1 - zone.x0 - 130) / gap));
    const col = i % perRow;
    return { x: rightX - col * gap, y: zone.cy };
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
  function clampToWater(p) {
    return { x: clamp(p.x, WATER.x0 + 4, WATER.x1 - 4), y: clamp(p.y, WATER.y0 + 4, WATER.y1 - 4) };
  }
  // allow dropping into water OR either waiting lane
  function clampAnywhere(p) {
    if (p.y >= SUBZONE.y0 - 8 && p.y <= SUBZONE.y1 + 6)
      return { x: clamp(p.x, SUBZONE.x0 + 6, SUBZONE.x1 - 6), y: SUBZONE.cy };
    if (p.y >= EXCZONE.y0 - 8)
      return { x: clamp(p.x, EXCZONE.x0 + 6, EXCZONE.x1 - 6), y: EXCZONE.cy };
    return clampToWater(p);
  }
  function zoneOf(p) {
    if (p.y >= SUBZONE.y0 - 8 && p.y <= SUBZONE.y1 + 6) return 'sub';
    if (p.y >= EXCZONE.y0 - 8) return 'exc';
    return 'water';
  }

  return { VB, WATER, SUBZONE, EXCZONE, pxPerM, fromLeft, fromRight, svg, render, disc, ball,
           stackPos, eventToVB, clampToWater, clampAnywhere, zoneOf };
})();
