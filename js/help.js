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
      'Coaches: use <strong>✋ Adjust</strong> to move players right here, or <strong>Edit</strong> for the full editor.',
    ]},

    adjust: { icon:'✋', title:'Adjust — grab a player, move him, save it', steps:[
      'Open a play and press <strong>✋ Adjust</strong> (next to Edit).',
      '<strong>Press and hold a player disc, drag it</strong> to the new spot, release. The movement arrow follows immediately. The <strong>ball</strong> drags the same way.',
      'Use <strong>⏮ ⏭</strong> in the yellow bar to switch steps — every step is one keyframe, so dragging at step 2 changes where the player swims <em>to</em>.',
      'Made a mess? <strong>↩ Undo</strong> reverts your last drag (up to 25).',
      'Finish with <strong>Save changes</strong> (overwrites this play) or <strong>Save as new ⑂</strong> (keeps the original and saves your version as a variant).',
    ], tips:[
      'Sample plays are never lost — saving over a sample makes it your own copy.',
      'Waiting players (subs, excluded) can be dragged into the staging zones too.',
    ]},

    editor: { icon:'✏️', title:'Editor — record a movement from scratch', steps:[
      'Press <strong>+ New</strong> (or <strong>Edit</strong> on an open play). Pick the <strong>situation</strong> and <strong>phase</strong>.',
      'Drag players and the ball into the <strong>starting</strong> spots.',
      'Press <strong>+ Capture step</strong>, then drag everyone to where they move <em>next</em>. Repeat — each capture records one step of the movement.',
      'Set the <strong>ball carrier</strong> per step; add waiting players with <strong>+ Sub / + Excluded</strong>.',
      'Optionally write per-position assignments, then <strong>Save scenario</strong> — or <strong>Save as new ⑂</strong> to keep the original untouched.',
    ], tips:[ 'The arrows preview live while you drag, so you always see the whiteboard your players will see.' ]},

    film: { icon:'🎬', title:'Film Room — analyse a real match', steps:[
      'Add a match: paste a <strong>YouTube link</strong> or <strong>Upload video</strong> (stored on this device).',
      'Watch. At an interesting moment press <strong>⏱ Mark moment</strong> — the timestamp fills in (or type it as m:ss).',
      'Describe it: event type, situation, shooter position, <strong>✔ right / ✘ wrong</strong>.',
      'Tap the <strong>goal mouth</strong> where the shot went, and on the <strong>situation board</strong> drag players + ball to match what you see in the video (the ball’s spot = shot origin).',
      'Write <strong>what would have stopped it</strong>, then <strong>Save moment</strong>.',
      'The timeline jumps the video on tap; the shot chart, origin map and insights build themselves from your tags.',
      '<strong>Board ⚡</strong> on any moment opens your staged positions in the editor — add the correction steps and save it as a play.',
    ], tips:[ 'Tag 5–10 moments per match; the insights get sharper with every tag.' ]},

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

  const VIEW_TOPIC = { dashboard:'dashboard', playbook:'playbook', basics:'basics', film:'film', trivia:'trivia', admin:'admin' };

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
