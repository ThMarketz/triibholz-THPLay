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
        role:'coach', position:null, status:'approved', createdAt:0, triviaBest:0 },
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

  function loadActivity() { try { return JSON.parse(localStorage.getItem(ACT_KEY)) || []; } catch(e){ return []; } }
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
  ];

  return { SITUATIONS, sit, DEFAULTS, defaultFrame, blankNotes, clone, load, save, reset, newScenario, GK_POS,
           waitDisc,
           ROLES, roleLabel, loadUsers, saveUsers, upsertUser, findUserByEmail, setUserStatus, setUserRole,
           setTriviaBest, loadActivity, logActivity, nowStamp, TRIVIA };
})();
