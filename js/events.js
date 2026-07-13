/* ============================================================
   events.js — Phase 3 heuristic event detection.

   Turns a time series of board positions (the trajectories the
   tracker produces) into an auto-tagged timeline — no model, pure
   geometry on the tracks we already have:
     · possession — the player nearest the ball (within reach) holds it
     · turnover   — the holding TEAM changes
     · shot       — the ball accelerates toward the goal from the
       attacking third
     · goal       — the ball reaches the goal mouth

   Honest scope: EXCLUSIONS are deliberately NOT inferred here — a
   kick-out is a referee decision, not readable from positions alone.
   That needs the trained model / referee signal (a later phase).

   Every event carries the board frame at its moment, so the coach can
   confirm it straight onto the board. Deterministic + unit-tested.
   ============================================================ */
const EVENTS = (() => {
  const GOAL_X = 294, GOAL_TOP = 92, GOAL_BOT = 128, CY = 110;

  const ballAt = f => (f && f.ball && f.ball.x != null) ? { x: f.ball.x, y: f.ball.y } : null;
  function holderAt(f, R) {
    const b = ballAt(f); if (!b) return null;
    let best = null, bd = R;
    const scan = (map, team) => Object.keys(map || {}).forEach(pos => { const p = map[pos]; const d = Math.hypot(p.x - b.x, p.y - b.y); if (d < bd) { bd = d; best = { team, pos }; } });
    scan(f.att, 'att'); scan(f.def, 'def');
    if (f.gk) { const d = Math.hypot(f.gk.x - b.x, f.gk.y - b.y); if (d < bd) { bd = d; best = { team: 'def', pos: 'GK' }; } }
    return best;
  }
  const zoneOf = y => y < (GOAL_TOP + CY) / 2 ? 'T' : (y > (GOAL_BOT + CY) / 2 ? 'B' : 'M');

  /* detect(series, opts) — series = [{ t, boardFrame }] sorted by t.
     → events [{ t, type, team?, pos?, zone?, origin?, conf, frame }] */
  function detect(series, opts) {
    opts = opts || {};
    const R = opts.possR || 24;                 // "reach" of a holder (board units)
    const shotSpeed = opts.shotSpeed || 140;    // board units / second toward goal
    const stableN = opts.stableN || 2;          // frames a hold must persist
    const evts = [];
    if (!series || series.length < 2) return evts;

    // possession + turnover
    const holders = series.map(s => holderAt(s.boardFrame, R));
    let curTeam = null, stable = 0, lastTeam = null;
    for (let i = 0; i < series.length; i++) {
      const team = holders[i] && holders[i].team;
      if (team === curTeam) stable++; else { curTeam = team; stable = 1; }
      if (team && stable === stableN && team !== lastTeam) {
        if (lastTeam) evts.push({ t: series[i].t, type: 'turnover', team, conf: 0.5, frame: series[i].boardFrame });
        evts.push({ t: series[i].t, type: 'possession', team, pos: holders[i].pos, conf: 0.6, frame: series[i].boardFrame });
        lastTeam = team;
      }
    }

    // shots + goals from the ball trajectory
    let lastShotT = -1e9;
    for (let i = 1; i < series.length; i++) {
      const b0 = ballAt(series[i - 1].boardFrame), b1 = ballAt(series[i].boardFrame);
      if (!b0 || !b1) continue;
      const dt = (series[i].t - series[i - 1].t) || 0.1;
      const vx = (b1.x - b0.x) / dt;
      if (b1.x >= GOAL_X - 2 && b1.y >= GOAL_TOP && b1.y <= GOAL_BOT) {
        evts.push({ t: series[i].t, type: 'goal', zone: zoneOf(b1.y), origin: { x: +b0.x.toFixed(1), y: +b0.y.toFixed(1) }, conf: 0.55, frame: series[i].boardFrame });
        lastShotT = series[i].t; continue;
      }
      if (vx > shotSpeed && b1.x > 200 && (series[i].t - lastShotT) > 0.35) {
        evts.push({ t: series[i].t, type: 'shot', zone: zoneOf(b1.y), origin: { x: +b0.x.toFixed(1), y: +b0.y.toFixed(1) }, conf: 0.5, frame: series[i].boardFrame });
        lastShotT = series[i].t;
      }
    }

    return evts.sort((a, b) => a.t - b.t);
  }

  return { detect, holderAt, GOAL_X };
})();

// Node/CommonJS interop (no-op in the browser)
if (typeof module !== "undefined" && module.exports) module.exports = EVENTS;
