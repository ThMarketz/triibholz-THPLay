/* ============================================================
   data.js — situations, default formations, seed scenarios,
   and localStorage persistence.
   Attack always attacks the RIGHT goal. GK (red) = defending keeper.
   Ball carrier ids: 'A<pos>' attacker, 'D<pos>' defender, 'GK'.
   ============================================================ */
const DATA = (() => {
  const STORE_KEY = 'thplay.scenarios.v1';

  // ordered situations with attacker / defender counts
  const SITUATIONS = [
    { id: '6v6', label: '6 on 6', att: 6, def: 6, note: 'Even front — set offense' },
    { id: '6v5', label: '6 on 5', att: 6, def: 5, note: 'Man-up / power play' },
    { id: '5v4', label: '5 on 4', att: 5, def: 4, note: 'Extra attacker' },
    { id: '4v3', label: '4 on 3', att: 4, def: 3, note: 'Transition advantage' },
    { id: '3v2', label: '3 on 2', att: 3, def: 2, note: 'Fast break' },
    { id: '2v1', label: '2 on 1', att: 2, def: 1, note: 'Two on the keeper’s man' },
    { id: '1v1', label: '1 on 1', att: 1, def: 1, note: 'Isolation' },
    { id: 'GK',  label: '1 on GK', att: 1, def: 0, note: 'Alone vs the goalkeeper' },
  ];
  const sit = (id) => SITUATIONS.find(s => s.id === id);

  // ---- default formations per situation (single frame) ----
  // coords are in the 320x220 viewBox, water area x:24..296 y:30..190
  const GK_POS = { x: 292, y: 110 };

  const DEFAULTS = {
    '6v6': {
      att: { 1:{x:252,y:58}, 2:{x:236,y:84}, 3:{x:228,y:110}, 4:{x:236,y:136}, 5:{x:252,y:162}, 6:{x:276,y:110} },
      def: { 1:{x:266,y:64}, 2:{x:256,y:88}, 3:{x:250,y:110}, 4:{x:256,y:132}, 5:{x:266,y:156}, 6:{x:284,y:110} },
      gk: GK_POS, ball: 'A3',
    },
    '6v5': {
      att: { 1:{x:246,y:58}, 2:{x:230,y:86}, 3:{x:226,y:110}, 4:{x:230,y:134}, 5:{x:246,y:162}, 6:{x:276,y:110} },
      def: { 1:{x:260,y:82}, 2:{x:260,y:138}, 3:{x:278,y:92}, 4:{x:278,y:128}, 5:{x:286,y:110} },
      gk: GK_POS, ball: 'A3',
    },
    '5v4': {
      att: { 1:{x:240,y:64}, 2:{x:228,y:96}, 3:{x:232,y:126}, 4:{x:246,y:158}, 5:{x:276,y:110} },
      def: { 1:{x:260,y:88}, 2:{x:260,y:132}, 3:{x:282,y:100}, 4:{x:282,y:122} },
      gk: GK_POS, ball: 'A2',
    },
    '4v3': {
      att: { 1:{x:232,y:78}, 2:{x:232,y:142}, 3:{x:262,y:82}, 4:{x:262,y:138} },
      def: { 1:{x:252,y:110}, 2:{x:280,y:92}, 3:{x:280,y:128} },
      gk: GK_POS, ball: 'A1',
    },
    '3v2': {
      att: { 1:{x:208,y:80}, 2:{x:208,y:140}, 3:{x:234,y:110} },
      def: { 1:{x:262,y:96}, 2:{x:262,y:124} },
      gk: GK_POS, ball: 'A3',
    },
    '2v1': {
      att: { 1:{x:226,y:92}, 2:{x:226,y:128} },
      def: { 1:{x:266,y:110} },
      gk: GK_POS, ball: 'A1',
    },
    '1v1': {
      att: { 1:{x:236,y:110} },
      def: { 1:{x:264,y:110} },
      gk: GK_POS, ball: 'A1',
    },
    'GK': {
      att: { 1:{x:248,y:110} },
      def: {},
      gk: GK_POS, ball: 'A1',
    },
  };

  const clone = (o) => JSON.parse(JSON.stringify(o));

  // build a fresh single-frame from defaults
  function defaultFrame(situation) {
    const d = DEFAULTS[situation] || DEFAULTS['6v6'];
    return { att: clone(d.att), def: clone(d.def), gk: clone(d.gk), ball: { carrier: d.ball }, extra: [] };
  }

  // a waiting disc placed in a lane ('sub'|'exc') at slot index
  function waitDisc(team, label, lane, index) {
    const zone = lane === 'exc' ? POOL.EXCZONE : POOL.SUBZONE;
    const p = POOL.stackPos(zone, index);
    return { team, label, x: p.x, y: p.y };
  }

  function blankNotes() {
    return { '1':'', '2':'', '3':'', '4':'', '5':'', '6':'', 'GK':'' };
  }

  // helper to derive a frame from another, moving some players
  function frameFrom(base, mutate) {
    const f = clone(base);
    mutate(f);
    return f;
  }

  /* ---------------- seed scenarios ---------------- */
  function seeds() {
    idCounter = 1;        // stable ids every call so the merge stays idempotent
    const list = [];

    // 6 on 6 — drive & kick to the wing, hole posts up
    (() => {
      const subs = [ waitDisc('A','S1','sub',0), waitDisc('A','S2','sub',1) ]; // two subs waiting
      const f0 = defaultFrame('6v6'); f0.extra = clone(subs);
      const f1 = frameFrom(f0, f => {
        f.att[3] = {x:244,y:110};          // 3 drives the middle
        f.att[6] = {x:278,y:96};           // hole seals across
        f.ball = { carrier: 'A3' };
        f.def[3] = {x:262,y:110}; f.def[6] = {x:286,y:100};
      });
      const f2 = frameFrom(f1, f => {
        f.att[2] = {x:248,y:74};           // 2 lifts to the wing
        f.ball = { carrier: null, x:248, y:74 };   // pass travelling to 2
        f.def[2] = {x:262,y:80};
      });
      const f3 = frameFrom(f2, f => {
        f.ball = { carrier: 'A2' };
        f.att[6] = {x:280,y:92};           // hole pins, ready for the dump
      });
      list.push(scn('6v6','offense','Drive & kick — wing shot',
        '3 drives the middle to collapse the defense, then kicks to 2 on the wing for the shot while 6 pins the hole.',
        [f0,f1,f2,f3],
        { '1':'Stay top to balance the floor; be the safety if we lose it.',
          '2':'Lift to the wing on 3’s drive, catch and shoot or feed the hole.',
          '3':'Attack the middle hard to draw two, then kick to 2.',
          '4':'Hold weak-side flat, ready for the skip pass.',
          '5':'Spread the bottom, occupy your defender.',
          '6':'Post up, seal across the goal, look for the dump pass.',
          'GK':'(defending) Track the ball-side, expect the wing shot.' }));
    })();

    // 6 on 5 — power play, 4-2 swing for the post shot
    (() => {
      const f0 = defaultFrame('6v5');
      // the excluded defender waits in the exclusion / re-entry lane during the man-up
      f0.extra = [ waitDisc('D','EX','exc',0) ];
      const f1 = frameFrom(f0, f => { f.ball = { carrier:null, x:230,y:134 }; });    // swing 3 -> 4
      const f2 = frameFrom(f1, f => { f.ball = { carrier:'A4' }; f.def[2]={x:252,y:140}; });
      const f3 = frameFrom(f2, f => { f.ball = { carrier:null, x:246,y:162 }; });     // 4 -> 5 post
      const f4 = frameFrom(f3, f => { f.ball = { carrier:'A5' }; f.att[5]={x:250,y:160}; });
      list.push(scn('6v5','offense','Power play — 4-2 swing to the post',
        'Swing the ball quickly 3→4→5 to beat the zone rotation; 5 catches at the post with the keeper still sliding.',
        [f0,f1,f2,f3,f4],
        { '1':'Top: keep the ball moving fast, no holding.',
          '2':'Mirror 1 up top, swing it across on the skip.',
          '3':'Start the swing toward 4, then relocate for the skip back.',
          '4':'Catch the swing, shot fake, move it to 5 at the post.',
          '5':'Post player — sit low, be ready to finish on the catch.',
          '6':'Center: occupy the box defenders, screen on the swing side.',
          'GK':'(defending) Don’t over-slide; the post is the danger.' }));
    })();

    // 5 on 4
    (() => {
      const f0 = defaultFrame('5v4');
      const f1 = frameFrom(f0, f => { f.ball={carrier:null,x:228,y:96}; });
      const f2 = frameFrom(f1, f => { f.ball={carrier:'A2'}; f.att[5]={x:278,y:104}; });
      const f3 = frameFrom(f2, f => { f.ball={carrier:null,x:278,y:104}; f.def[3]={x:276,y:108}; });
      const f4 = frameFrom(f3, f => { f.ball={carrier:'A5'}; });
      list.push(scn('5v4','offense','Extra man — feed the hole',
        'Move the top defender with a swing, then feed 5 at the hole for the inside finish.',
        [f0,f1,f2,f3,f4],
        { '1':'Top: draw your man, swing to 2.',
          '2':'Catch and look inside immediately to 5.',
          '3':'Balance weak side, ready for the kick-out.',
          '4':'Bottom: occupy your defender, don’t drift.',
          '5':'Hole: get to the front of goal, present a target, finish.',
          '6':'(not used in 5v4 — bench/safety).',
          'GK':'(defending) Step to the feed angle.' }));
    })();

    // 4 on 3
    (() => {
      const f0 = defaultFrame('4v3');
      const f1 = frameFrom(f0, f => { f.att[1]={x:240,y:84}; f.ball={carrier:'A1'}; });
      const f2 = frameFrom(f1, f => { f.ball={carrier:null,x:262,y:138}; });    // skip to 4
      const f3 = frameFrom(f2, f => { f.ball={carrier:'A4'}; f.def[3]={x:276,y:120}; });
      list.push(scn('4v3','offense','Transition 4v3 — skip to the corner',
        'Drive the ball at the top defender, then skip cross-cage to 4 in the open corner.',
        [f0,f1,f2,f3],
        { '1':'Drive the top, commit a defender, then skip to 4.',
          '2':'Weak-side top: be the swing outlet.',
          '3':'Strong-side corner: occupy your man.',
          '4':'Open corner: catch the skip and shoot low far.',
          '5':'(not used).', '6':'(not used).',
          'GK':'(defending) Long shot from 1, then recover to the far post.' }));
    })();

    // 3 on 2 fast break
    (() => {
      const f0 = defaultFrame('3v2');
      const f1 = frameFrom(f0, f => { f.att[3]={x:252,y:110}; f.ball={carrier:'A3'}; });
      const f2 = frameFrom(f1, f => { f.ball={carrier:null,x:208,y:80}; });   // dish to 1
      const f3 = frameFrom(f2, f => { f.ball={carrier:'A1'}; f.att[1]={x:236,y:82}; });
      list.push(scn('3v2','offense','Fast break 3v2 — draw & dish',
        'Middle player attacks between the two defenders to freeze them, then dishes to the wing for the finish.',
        [f0,f1,f2,f3],
        { '1':'Wing lane — sprint, stay wide, finish on the catch.',
          '2':'Opposite wing — drag the second defender away.',
          '3':'Middle — attack the gap, draw both, then dish to the open wing.',
          '4':'(trailer / safety).', '5':'(not used).', '6':'(not used).',
          'GK':'(defending) Stay big, force the extra pass.' }));
    })();

    // 2 on 1
    (() => {
      const f0 = defaultFrame('2v1');
      const f1 = frameFrom(f0, f => { f.att[1]={x:252,y:96}; f.ball={carrier:'A1'}; f.def[1]={x:270,y:104}; });
      const f2 = frameFrom(f1, f => { f.ball={carrier:null,x:226,y:128}; });
      const f3 = frameFrom(f2, f => { f.ball={carrier:'A2'}; f.att[2]={x:256,y:128}; });
      list.push(scn('2v1','offense','2 on 1 — commit the defender',
        'Ball carrier drives at the single defender; if he steps up, slip it to the partner for an empty-net finish.',
        [f0,f1,f2,f3],
        { '1':'Drive straight at the defender; read him — shoot if he stays, pass if he steps.',
          '2':'Stay a body-width wide, present hands, finish.',
          '3':'(trailer).', '4':'(not used).', '5':'(not used).', '6':'(not used).',
          'GK':'(defending) Split the two, delay, hope for a bad pass.' }));
    })();

    // 1 on 1
    (() => {
      const f0 = defaultFrame('1v1');
      const f1 = frameFrom(f0, f => { f.att[1]={x:250,y:96}; f.def[1]={x:268,y:100}; f.ball={carrier:'A1'}; });
      const f2 = frameFrom(f1, f => { f.att[1]={x:262,y:120}; f.def[1]={x:272,y:108}; });
      list.push(scn('1v1','offense','1 on 1 — change of direction',
        'Attack one shoulder to turn the defender, then cut back the other way to open the shooting lane.',
        [f0,f1,f2],
        { '1':'Sell one direction, explode back the other; shoot off the turn.',
          '2':'(spacing).', '3':'(spacing).', '4':'', '5':'', '6':'',
          'GK':'(defending) Match the hips, don’t bite on the first fake.' }));
    })();

    // 1 on GK
    (() => {
      const f0 = defaultFrame('GK');
      const f1 = frameFrom(f0, f => { f.att[1]={x:262,y:110}; f.ball={carrier:'A1'}; });
      const f2 = frameFrom(f1, f => { f.att[1]={x:270,y:100}; });
      const f3 = frameFrom(f2, f => { f.ball={carrier:null,x:296,y:124}; });   // shot low corner
      list.push(scn('GK','offense','Breakaway vs the goalkeeper',
        'Pick up speed, lift to the strong side to move the keeper, then finish low to the opposite corner.',
        [f0,f1,f2,f3],
        { '1':'Don’t rush — make the keeper commit, then shoot far-low or fake-and-go.',
          '2':'', '3':'', '4':'', '5':'', '6':'',
          'GK':'(defending) Stay on your line as long as you can, big on the lunge.' }));
    })();

    // 6 on 6 DEFENSE example (we are defending: ball with a defender carrier)
    (() => {
      const f0 = defaultFrame('6v6');
      // flip ball to defense and drop into a press
      f0.ball = { carrier: 'D3' };
      const f1 = frameFrom(f0, f => { f.def[6]={x:282,y:104}; f.def[3]={x:248,y:110}; });
      list.push(scn('6v6','defense','Pressing M defense — front the hole',
        'Front the center (6) to deny the hole pass; perimeter pressures the ball and forces a bad-angle shot.',
        [f0,f1],
        { '1':'Pressure your man, hands up, contest the pass.',
          '2':'Drop a step to help front the hole on ball reversal.',
          '3':'Pressure the ball, force it to the weak side.',
          '4':'Hold the weak-side gap, be ready to slide.',
          '5':'Pressure low, deny the wing drive.',
          '6':'Front the center forward — deny the catch at 2m.',
          'GK':'Talk the slides; protect the near post on a drive.' }));
    })();

    /* ===== additional worked situations (problem → solution) ===== */

    // SET OFFENSE 6v6 — top pick, slip to the hole
    (() => {
      const f0 = defaultFrame('6v6'); f0.ball = { carrier:'A2' };
      const f1 = frameFrom(f0, f => { f.att[3]={x:240,y:92}; f.def[3]={x:252,y:88}; });            // 3 lifts to screen for 2
      const f2 = frameFrom(f1, f => { f.att[2]={x:250,y:104}; f.ball={carrier:'A2'}; f.def[2]={x:250,y:88}; }); // 2 uses pick, drives middle
      const f3 = frameFrom(f2, f => { f.att[6]={x:278,y:118}; f.ball={carrier:null,x:278,y:118}; }); // 2 dumps to hole slipping ball-side
      const f4 = frameFrom(f3, f => { f.ball={carrier:'A6'}; });
      list.push(scn('6v6','offense','Top pick — slip to the hole',
        '3 screens for 2 at the top; 2 drives the seam to pull the hole defender, then dumps to 6 slipping ball-side for the inside shot.',
        [f0,f1,f2,f3,f4],
        { '1':'Balance the floor up top; be the reset if the dump isn’t there.',
          '2':'Use 3’s pick, attack the middle, read the hole D — dump or shoot.',
          '3':'Set a hard, legal screen on 2’s man, then re-spot to the point.',
          '4':'Hold weak-side flat; your man can’t help on the hole.',
          '5':'Spread low; pin your defender so there’s no second helper.',
          '6':'Slip to the ball side as 2 drives; seal and finish the dump.',
          'GK':'(defending) Stay square to 2’s drive; the dump-down is the danger.' }));
    })();

    // SET OFFENSE 6v6 — wing drive baseline, dump to hole
    (() => {
      const f0 = defaultFrame('6v6'); f0.ball = { carrier:'A1' };
      const f1 = frameFrom(f0, f => { f.att[1]={x:262,y:64}; f.def[1]={x:272,y:74}; });             // 1 drives the wing baseline
      const f2 = frameFrom(f1, f => { f.att[6]={x:276,y:124}; f.def[6]={x:286,y:116}; });            // hole opens to weak side
      const f3 = frameFrom(f2, f => { f.ball={carrier:null,x:276,y:124}; });                          // baseline dump to 6
      const f4 = frameFrom(f3, f => { f.ball={carrier:'A6'}; });
      list.push(scn('6v6','offense','Wing drive baseline — dump to the hole',
        '1 drives the wing along the goal line to commit the keeper and the hole D; 6 cross-faces to the open side for the baseline dump.',
        [f0,f1,f2,f3,f4],
        { '1':'Attack the baseline hard; draw the keeper, then dump to 6.',
          '2':'Replace at the top for shot-clock safety.',
          '3':'Hold the point; you’re the swing if it kicks back out.',
          '4':'Stay weak-side flat, ready for the cross-cage skip.',
          '5':'Clear the corner so 1 has a lane.',
          '6':'Cross-face to the open side as 1 drives; present a target, finish.',
          'GK':'(defending) Don’t over-commit to 1; the cross-cage dump beats you.' }));
    })();

    // MAN-UP 5v4 — pick-and-release at the post
    (() => {
      const f0 = defaultFrame('5v4'); f0.ball = { carrier:'A1' };
      const f1 = frameFrom(f0, f => { f.ball={carrier:null,x:228,y:96}; });                           // 1 -> 2
      const f2 = frameFrom(f1, f => { f.ball={carrier:'A2'}; f.att[4]={x:240,y:150}; });              // 4 lifts to screen the post D
      const f3 = frameFrom(f2, f => { f.att[5]={x:280,y:120}; f.def[3]={x:276,y:108}; });             // 5 releases off the pick
      const f4 = frameFrom(f3, f => { f.ball={carrier:null,x:280,y:120}; });
      const f5 = frameFrom(f4, f => { f.ball={carrier:'A5'}; });
      list.push(scn('5v4','offense','Extra man — pick-and-release at the post',
        'Swing 1→2, while 4 screens the post defender so 5 releases free at the post for the catch-and-shoot.',
        [f0,f1,f2,f3,f4,f5],
        { '1':'Start the swing to 2, then relocate for the skip-back.',
          '2':'Catch and look post immediately — 5 will be open off the pick.',
          '3':'Balance weak side; be the kick-out valve.',
          '4':'Lift and screen 5’s defender — that pick springs the shot.',
          '5':'Release off 4’s pick to the post; catch low and shoot.',
          '6':'(out in 5v4 — next sub).',
          'GK':'(defending) Communicate the switch or the post is wide open.' }));
    })();

    // TRANSITION 4v3 — trailer post-up
    (() => {
      const f0 = defaultFrame('4v3'); f0.ball = { carrier:'A1' };
      const f1 = frameFrom(f0, f => { f.att[1]={x:244,y:84}; f.def[1]={x:256,y:96}; });               // 1 pushes the ball
      const f2 = frameFrom(f1, f => { f.att[3]={x:276,y:110}; f.def[2]={x:276,y:96}; });              // 3 trails into the hole
      const f3 = frameFrom(f2, f => { f.ball={carrier:null,x:276,y:110}; });                           // feed the trailer
      const f4 = frameFrom(f3, f => { f.ball={carrier:'A3'}; });
      list.push(scn('4v3','offense','Transition 4v3 — feed the trailer',
        'The first wave (1,2,4) spreads the 3 defenders; the trailer 3 posts straight into the hole and gets the feed before the D recovers.',
        [f0,f1,f2,f3,f4],
        { '1':'Push the ball at the top D, then hit the trailer when he posts.',
          '2':'Run your lane wide to stretch the defense.',
          '3':'Trail hard into the hole — you’re the finish, post and seal.',
          '4':'Fill the opposite corner; occupy the low defender.',
          '5':'(not in this break).', '6':'(not in this break).',
          'GK':'(defending) Hold the middle; force the outside shot, not the post.' }));
    })();

    // DEFENSE 6v6 — drop zone, protect the hole
    (() => {
      const f0 = defaultFrame('6v6'); f0.ball = { carrier:'A3' };
      const f1 = frameFrom(f0, f => { f.def[6]={x:283,y:106}; f.def[3]={x:256,y:110}; });             // front hole, ball-pressure drops
      const f2 = frameFrom(f1, f => { f.ball={carrier:null,x:236,y:84}; f.def[2]={x:258,y:86}; });     // attack swings, we rotate
      const f3 = frameFrom(f2, f => { f.ball={carrier:'A2'}; f.def[6]={x:284,y:100}; });
      list.push(scn('6v6','defense','Drop zone — protect the hole',
        'Sink the field into a zone that fronts the hole and walls the 5m; concede a contested outside shot, never the inside catch.',
        [f0,f1,f2,f3],
        { '1':'Zone the ball-side passing lane; high hands, no easy skip.',
          '2':'Drop and wall the 5m; close out only on the catch.',
          '3':'Pressure the ball just enough to slow the swing.',
          '4':'Hold the weak-side gap; you’re the backside rotation.',
          '5':'Sink low; double the hole if the ball goes in.',
          '6':'Front the center every pass — never let him catch at 2m.',
          'GK':'Quarterback the rotations; own the near post on a drive.' }));
    })();

    // DEFENSE 6v5 — man-down box, deny the post
    (() => {
      const f0 = defaultFrame('6v5'); f0.ball = { carrier:'A3' };
      f0.extra = [ waitDisc('D','EX','exc',0) ];                                                       // our excluded player waiting
      const f1 = frameFrom(f0, f => { f.def[5]={x:284,y:110}; });                                      // tighten the box on the post
      const f2 = frameFrom(f1, f => { f.ball={carrier:null,x:230,y:134}; f.def[2]={x:258,y:132}; });   // they swing low, box shifts
      const f3 = frameFrom(f2, f => { f.ball={carrier:'A4'}; });
      list.push(scn('6v5','defense','Man-down box — deny the post',
        'Defending a man-up: hold a 4-man box that always covers the two posts; shift as a unit on the swing and make them shoot from outside.',
        [f0,f1,f2,f3],
        { '1':'Top of the box — slide to the ball, hands in the lane.',
          '2':'Bottom of the box — shift on the swing, never get split.',
          '3':'Pressure the ball only at the top; don’t over-commit.',
          '4':'Cover the near post; box stays compact.',
          '5':'Cover the far post — that catch is the goal we can’t give.',
          '6':'(excluded — wait in the re-entry area, re-enter on the whistle).',
          'GK':'Call the shift early; take the outside shot, deny the post feed.' }));
    })();

    return list;
  }

  let idCounter = 1;
  function scn(situation, phase, title, description, frames, notes) {
    return {
      id: 'seed-' + (idCounter++),
      situation, phase, title, description,
      frames,
      notes: Object.assign(blankNotes(), notes || {}),
      author: 'Playbook (sample)',
      builtIn: true,
      updated: 0,
    };
  }

  /* ---------------- persistence ---------------- */
  function load() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { saved = null; }
    if (!saved || !Array.isArray(saved.scenarios) || saved.scenarios.length === 0) {
      const fresh = seeds();
      save(fresh);
      return fresh;
    }
    // non-destructive merge: add any new built-in sample not already stored
    const fresh = seeds();
    const have = new Set(saved.scenarios.map(s => s.id));
    let changed = false;
    fresh.forEach(s => { if (!have.has(s.id)) { saved.scenarios.push(s); changed = true; } });
    if (changed) save(saved.scenarios);
    return saved.scenarios;
  }
  function save(scenarios) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ scenarios })); } catch (e) {}
  }
  function reset() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    return load();
  }

  function newScenario(situation, phase) {
    situation = SITUATIONS.some(s => s.id === situation) ? situation : '6v6';
    phase = (phase === 'offense' || phase === 'defense') ? phase : 'offense';
    return {
      id: 'usr-' + Math.abs(hash(situation + phase + (typeof performance!=='undefined'?performance.now():Date.now()))),
      situation, phase,
      title: '', description: '',
      frames: [ defaultFrame(situation) ],
      notes: blankNotes(),
      author: 'You',
      builtIn: false,
      updated: 0,
    };
  }
  function hash(str) { let h = 0; for (let i=0;i<str.length;i++){ h=(h<<5)-h+str.charCodeAt(i); h|=0; } return h; }

  /* ---------------- users / approvals / activity ---------------- */
  const USERS_KEY = 'thplay.users.v1';
  const ACT_KEY   = 'thplay.activity.v1';
  const ROLES = ['super-admin','coach','trainer','player'];
  const roleLabel = (r) => ({'super-admin':'Super Admin','coach':'Coach','trainer':'Trainer','player':'Player'}[r] || r);

  function seedUsers() {
    return [
      { id:'u-super', name:'Mika Adler', email:'admin@triibholz.app', provider:'Apple',
        role:'super-admin', position:null, status:'approved', createdAt:0, triviaBest:0 },
      { id:'u-pending1', name:'Jonas Weber', email:'jonas@gmail.com', provider:'Google',
        role:'player', position:'4', status:'pending', createdAt:0, triviaBest:0 },
      { id:'u-pending2', name:'Lena Brun', email:'lena@icloud.com', provider:'Apple',
        role:'trainer', position:null, status:'pending', createdAt:0, triviaBest:0 },
      { id:'u-coach', name:'Coach Ruiz', email:'ruiz@triibholz.app', provider:'Google',
        role:'coach', position:null, status:'approved', createdAt:0, triviaBest:0, xp:80, streak:5, badges:['first-study'] },
      { id:'u-p-nora', name:'Nora Frei', email:'nora@icloud.com', provider:'Apple',
        role:'player', position:'2', status:'approved', createdAt:0, triviaBest:12, xp:210, streak:6, badges:['first-study','trivia-ace','polyglot'] },
      { id:'u-p-timo', name:'Timo Koch', email:'timo@gmail.com', provider:'Google',
        role:'player', position:'5', status:'approved', createdAt:0, triviaBest:9, xp:95, streak:2, badges:['first-study','challenger'] },
    ];
  }
  function loadUsers() {
    let u; try { u = JSON.parse(localStorage.getItem(USERS_KEY)); } catch(e){ u=null; }
    if (!u || !Array.isArray(u) || !u.length) { u = seedUsers(); saveUsers(u); }
    return u;
  }
  function saveUsers(u) { try { localStorage.setItem(USERS_KEY, JSON.stringify(u)); } catch(e){} }
  function upsertUser(user) {
    const u = loadUsers();
    const i = u.findIndex(x => x.email === user.email);
    if (i >= 0) { u[i] = Object.assign({}, u[i], user); } else { u.push(user); }
    saveUsers(u); return u;
  }
  function findUserByEmail(email) { return loadUsers().find(u => u.email === email) || null; }
  function setUserStatus(id, status) {
    const u = loadUsers(); const x = u.find(y => y.id === id);
    if (x) { x.status = status; saveUsers(u); } return x;
  }
  function setUserRole(id, role) {
    const u = loadUsers(); const x = u.find(y => y.id === id);
    if (x) { x.role = role; saveUsers(u); } return x;
  }
  function setTriviaBest(email, score) {
    const u = loadUsers(); const x = u.find(y => y.email === email);
    if (x && score > (x.triviaBest||0)) { x.triviaBest = score; saveUsers(u); } return x;
  }

  /* ---- gamification: XP, streaks, badges ---- */
  const BADGES = {
    'first-study': { icon:'🎯', label:'First Play Studied' },
    'trivia-ace':  { icon:'⭐', label:'Trivia Ace' },
    'power-play':  { icon:'🧠', label:'Power-Play Professor' },
    'challenger':  { icon:'🏆', label:'Challenger' },
    'polyglot':    { icon:'🌍', label:'Polyglot' },
    'streak-3':    { icon:'🔥', label:'3-Day Streak' },
  };
  function today(){ try { return new Date().toISOString().slice(0,10); } catch(e){ return '0'; } }
  function awardXp(email, n) {
    const u = loadUsers(); const x = u.find(y => y.email === email);
    if (x) { x.xp = (x.xp||0) + n; saveUsers(u); return x.xp; } return 0;
  }
  function addBadge(email, id) {
    const u = loadUsers(); const x = u.find(y => y.email === email);
    if (x) { x.badges = x.badges||[]; if (!x.badges.includes(id)) { x.badges.push(id); saveUsers(u); return true; } }
    return false;
  }
  function touchStreak(email) {
    const u = loadUsers(); const x = u.find(y => y.email === email);
    if (!x) return 0;
    const t = today();
    if (x.lastDay !== t) {
      let y='0'; try { y=new Date(Date.now()-86400000).toISOString().slice(0,10); } catch(e){}
      x.streak = (x.lastDay===y) ? (x.streak||0)+1 : 1;
      x.lastDay = t; saveUsers(u);
    }
    return x.streak || 1;
  }

  function seedActivity() {
    return [
      { type:'trivia',  text:'Nora Frei scored 12/15 on trivia', actor:'Nora Frei', at:6 },
      { type:'play',    text:'Coach Ruiz updated “Power play — 4-2 swing to the post” (6v5 offense)', actor:'Coach Ruiz', at:5 },
      { type:'approve', text:'Mika Adler approved Timo Koch (Player)', actor:'Mika Adler', at:4 },
      { type:'signin',  text:'Timo Koch requested access as Player', actor:'Timo Koch', at:3 },
      { type:'play',    text:'Coach Ruiz created “Top pick — slip to the hole” (6v6 offense)', actor:'Coach Ruiz', at:2 },
      { type:'trivia',  text:'Timo Koch scored 9/15 on a play challenge', actor:'Timo Koch', at:1 },
    ];
  }
  function loadActivity() {
    try {
      const raw = localStorage.getItem(ACT_KEY);
      if (raw === null) { const s = seedActivity(); localStorage.setItem(ACT_KEY, JSON.stringify(s)); return s; }
      return JSON.parse(raw) || [];
    } catch(e){ return []; }
  }
  function logActivity(type, text, actor) {
    const a = loadActivity();
    a.unshift({ type, text, actor: actor||'', at: nowStamp() });
    try { localStorage.setItem(ACT_KEY, JSON.stringify(a.slice(0, 200))); } catch(e){}
    return a;
  }
  // monotonic-ish stamp without Date.now (avoids ReferenceError-free fallback)
  let _seq = 0;
  function nowStamp() { _seq += 1; return _seq + (typeof performance!=='undefined' ? Math.floor(performance.now()) : 0); }

  /* ---------------- trivia bank ---------------- */
  const TRIVIA = [
    { q:'How many field players (excluding the goalkeeper) does each team have in the water?',
      a:['5','6','7'], correct:1, why:'Six field players plus one goalkeeper — seven in the water.' },
    { q:'What does a "6 on 5" situation mean?',
      a:['Six attackers vs a five-player defence (man-up)','Six minutes left','Sixth foul'], correct:0,
      why:'A defender has been excluded, so the attack has a one-player advantage.' },
    { q:'Where does an excluded player wait before re-entering?',
      a:['The official table','The exclusion / re-entry area','The goal'], correct:1,
      why:'Excluded players leave and re-enter from the re-entry (exclusion) area at the corner.' },
    { q:'How long is a standard exclusion (player sent out) in modern rules?',
      a:['20 seconds','30 seconds','15 seconds'], correct:0,
      why:'A typical exclusion is 20 seconds (or until a goal / change of possession).' },
    { q:'The centre forward who sets up in front of the goal at 2m is often called the…',
      a:['Wing','Hole set / centre','Point'], correct:1,
      why:'The hole set (centre forward) posts up at the 2m line in front of goal.' },
    { q:'On the board, which colour marks the goalkeeper?',
      a:['White','Black','Red'], correct:2, why:'Attack = white, defence = black, goalkeeper = red, ball = orange.' },
    { q:'A player cannot remain inside the 2m line without the ball when…',
      a:['Their team has possession','It is half time','Never'], correct:0,
      why:'It is an offside-style infraction to sit inside 2m ahead of the ball.' },
    { q:'In a fast-break 3 on 2, the middle attacker should usually…',
      a:['Shoot immediately','Draw both defenders then pass to a wing','Hold the ball'], correct:1,
      why:'Commit the defenders, then release the open wing for the finish.' },
    { q:'What is the goalkeeper allowed to do that field players cannot?',
      a:['Stand on the bottom & use two hands near goal','Walk on deck','Score from anywhere'], correct:0,
      why:'In the 5/6m area the keeper may use two hands and push off the bottom.' },
    { q:'The half-distance line divides the pool into…',
      a:['Attack and defence thirds','Two halves','Quarters'], correct:1,
      why:'It marks the midpoint of the field of play between the two goals.' },
    { q:'A penalty throw is taken from which line?',
      a:['The 2 m line','The 5 m line','The half line'], correct:1,
      why:'A major foul inside 5 m that stops a likely goal is a penalty from the 5 m line.' },
    { q:'Roughly how long does a team have to shoot each possession (shot clock)?',
      a:['About 30 seconds','90 seconds','No limit'], correct:0,
      why:'A ~30‑second shot clock limits each possession; shoot before it expires.' },
    { q:'What is the "eggbeater"?',
      a:['A type of shot','A leg kick that keeps you up without your hands','A foul'], correct:1,
      why:'The alternating eggbeater kick keeps players high and stable so the hands stay free.' },
    { q:'How many quarters is a match played in?',
      a:['Two','Four','Three'], correct:1,
      why:'Water polo is played in four quarters; teams switch ends between them.' },
  ];

  return { SITUATIONS, sit, DEFAULTS, defaultFrame, blankNotes, clone, load, save, reset, newScenario, GK_POS,
           waitDisc,
           ROLES, roleLabel, loadUsers, saveUsers, upsertUser, findUserByEmail, setUserStatus, setUserRole,
           setTriviaBest, loadActivity, logActivity, nowStamp, TRIVIA,
           BADGES, awardXp, addBadge, touchStreak };
})();
