/* ============================================================
   help.js — "How to use" for every function.
   HELP.show('topic') opens a step-by-step guide; a ？ button in
   the topbar opens the guide for whatever view is on screen, and
   small ？ chips sit next to each feature. Content is coach-first:
   numbered steps, then tips.
   ============================================================ */
const HELP = (() => {

  const TOPICS = {
    dashboard: { icon:'🏠', title:'Dashboard — your home base', steps:[
      'Coaches see the squad, the play count and the <strong>invite card</strong>: share the QR code or copy the link so players join by tapping their cap number.',
      'Players see their position, XP, 🔥 streak, badges and both trivia best scores.',
      'Super Admins see pending approvals and the live activity feed.',
      'Tap any listed play or button to jump straight there.',
    ], tips:[ 'The 🔊 button in the top bar turns match sounds on (off by default).' ]},

    playbook: { icon:'📖', title:'Playbook — watch & understand a play', steps:[
      'Pick a <strong>situation</strong> in the top bar (6 on 6 … 1 on GK) and <strong>Offense/Defense</strong>.',
      'Choose a play on the left — it opens on the board.',
      'Press <strong>▶</strong> to watch the movement, <strong>⏮ ⏭</strong> to move one step at a time, or drag the slider.',
      'Reading the board: <strong>solid white arrow</strong> = a player’s swim for one step · <strong>dashed orange arrow with a numbered badge</strong> = a pass · faint lines = defenders.',
      '<strong>Team / My position</strong> switches between the whole play and just your job; tapping a row in <strong>Assignments</strong> focuses that position.',
      '<strong>Problem / Solution</strong>: freeze the setup as a question, then <strong>Reveal solution ▶</strong> to see the answer animate.',
    ], tips:[
      'Keyboard: <kbd>Space</kbd> play/pause · <kbd>←</kbd>/<kbd>→</kbd> step back/forward.',
      'Coaches: <strong>paused = draggable</strong> — just grab a player and move him; a save bar appears. <strong>Edit</strong> opens the full editor.',
    ]},

    adjust: { icon:'✋', title:'Adjust — pause the play, then just drag', steps:[
      'Open a play — it starts <strong>paused</strong>, and paused means <strong>draggable</strong>. (Playing? Press <strong>⏸</strong> or <kbd>Space</kbd> first.)',
      '<strong>Press and hold a player disc, drag it</strong> to the new spot, release. The movement arrow follows immediately. The <strong>ball</strong> drags the same way.',
      'Use <strong>⏮ ⏭</strong> to switch steps — every step is one keyframe, so dragging at step 2 changes where the player swims <em>to</em>.',
      'After your first change a bar appears: <strong>↩ Undo</strong> a drag, <strong>Discard</strong>, <strong>Save changes</strong> (overwrites) or <strong>Save as new ⑂</strong> (keeps the original, saves a variant).',
      'Press <strong>▶</strong> any time (after saving or discarding) to watch the movement again.',
    ], tips:[
      'Sample plays are never lost — saving over a sample makes it your own copy.',
      'Waiting players (subs, excluded) can be dragged into the staging zones too.',
    ]},

    editor: { icon:'✏️', title:'Editor — record a movement from scratch', steps:[
      'Press the green <strong>＋ New play</strong> button (top of the play list, left side) or the dashed <strong>＋ Create a new play</strong> card at the end of the list. Pick the <strong>situation</strong> and <strong>phase</strong>.',
      'Fastest way: open <strong>✍️ Draft from words</strong> and simply WRITE the play — one line per step, e.g. <em>“3 drives to the middle and 2 lifts to the wing”, “3 passes to 2”, “2 shoots far corner”</em>. The board builds it as you type, shows what it understood, and fills each player’s assignment.',
      'Or drag players and the ball into the <strong>starting</strong> spots by hand.',
      'Press <strong>+ Capture step</strong>, then drag everyone to where they move <em>next</em>. Repeat — each capture records one step of the movement.',
      'Set the <strong>ball carrier</strong> per step; add waiting players with <strong>+ Sub / + Excluded</strong>.',
      'Optionally write per-position assignments, then <strong>Save scenario</strong> — or <strong>Save as new ⑂</strong> to keep the original untouched.',
    ], tips:[ 'The arrows preview live while you drag, so you always see the whiteboard your players will see.' ]},

    solutions: { icon:'💡', title:'Solutions Lab — ask a question, get a worked answer', steps:[
      'Type a situation in your own words — e.g. <em>“I swim alone at the keeper who comes out to 5 m — what do I do, can they foul me?”</em> — and press <strong>Solve</strong>.',
      'The best-matching solution opens on the right: <strong>What to do</strong> (the tactical steps), <strong>The rules</strong> (including fouls &amp; penalties), and an <strong>animated board</strong> that plays the movement with arrows.',
      'No question yet? Browse the cards, or tap an example chip to see how it works.',
      'Press <strong>▶ Replay</strong> to watch the board again, or <strong>Save as a play</strong> to drop the solution straight into your Playbook and adjust it there.',
    ], tips:[
      'It understands plain phrasing — “2 on 1 break”, “double team at 2 m”, “draw a kick-out”, “defend the counter” all find the right answer.',
      'Every answer’s rules follow the current World Aquatics laws (5 m penalty, 18 s exclusion, keeper limits).',
    ]},

    privacy: { icon:'🔒', title:'Confidential tactics &amp; anonymous learning', steps:[
      'Every play has a <strong>Who can see it</strong> setting: <strong>👥 Team</strong> (your team only, the default), <strong>🌐 Club</strong> (everyone in the club) or <strong>🔒 Private</strong> (only you — for confidential tactics). Others simply never see private plays in their library.',
      '<strong>The system still learns from private plays — anonymously.</strong> It reduces a play to a handful of pattern features (situation, number of steps, passes, shot zone, a coarse formation shape) and strips the title, description, notes, owner and club. The play itself never leaves the device.',
      'Those features only ever feed <strong>counts</strong>, and a pattern is only reported once at least <strong>5</strong> plays of that kind exist (k-anonymity) — so no single tactic can be reverse-engineered from the “Anonymous learnings” on the dashboard.',
    ], tips:[
      'Use 🔒 Private for set pieces and match-specific game plans; 👥 Team for the everyday playbook.',
      'When the club backend runs, anonymous features are pooled across teams — the club learns as a whole, and nobody’s secrets are exposed.',
    ]},

    season: { icon:'📅', title:'Season — plan &amp; calendar', steps:[
      '<strong>Goal → plan:</strong> name your goal, set the date you want to <em>peak</em> for, pick training days/week and focus, then <strong>Generate plan</strong>. You get a periodised plan — General Prep → Specific Prep → Competition → Taper — with a weekly load wave and water-polo sessions.',
      'Press <strong>Add all sessions to the calendar</strong> to drop the whole plan onto your schedule.',
      '<strong>Calendar:</strong> add matches and events (with time &amp; location). <strong>⬇ Export .ics</strong> gives a file that opens in Apple Calendar, Google Calendar or Outlook.',
      '<strong>🔗 Subscribe (all devices):</strong> publishes a live feed URL. Subscribe to it once on each phone/computer and it <strong>auto-updates</strong> whenever you publish new matches — iOS, Android and Windows all support subscribed calendars.',
    ], tips:[
      'The taper automatically cuts training volume in the last week or two so the team peaks on the goal date.',
      'A subscribed calendar keeps everyone in sync — publish once, the whole team’s calendars refresh.',
    ]},

    video: { icon:'🎬', title:'Generate a video of the play', steps:[
      'Build the play first — write it in <strong>✍️ Draft from words</strong> (e.g. <em>“white cap 2 drives to 2m on the right; defender 6 tries to foul 2; 2 passes to 4; 4 shoots far corner from the left”</em>, one action per line) or drag it out by hand.',
      'Open <strong>🎬 Generate video</strong> → <strong>Generate animated video</strong>. The tool renders a clean top-down clip of the exact movement and gives you a <strong>player + Download</strong> button — share it in team chat.',
      'The animation runs <strong>entirely on your device</strong>, is free, and shows precisely what you described.',
      '<strong>Photoreal (optional):</strong> to get life-like footage instead, add a text-to-video provider (endpoint + key) under <em>Photoreal</em>. It’s a paid external service you supply — and today those models look real but may not follow the tactics exactly. See <strong>docs/VIDEO.md</strong>.',
    ], tips:[
      'One action per line makes the cleanest animation — each line becomes a step.',
      'The clip downloads as a video file (WebM/MP4) you can send anywhere.',
    ]},

    commands: { icon:'⚡', title:'Commands (audibles) — call a play, the board runs it', steps:[
      'A <strong>command</strong> is a ready-made tactical move. Instead of dragging, you press one button and the board executes it — like calling a play from the bench.',
      'Two places to use them. In the <strong>editor</strong>, open <strong>⚡ Commands (audibles)</strong> to build a play from calls — each command adds its movement step and fills the assignments. Chain a few (e.g. <em>Feed the Hole → Pick &amp; Roll</em>).',
      'On the board, the <strong>⚡ Audible</strong> button (bottom-right of the pool) flashes a call onto the play you’re watching — the board pauses, runs the move, and you can drag to tweak then <strong>Save as new ⑂</strong>.',
      'Choose <strong>Apply to</strong> first: <strong>Whole team</strong> for unit moves (collapse, press, counter), or a single <strong>player / GK</strong> for individual calls (front the hole, tactical foul, wing iso).',
      'Offense calls move the white attackers; defense calls move the black defenders and the keeper. Everything you add is still fully draggable afterwards.',
    ], tips:[
      'The classics are all there: <strong>Pick &amp; Roll</strong>, <strong>Double-team the Hole</strong>, <strong>Goalie Out Front</strong>, <strong>Collapse</strong> (everyone between the two attackers) and the <strong>Ordinary Foul</strong> to stop an attack.',
      'A command that needs a player who isn’t in the current situation is skipped with a note — pick a valid target and try again.',
    ]},

    film: { icon:'🎬', title:'Film Room — analyse a real match', steps:[
      'Add a match: paste a <strong>YouTube link</strong> or <strong>Upload video</strong> (stored on this device).',
      'Watch. At an interesting moment press <strong>⏱ Mark moment</strong> — the timestamp fills in (or type it as m:ss).',
      'Describe it: event type, situation, shooter position, <strong>✔ right / ✘ wrong</strong>.',
      'Tap the <strong>goal mouth</strong> where the shot went, and on the <strong>situation board</strong> drag players + ball to match what you see in the video (the ball’s spot = shot origin).',
      'Write <strong>what would have stopped it</strong>, then <strong>Save moment</strong>.',
      'The timeline jumps the video on tap; the shot chart, origin map and insights build themselves from your tags.',
      '<strong>Board ⚡</strong> on any moment opens your staged positions in the editor — add the correction steps and save it as a play.',
      'For uploaded clips: <strong>🔎 Auto-analyse</strong> finds the busy moments by motion, and <strong>📍 Position tracking</strong> reads the caps &amp; ball straight onto your board — calibrate once by clicking the four corners of the field of play, then <strong>Track positions</strong> and open it as a play.',
      'Leave <strong>Hardened (Tier 2)</strong> on: it tracks a short passage from the current time, rejects splash, and bridges brief occlusions for steadier positions. Turn it off for a quick single-frame read of the whole clip. The chip beside it shows the on-device detector — <strong>colour</strong> by default, or <strong>model</strong> if a neural model pack has been loaded.',
      '<strong>☁️ Cloud analysis</strong> runs the same auto-tag → confirm workflow. With no endpoint it uses the on-device engine and lists the detected formation to <strong>Confirm → play</strong> or dismiss; paste a cloud URL to use the full pipeline once it’s live. Your confirmations are exactly what the cloud model learns from.',
    ], tips:[ 'Tag 5–10 moments per match; the insights get sharper with every tag.', 'Position tracking is offline &amp; private — nothing leaves your device. It reads cap colour, so it works best on clear, steady footage.' ]},

    trivia: { icon:'🎓', title:'Trivia — learn the rules & the legends', steps:[
      'Pick a quiz: <strong>Rules & basics</strong> or <strong>History, legends & stories</strong>.',
      'Answer — options shuffle every time, so learn the answer, not the position.',
      'Every answer shows a short explanation; your best score per quiz is saved.',
    ], tips:[ 'Perfect runs earn badges: ⭐ Trivia Ace and 🏛️ Historian. Players also get 🏆 play challenges on their dashboard.' ]},

    basics: { icon:'📘', title:'Basics — fundamentals & official rules', steps:[
      'Read the cards: object of the game, positions, match numbers (4×8 min, 28 s possession, 18 s exclusion…), lines, fouls, keeper, core skills.',
      '<strong>Roles & responsibilities</strong>: what players, the coach and the referee each own.',
      'The <strong>official rule books</strong> panel links the current World Aquatics & Swiss Aquatics documents — refreshed automatically every week.',
    ]},

    admin: { icon:'🛡️', title:'Admin — approvals & roles', steps:[
      'New sign-ups appear in the <strong>approval queue</strong> — Approve or Deny.',
      'Change anyone’s role with the dropdown in <strong>People</strong>.',
      'The <strong>activity feed</strong> shows sign-ins, approvals, play edits, film tags and quiz results as they happen.',
    ]},
  };

  const VIEW_TOPIC = { dashboard:'dashboard', playbook:'playbook', basics:'basics', film:'film', solutions:'solutions', trivia:'trivia', admin:'admin' };

  let modal = null;
  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement('div');
    modal.className = 'modal-backdrop help-backdrop';
    modal.hidden = true;
    modal.innerHTML = `<div class="modal help-modal">
      <div class="modal-head"><h3 id="help-title">How to use</h3><button class="modal-x" id="help-x">✕</button></div>
      <div class="modal-body" id="help-body"></div>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#help-x').onclick = hide;
    modal.addEventListener('click', e => { if (e.target === modal) hide(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) hide(); });
    return modal;
  }

  function show(topicId) {
    const t = TOPICS[topicId] || TOPICS.playbook;
    const m = ensureModal();
    m.querySelector('#help-title').innerHTML = `${t.icon} ${t.title}`;
    m.querySelector('#help-body').innerHTML =
      `<ol class="help-steps">${t.steps.map(s=>`<li>${s}</li>`).join('')}</ol>` +
      (t.tips && t.tips.length ? `<div class="help-tips">${t.tips.map(x=>`<div class="help-tip">💡 ${x}</div>`).join('')}</div>` : '');
    m.hidden = false;
  }
  function hide() { if (modal) modal.hidden = true; }
  function forView(view) { show(VIEW_TOPIC[view] || 'playbook'); }

  return { show, hide, forView, TOPICS };
})();
