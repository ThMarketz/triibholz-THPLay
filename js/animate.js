/* ============================================================
   animate.js — render a scenario state onto a pool, interpolate
   between keyframes, draw movement paths, and run playback.
   ============================================================ */
const ANIM = (() => {

  const BALL_OFF = { x: 7, y: -7 };   // ball offset when held

  function discPos(frame, carrier) {
    if (!carrier) return null;
    const team = carrier[0];
    const pos = carrier.slice(1);
    if (team === 'A') return frame.att && frame.att[pos];
    if (team === 'D') return frame.def && frame.def[pos];
    if (carrier === 'GK') return frame.gk;
    return null;
  }

  // logical ball point for a frame
  function ballPoint(frame) {
    const b = frame.ball || {};
    if (b.carrier) {
      const p = discPos(frame, b.carrier);
      if (p) return { x: p.x + BALL_OFF.x, y: p.y + BALL_OFF.y, team: b.carrier[0] === 'D' ? 'D' : (b.carrier === 'GK' ? 'GK' : 'A') };
    }
    return { x: b.x != null ? b.x : 160, y: b.y != null ? b.y : 110, team: null };
  }

  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2;  // easeInOutQuad

  function lerpPt(a, b, t) {
    if (!a) return b; if (!b) return a;
    return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
  }

  // compute interpolated state for global progress 0..1
  function stateAt(scenario, tGlobal) {
    const frames = scenario.frames;
    const nSeg = Math.max(1, frames.length - 1);
    let g = Math.min(0.99999, Math.max(0, tGlobal)) * nSeg;
    let idx = Math.floor(g);
    let local = ease(g - idx);
    if (frames.length === 1) { idx = 0; local = 0; }
    const A = frames[idx], B = frames[Math.min(idx + 1, frames.length - 1)];

    const out = { att:{}, def:{}, gk:null, ball:null, extra:[] };
    const keysA = (o) => o ? Object.keys(o) : [];
    keysA(A.att).forEach(p => out.att[p] = lerpPt(A.att[p], B.att && B.att[p], local));
    keysA(A.def).forEach(p => out.def[p] = lerpPt(A.def[p], B.def && B.def[p], local));
    out.gk = lerpPt(A.gk, B.gk, local);
    // waiting / extra discs (subs, excluded) interpolated by index
    const exA = A.extra || [], exB = B.extra || [];
    exA.forEach((e, i) => {
      const t = exB[i] || e;
      out.extra.push({ team: e.team, label: e.label, x: lerp(e.x, t.x, local), y: lerp(e.y, t.y, local) });
    });
    const ba = ballPoint(A), bb = ballPoint(B);
    out.ball = { x: lerp(ba.x, bb.x, local), y: lerp(ba.y, bb.y, local), team: bb.team || ba.team };
    return out;
  }

  /* ---------- whiteboard tactics: movement + pass arrows ----------
     Coaching convention: SOLID arrow = player movement (one arrow per step),
     DASHED orange arrow with a numbered chip = pass / ball travel.
     Defenders and the keeper stay as faint context so the attack reads first. */
  function drawTactics(layers, scenario, focusPos) {
    while (layers.pathLayer.firstChild) layers.pathLayer.removeChild(layers.pathLayer.firstChild);
    const frames = scenario.frames;
    if (!frames || frames.length < 2) return;
    const moved = (a, b) => a && b && (Math.abs(a.x-b.x) > 3 || Math.abs(a.y-b.y) > 3);
    // pull both ends in so arrows sit BESIDE discs, not underneath them
    const trim = (a, b, ts, te) => {
      const dx=b.x-a.x, dy=b.y-a.y, L=Math.hypot(dx,dy);
      if (L <= ts+te+4) { const m={x:(a.x+b.x)/2,y:(a.y+b.y)/2}; return [{x:m.x-dx*0.3,y:m.y-dy*0.3},{x:m.x+dx*0.3,y:m.y+dy*0.3}]; }
      const ux=dx/L, uy=dy/L;
      return [{x:a.x+ux*ts,y:a.y+uy*ts},{x:b.x-ux*te,y:b.y-uy*te}];
    };

    // defenders + GK first (underneath): faint dashed context trails
    const ctxTrail = (pts, color, focused) => {
      if (pts.length < 2 || !pts.some((p,i)=>i>0 && moved(pts[0], p))) return;
      const d = pts.map((p,i)=>(i?'L':'M')+p.x.toFixed(1)+' '+p.y.toFixed(1)).join(' ');
      layers.pathLayer.appendChild(POOL.svg('path', { d, fill:'none', stroke:color,
        'stroke-width': focused ? 2.2 : 1.1, 'stroke-dasharray':'3 3',
        'marker-end': focused ? 'url(#arrowCtx)' : null,
        opacity: focused ? 0.95 : (focusPos ? 0.1 : 0.28),
        'stroke-linecap':'round','stroke-linejoin':'round' }));
    };
    Object.keys(frames[0].def || {}).forEach(pos => {
      ctxTrail(frames.map(f=>f.def && f.def[pos]).filter(Boolean), '#9fb2c0', false);
    });
    ctxTrail(frames.map(f=>f.gk).filter(Boolean), '#ff8a8a', focusPos==='GK');

    // attacker movement: one SOLID arrow per step segment
    Object.keys(frames[0].att || {}).forEach(pos => {
      const focused = focusPos && focusPos!=='GK' && String(focusPos)===String(pos);
      const dim = focusPos && !focused;
      for (let i=0; i<frames.length-1; i++) {
        const a0 = frames[i].att && frames[i].att[pos], b0 = frames[i+1].att && frames[i+1].att[pos];
        if (!moved(a0, b0) || Math.hypot(b0.x-a0.x, b0.y-a0.y) < 9) continue;   // micro-adjusts stay silent
        const [a, b] = trim(a0, b0, 7.5, 8.5);
        layers.pathLayer.appendChild(POOL.svg('path', {
          d:`M${a.x.toFixed(1)} ${a.y.toFixed(1)} L${b.x.toFixed(1)} ${b.y.toFixed(1)}`,
          fill:'none', stroke:'#eafdff', 'stroke-width': focused ? 2.8 : 2.2,
          'marker-end':'url(#arrow)',
          opacity: dim ? 0.12 : 0.95, 'stroke-linecap':'round' }));
      }
    });

    // ball travel: dashed orange arrows with numbered step chips
    let passNo = 0;
    for (let i=0; i<frames.length-1; i++) {
      const a0 = ballPoint(frames[i]), b0 = ballPoint(frames[i+1]);
      if (!moved(a0, b0)) continue;
      passNo++;
      const [a, b] = trim(a0, b0, 5, 6.5);
      const g = POOL.svg('g', { class:'pass-arrow' });
      g.appendChild(POOL.svg('path', {
        d:`M${a.x.toFixed(1)} ${a.y.toFixed(1)} L${b.x.toFixed(1)} ${b.y.toFixed(1)}`,
        fill:'none', stroke:'#ffb057', 'stroke-width':1.7, 'stroke-dasharray':'4.5 3',
        'marker-end':'url(#arrowBall)',
        opacity: focusPos ? 0.55 : 0.95, 'stroke-linecap':'round' }));
      // rectangular step badge — deliberately NOT round, so it can't read as a ball
      const mx=(a.x+b.x)/2, my=(a.y+b.y)/2;
      g.appendChild(POOL.svg('rect', { x:mx-4, y:my-3.6, width:8, height:7.2, rx:1.6,
        fill:'#ff7a18', stroke:'#fff', 'stroke-width':0.8 }));
      const t = POOL.svg('text', { x:mx, y:my+2.2, 'text-anchor':'middle', 'font-size':5.6,
        'font-weight':800, fill:'#fff', 'font-family':'Helvetica, Arial, sans-serif' });
      t.textContent = passNo; g.appendChild(t);
      layers.pathLayer.appendChild(g);
    }
  }

  /* ---------- a Renderer bound to one svg ---------- */
  function Renderer(svgEl) {
    const layers = POOL.render(svgEl);
    let discEls = {};   // cache disc <g> by key e.g. 'A1','D2','GK'

    function ensureDisc(key, team, label, small) {
      if (discEls[key]) return discEls[key];
      const g = POOL.disc(team, label, small);
      g.dataset.key = key;
      layers.discLayer.appendChild(g);
      discEls[key] = g;
      return g;
    }
    function ensureBall() {
      if (discEls.__ball) return discEls.__ball;
      const b = POOL.ball();
      layers.discLayer.appendChild(b);
      discEls.__ball = b;
      return b;
    }
    function place(g, p) { g.setAttribute('transform', `translate(${p.x.toFixed(2)},${p.y.toFixed(2)})`); }

    function clearPaths() { while (layers.pathLayer.firstChild) layers.pathLayer.removeChild(layers.pathLayer.firstChild); }

    // whiteboard-style tactics are drawn by the shared drawTactics()
    function drawPaths(scenario, focusPos) { drawTactics(layers, scenario, focusPos); }

    // render a state (interpolated or a single frame's geometry)
    function renderState(scenario, state, focusPos) {
      const dimOthers = !!focusPos;
      // attackers
      const seen = new Set();
      Object.keys(state.att).forEach(pos => {
        const key='A'+pos; seen.add(key);
        const g = ensureDisc(key,'A',pos);
        place(g, state.att[pos]);
        const focused = focusPos==='GK'? false : (focusPos && String(focusPos)===String(pos));
        g.style.opacity = dimOthers ? (focused?'1':'0.35') : '1';
        g.classList.toggle('focused', focused);
      });
      Object.keys(state.def).forEach(pos => {
        const key='D'+pos; seen.add(key);
        const g = ensureDisc(key,'D',pos);
        place(g, state.def[pos]);
        g.style.opacity = dimOthers ? '0.3' : '1';
        g.classList.remove('focused');
      });
      if (state.gk) {
        const key='GK'; seen.add(key);
        const g = ensureDisc(key,'GK','GK');
        place(g, state.gk);
        const focused = focusPos==='GK';
        g.style.opacity = dimOthers ? (focused?'1':'0.35') : '1';
        g.classList.toggle('focused', focused);
      }
      // waiting / extra discs
      (state.extra || []).forEach((e, i) => {
        const key = 'X'+i; seen.add(key);
        const g = ensureDisc(key, e.team, e.label, true);
        place(g, e);
        g.style.opacity = dimOthers ? '0.5' : '0.95';
        g.classList.remove('focused');
      });
      // remove discs not in this scenario
      Object.keys(discEls).forEach(k => {
        if (k==='__ball') return;
        if (!seen.has(k)) { layers.discLayer.removeChild(discEls[k]); delete discEls[k]; }
      });
      // ball
      const b = ensureBall();
      place(b, state.ball);
      b.style.opacity = dimOthers ? '0.95' : '1';
    }

    function draw(scenario, opts) {
      opts = opts || {};
      const t = opts.t != null ? opts.t : 0;
      if (opts.showPaths !== false) drawPaths(scenario, opts.focusPos);
      else clearPaths();
      renderState(scenario, stateAt(scenario, t), opts.focusPos);
    }

    function destroy() { discEls = {}; }

    return { draw, drawPaths, renderState, clearPaths, layers, destroy, svgEl };
  }

  /* ---------- Player: drives a Renderer over time ---------- */
  function Player(renderer, scenario, onFrame) {
    let raf=null, playing=false, t=0, dur=0, startTs=0, baseT=0;
    let focusPos=null, showPaths=true;

    function segCount(){ return Math.max(1, scenario.frames.length-1); }
    function setScenario(s){ scenario=s; t=0; render(); }
    function setFocus(p){ focusPos=p||null; render(); }
    function setPaths(v){ showPaths=v; render(); }

    function render(){ renderer.draw(scenario, { t, focusPos, showPaths }); if(onFrame) onFrame(t, currentStep(), segCount()); }

    function currentStep(){
      // nearest frame index for the step label
      return Math.round(t*segCount());
    }
    function seek(tt){ stop(); t=Math.max(0,Math.min(1,tt)); render(); }
    function gotoStep(i){ const n=segCount(); seek(n===0?0:i/n); }
    function stepFwd(){ gotoStep(Math.min(segCount(), currentStep()+1)); }
    function stepBack(){ gotoStep(Math.max(0, currentStep()-1)); }

    function play(){
      if (scenario.frames.length<2){ render(); return; }
      if (t>=0.999) t=0;
      playing=true; baseT=t; startTs=null;
      dur = 1100 * segCount();      // ~1.1s per step
      const tick=(ts)=>{
        if(!playing) return;
        if(startTs==null) startTs=ts;
        const elapsed=ts-startTs;
        t = Math.min(1, baseT + (elapsed/dur)*(1-baseT));
        render();
        if(t>=1){ playing=false; if(onState)onState(false); return; }
        raf=requestAnimationFrame(tick);
      };
      if(onState)onState(true);
      raf=requestAnimationFrame(tick);
    }
    function pause(){ playing=false; if(raf)cancelAnimationFrame(raf); if(onState)onState(false); }
    function stop(){ pause(); }
    function toggle(){ playing?pause():play(); }
    let onState=null; function setOnState(fn){ onState=fn; }

    render();
    return { play, pause, toggle, stop, seek, stepFwd, stepBack, gotoStep, currentStep, segCount, setScenario, setFocus, setPaths, setOnState, get playing(){return playing;}, get t(){return t;} };
  }

  return { Renderer, Player, stateAt, ballPoint, drawTactics };
})();
