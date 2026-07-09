/* ============================================================
   solver.js — Solutions Lab: a tactical "what should I do?" advisor.

   The coach/player asks a situation question in plain words
   ("I swim alone at the keeper who comes out to 5 m — what do I
   do, can they foul me?") and the tool returns a worked SOLUTION:
   what to do, the relevant RULES, and an illustrated play on the
   board (built from a DRAFT script, so it animates with arrows).

   Rules statements follow the in-app 2025 World Aquatics facts
   (5 m penalty line, 18 s exclusion, keeper privileges only inside
   their own defensive area). No rule text is reproduced verbatim.
   ============================================================ */
const SOLVER = (() => {

  /* Each problem carries keyword tags for matching, a plain answer
     (bullets), rules Q&A, and a DRAFT script that draws the board. */
  const PROBLEMS = [

    { id:'alone-vs-gk-out', phase:'offense', situation:'GK',
      title:'Alone on the keeper — and they come out to 5 m',
      q:'I swim alone toward goal and the goalkeeper comes out to about 5 m. What do I do — and can the keeper foul me?',
      tags:['alone','breakaway','one on one','1 on 1','1 on gk','keeper','goalie','goalkeeper','comes out','out at 5m','5m','five metre','swim','solo','open','shoot','lob','foul','penalty'],
      script:'1 has the ball\n1 drives to the middle\n1 shoots far corner',
      answer:[
        'The moment the keeper leaves the line the goal opens up BEHIND them — your window is before they set their feet.',
        'First choice: shoot early or LOB / roll the ball over the advancing keeper into the empty net. Don’t swim into their body.',
        'If they keep charging, change pace — stop, let them commit, then go around the side they’ve over-committed to.',
        'A quick pump-fake freezes an out-of-position keeper; then finish low to the near corner or lob high.',
      ],
      rules:[
        { q:'Can the goalkeeper foul me?',
          a:'Once the keeper leaves their own defensive area they are effectively an ordinary field player. They can commit an ordinary foul (you get a free throw) but may NOT hold, sink or pull you back — that is a major foul (exclusion).' },
        { q:'What if they foul me to stop a certain goal?',
          a:'A foul that stops a probable goal from close range is a PENALTY throw, taken from the 5 m line. So if the keeper is out and fouls you as you’re about to score, that usually wins you a penalty.' },
        { q:'Can I be penalised for the contact?',
          a:'Yes — if YOU launch into the keeper and cause the contact, the foul can be called against you. Attack the open water and the ball, not the keeper.' },
      ] },

    { id:'two-on-one', phase:'offense', situation:'2v1',
      title:'2-on-1 fast break',
      q:'We have a 2-on-1 on the counter. How do we finish it?',
      tags:['2 on 1','two on one','fast break','counter','advantage','pass','finish','odd man'],
      script:'1 has the ball\n1 drives to the goal\n1 passes to 2\n2 shoots near corner',
      answer:[
        'Attack the goal with the ball to force the lone defender (or keeper) to commit to YOU.',
        'Read the defender: if they take you, pass late to the open teammate; if they sag off, shoot.',
        'Pass LATE and flat — an early pass lets the defender recover to the second attacker.',
      ],
      rules:[ { q:'Any rule to use here?', a:'None special — just don’t force a charge. If the defender fouls to stop a close finish it can be a penalty.' } ] },

    { id:'three-on-two', phase:'offense', situation:'3v2',
      title:'3-on-2 overload',
      q:'We’re 3-on-2 up the pool. Best way to score?',
      tags:['3 on 2','three on two','overload','extra','break','swing','fast break'],
      script:'3 has the ball\n3 drives to the middle\n3 passes to 2\n2 shoots far corner',
      answer:[
        'Two defenders can’t cover three — attack the middle to pull them together, then swing to the free man.',
        'Move the ball first-time; the second pass is usually the open shot.',
        'Keep width: the wider your outside men, the more the two defenders have to slide.',
      ],
      rules:[ { q:'Clock?', a:'You have the 28 s possession clock, but on a break shoot early before the defence recovers.' } ] },

    { id:'man-up-6v5', phase:'offense', situation:'6v5',
      title:'Power play (6-on-5, man-up)',
      q:'We drew a kick-out. How do we score on the 6-on-5?',
      tags:['man up','6 on 5','6-5','power play','extra man','exclusion','kick out','advantage'],
      script:'3 has the ball\n3 passes to 2\n2 passes to 6\n6 shoots near corner',
      answer:[
        'Set your shape (4-2 or 3-3) and move the ball first-time — make the five defenders shift, don’t let them set.',
        'The post/2 m man and the weak-side shooter are the targets; the extra pass beats the block.',
        'You have ~18 s of exclusion — patience for one clean look beats a rushed shot.',
      ],
      rules:[ { q:'How long is the man-up?', a:'An exclusion lasts 18 s (or until a goal / change of possession). The excluded player re-enters from their own corner re-entry area.' } ] },

    { id:'hole-fronted', phase:'offense', situation:'6v6',
      title:'Our hole set is fronted',
      q:'The defender is fronting our 2 m man. How do we still feed the hole?',
      tags:['hole','2m','set','fronted','front','feed','post','centre forward','entry pass'],
      script:'3 has the ball\n6 posts up at 2m\n3 passes to 6\n6 shoots near corner',
      answer:[
        'Change the angle: reverse the ball across the top so the front defender is now on the wrong side.',
        'Lob the entry pass over the front to the hole’s ball-side hand.',
        'Hole seals hard and re-posts ball-side the instant the ball swings.',
      ],
      rules:[ { q:'Can the defender front and hold?', a:'Fronting is legal; holding, sinking or pulling the set is a major foul — draw it and you get the power play.' } ] },

    { id:'pressed-all-over', phase:'offense', situation:'6v6',
      title:'They press us all over',
      q:'The defence is pressing us everywhere and denying passes. How do we break it?',
      tags:['press','pressed','deny','pressure','man to man','break press','screen','give and go'],
      script:'3 has the ball\n2 screens for 3\n3 drives to the middle\n3 shoots far corner',
      answer:[
        'Pressure leaves space behind it — beat it with a screen for a driver, or a give-and-go.',
        'Move the ball quickly; the longer you hold, the more the press sets.',
        'One player drives hard to collapse the press, then kicks to the freed teammate.',
      ],
      rules:[ { q:'Screens legal?', a:'A stationary screen is legal; moving into a defender to block them is an offensive foul.' } ] },

    { id:'last-shot-clock', phase:'offense', situation:'6v6',
      title:'Seconds left on the shot clock',
      q:'We have only a few seconds left on the 28 s clock. What do we run?',
      tags:['shot clock','28','seconds left','last shot','buzzer','end of possession','quick shot'],
      script:'3 has the ball\n2 screens for 3\n3 shoots far corner',
      answer:[
        'Get the ball to your best perimeter shooter with a quick screen.',
        'Shoot before the buzzer — a shot that’s in the air at the horn counts.',
        'No hero drives into traffic; take the clean outside look.',
      ],
      rules:[ { q:'What resets the clock?', a:'A shot that hits the goal/keeper or a defensive foul resets possession; run down, then shoot.' } ] },

    { id:'draw-exclusion', phase:'offense', situation:'1v1',
      title:'How do I draw a kick-out?',
      q:'How do I draw an exclusion foul on my defender?',
      tags:['draw','exclusion','kick out','major foul','win','position','drive','earn power play'],
      script:'1 has the ball\n1 drives to the middle',
      answer:[
        'Win body position ball-side and drive at the defender — make them defend from behind.',
        'If they hold, sink or climb your back to stop you, that’s an exclusion → power play.',
        'Present a shooting threat: defenders foul when they think you’re about to score.',
      ],
      rules:[ { q:'Ordinary vs major?', a:'Impeding a player not holding the ball is ordinary (free throw). Holding, sinking or pulling back is major — 18 s exclusion.' } ] },

    { id:'penalty-taker', phase:'offense', situation:'GK',
      title:'I have a 5 m penalty',
      q:'We were awarded a 5 m penalty. How should I take it?',
      tags:['penalty','5m','five metre','penalty shot','spot','free shot','one on keeper'],
      script:'1 has the ball\n1 shoots low corner',
      answer:[
        'Decide your corner before the whistle and commit — don’t change your mind mid-shot.',
        'Hard and flat to a corner (low near or high far) beats a set keeper.',
        'Take your time setting the ball; the keeper must stay on the line until you shoot.',
      ],
      rules:[ { q:'Where from & keeper?', a:'The penalty is taken from the 5 m line. The keeper must not advance off the goal line before the shot leaves your hand.' } ] },

    { id:'defend-hole-set', phase:'defense', situation:'6v6',
      title:'Defending a dominant hole set',
      q:'Their 2 m man is killing us. How do we defend the hole?',
      tags:['defend hole','2m defense','front','double','centre','set defense','hole d'],
      script:'6 posts up at 2m\n3 has the ball\n3 passes to 6',
      answer:[
        'Front the set ball-side so the entry pass has to beat your hands.',
        'The wing nearest the ball helps / doubles when the ball is on the perimeter.',
        'Keeper cheats toward the ball side and talks the front.',
      ],
      rules:[ { q:'Two hands on the ball?', a:'Only the goalkeeper, inside their own defensive area, may play the ball with two hands. A field defender using two hands gives away a foul.' } ] },

    { id:'beat-the-double', phase:'offense', situation:'6v6',
      title:'I’m double-teamed at the hole',
      q:'They double-team me at 2 m. What do I do with the ball?',
      tags:['double','double team','two defenders','hole','2m','kick out','trapped','sandwich'],
      script:'6 has the ball\n6 passes to 2\n2 shoots far corner',
      answer:[
        'A double means someone is free — catch, protect, and immediately kick to the open man.',
        'Don’t fight two defenders; the offence is now 5-on-4 behind the double.',
        'Quick release: the longer you hold, the more the defence recovers.',
      ],
      rules:[ { q:'Being held in the double?', a:'If either defender holds or sinks you, it’s a major foul — you earn the power play.' } ] },

    { id:'open-the-drive', phase:'offense', situation:'6v6',
      title:'Wing drive to score',
      q:'How do I score driving from the wing?',
      tags:['wing','drive','baseline','cross face','one on one','beat my man','iso'],
      script:'2 has the ball\n2 drives to the baseline\n2 shoots far corner',
      answer:[
        'Attack the baseline to commit the keeper, then cross-face back to the open far side.',
        'If the weak-side defender slides to help, kick to the shooter they left.',
        'Sell the drive with speed — a half-speed drive lets the defender recover.',
      ],
      rules:[ { q:'Contact on the drive?', a:'You may swim through; if the defender impedes you without the ball it’s a foul in your favour.' } ] },

    { id:'defend-counter', phase:'defense', situation:'3v2',
      title:'They broke a counter on us',
      q:'They keep scoring on the counter-attack. How do we stop it?',
      tags:['counter','fast break','transition','sprint back','defend break','odd man','recover'],
      script:'3 has the ball\n3 drives to the goal\n3 shoots near corner',
      answer:[
        'First defender back stops the BALL — never chase the trailer first.',
        'Everyone sprints goal-side; give up the outside pass, protect the middle.',
        'Keeper controls the shooter; the field defenders take away the extra man.',
      ],
      rules:[ { q:'Why the counter starts?', a:'Counters start on the turnover — one clean steal or blocked shot and they’re gone. Balance the floor before you shoot.' } ] },

    { id:'defend-man-down', phase:'defense', situation:'6v5',
      title:'Defending 6-on-5 (man-down)',
      q:'We’re a man down. How do we defend the 6-on-5?',
      tags:['man down','6 on 5','penalty kill','defend power play','box','zone','one short'],
      script:'3 has the ball\n3 passes to 2\n2 shoots near corner',
      answer:[
        'Set the box (or 4-2) zone, hands up in the lanes, block the near-side shot.',
        'Shift as a unit with the ball — never let two defenders chase one pass.',
        'Keeper cheats to the ball; survive the 18 s without a free crash to the post.',
      ],
      rules:[ { q:'How long to survive?', a:'The exclusion is 18 s (ends early on a goal or change of possession). Then you’re back to even.' } ] },

    { id:'counter-start', phase:'offense', situation:'4v3',
      title:'Starting a counter-attack',
      q:'We won the ball — how do we start a good counter?',
      tags:['start counter','outlet','release','fast break offense','wings sprint','transition offense'],
      script:'1 has the ball\n1 passes to 3\n3 drives to the goal\n3 shoots far corner',
      answer:[
        'The instant you win it, the wings sprint — get ahead of the ball.',
        'Make the long outlet pass AHEAD of the runner, into space, not to their body.',
        'Attack before they set — a 4-on-3 becomes a 6-on-6 if you wait.',
      ],
      rules:[ { q:'Legal outlet?', a:'You may pass the length of the pool; just don’t hold the ball underwater when challenged.' } ] },

    { id:'lob-vs-set-keeper', phase:'offense', situation:'GK',
      title:'Keeper sits deep on the line',
      q:'The keeper stays deep on the line. Where do I shoot?',
      tags:['keeper deep','set keeper','on the line','where to shoot','corners','lob','placement'],
      script:'1 has the ball\n1 shoots low corner',
      answer:[
        'A deep keeper leaves the near corners open — shoot low and hard to the corners.',
        'Fake high to lift them, then shoot low; or fake low and lob high.',
        'Pick a spot early; placement beats power against a set keeper.',
      ],
      rules:[ { q:'Keeper reach?', a:'Inside their own area the keeper can use two hands and stand — beat them with placement, not by shooting at them.' } ] },
  ];

  const byId = {}; PROBLEMS.forEach(p => byId[p.id] = p);

  /* board(id) → { frames, notes } built from the DRAFT script */
  function board(id) {
    const p = byId[id]; if (!p || typeof DRAFT === 'undefined') return null;
    const r = DRAFT.parse(p.script, p.situation);
    return { frames: r.frames, notes: r.notes, situation: p.situation, phase: p.phase };
  }

  /* ask(text) → [{ problem, score }] ranked, best first (score>0) */
  const STOP = new Set(['the','a','an','to','at','on','of','in','i','we','my','do','what','is','and','how','should','can','me','they','their','out','with','if','for','it','be']);
  function tokens(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w));
  }
  function ask(text) {
    const qs = tokens(text);
    if (!qs.length) return [];
    const scored = PROBLEMS.map(p => {
      const hay = (p.tags.join(' ') + ' ' + p.title + ' ' + p.q).toLowerCase();
      let score = 0;
      // phrase bonuses for the common multi-word cues
      p.tags.forEach(tag => { if (tag.includes(' ') && text.toLowerCase().includes(tag)) score += 3; });
      qs.forEach(w => { if (hay.includes(w)) score += 1; });
      // light stem: singular/plural + goalie/goalkeeper synonyms
      if (/goalie|keeper|goalkeeper|golie/.test(text.toLowerCase()) && /keeper|goalie|goalkeeper/.test(hay)) score += 1;
      return { problem: p, score };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
    return scored;
  }

  return { PROBLEMS, byId, board, ask, tokens };
})();
