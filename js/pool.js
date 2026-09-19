/* ============================================================
   pool.js — accurate top-down water polo pool + player discs.
   viewBox 320 x 262. Water x:24..296 y:30..190 (25m x 20m — 2025 rules).
   Left goal = WATER.x0, Right goal = WATER.x1 (we attack RIGHT).
   Official table = top. Flying substitution = bottom (opposite),
   one half per team. Exclusion / re-entry = red brackets in all
   four corners against the goal lines, inside the 2 m zone.
   Red goal box = 2 m deep (goal line → 2 m) and 1 m beyond each post.
   ============================================================ */
const POOL = (() => {
  const C = name => THEME.c(name);   // colour tokens as values (js/theme.js, css/styles.css)
  /* The pool's own markings are text a player reads, so they follow the app language.
     They are drawn onto the SVG rather than written as markup, which is why the i18n
     scanner never saw them — it now watches textContent assignments too. */
  const T = k => (typeof I18N !== 'undefined') ? I18N.t(k) : k;
  const VB = { w: 320, h: 262 };
  /* THE HALF. A set play — 6-on-6, man-up, a penalty — happens entirely in the attacking half, so
     the full pool spends half the board on water nobody is using. Measured on an iPad-width board:
     every player of a man-up sat between x 226 and 292, and a formation got about 20 px a metre.

     The crop is TIGHT on purpose, and that is the whole trick. Keeping the full board height (the
     officials' table and the substitution strips) makes the half taller than it is wide, and on a
     landscape iPad — which is how it is held on a bench — a height-limited board then scales
     exactly as the full pool did: +0%, a view that looks done and helps nobody. Cropped to the
     water from the centre line through the goal it is +49% in landscape and +90% in portrait.
     Turning it so the goal is at the top adds seven points in landscape and costs eight in
     portrait, so the size comes from the crop and the turn is a choice, not a need.

     It is a VIEWBOX, not a redraw: every disc, arrow and path keeps its coordinates, and dragging
     keeps working because eventToVB reads getScreenCTM(), which already accounts for the viewBox. */
  const HALF = { x: 146, y: 22, w: 168, h: 176 };
  /* The same half, reaching down to the substitution deck. Measured across every play on a
     device: field players NEVER leave the tight half (not one position out of all of them), but in
     2 plays of 15 a substitute enters the water — and a frame that hides the bench makes a player
     appear from nowhere mid-play. So a play with a bench gets the deck in frame; the rest keep the
     full gain. Nobody on the board is ever cut off. */
  const HALF_DECK = { x: 146, y: 22, w: 168, h: 200 };
  const WATER = { x0: 24, y0: 30, x1: 296, y1: 190 };
  WATER.w = WATER.x1 - WATER.x0;   // 272
  WATER.h = WATER.y1 - WATER.y0;   // 160
  const METERS = 25;   // 2025 World Aquatics rules: 25 m for men and women
  const pxPerM = WATER.w / METERS; // ≈ 9.07 px / metre

  const fromLeft  = (m) => WATER.x0 + m * pxPerM;
  const fromRight = (m) => WATER.x1 - m * pxPerM;
  const CY = WATER.y0 + WATER.h / 2;      // 110
  const GHALF = 1.5 * pxPerM;             // half goal-mouth — true 3 m goal

  // ---- staging zones ----
  // Flying substitution: strip along the bottom (-Y) side.
  // Exclusion / re-entry: a red right-angle bracket in EACH of the four corners,
  // against the goal line, inside the 2 m zone. An excluded player exits to the
  // re-entry corner at their OWN defensive end.
  // one flying-substitution half per team: own goal line → centre line (rule 1.3)
  const SUB_L   = { x0: 26,  x1: 156, y0: 200, y1: 218, cy: 209 };
  const SUBZONE = { x0: 164, x1: 294, y0: 200, y1: 218, cy: 209 };  // right half (kept name for compat)
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
    // the framing is applied at the end, once the group it turns exists

    const defs = svg('defs', {});
    const grad = svg('linearGradient', { id: 'waterGrad', x1: '0', y1: '0', x2: '0', y2: '1' });
    grad.appendChild(svg('stop', { offset: '0', 'stop-color': C('--pool-water-top') }));
    grad.appendChild(svg('stop', { offset: '1', 'stop-color': C('--pool-water-bottom') }));
    defs.appendChild(grad);
    [['arrow',C('--pool-arrow')],['arrowBall',C('--pool-arrow-ball')],['arrowCtx',C('--pool-arrow-context')]].forEach(([id,fill])=>{
      const mk = svg('marker', { id, viewBox: '0 0 10 10', refX: '7.5', refY: '5', markerWidth: '5.5', markerHeight: '5.5', orient: 'auto-start-reverse' });
      mk.appendChild(svg('path', { d: 'M0 0 L10 5 L0 10 z', fill }));
      defs.appendChild(mk);
    });
    const fl = svg('filter', { id: 'discShadow', x: '-40%', y: '-40%', width: '180%', height: '180%' });
    fl.appendChild(svg('feDropShadow', { dx: '0', dy: '1.2', stdDeviation: '1.4', 'flood-color': C('--pool-disc-shadow'), 'flood-opacity': '0.45' }));
    defs.appendChild(fl);
    // clip for the animated water layers + a soft light sheen
    const clip = svg('clipPath', { id: 'waterClip' });
    clip.appendChild(svg('rect', { x: WATER.x0, y: WATER.y0, width: WATER.w, height: WATER.h }));
    defs.appendChild(clip);
    const sheen = svg('radialGradient', { id: 'waterSheen', cx: '0.3', cy: '0.18', r: '0.9' });
    sheen.appendChild(svg('stop', { offset: '0', 'stop-color': C('--pool-sheen'), 'stop-opacity': '0.16' }));
    sheen.appendChild(svg('stop', { offset: '0.55', 'stop-color': C('--pool-sheen'), 'stop-opacity': '0.04' }));
    sheen.appendChild(svg('stop', { offset: '1', 'stop-color': C('--pool-sheen'), 'stop-opacity': '0' }));
    defs.appendChild(sheen);
    svgEl.appendChild(defs);

    // deck
    svgEl.appendChild(svg('rect', { x: 0, y: 0, width: VB.w, height: VB.h, fill: C('--pool-deck') }));

    // top strip: OFFICIAL TABLE + goal judges
    const tableW = 120, tableX = (VB.w - tableW) / 2;
    svgEl.appendChild(svg('rect', { x: tableX, y: 6, width: tableW, height: 14, rx: 2, fill: C('--pool-table') }));
    label(svgEl, VB.w / 2, 16, T('pool.officialTable'), C('--pool-table-ink'));
    label(svgEl, WATER.x0 + 6, 14, T('pool.goalJudge'), C('--pool-label'), 'start', 5.5);
    label(svgEl, WATER.x1 - 6, 14, T('pool.goalJudge'), C('--pool-label'), 'end', 5.5);

    // water
    svgEl.appendChild(svg('rect', { x: WATER.x0, y: WATER.y0, width: WATER.w, height: WATER.h, fill: 'url(#waterGrad)', stroke: C('--pool-water-edge'), 'stroke-width': 1.5 }));
    // living water: two ripple layers drift in opposite directions (CSS keyframes),
    // drawn wider than the pool and clipped so the loop is seamless
    const wavePath = (yy) => `M${WATER.x0 - 72} ${yy} q 18 -6 36 0` + ' t 36 0'.repeat(11);
    const mkRipples = (cls, ys, w, op) => {
      const g = svg('g', { class: cls, stroke: C('--pool-mark'), 'stroke-width': w, fill: 'none',
        opacity: op, 'clip-path': 'url(#waterClip)' });
      ys.forEach(yy => g.appendChild(svg('path', { d: wavePath(yy) })));
      svgEl.appendChild(g);
    };
    mkRipples('ripples-a', [62, 98, 134, 170].map(y=>y-32+WATER.y0-30+32), 1, 0.10);
    mkRipples('ripples-b', [46, 80, 116, 152, 186].map(y=>y-32+WATER.y0-30+32), 0.8, 0.07);
    svgEl.appendChild(svg('rect', { x: WATER.x0, y: WATER.y0, width: WATER.w, height: WATER.h,
      fill: 'url(#waterSheen)', 'pointer-events': 'none' }));
    svgEl.appendChild(svg('rect', { x: WATER.x0, y: WATER.y0, width: WATER.w, height: WATER.h, fill: 'none', stroke: C('--pool-field-edge'), 'stroke-width': 1.5, opacity: 0.85 }));

    const lineG = svg('g', { 'stroke-width': 1.6 });
    const vline = (x, color, w = 1.6, dash = null) => {
      const a = { x1: x, y1: WATER.y0, x2: x, y2: WATER.y1, stroke: color, 'stroke-width': w };
      if (dash) a['stroke-dasharray'] = dash;
      lineG.appendChild(svg('line', a));
    };
    [ 'L', 'R' ].forEach(end => {
      const f = end === 'L' ? fromLeft : fromRight;
      vline(f(0.3), C('--pool-goal-line'), 1.6);      // goal line
      vline(f(2), C('--pool-2m'), 1.8);        // 2 m red
      vline(f(5), C('--pool-5m'), 1.8, '4 3'); // 5 m yellow
      vline(f(6), C('--pool-6m'), 1.6, '2 3'); // 6 m green
    });
    vline(WATER.x0 + WATER.w / 2, C('--pool-half'), 1.8, '3 3');  // half / centre (dotted)
    lineG.appendChild(svg('circle', { cx: WATER.x0 + WATER.w / 2, cy: CY, r: 2, fill: C('--pool-half') }));
    svgEl.appendChild(lineG);

    // side rail colour markers
    [WATER.y0 - 6, WATER.y1 + 6].forEach(yRail => {
      const top = yRail < WATER.y0 ? yRail - 4 : yRail;
      const bot = yRail < WATER.y0 ? yRail : yRail + 4;
      [ 'L', 'R' ].forEach(end => {
        const f = end === 'L' ? fromLeft : fromRight;
        sideMarker(svgEl, f(2), top, bot, C('--pool-2m'));
        sideMarker(svgEl, f(5), top, bot, C('--pool-5m'));
        sideMarker(svgEl, f(6), top, bot, C('--pool-6m'));
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
        fill: C('--pool-2m-zone'), stroke: C('--pool-2m'), 'stroke-width': 1.4 }));
    });

    // ---- goals ----
    [ WATER.x0, WATER.x1 ].forEach((gx, idx) => {
      const dir = idx === 0 ? -1 : 1;
      const net = svg('g', { stroke: C('--pool-net'), 'stroke-width': 0.5, opacity: 0.6 });
      for (let i = 1; i < 5; i++) net.appendChild(svg('line', { x1: gx + dir * (i * 1.2), y1: CY - GHALF, x2: gx + dir * (i * 1.2), y2: CY + GHALF }));
      svgEl.appendChild(net);
      const post = svg('g', { stroke: C('--pool-goal-post'), 'stroke-width': 2.4, fill: 'none' });
      post.appendChild(svg('line', { x1: gx, y1: CY - GHALF, x2: gx + dir * 6, y2: CY - GHALF }));
      post.appendChild(svg('line', { x1: gx, y1: CY + GHALF, x2: gx + dir * 6, y2: CY + GHALF }));
      post.appendChild(svg('line', { x1: gx + dir * 6, y1: CY - GHALF, x2: gx + dir * 6, y2: CY + GHALF }));
      svgEl.appendChild(post);
    });

    // ---- goal-judge marks (top corners only) ----
    [[WATER.x0, WATER.y0], [WATER.x1, WATER.y0]].forEach(([cx, cy]) => {
      svgEl.appendChild(svg('rect', { x: cx - 3, y: cy - 3, width: 6, height: 6, fill: C('--pool-judge-mark'), stroke: C('--pool-judge-mark-edge'), 'stroke-width': 0.6 }));
    });

    // ---- flying substitution: central strip on the bottom side ----
    function box(zone, fill, stroke) {
      svgEl.appendChild(svg('rect', { x: zone.x0, y: zone.y0, width: zone.x1 - zone.x0, height: zone.y1 - zone.y0,
        rx: 3, fill, stroke, 'stroke-width': 1, 'stroke-dasharray': '4 3' }));
    }
    [SUB_L, SUBZONE].forEach(z => box(z, C('--pool-sub-zone'), C('--pool-sub-edge')));
    label(svgEl, (WATER.x0 + WATER.x1) / 2, SUBZONE.y1 + 9, T('pool.flyingSub'), C('--pool-sub-label'), 'middle', 5);

    // ---- exclusion / re-entry: red right-angle bracket in each corner ----
    const bracket = (cx, cy, sx, sy) => {
      const ix = 3, gl = 16, sl = 14;                 // inset + arm lengths
      const x = cx + ix * sx, y = cy + ix * sy;
      svgEl.appendChild(svg('path', { d: `M ${x} ${y + gl * sy} L ${x} ${y} L ${x + sl * sx} ${y}`,
        fill: 'none', stroke: C('--pool-exclusion'), 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    };
    bracket(WATER.x0, WATER.y0, +1, +1);  // top-left
    bracket(WATER.x1, WATER.y0, -1, +1);  // top-right
    bracket(WATER.x0, WATER.y1, +1, -1);  // bottom-left
    bracket(WATER.x1, WATER.y1, -1, -1);  // bottom-right

    // zoneLayer sits under the arrows and discs: shot-chance territory is painted here.
    // Nothing else wipes it (drawTactics only clears pathLayer), so it survives playback.
    const zoneLayer = svg('g', { id: 'zone-layer', 'clip-path': 'url(#waterClip)' });
    const pathLayer = svg('g', { id: 'path-layer' });
    const splashLayer = svg('g', { id: 'splash-layer', 'clip-path': 'url(#waterClip)' });
    const discLayer = svg('g', { id: 'disc-layer' });
    svgEl.appendChild(zoneLayer);
    svgEl.appendChild(pathLayer);
    svgEl.appendChild(splashLayer);
    svgEl.appendChild(discLayer);
    /* Gather the whole drawing into one group so the board can be turned as a single thing. The
       <defs> stay outside it — gradients, markers and clip paths are referenced by id and must
       not be rotated themselves. The layer references returned below stay valid: moving an
       element into a group keeps the same element. */
    const root = svg('g', { class: 'pool-root' });
    [...svgEl.childNodes].forEach(n => { if (n.nodeName !== 'defs') root.appendChild(n); });
    svgEl.appendChild(root);
    // keep the framing and turn the board already had — redrawing a step must not snap it back
    const kept = (svgEl.dataset.frame || '').split(',').map(Number);
    setView(svgEl, svgEl.dataset.view === 'half' ? 'half' : 'full', {
      deck: svgEl.dataset.deck === '1', rot: +svgEl.dataset.rot || 0,
      frame: kept.length === 4 && kept.every(Number.isFinite) ? { x: kept[0], y: kept[1], w: kept[2], h: kept[3] } : null,
    });
    if (+svgEl.dataset.zoom > 1) setCamera(svgEl, {});      // and the zoom — building a viewer must not reset it
    return { zoneLayer, pathLayer, splashLayer, discLayer, WATER };
  }

  /* Build a player disc <g>. team: 'A' white | 'D' black | 'GK' red. small=waiting */
  function disc(team, labelTxt, small) {
    const g = svg('g', { class: 'disc' + (small ? ' wait' : ''), 'data-team': team, 'data-label': labelTxt });
    const r = small ? 4.2 : 5.2;   // small discs — the tactics own the board
    let fill = C('--cap-white'), stroke = C('--cap-white-edge'), txt = C('--cap-white-ink');
    if (team === 'D') { fill = C('--cap-dark'); stroke = C('--cap-dark-edge'); txt = C('--cap-dark-ink'); }
    if (team === 'GK') { fill = C('--cap-gk'); stroke = C('--cap-gk-edge'); txt = C('--cap-gk-ink'); }
    // the ripple stays at the surface when the player goes under; it is invisible until then
    g.appendChild(svg('ellipse', { class: 'disc-ripple', rx: r * 1.7, ry: r * 0.62, fill: 'none', stroke, 'stroke-width': 0.6 }));
    g.appendChild(svg('circle', { class: 'disc-body', r, fill, stroke, 'stroke-width': 1.3, filter: 'url(#discShadow)' }));
    const t = svg('text', { 'text-anchor': 'middle', y: small ? 1.7 : 2.1, fill: txt,
      'font-size': small ? 4.8 : 5.9, 'font-weight': 800, 'font-family': 'Helvetica, Arial, sans-serif' });
    t.textContent = labelTxt;
    g.appendChild(t);
    return g;
  }

  /* ---- a player under the surface ("cheeky hiding")

     A water-polo player can sink themselves to break their marker's line of sight and then burst —
     or duck so a cross-pass travels over them. It is legal. Sinking an OPPONENT is not: holding,
     sinking or pulling back another player is a major foul and an 18-second exclusion (docs/FOULS.md,
     Art. 9.8/9.9), which is why the board says which of the two it is drawing.

     What it must NOT do is invent a swimming stroke. js/manikin.js says it plainly: there is no
     motion capture and no underwater biomechanics for this game anywhere in this project. So a
     submerged player is drawn as depth and a ripple — the disc fades and its edge goes dashed, and
     a ring stays on the surface where they went down — never as a made-up underwater animation. */
  function setDepth(g, u) {
    if (!g) return;
    const d = Math.max(0, Math.min(1, +u || 0));
    g.classList.toggle('under', d > 0);
    if (!d) { g.removeAttribute('data-under'); g.style.removeProperty('--under'); return; }
    g.setAttribute('data-under', d.toFixed(2));
    g.style.setProperty('--under', String(d));
  }

  function ball() {
    const g = svg('g', { class: 'ball' });
    g.appendChild(svg('circle', { r: 3.0, fill: C('--ball'), stroke: C('--ball-edge'), 'stroke-width': 0.9, filter: 'url(#discShadow)' }));
    g.appendChild(svg('path', { d: 'M-2.4 -0.9 q2.4 -1.8 4.8 0 M-2.4 0.9 q2.4 1.8 4.8 0', stroke: C('--ball-seam'), 'stroke-width': 0.55, fill: 'none', opacity: .85 }));
    return g;
  }

  // stacked slot inside a zone — grid, filling from the right, wrapping downward
  // (narrow corner boxes therefore stack vertically)
  function stackPos(zone, i) {
    const gap = 10;
    const perRow = Math.max(1, Math.floor((zone.x1 - zone.x0 - 4) / gap));
    const col = i % perRow, row = Math.floor(i / perRow);
    return { x: (zone.x1 - 8) - col * gap, y: zone.y0 + 10 + row * 14 };
  }

  /* Which part of the pool the board shows. 'full' is the whole pool; 'half' is the attacking half.
     Nothing is redrawn — the same picture is framed differently. */
  /* TURNING THE BOARD. A coach on a bench holds the iPad however the bench lets them, and the
     players looking at it see the real pool from where THEY sit — so the board can be turned in
     quarter turns until it matches. rot is how far the picture is turned, clockwise:
       0 → the goal we attack is on the right (the way every play is drawn)
       270 → the goal is at the top — the whiteboard view, attack running up the screen
       180 → on the left      90 → at the bottom

     The turn is applied to ONE group holding the whole drawing, about the centre of the frame,
     and the viewBox is swapped to the turned frame's shape. Nothing is redrawn and no coordinate
     changes: a disc at x 250 is still at x 250, which is why every play, arrow and step keeps
     working. Dragging keeps working because eventToVB reads that group's own screen matrix, which
     includes the turn — so a finger maps back to the same board point it always did.

     Player numbers must stay readable, so css/styles.css turns each disc's number back the other
     way. That is CSS rather than code on purpose: discs are recreated on every animation frame,
     and a rule applies to all of them without anybody remembering to. */
  const ROTS = [0, 90, 180, 270];
  function setView(svgEl, mode, opts) {
    if (!svgEl) return;
    opts = opts || {};
    const deck = !!opts.deck;
    const rot = ROTS.includes(+opts.rot) ? +opts.rot : 0;
    const given = opts.frame && opts.frame.w > 0 && opts.frame.h > 0 ? opts.frame : null;
    const F = mode === 'half' ? (given || (deck ? HALF_DECK : HALF)) : { x: 0, y: 0, w: VB.w, h: VB.h };
    const cx = F.x + F.w / 2, cy = F.y + F.h / 2;
    const turned = rot === 90 || rot === 270;
    const w = turned ? F.h : F.w, h = turned ? F.w : F.h;
    svgEl.setAttribute('viewBox', `${cx - w / 2} ${cy - h / 2} ${w} ${h}`);
    const root = svgEl.querySelector('g.pool-root');
    if (root) { if (rot) root.setAttribute('transform', `rotate(${rot} ${cx} ${cy})`); else root.removeAttribute('transform'); }
    svgEl.dataset.view = mode === 'half' ? 'half' : 'full';
    svgEl.dataset.deck = deck ? '1' : '0';
    svgEl.dataset.rot = String(rot);
    // remembered so a redraw keeps the same frame rather than falling back to the plain half
    svgEl.dataset.frame = mode === 'half' ? [F.x, F.y, F.w, F.h].join(',') : '';
  }
  /* THE CAMERA — zoom, and following the ball.

     Both are the same move as the half: a frame over the drawing. The view (full, or the fitted
     half) and the turn set the BASE frame; the camera shrinks that frame by `zoom` and centres it on
     `focus` — the ball, when following it — and never lets it leave the base frame, so zooming in on
     the ball near the goal does not swing the view off the edge of the pool.

     `focus` is a BOARD point. The board may be turned, so it is carried through the same rotation
     the drawing gets before the frame is centred on it; otherwise following the ball on a turned
     board would chase a point a quarter-turn away from where the ball is drawn.

     Only the viewBox changes. The turn stays on the group, so dragging still maps through it and a
     finger still lands on the point it touches, at any zoom. */
  const ZOOM_MAX = 4;
  function setCamera(svgEl, opts) {
    if (!svgEl) return;
    opts = opts || {};
    const zoom = Math.max(1, Math.min(ZOOM_MAX, +(opts.zoom != null ? opts.zoom : svgEl.dataset.zoom) || 1));
    const kept = (svgEl.dataset.frame || '').split(',').map(Number);
    const F = svgEl.dataset.view === 'half' && kept.length === 4 && kept.every(Number.isFinite)
      ? { x: kept[0], y: kept[1], w: kept[2], h: kept[3] } : { x: 0, y: 0, w: VB.w, h: VB.h };
    const rot = +svgEl.dataset.rot || 0;
    const cx = F.x + F.w / 2, cy = F.y + F.h / 2;
    const turned = rot === 90 || rot === 270;
    const w = turned ? F.h : F.w, h = turned ? F.w : F.h;
    const zw = w / zoom, zh = h / zoom;
    let fx = cx, fy = cy;
    const f = opts.focus;
    if (f && typeof f.x === 'number' && typeof f.y === 'number') {
      const a = rot * Math.PI / 180, dx = f.x - cx, dy = f.y - cy;
      fx = cx + dx * Math.cos(a) - dy * Math.sin(a);
      fy = cy + dx * Math.sin(a) + dy * Math.cos(a);
    }
    // keep the zoomed frame inside the base frame
    fx = Math.max(cx - w / 2 + zw / 2, Math.min(cx + w / 2 - zw / 2, fx));
    fy = Math.max(cy - h / 2 + zh / 2, Math.min(cy + h / 2 - zh / 2, fy));
    svgEl.setAttribute('viewBox', `${fx - zw / 2} ${fy - zh / 2} ${zw} ${zh}`);
    svgEl.dataset.zoom = String(zoom);
    return { zoom, x: fx - zw / 2, y: fy - zh / 2, w: zw, h: zh };
  }

  /* Does this play need the deck in frame? True when any frame carries a bench player. */
  const needsDeck = frames => (frames || []).some(f => f && Array.isArray(f.extra) && f.extra.length > 0);

  /* THE FRAME A PLAY ACTUALLY NEEDS. The tight half is the starting point, and it grows to take in
     everyone this play moves — every step, both teams, the keeper, the bench, the ball.

     A fixed half was nearly right: every shipped play keeps its field players inside it. But a
     coach can draw a play, or be sent one, where somebody starts deep in the other half — a
     counter, a press — and a fixed crop would cut that player off without a word. A board shown
     to players must never hide one of them, so the frame is fitted to the play rather than the
     play being trusted to fit the frame. A play that uses the whole pool simply gets the whole
     pool: as large as it can be while still showing everybody. */
  function fitFrame(frames) {
    const M = 9;                                  // a disc's width of margin, so nobody sits on the edge
    let x0 = HALF.x, y0 = HALF.y, x1 = HALF.x + HALF.w, y1 = HALF.y + HALF.h;
    const take = p => {
      if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') return;
      x0 = Math.min(x0, p.x - M); y0 = Math.min(y0, p.y - M);
      x1 = Math.max(x1, p.x + M); y1 = Math.max(y1, p.y + M);
    };
    for (const f of frames || []) {
      if (!f) continue;
      ['att', 'def'].forEach(t => Object.values(f[t] || {}).forEach(take));
      take(f.gk);
      (Array.isArray(f.extra) ? f.extra : []).forEach(take);
      take(f.ball);
    }
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(VB.w, x1); y1 = Math.min(VB.h, y1);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  function eventToVB(svgEl, evt) {
    const pt = svgEl.createSVGPoint();
    const src = evt.touches ? evt.touches[0] : evt;
    pt.x = src.clientX; pt.y = src.clientY;
    // the turned group's own matrix includes the turn, so this maps a finger back to board space
    const frame = svgEl.querySelector('g.pool-root') || svgEl;
    const ctm = frame.getScreenCTM().inverse();
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
    for (const z of [SUB_L, SUBZONE]) if (inBox(z, p)) return { x: clamp(p.x, z.x0 + 4, z.x1 - 4), y: clamp(p.y, z.y0 + 4, z.y1 - 4) };
    return clampToWater(p);
  }
  function zoneOf(p) {
    for (const z of CORNERS) if (inBox(z, p)) return 'exc';
    if (inBox(SUB_L, p) || inBox(SUBZONE, p)) return 'sub';
    return 'water';
  }

  return { VB, WATER, SUBZONE, SUB_L, EXCZONE, CORNERS, pxPerM, fromLeft, fromRight, svg, render, disc, ball, setDepth,
           stackPos, eventToVB, clampToWater, clampAnywhere, zoneOf, HALF, HALF_DECK, ROTS, ZOOM_MAX, setView, setCamera, needsDeck, fitFrame };
})();
