/* ============================================================
   draft.js — "Draft from words": a coach writes the play in
   plain language and the board builds it live.

   Grammar (English, coach vocabulary):
   · one LINE = one step (keyframe); "then" also splits a line
   · actors: 1..6, GK — plus "hole"/"center" (=6), "point" (=3)
   · "3 has the ball" — sets the carrier
   · movement: drives/swims/cuts/goes/moves/lifts/drops/posts up/
     seals/relocates + a spot: wing, post, near/far post, hole,
     2m, point, middle, flat, 5m, 6m, baseline, outside, goal —
     or a direction: left/right/up/down/in/forward/back/out
   · pass: "3 passes to 2", "feeds 6", "kicks to 5", "ball to 2"
   · shot: shoots/scores/finishes [near/far + high/low corner]
   Every recognised clause also fills that player's assignment.
   ============================================================ */
const DRAFT = (() => {

  const CY = 110;
  // named spots on the board (attack → right goal)
  function spotFor(name, cur) {
    const side = (cur && cur.y > CY) ? 1 : -1;          // keep the player's side
    const y = cur ? cur.y : CY;
    const S = {
      'point':        { x: 226, y: CY },
      'top':          { x: 230, y: 80 },
      'middle':       { x: 248, y: CY },
      'centre':       { x: 248, y: CY },
      'center':       { x: 248, y: CY },
      'hole':         { x: 271, y: CY },
      'set':          { x: 271, y: CY },
      '2m':           { x: 271, y: CY },
      '2 m':          { x: 271, y: CY },
      'post':         { x: 277, y: CY + side * 20 },
      'near post':    { x: 277, y: 92 },
      'far post':     { x: 277, y: 128 },
      'wing':         { x: 262, y: side > 0 ? 165 : 55 },
      'flat':         { x: 238, y: side > 0 ? 132 : 88 },
      '5m':           { x: 241, y },
      '5 m':          { x: 241, y },
      '6m':           { x: 231, y },
      '6 m':          { x: 231, y },
      'baseline':     { x: 283, y },
      'goal':         { x: 288, y: CY },
      'outside':      { x: 222, y },
    };
    return S[name] || null;
  }
  const DIRS = {
    left:{dx:0,dy:-18}, up:{dx:0,dy:-18},
    right:{dx:0,dy:18}, down:{dx:0,dy:18},
    forward:{dx:16,dy:0}, in:{dx:16,dy:0}, inside:{dx:16,dy:0},
    back:{dx:-16,dy:0}, out:{dx:-14,dy:0},
  };
  const clampW = p => ({ x: Math.max(28, Math.min(292, p.x)), y: Math.max(34, Math.min(186, p.y)) });

  const ACTOR = '(?:(?:white\\s*cap|player)\\s*)?([1-6]|gk|goalie|keeper|hole|center|centre|point)';
  const DEF_ACTOR = '(?:defender|defence|defense|def|black(?:\\s*cap)?)\\s*([1-6]|gk)';
  const posOf = w => {
    w = w.toLowerCase();
    if (w === 'gk' || w === 'goalie' || w === 'keeper') return 'GK';
    if (w === 'hole' || w === 'center' || w === 'centre') return '6';
    if (w === 'point') return '3';
    return w;
  };
  const MOVE_VERB = '(?:drives?|swims?|cuts?|go(?:es)?|moves?|lifts?|drops?|posts?\\s*up|seals?|relocates?|sprints?)';
  const SPOT_WORDS = 'near post|far post|2 ?m|5 ?m|6 ?m|point|middle|centre|center|hole|set|post|wing|flat|baseline|goal|outside|top';
  const DIR_WORDS = 'left|right|up|down|forward|inside|in|back|out';

  function getPos(frame, pos) {
    if (pos === 'GK') return frame.gk;
    return frame.att[pos];
  }
  function setPos(frame, pos, pt) {
    if (pos === 'GK') frame.gk = pt; else frame.att[pos] = pt;
  }

  /* parse(text, situation) → { frames, notes, report } */
  function parse(text, situation) {
    const base = DATA.defaultFrame(situation);
    const frames = [ JSON.parse(JSON.stringify(base)) ];
    const notes = {};
    const report = [];
    let carrier = frames[0].ball.carrier || null;   // e.g. 'A3'
    const addNote = (pos, txt) => {
      if (pos === 'GK') { notes.GK = notes.GK ? notes.GK + ' ' + txt : txt; return; }
      notes[pos] = notes[pos] ? notes[pos] + ' ' + txt : txt;
    };
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

    const lines = (text || '').split(/\n| then |;/i).map(l => l.trim()).filter(Boolean);
    for (const rawLine of lines) {
      const line = rawLine.toLowerCase().replace(/[.!]+$/,'');
      const understood = [];
      let frame = null;                              // created lazily on first action
      const needFrame = () => {
        if (!frame) { frame = JSON.parse(JSON.stringify(frames[frames.length-1])); frames.push(frame); }
        return frame;
      };

      // clause split within a step: "and", "while", commas
      const clauses = line.split(/,| and | while /).map(c => c.trim()).filter(Boolean);
      for (const c of clauses) {
        let m;

        // "3 has the ball"
        if ((m = c.match(new RegExp('^' + ACTOR + '\\s+(?:has|starts with|holds|takes)\\s+the\\s+ball')))) {
          const p = posOf(m[1]);
          carrier = p === 'GK' ? 'GK' : 'A' + p;
          frames[frames.length-1].ball = { carrier };
          understood.push(`● ball starts with ${m[1].toUpperCase()}`);
          addNote(p, 'Start with the ball.');
          continue;
        }

        // pass: "3 passes to 2" / "feeds 6" / "ball to 2"
        if ((m = c.match(new RegExp('^' + ACTOR + '\\s+(?:pass(?:es)?|feeds?|kicks?|dish(?:es)?|swings?(?:\\s+it)?)\\s*(?:it\\s*)?(?:to|into)?\\s*' + ACTOR)))
          || (m = c.match(new RegExp('^ball\\s+(?:to|goes to)\\s+' + ACTOR)))) {
          const from = m.length > 2 ? posOf(m[1]) : null;
          const to = posOf(m.length > 2 ? m[2] : m[1]);
          const f = needFrame();
          carrier = to === 'GK' ? 'GK' : 'A' + to;
          f.ball = { carrier };
          understood.push(`➤ pass ${from ? from + ' ' : ''}→ ${to}`);
          if (from) addNote(from, cap(c) + '.');
          addNote(to, 'Receive the ball.');
          continue;
        }

        // shot: "2 shoots far corner"
        if ((m = c.match(new RegExp('^' + ACTOR + '\\s+(?:shoots?|scores?|finish(?:es)?|fires?)(?:\\s+(?:to\\s+)?(?:the\\s+)?([a-z ]+))?')))) {
          const p = posOf(m[1]);
          const where = (m[2] || '').trim();
          const f = needFrame();
          const shooter = getPos(f, p) || { x: 250, y: CY };
          let ty = CY;
          if (/far/.test(where))  ty = shooter.y <= CY ? 126 : 94;
          if (/near/.test(where)) ty = shooter.y <= CY ? 94 : 126;
          if (/high|top/.test(where)) ty = Math.min(ty, 98);
          if (/low|bottom/.test(where)) ty = Math.max(ty, 122);
          f.ball = { carrier: null, x: 293, y: ty };
          carrier = null;
          understood.push(`◎ ${m[1].toUpperCase()} shoots${where ? ' ' + where : ''}`);
          addNote(p, cap(c) + '.');
          continue;
        }

        // defender pressure/foul: "defender 6 tries to foul 2", "black cap 6 fouls him"
        if ((m = c.match(new RegExp('^' + DEF_ACTOR + '\\s+(?:tries?\\s+to\\s+foul|fouls?|presses?|pressures?|guards?|marks?)(?:\\s+(?:player\\s*|white\\s*cap\\s*|him|it)*\\s*([1-6]|hole|centre|center|point))?')))) {
          const dp = (m[1] || '').toLowerCase() === 'gk' ? 'GK' : m[1];
          const f = needFrame();
          const tp = m[2] ? posOf(m[2]) : (carrier && carrier[0] === 'A' ? carrier.slice(1) : null);
          const tgt = tp && f.att[tp] ? f.att[tp] : null;
          if (tgt && f.def && f.def[dp]) f.def[dp] = clampW({ x: tgt.x + 7, y: tgt.y }); // step goal-side onto him
          understood.push(`⚠ defender ${m[1].toUpperCase()} pressures ${tp || 'the ball'}`);
          if (tp) addNote(tp, `Beat the pressure/foul from defender ${m[1]} — protect the ball.`);
          continue;
        }

        // screen: "3 screens for 2"
        if ((m = c.match(new RegExp('^' + ACTOR + '\\s+(?:screens?|picks?)\\s+(?:for\\s+)?' + ACTOR)))) {
          const p = posOf(m[1]), forP = posOf(m[2]);
          const f = needFrame();
          const target = getPos(f, forP);
          if (target) setPos(f, p, clampW({ x: target.x + 8, y: target.y - 10 }));
          understood.push(`▣ ${m[1].toUpperCase()} screens for ${m[2].toUpperCase()}`);
          addNote(p, cap(c) + '.');
          continue;
        }

        // movement: "3 drives to the middle", "2 lifts to the wing", "4 drops back"
        if ((m = c.match(new RegExp('^' + ACTOR + '\\s+' + MOVE_VERB +
              '(?:\\s+(?:to|into|at|toward|towards)?\\s*(?:the\\s+)?(' + SPOT_WORDS + '|' + DIR_WORDS + '))?')))) {
          const p = posOf(m[1]);
          const word = (m[2] || '').trim();
          const f = needFrame();
          const cur = getPos(f, p);
          if (!cur) { report.push({ text: rawLine, ok:false, msg:`player ${m[1]} is not in this situation` }); continue; }
          let np = null;
          if (word && DIRS[word]) np = { x: cur.x + DIRS[word].dx, y: cur.y + DIRS[word].dy };
          else if (word) np = spotFor(word, cur);
          else if (/posts?\s*up|seals?/.test(c)) np = spotFor('hole', cur);
          else np = { x: cur.x + 14, y: cur.y };      // unspecified: push forward
          // "on the right/left (hand) side" biases the vertical side (attack → right goal)
          if (word && !DIRS[word]) {
            if (/\bright\b/.test(c)) np = { x: np.x, y: 150 };
            else if (/\bleft\b/.test(c)) np = { x: np.x, y: 70 };
          }
          setPos(f, p, clampW(np));
          if (carrier === (p === 'GK' ? 'GK' : 'A' + p)) f.ball = { carrier };
          understood.push(`→ ${m[1].toUpperCase()} → ${word || 'forward'}`);
          addNote(p, cap(c) + '.');
          continue;
        }

        understood.push(`〰 not understood: “${c}”`);
      }

      report.push({ text: rawLine, ok: understood.some(u => !u.startsWith('〰')), parts: understood });
    }

    return { frames, notes, report, steps: frames.length };
  }

  return { parse, spotFor };
})();
