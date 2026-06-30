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

    // draw movement trails for the whole scenario
    function drawPaths(scenario, focusPos) {
      clearPaths();
      const frames = scenario.frames;
      if (frames.length < 2) return;

      const drawSet = (which, teamClass) => {
        const sample = frames[0][which] || {};
        Object.keys(sample).forEach(pos => {
          const pts = frames.map(f => f[which] && f[which][pos]).filter(Boolean);
          if (pts.length < 2) return;
          const moved = pts.some((p,i) => i>0 && (Math.abs(p.x-pts[0].x)>2 || Math.abs(p.y-pts[0].y)>2));
          if (!moved) return;
          const d = pts.map((p,i) => (i===0?'M':'L') + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ');
          const focused = focusPos && String(focusPos) === String(pos) && which === 'att';
          const dim = focusPos && !focused;
          const path = POOL.svg('path', {
            d, fill:'none',
            stroke: teamClass==='att' ? '#eafdff' : (teamClass==='gk' ? '#ff8a8a' : '#9fb2c0'),
            'stroke-width': focused ? 2.4 : 1.6,
            'stroke-dasharray': teamClass==='att' ? '5 3' : '2 3',
            'stroke-linecap':'round','stroke-linejoin':'round',
            opacity: dim ? 0.18 : (teamClass==='att'?0.95:0.5),
            'marker-end':'url(#arrow)',
            color: teamClass==='att' ? '#eafdff' : '#9fb2c0',
          });
          layers.pathLayer.appendChild(path);
        });
      };
      drawSet('att','att');
      drawSet('def','def');
      drawSet('gk','gk'); // gk is object not map; handle below
      // gk path (single)
      const gkPts = frames.map(f => f.gk).filter(Boolean);
      if (gkPts.length>1) {
        const moved = gkPts.some((p,i)=>i>0 && (Math.abs(p.x-gkPts[0].x)>2||Math.abs(p.y-gkPts[0].y)>2));
        if (moved) {
          const d = gkPts.map((p,i)=>(i===0?'M':'L')+p.x.toFixed(1)+' '+p.y.toFixed(1)).join(' ');
          layers.pathLayer.appendChild(POOL.svg('path',{ d, fill:'none', stroke:'#ff8a8a','stroke-width':1.4,'stroke-dasharray':'2 3','marker-end':'url(#arrow)', color:'#ff8a8a', opacity: focusPos && focusPos!=='GK'?0.18:0.7 }));
        }
      }
    }

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

  return { Renderer, Player, stateAt, ballPoint };
})();
